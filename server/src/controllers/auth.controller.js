const crypto = require('crypto');
const User = require('../models/User');
const Token = require('../models/Token');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { audit } = require('../services/audit.service');
const emailService = require('../services/email.service');
const config = require('../config');
const {
  signAccess,
  issueRefreshToken,
  rotateRefreshToken,
  revokeByToken,
  revokeAllForUser,
  refreshCookieName,
  refreshCookieOptions,
} = require('../services/token.service');
const { TOKEN_TYPES } = require('../utils/constants');

async function issueTokenPair(user, req, res) {
  const accessToken = signAccess(user);
  const refreshToken = await issueRefreshToken(user, req);
  res.cookie(refreshCookieName(), refreshToken, refreshCookieOptions());
  return accessToken;
}

const register = catchAsync(async (req, res) => {
  const { username, email, password } = req.body;

  const existing = await User.findOne({ $or: [{ email }, { username }] });
  if (existing) {
    throw ApiError.conflict(
      existing.email === email ? 'Email already registered' : 'Username already taken',
      'duplicate_account'
    );
  }

  const passwordHash = await User.hashPassword(password);
  const user = await User.create({ username, email, passwordHash });

  const rawToken = User.randomToken();
  await Token.create({
    user: user._id,
    type: TOKEN_TYPES.VERIFY,
    tokenHash: hash(rawToken),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
  });

  // Never fail registration just because the verification email could not be
  // delivered (SMTP down, bad credentials, spam filter, ...). Log it and —
  // outside production — hand the token back so the account can still be
  // verified from the client.
  const mail = emailService.verificationEmail(user, rawToken);
  let mailDelivered = false;
  try {
    const result = await emailService.sendMail({ to: user.email, ...mail });
    mailDelivered = !!(result && result.delivered);
  } catch (mailErr) {
    console.error('Failed to send verification email:', mailErr.message);
  }

  audit('auth.register', { actorId: user._id, email: user.email, req });

  res.status(201).json({
    ok: true,
    data: {
      id: user._id,
      username: user.username,
      email: user.email,
      verificationRequired: config.emailVerificationRequired,
      verificationEmailSent: mailDelivered,
      ...(devTokenEnabled() || (!mailDelivered && !config.isProd) ? { devVerifyToken: rawToken } : {}),
    },
  });
});

function devTokenEnabled() {
  return !config.isProd && !config.smtp.host;
}

const verifyEmail = catchAsync(async (req, res) => {
  const doc = await consumeToken(req.body.token, TOKEN_TYPES.VERIFY);
  if (!doc) throw ApiError.badRequest('Invalid or expired token', 'token_invalid');

  await User.updateOne({ _id: doc.user }, { $set: { isVerified: true } });
  audit('auth.email.verified', { actorId: doc.user, req });

  res.json({ ok: true, message: 'Email verified' });
});

const resendVerification = catchAsync(async (req, res) => {
  // Works two ways: signed-in user (Settings button, via optionalAuth) or an
  // { email } in the body (login page, where login is blocked until verified
  // so the user otherwise has no token to call this with). Always responds
  // generically so account existence is not leaked.
  let target = req.user || null;
  const email = req.body && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!target && email) {
    target = await User.findOne({ email });
  }
  if (target && !target.isVerified) {
    const rawToken = User.randomToken();
    await Token.create({
      user: target._id,
      type: TOKEN_TYPES.VERIFY,
      tokenHash: hash(rawToken),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });
    // Same rule as register: a mail failure must not turn into a 500 —
    // the user would otherwise be stuck with no way to get a new link.
    try {
      const mail = emailService.verificationEmail(target, rawToken);
      await emailService.sendMail({ to: target.email, ...mail });
    } catch (mailErr) {
      console.error('Failed to resend verification email:', mailErr.message);
    }
  }
  res.json({ ok: true, message: 'If your account is unverified, a new link has been sent' });
});

const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');

  const ok = user && (await user.comparePassword(password));
  if (!ok || !user) {
    audit('auth.login.fail', { email, severity: 'warn', req });
    throw ApiError.unauthorized('Invalid credentials', 'invalid_credentials');
  }
  if (user.isBanned) {
    audit('auth.login.fail', { actorId: user._id, email, severity: 'critical', req, meta: { reason: 'banned' } });
    throw ApiError.forbidden('Account suspended', 'account_banned');
  }
  if (config.emailVerificationRequired && !user.isVerified) {
    throw ApiError.forbidden('Verify your email before signing in', 'email_unverified');
  }

  const accessToken = await issueTokenPair(user, req, res);
  audit('auth.login.success', { actorId: user._id, email, req });

  res.json({ ok: true, data: { accessToken, user: user.toMeJSON() } });
});

const refresh = catchAsync(async (req, res) => {
  const token = req.cookies[refreshCookieName()];
  if (!token) throw ApiError.unauthorized('No refresh token', 'no_refresh_token');

  const result = await rotateRefreshToken(token, req);
  if (result.error === 'reuse') {
    res.clearCookie(refreshCookieName(), { path: '/api/auth' });
    throw ApiError.unauthorized('Session revoked due to suspicious activity', 'session_revoked');
  }
  if (result.error) {
    res.clearCookie(refreshCookieName(), { path: '/api/auth' });
    throw ApiError.unauthorized('Invalid refresh token', 'refresh_invalid');
  }

  res.cookie(refreshCookieName(), result.token, refreshCookieOptions());
  res.json({ ok: true, data: { accessToken: signAccess(result.user), user: result.user.toMeJSON() } });
});

const logout = catchAsync(async (req, res) => {
  const token = req.cookies[refreshCookieName()];
  if (token) {
    await revokeByToken(token);
    audit('auth.logout', { actorId: req.user ? req.user._id : null, req });
  }
  res.clearCookie(refreshCookieName(), { path: '/api/auth' });
  res.json({ ok: true });
});

const logoutAll = catchAsync(async (req, res) => {
  await revokeAllForUser(req.user._id);
  audit('auth.session.revoked', { actorId: req.user._id, req, meta: { scope: 'all' } });
  res.clearCookie(refreshCookieName(), { path: '/api/auth' });
  res.json({ ok: true });
});

const forgotPassword = catchAsync(async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (user) {
    const rawToken = User.randomToken();
    await Token.create({
      user: user._id,
      type: TOKEN_TYPES.RESET,
      tokenHash: hash(rawToken),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    const mail = emailService.resetEmail(user, rawToken);
    try {
      await emailService.sendMail({ to: user.email, ...mail });
    } catch (mailErr) {
      console.error('Failed to send reset email:', mailErr.message);
    }
    audit('auth.password.reset_request', { actorId: user._id, email: user.email, severity: 'warn', req });

    if (devTokenEnabled()) {
      return res.json({ ok: true, message: 'Reset link sent', devResetToken: rawToken });
    }
  }
  res.json({ ok: true, message: 'If that account exists, a reset link has been sent' });
});

const resetPassword = catchAsync(async (req, res) => {
  const doc = await consumeToken(req.body.token, TOKEN_TYPES.RESET);
  if (!doc) throw ApiError.badRequest('Invalid or expired reset link', 'token_invalid');

  const passwordHash = await User.hashPassword(req.body.password);
  const user = await User.findById(doc.user);
  user.passwordHash = passwordHash;
  await user.save();

  await revokeAllForUser(user._id);
  audit('auth.password.reset', { actorId: user._id, email: user.email, severity: 'warn', req });

  res.json({ ok: true, message: 'Password updated - sign in again' });
});

async function consumeToken(raw, type) {
  const doc = await Token.findOneAndDelete({ tokenHash: hash(raw), type });
  if (!doc) return null;
  if (doc.expiresAt < new Date()) return null;
  return doc;
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  refresh,
  logout,
  logoutAll,
  forgotPassword,
  resetPassword,
};
