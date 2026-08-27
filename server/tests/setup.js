const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef0123456789abcdef';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef0123456789abc';
process.env.EMAIL_VERIFICATION_REQUIRED = 'true';
process.env.BCRYPT_ROUNDS = '4';

let mongod;

beforeAll(async () => {
  if (process.env.TEST_MONGO_URI) {
    process.env.MONGO_URI = process.env.TEST_MONGO_URI;
  } else {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri('securechat_test');
  }
  const { connectDB } = require('../src/config/db');
  const conn = await connectDB(process.env.MONGO_URI);
  await conn.dropDatabase();
});

afterAll(async () => {
  const mongoose = require('mongoose');
  await mongoose.disconnect().catch(() => {});
  if (mongod) await mongod.stop({ force: true }).catch(() => {});
});
