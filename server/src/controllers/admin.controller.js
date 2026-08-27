const User = require('../models/User');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const File = require('../models/File');
const Session = require('../models/Session');
const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { revokeAllForUser } = require('../services/token.service');
const { audit } = require('../services/audit.service');
const { AUDIT_ACTIONS } = require('../utils/constants');

const stats = catchAsync(async (req, res) => {
  const presence = req.app.get('presence');
  const [users, messages, chats, groups, files] = await Promise.all([
    User.countDocuments(),
    Message.countDocuments(),
    Chat.countDocuments(),
    Chat.countDocuments({ type: 'group' }),
    File.countDocuments(),
  ]);

  res.json({
    ok: true,
    data: {
      users,
      messages,
      chats,
      groups,
      files,
      onlineUsers: presence ? presence.onlineCount() : 0,
    },
  });
});

const listUsers = catchAsync(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
  const filter = {};

  if (req.query.q) {
    const escaped = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped.slice(0, 64), 'i');
    filter.$or = [{ username: regex }, { email: regex }];
  }

  const users = await User.find(filter)
    .sort('-createdAt')
    .skip((page - 1) * limit)
    .limit(limit)
    .select('username email role isVerified isBanned createdAt lastSeenAt');

  const total = await User.countDocuments(filter);
  res.json({ ok: true, data: { users, total, page } });
});

const setUserStatus = catchAsync(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound('User not found', 'user_not_found');
  if (String(target._id) === String(req.user._id)) {
    throw ApiError.badRequest('Cannot change your own status', 'self_action');
  }

  const banned = Boolean(req.body.banned);
  if (banned !== target.isBanned) {
    target.isBanned = banned;
    await target.save();
    if (banned) await revokeAllForUser(target._id);

    audit(banned ? AUDIT_ACTIONS.USER_BANNED : AUDIT_ACTIONS.USER_UNBANNED, {
      actorId: req.user._id,
      targetId: target._id,
      severity: 'warn',
      req,
    });

    const io = req.app.get('io');
    if (io && banned) io.to(`user:${target._id}`).emit('account:banned', {});
  }

  res.json({ ok: true, data: { id: target._id, isBanned: target.isBanned } });
});

const setUserRole = catchAsync(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw ApiError.notFound('User not found', 'user_not_found');

  const role = req.body.role === 'admin' ? 'admin' : 'user';
  if (String(target._id) === String(req.user._id) && role !== 'admin') {
    throw ApiError.badRequest('Cannot demote yourself', 'self_action');
  }

  target.role = role;
  await target.save();
  audit(AUDIT_ACTIONS.ROLE_CHANGED, {
    actorId: req.user._id,
    targetId: target._id,
    severity: 'warn',
    req,
    meta: { role },
  });

  res.json({ ok: true, data: { id: target._id, role: target.role } });
});

const listAuditLogs = catchAsync(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 30);
  const filter = {};
  if (req.query.action) filter.action = String(req.query.action).slice(0, 64);
  if (req.query.severity) filter.severity = String(req.query.severity).slice(0, 16);

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('actor', 'username')
      .populate('target', 'username')
      .select('action severity actor target email ip userAgent createdAt'),
    AuditLog.countDocuments(filter),
  ]);

  res.json({
    ok: true,
    data: {
      logs: logs.map((l) => ({
        id: l._id,
        action: l.action,
        severity: l.severity,
        actor: l.actor ? { id: l.actor._id, username: l.actor.username } : null,
        target: l.target ? { id: l.target._id, username: l.target.username } : null,
        email: l.email,
        ip: l.ip,
        userAgent: l.userAgent,
        createdAt: l.createdAt,
      })),
      total,
      page,
    },
  });
});

const listSessions = catchAsync(async (req, res) => {
  const sessions = await Session.find({ revokedAt: null })
    .sort('-lastUsedAt')
    .limit(200)
    .populate('user', 'username')
    .select('jti user ip deviceLabel lastUsedAt expiresAt');

  res.json({
    ok: true,
    data: {
      sessions: sessions.map((s) => ({
        id: s._id,
        jti: s.jti,
        userId: s.user ? s.user._id : null,
        username: s.user ? s.user.username : '(deleted)',
        ip: s.ip,
        deviceLabel: s.deviceLabel,
        lastUsedAt: s.lastUsedAt,
        expiresAt: s.expiresAt,
      })),
    },
  });
});

const revokeAnySession = catchAsync(async (req, res) => {
  const session = await Session.findById(req.params.id);
  if (!session || session.revokedAt) throw ApiError.notFound('Session not found', 'session_not_found');

  session.revokedAt = new Date();
  await session.save();

  audit(AUDIT_ACTIONS.SESSION_REVOKED, {
    actorId: req.user._id,
    targetId: session.user,
    severity: 'warn',
    req,
    meta: { sessionId: String(session._id), byAdmin: true },
  });

  res.json({ ok: true });
});

module.exports = { stats, listUsers, setUserStatus, setUserRole, listAuditLogs, listSessions, revokeAnySession };
