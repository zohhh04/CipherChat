const Message = require('../models/Message');
const Chat = require('../models/Chat');
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
      .select('sender type ciphertext createdAt')
      .lean();

    if (recentMessages.length < 2) return { urgency: 'normal', confidence: 0.5, reason: '' };

    const messagesForAnalysis = recentMessages.reverse().map((m) => ({
      sender: String(m.sender) === String(senderId) ? 'Me' : 'Other',
      text: m.type === 'text' ? messageText : `[${m.type}]`,
    }));

    const result = await aiService.detectUrgency(messagesForAnalysis);
    return result;
  } catch {
    return { urgency: 'normal', confidence: 0.5, reason: '' };
  }
}

const send = catchAsync(async (req, res) => {
  const chat = await getChatForUser(req.params.id, req.user._id);

  const doc = {
    chat: chat._id,
    sender: req.user._id,
    type: req.body.type || 'text',
    iv: req.body.iv || '',
    ciphertext: req.body.ciphertext || '',
    file: req.body.fileId || null,
    replyTo: req.body.replyTo || null,
    deliveredTo: [req.user._id],
    readBy: [req.user._id],
  };

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
      iv: message.iv,
      ciphertext: message.ciphertext,
      fileId: message.file ? String(message.file) : null,
      replyTo: message.replyTo ? String(message.replyTo) : null,
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
  
  let urgencyResult = { urgency: 'normal', confidence: 0.5, reason: '' };
  if (req.body.type === 'text' && recipientIds.length > 0) {
    urgencyResult = await detectMessageUrgency(chat._id, req.body.ciphertext, req.user._id);
  }

  const notifications = recipientIds.map((uid) => ({
    user: uid,
    actor: req.user._id,
    type: NOTIFICATION_TYPES.MESSAGE,
    chat: chat._id,
    message: message._id,
    urgency: urgencyResult.urgency,
    urgencyReason: urgencyResult.reason,
  }));
  await Notification.insertMany(notifications, { ordered: false }).catch(() => {});
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
    .select('sender type iv ciphertext file replyTo deliveredTo readBy editedAt deletedAt createdAt')
    .lean();

  res.json({
    ok: true,
    data: {
      messages: messages.reverse().map((m) => ({
        id: m._id,
        sender: m.sender,
        type: m.type,
        iv: m.iv,
        ciphertext: m.ciphertext,
        fileId: m.file ? String(m.file) : null,
        replyTo: m.replyTo ? String(m.replyTo) : null,
        deliveredTo: (m.deliveredTo || []).map(String),
        readBy: (m.readBy || []).map(String),
        reactions: m.reactions || {},
        editedAt: m.editedAt,
        deletedAt: m.deletedAt,
        createdAt: m.createdAt,
      })),
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
  message.file = null;
  await message.save();

  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${String(message.chat)}`).emit('message:deleted', {
      chatId: String(message.chat),
      messageId: String(message._id),
    });
  }

  res.json({ ok: true });
});

const editMessage = catchAsync(async (req, res) => {
  const { mid } = req.params;
  const { iv, ciphertext } = req.body;

  const message = await Message.findById(mid);
  if (!message) throw ApiError.notFound('Message not found', 'message_not_found');

  const isSender = String(message.sender) === String(req.user._id);
  if (!isSender) throw ApiError.forbidden('Only the sender can edit a message', 'not_owner');

  if (message.deletedAt) throw ApiError.badRequest('Cannot edit a deleted message', 'message_deleted');

  message.iv = iv;
  message.ciphertext = ciphertext;
  message.editedAt = new Date();
  await message.save();

  const io = req.app.get('io');
  if (io) {
    io.to(`chat:${String(message.chat)}`).emit('message:edited', {
      chatId: String(message.chat),
      messageId: String(message._id),
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

module.exports = { send, list, markRead, markDelivered, deleteMessage, editMessage, addReaction, removeReaction };
