const mongoose = require('mongoose');
const { MESSAGE_TYPES } = require('../utils/constants');

const messageSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: MESSAGE_TYPES, default: 'text' },

    // 🟢 normal = plaintext stored in `text` | 🔐 encrypted = ciphertext+iv, never plaintext
    mode: { type: String, enum: ['normal', 'encrypted'], default: 'encrypted', index: true },
    text: { type: String, default: '' },

    iv: { type: String, default: '' },
    ciphertext: { type: String, default: '' },

    // Forwarded marker (content itself is re-sent into the target chat).
    forwarded: { type: Boolean, default: false },

    // Missed-call messages: type 'call', plain text like "Missed voice call at 3:42 PM".
    callKind: { type: String, enum: ['', 'audio', 'video'], default: '' },
    callStatus: { type: String, enum: ['', 'missed', 'ended', 'declined'], default: '' },

    // Polls: question/options are plaintext meta in `text` (JSON {q, opts});
    // votes are authoritative per-option voter lists (one vote per user).
    poll: {
      question: { type: String, default: '' },
      options: { type: [String], default: [] },
      votes: { type: [[mongoose.Schema.Types.ObjectId]], default: [] },
    },

    file: { type: mongoose.Schema.Types.ObjectId, ref: 'File', default: null },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },

    reactions: { type: Map, of: [mongoose.Schema.Types.ObjectId] },

    // One-time view (images only): receiver opens once, then content is wiped.
    viewOnce: { type: Boolean, default: false },
    viewedAt: { type: Date, default: null },
    viewedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    deliveredTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ chat: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
