/**
 * Review Focus line 1: a valid token for user A must not reach user B's data.
 * Each test asserts the query is scoped to req.user.id or that a cross-user
 * request is refused.
 */
const express = require('express');
const request = require('supertest');
const { createSupabaseMock, opOf } = require('../../helpers/supabaseMock');

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let mockResolver = () => ({ data: null, error: null });
const mockDb = createSupabaseMock((q) => mockResolver(q));
const mockPush = jest.fn(async () => {});

jest.mock('../../../src/user/lib/supabase', () => ({ supabase: mockDb.supabase }));
jest.mock('../../../src/user/middleware/authMiddleware', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    next();
  },
}));
jest.mock('../../../src/user/middleware/subscriptionMiddleware', () => ({
  checkFeatureLimit: () => (_req, _res, next) => next(),
}));
jest.mock('../../../src/user/lib/pushNotifications', () => ({ sendPush: (...a) => mockPush(...a) }));

const app = express();
app.use(express.json());
app.use('/api/contacts', require('../../../src/user/routes/contacts'));
app.use('/api/live', require('../../../src/user/routes/live'));
app.use('/api/reviews', require('../../../src/user/routes/reviews'));
app.use('/api/reports', require('../../../src/user/routes/reports'));
app.use('/api/usage', require('../../../src/user/routes/usage'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

const eqArg = (q, col) => q.ops.find((o) => o.op === 'eq' && o.args[0] === col)?.args[1];
const orArg = (q) => q.ops.find((o) => o.op === 'or')?.args[0] || '';
const tableCalls = (t) => mockDb.calls.filter((q) => q.table === t);

beforeEach(() => {
  mockDb.calls.length = 0;
  mockPush.mockClear();
  mockResolver = () => ({ data: null, error: null });
});

describe('contacts', () => {
  test('list and pending are scoped to me', async () => {
    mockResolver = (q) => {
      if (q.table === 'emergency_contacts' && orArg(q)) {
        return { data: [{ id: ROW, user_id: ME, contact_id: OTHER, status: 'accepted' }], error: null };
      }
      if (q.table === 'emergency_contacts') return { data: [{ id: ROW, user_id: OTHER }], error: null };
      if (q.table === 'live_sessions') {
        return { data: { id: 's', last_update_at: new Date(Date.now() - 120_000).toISOString() }, error: null };
      }
      return { data: { id: OTHER, name: 'B' }, error: null };
    };
    const list = await request(app).get('/api/contacts');
    expect(list.status).toBe(200);
    expect(list.body[0].user.id).toBe(OTHER);
    expect(list.body[0].is_stale).toBe(true);
    expect(orArg(tableCalls('emergency_contacts')[0])).toBe(`user_id.eq.${ME},contact_id.eq.${ME}`);

    mockDb.calls.length = 0;
    const pending = await request(app).get('/api/contacts/pending');
    expect(pending.status).toBe(200);
    expect(eqArg(tableCalls('emergency_contacts')[0], 'contact_id')).toBe(ME);
  });

  test('delete refuses a contact row I am not part of', async () => {
    expect((await request(app).delete('/api/contacts/not-a-uuid')).status).toBe(400);
    const res = await request(app).delete(`/api/contacts/${ROW}`);
    expect(res.status).toBe(404);
    expect(orArg(tableCalls('emergency_contacts')[0])).toContain(ME);
    expect(tableCalls('emergency_contacts').filter((q) => opOf(q, 'delete'))).toHaveLength(0);
  });

  test('delete works for my own contact row', async () => {
    mockResolver = () => ({ data: { id: ROW, user_id: ME, contact_id: OTHER }, error: null });
    expect((await request(app).delete(`/api/contacts/${ROW}`)).status).toBe(200);
  });

  test('respond only matches requests addressed to me', async () => {
    expect((await request(app).post('/api/contacts/respond').send({ contact_request_id: 'x', response: 'accepted' })).status).toBe(400);
    expect((await request(app).post('/api/contacts/respond').send({ contact_request_id: ROW, response: 'owned' })).status).toBe(400);

    mockResolver = (q) => {
      if (q.table === 'emergency_contacts' && opOf(q, 'update')) return { data: { id: ROW, status: 'accepted' }, error: null };
      if (q.table === 'emergency_contacts') return { data: { id: ROW, user_id: OTHER, contact_id: ME }, error: null };
      if (q.table === 'profiles' && q.ops.some((o) => o.op === 'select' && o.args[0] === 'push_token')) {
        return { data: { push_token: 'ExponentPushToken[x]' }, error: null };
      }
      return { data: { name: 'Me' }, error: null };
    };
    const res = await request(app).post('/api/contacts/respond').send({ contact_request_id: ROW, response: 'accepted' });
    expect(res.status).toBe(200);
    const lookup = tableCalls('emergency_contacts').find((q) => !opOf(q, 'update'));
    expect(eqArg(lookup, 'contact_id')).toBe(ME);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  test('invite validation: bad id, self, unknown user, existing states', async () => {
    expect((await request(app).post('/api/contacts/invite').send({ contact_id: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/contacts/invite').send({ contact_id: ME })).status).toBe(400);
    expect((await request(app).post('/api/contacts/invite').send({ contact_id: OTHER })).status).toBe(404);

    for (const [status, code] of [['accepted', 409], ['pending', 409], ['blocked', 403]]) {
      mockResolver = (q) => (q.table === 'profiles'
        ? { data: { id: OTHER, name: 'B' }, error: null }
        : { data: { id: ROW, status }, error: null });
      expect((await request(app).post('/api/contacts/invite').send({ contact_id: OTHER })).status).toBe(code);
    }
  });

  test('new invite is created with me as requester and notifies the target', async () => {
    mockResolver = (q) => {
      if (q.table === 'emergency_contacts' && opOf(q, 'insert')) return { data: { id: ROW, ...opOf(q, 'insert').args[0] }, error: null };
      if (q.table === 'emergency_contacts') return { data: null, error: null };
      if (q.table === 'profiles' && q.ops.some((o) => o.op === 'select' && o.args[0] === 'push_token')) {
        return { data: { push_token: 'ExponentPushToken[x]' }, error: null };
      }
      return { data: { id: OTHER, name: 'B' }, error: null };
    };
    const res = await request(app).post('/api/contacts/invite').send({ contact_id: OTHER, nickname: 'n'.repeat(200) });
    expect(res.status).toBe(201);
    expect(res.body.user_id).toBe(ME);
    expect(res.body.nickname.length).toBe(50);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  test('username set and lookup', async () => {
    expect((await request(app).post('/api/contacts/username').send({ username: 'a' })).status).toBe(400);
    mockResolver = () => ({ data: { id: OTHER }, error: null });
    expect((await request(app).post('/api/contacts/username').send({ username: 'taken_name' })).status).toBe(409);
    mockResolver = () => ({ data: null, error: null });
    const set = await request(app).post('/api/contacts/username').send({ username: 'My_Name' });
    expect(set.body.username).toBe('my_name');
    const upd = tableCalls('profiles').find((q) => opOf(q, 'update'));
    expect(eqArg(upd, 'id')).toBe(ME);

    expect((await request(app).get('/api/contacts/lookup/a')).status).toBe(400);
    expect((await request(app).get('/api/contacts/lookup/nobody')).status).toBe(404);
    mockResolver = () => ({ data: { id: ME, name: 'Me', username: 'me' }, error: null });
    expect((await request(app).get('/api/contacts/lookup/myself')).status).toBe(400);
    mockResolver = () => ({ data: { id: OTHER, name: 'B', username: 'bee' }, error: null });
    const found = await request(app).get('/api/contacts/lookup/bee');
    expect(found.body).toEqual({ id: OTHER, name: 'B', username: 'bee' });
  });
});

describe('live', () => {
  test('watch refuses a user who is not my accepted contact', async () => {
    expect((await request(app).get('/api/live/watch/nope')).status).toBe(400);
    const res = await request(app).get(`/api/live/watch/${OTHER}`);
    expect(res.status).toBe(403);
    expect(orArg(tableCalls('emergency_contacts')[0])).toContain(`user_id.eq.${ME}`);
    expect(tableCalls('live_sessions')).toHaveLength(0);
  });

  test('watch returns an accepted contact\'s session', async () => {
    mockResolver = (q) => {
      if (q.table === 'emergency_contacts') return { data: { id: ROW }, error: null };
      if (q.table === 'live_sessions') return { data: { id: 's', last_update_at: new Date().toISOString() }, error: null };
      return { data: { name: 'B' }, error: null };
    };
    const res = await request(app).get(`/api/live/watch/${OTHER}`);
    expect(res.body.active).toBe(true);
    expect(eqArg(tableCalls('live_sessions')[0], 'user_id')).toBe(OTHER);

    mockResolver = (q) => (q.table === 'emergency_contacts' ? { data: { id: ROW }, error: null } : { data: null, error: null });
    expect((await request(app).get(`/api/live/watch/${OTHER}`)).body.active).toBe(false);
  });

  test('my-session, heartbeat and update only touch my rows', async () => {
    await request(app).get('/api/live/my-session');
    expect(eqArg(tableCalls('live_sessions')[0], 'user_id')).toBe(ME);

    mockDb.calls.length = 0;
    expect((await request(app).post('/api/live/heartbeat')).status).toBe(404);
    expect(eqArg(tableCalls('live_sessions')[0], 'user_id')).toBe(ME);
    mockResolver = () => ({ data: { id: 's' }, error: null });
    expect((await request(app).post('/api/live/heartbeat')).body.alive).toBe(true);

    expect((await request(app).post('/api/live/update').send({ current_lat: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/live/update').send({ current_lat: 50, current_lng: -4 })).status).toBe(200);
    expect(mockDb.supabase.rpc).toHaveBeenCalledWith('append_path_point', expect.objectContaining({ p_user_id: ME }));
  });

  test('update falls back to a scoped manual append when the RPC fails', async () => {
    mockDb.supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'no rpc' } });
    mockResolver = () => ({ data: null, error: null });
    expect((await request(app).post('/api/live/update').send({ current_lat: 50, current_lng: -4 })).status).toBe(404);

    mockDb.supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'no rpc' } });
    mockResolver = () => ({ data: { id: 's', path: [] }, error: null });
    mockDb.calls.length = 0;
    expect((await request(app).post('/api/live/update').send({ current_lat: 50, current_lng: -4 })).status).toBe(200);
    expect(eqArg(tableCalls('live_sessions')[0], 'user_id')).toBe(ME);
  });

  test('end completes my session and notifies my contacts', async () => {
    mockResolver = (q) => {
      if (q.table === 'live_sessions') return { data: { id: 's', status: 'completed' }, error: null };
      if (q.table === 'emergency_contacts') return { data: [{ user_id: ME, contact_id: OTHER }], error: null };
      if (q.table === 'profiles' && q.ops.some((o) => o.op === 'in')) return { data: [{ id: OTHER, push_token: 't' }], error: null };
      return { data: { name: 'Me' }, error: null };
    };
    const res = await request(app).post('/api/live/end').send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(eqArg(tableCalls('live_sessions')[0], 'user_id')).toBe(ME);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  test('start rejects bad coordinates and reuses my active session', async () => {
    expect((await request(app).post('/api/live/start').send({ current_lat: 'a' })).status).toBe(400);
    mockResolver = (q) => (q.table === 'live_sessions' ? { data: { id: 's', status: 'active' }, error: null } : { data: null, error: null });
    const res = await request(app).post('/api/live/start').send({
      current_lat: 50, current_lng: -4, destination_lat: 51, destination_lng: -3, destination_name: 'Home',
      route_path: [{ lat: 50, lng: -4 }, { lat: 50.1, lng: -4.1 }],
    });
    expect(res.status).toBe(200);
    expect(eqArg(tableCalls('live_sessions')[0], 'user_id')).toBe(ME);
  });

  test('start notifies contacts for a brand-new session', async () => {
    mockResolver = (q) => {
      if (q.table === 'live_sessions' && opOf(q, 'insert')) return { data: { id: 'new' }, error: null };
      if (q.table === 'emergency_contacts') return { data: [{ user_id: OTHER, contact_id: ME }], error: null };
      if (q.table === 'profiles' && q.ops.some((o) => o.op === 'in')) return { data: [{ id: OTHER, push_token: 't' }], error: null };
      if (q.table === 'profiles') return { data: { name: 'Me' }, error: null };
      return { data: null, error: null };
    };
    const res = await request(app).post('/api/live/start').send({ current_lat: 50, current_lng: -4, destination_name: 'Home' });
    expect(res.status).toBe(201);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  test('stale-session cleanup expires sessions and tells contacts', async () => {
    const { cleanupStaleSessions, cleanupOldSessions } = require('../../../src/user/routes/live');
    mockResolver = (q) => {
      if (q.table === 'live_sessions' && !opOf(q, 'update')) return { data: [{ id: 's', user_id: OTHER }], error: null };
      if (q.table === 'emergency_contacts') return { data: [{ user_id: OTHER, contact_id: ME }], error: null };
      if (q.table === 'profiles' && q.ops.some((o) => o.op === 'in')) return { data: [{ id: ME, push_token: 't' }], error: null };
      return { data: { name: 'B' }, error: null };
    };
    await cleanupStaleSessions();
    expect(mockPush).toHaveBeenCalledTimes(1);
    mockDb.supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'no rpc' } });
    await cleanupOldSessions();
    expect(tableCalls('live_sessions').some((q) => opOf(q, 'delete'))).toBe(true);
  });
});

describe('reviews', () => {
  test.each(['put', 'delete'])('%s refuses another user\'s review', async (method) => {
    mockResolver = () => ({ data: { user_id: OTHER }, error: null });
    const res = await request(app)[method](`/api/reviews/${ROW}`).send({ rating: 5 });
    expect(res.status).toBe(403);
    expect(tableCalls('reviews').filter((q) => opOf(q, 'update') || opOf(q, 'delete'))).toHaveLength(0);
  });

  test.each(['put', 'delete'])('%s on a missing review is 404', async (method) => {
    expect((await request(app)[method](`/api/reviews/${ROW}`).send({ rating: 5 })).status).toBe(404);
  });

  test('owner can update and delete their review', async () => {
    mockResolver = (q) => (opOf(q, 'update')
      ? { data: { id: ROW, rating: 4, comment: 'ok' }, error: null }
      : { data: { user_id: ME }, error: null });
    expect((await request(app).put(`/api/reviews/${ROW}`).send({ rating: 9 })).status).toBe(400);
    expect((await request(app).put(`/api/reviews/${ROW}`).send({})).status).toBe(400);
    expect((await request(app).put(`/api/reviews/${ROW}`).send({ rating: 4, comment: 'ok' })).status).toBe(200);
    expect((await request(app).delete(`/api/reviews/${ROW}`)).status).toBe(200);
  });

  test('create is one per user; public list hides user ids', async () => {
    expect((await request(app).post('/api/reviews').send({ rating: 0 })).status).toBe(400);
    mockResolver = () => ({ data: { id: ROW }, error: null });
    expect((await request(app).post('/api/reviews').send({ rating: 5 })).status).toBe(409);
    mockResolver = (q) => (opOf(q, 'insert') ? { data: { id: ROW, rating: 5 }, error: null } : { data: null, error: null });
    expect((await request(app).post('/api/reviews').send({ rating: 5, comment: 'x'.repeat(5000) })).status).toBe(201);
    const ins = tableCalls('reviews').find((q) => opOf(q, 'insert'));
    expect(opOf(ins, 'insert').args[0]).toEqual(expect.objectContaining({ user_id: ME }));
    expect(opOf(ins, 'insert').args[0].comment.length).toBe(1000);

    mockResolver = () => ({ data: [{ id: ROW, rating: 5, comment: 'c', created_at: 't', user_id: OTHER, profiles: { name: 'B' } }], error: null });
    const list = await request(app).get('/api/reviews');
    expect(list.body[0]).not.toHaveProperty('user_id');
    expect((await request(app).get('/api/reviews/summary')).body.total_reviews).toBe(1);

    mockResolver = () => ({ data: { id: ROW }, error: null });
    await request(app).get('/api/reviews/mine');
    expect(eqArg(tableCalls('reviews').pop(), 'user_id')).toBe(ME);
  });
});

describe('reports', () => {
  test('delete refuses another user\'s report', async () => {
    mockResolver = () => ({ data: { user_id: OTHER }, error: null });
    expect((await request(app).delete(`/api/reports/${ROW}`)).status).toBe(403);
    expect(tableCalls('safety_reports').filter((q) => opOf(q, 'delete'))).toHaveLength(0);
    mockResolver = () => ({ data: null, error: null });
    expect((await request(app).delete(`/api/reports/${ROW}`)).status).toBe(404);
    mockResolver = () => ({ data: { user_id: ME }, error: null });
    expect((await request(app).delete(`/api/reports/${ROW}`)).status).toBe(200);
  });

  test('mine is scoped to me; public list exposes no user ids', async () => {
    mockResolver = () => ({ data: [], error: null });
    await request(app).get('/api/reports/mine');
    expect(eqArg(tableCalls('safety_reports')[0], 'user_id')).toBe(ME);
    mockDb.calls.length = 0;
    await request(app).get('/api/reports');
    const sel = tableCalls('safety_reports')[0].ops.find((o) => o.op === 'select').args[0];
    expect(sel).not.toMatch(/user_id/);
  });

  test('create validates input and stamps my user id', async () => {
    expect((await request(app).post('/api/reports').send({ lat: 'x', lng: 0, category: 'other' })).status).toBe(400);
    expect((await request(app).post('/api/reports').send({ lat: 1, lng: 1, category: 'nope' })).status).toBe(400);
    expect((await request(app).post('/api/reports').send({ lat: 1, lng: 1, category: 'other', metadata: [1] })).status).toBe(400);
  });
});

describe('usage', () => {
  test('track, stats and history are scoped to me', async () => {
    expect((await request(app).post('/api/usage/track').send({ event_type: 'nope' })).status).toBe(400);
    expect((await request(app).post('/api/usage/track').send({ event_type: 'app_open', value_num: 'abc' })).status).toBe(400);
    expect((await request(app).post('/api/usage/track').send({ event_type: 'app_open', value_text: 'v1' })).status).toBe(200);
    expect(opOf(tableCalls('usage_events')[0], 'insert').args[0].user_id).toBe(ME);

    mockResolver = () => ({
      data: [
        { event_type: 'app_open' }, { event_type: 'route_search' }, { event_type: 'navigation_start' },
        { event_type: 'navigation_complete', value_num: 1.5 }, { event_type: 'navigation_abandon' },
      ],
      error: null,
    });
    mockDb.calls.length = 0;
    const stats = await request(app).get('/api/usage/stats');
    expect(stats.body.completion_rate).toBe(50);
    expect(eqArg(tableCalls('usage_events')[0], 'user_id')).toBe(ME);

    mockDb.calls.length = 0;
    await request(app).get('/api/usage/history');
    expect(eqArg(tableCalls('usage_events')[0], 'user_id')).toBe(ME);
  });
});
