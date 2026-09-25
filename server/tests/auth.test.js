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

async function registerVerified(user) {
  const reg = await request(app).post('/api/auth/register').send(user);
  if (reg.body && reg.body.data && reg.body.data.devVerifyToken) {
    await request(app).post('/api/auth/verify-email').send({ token: reg.body.data.devVerifyToken });
  } else {
    await User.updateOne({ email: user.email }, { $set: { isVerified: true } });
  }
}

async function loginAs(user) {
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
  return res;
}

describe('Authentication & account security', () => {
  it('registers a new user', async () => {
    const u = uniqueUser('alice');
    const res = await request(app).post('/api/auth/register').send(u);
    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe(u.email);
  });

  it('rejects invalid payloads (weak password, bad username, injection)', async () => {
    const res1 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'bad name!', email: `x${Date.now()}@t.io`, password: 'Str0ngPassw0rd!x' });
    expect(res1.status).toBe(422);

    const res2 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'okname', email: `y${Date.now()}@t.io`, password: 'short' });
    expect(res2.status).toBe(422);

    const res3 = await request(app).post('/api/auth/login').send({
      email: { $gt: '' },
      password: { $gt: '' },
    });
    expect([401, 422]).toContain(res3.status);
  });

  it('rejects duplicate accounts', async () => {
    const u = uniqueUser('dup');
    await request(app).post('/api/auth/register').send(u);
    const res = await request(app).post('/api/auth/register').send(u);
    expect(res.status).toBe(409);
  });

  it('blocks unverified login, verifies via token, then allows login', async () => {
    const u = uniqueUser('verif');

    const regRes = await request(app).post('/api/auth/register').send(u);
    expect(regRes.status).toBe(201);

    const blocked = await loginAs(u);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('email_unverified');

    const rawToken = regRes.body.data.devVerifyToken;
    expect(rawToken).toBeTruthy();

    const badToken = await request(app).post('/api/auth/verify-email').send({ token: 'a'.repeat(64) });
    expect(badToken.status).toBe(400);

    const ok = await request(app).post('/api/auth/verify-email').send({ token: rawToken });
    expect(ok.status).toBe(200);

    const good = await loginAs(u);
    expect(good.status).toBe(200);
    expect(good.body.data.accessToken).toBeTruthy();
    const cookies = good.headers['set-cookie'];
    expect(cookies.join()).toMatch(/sc_rt/);
    expect(cookies.join()).toMatch(/HttpOnly/i);
  });

  it('returns 401 for wrong password', async () => {
    const u = uniqueUser('wrongpw');
    await registerVerified(u);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: u.email, password: 'WrongPassword!123' });
    expect(res.status).toBe(401);
  });

  it('protects routes without valid token', async () => {
    const res1 = await request(app).get('/api/chats');
    expect(res1.status).toBe(401);
    const res2 = await request(app).get('/api/chats').set('Authorization', 'Bearer garbage.token.here');
    expect(res2.status).toBe(401);
  });

  it('rotates refresh tokens via httpOnly cookie', async () => {
    const u = uniqueUser('refresh');
    await registerVerified(u);
    const loginRes = await loginAs(u);
    const oldCookie = loginRes.headers['set-cookie'];

    const refreshRes = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken).toBeTruthy();

    const reuse = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(reuse.status).toBe(401);
    expect(['session_revoked', 'refresh_invalid']).toContain(reuse.body.code);
  });

  it('resends verification without a token (by email), generically for unknown emails', async () => {
    const u = uniqueUser('resend');
    const reg = await request(app).post('/api/auth/register').send(u);
    expect(reg.status).toBe(201);

    const resend = await request(app).post('/api/auth/resend-verification').send({ email: u.email });
    expect(resend.status).toBe(200);
    expect(resend.body.ok).toBe(true);

    const unknown = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: `nobody.${Date.now()}@test.dev` });
    expect(unknown.status).toBe(200);
    expect(unknown.body.ok).toBe(true);
  });

  it('runs the password reset flow end-to-end', async () => {
    const u = uniqueUser('resetflow');
    await registerVerified(u);
    await loginAs(u);

    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: u.email });
    expect(forgot.status).toBe(200);
    const rawReset = forgot.body.devResetToken || null;

    if (rawReset) {
      const reset = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: rawReset, password: 'BrandNewPass99!' });
      expect(reset.status).toBe(200);

      const oldPw = await loginAs(u);
      expect(oldPw.status).toBe(401);

      const newLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: u.email, password: 'BrandNewPass99!' });
      expect(newLogin.status).toBe(200);
    }
  });
});
