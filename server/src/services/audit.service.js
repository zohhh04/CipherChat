const AuditLog = require('../models/AuditLog');

function audit(action, { actorId = null, targetId = null, email = '', severity = 'info', req = null, meta = {} } = {}) {
  const entry = {
    action,
    severity,
    actor: actorId,
    target: targetId,
    email,
    ip:
      req && req.headers['x-forwarded-for']
        ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
        : req && req.ip
          ? req.ip
          : '',
    userAgent: req ? String(req.headers['user-agent'] || '').slice(0, 400) : '',
    meta,
  };

  return AuditLog.create(entry).catch(() => {});
}

module.exports = { audit };
