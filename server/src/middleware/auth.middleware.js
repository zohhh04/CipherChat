const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../services/token.service');

async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized('Missing access token', 'token_missing');

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (e) {
      const expired = e && e.name === 'TokenExpiredError';
      throw ApiError.unauthorized(expired ? 'Access token expired' : 'Invalid access token', expired ? 'token_expired' : 'token_invalid');
    }

    const user = await User.findById(payload.sub);
    if (!user) throw ApiError.unauthorized('User no longer exists', 'user_gone');
    if (user.isBanned) throw ApiError.forbidden('Account suspended', 'account_banned');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireVerified(req, res, next) {
  if (!req.user.isVerified) {
    return next(ApiError.forbidden('Verify your email to continue', 'email_unverified'));
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return next(ApiError.forbidden('Admin access required', 'admin_required'));
  }
  next();
}

module.exports = { requireAuth, requireVerified, requireAdmin };
