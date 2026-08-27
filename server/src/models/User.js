const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');
const crypto = require('crypto');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      minlength: 3,
      maxlength: 32,
      match: /^[a-zA-Z0-9_.-]+$/,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isVerified: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },

    publicKey: { type: String, default: '', select: false },
    keyBackup: {
      salt: { type: String, default: '' },
      iv: { type: String, default: '' },
      blob: { type: String, default: '' },
    },

    about: { type: String, default: '', maxlength: 140 },
    theme: { type: String, enum: ['light', 'dark'], default: 'dark' },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.statics.hashPassword = function (plain) {
  return bcrypt.hash(plain, config.bcryptRounds);
};

userSchema.statics.randomToken = () => crypto.randomBytes(32).toString('hex');

userSchema.methods.toMeJSON = function () {
  return {
    id: this._id,
    username: this.username,
    email: this.email,
    role: this.role,
    isVerified: this.isVerified,
    about: this.about,
    theme: this.theme,
    hasKeyBackup: Boolean(this.keyBackup && this.keyBackup.blob),
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
