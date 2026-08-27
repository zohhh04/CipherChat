const rateLimit = require('express-rate-limit');
const config = require('../config');

const skip = () => config.isTest;

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { ok: false, code: 'rate_limited', message: 'Too many requests, slow down' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => `${req.ip}:${(req.body && req.body.email) || ''}`,
  message: { ok: false, code: 'rate_limited', message: 'Too many attempts, try again later' },
});

const refreshLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { ok: false, code: 'rate_limited', message: 'Too many refresh attempts' },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { ok: false, code: 'rate_limited', message: 'Upload rate limit exceeded' },
});

module.exports = { apiLimiter, authLimiter, refreshLimiter, uploadLimiter };
