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
} from '../crypto/e2ee';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { user, identityReady } = useAuth();
  const { subscribe, emit } = useSocket();

  const [chats, setChats] = useState({});
  const [activeChatId, setActiveChatId] = useState(null);
  const [messagesByChat, setMessagesByChat] = useState({});
  const [typingByChat, setTypingByChat] = useState({});
  const [loadingChats, setLoadingChats] = useState(true);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [messageUrgency, setMessageUrgency] = useState({});

  const chatKeysRef = useRef(new Map());
  const pubKeysRef = useRef(new Map());
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

  const normalizeMessage = useCallback(
    async (chat, m) => {
      const content = m.deletedAt ? null : await decryptContent(chat, m.iv, m.ciphertext);
      const reactions = {};
      if (m.reactions && typeof m.reactions === 'object') {
        for (const [emoji, users] of Object.entries(m.reactions)) {
          reactions[emoji] = users.map(String);
        }
      }
      return {
        id: String(m.id),
        sender: String(m.sender),
        type: m.type,
        deletedAt: m.deletedAt || null,
        editedAt: m.editedAt || null,
        createdAt: m.createdAt,
        deliveredTo: (m.deliveredTo || []).map(String),
        readBy: (m.readBy || []).map(String),
        reactions,
        text: content && content.t === 'text' ? content.x : '',
        file:
          content && content.t === 'file'
            ? { fileId: content.f, key: content.k, iv: content.v, name: content.n, mime: content.m, size: content.s, duration: content.d }
            : null,
      };
    },
    [decryptContent]
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
    if (!identityReady) return;
    refreshChats().catch(() => setLoadingChats(false));
  }, [identityReady, refreshChats]);

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
    async (chatId, text, replyToId) => {
      const chat = chats[String(chatId)];
      if (!chat) throw new Error('Chat not loaded');
      const key = await ensureChatKey(chat);
      const payload = await encryptWithKey(key, JSON.stringify({ t: 'text', x: text }));
      const message = await messagesApi.send(chatId, {
        type: 'text',
        iv: payload.iv,
        ciphertext: payload.ciphertext,
        ...(replyToId ? { replyTo: replyToId } : {}),
      });
      const normalized = await normalizeMessage(chat, { ...message, sender: user.id, deliveredTo: [user.id], readBy: [user.id] });
      setMessagesByChat((prev) => ({ ...prev, [String(chatId)]: [...(prev[String(chatId)] || []), normalized] }));
      setChats((prev) => ({ ...prev, [String(chatId)]: { ...prev[String(chatId)], lastActivity: new Date().toISOString() } }));
      return normalized;
    },
    [chats, ensureChatKey, normalizeMessage, user]
  );

  const sendFile = useCallback(
    async (chatId, file, kind, durationSec, onProgress) => {
      const chat = chats[String(chatId)];
      if (!chat) throw new Error('Chat not loaded');

      const fileKey = await generateChatKey();
      const rawKey = await exportRawKeyB64(fileKey);

      const arrayBuf = await file.arrayBuffer();
      const plainBytes = new Uint8Array(arrayBuf);
      const payload = await encryptWithKey(fileKey, plainBytes);
      const namePayload = await encryptWithKey(fileKey, file.name || 'attachment');

      const encryptedBytes = fromB64(payload.ciphertext);
      const fileId = await filesApi.upload(
        chatId,
        encryptedBytes.buffer,
        namePayload.iv,
        namePayload.ciphertext,
        kind === 'audio' ? (file.type || 'audio/webm') : (file.type || ''),
        onProgress
      );

      const msgKey = await ensureChatKey(chat);
      const meta = {
        t: 'file',
        f: String(fileId),
        k: rawKey,
        v: payload.iv,
        n: file.name || 'attachment',
        m: kind === 'audio' ? (file.type || 'audio/webm') : (file.type || 'application/octet-stream'),
        s: file.size,
      };
      if (durationSec) meta.d = durationSec;

      const content = await encryptWithKey(msgKey, JSON.stringify(meta));

      const message = await messagesApi.send(chatId, {
        type: kind,
        iv: content.iv,
        ciphertext: content.ciphertext,
        fileId: String(fileId),
      });
      const normalized = await normalizeMessage(chat, { ...message, sender: user.id, deliveredTo: [user.id], readBy: [user.id] });
      setMessagesByChat((prev) => ({ ...prev, [String(chatId)]: [...(prev[String(chatId)] || []), normalized] }));
      return normalized;
    },
    [chats, ensureChatKey, normalizeMessage, user]
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

  const editMessage = useCallback(
    async (chatId, messageId, plaintext) => {
      const chat = chats[String(chatId)];
      if (!chat) throw new Error('Chat not loaded');
      const key = await ensureChatKey(chat);
      const payload = await encryptWithKey(key, JSON.stringify({ t: 'text', x: plaintext }));
      await messagesApi.edit(chatId, messageId, { iv: payload.iv, ciphertext: payload.ciphertext });
      setMessagesByChat((prev) => ({
        ...prev,
        [String(chatId)]: (prev[String(chatId)] || []).map((m) =>
          m.id === String(messageId) ? { ...m, text: plaintext, editedAt: new Date().toISOString() } : m
        ),
      }));
    },
    [chats, ensureChatKey]
  );

  const createDirect = useCallback(
    async (peerId) => {
      if (!identityReady) throw new Error('Encryption keys not ready. Please wait or re-login.');
      const existing = Object.values(chats).find(
        (c) => c.type === 'direct' && c.members.some((m) => String(m.id) === String(peerId))
      );
      if (existing) {
        await openChat(existing.id);
        return existing;
      }

      const [myKeyB64, peerPubB64] = await Promise.all([myPubKey(), getPublicKeyFor(peerId)]);
      const chatKey = await generateChatKey();
      const wraps = {};
      wraps[String(user.id)] = await wrapChatKeyFor(chatKey, myKeyB64, user.id, user.id);
      wraps[String(peerId)] = await wrapChatKeyFor(chatKey, peerPubB64, user.id, peerId);

      const { chatId } = await chatsApi.createDirect(peerId, wraps);
      chatKeysRef.current.set(String(chatId), chatKey);
      await refreshChats();
      await openChat(chatId);
      return chatId;
    },
    [identityReady, chats, user, getPublicKeyFor, refreshChats, openChat]
  );

  const createGroup = useCallback(
    async (name, memberIds, description) => {
      if (!identityReady) throw new Error('Encryption keys not ready. Please wait or re-login.');
      const allIds = [...new Set([String(user.id), ...memberIds.map(String)])];
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
      const wraps = {};
      for (const uid of allIds) wraps[uid] = await wrapChatKeyFor(chatKey, pubById[uid], user.id, uid);

      const { chatId } = await chatsApi.createGroup(name, memberIds, wraps, description);
      chatKeysRef.current.set(String(chatId), chatKey);
      await refreshChats();
      await openChat(chatId);
      return chatId;
    },
    [identityReady, user, getPublicKeyFor, refreshChats, openChat]
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

  const decryptPreview = useCallback(
    async (chat) => {
      const lm = chat && chat.lastMessage;
      if (!lm || lm.deletedAt) return null;
      try {
        const key = await ensureChatKey(chat);
        const raw = await decryptWithKey(key, { iv: lm.iv, ciphertext: lm.ciphertext });
        const content = JSON.parse(raw);
        if (content.t === 'text') return content.x.slice(0, 80);
        return `[${(content.t || 'file').toUpperCase()}] ${content.n || ''}`.slice(0, 80);
      } catch {
        return null;
      }
    },
    [ensureChatKey]
  );

  useEffect(() => {
    if (!user || !identityReady) return undefined;

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
            m.id === String(messageId) ? { ...m, deletedAt: new Date().toISOString(), text: '', file: null } : m
          ),
        }));
      })
    );

    offs.push(
      subscribe('message:edited', ({ chatId, messageId, iv, ciphertext, editedAt }) => {
        (async () => {
          const cid = String(chatId);
          const chat = chatsRef.current[cid];
          if (!chat) return;
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
  }, [user, identityReady, subscribe, refreshChats, normalizeMessage, loadMessages, decryptContent]);

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
      openChat,
      sendText,
      sendFile,
      deleteMessage,
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
    }),
    [
      chats, activeChatId, messagesByChat, typingByChat, loadingChats, unreadTotal, messageUrgency,
      openChat, sendText, sendFile, deleteMessage, editMessage, createDirect, createGroup,
      addMember, removeMemberAndRotate, leaveChat, rotateGroupKeyManually, notifyTyping, decryptPreview, refreshChats, loadMessages, getPublicKeyFor, searchMessages, addReaction, removeReaction, detectMessageUrgency,
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
