const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../src/models/User');
const { connectDB } = require('../src/config/db');
const logger = require('../src/config/logger');

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in environment first.');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('ADMIN_PASSWORD must be at least 10 characters.');
    process.exit(1);
  }

  await connectDB(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cipherchat');

  const existing = await User.findOne({ email });
  if (existing) {
    existing.role = 'admin';
    existing.isVerified = true;
    existing.passwordHash = await User.hashPassword(password);
    await existing.save();
    console.log(`Admin updated: ${email}`);
  } else {
    await User.create({
      username: 'admin',
      email,
      passwordHash: await User.hashPassword(password),
      role: 'admin',
      isVerified: true,
    });
    console.log(`Admin created: ${email}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
