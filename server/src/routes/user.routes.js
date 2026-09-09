const router = require('express').Router();
const ctrl = require('../controllers/user.controller');
const { validate } = require('../middleware/error.middleware');
const v = require('../validators');
const { requireAuth } = require('../middleware/auth.middleware');

router.use(requireAuth);

router.get('/me', ctrl.me);
router.patch('/me', validate(v.updateMe), ctrl.updateMe);
router.patch('/me/password', validate(v.changePassword), ctrl.changePassword);
router.put('/me/keys', validate(v.saveKeys), ctrl.saveKeys);
router.get('/me/keys', ctrl.getBackup);
router.get('/me/sessions', ctrl.mySessions);
router.delete('/me/sessions/:id', ctrl.revokeSession);
router.delete('/me', validate(v.deleteAccount), ctrl.deleteAccount);

router.get('/', validate(v.searchUsers), ctrl.search);
router.get('/public-keys', ctrl.keysOf);

module.exports = router;
