const router = require('express').Router();
const auth = require('../controllers/auth.controller');
const { validate } = require('../middleware/error.middleware');
const v = require('../validators');
const { requireAuth, optionalAuth } = require('../middleware/auth.middleware');
const { authLimiter, refreshLimiter } = require('../middleware/rateLimiters');

router.post('/register', authLimiter, validate(v.register), auth.register);
router.post('/verify-email', authLimiter, validate(v.verifyEmail), auth.verifyEmail);
router.post('/forgot-password', authLimiter, validate(v.forgotPassword), auth.forgotPassword);
router.post('/reset-password', authLimiter, validate(v.resetPassword), auth.resetPassword);

router.post('/login', authLimiter, validate(v.login), auth.login);
router.post('/refresh', refreshLimiter, auth.refresh);
router.post('/logout', auth.logout);
router.post('/logout-all', requireAuth, auth.logoutAll);
router.post('/resend-verification', optionalAuth, authLimiter, validate(v.resendVerification), auth.resendVerification);
router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, data: { user: req.user.toMeJSON() } });
});

module.exports = router;
