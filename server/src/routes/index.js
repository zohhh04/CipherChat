const router = require('express').Router();
const { csrfProtection } = require('../middleware/csrf.middleware');
const { apiLimiter } = require('../middleware/rateLimiters');

router.use(apiLimiter);
router.use(csrfProtection);

router.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/chats', require('./chat.routes'));
router.use('/notifications', require('./notification.routes'));
router.use('/admin', require('./admin.routes'));

router.get('/csrf-token', (req, res) => {
  const crypto = require('crypto');
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie('sc_csrf', token, {
    httpOnly: false,
    secure: require('../config').cookieSecure,
    sameSite: 'strict',
    maxAge: 24 * 3600 * 1000,
    path: '/',
  });
  res.json({ ok: true, data: { csrfToken: token } });
});

module.exports = router;
