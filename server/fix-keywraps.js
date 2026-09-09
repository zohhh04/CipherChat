require('dotenv').config();
const mongoose = require('mongoose');

async function fix() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cipherchat');
  const db = mongoose.connection.db;
  const chats = await db.collection('chats').find({}).toArray();

  let fixed = 0;
  for (const chat of chats) {
    if (!chat.keyWraps) continue;
    let changed = false;
    for (const [userId, wrap] of Object.entries(chat.keyWraps)) {
      if (wrap.by && !/^[a-f\d]{24}$/i.test(wrap.by)) {
        console.log(`Chat ${chat._id}: fixing wrap for ${userId}, by was "${wrap.by}"`);
        delete wrap.by;
        changed = true;
      }
    }
    if (changed) {
      await db.collection('chats').updateOne({ _id: chat._id }, { $set: { keyWraps: chat.keyWraps } });
      fixed++;
    }
  }
  console.log(`Fixed ${fixed} chats`);
  await mongoose.disconnect();
}
fix().catch(console.error);
