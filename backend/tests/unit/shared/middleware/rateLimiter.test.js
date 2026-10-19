const express = require('express');
const request = require('supertest');

const { createRateLimiter } = require('../../../../src/shared/middleware/rateLimiter');

function fakeJwt(sub) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ sub })}.sig`;
}

function createApp(options) {
  const app = express();
  app.use(createRateLimiter(options));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('createRateLimiter', () => {
  test('keys by JWT sub so one user hitting the limit does not block another', async () => {
    const app = createApp({ windowMs: 60_000, max: 2 });
    const a = `Bearer ${fakeJwt('user-a')}`;
    const b = `Bearer ${fakeJwt('user-b')}`;

    expect((await request(app).get('/x').set('Authorization', a)).status).toBe(200);
    expect((await request(app).get('/x').set('Authorization', a)).status).toBe(200);
    expect((await request(app).get('/x').set('Authorization', a)).status).toBe(429);
    expect((await request(app).get('/x').set('Authorization', b)).status).toBe(200);
  });

  test('rotating forged JWT subs from one IP cannot bypass the limit (IP backstop)', async () => {
    const app = createApp({ windowMs: 60_000, max: 2 });
    const statuses = [];
    for (let i = 0; i < 30; i += 1) {
      const res = await request(app).get('/x').set('Authorization', `Bearer ${fakeJwt(`forged-${i}`)}`);
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    // Backstop is a multiple of max, never unbounded.
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(2 * 5);
  });

  test('ipOnly mode ignores the Authorization header', async () => {
    const app = createApp({ windowMs: 60_000, max: 1, ipOnly: true });
    expect((await request(app).get('/x').set('Authorization', `Bearer ${fakeJwt('a')}`)).status).toBe(200);
    expect((await request(app).get('/x').set('Authorization', `Bearer ${fakeJwt('b')}`)).status).toBe(429);
  });
});
