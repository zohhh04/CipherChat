# REST API Reference

Base URL: `/api` · JSON bodies · Auth via `Authorization: Bearer <accessToken>` unless noted.
All responses are shaped `{ ok: boolean, data?: …, code?, message?, details? }`.

## Conventions

* **Access token** — short-lived JWT (default 15 min) returned by `login`/`refresh`; keep in memory only.
* **Refresh cookie** — `sc_rt`, httpOnly, `SameSite=strict`, `Secure` (when `COOKIE_SECURE=true`), path `/api/auth`. Rotated on every use. Reuse of a rotated token revokes the whole account's sessions (`401 session_revoked`).
* Validation errors → `422` with `details: [{path, message}]`.
* Rate limiting → `429 rate_limited` (auth endpoints: 20 / 15 min per IP+email).

## Auth — `/api/auth`

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/register` | `{username, email, password}` | Sends verification email (registration never fails on mail errors). Returns `verificationEmailSent`; non-prod without delivery also returns `devVerifyToken`. |
| POST | `/verify-email` | `{token}` | Marks the account verified. |
| POST | `/resend-verification` | `{email?}` (or access token) | Always 200; resends the link if the account is unverified. Mail failures never error. |
| POST | `/login` | `{email, password}` | Returns `{accessToken, user}` + sets refresh cookie. Blocked until verified when `EMAIL_VERIFICATION_REQUIRED=true`. |
| POST | `/refresh` | – (cookie) | Rotates cookie, returns new `{accessToken, user}`. |
| POST | `/logout` | – (cookie) | Revokes that session. |
| POST | `/logout-all` | – | Revokes all sessions. |
| GET | `/me` | – | Current user. |
| POST | `/forgot-password` | `{email}` | Always 200. Non-prod may include `devResetToken`. |
| POST | `/reset-password` | `{token, password}` | Revokes all sessions on success. |

## Users — `/api/users` 🔒

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/me` | Profile + active session count. |
| PATCH | `/me` | `{about?, theme?}` |
| PATCH | `/me/password` | `{currentPassword, newPassword}` — revokes sessions. |
| PUT | `/me/keys` | `{publicKey, backup:{salt, iv, blob}}` — device key upload. |
| GET | `/me/keys` | `{publicKey, backup}` for unlocking on this device. |
| GET | `/me/sessions` | This user's active sessions. |
| DELETE | `/me/sessions/:id` | Revoke one of your sessions. |
| GET | `/?q=` | Search users (username/email), max 15. |
| GET | `/public-keys?ids=a,b,c` | `{ publicKeys: {userId: base64} }` for ECDH. |

## Chats — `/api/chats` 🔒 (requires verified email)

| Method | Path | Body/Query | Notes |
| --- | --- | --- | --- |
| GET | `/` | – | All chats incl. members, encrypted `lastMessage`, unread counts, `keyWraps`. |
| POST | `/direct` | `{memberId, keyWraps}` | Idempotent — returns existing chat if present. |
| POST | `/group` | `{name, memberIds[], description?, keyWraps{userId:{iv,ct,by}}}` | Creator becomes admin. |
| GET | `/:id` | – | Detail incl. `keyWraps`. |
| PATCH | `/:id/group` | `{name?, description?}` | Admin only. |
| POST | `/:id/members` | `{memberIds[], keyWraps}` | Admin wraps current chat key for newcomers. |
| DELETE | `/:id/members/:userId` | – | Admin removes member; client must rotate afterwards (`rotationRequired:true`). |
| POST | `/:id/rotate-keys` | `{keyWraps (all members), removedUserId?}` | Admin replaces chat key wraps. |
| POST | `/:id/leave` | – | Group chats only. |

## Messages — `/api/chats/:id/…` 🔒

| Method | Path | Body/Query | Notes |
| --- | --- | --- | --- |
| GET | `/messages` | `?limit≤100&before=<messageId>` | Descending cursor pagination, returned oldest→newest. Ciphertext is opaque. |
| POST | `/messages` | `{iv, ciphertext, type, fileId?, replyTo?}` | `type ∈ text,image,video,audio,file,system`. Fan-out via Socket.IO. |
| POST | `/read` | `{ids[] ≤200}` | Sets readBy (+deliveredTo); emits receipt. |
| POST | `/delivered` | `{ids[]}` | Sets deliveredTo; emits receipt. |
| DELETE | `/messages/:mid` | – | Sender only; wipes ciphertext server-side. |

## Files — `/api/chats/files/:fid/…` 🔒

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/chats/:id/files` | multipart: encrypted blob in `file`, plus `nameIv`, `nameCt`, `mimeHint`. Limit `MAX_FILE_MB`. Rate-limited 20/min. |
| GET | `/meta` | `{size, mimeHint, nameIv, nameCt}` — chat members only. |
| GET | `/download` | Raw ciphertext stream, `no-store`, members only. |

## Notifications — `/api/notifications` 🔒

| GET | `/` | Latest 30 + unread count. |
| POST | `/read-all` | Mark all read. |

## Admin — `/api/admin` 🔒 role=admin

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/stats` | Totals + live online count. |
| GET | `/users?q&page&limit` | Paginated directory. |
| PATCH | `/users/:id/status` | `{banned:boolean}` — bans revoke sessions & kick sockets. |
| PATCH | `/users/:id/role` | `{role:'user'\|'admin'}` — cannot demote self. |
| GET | `/logs?action&severity&page&limit` | Audit trail. |
| GET | `/sessions` | Every active session w/ device info. |
| DELETE | `/sessions/:id` | Force-revoke any session. |

## Misc

| GET | `/api/health` | Liveness probe. |
| GET | `/api/csrf-token` | Issues a double-submit CSRF cookie (used by cookie-based flows). |

### Error codes

`validation_error` · `invalid_credentials` · `email_unverified` · `account_banned` ·
`token_expired` · `refresh_invalid` · `session_revoked` · `duplicate_account` ·
`not_member` · `chat_not_found` · `admin_required` · `rate_limited` · `file_too_large`
