const router = require('express').Router();
const multer = require('multer');
const aiCtrl = require('../controllers/ai.controller');
const { validate } = require('../middleware/error.middleware');
const v = require('../validators');
const { requireAuth, requireVerified } = require('../middleware/auth.middleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.originalname.match(/\.(webm|mp3|wav|ogg|m4a)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  },
});

router.use(requireAuth, requireVerified);

router.post('/summarize/:id', validate(v.chatIdParam), aiCtrl.summarize);
router.post('/smart-replies/:id', validate(v.chatIdParam), aiCtrl.smartReplies);
router.post('/translate', validate(v.translateText), aiCtrl.translate);
router.post('/transcribe', upload.single('audio'), aiCtrl.transcribe);
router.post('/detect-urgency', aiCtrl.detectUrgency);

module.exports = router;
