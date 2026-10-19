const express = require('express');
const request = require('supertest');
const { createSupabaseMock, opOf } = require('../../helpers/supabaseMock');

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mockDb = createSupabaseMock((q) => {
  if (opOf(q, 'insert')) return { data: { id: 'new', ...opOf(q, 'insert').args[0] }, error: null };
  if (q.table === 'safety_reports') return { data: [], error: null };
  return { data: null, error: null };
});

jest.mock('../../../src/user/lib/supabase', () => ({ supabase: mockDb.supabase }));
jest.mock('../../../src/user/middleware/authMiddleware', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: ME };
    next();
  },
}));
jest.mock('../../../src/user/middleware/subscriptionMiddleware', () => ({
  checkFeatureLimit: () => (_req, _res, next) => next(),
}));
jest.mock('../../../src/user/lib/pushNotifications', () => ({ sendPush: jest.fn() }));

const reportsRouter = require('../../../src/user/routes/reports');
const liveRouter = require('../../../src/user/routes/live');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/reports', reportsRouter);
  app.use('/api/live', liveRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('reports validation', () => {
  beforeEach(() => {
    mockDb.calls.length = 0;
  });

  test('oversized metadata is rejected (it is served publicly on GET /api/reports)', async () => {
    const res = await request(createApp())
      .post('/api/reports')
      .send({ lat: 50.37, lng: -4.14, category: 'other', metadata: { blob: 'x'.repeat(20_000) } });
    expect(res.status).toBe(400);
    expect(mockDb.calls.find((q) => q.table === 'safety_reports' && opOf(q, 'insert'))).toBeUndefined();
  });

  test('small metadata is still accepted', async () => {
    const res = await request(createApp())
      .post('/api/reports')
      .send({ lat: 50.37, lng: -4.14, category: 'other', metadata: { source: 'app' } });
    expect(res.status).toBe(201);
  });

  test('nearby radius is clamped', async () => {
    await request(createApp()).get('/api/reports/nearby?lat=50&lng=-4&radius_km=100000');
    const q = mockDb.calls.find((c) => c.table === 'safety_reports');
    const gte = q.ops.find((o) => o.op === 'gte' && o.args[0] === 'lat');
    expect(50 - gte.args[1]).toBeLessThanOrEqual(1);
  });

  test('nearby rejects out-of-range coordinates', async () => {
    const res = await request(createApp()).get('/api/reports/nearby?lat=500&lng=-4');
    expect(res.status).toBe(400);
  });
});

describe('live session route_path validation', () => {
  beforeEach(() => {
    mockDb.calls.length = 0;
  });

  test('route_path points are reduced to in-range {lat,lng} only', async () => {
    const res = await request(createApp())
      .post('/api/live/start')
      .send({
        current_lat: 50.37,
        current_lng: -4.14,
        route_path: [
          { lat: 50.37, lng: -4.14, junk: 'x'.repeat(1000) },
          { lat: 999, lng: -4.14 },
          { lat: 50.38, lng: -4.15 },
        ],
      });
    expect(res.status).toBeLessThan(300);
    const insert = mockDb.calls.find((q) => q.table === 'live_sessions' && opOf(q, 'insert'));
    expect(opOf(insert, 'insert').args[0].route_path).toEqual([
      { lat: 50.37, lng: -4.14 },
      { lat: 50.38, lng: -4.15 },
    ]);
  });
});
