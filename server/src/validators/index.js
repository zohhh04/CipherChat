const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ObjectId');
const b64 = (max = 200000) => z.string().max(max).regex(/^[A-Za-z0-9+/=_-]*$/, 'Invalid base64');
// Packed secure-chat iv is "salt.iv" (two base64 parts joined by a dot),
// e.g. 24-char salt + "." + 16-char iv = 41 chars. Plain b64(40) rejects it.
const packedIv = z.string().max(100).regex(/^[A-Za-z0-9+/=_-]*(\.[A-Za-z0-9+/=_-]*)?$/, 'Invalid iv');
const wrapSchema = z.object({ iv: b64(40), ct: b64(500), by: objectId });
const keyWrapsSchema = z.record(objectId, wrapSchema).default({});

const register = {
  body: z.object({
    username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/, 'Letters, numbers, _ . - only'),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(10).max(128),
  }),
};

const login = {
  body: z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1).max(128),
  }),
};

const verifyEmail = {
  body: z.object({ token: z.string().min(16).max(128) }),
};

const forgotPassword = {
  body: z.object({ email: z.string().trim().toLowerCase().email() }),
};

const resendVerification = {
  body: z.object({ email: z.string().trim().toLowerCase().email().max(254).optional() }).default({}),
};

const resetPassword = {
  body: z.object({ token: z.string().min(16).max(128), password: z.string().min(10).max(128) }),
};

const updateMe = {
  body: z.object({
    about: z.string().max(140).optional(),
    theme: z.enum(['light', 'dark']).optional(),
    avatarColor: z.string().max(20).optional(),
  }).strict(),
};

const changePassword = {
  body: z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).max(128) }),
};

const saveKeys = {
  body: z.object({
    publicKey: b64(500),
    backup: z.object({ salt: b64(200), iv: b64(40), blob: b64(40000) }),
  }).strict(),
};

const searchUsers = {
  query: z.object({ q: z.string().trim().min(1).max(64) }),
};

const createDirectChat = {
  body: z.object({
    memberId: objectId,
    keyWraps: keyWrapsSchema,
  }).strict(),
};

const createGroupChat = {
  body: z.object({
    name: z.string().trim().min(1).max(64),
    description: z.string().trim().max(512).optional(),
    memberIds: z.array(objectId).max(100).default([]),
    keyWraps: keyWrapsSchema,
  }).strict(),
};

const chatIdParam = {
  params: z.object({ id: objectId }),
};

const updateGroup = {
  params: z.object({ id: objectId }),
  body: z.object({ name: z.string().trim().min(1).max(64).optional(), description: z.string().trim().max(512).optional() }).strict(),
};

const addMembers = {
  params: z.object({ id: objectId }),
  body: z.object({
    memberIds: z.array(objectId).min(1).max(50),
    keyWraps: keyWrapsSchema,
  }).strict(),
};

const removeMember = {
  params: z.object({ id: objectId, userId: objectId }),
};

const rotateKeys = {
  params: z.object({ id: objectId }),
  body: z.object({
    keyWraps: keyWrapsSchema.refine((m) => Object.keys(m).length > 0, 'keyWraps required'),
    removedUserId: objectId.optional(),
  }).strict(),
};

const sendMessage = {
  params: z.object({ id: objectId }),
  body: z.object({
    mode: z.enum(['normal', 'encrypted']).default('encrypted'),
    // 🟢 normal text (plaintext) — also accepted as `message` alias
    text: z.string().max(10000).optional().default(''),
    message: z.string().max(10000).optional(),
    // 🔐 encrypted payload (iv may be packed "salt.iv" for shared-key messages)
    iv: packedIv.optional().default(''),
    ciphertext: b64(500000).optional().default(''),
    type: z.enum(['text', 'image', 'video', 'audio', 'file', 'system']).default('text'),
    fileId: objectId.optional(),
    replyTo: objectId.optional(),
    // One-time view: images only. Sender opts in; server enforces image-only.
    viewOnce: z.boolean().optional().default(false),
  })
    .strict()
    .refine((b) => !(b.type !== 'text' && !b.fileId), { message: 'fileId required for media messages' })
    .refine((b) => !(b.viewOnce === true && b.type !== 'image'), { message: 'viewOnce is allowed for images only' })
    .refine(
      (b) => {
        if (b.mode === 'normal' && b.type === 'text' && !((b.text || b.message || '').trim())) return false;
        return true;
      },
      { message: 'text/message is required for normal messages' }
    )
    .refine(
      (b) => {
        if (b.mode === 'encrypted' && b.type === 'text' && !(b.ciphertext || '').trim()) return false;
        return true;
      },
      { message: 'ciphertext is required for encrypted messages' }
    ),
};

const listMessages = {
  params: z.object({ id: objectId }),
  query: z.object({ before: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }),
};

const messageIdParam = {
  params: z.object({ id: objectId, mid: objectId }),
};

const uploadFile = {
  params: z.object({ id: objectId }),
  body: z.object({ nameIv: b64(40), nameCt: b64(5000), mimeHint: z.string().max(100).default('') }),
};

const deleteAccount = {
  body: z.object({ password: z.string().min(1) }),
};

const editMessage = {
  params: z.object({ id: objectId, mid: objectId }),
  body: z.object({
    iv: packedIv.optional().default(''),
    ciphertext: b64(500000).optional().default(''),
    text: z.string().max(10000).optional(),
    message: z.string().max(10000).optional(),
  }).strict(),
};

const addReaction = {
  params: z.object({ id: objectId, mid: objectId }),
  body: z.object({
    emoji: z.string().min(1).max(8),
  }).strict(),
};

const removeReaction = {
  params: z.object({ id: objectId, mid: objectId, emoji: z.string().min(1).max(8) }),
};

const translateText = {
  body: z.object({
    text: z.string().min(1).max(5000),
    targetLang: z.string().min(2).max(5).default('en'),
  }).strict(),
};

module.exports = {
  register, login, verifyEmail, forgotPassword, resetPassword, resendVerification,
  updateMe, changePassword, saveKeys, searchUsers, deleteAccount,
  createDirectChat, createGroupChat, chatIdParam, updateGroup, addMembers, removeMember, rotateKeys,
  sendMessage, listMessages, messageIdParam, uploadFile, editMessage, addReaction, removeReaction, translateText,
};
