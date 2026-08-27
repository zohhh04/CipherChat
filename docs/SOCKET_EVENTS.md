# Socket.IO Events

Endpoint: same origin as API (`/socket.io`). Authenticate during handshake:

```js
io(url, { auth: { token: accessToken }, transports: ['websocket', 'polling'] })
```

Handshake failures emit `connect_error` with `'unauthorized'` (bad/expired token or banned
user). On token refresh, update `socket.auth.token` and reconnect.

On connect the server joins your personal room `user:<id>` and one room per membership,
`chat:<chatId>`. Presence is tracked per-account across devices and broadcast globally.

## Server → Client

| Event | Payload | Description |
| --- | --- | --- |
| `presence:update` | `{ userId, online }` | Emitted to everyone when a user's first socket connects / last socket disconnects. |
| `message:new` | `{ chatId, message{id,sender,type,iv,ciphertext,fileId,replyTo,createdAt}, toSelf }` | Delivered to each member's personal room exactly once (`toSelf=true` for the sender). Content is ciphertext — decrypt client-side. |
| `receipt:delivered` | `{ chatId, userId, messageIds[] }` | A recipient received the messages. |
| `receipt:read` | `{ chatId, readerId, messageIds[] }` | A reader opened the chat. |
| `typing` | `{ chatId, userId, username, typing }` | Sent to other members of the room. Auto-expires client-side after ~6 s without renewal. |
| `notification:new` | `{ chatId, messageId }` | Nudge for the notifications drawer. |
| `message:deleted` | `{ chatId, messageId }` | Sender wiped the message server-side; clear local content. |
| `chat:new` / `chat:updated` | `{ chatId }` | Re-fetch chats (membership/profile changes). |
| `chat:keyrotated` | `{ chatId }` | Chat key changed: drop cached key, re-derive from new `keyWraps`. |
| `chat:removed` | `{ chatId }` | You were removed from the chat. Drop it and its keys. |
| `call:incoming` | `{ from, fromName, mediaType:'audio'\|'video' }` | Incoming WebRTC call invite. |
| `call:answered` | `{ from, accept }` | Callee accepted/declined. On accept the caller creates the offer. |
| `call:offer` / `call:answer-sdp` | `{ from, sdp }` | SDP exchange. |
| `call:ice` | `{ from, candidate }` | Trickle ICE candidate. |
| `call:ended` | `{ from }` | Peer hung up. |
| `call:busy` | `{ to }` | Target already in a call (server tracks active pairs). |
| `account:banned` | `{}` | Your account was suspended; disconnect & show notice. |

## Client → Server

| Event | Payload | Description |
| --- | --- | --- |
| `chat:join` | `{ chatId }` | Join a room you're a member of (e.g., after being added while online). Membership verified server-side. |
| `typing:start` / `typing:stop` | `{ chatId }` | Relay throttled client-side (~2 s heartbeat while typing). |
| `webrtc:call` | `{ to, mediaType }` | Ring a user (rejected with `call:busy` if either party is busy). |
| `webrtc:answer` | `{ to, accept }` | Accept/decline an incoming call. |
| `webrtc:offer` / `webrtc:answer-sdp` | `{ to, sdp }` | SDP relay (length-capped server-side). |
| `webrtc:ice` | `{ to, candidate }` | ICE relay. |
| `webrtc:end` | `{ to }` | Hang up / cancel ringing. |

All incoming payloads are validated server-side (ObjectId shape, size caps) before relay;
events are never broadcast beyond the targeted rooms.

Delivery/read receipts flow back over REST (`POST /chats/:id/delivered|read`) which then
fan the receipt events out to the chat room, keeping write paths idempotent and auditable.
