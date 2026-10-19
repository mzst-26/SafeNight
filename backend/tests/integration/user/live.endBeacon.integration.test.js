const express = require('express');
const request = require('supertest');
const { createSupabaseMock, opOf } = require('../../helpers/supabaseMock');

const mockDb = createSupabaseMock((q) => {
  if (q.table === 'live_sessions' && opOf(q, 'update')) {
    return { data: { id: 's1', status: opOf(q, 'update').args[0].status }, error: null };
  }
  return { data: null, error: null };
});

jest.mock('../../../src/user/lib/supabase', () => ({ supabase: mockDb.supabase }));
jest.mock('../../../src/user/middleware/authMiddleware', () => ({
  requireAuth: (req, res, next) => {
    if (req.headers.authorization !== 'Bearer good-token') {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    req.user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    return next();
  },
}));
jest.mock('../../../src/user/middleware/subscriptionMiddleware', () => ({
  checkFeatureLimit: () => (_req, _res, next) => next(),
}));
jest.mock('../../../src/user/lib/pushNotifications', () => ({ sendPush: jest.fn() }));

const liveRouter = require('../../../src/user/routes/live');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/live', liveRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('POST /api/live/end token transport', () => {
  test('a token in the query string is no longer accepted (it leaks into proxy logs)', async () => {
    const res = await request(createApp()).post('/api/live/end?token=good-token').send({ status: 'cancelled' });
    expect(res.status).toBe(401);
  });

  test('Authorization header works', async () => {
    const res = await request(createApp())
      .post('/api/live/end')
      .set('Authorization', 'Bearer good-token')
      .send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  test('sendBeacon fallback: token in a text/plain JSON body (no preflight, not in the URL)', async () => {
    const res = await request(createApp())
      .post('/api/live/end')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(JSON.stringify({ status: 'cancelled', access_token: 'good-token' }));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  test('sendBeacon fallback: token in an application/json body', async () => {
    const res = await request(createApp())
      .post('/api/live/end')
      .send({ status: 'cancelled', access_token: 'good-token' });
    expect(res.status).toBe(200);
  });

  test('body token is only honoured on /end', async () => {
    const res = await request(createApp())
      .post('/api/live/heartbeat')
      .send({ access_token: 'good-token' });
    expect(res.status).toBe(401);
  });

  test('a body token never overrides an Authorization header', async () => {
    const res = await request(createApp())
      .post('/api/live/end')
      .set('Authorization', 'Bearer bad-token')
      .send({ status: 'cancelled', access_token: 'good-token' });
    expect(res.status).toBe(401);
  });
});
