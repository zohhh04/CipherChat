const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function toB64(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromB64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function generateIdentityKeyPair() {
  return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
}

export async function exportPublicKeyB64(publicKey) {
  return toB64(await subtle.exportKey('spki', publicKey));
}

async function exportPrivateKeyPkcs8B64(privateKey) {
  return toB64(await subtle.exportKey('pkcs8', privateKey));
}

export async function importPublicKeyB64(b64) {
  return subtle.importKey('spki', fromB64(b64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

function deriveWrapKey(password, saltB64) {
  return subtle
    .importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey'])
    .then((base) =>
      subtle.deriveKey(
        { name: 'PBKDF2', salt: fromB64(saltB64), iterations: 310000, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
    );
}

export async function wrapPrivateKey(privateKey, password) {
  const pkcs8B64 = await exportPrivateKeyPkcs8B64(privateKey);
  const salt = toB64(randomBytes(16));
  const iv = toB64(randomBytes(12));
  const kek = await deriveWrapKey(password, salt);
  const blob = await subtle.encrypt({ name: 'AES-GCM', iv: fromB64(iv) }, kek, fromB64(pkcs8B64));
  return { salt, iv, blob: toB64(blob) };
}

export async function unwrapPrivateKey(backup, password) {
  const kek = await deriveWrapKey(password, backup.salt);
  const pkcs8 = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(backup.iv) },
    kek,
    fromB64(backup.blob)
  );
  return subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
}

function hkdfInfo(myId, peerId) {
  return te.encode(`sc-e2ee-v1:${[String(myId), String(peerId)].sort().join(':')}`);
}

export async function derivePairwiseKey(privateKey, peerPubB64, myId, peerId) {
  const peerPub = await importPublicKeyB64(peerPubB64);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: peerPub }, privateKey, 256);
  const base = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: hkdfInfo(myId, peerId) },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function generateChatKey() {
  return subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function encryptWithKey(key, data) {
  const iv = randomBytes(12);
  const bytes = typeof data === 'string' ? te.encode(data) : data;
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: toB64(iv), ciphertext: toB64(ciphertext) };
}

export async function decryptWithKey(key, payload) {
  const pt = await subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(payload.iv) },
    key,
    fromB64(payload.ciphertext)
  );
  return td.decode(pt);
}

export async function decryptBytesWithKey(key, payload) {
  return subtle.decrypt({ name: 'AES-GCM', iv: fromB64(payload.iv) }, key, fromB64(payload.ciphertext));
}

export async function decryptBufferWithKey(key, ivB64, buffer) {
  return subtle.decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, buffer);
}

export async function exportRawKeyB64(key) {
  return toB64(await subtle.exportKey('raw', key));
}

export async function importRawChatKey(rawB64) {
  return subtle.importKey('raw', fromB64(rawB64), { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export async function wrapChatKeyFor(chatKey, peerPubB64, myId, peerId) {
  const raw = await exportRawKeyB64(chatKey);
  const pairKey = await derivePairwiseKey(privateKeyRef, peerPubB64, myId, peerId);
  const payload = await encryptWithKey(pairKey, raw);
  return { iv: payload.iv, ct: payload.ciphertext, by: String(myId) };
}

let privateKeyRef = null;

export function setPrivateKey(key) {
  privateKeyRef = key;
}

export function hasPrivateKey() {
  return privateKeyRef !== null;
}

export async function unwrapChatKey(wrap, peerPubB64, myId, byUserId) {
  const pairKey = await derivePairwiseKey(privateKeyRef, peerPubB64, myId, byUserId);
  const raw = await decryptWithKey(pairKey, { iv: wrap.iv, ciphertext: wrap.ct });
  return importRawChatKey(raw);
}

export async function fingerprint(publicKeyB64) {
  const digest = await subtle.digest('SHA-256', fromB64(publicKeyB64));
  const bytes = new Uint8Array(digest).slice(0, 16);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g).join(' ');
}
