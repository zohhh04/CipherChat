# CipherChat - Version History

## Version 1.0.0 (Initial Release)
**Date:** Current Release

### Core Features
- **End-to-End Encryption (E2EE)**
  - ECDH P-256 key exchange
  - AES-256-GCM encryption for messages
  - HKDF-SHA256 key derivation
  - Per-device identity keys
  - WebCrypto API implementation

- **Authentication System**
  - User registration and login
  - JWT access tokens (15 min, in-memory)
  - Rotating refresh tokens in httpOnly cookies
  - bcrypt password hashing (cost 12)
  - Email verification flow
  - Password reset flow

- **Real-time Messaging**
  - 1-to-1 direct chats
  - Group chats
  - Typing indicators
  - Delivery/read receipts
  - Unread message badges
  - Online/offline presence

- **File Sharing**
  - Encrypted image uploads
  - Video file sharing
  - PDF/document sharing
  - Voice notes
  - Client-side file encryption

- **Video/Audio Calls**
  - WebRTC-based calling
  - Audio calls
  - Video calls
  - Screen sharing
  - Mute/camera toggles

- **UI/UX**
  - WhatsApp/Signal-inspired design
  - Dark/light theme toggle
  - Responsive layout
  - Chat sidebar with search
  - Message previews
  - Profile management

- **Admin Dashboard**
  - User management
  - Session monitoring
  - Activity logs
  - Ban/promote users

- **Security Features**
  - Helmet security headers
  - Rate limiting
  - CSRF protection
  - NoSQL injection prevention
  - Input validation (Zod)
  - Audit logging

- **DevOps**
  - Docker containerization
  - Docker Compose setup
  - CI/CD with GitHub Actions
  - In-memory MongoDB for tests
  - Structured logging (Pino)

---

## Version 1.1.0 (Settings Page Enhancement)
**Date:** Current Update

### New Features
- **Enhanced Settings Page**
  - Account section with role badge
  - Member since date display
  - Profile section with character counter
  - Security & Encryption section
  - Active Devices & Sessions management
  - "Revoke all other sessions" button
  - About section with app info
  - Danger zone for account deletion

### Improvements
- Better visual hierarchy
- Consistent card-based layout
- Security status indicators
- Fingerprint verification section
- Session management UI

---

## Version 1.1.1 (Lock Screen Fix)
**Date:** Current Update

### Bug Fixes
- **Fixed group creation failing after entering password on lock screen**
  - Disabled "＋ Chat" and "＋ Group" buttons when encryption keys are locked
  - Added visual indicator (lock banner) when keys need to be unlocked
  - Prevented users from opening modals before keys are ready
  - Added helpful tooltips explaining why buttons are disabled

- **Fixed fingerprint showing "Generating…" forever**
  - Root cause: `publicKey` field had `select: false` in User model
  - Server auth middleware wasn't selecting `publicKey` field
  - Fixed by adding `.select('+publicKey')` to auth middleware
  - Settings page now shows fingerprint correctly after unlock
  - Added better error messages for fingerprint generation

### Improvements
- Sidebar now shows `identityReady` state
- Better error prevention for encryption-dependent actions
- Fingerprint section shows "No public key found" if keys aren't set up
- Fingerprint shows "Unable to generate" if crypto fails

### Usage Instructions Added
- How to create direct chats
- How to create group chats
- How to make voice/video calls
- Important notes about encryption keys

---

## Upcoming Versions

### Version 1.2.0 (Planned)
**Target Features:**
- Message search functionality
- Chat export/import
- Custom themes
- Notification settings
- Read receipt customization
- Message reactions

### Version 1.3.0 (Planned)
**Target Features:**
- Voice messages (encrypted)
- Video messages
- Screen recording
- Broadcast channels
- Polls and surveys
- Scheduled messages

### Version 2.0.0 (Planned)
**Target Features:**
- Multi-device sync
- Forward secrecy (Signal protocol)
- Key verification via QR codes
- Self-destructing messages
- Backup/restore encryption keys
- Cross-platform support (Electron, mobile)

---

## Feature Comparison Table

| Feature | v1.0.0 | v1.1.0 | v1.1.1 |
|---------|--------|--------|--------|
| E2EE Encryption | ✅ | ✅ | ✅ |
| 1-to-1 Chat | ✅ | ✅ | ✅ |
| Group Chat | ✅ | ✅ | ✅ |
| File Sharing | ✅ | ✅ | ✅ |
| Video/Audio Calls | ✅ | ✅ | ✅ |
| Dark/Light Theme | ✅ | ✅ | ✅ |
| Admin Dashboard | ✅ | ✅ | ✅ |
| Settings Page | Basic | Enhanced | Enhanced |
| Session Management | Basic | Advanced | Advanced |
| Lock Screen UX | ⚠️ | ⚠️ | ✅ Fixed |

---

## Technical Stack

| Component | Technology |
|-----------|------------|
| Frontend | React, Vite, React Router |
| Backend | Node.js, Express, Socket.IO |
| Database | MongoDB |
| Encryption | WebCrypto API, ECDH, AES-GCM |
| Authentication | JWT, bcrypt |
| Calls | WebRTC |
| Containerization | Docker, Docker Compose |
| Testing | Jest, Supertest |
| CI/CD | GitHub Actions |
 
---

## Security Notes

### Encryption Details
- **Key Exchange:** ECDH P-256
- **Symmetric Encryption:** AES-256-GCM
- **Key Derivation:** HKDF-SHA256
- **Private Key Protection:** PBKDF2 (310k iterations) + AES-GCM
- **Password Hashing:** bcrypt (cost 12)

### Known Limitations (v1.0.0)
- No forward secrecy (static keys)
- Key verification requires out-of-band comparison
- Group encryption cost O(n) wraps
- No QR code verification

### Security Recommendations
- Use strong passphrases (min 10 chars recommended)
- Verify fingerprints with contacts
- Revoke unused sessions
- Keep software updated

---

## Changelog Format

Each version entry includes:
- **Version Number:** Semantic versioning (MAJOR.MINOR.PATCH)
- **Date:** Release date
- **New Features:** Added functionality
- **Improvements:** Enhancements to existing features
- **Bug Fixes:** Issues resolved
- **Breaking Changes:** Incompatible changes (if any)
- **Known Issues:** Current limitations
