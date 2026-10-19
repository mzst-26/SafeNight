const express = require('express');
const request = require('supertest');
const { createSupabaseMock, opOf } = require('../../helpers/supabaseMock');

let mockUserId = 'owner-1';
const mockDb = createSupabaseMock((q) => {
  if (q.table === 'profiles') return { data: { id: mockUserId, email: 'owner@example.com', name: 'Owner' }, error: null };
  if (q.table === 'family_packs' && opOf(q, 'insert')) {
    return { data: { id: 'pack-1', ...opOf(q, 'insert').args[0] }, error: null };
  }
  return { data: null, error: null };
});
mockDb.supabase.auth = { admin: { inviteUserByEmail: jest.fn(async () => ({ data: {}, error: null })) } };

jest.mock('../../../src/user/lib/supabase', () => ({ supabase: mockDb.supabase }));
jest.mock('../../../src/user/middleware/authMiddleware', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: mockUserId };
    next();
  },
}));
jest.mock('../../../src/shared/familyContacts', () => ({
  syncFamilyPackContacts: jest.fn(),
  removeFamilyPackContacts: jest.fn(),
}));

function createApp() {
  let router;
  jest.isolateModules(() => {
    router = require('../../../src/user/routes/family');
  });
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/family', router);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

describe('family routes input validation', () => {
  beforeEach(() => {
    mockDb.calls.length = 0;
    mockDb.supabase.auth.admin.inviteUserByEmail.mockClear();
  });

  test('non-string member email is a 400, not a 500', async () => {
    const res = await request(createApp())
      .post('/api/family/create')
      .send({ members: [{ email: 123 }, { email: 'b@example.com' }] });
    expect(res.status).toBe(400);
  });

  test('non-string add-member email is a 400, not a 500', async () => {
    const res = await request(createApp()).post('/api/family/add-member').send({ email: ['x@example.com'] });
    expect(res.status).toBe(400);
  });

  test('pack name and member names are length-capped before storage', async () => {
    const long = 'x'.repeat(5000);
    const res = await request(createApp())
      .post('/api/family/create')
      .send({ name: long, members: [{ email: 'a@example.com', name: long }, { email: 'b@example.com', name: long }] });
    expect(res.status).toBe(200);
    const packInsert = mockDb.calls.find((q) => q.table === 'family_packs' && opOf(q, 'insert'));
    expect(opOf(packInsert, 'insert').args[0].name.length).toBeLessThanOrEqual(100);
    const memberInsert = mockDb.calls.find(
      (q) => q.table === 'family_pack_members' && opOf(q, 'insert') && Array.isArray(opOf(q, 'insert').args[0]),
    );
    for (const row of opOf(memberInsert, 'insert').args[0]) {
      expect(row.name.length).toBeLessThanOrEqual(100);
    }
  });

  test('duplicate member emails in one create request are rejected', async () => {
    const res = await request(createApp())
      .post('/api/family/create')
      .send({ members: [{ email: 'a@example.com' }, { email: 'A@example.com ' }] });
    expect(res.status).toBe(400);
    expect(mockDb.supabase.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  test('invite-sending routes have a per-user hourly cap (email spam)', async () => {
    const app = createApp();
    const statuses = [];
    for (let i = 0; i < 25; i += 1) {
      const res = await request(app).post('/api/family/add-member').send({ email: 'not-an-email' });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    // A different user is not affected.
    mockUserId = 'owner-2';
    const other = await request(app).post('/api/family/add-member').send({ email: 'not-an-email' });
    expect(other.status).toBe(400);
    mockUserId = 'owner-1';
  });
});
