/**
 * T-53 (SEC-17): raw Supabase error messages must not be echoed back to the
 * client. The status code is kept; the body gets a fixed message.
 * Supabase is fully mocked; no live services are contacted.
 */
const express = require('express');
const request = require('supertest');

const RAW_SUPABASE_MESSAGE = 'internal gotrue detail: pg_hba rejected host 10.0.0.7';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let mockOtpError = null;
let mockUpdateError = null;

jest.mock('../../../src/user/lib/supabase', () => ({
  supabase: {},
  supabaseAuth: {
    auth: {
      signInWithOtp: async () => ({ error: mockOtpError }),
      admin: {
        updateUserById: async () => ({ error: mockUpdateError }),
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

describe('T-53 Supabase error messages are not echoed to clients', () => {
  beforeEach(() => {
    mockOtpError = null;
    mockUpdateError = null;
  });

  test('magic-link: a raw Supabase error keeps 400 but returns a fixed message', async () => {
    mockOtpError = { message: RAW_SUPABASE_MESSAGE, status: 400 };

    const res = await request(createApp())
      .post('/api/auth/magic-link')
      .send({ email: 'user@example.test' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Request could not be completed.');
    expect(JSON.stringify(res.body)).not.toContain('pg_hba');
  });

  test('update-password: a raw Supabase error keeps 400 but returns a fixed message', async () => {
    mockUpdateError = { message: RAW_SUPABASE_MESSAGE, status: 422 };

    const res = await request(createApp())
      .post('/api/auth/update-password')
      .set('Authorization', 'Bearer fake-token')
      .send({ password: 'a-long-enough-password' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Request could not be completed.');
    expect(JSON.stringify(res.body)).not.toContain('pg_hba');
  });
});
