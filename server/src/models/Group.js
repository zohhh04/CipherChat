const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 64 },
  description: { type: String, default: '', maxlength: 512 },
  avatar: { type: String, default: '' },
  chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', index: true },
});

module.exports = mongoose.model('Group', groupSchema);
