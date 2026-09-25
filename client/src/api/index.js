import http, { apiError } from './http';

const unwrap = (res) => res.data.data;

export const authApi = {
  register: (payload) => http.post('/auth/register', payload).then((r) => r.data),
  verifyEmail: (token) => http.post('/auth/verify-email', { token }).then((r) => r.data),
  resendVerification: (email) => http.post('/auth/resend-verification', email ? { email } : {}).then((r) => r.data),
  login: async (email, password) =>
    unwrap(await http.post('/auth/login', { email, password })),
  refresh: async () => unwrap(await http.post('/auth/refresh')),
  logout: () => http.post('/auth/logout'),
  logoutAll: () => http.post('/auth/logout-all'),
  forgotPassword: (email) => http.post('/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (token, password) =>
    http.post('/auth/reset-password', { token, password }).then((r) => r.data),
};

export const usersApi = {
  me: () => http.get('/users/me').then(unwrap),
  updateMe: (patch) => http.patch('/users/me', patch).then(unwrap),
  uploadAvatar: async (file) => {
    const form = new FormData();
    form.append('avatar', file);
    const res = await http.post('/users/me/avatar', form, {
      timeout: 60000,
    });
    return res.data.data;
  },
  removeAvatar: () => http.delete('/users/me/avatar').then(unwrap),
  changePassword: (currentPassword, newPassword) =>
    http.patch('/users/me/password', { currentPassword, newPassword }).then((r) => r.data),
  saveKeys: (publicKey, backup) => http.put('/users/me/keys', { publicKey, backup }),
  getKeysBackup: () => http.get('/users/me/keys').then(unwrap),
  search: (q) => http.get('/users', { params: { q } }).then(unwrap),
  publicKeys: (ids) => http.get('/users/public-keys', { params: { ids: ids.join(',') } }).then(unwrap),
  sessions: () => http.get('/users/me/sessions').then(unwrap),
  revokeSession: (id) => http.delete(`/users/me/sessions/${id}`).then((r) => r.data),
  deleteAccount: (password) => http.delete('/users/me', { data: { password } }).then((r) => r.data),
};

export const chatsApi = {
  list: () => http.get('/chats').then(unwrap),
  createDirect: (memberId, keyWraps = {}) =>
    http.post('/chats/direct', { memberId, keyWraps }).then(unwrap),
  createGroup: (name, memberIds, keyWraps, description) =>
    http
      .post('/chats/group', { name, memberIds, keyWraps, ...(description ? { description } : {}) })
      .then(unwrap),
  get: (id) => http.get(`/chats/${id}`).then(unwrap),
  updateGroup: (id, patch) => http.patch(`/chats/${id}/group`, patch),
  addMembers: (id, memberIds, keyWraps) =>
    http.post(`/chats/${id}/members`, { memberIds, keyWraps }),
  removeMember: (id, userId) => http.delete(`/chats/${id}/members/${userId}`),
  rotateKeys: (id, keyWraps, removedUserId) =>
    http.post(`/chats/${id}/rotate-keys`, {
      keyWraps,
      ...(removedUserId ? { removedUserId } : {}),
    }),
  leave: (id) => http.post(`/chats/${id}/leave`),
  pin: (id, messageId) => http.post(`/chats/${id}/pin`, { messageId }).then((r) => r.data),
  unpin: (id) => http.delete(`/chats/${id}/pin`).then((r) => r.data),
};

export const messagesApi = {
  // payload: 🟢 normal {mode:'normal', type:'text', text} | 🔐 secure {mode:'encrypted', type, iv, ciphertext, ...}
  send: (chatId, payload) =>
    http.post(`/chats/${chatId}/messages`, payload).then((r) => r.data.data.message),
  list: (chatId, { before, limit = 30 } = {}) =>
    http
      .get(`/chats/${chatId}/messages`, { params: { before, limit } })
      .then(unwrap),
  markRead: (chatId, ids) => http.post(`/chats/${chatId}/read`, { ids }),
  markDelivered: (chatId, ids) => http.post(`/chats/${chatId}/delivered`, { ids }),
  remove: (chatId, messageId) => http.delete(`/chats/${chatId}/messages/${messageId}`),
  clear: (chatId) => http.delete(`/chats/${chatId}/messages`).then((r) => r.data),
  edit: (chatId, messageId, payload) => http.patch(`/chats/${chatId}/messages/${messageId}`, payload),
  addReaction: (chatId, messageId, emoji) => http.post(`/chats/${chatId}/messages/${messageId}/reactions`, { emoji }),
  removeReaction: (chatId, messageId, emoji) => http.delete(`/chats/${chatId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`),
  markViewed: (chatId, messageId) => http.post(`/chats/${chatId}/messages/${messageId}/view`).then((r) => r.data),
  createPoll: (chatId, question, options) =>
    http.post(`/chats/${chatId}/polls`, { question, options }).then((r) => r.data.data.message),
  votePoll: (chatId, messageId, optionIndex) =>
    http.post(`/chats/${chatId}/messages/${messageId}/vote`, { optionIndex }).then((r) => r.data.data.poll),
  logMissedCall: (chatId, mediaType) =>
    http.post(`/chats/${chatId}/calls/missed`, { mediaType }).then((r) => r.data.data.message),
};

export const filesApi = {
  upload: async (chatId, encryptedBlob, nameIv, nameCt, mimeHint, onProgress) => {
    const form = new FormData();
    form.append('file', new Blob([encryptedBlob]), 'blob.bin');
    form.append('nameIv', nameIv);
    form.append('nameCt', nameCt);
    form.append('mimeHint', mimeHint || '');
    const res = await http.post(`/chats/${chatId}/files`, form, {
      timeout: 300000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(e.loaded / e.total);
      },
    });
    return res.data.data.fileId;
  },
  meta: (fileId) => http.get(`/chats/files/${fileId}/meta`).then(unwrap),
  download: async (fileId) => {
    const res = await http.get(`/chats/files/${fileId}/download`, { responseType: 'arraybuffer' });
    return res.data;
  },
};

export const notificationsApi = {
  list: () => http.get('/notifications').then(unwrap),
  readAll: () => http.post('/notifications/read-all'),
};

// AI calls can take a while (model generation) — allow up to 2 minutes.
const AI_TIMEOUT = 120000;

export const aiApi = {
  translate: (text, targetLang = 'en') =>
    http.post('/ai/translate', { text, targetLang }, { timeout: AI_TIMEOUT }).then(unwrap),
  detectUrgency: (messages) =>
    http.post('/ai/detect-urgency', { messages }).then(unwrap),
};

export const adminApi = {
  stats: () => http.get('/admin/stats').then(unwrap),
  users: (params) => http.get('/admin/users', { params }).then(unwrap),
  setUserStatus: (id, banned) => http.patch(`/admin/users/${id}/status`, { banned }),
  setUserRole: (id, role) => http.patch(`/admin/users/${id}/role`, { role }),
  logs: (params) => http.get('/admin/logs', { params }).then(unwrap),
  sessions: () => http.get('/admin/sessions').then(unwrap),
  revokeSession: (id) => http.delete(`/admin/sessions/${id}`),
};

export { apiError };
