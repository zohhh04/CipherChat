import http, { apiError } from './http';

const unwrap = (res) => res.data.data;

export const authApi = {
  register: (payload) => http.post('/auth/register', payload).then((r) => r.data),
  verifyEmail: (token) => http.post('/auth/verify-email', { token }).then((r) => r.data),
  resendVerification: () => http.post('/auth/resend-verification').then((r) => r.data),
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
  changePassword: (currentPassword, newPassword) =>
    http.patch('/users/me/password', { currentPassword, newPassword }).then((r) => r.data),
  saveKeys: (publicKey, backup) => http.put('/users/me/keys', { publicKey, backup }),
  getKeysBackup: () => http.get('/users/me/keys').then(unwrap),
  search: (q) => http.get('/users', { params: { q } }).then(unwrap),
  publicKeys: (ids) => http.get('/users/public-keys', { params: { ids: ids.join(',') } }).then(unwrap),
  sessions: () => http.get('/users/me/sessions').then(unwrap),
  revokeSession: (id) => http.delete(`/users/me/sessions/${id}`).then((r) => r.data),
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
};

export const messagesApi = {
  send: (chatId, payload) =>
    http.post(`/chats/${chatId}/messages`, payload).then((r) => r.data.data.message),
  list: (chatId, { before, limit = 30 } = {}) =>
    http
      .get(`/chats/${chatId}/messages`, { params: { before, limit } })
      .then(unwrap),
  markRead: (chatId, ids) => http.post(`/chats/${chatId}/read`, { ids }),
  markDelivered: (chatId, ids) => http.post(`/chats/${chatId}/delivered`, { ids }),
  remove: (chatId, messageId) => http.delete(`/chats/${chatId}/messages/${messageId}`),
};

export const filesApi = {
  upload: async (chatId, encryptedBlob, nameIv, nameCt, mimeHint, onProgress) => {
    const form = new FormData();
    form.append('file', new Blob([encryptedBlob]), 'blob.bin');
    form.append('nameIv', nameIv);
    form.append('nameCt', nameCt);
    form.append('mimeHint', mimeHint || '');
    const res = await http.post(`/chats/${chatId}/files`, form, {
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
