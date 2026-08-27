const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    severity: { type: String, enum: ['info', 'warn', 'critical'], default: 'info', index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    email: { type: String, default: '' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '', maxlength: 400 },
    meta: { type: Map, of: mongoose.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
  }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
