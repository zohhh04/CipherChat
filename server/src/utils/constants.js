const ROLES = { USER: 'user', ADMIN: 'admin' };
const CHAT_TYPES = { DIRECT: 'direct', GROUP: 'group' };
const MESSAGE_TYPES = ['text', 'image', 'video', 'audio', 'file', 'system'];
const CHAT_MODES = { NORMAL: 'normal', ENCRYPTED: 'encrypted' };
const NOTIFICATION_TYPES = { MESSAGE: 'message', GROUP: 'group', CALL: 'call', SYSTEM: 'system' };
const TOKEN_TYPES = { VERIFY: 'verify', RESET: 'reset' };

const AUDIT_ACTIONS = {
  REGISTER: 'auth.register',
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAIL: 'auth.login.fail',
  LOGOUT: 'auth.logout',
  TOKEN_REUSE: 'auth.refresh.reuse_detected',
  PASSWORD_RESET_REQUEST: 'auth.password.reset_request',
  PASSWORD_RESET: 'auth.password.reset',
  PASSWORD_CHANGED: 'auth.password.changed',
  EMAIL_VERIFIED: 'auth.email.verified',
  SESSION_REVOKED: 'auth.session.revoked',
  USER_BANNED: 'admin.user.banned',
  USER_UNBANNED: 'admin.user.unbanned',
  ROLE_CHANGED: 'admin.user.role_changed',
};

module.exports = { ROLES, CHAT_TYPES, MESSAGE_TYPES, CHAT_MODES, NOTIFICATION_TYPES, TOKEN_TYPES, AUDIT_ACTIONS };
