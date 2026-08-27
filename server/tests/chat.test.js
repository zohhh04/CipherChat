const request = require('supertest');
const { createApp } = require('../src/app');
const User = require('../src/models/User');

const app = createApp();

let counter = 0;

function uniqueUser(prefix) {
  counter += 1;
  return {
    username: `${prefix}${counter}_${Date.now()}`,
    email: `${prefix}${counter}.${Date.now()}@test.dev`,
    password: 'Str0ngPassw0rd!x',
  };
}

async function makeVerifiedUser(prefix) {
  const u = uniqueUser(prefix);
  const reg = await request(app).post('/api/auth/register').send(u);
  if (reg.body && reg.body.data && reg.body.data.devVerifyToken) {
    await request(app).post('/api/auth/verify-email').send({ token: reg.body.data.devVerifyToken });
  } else {
    await User.updateOne({ email: u.email }, { $set: { isVerified: true } });
  }
  const login = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password });
  return { user: u, token: login.body.data.accessToken, id: login.body.data.user.id, loginRes: login };
}

const authHeader = (t) => ({ Authorization: `Bearer ${t}` });

describe('Chats & messages', () => {
  it('creates a direct chat and exchanges opaque encrypted messages', async () => {
    const a = await makeVerifiedUser('sender');
    const b = await makeVerifiedUser('receiver');

    const createRes = await request(app)
      .post('/api/chats/direct')
      .set(authHeader(a.token))
      .send({ memberId: b.id });
    expect(createRes.status).toBe(201);
    const chatId = createRes.body.data.chatId;

    const dup = await request(app).post('/api/chats/direct').set(authHeader(b.token)).send({ memberId: a.id });
    expect(dup.status).toBe(200);
    expect(String(dup.body.data.chatId)).toBe(String(chatId));

    const sendRes = await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set(authHeader(a.token))
      .send({
        type: 'text',
        iv: 'AAAAAAAAAAAAAAAAAAAAAA==',
        ciphertext: Buffer.from('fake-aes-gcm-ciphertext').toString('base64'),
      });
    expect(sendRes.status).toBe(201);

    const listB = await request(app).get(`/api/chats/${chatId}/messages`).set(authHeader(b.token));
    expect(listB.status).toBe(200);
    expect(listB.body.data.messages).toHaveLength(1);
    expect(listB.body.data.messages[0].ciphertext).not.toMatch(/hello/i);
    expect(listB.body.data.messages[0].readBy.map(String)).toContain(a.id);
  });

  it('forbids outsiders from reading a chat', async () => {
    const a = await makeVerifiedUser('ownerA');
    const b = await makeVerifiedUser('memberB');
    const outsider = await makeVerifiedUser('intruder');

    const chatRes = await request(app).post('/api/chats/direct').set(authHeader(a.token)).send({ memberId: b.id });
    const chatId = chatRes.body.data.chatId;

    const res = await request(app).get(`/api/chats/${chatId}/messages`).set(authHeader(outsider.token));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('not_member');
  });

  it('blocks unverified users from chats with email_unverified', async () => {
    const config = require('../src/config');
    const prev = config.emailVerificationRequired;
    config.emailVerificationRequired = false;

    const u = uniqueUser('unverified');
    await request(app).post('/api/auth/register').send(u);
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: u.email, password: u.password });
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.data.accessToken;

    const res = await request(app).get('/api/chats').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('email_unverified');

    config.emailVerificationRequired = prev;
  });

  it('supports group creation, membership and key rotation guards', async () => {
    const a = await makeVerifiedUser('gadmin');
    const b = await makeVerifiedUser('gmember');
    const c = await makeVerifiedUser('glate');

    const wrap = (uid) => [uid, { iv: 'BBBBBBBBBBBBBBBBBBBBBB==', ct: Buffer.from(uid + String(Date.now())).toString('base64'), by: a.id }];

    const createGroup = await request(app)
      .post('/api/chats/group')
      .set(authHeader(a.token))
      .send({
        name: 'Ops Team',
        memberIds: [b.id],
        keyWraps: Object.fromEntries([wrap(a.id), wrap(b.id)]),
      });
    expect(createGroup.status).toBe(201);
    const groupId = createGroup.body.data.chatId;

    const addRes = await request(app)
      .post(`/api/chats/${groupId}/members`)
      .set(authHeader(a.token))
      .send({ memberIds: [c.id], keyWraps: Object.fromEntries([wrap(c.id)]) });
    expect(addRes.status).toBe(200);

    const detailC = await request(app).get(`/api/chats/${groupId}`).set(authHeader(c.token));
    expect(detailC.status).toBe(200);
    expect(detailC.body.data.keyWraps[c.id]).toBeDefined();

    const badRotate = await request(app)
      .post(`/api/chats/${groupId}/rotate-keys`)
      .set(authHeader(a.token))
      .send({ keyWraps: Object.fromEntries([wrap(a.id)]) });
    expect(badRotate.status).toBe(400);

    const nonAdminRemove = await request(app)
      .delete(`/api/chats/${groupId}/members/${c.id}`)
      .set(authHeader(b.token));
    expect(nonAdminRemove.status).toBe(403);
  });

  it('paginates message history with cursor', async () => {
    const a = await makeVerifiedUser('pager1');
    const b = await makeVerifiedUser('pager2');
    const chatRes = await request(app).post('/api/chats/direct').set(authHeader(a.token)).send({ memberId: b.id });
    const chatId = chatRes.body.data.chatId;

    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post(`/api/chats/${chatId}/messages`)
        .set(authHeader(a.token))
        .send({ type: 'text', iv: 'Q0FBQ0FBQ0FBQ0FBQ0FBQQ==', ciphertext: Buffer.from(`ct-${i}`).toString('base64') });
    }

    const page1 = await request(app)
      .get(`/api/chats/${chatId}/messages?limit=3`)
      .set(authHeader(a.token));
    expect(page1.body.data.messages).toHaveLength(3);
    const firstPageIds = page1.body.data.messages.map((m) => m.id);

    const before = page1.body.data.messages[0].id;
    const page2 = await request(app)
      .get(`/api/chats/${chatId}/messages?limit=10&before=${before}`)
      .set(authHeader(a.token));
    expect(page2.body.data.messages.length).toBeLessThanOrEqual(2);
    for (const m of page2.body.data.messages) {
      expect(firstPageIds).not.toContain(m.id);
    }
  });

  it('deletes a message and wipes its ciphertext server-side', async () => {
    const a = await makeVerifiedUser('deleter1');
    const b = await makeVerifiedUser('deleter2');
    const chatRes = await request(app).post('/api/chats/direct').set(authHeader(a.token)).send({ memberId: b.id });
    const chatId = chatRes.body.data.chatId;

    const send = await request(app)
      .post(`/api/chats/${chatId}/messages`)
      .set(authHeader(a.token))
      .send({ type: 'text', iv: 'RA==', ciphertext: Buffer.from('to-delete').toString('base64') });
    const mid = send.body.data.message.id;

    const delByOther = await request(app).delete(`/api/chats/${chatId}/messages/${mid}`).set(authHeader(b.token));
    expect(delByOther.status).toBe(403);

    const del = await request(app).delete(`/api/chats/${chatId}/messages/${mid}`).set(authHeader(a.token));
    expect(del.status).toBe(200);

    const list = await request(app).get(`/api/chats/${chatId}/messages`).set(authHeader(b.token));
    const target = list.body.data.messages.find((m) => String(m.id) === String(mid));
    expect(target.deletedAt).toBeTruthy();
    expect(target.ciphertext).toBe('');
  });
});
