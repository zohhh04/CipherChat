# End-to-End Encryption Design

All cryptography runs in the browser via **WebCrypto**. The API server and MongoDB only
ever store/relay `{iv, ciphertext}` blobs — they have zero plaintext visibility.

## Primitives

| Purpose | Primitive |
| --- | --- |
| Identity key pair | ECDH P-256 (one per user, generated per device) |
| Pairwise channel key | `ECDH(myPriv, peerPub)` → 256-bit shared secret → HKDF-SHA256 (empty salt, info = `sc-e2ee-v1:<sorted(userIdA,userIdB)>`) → AES-256-GCM key |
| Content keys (chat, file) | Random AES-256-GCM keys |
| Private key at rest | PKCS8 wrapped by PBKDF2-SHA256 (310k iters) + AES-256-GCM |

## Key lifecycle

1. **Registration of device keys** — first login generates the identity pair. Public key
   is uploaded (`PUT /users/me/keys`). The private key is wrapped with a password-derived
   KEK and uploaded as an opaque backup blob so a new device can recover it after
   password entry. The server cannot unwrap it.
2. **Chat creation** — creator generates a random chat content key and uploads one wrap
   per member: `wrap_m = AESGCM(pairwise(creator→member), rawChatKey)` stored as
   `keyWraps[memberId] = {iv, ct, by}` where `by` identifies the wrapper (needed to pick
   the right pairwise context when unwrapping).
3. **Sending** — message JSON `{t:'text', x}` or `{t:'file', f, k, v, n, m, s, d}`
   (fileId, fileKey, fileIv, name, mime, size, durationSec) is encrypted with the chat
   key; files are additionally encrypted with their own random key *before* upload.
   Filenames are encrypted with the file key too.
4. **Receiving** — recipient unwraps the chat key once per session using their private
   key + the wrapper's public key, then decrypts messages/files locally. Decrypted blob
   URLs live only in memory.
5. **Membership changes** — removing a member triggers an admin-driven rotation: a fresh
   chat key is wrapped for remaining members only (`POST /chats/:id/rotate-keys`), and the
   removed member's wrap is deleted. Adding a member wraps the *current* key for them.

## Threat model / guarantees

* Server compromise does not expose message contents, files or filenames.
* Passwords are never sent anywhere except the login endpoint over TLS, and never leave
  enough material to unwrap the private-key backup (KEK derived client-side).
* HKDF info binds both user IDs, preventing cross-chat key confusion.
* GCM provides integrity — tampered ciphertext fails authentication and renders as an
  error/undecryptable placeholder.

## Known limitations (documented scope)

* **No forward secrecy ratchet** — this is a static double-Ratchet-free design: if a
  member's long-term private key leaks, past chats they were in are readable. Upgrading
  to Signal-style sender keys + ratcheting is the roadmap item for full FS/PCS.
* Removed members can read messages sent *before* their removal (they had the old key);
  everything after rotation is inaccessible.
* Key verification relies on out-of-band fingerprint comparison (Settings → Encryption)
  rather than QR scanning / safety numbers automation.
* WebCrypto private keys are non-extractable in memory but must be exported to wrap for
  backup; the backup's strength therefore equals your password strength (enforced ≥10
  chars, recommend passphrases).
* Group encryption cost is O(members) wraps at creation time (fine up to ~100 members).

## Fingerprint verification

`SHA-256(publicKeySPKI)[0..16]` rendered as 16 hex pairs in Settings. Two users compare
fingerprints out-of-band to rule out server-side key substitution.
