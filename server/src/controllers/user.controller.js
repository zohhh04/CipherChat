const User = require('../models/User');
const Session = require('../models/Session');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const File = require('../models/File');
const Group = require('../models/Group');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { revokeAllForUser } = require('../services/token.service');
const { audit } = require('../services/audit.service');

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

const deleteMe = catchAsync(async (req, res) => {
  const userId = req.user._id;

  // Revoke all sessions
  await revokeAllForUser(userId);

  // Remove user from all chats
  const userChats = await Chat.find({ 'members.user': userId });
  for (const chat of userChats) {
    chat.members = chat.members.filter((m) => String(m.user._id || m.user) !== String(userId));
    chat.keyWraps.delete(String(userId));
    if (chat.members.length === 0) {
      await Chat.deleteOne({ _id: chat._id });
      if (chat.groupInfo) await Group.deleteOne({ _id: chat.groupInfo });
    } else {
      chat.lastActivity = new Date();
      await chat.save();
    }
  }

  // Wipe all messages sent by user
  await Message.updateMany(
    { sender: userId },
    { $set: { iv: '', ciphertext: '', file: null, deletedAt: new Date() } }
  );

  // Delete notifications
  await Notification.deleteMany({ $or: [{ user: userId }, { actor: userId }] });

  // Delete the user
  await User.deleteOne({ _id: userId });

  audit('auth.account.deleted', { actorId: userId, severity: 'critical', req });

  res.clearCookie(require('../services/token.service').refreshCookieName(), { path: '/api/auth' });
  res.json({ ok: true, message: 'Account deleted' });
});

module.exports = { me, keysOf, search, updateMe, changePassword, saveKeys, getBackup, mySessions, revokeSession, deleteMe };
