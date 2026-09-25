const Chat = require('../models/Chat');
const Group = require('../models/Group');
const Message = require('../models/Message');
const User = require('../models/User');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { CHAT_TYPES, NOTIFICATION_TYPES } = require('../utils/constants');
const { audit } = require('../services/audit.service');

const MEMBER_POPULATE = 'username about theme avatar';

function emitTo(req, event, payload) {
  const io = req.app.get('io');
  if (io) io.to(`chat:${payload.chatId}`).emit(event, payload);
}

const listMyChats = catchAsync(async (req, res) => {
  const chats = await Chat.find({ 'members.user': req.user._id })
    .sort('-lastActivity')
    .populate('members.user', MEMBER_POPULATE)
    .populate('lastMessage', 'sender type mode text createdAt iv ciphertext deletedAt')
    .populate('groupInfo', 'name description avatar');

  const data = await Promise.all(
    chats.map(async (c) => {
      const unread = await Message.countDocuments({
        chat: c._id,
        sender: { $ne: req.user._id },
        readBy: { $ne: req.user._id },
        deletedAt: null,
      });
      return {
        id: c._id,
        type: c.type,
        members: c.members.map((m) => ({
          id: m.user._id,
          username: m.user.username,
          about: m.user.about,
          avatar: m.user.avatar || '',
          isAdmin: m.isAdmin,
          joinedAt: m.joinedAt,
        })),
        groupInfo: c.groupInfo
          ? { name: c.groupInfo.name, description: c.groupInfo.description }
          : null,
        lastMessage: c.lastMessage
          ? {
              id: c.lastMessage._id,
              sender: c.lastMessage.sender,
              type: c.lastMessage.type,
              mode: c.lastMessage.mode === 'normal' ? 'normal' : 'encrypted',
              text: c.lastMessage.mode === 'normal' ? (c.lastMessage.text || '') : '',
              iv: c.lastMessage.iv,
              ciphertext: c.lastMessage.ciphertext,
              deletedAt: c.lastMessage.deletedAt,
              createdAt: c.lastMessage.createdAt,
            }
          : null,
        keyWraps: Object.fromEntries(c.keyWraps || []),
        createdBy: c.createdBy,
        lastActivity: c.lastActivity,
        createdAt: c.createdAt,
        unreadCount: unread,
      };
    })
  );

  res.json({ ok: true, data: { chats: data } });
});

const createDirect = catchAsync(async (req, res) => {
  const { memberId } = req.body;
  if (String(memberId) === String(req.user._id)) {
    throw ApiError.badRequest('Cannot open a chat with yourself', 'self_chat');
  }

  const directKey = Chat.directKeyFor(req.user._id, memberId);
  const existing = await Chat.findOne({ directKey }).populate('members.user', MEMBER_POPULATE);
  if (existing) return res.json({ ok: true, data: { chatId: existing._id, created: false } });

  const peer = await User.findById(memberId);
  if (!peer || peer.isBanned) throw ApiError.notFound('User not found', 'user_not_found');

  let wraps = {};
  for (const uid of [req.user._id, memberId]) {
    if (req.body.keyWraps && req.body.keyWraps[String(uid)]) {
      wraps[String(uid)] = req.body.keyWraps[String(uid)];
    }
  }

  const chat = await Chat.create({
    type: CHAT_TYPES.DIRECT,
    directKey,
    members: [
      { user: req.user._id, isAdmin: true },
      { user: memberId, addedBy: req.user._id },
    ],
    createdBy: req.user._id,
    keyWraps: wraps,
  });

  res.status(201).json({ ok: true, data: { chatId: chat._id, created: true } });
});

const createGroup = catchAsync(async (req, res) => {
  const { name, description, memberIds, keyWraps } = req.body;
  const uniqueIds = [...new Set(memberIds.map(String).concat(String(req.user._id)))];

  const users = await User.find({ _id: { $in: uniqueIds }, isBanned: false });
  if (users.length !== uniqueIds.length) throw ApiError.badRequest('One or more members not found', 'member_not_found');

  const group = await Group.create({ name, description: description || '' });

  const chat = await Chat.create({
    type: CHAT_TYPES.GROUP,
    groupInfo: group._id,
    createdBy: req.user._id,
    members: uniqueIds.map((uid) => ({
      user: uid,
      isAdmin: String(uid) === String(req.user._id),
      addedBy: req.user._id,
    })),
    keyWraps: keyWraps || {},
  });

  group.chat = chat._id;
  await group.save();

  audit('group.created', { actorId: req.user._id, req, meta: { chatId: String(chat._id), name } });

  const io = req.app.get('io');
  const notifRecipients = uniqueIds.filter((uid) => uid !== String(req.user._id));
  const notifications = notifRecipients.map((uid) => ({
    user: uid,
    actor: req.user._id,
    type: NOTIFICATION_TYPES.GROUP,
    chat: chat._id,
  }));
  await Notification.insertMany(notifications, { ordered: false }).catch(() => {});
  if (io) {
    for (const uid of notifRecipients) {
      io.to(`user:${uid}`).emit('notification:new', { chatId: String(chat._id), type: 'group' });
    }
  }

  res.status(201).json({ ok: true, data: { chatId: chat._id } });
});

const getChat = catchAsync(async (req, res) => {
  const chat = await Chat.findById(req.params.id)
    .populate('members.user', MEMBER_POPULATE)
    .populate('groupInfo', 'name description avatar');

  if (!chat) throw ApiError.notFound('Chat not found', 'chat_not_found');
  if (!chat.isMember(req.user._id)) throw ApiError.forbidden('Not a member of this chat', 'not_member');

  res.json({
    ok: true,
    data: {
      id: chat._id,
      type: chat.type,
      members: chat.members.map((m) => ({
        id: m.user._id,
        username: m.user.username,
        about: m.user.about,
        avatar: m.user.avatar || '',
        isAdmin: m.isAdmin,
      })),
      groupInfo: chat.groupInfo,
      keyWraps: Object.fromEntries(chat.keyWraps || []),
      createdBy: chat.createdBy,
      createdAt: chat.createdAt,
    },
  });
});

const updateGroup = catchAsync(async (req, res) => {
  const chat = await assertAdmin(req);
  if (!chat.groupInfo) throw ApiError.badRequest('Not a group chat', 'not_group');

  const updates = {};
  for (const k of ['name', 'description']) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  await Group.updateOne({ _id: chat.groupInfo }, { $set: updates });
  emitTo(req, 'chat:updated', { chatId: String(chat._id) });

  res.json({ ok: true });
});

const addMembers = catchAsync(async (req, res) => {
  const chat = await assertAdmin(req);

  const newIds = [...new Set(req.body.memberIds.map(String))].filter(
    (id) => !chat.isMember(id)
  );
  const users = await User.find({ _id: { $in: newIds }, isBanned: false });
  if (users.length !== newIds.length) throw ApiError.badRequest('One or more users not found', 'member_not_found');

  for (const uid of newIds) {
    chat.members.push({ user: uid, addedBy: req.user._id });
  }

  for (const [uid, wrap] of Object.entries(req.body.keyWraps || {})) {
    if (chat.isMember(uid)) chat.keyWraps.set(uid, wrap);
  }

  chat.lastActivity = new Date();
  await chat.save();

  emitTo(req, 'chat:updated', { chatId: String(chat._id) });
  const io = req.app.get('io');
  if (io) {
    for (const uid of newIds) io.to(`user:${uid}`).emit('chat:new', { chatId: String(chat._id) });
  }

  const addedNotifs = newIds.filter((uid) => uid !== String(req.user._id)).map((uid) => ({
    user: uid,
    actor: req.user._id,
    type: NOTIFICATION_TYPES.GROUP,
    chat: chat._id,
  }));
  await Notification.insertMany(addedNotifs, { ordered: false }).catch(() => {});

  res.json({ ok: true });
});

const removeMember = catchAsync(async (req, res) => {
  const chat = await assertAdmin(req);
  const targetId = req.params.userId;

  if (!chat.isMember(targetId)) throw ApiError.badRequest('User is not a member', 'not_member');
  if (String(targetId) === String(req.user._id)) {
    throw ApiError.badRequest('Use leave endpoint to leave the chat', 'use_leave');
  }

  applyRemoval(chat, targetId);
  chat.lastActivity = new Date();
  await chat.save();

  notifyRotationRequired(req, chat, targetId);
  emitTo(req, 'chat:updated', { chatId: String(chat._id) });

  if (String(targetId) !== String(req.user._id)) {
    await Notification.create({
      user: targetId,
      actor: req.user._id,
      type: NOTIFICATION_TYPES.GROUP,
      chat: chat._id,
    }).catch(() => {});
    const io = req.app.get('io');
    if (io) io.to(`user:${targetId}`).emit('notification:new', { chatId: String(chat._id), type: 'group' });
  }

  res.json({ ok: true, rotationRequired: true });
});

const leaveChat = catchAsync(async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat) throw ApiError.notFound('Chat not found', 'chat_not_found');
  if (!chat.isMember(req.user._id)) throw ApiError.forbidden('Not a member', 'not_member');

  if (chat.type === CHAT_TYPES.DIRECT) {
    throw ApiError.badRequest('Direct chats cannot be left', 'direct_chat');
  }

  applyRemoval(chat, req.user._id);
  chat.lastActivity = new Date();
  await chat.save();

  notifyRotationRequired(req, chat, req.user._id);
  emitTo(req, 'chat:updated', { chatId: String(chat._id) });

  res.json({ ok: true, rotationRequired: true });
});

const rotateKeys = catchAsync(async (req, res) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat) throw ApiError.notFound('Chat not found', 'chat_not_found');
  if (!chat.isMember(req.user._id)) throw ApiError.forbidden('Not a member', 'not_member');
  if (chat.memberRole(req.user._id) !== 'admin') throw ApiError.forbidden('Admin required', 'admin_required');

  const memberIds = chat.members.map((m) => String(m.user));
  const provided = new Set(Object.keys(req.body.keyWraps));

  for (const uid of memberIds) {
    if (!provided.has(uid)) {
      throw ApiError.badRequest(`Missing key wrap for member ${uid}`, 'incomplete_wraps');
    }
  }
  if (req.body.removedUserId && provided.has(String(req.body.removedUserId))) {
    throw ApiError.badRequest('Removed member must not receive the new key', 'wrap_for_removed');
  }

  chat.keyWraps = new Map(Object.entries(req.body.keyWraps));
  chat.lastActivity = new Date();
  await chat.save();

  emitTo(req, 'chat:keyrotated', { chatId: String(chat._id) });
  res.json({ ok: true });
});

function applyRemoval(chat, userId) {
  chat.members = chat.members.filter((m) => String(m.user._id || m.user) !== String(userId));
  chat.keyWraps.delete(String(userId));
}

async function notifyRotationRequired(req, chat, removedUserId) {
  const io = req.app.get('io');
  if (io) io.to(`user:${removedUserId}`).emit('chat:removed', { chatId: String(chat._id) });
}

async function assertAdmin(req) {
  const chat = await Chat.findById(req.params.id);
  if (!chat) throw ApiError.notFound('Chat not found', 'chat_not_found');
  if (!chat.isMember(req.user._id)) throw ApiError.forbidden('Not a member', 'not_member');
  if (chat.memberRole(req.user._id) !== 'admin') throw ApiError.forbidden('Admin required', 'admin_required');
  return chat;
}

module.exports = { listMyChats, createDirect, createGroup, getChat, updateGroup, addMembers, removeMember, leaveChat, rotateKeys };
