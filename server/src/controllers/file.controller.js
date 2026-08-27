const fs = require('fs');
const path = require('path');
const File = require('../models/File');
const Chat = require('../models/Chat');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const upload = catchAsync(async (req, res) => {
  const chatId = req.params.id;
  const chat = await Chat.findById(chatId);
  if (!chat) throw ApiError.notFound('Chat not found', 'chat_not_found');
  if (!chat.isMember(req.user._id)) throw ApiError.forbidden('Not a member of this chat', 'not_member');

  if (!req.file) throw ApiError.badRequest('File payload missing', 'file_missing');

  const doc = await File.create({
    chat: chat._id,
    uploader: req.user._id,
    storagePath: path.basename(req.file.path),
    size: req.file.size,
    mimeHint: String(req.body.mimeHint || '').slice(0, 100),
    nameIv: req.body.nameIv,
    nameCt: req.body.nameCt,
  });

  res.status(201).json({ ok: true, data: { fileId: doc._id } });
});

const meta = catchAsync(async (req, res) => {
  const file = await assertAccess(req);
  res.json({
    ok: true,
    data: { id: file._id, size: file.size, mimeHint: file.mimeHint, nameIv: file.nameIv, nameCt: file.nameCt },
  });
});

const download = catchAsync(async (req, res) => {
  const file = await assertAccess(req);

  const filePath = path.join(require('../middleware/upload.middleware').uploadDir, file.storagePath);
  if (!fs.existsSync(filePath)) throw ApiError.notFound('File content missing', 'file_gone');

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${file.storagePath}.bin"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(filePath).pipe(res);
});

async function assertAccess(req) {
  const file = await File.findById(req.params.id);
  if (!file) throw ApiError.notFound('File not found', 'file_not_found');
  const chat = await Chat.findById(file.chat);
  if (!chat || !chat.isMember(req.user._id)) {
    throw ApiError.forbidden('Not a member of this chat', 'not_member');
  }
  return file;
}

module.exports = { upload, meta, download };
