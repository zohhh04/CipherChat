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
router.post('/:id/polls', validate(v.createPoll), msgCtrl.createPoll);
router.post('/:id/calls/missed', validate(v.logMissedCall), msgCtrl.logMissedCall);
router.post('/:id/pin', validate(v.pinMessage), chatCtrl.pinMessage);
router.delete('/:id/pin', validate(v.chatIdParam), chatCtrl.unpinMessage);
router.post('/:id/read', validate(v.chatIdParam), msgCtrl.markRead);
router.post('/:id/delivered', validate(v.chatIdParam), msgCtrl.markDelivered);
router.delete('/:id/messages/:mid', validate(v.messageIdParam), msgCtrl.deleteMessage);
router.delete('/:id/messages', validate(v.chatIdParam), msgCtrl.clearHistory);
router.patch('/:id/messages/:mid', validate(v.editMessage), msgCtrl.editMessage);
router.post('/:id/messages/:mid/view', validate(v.messageIdParam), msgCtrl.markViewed);
router.post('/:id/messages/:mid/vote', validate(v.votePoll), msgCtrl.votePoll);
router.post('/:id/messages/:mid/reactions', validate(v.addReaction), msgCtrl.addReaction);
router.delete('/:id/messages/:mid/reactions/:emoji', validate(v.removeReaction), msgCtrl.removeReaction);

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
