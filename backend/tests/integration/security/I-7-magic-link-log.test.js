/**
 * I-7: the magic-link failure log must not contain the full Supabase error
 * object, the raw message, the email address or any token. Only the status and
 * a short code are logged.
 * Supabase is fully mocked; no live services are contacted.
 */
const express = require('express');
const request = require('supertest');

const EMAIL = 'user@example.test';
const RAW_MESSAGE = `User ${EMAIL} rejected by provider, token FAKE-TOKEN-xyz-123`;

let mockOtpError = null;

jest.mock('../../../src/user/lib/supabase', () => ({
  supabase: {},
  supabaseAuth: {
    auth: {
      signInWithOtp: async () => ({ error: mockOtpError }),
      admin: {
        updateUserById: async () => ({ error: null }),
      },
    },
  },
}));

jest.mock('../../../src/user/middleware/authMiddleware', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: EMAIL };
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

describe('I-7 magic-link error logging', () => {
  let errorSpy;

  beforeEach(() => {
    mockOtpError = null;
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('logs only status and a short code, never the email, raw message or full error object', async () => {
    mockOtpError = { message: RAW_MESSAGE, status: 400, code: 'otp_disabled' };

    const res = await request(createApp())
      .post('/api/auth/magic-link')
      .send({ email: EMAIL });

    expect(res.status).toBe(400);
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map((args) => JSON.stringify(args)).join('\n');
    expect(logged).toContain('400');
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain('user@example');
    expect(logged).not.toContain('FAKE-TOKEN-xyz-123');
    expect(logged).not.toContain('rejected by provider');
  });
});
