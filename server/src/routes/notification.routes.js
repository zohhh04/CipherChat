const router = require('express').Router();
const ctrl = require('../controllers/notification.controller');
const { requireAuth } = require('../middleware/auth.middleware');

router.use(requireAuth);
router.get('/', ctrl.list);
router.post('/read-all', ctrl.markAllRead);

module.exports = router;
