const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

function b64encode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) {
    binary += String.fromCharCode(...b.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64decode(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomB64(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b64encode(b);
}

async function derivePassKey(password, saltB64) {
  const base = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: b64decode(saltB64), iterations: 310000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt a UTF-8 string with a shared password.
// Returns { salt, iv, ciphertext } — all base64. Store iv on the wire as "salt.iv".
export async function encryptTextWithPassword(plainText, password) {
  if (!password) throw new Error('Secure key is required');
  const salt = randomB64(16);
  const iv = randomB64(12);
  const key = await derivePassKey(password, salt);
  const ivBytes = b64decode(iv);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, key, te.encode(plainText));
  return { salt, iv, ciphertext: b64encode(ct) };
}

export async function decryptTextWithPassword(payload, password) {
  if (!password) throw new Error('Enter the key to decrypt');
  const key = await derivePassKey(password, payload.salt);
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(payload.iv) },
    key,
    b64decode(payload.ciphertext)
  );
  return td.decode(pt);
}

// Encrypt raw bytes (files) with a shared password.
export async function encryptBytesWithPassword(plainBuf, password) {
  if (!password) throw new Error('Secure key is required');
  const salt = randomB64(16);
  const iv = randomB64(12);
  const key = await derivePassKey(password, salt);
  const bytes = plainBuf instanceof Uint8Array ? plainBuf : new Uint8Array(plainBuf);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv: b64decode(iv) }, key, bytes);
  return { salt, iv, ciphertext: b64encode(ct) };
}

export async function decryptBytesWithPassword(payload, password) {
  if (!password) throw new Error('Enter the key to decrypt');
  const key = await derivePassKey(password, payload.salt);
  return subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(payload.iv) },
    key,
    b64decode(payload.ciphertext)
  );
}

// Wire format helpers: message.iv = "salt.iv" so no server change is needed.
export function packIv(salt, iv) {
  return `${salt}.${iv}`;
}

export function unpackIv(packed) {
  if (!packed || typeof packed !== 'string' || !packed.includes('.')) return null;
  const dot = packed.indexOf('.');
  const salt = packed.slice(0, dot);
  const iv = packed.slice(dot + 1);
  if (!salt || !iv) return null;
  return { salt, iv };
}

export function isPasswordEncryptedIv(packed) {
  return unpackIv(packed) !== null;
}

// ─── Sender's Secure Chat Key storage (per user, this device) ───
export function secureKeyStorageKey(userId) {
  return `cipherchat.secureKey.${String(userId)}`;
}

export function getSecureKey(userId) {
  if (!userId) return '';
  try {
    return localStorage.getItem(secureKeyStorageKey(userId)) || '';
  } catch {
    return '';
  }
}

export function setSecureKey(userId, key) {
  try {
    if (!key) localStorage.removeItem(secureKeyStorageKey(userId));
    else localStorage.setItem(secureKeyStorageKey(userId), key);
  } catch {
    // storage optional
  }
}
