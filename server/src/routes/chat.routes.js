const router = require('express').Router({ mergeParams: true });
const chatCtrl = require('../controllers/chat.controller');
const msgCtrl = require('../controllers/message.controller');
const fileCtrl = require('../controllers/file.controller');
const { validate } = require('../middleware/error.middleware');
const v = require('../validators');
const { requireAuth, requireVerified } = require('../middleware/auth.middleware');
const { uploadLimiter } = require('../middleware/rateLimiters');

router.use(requireAuth, requireVerified);

router.get('/', chatCtrl.listMyChats);
router.post('/direct', validate(v.createDirectChat), chatCtrl.createDirect);
router.post('/group', validate(v.createGroupChat), chatCtrl.createGroup);

router.get('/:id', validate(v.chatIdParam), chatCtrl.getChat);
router.patch('/:id/group', validate(v.updateGroup), chatCtrl.updateGroup);
router.post('/:id/members', validate(v.addMembers), chatCtrl.addMembers);
router.delete('/:id/members/:userId', validate(v.removeMember), chatCtrl.removeMember);
router.post('/:id/rotate-keys', validate(v.rotateKeys), chatCtrl.rotateKeys);
router.post('/:id/leave', validate(v.chatIdParam), chatCtrl.leaveChat);

router.get('/:id/messages', validate(v.listMessages), msgCtrl.list);
router.post('/:id/messages', validate(v.sendMessage), msgCtrl.send);
router.post('/:id/read', validate(v.chatIdParam), msgCtrl.markRead);
router.post('/:id/delivered', validate(v.chatIdParam), msgCtrl.markDelivered);
router.delete('/:id/messages/:mid', validate(v.messageIdParam), msgCtrl.deleteMessage);

router.post(
  '/:id/files',
  uploadLimiter,
  require('../middleware/upload.middleware').upload.single('file'),
  validate(v.uploadFile),
  fileCtrl.upload
);
router.get('/files/:fid/meta', fileCtrl.meta);
router.get('/files/:fid/download', fileCtrl.download);

module.exports = router;
