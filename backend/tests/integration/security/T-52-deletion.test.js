/**
 * T-52 (SEC-05): DELETE /api/auth/account must not delete the Supabase auth
 * user when any table delete failed, so the user can retry the deletion.
 * Supabase and Stripe are fully mocked; no live services are contacted.
 */
const express = require('express');
const request = require('supertest');

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

// Table whose delete should fail in the failure scenario; null means all succeed.
let failingTable = null;
const deleteUserCalls = [];

function mockBuilder(table) {
  let op = 'select';
  const result = () => {
    if (op === 'delete' && table === failingTable) {
      return { data: null, error: { message: 'connection reset by db-host-internal' } };
    }
    return { data: null, error: null };
  };
  const b = {
    select: () => b,
    insert: () => { op = 'insert'; return b; },
    update: () => { op = 'update'; return b; },
    delete: () => { op = 'delete'; return b; },
    eq: () => b,
    neq: () => b,
    in: () => b,
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return b;
}

jest.mock('../../../src/user/lib/supabase', () => ({
  supabase: { from: (table) => mockBuilder(table) },
  supabaseAuth: {
    auth: {
      admin: {
        deleteUser: async (id) => {
          deleteUserCalls.push(id);
          return { error: null };
        },
      },
    },
  },
}));

jest.mock('../../../src/user/middleware/authMiddleware', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: USER_ID, email: 'user@example.test' };
    next();
  },
}));

jest.mock('../../../src/shared/familyContacts', () => ({
  syncFamilyPackContacts: async () => {},
}));

const authRouter = require('../../../src/user/routes/auth');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ error: 'internal' }));
  return app;
}

describe('T-52 account deletion only removes the auth user after all table deletes succeed', () => {
  beforeEach(() => {
    failingTable = null;
    deleteUserCalls.length = 0;
  });

  test('returns 500 with a generic message and does not call deleteUser when a table delete fails', async () => {
    failingTable = 'reviews';

    const res = await request(createApp()).delete('/api/auth/account');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Account deletion could not be completed. Please try again.');
    expect(JSON.stringify(res.body)).not.toContain('db-host-internal');
    expect(deleteUserCalls).toHaveLength(0);
  });

  test('calls deleteUser exactly once when every table delete succeeds', async () => {
    failingTable = null;

    const res = await request(createApp()).delete('/api/auth/account');

    expect(res.status).toBe(200);
    expect(deleteUserCalls).toEqual([USER_ID]);
  });
});
