# CipherChat

**Skills:** React, Node.js, Express, MongoDB, Socket.IO, WebRTC, WebCrypto, Docker, JWT, E2EE

CipherChat is a production-ready, end-to-end encrypted real-time chat application built on the MERN stack. It uses ECDH key exchange and AES-256-GCM encryption to ensure only communicating users can read messages — the server never sees plaintext. Features include 1-to-1 and group chats, file sharing, video/audio calls, typing indicators, and read receipts. The app is fully containerized with Docker and includes an admin dashboard for user and audit management.

## Features

| Area | Highlights |
| --- | --- |
| Authentication | Register/login, JWT access tokens (15 min, in-memory) + rotating refresh token in an httpOnly `SameSite=strict` cookie, bcrypt password hashing (cost 12), email verification & password reset flows, refresh-token reuse detection that revokes all sessions |
| Realtime messaging | 1-to-1 and group chats, typing indicators, delivery/read receipts, unread badges, online/offline presence, multi-device support |
| E2EE | Per-device ECDH P-256 identity keys, HKDF-derived pairwise channel keys, per-chat AES-256-GCM content keys wrapped per member, key rotation on member removal, server stores ciphertext only |
| File sharing | Images, video, PDFs/documents and voice notes — encrypted client-side with a random file key before upload; filenames encrypted too; downloads gated by chat membership |
| Calling | WebRTC audio/video calls with screen sharing, mute/camera toggles, busy detection; signaling relayed via Socket.IO |
| Security | Helmet CSP + security headers, layered rate limits, zod input validation, NoSQL-injection sanitization (`express-mongo-sanitize`), HPP protection, CSRF origin checks + strict SameSite cookies, HTTPS support (direct TLS or reverse proxy), audit logging with severity levels, account ban enforcement |
| UI/UX | WhatsApp/Signal-inspired layout, dark/light theme, responsive down to mobile, chat sidebar with search & previews, profiles, settings, admin console |
| Admin | Stats dashboard, user management (search/ban/promote), global active-session list with revocation, filterable audit logs |
| Ops | Dockerfiles + docker-compose, GitHub Actions CI (tests + builds), structured pino logging, graceful shutdown, seed script |

## Repository layout

```
secure-chat/
├── client/                     React (Vite) SPA
│   ├── nginx.conf              prod web server: SPA + API/WS proxy + security headers
│   └── src/
│       ├── api/                axios instance (token refresh interceptor) + endpoint modules
│       ├── crypto/e2ee.js      WebCrypto: ECDH/HKDF/AES-GCM primitives
│       ├── context/            Auth / Theme / Socket / Chat / Call providers
│       ├── components/         chat UI, call overlay, common widgets
│       └── pages/              auth flows, chat, settings, admin console
├── server/                     Express + Socket.IO API
│   └── src/
│       ├── config/             env validation, db, logger
│       ├── models/             User, Token, Session, Chat, Group, Message, File, Notification, AuditLog
│       ├── middleware/         auth, rate limiters, csrf origin check, upload, error+validation
│       ├── controllers/        auth, users, chats, messages, files, notifications, admin
│       ├── routes/             REST surface under /api
│       ├── sockets/            Socket.IO gateway (presence, typing, receipts, WebRTC signaling)
│       ├── services/           token/session, email, audit, presence
│       ├── validators/         zod schemas
│       └── tests/              Jest + Supertest suite (mongodb-memory-server)
├── docs/                       API.md · SOCKET_EVENTS.md · ENCRYPTION.md · DEPLOYMENT.md
├── docker-compose.yml
└── .github/workflows/ci.yml
```

## Quick start (Docker)

```bash
git clone <repo> && cd secure-chat

# generate strong secrets first!
export JWT_ACCESS_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
export JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

docker compose up -d --build
# app:      http://localhost:8080
```

Create an admin:

```bash
docker compose exec -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD='ChangeMe!123' server \
  node scripts/createAdmin.js
```

## Local development

Prereqs: Node ≥ 18, MongoDB running locally.

```bash
# terminal 1 - API
cd server
cp .env.example .env          # defaults work for dev
npm install
npm run dev                   # http://localhost:5000

# terminal 2 - SPA
cd client
npm install
npm run dev                   # http://localhost:5173 (proxies /api and /socket.io)
```

Dev conveniences:
* With no SMTP configured, verification/reset links are printed to the API console and
  (non-production only) returned in API responses as `devVerifyToken` / `devResetToken`.
* Set `EMAIL_VERIFICATION_REQUIRED=false` in `server/.env` to skip email gating locally.
* Tests: `cd server && npm test` (uses in-memory MongoDB).

## Environment variables

Server (see `server/.env.example`): `MONGO_URI`, `CLIENT_URLS`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `BCRYPT_ROUNDS`,
`COOKIE_SECURE`, `EMAIL_VERIFICATION_REQUIRED`, `SMTP_*`, `APP_PUBLIC_URL`,
`UPLOAD_DIR`, `MAX_FILE_MB`, `ENABLE_HTTPS`, `TLS_KEY_PATH`, `TLS_CERT_PATH`.

Client (see `client/.env.example`): `VITE_API_BASE`, `VITE_SOCKET_URL`,
`VITE_TURN_URL`/`VITE_TURN_USERNAME`/`VITE_TURN_CREDENTIAL` (recommended TURN server for calls behind NAT).

## How the encryption works (short version)

1. On first login the browser generates an **ECDH P-256** key pair. The public key is
   uploaded; the private key is wrapped with a PBKDF2(310k)-AES-GCM key derived from your
   password and stored as an opaque backup blob on the server (the server can never read it).
2. Every chat has a symmetric **AES-256-GCM content key**. Each member receives it wrapped
   inside a pairwise channel key derived by `ECDH(myPrivate, theirPublic) → HKDF-SHA256`
   with both user IDs bound as context info.
3. Messages, attachments and even filenames are encrypted with the chat/file keys before
   they touch the network. MongoDB holds only `{iv, ciphertext}` blobs.
4. Removing a member rotates the chat key for everyone remaining.

Full design, threat model and known limitations: [`docs/ENCRYPTION.md`](docs/ENCRYPTION.md).

## Documentation

* [API reference](docs/API.md)
* [Socket.IO events](docs/SOCKET_EVENTS.md)
* [Encryption design](docs/ENCRYPTION.md)
* [Deployment guide](docs/DEPLOYMENT.md)

## Test accounts

Register two users through the UI (verification link appears in the API console when SMTP
is unset), then message between them in two browser profiles to see live messaging,
receipts and place a call.

## License

MIT
