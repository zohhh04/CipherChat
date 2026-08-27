const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    storagePath: { type: String, required: true },
    size: { type: Number, required: true },
    mimeHint: { type: String, default: '' },
    nameIv: { type: String, required: true },
    nameCt: { type: String, required: true },
  }
);

module.exports = mongoose.model('File', fileSchema);
