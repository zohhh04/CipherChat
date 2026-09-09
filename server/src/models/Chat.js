const mongoose = require('mongoose');
const { CHAT_TYPES } = require('../utils/constants');

const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isAdmin: { type: Boolean, default: false },
  },
  { _id: false }
);

const chatSchema = new mongoose.Schema(
  {
    type: { type: String, enum: Object.values(CHAT_TYPES), required: true },

    directKey: { type: String, index: { unique: true, sparse: true } },

    members: {
      type: [memberSchema],
      validate: [(v) => v.length >= 2, 'Chat requires at least two members'],
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    groupInfo: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },

    keyWraps: {
      type: Map,
      of: new mongoose.Schema({ iv: String, ct: String, by: String }, { _id: false }),
      default: {},
    },

    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    lastActivity: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

chatSchema.index({ 'members.user': 1 });
chatSchema.index({ lastActivity: -1 });

chatSchema.statics.directKeyFor = (a, b) => [String(a), String(b)].sort().join('_');

chatSchema.methods.isMember = function (userId) {
  const id = String(userId);
  return this.members.some((m) => String(m.user._id || m.user) === id);
};

chatSchema.methods.memberRole = function (userId) {
  const id = String(userId);
  const m = this.members.find((m) => String(m.user._id || m.user) === id);
  if (!m) return null;
  return m.isAdmin ? 'admin' : 'member';
};

module.exports = mongoose.model('Chat', chatSchema);
