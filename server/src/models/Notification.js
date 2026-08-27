const mongoose = require('mongoose');
const { NOTIFICATION_TYPES } = require('../utils/constants');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: Object.values(NOTIFICATION_TYPES), required: true },
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    message: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    read: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now },
  }
);

notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
