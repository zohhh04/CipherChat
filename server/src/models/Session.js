const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    jti: { type: String, required: true, unique: true },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '', maxlength: 400 },
    deviceLabel: { type: String, default: '', maxlength: 120 },
    lastUsedAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Session', sessionSchema);
