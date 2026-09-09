const Notification = require('../models/Notification');
const catchAsync = require('../utils/catchAsync');

const list = catchAsync(async (req, res) => {
  const notifications = await Notification.find({ user: req.user._id })
    .sort('-createdAt')
    .limit(30)
    .populate('actor', 'username')
    .select('type actor chat message read urgency urgencyReason createdAt');

  res.json({
    ok: true,
    data: {
      notifications: notifications.map((n) => ({
        id: n._id,
        type: n.type,
        actor: n.actor ? { id: n.actor._id, username: n.actor.username } : null,
        chatId: n.chat,
        read: n.read,
        urgency: n.urgency || 'normal',
        urgencyReason: n.urgencyReason || '',
        createdAt: n.createdAt,
      })),
      unreadCount: await Notification.countDocuments({ user: req.user._id, read: false }),
    },
  });
});

const markAllRead = catchAsync(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, read: false }, { $set: { read: true } });
  res.json({ ok: true });
});

module.exports = { list, markAllRead };
