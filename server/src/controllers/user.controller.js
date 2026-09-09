const User = require('../models/User');
const Session = require('../models/Session');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const Token = require('../models/Token');
const File = require('../models/File');
const AuditLog = require('../models/AuditLog');
const fs = require('fs');
const path = require('path');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { revokeAllForUser } = require('../services/token.service');
const { audit } = require('../services/audit.service');
const { NOTIFICATION_TYPES } = require('../utils/constants');

const me = catchAsync(async (req, res) => {
  const sessions = await Session.countDocuments({ user: req.user._id, revokedAt: null });
  res.json({ ok: true, data: { user: req.user.toMeJSON(), activeSessions: sessions } });
});

const keysOf = catchAsync(async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-f\d]{24}$/i.test(s))
    .slice(0, 200);

  if (ids.length === 0) throw ApiError.badRequest('ids query required', 'ids_required');

  const users = await User.find({ _id: { $in: ids } }).select('publicKey username');
  const map = {};
  for (const u of users) {
    if (u.publicKey) map[String(u._id)] = u.publicKey;
  }
  res.json({ ok: true, data: { publicKeys: map } });
});

const search = catchAsync(async (req, res) => {
  const q = req.query.q;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped.slice(0, 64), 'i');

  const users = await User.find({
    $or: [{ username: regex }, { email: regex }],
    isBanned: false,
  })
    .select('username about')
    .limit(15);

  res.json({ ok: true, data: { users } });
});

const updateMe = catchAsync(async (req, res) => {
  const updates = {};
  for (const k of ['about', 'theme']) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  await User.updateOne({ _id: req.user._id }, { $set: updates });
  const user = await User.findById(req.user._id);
  res.json({ ok: true, data: { user: user.toMeJSON() } });
});

const changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+passwordHash');

  const ok = await user.comparePassword(currentPassword);
  if (!ok) throw ApiError.unauthorized('Current password is incorrect', 'invalid_credentials');

  user.passwordHash = await User.hashPassword(newPassword);
  await user.save();
  await revokeAllForUser(user._id);
  audit('auth.password.changed', { actorId: user._id, severity: 'warn', req });

  await Notification.create({
    user: user._id,
    type: NOTIFICATION_TYPES.SYSTEM,
  }).catch(() => {});

  const io = req.app.get('io');
  if (io) io.to(`user:${String(user._id)}`).emit('notification:new', { type: 'system' });

  res.clearCookie(require('../services/token.service').refreshCookieName(), { path: '/api/auth' });
  res.json({ ok: true, message: 'Password changed - sign in again on all devices' });
});

const saveKeys = catchAsync(async (req, res) => {
  const { publicKey, backup } = req.body;
  req.user.publicKey = publicKey;
  req.user.keyBackup = backup;
  await req.user.save();
  res.json({ ok: true });
});

const getBackup = catchAsync(async (req, res) => {
  const kb = req.user.keyBackup || {};
  res.json({ ok: true, data: { publicKey: req.user.publicKey || '', backup: kb.blob ? kb : null } });
});

const mySessions = catchAsync(async (req, res) => {
  const sessions = await Session.find({ user: req.user._id, revokedAt: null })
    .select('jti ip userAgent deviceLabel createdAt lastUsedAt expiresAt')
    .sort('-lastUsedAt');
  res.json({
    ok: true,
    data: {
      sessions: sessions.map((s) => ({ id: s._id, jti: s.jti, deviceLabel: s.deviceLabel, ip: s.ip, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt })),
    },
  });
});

const revokeSession = catchAsync(async (req, res) => {
  const session = await Session.findOne({ _id: req.params.id, user: req.user._id });
  if (!session) throw ApiError.notFound('Session not found', 'session_not_found');

  session.revokedAt = new Date();
  await session.save();
  audit('auth.session.revoked', { actorId: req.user._id, req, meta: { sessionId: String(session._id) } });

  res.json({ ok: true });
});

const deleteAccount = catchAsync(async (req, res) => {
  const { password } = req.body;
  if (!password) throw ApiError.badRequest('Password is required', 'password_required');

  const user = await User.findById(req.user._id).select('+passwordHash');
  const ok = await user.comparePassword(password);
  if (!ok) throw ApiError.unauthorized('Incorrect password', 'invalid_credentials');

  const userId = String(user._id);

  const chats = await Chat.find({ 'members.user': user._id }).select('_id');
  const chatIds = chats.map((c) => c._id);

  if (chatIds.length > 0) {
    const messages = await Message.find({ chat: { $in: chatIds }, sender: user._id }).select('_id');
    const msgIds = messages.map((m) => m._id);

    await Message.updateMany(
      { chat: { $in: chatIds }, sender: user._id },
      { $set: { iv: '', ciphertext: '', deletedAt: new Date(), file: null } }
    );

    if (msgIds.length > 0) {
      const files = await File.find({ _id: { $in: (await Message.find({ _id: { $in: msgIds }, file: { $ne: null } }).select('file')).map((m) => m.file) } });
      for (const f of files) {
        const filePath = path.join(require('../middleware/upload.middleware').uploadDir, f.storagePath);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      await File.deleteMany({ _id: { $in: files.map((f) => f._id) } });
    }
  }

  for (const chat of chats) {
    chat.members = chat.members.filter((m) => String(m.user._id || m.user) !== userId);
    chat.keyWraps.delete(userId);
    if (chat.members.length === 0) {
      await Message.deleteMany({ chat: chat._id });
      await File.deleteMany({ chat: chat._id });
      await chat.deleteOne();
    } else {
      chat.lastActivity = new Date();
      await chat.save();
    }
  }

  await Notification.deleteMany({ $or: [{ user: user._id }, { actor: user._id }] });
  await Session.deleteMany({ user: user._id });
  await Token.deleteMany({ user: user._id });
  await AuditLog.deleteMany({ actor: user._id });

  await User.deleteOne({ _id: user._id });

  audit('auth.account.deleted', { actorId: user._id, email: user.email, severity: 'critical', req });

  res.clearCookie(require('../services/token.service').refreshCookieName(), { path: '/api/auth' });

  const io = req.app.get('io');
  if (io) {
    for (const chat of chats) {
      const memberIds = chat.members.map((m) => String(m.user._id || m.user));
      for (const uid of memberIds) {
        io.to(`user:${uid}`).emit('chat:updated', { chatId: String(chat._id) });
      }
    }
  }

  res.json({ ok: true, message: 'Account deleted permanently' });
});

module.exports = { me, keysOf, search, updateMe, changePassword, saveKeys, getBackup, mySessions, revokeSession, deleteAccount };
