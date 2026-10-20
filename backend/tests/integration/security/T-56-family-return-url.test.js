/**
 * T-56 (SEC-19): POST /api/family/checkout must not use a client-supplied
 * return_url that is outside our allowlist.
 * Supabase is fully mocked; no live services are contacted.
 */
const express = require('express');
const request = require('supertest');

const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PACK_ID = 'pppppppp-pppp-4ppp-8ppp-pppppppppppp';
const ATTACKER_URL = 'https://attacker.example.test/steal-session';

function mockBuilder(table) {
  const result = () => {
    if (table === 'family_packs') {
      return {
        data: { id: PACK_ID, owner_id: OWNER_ID, max_members: 3, status: 'pending' },
        error: null,
      };
    }
    return { data: null, error: null };
  };
  const b = {
    select: () => b,
    eq: () => b,
    in: () => b,
    neq: () => b,
    single: async () => result(),
    maybeSingle: async () => result(),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return b;
}

jest.mock('../../../src/user/lib/supabase', () => ({
  supabase: { from: (table) => mockBuilder(table) },
  supabaseAuth: { auth: {} },
}));

jest.mock('../../../src/user/middleware/authMiddleware', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: OWNER_ID, email: 'owner@example.test' };
    next();
  },
}));

jest.mock('../../../src/shared/familyContacts', () => ({
  syncFamilyPackContacts: async () => {},
  removeFamilyPackContacts: async () => {},
}));

const familyRouter = require('../../../src/user/routes/family');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/family', familyRouter);
  app.use((err, _req, res, _next) => res.status(500).json({ error: 'internal' }));
  return app;
}

describe('T-56 family checkout ignores non-allowlisted return_url', () => {
  test('a non-allowlisted return_url is not used or echoed back', async () => {
    const res = await request(createApp())
      .post('/api/family/checkout')
      .send({ pack_id: PACK_ID, return_url: ATTACKER_URL });

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('attacker.example.test');
    expect(res.body.checkoutUrl).not.toContain('attacker.example.test');
  });
});
