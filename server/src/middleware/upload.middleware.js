const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const config = require('../config');

const uploadDir = path.resolve(config.uploads.dir);
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
});

const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.originalname) return cb(new Error('invalid_file'));
    cb(null, true);
  },
});

module.exports = { upload, uploadDir };
