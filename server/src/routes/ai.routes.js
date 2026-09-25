const router = require('express').Router();
const aiCtrl = require('../controllers/ai.controller');
const { validate } = require('../middleware/error.middleware');
const v = require('../validators');
const { requireAuth, requireVerified } = require('../middleware/auth.middleware');

router.use(requireAuth, requireVerified);

router.post('/summarize/:id', validate(v.chatIdParam), aiCtrl.summarize);
router.post('/smart-replies/:id', validate(v.chatIdParam), aiCtrl.smartReplies);
router.post('/translate', validate(v.translateText), aiCtrl.translate);
router.post('/detect-urgency', aiCtrl.detectUrgency);

module.exports = router;
