const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const Session = require('../models/Session');

const signAccess = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });

const verifyAccessToken = (token) =>
  jwt.verify(token, config.jwt.accessSecret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });

function refreshCookieName() {
  return 'sc_rt';
}

function refreshCookieOptions() {
  const maxAge = config.jwt.refreshDays * 24 * 60 * 60 * 1000;
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge,
  };
}

async function issueRefreshToken(user, req) {
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + config.jwt.refreshDays * 24 * 60 * 60 * 1000);
  await Session.create({
    user: user._id,
    jti,
    ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 400),
    deviceLabel: parseDeviceLabel(req.headers['user-agent']),
    expiresAt,
  });
  return jwt.sign({ sub: String(user._id), jti }, config.jwt.refreshSecret, {
    expiresIn: `${config.jwt.refreshDays}d`,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

async function rotateRefreshToken(token, req) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.refreshSecret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch {
    return { error: 'invalid' };
  }

  const session = await Session.findOne({ jti: payload.jti });
  if (!session) return { error: 'invalid' };

  if (session.revokedAt) {
    await revokeAllForUser(session.user);
    require('./audit.service').audit('auth.refresh.reuse_detected', {
      actorId: session.user,
      severity: 'critical',
      req,
    });
    return { error: 'reuse' };
  }

  session.revokedAt = new Date();
  await session.save();

  const user = await require('../models/User').findById(session.user);
  if (!user || user.isBanned) return { error: 'invalid' };

  const newToken = await issueRefreshToken(user, req);
  const newPayload = jwt.decode(newToken);
  session.replacedBy = newPayload.jti;
  await session.save();

  return { user, token: newToken };
}

async function revokeByToken(token) {
  try {
    const payload = jwt.verify(token, config.jwt.refreshSecret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
    await Session.updateOne({ jti: payload.jti }, { $set: { revokedAt: new Date() } });
    return payload;
  } catch {
    return null;
  }
}

async function revokeAllForUser(userId) {
  await Session.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

function parseDeviceLabel(ua) {
  if (!ua) return 'Unknown device';
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : /Mac OS X/i.test(ua) ? 'macOS'
    : /Linux/i.test(ua) ? 'Linux' : 'Unknown OS';
  const browser = /Edg\//i.test(ua) ? 'Edge' : /Chrome\//i.test(ua) ? 'Chrome'
    : /Firefox\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}

module.exports = {
  signAccess,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeByToken,
  revokeAllForUser,
  refreshCookieName,
  refreshCookieOptions,
};
