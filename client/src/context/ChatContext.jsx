import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import { chatsApi, messagesApi, filesApi, usersApi, aiApi } from '../api';
import {
  generateChatKey,
  wrapChatKeyFor,
  unwrapChatKey,
  encryptWithKey,
  decryptWithKey,
  exportRawKeyB64,
  importRawChatKey,
  fromB64,
  toB64,
  hasPrivateKey,
} from '../crypto/e2ee';
import {
  encryptTextWithPassword,
  decryptTextWithPassword,
  encryptBytesWithPassword,
  decryptBytesWithPassword,
  packIv,
  unpackIv,
  getSecureKey,
} from '../crypto/securePass';

const CHAT_MODE_KEY = 'cipherchat.chatModes.v1';
const DEFAULT_CHAT_MODE = 'normal'; // 🟢 Normal is the default mode

function loadModeMap() {
  try {
    return JSON.parse(localStorage.getItem(CHAT_MODE_KEY) || '{}');
  } catch {
    return {};
  }
}

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { user } = useAuth();
  const { subscribe, emit } = useSocket();

  const [chats, setChats] = useState({});
  const [modeByChat, setModeByChat] = useState(loadModeMap);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messagesByChat, setMessagesByChat] = useState({});
  const [typingByChat, setTypingByChat] = useState({});
  const [loadingChats, setLoadingChats] = useState(true);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [messageUrgency, setMessageUrgency] = useState({});

  const chatKeysRef = useRef(new Map());
  const pubKeysRef = useRef(new Map());
  // Session-only cache of successfully entered Secure keys, per chat.
  // Never persisted — receiver types the sender's key "then and there".
  const securePassCacheRef = useRef(new Map());
  const activeChatRef = useRef(null);
  activeChatRef.current = activeChatId;
  const chatsRef = useRef({});
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  const myPubKey = async () => {
    if (!pubKeysRef.current.has(user.id)) {
      const me = await usersApi.getKeysBackup();
      pubKeysRef.current.set(user.id, me.publicKey);
    }
    return pubKeysRef.current.get(user.id);
  };

  const getPeerIds = useCallback((chat) => chat.members.map((m) => String(m.id)), []);

  // 🟢 normal (plaintext) is default | 🔐 encrypted (E2EE). Mode is per-chat, per-message.
  const getChatMode = useCallback(
    (chatId) => modeByChat[String(chatId)] || DEFAULT_CHAT_MODE,
    [modeByChat]
  );

  const setChatMode = useCallback((chatId, mode) => {
    const next = mode === 'encrypted' ? 'encrypted' : 'normal';
    setModeByChat((prev) => {
      const updated = { ...prev, [String(chatId)]: next };
      try {
        localStorage.setItem(CHAT_MODE_KEY, JSON.stringify(updated));
      } catch {
        // storage optional
      }
      return updated;
    });
  }, []);

  const getPublicKeyFor = useCallback(async (userId) => {
    if (pubKeysRef.current.has(userId)) return pubKeysRef.current.get(userId);
    const { publicKeys } = await usersApi.publicKeys([userId]);
    const key = publicKeys[userId];
    if (!key) throw new Error('This user has not set up encryption yet. Ask them to log in first.');
    pubKeysRef.current.set(userId, key);
    return key;
  }, []);

  const ensureChatKey = useCallback(
    async (chat) => {
      const chatId = String(chat.id);
      if (chatKeysRef.current.has(chatId)) return chatKeysRef.current.get(chatId);

      const wrap = chat.keyWraps && chat.keyWraps[String(user.id)];
      if (!wrap) throw new Error('No key wrap for this chat');

      const byUserId = (wrap.by && /^[a-f\d]{24}$/i.test(String(wrap.by))) ? wrap.by : (chat.createdBy ? String(chat.createdBy) : null);
      if (!byUserId) throw new Error('No key wrap for this chat');

      const wrapperPub = await getPublicKeyFor(byUserId);
      const key = await unwrapChatKey(wrap, wrapperPub, user.id, byUserId);
      chatKeysRef.current.set(chatId, key);
      return key;
    },
    [user, getPublicKeyFor]
  );

  const decryptContent = useCallback(
    async (chat, iv, ciphertext) => {
      try {
        const key = await ensureChatKey(chat);
        return JSON.parse(await decryptWithKey(key, { iv, ciphertext }));
      } catch {
        return null;
      }
    },
    [ensureChatKey]
  );

  // Try to decrypt a password-encrypted outer payload with a given password.
  // Returns parsed content object or null.
  const tryPassDecrypt = useCallback(async (ivPacked, ciphertext, password) => {
    try {
      const parts = unpackIv(ivPacked);
      if (!parts) return null;
      const plain = await decryptTextWithPassword(
        { salt: parts.salt, iv: parts.iv, ciphertext },
        password
      );
      return JSON.parse(plain);
    } catch {
      return null;
    }
  }, []);

  const buildLockedSecure = useCallback((base, m) => {
    const preview = String(m.ciphertext || '').slice(0, 160);
    return {
      ...base,
      viewOnce: m.viewOnce === true,
      viewedAt: m.viewedAt || null,
      expired: false,
      text: '',
      file: null,
      locked: true,
      lockPreview: preview,
      lockIv: m.iv || '',
      lockCiphertext: m.ciphertext || '',
      lockFileId: m.fileId ? String(m.fileId) : null,
    };
  }, []);

  const contentToMessage = useCallback((base, m, content) => {
    const viewOnce = m.viewOnce === true || content.o === true;
    const expired = viewOnce && !!m.viewedAt;
    let file = null;
    if (!expired && content.t === 'file') {
      if (content.pass) {
        // Password-encrypted file: bytes on server are AES-GCM with the shared key.
        file = {
          fileId: content.f,
          securePass: true,
          fs: content.fs,
          fv: content.fv,
          nmSalt: content.ns,
          nmIv: content.nv,
          nmCt: content.nc,
          name: content.n,
          mime: content.m,
          size: content.s,
          duration: content.d,
          viewOnce,
        };
      } else {
        file = { fileId: content.f, key: content.k, iv: content.v, name: content.n, mime: content.m, size: content.s, duration: content.d, viewOnce };
      }
    }
    return {
      ...base,
      viewOnce,
      viewedAt: m.viewedAt || null,
      expired,
      text: expired ? '' : (content.t === 'text' ? content.x : ''),
      file,
      locked: false,
    };
  }, []);

  const normalizeMessage = useCallback(
    async (chat, m) => {
      const reactions = {};
      if (m.reactions && typeof m.reactions === 'object') {
        for (const [emoji, users] of Object.entries(m.reactions)) {
          reactions[emoji] = users.map(String);
        }
      }
      const base = {
        id: String(m.id ?? m._id),
        sender: String(m.sender),
        type: m.type || 'text',
        mode: m.mode === 'normal' ? 'normal' : 'encrypted',
        deletedAt: m.deletedAt || null,
        editedAt: m.editedAt || null,
        createdAt: m.createdAt,
        deliveredTo: (m.deliveredTo || []).map(String),
        readBy: (m.readBy || []).map(String),
        reactions,
        viewedAt: m.viewedAt || null,
        viewedBy: (m.viewedBy || []).map(String),
        forwarded: m.forwarded === true,
        callKind: m.callKind || '',
        callStatus: m.callStatus || '',
        poll: m.type === 'poll' && m.poll
          ? {
              question: String(m.poll.question || m.text || ''),
              options: (m.poll.options || []).map(String),
              votes: (m.poll.options || []).map((_, i) => (Array.isArray(m.poll.votes?.[i]) ? m.poll.votes[i].map(String) : [])),
            }
          : null,
      };
      // 🟢 Normal: plaintext straight from server, no keys needed.
      if (base.mode === 'normal') {
        const viewOnce = false; // view-once is a Secure-mode feature
        const expired = !!m.deletedAt;
        if (base.type === 'poll') {
          return { ...base, viewOnce, expired, text: expired ? '' : (base.poll?.question || m.text || ''), file: null };
        }
        if (base.type === 'call' || base.type === 'system') {
          return { ...base, viewOnce, expired, text: expired ? '' : (m.text || ''), file: null };
        }
        if (base.type !== 'text') {
          let meta = {};
          try {
            meta = JSON.parse(m.text || '{}');
          } catch {
            meta = {};
          }
          return {
            ...base,
            viewOnce,
            expired,
            text: '',
            file: expired || !m.fileId
              ? null
              : {
                  fileId: String(m.fileId || m.file),
                  name: meta.n || 'attachment',
                  mime: meta.m || '',
                  size: meta.s || 0,
                  duration: meta.d,
                  plain: true,
                },
          };
        }
        return { ...base, viewOnce, expired, text: expired ? '' : (m.text || ''), file: null };
      }
      // 🔐 Secure: receiver sees ENCRYPTED content until they enter the sender's key.
      if (m.deletedAt) {
        return { ...base, viewOnce: false, expired: false, text: '', file: null, locked: false };
      }
      if (!m.iv || !m.ciphertext) {
        return { ...base, viewOnce: false, expired: false, text: '', file: null, decryptError: true, locked: false };
      }
      const chatId = String(chat.id);
      const passParts = unpackIv(m.iv);
      if (passParts) {
        // New shared-key format: try session-cached key, then my own saved Secure key
        // (so the sender auto-sees plaintext after reload). Receivers stay locked.
        const cached = securePassCacheRef.current.get(chatId);
        const myKey = getSecureKey(user && user.id);
        const candidates = [cached, myKey].filter(Boolean);
        for (const pw of candidates) {
          const content = await tryPassDecrypt(m.iv, m.ciphertext, pw);
          if (content) {
            if (cached !== pw) securePassCacheRef.current.set(chatId, pw);
            return contentToMessage(base, m, content);
          }
        }
        return buildLockedSecure(base, m);
      }
      // Legacy E2EE format (pre-shared-key): try old chat key if unlocked, else old error UI.
      const content = await decryptContent(chat, m.iv, m.ciphertext);
      if (!content) {
        return { ...base, viewOnce: false, expired: false, text: '', file: null, decryptError: true, locked: false };
      }
      return contentToMessage(base, m, content);
    },
    [decryptContent, tryPassDecrypt, contentToMessage, buildLockedSecure, user]
  );

  // Receiver enters the sender's Secure key "then and there" to view one message.
  // On success the key is cached for this chat session so other messages open too.
  const unlockSecureMessage = useCallback(
    async (chatId, messageId, password) => {
      const cid = String(chatId);
      const chat = chatsRef.current[cid] || chats[cid];
      if (!chat) throw new Error('Chat not loaded');
      const list = messagesByChat[cid] || [];
      const msg = list.find((x) => String(x.id) === String(messageId));
      if (!msg) throw new Error('Message not found');
      const ivPacked = msg.lockIv || msg.iv;
      const ct = msg.lockCiphertext || msg.ciphertext;
      if (!ivPacked || !ct) throw new Error('Encrypted payload missing');
      const content = await tryPassDecrypt(ivPacked, ct, password);
      if (!content) throw new Error('Wrong key — could not decrypt this message');
      securePassCacheRef.current.set(cid, password);
      const base = { ...msg };
      const unlocked = contentToMessage(
        base,
        { viewOnce: msg.viewOnce, viewedAt: msg.viewedAt, fileId: msg.lockFileId },
        content
      );
      // Preserve server fields + raw payload for re-render/file decrypt.
      const next = {
        ...msg,
        ...unlocked,
        locked: false,
        decryptError: false,
        lockIv: ivPacked,
        lockCiphertext: ct,
      };
      setMessagesByChat((prev) => ({
        ...prev,
        [cid]: (prev[cid] || []).map((x) => (String(x.id) === String(messageId) ? next : x)),
      }));
      // Auto-open any other locked messages in this chat that this key unlocks.
      (async () => {
        try {
          const current = messagesByChat[cid] || [];
          const toUnlock = [];
          for (const x of current) {
            if (!x.locked || String(x.id) === String(messageId)) continue;
            const c2 = await tryPassDecrypt(x.lockIv || x.iv, x.lockCiphertext || x.ciphertext, password);
            if (c2) toUnlock.push({ x, c2 });
          }
          if (toUnlock.length > 0) {
            setMessagesByChat((prev) => ({
              ...prev,
              [cid]: (prev[cid] || []).map((x) => {
                const hit = toUnlock.find((t) => String(t.x.id) === String(x.id));
                if (!hit) return x;
                const u2 = contentToMessage(
                  { ...x },
                  { viewOnce: x.viewOnce, viewedAt: x.viewedAt, fileId: x.lockFileId },
                  hit.c2
                );
                return { ...x, ...u2, locked: false, decryptError: false };
              }),
            }));
          }
        } catch {
          // best-effort
        }
      })();
      return { ok: true };
    },
    [chats, messagesByChat, tryPassDecrypt, contentToMessage]
  );

  const getChatPasscode = useCallback(
    (chatId) => securePassCacheRef.current.get(String(chatId)) || getSecureKey(user && user.id) || '',
    [user]
  );

  const refreshChats = useCallback(async () => {
    const { chats: list } = await chatsApi.list();
    const map = {};
    for (const c of list) map[String(c.id)] = c;
    for (const c of list) {
      for (const m of c.members) pubKeysRef.current.delete(`__u_${m.id}`);
    }
    setChats(map);
    setLoadingChats(false);
    return map;
  }, []);

  useEffect(() => {
    let total = 0;
    for (const c of Object.values(chats)) total += c.unreadCount || 0;
    setUnreadTotal(total);
  }, [chats]);

  useEffect(() => {
    if (!user) return;
    refreshChats().catch(() => setLoadingChats(false));
  }, [user, refreshChats]);

  const loadMessages = useCallback(
    async (chatId) => {
      const chat = chats[String(chatId)];
      if (!chat) return [];
      const { messages } = await messagesApi.list(chatId, { limit: 50 });
      const decrypted = [];
      for (const m of messages) decrypted.push(await normalizeMessage(chat, m));
      setMessagesByChat((prev) => ({ ...prev, [String(chatId)]: decrypted }));
      return decrypted;
    },
    [chats, normalizeMessage]
  );

  const markRead = useCallback(async (chatId, msgs) => {
    const unread = msgs.filter(
      (m) => !m.deletedAt && m.sender !== user.id && !m.readBy.includes(user.id)
    );
    if (unread.length === 0) return;
    messagesApi.markRead(chatId, unread.map((m) => m.id)).catch(() => {});
    setMessagesByChat((prev) => ({
      ...prev,
      [String(chatId)]: (prev[String(chatId)] || []).map((m) =>
        unread.some((u) => u.id === m.id) ? { ...m, readBy: [...m.readBy, user.id], deliveredTo: [...new Set([...m.deliveredTo, user.id])] } : m
      ),
    }));
  }, [user]);

  const openChat = useCallback(
    async (chatId) => {
      setActiveChatId(String(chatId));
      emit('typing:stop', { chatId });
      const msgs =
        messagesByChat[String(chatId)] !== undefined
          ? messagesByChat[String(chatId)]
          : await loadMessages(chatId);
      await markRead(chatId, msgs || []);
      setChats((prev) => ({ ...prev, [String(chatId)]: prev[String(chatId)] ? { ...prev[String(chatId)], unreadCount: 0 } : prev[String(chatId)] }));
    },
    [messagesByChat, loadMessages, markRead, emit]
  );

  const sendText = useCallback(
    async (chatId, text, replyToId, opts = {}) => {
      const chat = chats[String(chatId)];
      if (!chat) throw new Error('Chat not loaded');
      const mode = opts.mode || modeByChat[String(chatId)] || DEFAULT_CHAT_MODE;

      const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const optimistic = {
        id: tempId,
        sender: user.id,
        type: 'text',
        mode,
        text,
        file: null,
        deletedAt: null,
        editedAt: null,
        createdAt: new Date().toISOString(),
        deliveredTo: [user.id],
        readBy: [user.id],
        reactions: {},
        forwarded: opts.forwarded === true,
      };
      setMessagesByChat((prev) => ({ ...prev, [String(chatId)]: [...(prev[String(chatId)] || []), optimistic] }));
      setChats((prev) => ({ ...prev, [String(chatId)]: { ...prev[String(chatId)], lastActivity: new Date().toISOString() } }));

      try {
        let body;
        if (mode === 'normal') {
          // 🟢 Normal: plaintext straight to server/MongoDB, no encryption.
          body = {
            mode: 'normal',
            type: 'text',
            text,
            ...(replyToId ? { replyTo: replyToId } : {}),
            ...(opts.forwarded === true ? { forwarded: true } : {}),
          };
        } else {
          // 🔐 Secure: encrypt with the sender's Settings key. Receiver sees
          // ciphertext and types the same key "then and there" to view it.
          const pass = getSecureKey(user.id) || securePassCacheRef.current.get(String(chatId));
          if (!pass) {
            throw new Error('Set your 🔐 Secure Chat Key in Settings first, then send.');
          }
          const payload = await encryptTextWithPassword(JSON.stringify({ t: 'text', x: text }), pass);
          securePassCacheRef.current.set(String(chatId), pass);
          body = {
            mode: 'encrypted',
            type: 'text',
            iv: packIv(payload.salt, payload.iv),
            ciphertext: payload.ciphertext,
            ...(replyToId ? { replyTo: replyToId } : {}),
            ...(opts.forwarded === true ? { forwarded: true } : {}),
          };
        }
        const message = await messagesApi.send(chatId, body);
        setMessagesByChat((prev) => ({
          ...prev,
          [String(chatId)]: (prev[String(chatId)] || []).map((m) =>
            m.id === tempId
              ? { ...m, id: String(message.id || message._id), mode: message.mode || mode, createdAt: message.createdAt }
              : m
          ),
        }));
        return message;
      } catch (err) {
        setMessagesByChat((prev) => ({
          ...prev,
          [String(chatId)]: (prev[String(chatId)] || []).filter((m) => m.id !== tempId),
        }));
        throw err;
      }
    },
    [chats, user, modeByChat]
  );

  const sendFile = useCallback(
    async (chatId, file, kind, durationSec, onProgress, opts = {}) => {
      const chat = chats[String(chatId)];
      if (!chat) throw new Error('Chat not loaded');
      const mode = opts.mode || modeByChat[String(chatId)] || DEFAULT_CHAT_MODE;

      // One-time view: images only + Secure mode only.
      const isImage = (file.type || '').startsWith('image/');
      const viewOnce = opts.viewOnce === true && isImage && kind === 'image';
      if (opts.viewOnce === true && !viewOnce) {
        throw new Error('One-time view is available for photos only');
      }
      if (viewOnce && mode === 'normal') {
        throw new Error('View-once needs 🔐 Secure mode. Switch modes first.');
      }

      // 🟢 Normal: upload raw bytes, plaintext filename meta — no encryption at all.
      if (mode === 'normal' && !viewOnce) {
        const mime = kind === 'audio' ? (file.type || 'audio/webm') : (file.type || 'application/octet-stream');
        const meta = { n: file.name || 'attachment', m: mime, s: file.size };
        if (durationSec) meta.d = durationSec;
        const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const optimistic = {
          id: tempId,
          sender: user.id,
          type: kind,
          mode: 'normal',
          text: '',
          file: { fileId: '', name: meta.n, mime: meta.m, size: meta.s, duration: durationSec || undefined, plain: true },
          viewOnce: false,
          viewedAt: null,
          expired: false,
          deletedAt: null,
          editedAt: null,
          createdAt: new Date().toISOString(),
          deliveredTo: [user.id],
          readBy: [user.id],
          reactions: {},
        };
        setMessagesByChat((prev) => ({ ...prev, [String(chatId)]: [...(prev[String(chatId)] || []), optimistic] }));
        try {
          const arrayBuf = await file.arrayBuffer();
          const nameB64 = toB64(new TextEncoder().encode(file.name || 'attachment'));
          const fileId = await filesApi.upload(chatId, arrayBuf, '', nameB64, mime, onProgress);
          const message = await messagesApi.send(chatId, {
            mode: 'normal',
            type: kind,
            text: JSON.stringify(meta),
            fileId: String(fileId),
          });
          setMessagesByChat((prev) => ({
            ...prev,
            [String(chatId)]: (prev[String(chatId)] || []).map((m) =>
              m.id === tempId
                ? { ...m, id: String(message.id || message._id), file: { ...m.file, fileId: String(fileId) }, createdAt: message.createdAt }
                : m
            ),
          }));
          return message;
        } catch (err) {
          setMessagesByChat((prev) => ({
            ...prev,
            [String(chatId)]: (prev[String(chatId)] || []).filter((m) => m.id !== tempId),
          }));
          throw err;
        }
      }

      // 🔐 Secure: file bytes + outer message both encrypted with sender's Settings key.
      const pass = getSecureKey(user.id) || securePassCacheRef.current.get(String(chatId));
      if (!pass) {
        throw new Error('Set your 🔐 Secure Chat Key in Settings first, then send.');
      }
      securePassCacheRef.current.set(String(chatId), pass);

      const arrayBuf = await file.arrayBuffer();
      const plainBytes = new Uint8Array(arrayBuf);
      const payload = await encryptBytesWithPassword(plainBytes, pass);
      const namePayload = await encryptTextWithPassword(file.name || 'attachment', pass);

      const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const optimistic = {
        id: tempId,
        sender: user.id,
        type: kind,
        mode: 'encrypted',
        text: '',
        file: { fileId: '', securePass: true, fs: payload.salt, fv: payload.iv, name: file.name || 'attachment', mime: file.type || 'application/octet-stream', size: file.size, duration: durationSec || undefined, viewOnce },
        viewOnce,
        viewedAt: null,
        expired: false,
        locked: false,
        deletedAt: null,
        editedAt: null,
        createdAt: new Date().toISOString(),
        deliveredTo: [user.id],
        readBy: [user.id],
        reactions: {},
      };
      setMessagesByChat((prev) => ({ ...prev, [String(chatId)]: [...(prev[String(chatId)] || []), optimistic] }));

      try {
        const encryptedBytes = fromB64(payload.ciphertext);
        const fileId = await filesApi.upload(
          chatId,
          encryptedBytes.buffer,
          namePayload.iv,
          namePayload.ciphertext,
          kind === 'audio' ? (file.type || 'audio/webm') : (file.type || ''),
          onProgress
        );

        const meta = {
          t: 'file',
          f: String(fileId),
          pass: true,
          fs: payload.salt,
          fv: payload.iv,
          ns: namePayload.salt,
          nv: namePayload.iv,
          nc: namePayload.ciphertext,
          n: file.name || 'attachment',
          m: kind === 'audio' ? (file.type || 'audio/webm') : (file.type || 'application/octet-stream'),
          s: file.size,
        };
        if (durationSec) meta.d = durationSec;
        if (viewOnce) meta.o = true;

        const content = await encryptTextWithPassword(JSON.stringify(meta), pass);

        const message = await messagesApi.send(chatId, {
          mode: 'encrypted',
          type: kind,
          iv: packIv(content.salt, content.iv),
          ciphertext: content.ciphertext,
          fileId: String(fileId),
          ...(viewOnce ? { viewOnce: true } : {}),
        });

        setMessagesByChat((prev) => ({
          ...prev,
          [String(chatId)]: (prev[String(chatId)] || []).map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  id: String(message.id),
                  file: { ...m.file, fileId: String(fileId) },
                  viewOnce: message.viewOnce === true || viewOnce,
                  createdAt: message.createdAt,
                }
              : m
          ),
        }));
        return message;
      } catch (err) {
        setMessagesByChat((prev) => ({
          ...prev,
          [String(chatId)]: (prev[String(chatId)] || []).filter((m) => m.id !== tempId),
        }));
        throw err;
      }
    },
    [chats, user, modeByChat]
  );

  const deleteMessage = useCallback(async (chatId, messageId) => {
    await messagesApi.remove(chatId, messageId);
    setMessagesByChat((prev) => ({
      ...prev,
      [String(chatId)]: (prev[String(chatId)] || []).map((m) =>
        m.id === String(messageId) ? { ...m, deletedAt: new Date().toISOString(), text: '', file: null } : m
      ),
    }));
  }, []);

  // Delete ALL history of one chat (server wipes for everyone + realtime sync).
  const clearChatHistory = useCallback(async (chatId) => {
    await messagesApi.clear(chatId);
    setMessagesByChat((prev) => ({ ...prev, [String(chatId)]: [] }));
    setChats((prev) => {
      const c = prev[String(chatId)];
      if (!c) return prev;
      return {
        ...prev,
        [String(chatId)]: {
          ...c,
          lastMessage: null,
          unreadCount: 0,
          lastActivity: new Date().toISOString(),
        },
      };
    });
  }, []);

  // Hide a single message only on this device (for messages you didn't send,
  // which the server only lets the sender delete). Never touches the server.
  const deleteMessageLocal = useCallback((chatId, messageId) => {
    setMessagesByChat((prev) => ({
      ...prev,
      [String(chatId)]: (prev[String(chatId)] || []).filter((m) => String(m.id) !== String(messageId)),
    }));
  }, []);

  const editMessage = useCallback(
    async (chatId, messageId, plaintext) => {
      const chat = chats[String(chatId)];
      if (!chat) throw new Error('Chat not loaded');
      const existing = (messagesByChat[String(chatId)] || []).find((m) => m.id === String(messageId));
      if (existing && existing.mode === 'normal') {
        await messagesApi.edit(chatId, messageId, { text: plaintext });
      } else {
        const existingIv = (existing && (existing.lockIv || existing.iv)) || '';
        if (unpackIv(existingIv)) {
          const pass = getSecureKey(user.id) || securePassCacheRef.current.get(String(chatId));
          if (!pass) throw new Error('Set your 🔐 Secure Chat Key in Settings first.');
          const payload = await encryptTextWithPassword(JSON.stringify({ t: 'text', x: plaintext }), pass);
          await messagesApi.edit(chatId, messageId, { iv: packIv(payload.salt, payload.iv), ciphertext: payload.ciphertext });
        } else {
          const key = await ensureChatKey(chat);
          const payload = await encryptWithKey(key, JSON.stringify({ t: 'text', x: plaintext }));
          await messagesApi.edit(chatId, messageId, { iv: payload.iv, ciphertext: payload.ciphertext });
        }
      }
      setMessagesByChat((prev) => ({
        ...prev,
        [String(chatId)]: (prev[String(chatId)] || []).map((m) =>
          m.id === String(messageId) ? { ...m, text: plaintext, editedAt: new Date().toISOString() } : m
        ),
      }));
    },
    [chats, ensureChatKey, messagesByChat]
  );

  const createDirect = useCallback(
    async (peerId) => {
      const existing = Object.values(chats).find(
        (c) => c.type === 'direct' && c.members.some((m) => String(m.id) === String(peerId))
      );
      if (existing) {
        await openChat(existing.id);
        return existing;
      }

      // Secure messages now use the sender's Settings key — E2EE wraps are
      // best-effort for legacy history only, never a startup blocker.
      let wraps = {};
      try {
        if (hasPrivateKey()) {
          const [myKeyB64, peerPubB64] = await Promise.all([myPubKey(), getPublicKeyFor(peerId)]);
          const chatKey = await generateChatKey();
          wraps[String(user.id)] = await wrapChatKeyFor(chatKey, myKeyB64, user.id, user.id);
          wraps[String(peerId)] = await wrapChatKeyFor(chatKey, peerPubB64, user.id, peerId);
          const { chatId } = await chatsApi.createDirect(peerId, wraps);
          chatKeysRef.current.set(String(chatId), chatKey);
          await refreshChats();
          await openChat(chatId);
          return chatId;
        }
      } catch {
        wraps = {};
      }

      const { chatId } = await chatsApi.createDirect(peerId, wraps);
      await refreshChats();
      await openChat(chatId);
      return chatId;
    },
    [chats, user, getPublicKeyFor, refreshChats, openChat]
  );

  const createGroup = useCallback(
    async (name, memberIds, description) => {
      const allIds = [...new Set([String(user.id), ...memberIds.map(String)])];
      let wraps = {};
      try {
        if (hasPrivateKey()) {
          const keys = await Promise.all([
            myPubKey(),
            ...allIds.filter((id) => id !== String(user.id)).map((id) => getPublicKeyFor(id)),
          ]);
          const pubById = {};
          pubById[String(user.id)] = keys[0];
          allIds.filter((id) => id !== String(user.id)).forEach((id, i) => {
            pubById[id] = keys[i + 1];
          });

          const chatKey = await generateChatKey();
          for (const uid of allIds) wraps[uid] = await wrapChatKeyFor(chatKey, pubById[uid], user.id, uid);
          const { chatId } = await chatsApi.createGroup(name, memberIds, wraps, description);
          chatKeysRef.current.set(String(chatId), chatKey);
          await refreshChats();
          await openChat(chatId);
          return chatId;
        }
      } catch {
        wraps = {};
      }

      const { chatId } = await chatsApi.createGroup(name, memberIds, wraps, description);
      await refreshChats();
      await openChat(chatId);
      return chatId;
    },
    [user, getPublicKeyFor, refreshChats, openChat]
  );

  const addMember = useCallback(
    async (chatId, userId) => {
      const chat = chats[String(chatId)];
      const chatKey = await ensureChatKey(chat);
      const peerPub = await getPublicKeyFor(userId);
      const wrap = await wrapChatKeyFor(chatKey, peerPub, user.id, userId);
      await chatsApi.addMembers(chatId, [userId], { [String(userId)]: wrap });
      await refreshChats();
    },
    [chats, ensureChatKey, getPublicKeyFor, user, refreshChats]
  );

  const removeMemberAndRotate = useCallback(
    async (chatId, targetUserId) => {
      const chat = chats[String(chatId)];
      await chatsApi.removeMember(chatId, targetUserId);

      const remaining = chat.members.map((m) => String(m.id)).filter((id) => id !== String(targetUserId));
      const newKey = await generateChatKey();

      const pubs = [];
      for (const uid of remaining) {
        pubs.push(uid === String(user.id) ? await myPubKey() : await getPublicKeyFor(uid));
      }

      const wraps = {};
      for (let i = 0; i < remaining.length; i += 1) {
        wraps[remaining[i]] = await wrapChatKeyFor(newKey, pubs[i], user.id, remaining[i]);
      }

      await chatsApi.rotateKeys(chatId, wraps, targetUserId);
      chatKeysRef.current.set(String(chatId), newKey);

      setChats((prev) => {
        const next = { ...prev };
        const updated = next[String(chatId)];
        if (updated) next[String(chatId)] = { ...updated, members: updated.members.filter((m) => String(m.id) !== String(targetUserId)) };
        return next;
      });
    },
    [chats, ensureChatKey, getPublicKeyFor, user]
  );

  const leaveChat = useCallback(
    async (chatId) => {
      await chatsApi.leave(chatId);
      chatKeysRef.current.delete(String(chatId));
      setChats((prev) => {
        const next = { ...prev };
        delete next[String(chatId)];
        return next;
      });
      if (String(activeChatRef.current) === String(chatId)) setActiveChatId(null);
    },
    []
  );

  const rotateGroupKeyManually = useCallback(
    async (chatId) => {
      const chat = chats[String(chatId)];
      const remaining = chat.members.map((m) => String(m.id));
      const newKey = await generateChatKey();

      const pubs = [];
      for (const uid of remaining) {
        pubs.push(uid === String(user.id) ? await myPubKey() : await getPublicKeyFor(uid));
      }

      const wraps = {};
      for (let i = 0; i < remaining.length; i += 1) {
        wraps[remaining[i]] = await wrapChatKeyFor(newKey, pubs[i], user.id, remaining[i]);
      }
      await chatsApi.rotateKeys(chatId, wraps);
      chatKeysRef.current.set(String(chatId), newKey);
    },
    [chats, getPublicKeyFor, user]
  );

  const notifyTyping = useCallback(
    (() => {
      let lastSent = 0;
      let stopped = true;
      return (chatId, isTyping) => {
        if (isTyping) {
          const now = Date.now();
          if (now - lastSent > 2000) {
            lastSent = now;
            stopped = false;
            emit('typing:start', { chatId });
          }
        } else if (!stopped) {
          stopped = true;
          emit('typing:stop', { chatId });
        }
      };
    })(),
    [emit]
  );

  const markViewOnce = useCallback(async (chatId, messageId) => {
    try {
      await messagesApi.markViewed(chatId, messageId);
    } catch {
      // best-effort: local state is still wiped so the photo can't be reopened
    }
    setMessagesByChat((prev) => ({
      ...prev,
      [String(chatId)]: (prev[String(chatId)] || []).map((m) =>
        m.id === String(messageId)
          ? { ...m, viewedAt: new Date().toISOString(), expired: true, text: '', file: null }
          : m
      ),
    }));
  }, []);

  // 📌 Pin a message — server stores chat.pinnedMessage + emits chat:pinned.
  const pinMessage = useCallback(async (chatId, messageId) => {
    await chatsApi.pin(chatId, messageId);
    const cid = String(chatId);
    const msg = (messagesByChat[cid] || []).find((m) => String(m.id) === String(messageId));
    setChats((prev) => {
      const c = prev[cid];
      if (!c) return prev;
      return {
        ...prev,
        [cid]: {
          ...c,
          pinnedMessage: msg
            ? { id: msg.id, sender: msg.sender, type: msg.type, mode: msg.mode, text: msg.text || msg.poll?.question || '', createdAt: msg.createdAt }
            : c.pinnedMessage,
        },
      };
    });
  }, [messagesByChat]);

  const unpinMessage = useCallback(async (chatId) => {
    await chatsApi.unpin(chatId);
    const cid = String(chatId);
    setChats((prev) => {
      const c = prev[cid];
      if (!c) return prev;
      return { ...prev, [cid]: { ...c, pinnedMessage: null } };
    });
  }, []);

  // 📊 Polls: create (plaintext, group-friendly) + vote (one vote per user).
  const createPoll = useCallback(async (chatId, question, options) => {
    const message = await messagesApi.createPoll(chatId, question, options);
    const chat = chatsRef.current[String(chatId)] || chats[String(chatId)];
    if (chat) {
      const normalized = await normalizeMessage(chat, {
        ...message,
        deliveredTo: [user.id],
        readBy: [user.id],
      });
      setMessagesByChat((prev) => ({ ...prev, [String(chatId)]: [...(prev[String(chatId)] || []), normalized] }));
    }
    return message;
  }, [chats, normalizeMessage, user]);

  const votePoll = useCallback(async (chatId, messageId, optionIndex) => {
    const poll = await messagesApi.votePoll(chatId, messageId, optionIndex);
    const cid = String(chatId);
    setMessagesByChat((prev) => ({
      ...prev,
      [cid]: (prev[cid] || []).map((m) =>
        String(m.id) === String(messageId)
          ? { ...m, poll: { question: poll.question, options: poll.options, votes: poll.votes } }
          : m
      ),
    }));
    return poll;
  }, []);

  // ⏩ Forward: re-send content into another chat with forwarded:true.
  // Client-side re-send keeps E2EE intact (decrypt with source key, send with target mode).
  const forwardMessage = useCallback(async (sourceMsg, targetChatId, opts = {}) => {
    const cid = String(targetChatId);
    const target = chatsRef.current[cid] || chats[cid];
    if (!target) throw new Error('Target chat not loaded');
    if (sourceMsg.type === 'poll' && sourceMsg.poll) {
      return createPoll(cid, sourceMsg.poll.question, sourceMsg.poll.options);
    }
    if (sourceMsg.file && !sourceMsg.expired && !sourceMsg.deletedAt) {
      // File forward: re-send text reference is not enough (bytes are per-chat encrypted).
      // For plaintext files the server bytes can be re-referenced; for secure files
      // fall back to text-forward with a note since bytes can't be re-keyed without download.
      if (sourceMsg.file.plain && sourceMsg.file.fileId) {
        const meta = { n: sourceMsg.file.name || 'attachment', m: sourceMsg.file.mime || '', s: sourceMsg.file.size || 0 };
        if (sourceMsg.file.duration) meta.d = sourceMsg.file.duration;
        const sent = await messagesApi.send(cid, {
          mode: 'normal',
          type: sourceMsg.type,
          text: JSON.stringify(meta),
          fileId: String(sourceMsg.file.fileId),
          forwarded: true,
        });
        const normalized = await normalizeMessage(target, { ...sent, deliveredTo: [user.id], readBy: [user.id] });
        setMessagesByChat((prev) => ({ ...prev, [cid]: [...(prev[cid] || []), normalized] }));
        return sent;
      }
      const label = sourceMsg.file.name || 'attachment';
      return sendText(cid, `↪ Forwarded file: ${label} (re-attach to share bytes)`, undefined, { mode: opts.mode || modeByChat[cid] || DEFAULT_CHAT_MODE, forwarded: true });
    }
    const text = String(sourceMsg.text || '').trim() || '(forwarded message)';
    return sendText(cid, text, undefined, { mode: opts.mode || modeByChat[cid] || DEFAULT_CHAT_MODE, forwarded: true });
  }, [chats, createPoll, sendText, normalizeMessage, user, modeByChat]);

  // 📞 Missed-call history entry inside a direct chat.
  const logMissedCall = useCallback(async (chatId, mediaType) => {
    try {
      const message = await messagesApi.logMissedCall(chatId, mediaType === 'video' ? 'video' : 'audio');
      const chat = chatsRef.current[String(chatId)] || chats[String(chatId)];
      if (chat) {
        const normalized = await normalizeMessage(chat, { ...message, deliveredTo: [user.id], readBy: [user.id] });
        setMessagesByChat((prev) => {
          const list = prev[String(chatId)] || [];
          if (list.some((m) => String(m.id) === String(normalized.id))) return prev;
          return { ...prev, [String(chatId)]: [...list, normalized] };
        });
      }
      return message;
    } catch {
      return null;
    }
  }, [chats, normalizeMessage, user]);

  // Resolve (or create) the 1:1 direct chat with a peer so a missed call lands in it.
  const logMissedCallForPeer = useCallback(async (peerId, mediaType) => {
    try {
      const existing = Object.values(chatsRef.current || {}).find(
        (c) => c.type === 'direct' && (c.members || []).some((m) => String(m.id) === String(peerId))
      );
      if (existing) return logMissedCall(existing.id, mediaType);
      const { chatId } = await chatsApi.createDirect(String(peerId), {});
      await refreshChats();
      return logMissedCall(chatId, mediaType);
    } catch {
      return null;
    }
  }, [logMissedCall, refreshChats]);

  const decryptPreview = useCallback(
    async (chat) => {
      const lm = chat && chat.lastMessage;
      if (!lm || lm.deletedAt) return null;
      if (lm.viewOnce && lm.viewedAt) return '👁️ View-once photo (expired)';
      // 🟢 Normal: plaintext preview, no keys needed.
      if ((lm.mode || 'encrypted') === 'normal') {
        if (lm.type === 'poll') return `📊 ${String(lm.text || 'Poll')}`.slice(0, 80);
        if (lm.type === 'call') return `📞 ${String(lm.text || 'Missed call')}`.slice(0, 80);
        if (lm.type === 'system') return String(lm.text || '').slice(0, 80) || null;
        if (lm.type && lm.type !== 'text') {
          try {
            const meta = JSON.parse(lm.text || '{}');
            return `[${String(lm.type).toUpperCase()}] ${meta.n || ''}`.slice(0, 80);
          } catch {
            return `[${String(lm.type || 'file').toUpperCase()}]`.slice(0, 80);
          }
        }
        return String(lm.text || '').slice(0, 80) || null;
      }
      // 🔐 Secure: never show plaintext in the list — receiver unlocks per message.
      return '🔐 Encrypted message';
    },
    []
  );

  useEffect(() => {
    if (!user) return undefined;

    const offs = [];

    offs.push(
      subscribe('message:new', ({ chatId, message, toSelf }) => {
        if (toSelf) return;
        (async () => {
          const cid = String(chatId);
          let chat = chatsRef.current[cid];
          if (!chat) chat = (await refreshChats())[cid];
          if (!chat) return;

          const normalized = await normalizeMessage(chat, {
            ...message,
            sender: message.sender,
            deliveredTo: message.sender === user.id ? [user.id] : [],
            readBy: message.sender === user.id ? [user.id] : [],
          });

          setMessagesByChat((prev) => {
            const list = prev[cid] || [];
            if (list.some((m) => m.id === normalized.id)) return prev;
            return { ...prev, [cid]: [...list, normalized] };
          });

          setChats((prev) => {
            const c = prev[cid];
            if (!c) return prev;
            return {
              ...prev,
              [cid]: {
                ...c,
                lastActivity: message.createdAt,
                unreadCount:
                  activeChatRef.current === cid || message.sender === user.id ? 0 : (c.unreadCount || 0) + 1,
              },
            };
          });

          if (message.sender !== user.id) {
            messagesApi.markDelivered(cid, [normalized.id]).catch(() => {});
            if (activeChatRef.current === cid) {
              messagesApi.markRead(cid, [normalized.id]).catch(() => {});
              setMessagesByChat((prev) => ({
                ...prev,
                [cid]: (prev[cid] || []).map((m) =>
                  m.id === normalized.id
                    ? { ...m, readBy: [...new Set([...m.readBy, user.id])], deliveredTo: [...new Set([...m.deliveredTo, user.id])] }
                    : m
                ),
              }));
            }
            if (normalized.text && normalized.text.trim().length > 0) {
              detectMessageUrgency(cid, normalized.text).catch(() => {});
            }
          }
        })();
      })
    );

    offs.push(
      subscribe('receipt:delivered', ({ chatId, userId, messageIds }) => {
        setMessagesByChat((prev) => ({
          ...prev,
          [String(chatId)]: (prev[String(chatId)] || []).map((m) =>
            messageIds.includes(m.id) && m.sender === user.id
              ? { ...m, deliveredTo: [...new Set([...m.deliveredTo, String(userId)])] }
              : m
          ),
        }));
      })
    );

    offs.push(
      subscribe('receipt:read', ({ chatId, readerId, messageIds }) => {
        setMessagesByChat((prev) => ({
          ...prev,
          [String(chatId)]: (prev[String(chatId)] || []).map((m) =>
            messageIds.includes(m.id) && m.sender === user.id
              ? { ...m, readBy: [...new Set([...m.readBy, String(readerId)])], deliveredTo: [...new Set([...m.deliveredTo, String(readerId)])] }
              : m
          ),
        }));
      })
    );

    offs.push(
      subscribe('message:deleted', ({ chatId, messageId }) => {
        setMessagesByChat((prev) => ({
          ...prev,
          [String(chatId)]: (prev[String(chatId)] || []).map((m) =>
            m.id === String(messageId) ? { ...m, deletedAt: new Date().toISOString(), text: '', file: null, poll: null } : m
          ),
        }));
        setChats((prev) => {
          const c = prev[String(chatId)];
          if (!c || !c.pinnedMessage || String(c.pinnedMessage.id) !== String(messageId)) return prev;
          return { ...prev, [String(chatId)]: { ...c, pinnedMessage: null } };
        });
      })
    );

    offs.push(
      subscribe('chat:cleared', ({ chatId }) => {
        const cid = String(chatId);
        setMessagesByChat((prev) => ({ ...prev, [cid]: [] }));
        setChats((prev) => {
          const c = prev[cid];
          if (!c) return prev;
          return {
            ...prev,
            [cid]: { ...c, lastMessage: null, unreadCount: 0, lastActivity: new Date().toISOString(), pinnedMessage: null },
          };
        });
      })
    );

    offs.push(
      subscribe('message:viewed', ({ chatId, messageId, viewerId, viewedAt }) => {
        setMessagesByChat((prev) => ({
          ...prev,
          [String(chatId)]: (prev[String(chatId)] || []).map((m) =>
            m.id === String(messageId)
              ? {
                  ...m,
                  viewedAt: viewedAt || new Date().toISOString(),
                  viewedBy: [...new Set([...(m.viewedBy || []), String(viewerId)])],
                  expired: true,
                  text: '',
                  file: null,
                }
              : m
          ),
        }));
      })
    );

    offs.push(
      subscribe('message:edited', ({ chatId, messageId, mode, text, iv, ciphertext, editedAt }) => {
        (async () => {
          const cid = String(chatId);
          const chat = chatsRef.current[cid];
          if (!chat) return;
          // 🟢 Normal edit carries plaintext; 🔐 secure edit carries iv/ciphertext.
          if ((mode || '') === 'normal') {
            setMessagesByChat((prev) => ({
              ...prev,
              [cid]: (prev[cid] || []).map((m) =>
                m.id === String(messageId) ? { ...m, text: text || m.text, editedAt } : m
              ),
            }));
            return;
          }
          // Shared-key edit: re-lock; cached key auto-opens if available.
          if (unpackIv(iv)) {
            const cached = securePassCacheRef.current.get(cid);
            const content = cached ? await tryPassDecrypt(iv, ciphertext, cached) : null;
            if (content && content.t === 'text') {
              setMessagesByChat((prev) => ({
                ...prev,
                [cid]: (prev[cid] || []).map((m) =>
                  m.id === String(messageId)
                    ? { ...m, text: content.x, editedAt, lockIv: iv, lockCiphertext: ciphertext }
                    : m
                ),
              }));
            } else {
              setMessagesByChat((prev) => ({
                ...prev,
                [cid]: (prev[cid] || []).map((m) =>
                  m.id === String(messageId)
                    ? { ...m, locked: true, text: '', file: null, lockIv: iv, lockCiphertext: ciphertext, lockPreview: String(ciphertext || '').slice(0, 160), editedAt }
                    : m
                ),
              }));
            }
            return;
          }
          const content = await decryptContent(chat, iv, ciphertext);
          if (!content) return;
          setMessagesByChat((prev) => ({
            ...prev,
            [cid]: (prev[cid] || []).map((m) =>
              m.id === String(messageId)
                ? { ...m, text: content.t === 'text' ? content.x : m.text, editedAt }
                : m
            ),
          }));
        })();
      })
    );

    offs.push(
      subscribe('message:reaction', ({ chatId, messageId, emoji, userId, action }) => {
        const cid = String(chatId);
        setMessagesByChat((prev) => ({
          ...prev,
          [cid]: (prev[cid] || []).map((m) => {
            if (m.id !== String(messageId)) return m;
            const reactions = { ...m.reactions };
            if (action === 'add') {
              const users = reactions[emoji] ? [...reactions[emoji]] : [];
              if (!users.includes(userId)) users.push(userId);
              reactions[emoji] = users;
            } else {
              const users = (reactions[emoji] || []).filter((id) => id !== userId);
              if (users.length === 0) delete reactions[emoji];
              else reactions[emoji] = users;
            }
            return { ...m, reactions };
          }),
        }));
      })
    );

    offs.push(
      subscribe('typing', ({ chatId, userId, username, typing }) => {
        if (userId === user.id) return;
        setTypingByChat((prev) => {
          const next = { ...prev };
          const forChat = { ...(next[String(chatId)] || {}) };
          if (typing) forChat[userId] = { username, ts: Date.now() };
          else delete forChat[userId];
          next[String(chatId)] = forChat;
          return next;
        });
      })
    );

    offs.push(subscribe('chat:new', () => refreshChats()));
    offs.push(
      subscribe('chat:updated', () =>
        refreshChats().catch(() => {})
      )
    );
    offs.push(
      subscribe('message:poll_updated', ({ chatId, messageId, poll }) => {
        const cid = String(chatId);
        setMessagesByChat((prev) => ({
          ...prev,
          [cid]: (prev[cid] || []).map((m) =>
            String(m.id) === String(messageId)
              ? { ...m, poll: { question: poll.question, options: poll.options, votes: poll.votes } }
              : m
          ),
        }));
      })
    );
    offs.push(
      subscribe('chat:pinned', ({ chatId, pinnedMessage }) => {
        const cid = String(chatId);
        setChats((prev) => {
          const c = prev[cid];
          if (!c) return prev;
          if (!pinnedMessage) return { ...prev, [cid]: { ...c, pinnedMessage: null } };
          return {
            ...prev,
            [cid]: {
              ...c,
              pinnedMessage: {
                id: String(pinnedMessage.id),
                sender: String(pinnedMessage.sender || ''),
                type: pinnedMessage.type || 'text',
                mode: pinnedMessage.mode || 'normal',
                text: pinnedMessage.text || '',
                createdAt: pinnedMessage.createdAt,
              },
            },
          };
        });
      })
    );
    // DP change by anyone -> refresh so new avatar is visible to everyone
    offs.push(
      subscribe('user:avatar_updated', () =>
        refreshChats().catch(() => {})
      )
    );
    offs.push(
      subscribe('chat:keyrotated', ({ chatId }) => {
        chatKeysRef.current.delete(String(chatId));
        refreshChats().catch(() => {});
        if (String(activeChatRef.current) === String(chatId)) loadMessages(chatId).catch(() => {});
      })
    );
    offs.push(
      subscribe('chat:removed', ({ chatId }) => {
        chatKeysRef.current.delete(String(chatId));
        setChats((prev) => {
          const next = { ...prev };
          delete next[String(chatId)];
          return next;
        });
        if (String(activeChatRef.current) === String(chatId)) setActiveChatId(null);
      })
    );

    return () => offs.forEach((off) => off());
  }, [user, subscribe, refreshChats, normalizeMessage, loadMessages, decryptContent]);

  useEffect(() => {
    const t = setInterval(() => {
      setTypingByChat((prev) => {
        const next = {};
        let changed = false;
        for (const [cid, typers] of Object.entries(prev)) {
          const fresh = {};
          for (const [uid, info] of Object.entries(typers)) {
            if (Date.now() - info.ts < 6000) fresh[uid] = info;
            else changed = true;
          }
          if (Object.keys(fresh).length > 0) next[cid] = fresh;
        }
        return changed ? next : prev;
      });
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const searchMessages = useCallback(
    (query) => {
      if (!query.trim()) return [];
      const q = query.toLowerCase();
      const results = [];
      for (const [chatId, msgs] of Object.entries(messagesByChat)) {
        for (const m of msgs) {
          if (!m.deletedAt && m.text && m.text.toLowerCase().includes(q)) {
            results.push({ ...m, chatId });
          }
        }
      }
      return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
    },
    [messagesByChat]
  );

  const addReaction = useCallback(
    async (chatId, messageId, emoji) => {
      await messagesApi.addReaction(chatId, messageId, emoji);
      setMessagesByChat((prev) => ({
        ...prev,
        [String(chatId)]: (prev[String(chatId)] || []).map((m) => {
          if (m.id !== String(messageId)) return m;
          const reactions = { ...m.reactions };
          const users = reactions[emoji] ? [...reactions[emoji]] : [];
          if (!users.includes(user.id)) users.push(user.id);
          reactions[emoji] = users;
          return { ...m, reactions };
        }),
      }));
    },
    [user]
  );

  const removeReaction = useCallback(
    async (chatId, messageId, emoji) => {
      await messagesApi.removeReaction(chatId, messageId, emoji);
      setMessagesByChat((prev) => ({
        ...prev,
        [String(chatId)]: (prev[String(chatId)] || []).map((m) => {
          if (m.id !== String(messageId)) return m;
          const reactions = { ...m.reactions };
          const users = (reactions[emoji] || []).filter((id) => id !== user.id);
          if (users.length === 0) delete reactions[emoji];
          else reactions[emoji] = users;
          return { ...m, reactions };
        }),
      }));
    },
    [user]
  );

  const detectMessageUrgency = useCallback(
    async (chatId, messageText) => {
      try {
        const msgs = messagesByChat[String(chatId)] || [];
        const recentMessages = msgs.slice(-5).map((m) => ({
          sender: m.sender === user.id ? 'Me' : 'Other',
          text: m.text || '',
        }));
        recentMessages.push({ sender: 'Other', text: messageText });

        const result = await aiApi.detectUrgency(recentMessages);
        setMessageUrgency((prev) => ({
          ...prev,
          [String(chatId)]: {
            urgency: result.urgency,
            confidence: result.confidence,
            reason: result.reason,
          },
        }));
        return result;
      } catch {
        return { urgency: 'normal', confidence: 0.5, reason: '' };
      }
    },
    [messagesByChat, user]
  );

  // Decrypt a 🔐 shared-key file attachment. Password comes from the per-message
  // unlock (then-and-there key entry) or the chat session cache.
  const decryptSecureFile = useCallback(
    async (chatId, file, password) => {
      const cid = String(chatId || '');
      const pw =
        (password && String(password)) ||
        securePassCacheRef.current.get(cid) ||
        getSecureKey(user && user.id) ||
        '';
      if (!pw) throw new Error('Enter the key to decrypt this file');
      const buffer = await filesApi.download(file.fileId);
      if (!buffer || buffer.byteLength === 0) throw new Error('Downloaded file is empty');
      const u8 = new Uint8Array(buffer);
      // base64 in chunks to avoid stack overflow on large files
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < u8.length; i += chunk) {
        binary += String.fromCharCode(...u8.subarray(i, i + chunk));
      }
      const ctB64 = btoa(binary);
      let plain;
      try {
        plain = await decryptBytesWithPassword({ salt: file.fs, iv: file.fv, ciphertext: ctB64 }, pw);
      } catch {
        throw new Error('Wrong key — could not decrypt this file');
      }
      let name = file.name || 'attachment';
      if (file.nmSalt && file.nmIv && file.nmCt) {
        try {
          name = await decryptTextWithPassword(
            { salt: file.nmSalt, iv: file.nmIv, ciphertext: file.nmCt },
            pw
          );
        } catch {
          // keep fallback name
        }
      }
      if (cid) securePassCacheRef.current.set(cid, pw);
      return { plain, name };
    },
    [user]
  );

  const value = useMemo(
    () => ({
      chats,
      activeChatId,
      messagesByChat,
      typingByChat,
      loadingChats,
      unreadTotal,
      messageUrgency,
      onlineIds: null,
      modeByChat,
      getChatMode,
      setChatMode,
      openChat,
      sendText,
      sendFile,
      deleteMessage,
      deleteMessageLocal,
      clearChatHistory,
      editMessage,
      createDirect,
      createGroup,
      addMember,
      removeMemberAndRotate,
      leaveChat,
      rotateGroupKeyManually,
      notifyTyping,
      decryptPreview,
      refreshChats,
      loadMessages,
      getPublicKeyFor,
      searchMessages,
      addReaction,
      removeReaction,
      detectMessageUrgency,
      markViewOnce,
      unlockSecureMessage,
      getChatPasscode,
      decryptSecureFile,
      pinMessage,
      unpinMessage,
      createPoll,
      votePoll,
      forwardMessage,
      logMissedCall,
      logMissedCallForPeer,
    }),
    [
      chats, activeChatId, messagesByChat, typingByChat, loadingChats, unreadTotal, messageUrgency, modeByChat,
      getChatMode, setChatMode,
      openChat, sendText, sendFile, deleteMessage, deleteMessageLocal, clearChatHistory, editMessage, createDirect, createGroup,
      addMember, removeMemberAndRotate, leaveChat, rotateGroupKeyManually, notifyTyping, decryptPreview, refreshChats, loadMessages, getPublicKeyFor, searchMessages, addReaction, removeReaction, detectMessageUrgency, markViewOnce,
      unlockSecureMessage, getChatPasscode, decryptSecureFile,
      pinMessage, unpinMessage, createPoll, votePoll, forwardMessage, logMissedCall, logMissedCallForPeer,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function useChat() {
  return useContext(ChatContext);
}
