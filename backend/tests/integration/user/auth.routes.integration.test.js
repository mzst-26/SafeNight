/**
 * Security tests for the user-service auth routes and auth middleware.
 * Supabase is fully mocked; no live services are contacted.
 */
const express = require('express');
const request = require('supertest');

// ─── Mock Supabase ───────────────────────────────────────────────────────────
// A chainable query builder that records every operation so tests can assert
// which tables were read, written, or deleted.
const mockOps = [];
let mockTableRows = {};

function mockBuilder(table) {
  const op = { table, action: 'select', filters: [], payload: null };
  mockOps.push(op);
  const result = () => {
    const row = Object.prototype.hasOwnProperty.call(mockTableRows, table)
      ? mockTableRows[table]
      : null;
    return { data: op.action === 'select' ? row : null, error: null, count: 0 };
  };
  const b = {
    select: () => b,
    insert: (payload) => { op.action = 'insert'; op.payload = payload; return b; },
    update: (payload) => { op.action = 'update'; op.payload = payload; return b; },
    delete: () => { op.action = 'delete'; return b; },
    eq: (col, val) => { op.filters.push(['eq', col, val]); return b; },
    neq: (col, val) => { op.filters.push(['neq', col, val]); return b; },
    is: (col, val) => { op.filters.push(['is', col, val]); return b; },
    in: (col, val) => { op.filters.push(['in', col, val]); return b; },
    or: (expr) => { op.filters.push(['or', expr]); return b; },
    lt: () => b,
    gte: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return b;
}

const mockAuth = {
  getUser: jest.fn(),
  signInWithOtp: jest.fn(async () => ({ error: null })),
  signInWithPassword: jest.fn(),
  resetPasswordForEmail: jest.fn(async () => ({ error: null })),
  verifyOtp: jest.fn(),
  refreshSession: jest.fn(),
  admin: {
    getUserByEmail: jest.fn(),
    updateUserById: jest.fn(async () => ({ error: null })),
    signOut: jest.fn(async () => ({ error: null })),
    deleteUser: jest.fn(async () => ({ error: null })),
  },
};

jest.mock('../../../src/user/lib/supabase', () => ({
  supabase: { from: (table) => mockBuilder(table) },
  supabaseAuth: { auth: mockAuth },
}));

jest.mock('../../../src/shared/familyContacts', () => ({
  syncFamilyPackContacts: jest.fn(async () => {}),
}));

const mockRevokeFamilyPack = jest.fn(async () => {});
jest.mock('../../../src/user/routes/family', () => ({
  revokeFamilyPack: (...args) => mockRevokeFamilyPack(...args),
}));

const EXISTING = 'alice@example.com';
const MISSING = 'nobody@example.com';
const USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: EXISTING,
  email_confirmed_at: '2026-01-01T00:00:00Z',
};

function setDefaultAuthMocks() {
  mockAuth.getUser.mockImplementation(async (token) => {
    if (token === 'good-token') return { data: { user: USER }, error: null };
    if (token === 'unconfirmed-token') {
      return { data: { user: { ...USER, email_confirmed_at: null, confirmed_at: null } }, error: null };
    }
    return { data: { user: null }, error: { message: 'invalid JWT' } };
  });
  mockAuth.admin.getUserByEmail.mockImplementation(async (email) => (
    email === EXISTING
      ? { data: { user: { id: USER.id, email } }, error: null }
      : { data: { user: null }, error: { message: 'User not found' } }
  ));
  mockAuth.signInWithPassword.mockImplementation(async () => ({
    data: { session: null, user: null },
    error: { message: 'Invalid login credentials' },
  }));
}

// Re-require the router per test so its in-memory limiter and lockout
// stores start empty.
function createApp() {
  let router;
  jest.isolateModules(() => {
    router = require('../../../src/user/routes/auth');
  });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

beforeEach(() => {
  mockOps.length = 0;
  mockTableRows = {};
  setDefaultAuthMocks();
});

// ─── requireAuth contract ────────────────────────────────────────────────────
describe('requireAuth', () => {
  test('rejects a request with no Authorization header', async () => {
    const res = await request(createApp()).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('rejects a non-Bearer Authorization header', async () => {
    const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Basic abc');
    expect(res.status).toBe(401);
  });

  test('rejects a token Supabase does not accept (expired / other project)', async () => {
    const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer forged');
    expect(res.status).toBe(401);
    expect(mockAuth.getUser).toHaveBeenCalledWith('forged');
  });

  test('rejects when Supabase verification throws', async () => {
    mockAuth.getUser.mockImplementationOnce(async () => { throw new Error('network'); });
    const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer good-token');
    expect(res.status).toBe(401);
  });

  test('user id comes from the verified token, not the body', async () => {
    const res = await request(createApp())
      .post('/api/auth/update-profile')
      .set('Authorization', 'Bearer good-token')
      .send({ name: 'Bob', id: 'attacker-id', user_id: 'attacker-id' });
    expect(res.status).toBe(200);
    const upd = mockOps.find((o) => o.table === 'profiles' && o.action === 'update');
    expect(upd.filters).toContainEqual(['eq', 'id', USER.id]);
    expect(upd.payload).not.toHaveProperty('id');
  });
});

// ─── Account enumeration ─────────────────────────────────────────────────────
describe('account enumeration', () => {
  test('/options returns the same body for existing and unknown emails', async () => {
    const app = createApp();
    const a = await request(app).post('/api/auth/options').send({ email: EXISTING });
    const b = await request(app).post('/api/auth/options').send({ email: MISSING });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const strip = ({ email, ...rest }) => rest;
    expect(strip(b.body)).toEqual(strip(a.body));
  });

  test('/password-login gives the same status and error for unknown and wrong-password', async () => {
    const app = createApp();
    const wrong = await request(app).post('/api/auth/password-login').send({ email: EXISTING, password: 'wrongpass' });
    const unknown = await request(app).post('/api/auth/password-login').send({ email: MISSING, password: 'wrongpass' });
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  test('/forgot-password gives the same response for unknown and existing emails', async () => {
    const app = createApp();
    const known = await request(app).post('/api/auth/forgot-password').send({ email: EXISTING });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: MISSING });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
  });
});

// ─── Lockout bypass ──────────────────────────────────────────────────────────
describe('password lockout', () => {
  test('requesting a reset email does not lift an active lockout', async () => {
    const app = createApp();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/password-login').send({ email: EXISTING, password: 'wrongpass' });
    }
    const locked = await request(app).post('/api/auth/password-login').send({ email: EXISTING, password: 'wrongpass' });
    expect(locked.status).toBe(429);

    await request(app).post('/api/auth/forgot-password').send({ email: EXISTING });

    const after = await request(app).post('/api/auth/password-login').send({ email: EXISTING, password: 'guess-6' });
    expect(after.status).toBe(429);
    expect(after.body.locked_out).toBe(true);
  });
});

// ─── Family pack auto-link ───────────────────────────────────────────────────
describe('family pack auto-link', () => {
  function seedPendingInvite() {
    mockTableRows = {
      profiles: { id: USER.id, email: EXISTING, subscription: 'free' },
      subscriptions: { id: 'sub-1' },
      usage_events: { id: 'evt-1' },
      family_pack_members: { id: 'm-1', pack_id: 'p-1', user_id: null, status: 'pending' },
      family_packs: { id: 'p-1', status: 'active' },
    };
  }

  test('still claims a pending seat for a confirmed email', async () => {
    seedPendingInvite();
    await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer good-token');
    const claimed = mockOps.find((o) => o.table === 'family_pack_members' && o.action === 'update');
    expect(claimed).toBeDefined();
    expect(claimed.payload.user_id).toBe(USER.id);
  });
});

// ─── Account deletion ────────────────────────────────────────────────────────
describe('DELETE /api/auth/account', () => {
  test('deletes the user rows from the tables the app actually writes', async () => {
    const res = await request(createApp())
      .delete('/api/auth/account')
      .set('Authorization', 'Bearer good-token');
    expect(res.status).toBe(200);

    const deleted = mockOps.filter((o) => o.action === 'delete');
    const hasDelete = (table, col) => deleted.some(
      (o) => o.table === table && o.filters.some((f) => f[0] === 'eq' && f[1] === col && f[2] === USER.id),
    );
    expect(hasDelete('emergency_contacts', 'user_id')).toBe(true);
    expect(hasDelete('emergency_contacts', 'contact_id')).toBe(true);
    expect(hasDelete('live_sessions', 'user_id')).toBe(true);
    expect(hasDelete('safety_reports', 'user_id')).toBe(true);
    expect(hasDelete('reviews', 'user_id')).toBe(true);
    expect(hasDelete('route_shares', 'user_id')).toBe(true);
    expect(hasDelete('profiles', 'id')).toBe(true);
    expect(mockAuth.admin.deleteUser).toHaveBeenCalledWith(USER.id);
  });

  test('revokes every family pack the user owns so members are not left on it', async () => {
    mockTableRows = { family_packs: [{ id: 'pack-own-1' }, { id: 'pack-own-2' }] };
    const res = await request(createApp())
      .delete('/api/auth/account')
      .set('Authorization', 'Bearer good-token');
    expect(res.status).toBe(200);
    const ownedQuery = mockOps.find((o) => o.table === 'family_packs'
      && o.filters.some((f) => f[0] === 'eq' && f[1] === 'owner_id' && f[2] === USER.id));
    expect(ownedQuery).toBeDefined();
    expect(mockRevokeFamilyPack).toHaveBeenCalledWith('pack-own-1');
    expect(mockRevokeFamilyPack).toHaveBeenCalledWith('pack-own-2');
  });

  test('refuses without a valid token', async () => {
    const res = await request(createApp()).delete('/api/auth/account');
    expect(res.status).toBe(401);
    expect(mockAuth.admin.deleteUser).not.toHaveBeenCalled();
  });
});

// ─── Refresh rate limit ──────────────────────────────────────────────────────
describe('POST /api/auth/refresh', () => {
  test('is behind the strict per-IP auth limiter', async () => {
    mockAuth.refreshSession.mockImplementation(async () => ({
      data: { session: null }, error: { message: 'bad' },
    }));
    const app = createApp();
    let last;
    for (let i = 0; i < 21; i++) {
      last = await request(app).post('/api/auth/refresh').send({ refresh_token: `rt-${i}` });
    }
    expect(last.status).toBe(429);
  });
});
