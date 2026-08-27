const config = require('../config');

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function csrfProtection(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  const origin = req.headers.origin || req.headers.referer || '';
  const originHost = origin ? safeHost(origin) : '';
  if (originHost && !config.clientUrls.includes(originHost)) {
    return res.status(403).json({ ok: false, code: 'csrf_origin', message: 'Cross-origin request blocked' });
  }
  return next();
}

function safeHost(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

module.exports = { csrfProtection };
