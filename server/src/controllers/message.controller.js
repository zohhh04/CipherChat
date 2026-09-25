const fs = require('fs');
const path = require('path');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const File = require('../models/File');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { NOTIFICATION_TYPES } = require('../utils/constants');
const mongoose = require('mongoose');
const aiService = require('../services/ai.service');

async function getChatForUser(chatId, userId) {
  const chat = await Chat.findById(chatId);
  if (!chat) throw ApiError.notFound('Chat not found', 'chat_not_found');
  if (!chat.isMember(userId)) throw ApiError.forbidden('Not a member of this chat', 'not_member');
  return chat;
}

async function detectMessageUrgency(chatId, messageText, senderId) {
  try {
    const recentMessages = await Message.find({ chat: chatId, deletedAt: null })
      .sort('-_id')
      .limit(5)
      .select('sender type mode text createdAt')
      .lean();

    if (recentMessages.length < 2) return { urgency: 'normal', confidence: 0.5, reason: '' };

    const messagesForAnalysis = recentMessages.reverse().map((m) => {
      if (String(m.sender) === String(senderId) && m.type === 'text') {
        return { sender: 'Me', text: messageText };
      }
      return {
        sender: String(m.sender) === String(senderId) ? 'Me' : 'Other',
        text: (m.mode || 'encrypted') === 'normal' ? (m.text || `[${m.type}]`) : `[${m.type}]`,
      };
    });

    const result = await aiService.detectUrgency(messagesForAnalysis);
    return result;
  } catch {
    return { urgency: 'normal', confidence: 0.5, reason: '' };
  }
}

const send = catchAsync(async (req, res) => {
  const chat = await getChatForUser(req.params.id, req.user._id);

  const reqType = req.body.type || 'text';
  // One-time view is images-only. Silently coerce non-image types to false
  // so a crafted request can't make videos/docs view-once.
  const viewOnce = req.body.viewOnce === true && reqType === 'image';

  // 🟢 normal → store plaintext, never ciphertext | 🔐 encrypted → store ciphertext+iv, never plaintext
  // Polls + calls + system notices are always plaintext (normal) so every
  // member can read/vote without shared keys.
  let mode = req.body.mode === 'normal' ? 'normal' : 'encrypted';
  if (['poll', 'call', 'system'].includes(reqType)) mode = 'normal';
  const plainInput = String(req.body.text ?? req.body.message ?? '');
  const forwarded = req.body.forwarded === true;

  // Poll via generic send: { type:'poll', poll:{question, options} }
  let pollDoc = undefined;
  if (reqType === 'poll') {
    const q = String(req.body.poll?.question ?? plainInput).trim().slice(0, 300);
    const opts = Array.isArray(req.body.poll?.options) ? req.body.poll.options.map((o) => String(o).trim().slice(0, 120)).filter(Boolean) : [];
    if (!q || opts.length < 2 || opts.length > 10) {
      throw ApiError.badRequest('poll.question and 2-10 poll.options are required', 'poll_required');
    }
    pollDoc = { question: q, options: opts, votes: opts.map(() => []) };
  }

  // Call pseudo-message via generic send: { type:'call', callKind, callStatus }
  let callKind = '';
  let callStatus = '';
  let callText = plainInput;
  if (reqType === 'call') {
    callKind = req.body.callKind === 'video' ? 'video' : 'audio';
    callStatus = ['missed', 'ended', 'declined'].includes(req.body.callStatus) ? req.body.callStatus : 'missed';
    if (!callText.trim()) callText = formatMissedCallText(callKind, new Date());
  }

  let doc;
  if (mode === 'normal') {
    if (reqType === 'text' && !plainInput.trim() && !pollDoc && !callText.trim()) {
      throw ApiError.badRequest('text/message is required for normal messages', 'text_required');
    }
    doc = {
      chat: chat._id,
      sender: req.user._id,
      type: reqType,
      mode: 'normal',
      text: reqType === 'poll' ? (pollDoc.question || '').slice(0, 10000) : reqType === 'call' ? callText.slice(0, 500) : plainInput.slice(0, 10000),
      iv: '',
      ciphertext: '',
      file: req.body.fileId || null,
      replyTo: req.body.replyTo || null,
      viewOnce,
      forwarded,
      callKind,
      callStatus,
      ...(pollDoc ? { poll: pollDoc } : {}),
      deliveredTo: [req.user._id],
      readBy: [req.user._id],
    };
  } else {
    doc = {
      chat: chat._id,
      sender: req.user._id,
      type: reqType,
      mode: 'encrypted',
      text: '',
      iv: req.body.iv || '',
      ciphertext: req.body.ciphertext || '',
      file: req.body.fileId || null,
      replyTo: req.body.replyTo || null,
      viewOnce,
      forwarded,
      deliveredTo: [req.user._id],
      readBy: [req.user._id],
    };
  }

  const message = await Message.create(doc);

  chat.lastMessage = message._id;
  chat.lastActivity = new Date();
  await chat.save();

  const payload = {
    chatId: String(chat._id),
    message: {
      id: message._id,
      sender: String(req.user._id),
      type: message.type,
      mode: message.mode,
      text: message.mode === 'normal' ? message.text : '',
      iv: message.iv,
      ciphertext: message.ciphertext,
      fileId: message.file ? String(message.file) : null,
      replyTo: message.replyTo ? String(message.replyTo) : null,
      viewOnce: message.viewOnce === true,
      viewedAt: message.viewedAt || null,
      forwarded: message.forwarded === true,
      callKind: message.callKind || '',
      callStatus: message.callStatus || '',
      poll: message.type === 'poll' && message.poll ? serializePoll(message.poll) : null,
      createdAt: message.createdAt,
    },
  };

  const io = req.app.get('io');
  if (io) {
    const memberIds = chat.members.map((m) => String(m.user._id || m.user));
    for (const uid of memberIds) {
      io.to(`user:${uid}`).emit('message:new', {
        ...payload,
        toSelf: uid === String(req.user._id),
      });
    }
  }

  const recipientIds = chat.members.map((m) => String(m.user._id || m.user)).filter((id) => id !== String(req.user._id));

  const notifications = recipientIds.map((uid) => ({
    user: uid,
    actor: req.user._id,
    type: NOTIFICATION_TYPES.MESSAGE,
    chat: chat._id,
    message: message._id,
    urgency: 'normal',
    urgencyReason: '',
  }));
  Notification.insertMany(notifications, { ordered: false }).catch(() => {});
  if (io) {
    for (const uid of recipientIds) {
      io.to(`user:${uid}`).emit('notification:new', {
        chatId: String(chat._id),
        messageId: String(message._id),
        urgency: 'normal',
        urgencyReason: '',
      });
    }
  }

  if (req.body.type === 'text' && recipientIds.length > 0 && mode === 'normal') {
    detectMessageUrgency(chat._id, plainInput, req.user._id)
      .then((urgencyResult) => {
        if (urgencyResult.urgency !== 'normal') {
          Notification.updateMany(
            { chat: chat._id, message: message._id },
            { $set: { urgency: urgencyResult.urgency, urgencyReason: urgencyResult.reason } }
          ).catch(() => {});
          if (io) {
            for (const uid of recipientIds) {
              io.to(`user:${uid}`).emit('notification:new', {
                chatId: String(chat._id),
                messageId: String(message._id),
                urgency: urgencyResult.urgency,
                urgencyReason: urgencyResult.reason,
              });
            }
          }
        }
      })
      .catch(() => {});
  }

  res.status(201).json({ ok: true, data: { message: payload.message } });
});

const list = catchAsync(async (req, res) => {
  await getChatForUser(req.params.id, req.user._id);

  const filter = { chat: req.params.id };
  if (req.query.before && /^[a-f\d]{24}$/i.test(req.query.before)) {
    filter._id = { $lt: req.query.before };
  }

  const messages = await Message.find(filter)
    .sort('-_id')
    .limit(req.query.limit)
    .select('sender type mode text iv ciphertext file replyTo deliveredTo readBy viewOnce viewedAt viewedBy editedAt deletedAt createdAt forwarded callKind callStatus poll')
    .lean();

  res.json({
    ok: true,
    data: {
      messages: messages.reverse().map((m) => {
        // Never re-send ciphertext/file of an already-viewed one-time photo.
        const expired = m.viewOnce === true && !!m.viewedAt;
        const mode = m.mode === 'normal' ? 'normal' : 'encrypted';
        return {
          id: m._id,
          sender: m.sender,
          type: m.type,
          mode,
          text: mode === 'normal' && !expired ? (m.text || '') : '',
          iv: expired ? '' : m.iv,
          ciphertext: expired ? '' : m.ciphertext,
          fileId: expired || !m.file ? null : String(m.file),
          replyTo: m.replyTo ? String(m.replyTo) : null,
          viewOnce: m.viewOnce === true,
          viewedAt: m.viewedAt || null,
          viewedBy: (m.viewedBy || []).map(String),
          deliveredTo: (m.deliveredTo || []).map(String),
          readBy: (m.readBy || []).map(String),
          reactions: m.reactions || {},
          forwarded: m.forwarded === true,
          callKind: m.callKind || '',
          callStatus: m.callStatus || '',
          poll: m.type === 'poll' && m.poll ? serializePoll(m.poll) : null,
          editedAt: m.editedAt,
          deletedAt: m.deletedAt,
          createdAt: m.createdAt,
        };
      }),
      hasMore: messages.length === req.query.limit,
    },
  });
});

const markRead = catchAsync(async (req, res) => {
  const chat = await getChatForUser(req.params.id, req.user._id);
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((i) => /^[a-f\d]{24}$/i.test(i)).slice(0, 200) : [];

  await Message.updateMany(
    { _id: { $in: ids }, chat: chat._id, readBy: { $ne: req.user._id } },
    { $addToSet: { readBy: req.user._id, deliveredTo: req.user._id } }
  );

  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${String(chat._id)}`).emit('receipt:read', {
      chatId: String(chat._id),
      readerId: String(req.user._id),
      messageIds: ids,
    });
  }

  res.json({ ok: true });
});

const markDelivered = catchAsync(async (req, res) => {
  const chat = await getChatForUser(req.params.id, req.user._id);
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter((i) => /^[a-f\d]{24}$/i.test(i)).slice(0, 200) : [];

  await Message.updateMany(
    { _id: { $in: ids }, chat: chat._id, sender: { $ne: req.user._id }, deliveredTo: { $ne: req.user._id } },
    { $addToSet: { deliveredTo: req.user._id } }
  );

  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${String(chat._id)}`).emit('receipt:delivered', {
      chatId: String(chat._id),
      userId: String(req.user._id),
      messageIds: ids,
    });
  }

  res.json({ ok: true });
});

const deleteMessage = catchAsync(async (req, res) => {
  const message = await Message.findById(req.params.mid);
  if (!message) throw ApiError.notFound('Message not found', 'message_not_found');

  const isSender = String(message.sender) === String(req.user._id);
  if (!isSender) throw ApiError.forbidden('Only the sender can delete a message', 'not_owner');

  message.deletedAt = new Date();
  message.iv = '';
  message.ciphertext = '';
  message.text = '';
  message.file = null;
  await message.save();

  // Unpin if the pinned message was deleted so the banner doesn't point at a tombstone.
  try {
    const chatDoc = await Chat.findById(message.chat).select('pinnedMessage');
    if (chatDoc && String(chatDoc.pinnedMessage || '') === String(message._id)) {
      chatDoc.pinnedMessage = null;
      await chatDoc.save();
    }
  } catch {
    // non-fatal
  }

  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${String(message.chat)}`).emit('message:deleted', {
      chatId: String(message.chat),
      messageId: String(message._id),
    });
  }

  res.json({ ok: true });
});

// Delete ALL chat history in one go (member-only). Soft-deletes every
// non-deleted message so history disappears for everyone in the chat.
const clearHistory = catchAsync(async (req, res) => {
  const chat = await getChatForUser(req.params.id, req.user._id);

  const result = await Message.updateMany(
    { chat: chat._id, deletedAt: null },
    { $set: { deletedAt: new Date(), text: '', iv: '', ciphertext: '', file: null } }
  );

  const remaining = await Message.findOne({ chat: chat._id, deletedAt: null })
    .sort('-_id')
    .select('_id');
  chat.lastMessage = remaining ? remaining._id : null;
  chat.pinnedMessage = null;
  chat.lastActivity = new Date();
  await chat.save();

  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${String(chat._id)}`).emit('chat:cleared', {
      chatId: String(chat._id),
      clearedBy: String(req.user._id),
    });
    io.to(`chat:${String(chat._id)}`).emit('chat:pinned', {
      chatId: String(chat._id),
      pinnedMessage: null,
      pinnedBy: String(req.user._id),
    });
  }

  res.json({ ok: true, data: { cleared: result.modifiedCount || 0 } });
});

const editMessage = catchAsync(async (req, res) => {
  const { mid } = req.params;

  const message = await Message.findById(mid);
  if (!message) throw ApiError.notFound('Message not found', 'message_not_found');

  const isSender = String(message.sender) === String(req.user._id);
  if (!isSender) throw ApiError.forbidden('Only the sender can edit a message', 'not_owner');

  if (message.deletedAt) throw ApiError.badRequest('Cannot edit a deleted message', 'message_deleted');
  if (['poll', 'call', 'system'].includes(message.type)) {
    throw ApiError.badRequest('This message type cannot be edited', 'not_editable');
  }

  // Text-only editing; mode never changes on edit.
  if ((message.mode || 'encrypted') === 'normal') {
    const plain = String(req.body.text ?? req.body.message ?? '');
    if (!plain.trim()) throw ApiError.badRequest('text/message is required', 'text_required');
    message.text = plain.slice(0, 10000);
  } else {
    if (!req.body.iv || !req.body.ciphertext) {
      throw ApiError.badRequest('iv/ciphertext required for encrypted edit', 'payload_required');
    }
    message.iv = req.body.iv;
    message.ciphertext = req.body.ciphertext;
  }
  message.editedAt = new Date();
  await message.save();

  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${String(message.chat)}`).emit('message:edited', {
      chatId: String(message.chat),
      messageId: String(message._id),
      mode: message.mode,
      text: message.mode === 'normal' ? message.text : '',
      iv: message.iv,
      ciphertext: message.ciphertext,
      editedAt: message.editedAt,
    });
  }

  res.json({ ok: true });
});

const addReaction = catchAsync(async (req, res) => {
  const { mid } = req.params;
  const { emoji } = req.body;

  const message = await Message.findById(mid);
  if (!message) throw ApiError.notFound('Message not found', 'message_not_found');
  if (message.deletedAt) throw ApiError.badRequest('Cannot react to deleted message', 'message_deleted');

  const reactions = message.reactions || new Map();
  const users = reactions.get(emoji) || [];
  const uid = String(req.user._id);

  if (!users.map(String).includes(uid)) {
    users.push(req.user._id);
    reactions.set(emoji, users);
    message.reactions = reactions;
    await message.save();
  }

  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${String(message.chat)}`).emit('message:reaction', {
      chatId: String(message.chat),
      messageId: String(message._id),
      emoji,
      userId: uid,
      action: 'add',
    });
  }

  res.json({ ok: true });
});

const removeReaction = catchAsync(async (req, res) => {
  const { mid, emoji } = req.params;

  const message = await Message.findById(mid);
  if (!message) throw ApiError.notFound('Message not found', 'message_not_found');

  const reactions = message.reactions || new Map();
  const users = (reactions.get(emoji) || []).map(String);
  const uid = String(req.user._id);
  const idx = users.indexOf(uid);

  if (idx !== -1) {
    users.splice(idx, 1);
    if (users.length === 0) {
      reactions.delete(emoji);
    } else {
      reactions.set(emoji, users.map((id) => new mongoose.Types.ObjectId(id)));
    }
    message.reactions = reactions;
    await message.save();
  }

  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${String(message.chat)}`).emit('message:reaction', {
      chatId: String(message.chat),
      messageId: String(message._id),
      emoji,
      userId: uid,
      action: 'remove',
    });
  }

  res.json({ ok: true });
});

// One-time view: receiver confirms they opened the photo. Server wipes the
// ciphertext + file bytes so it can never be fetched again (even with history).
const markViewed = catchAsync(async (req, res) => {
  const message = await Message.findById(req.params.mid);
  if (!message) throw ApiError.notFound('Message not found', 'message_not_found');

  const chat = await getChatForUser(req.params.id, req.user._id);
  if (String(message.chat) !== String(chat._id)) {
    throw ApiError.badRequest('Message does not belong to this chat', 'chat_mismatch');
  }
  if (message.deletedAt) throw ApiError.badRequest('Message was deleted', 'message_deleted');
  if (message.viewOnce !== true) throw ApiError.badRequest('Not a view-once message', 'not_view_once');
  // Sender previewing their own photo must not burn it.
  if (String(message.sender) === String(req.user._id)) {
    return res.json({ ok: true, data: { alreadyViewed: !!message.viewedAt } });
  }
  if (message.viewedAt) {
    return res.json({ ok: true, data: { alreadyViewed: true } });
  }

  message.viewedAt = new Date();
  message.viewedBy = [req.user._id];
  // Wipe encrypted payload so re-fetch / history can't restore the image.
  const fileId = message.file ? String(message.file) : null;
  message.iv = '';
  message.ciphertext = '';
  message.text = '';
  message.file = null;
  await message.save();

  // Best-effort: delete the encrypted file bytes from disk + DB.
  if (fileId && /^[a-f\d]{24}$/i.test(fileId)) {
    try {
      const f = await File.findById(fileId);
      if (f) {
        const abs = path.join(require('../middleware/upload.middleware').uploadDir, f.storagePath);
        fs.promises.unlink(abs).catch(() => {});
        await File.deleteOne({ _id: f._id });
      }
    } catch {
      // non-fatal: message is already wiped above
    }
  }

  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${String(chat._id)}`).emit('message:viewed', {
      chatId: String(chat._id),
      messageId: String(message._id),
      viewerId: String(req.user._id),
      viewedAt: message.viewedAt,
    });
  }

  res.json({ ok: true, data: { alreadyViewed: false } });
});

function formatMissedCallText(kind, date) {
  const d = date instanceof Date ? date : new Date(date);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const label = kind === 'video' ? 'video' : 'voice';
  return `Missed ${label} call at ${h}:${m} ${ampm}`;
}

function serializePoll(poll) {
  if (!poll) return null;
  const options = Array.isArray(poll.options) ? poll.options.map(String) : [];
  const votes = Array.isArray(poll.votes) ? poll.votes : options.map(() => []);
  return {
    question: String(poll.question || ''),
    options,
    votes: options.map((_, i) => (Array.isArray(votes[i]) ? votes[i].map(String) : [])),
  };
}

function emitPollUpdated(req, chatId, message) {
  const io = req.app.get('io');
  if (!io) return;
  io.to(`chat:${String(chatId)}`).emit('message:poll_updated', {
    chatId: String(chatId),
    messageId: String(message._id),
    poll: serializePoll(message.poll),
  });
}

// Polls are plaintext group-friendly messages: question + 2-10 options, one vote per user.
const createPoll = catchAsync(async (req, res) => {
  const chat = await getChatForUser(req.params.id, req.user._id);
  const question = String(req.body.question || '').trim().slice(0, 300);
  const options = Array.isArray(req.body.options)
    ? [...new Set(req.body.options.map((o) => String(o).trim()).filter(Boolean))].slice(0, 10)
    : [];
  if (!question || options.length < 2) {
    throw ApiError.badRequest('question and at least 2 unique options are required', 'poll_required');
  }

  const message = await Message.create({
    chat: chat._id,
    sender: req.user._id,
    type: 'poll',
    mode: 'normal',
    text: question,
    poll: { question, options, votes: options.map(() => []) },
    deliveredTo: [req.user._id],
    readBy: [req.user._id],
  });

  chat.lastMessage = message._id;
  chat.lastActivity = new Date();
  await chat.save();

  const io = req.app.get('io');
  const payload = {
    chatId: String(chat._id),
    message: {
      id: message._id,
      sender: String(req.user._id),
      type: 'poll',
      mode: 'normal',
      text: question,
      poll: serializePoll(message.poll),
      forwarded: false,
      createdAt: message.createdAt,
    },
  };
  if (io) {
    for (const m of chat.members) {
      const uid = String(m.user._id || m.user);
      io.to(`user:${uid}`).emit('message:new', { ...payload, toSelf: uid === String(req.user._id) });
    }
  }

  res.status(201).json({ ok: true, data: { message: payload.message } });
});

// One vote per user — voting moves the voter's id to the chosen option.
const votePoll = catchAsync(async (req, res) => {
  const chat = await getChatForUser(req.params.id, req.user._id);
  const message = await Message.findById(req.params.mid);
  if (!message) throw ApiError.notFound('Message not found', 'message_not_found');
  if (String(message.chat) !== String(chat._id)) {
    throw ApiError.badRequest('Message does not belong to this chat', 'chat_mismatch');
  }
  if (message.type !== 'poll' || !message.poll) throw ApiError.badRequest('Not a poll message', 'not_poll');
  if (message.deletedAt) throw ApiError.badRequest('Poll was deleted', 'message_deleted');

  const idx = Number(req.body.optionIndex);
  const optCount = (message.poll.options || []).length;
  if (!Number.isInteger(idx) || idx < 0 || idx >= optCount) {
    throw ApiError.badRequest('Invalid optionIndex', 'invalid_option');
  }

  const uid = String(req.user._id);
  const votes = (message.poll.options || []).map((_, i) => {
    const arr = Array.isArray(message.poll.votes?.[i]) ? message.poll.votes[i].map(String) : [];
    return arr.filter((id) => id !== uid);
  });
  votes[idx].push(req.user._id);
  message.poll.votes = votes;
  message.markModified('poll');
  await message.save();

  emitPollUpdated(req, chat._id, message);

  res.json({ ok: true, data: { poll: serializePoll(message.poll) } });
});

// Missed-call history entry inside the chat: "Missed voice call at 3:42 PM".
const logMissedCall = catchAsync(async (req, res) => {
  const chat = await getChatForUser(req.params.id, req.user._id);
  const kind = req.body.mediaType === 'video' ? 'video' : 'audio';
  const now = new Date();

  const message = await Message.create({
    chat: chat._id,
    sender: req.user._id,
    type: 'call',
    mode: 'normal',
    text: formatMissedCallText(kind, now),
    callKind: kind,
    callStatus: 'missed',
    deliveredTo: [req.user._id],
    readBy: [req.user._id],
  });

  chat.lastMessage = message._id;
  chat.lastActivity = now;
  await chat.save();

  const io = req.app.get('io');
  const payload = {
    chatId: String(chat._id),
    message: {
      id: message._id,
      sender: String(req.user._id),
      type: 'call',
      mode: 'normal',
      text: message.text,
      callKind: kind,
      callStatus: 'missed',
      forwarded: false,
      createdAt: message.createdAt,
    },
  };
  if (io) {
    for (const m of chat.members) {
      const uid = String(m.user._id || m.user);
      io.to(`user:${uid}`).emit('message:new', { ...payload, toSelf: uid === String(req.user._id) });
    }
  }

  res.status(201).json({ ok: true, data: { message: payload.message } });
});

module.exports = { send, list, markRead, markDelivered, deleteMessage, clearHistory, editMessage, addReaction, removeReaction, markViewed, createPoll, votePoll, logMissedCall };
