/**
 * T-51 (SEC-03): POST /api/integrity/verify must require a valid bearer token,
 * so anonymous callers cannot spend the Play Integrity API quota.
 * Supabase and Google are fully mocked; no live services are contacted.
 */
const express = require('express');
const request = require('supertest');

const FAKE_USER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'user@example.test' };
const VALID_TOKEN = 'fake-valid-token';

let mockGetUserImpl = async () => ({ data: { user: null }, error: { message: 'invalid' } });
const mockGetUser = jest.fn((token) => mockGetUserImpl(token));

jest.mock('../../../src/user/lib/supabase', () => ({
  supabaseAuth: {
    auth: {
      getUser: (token) => mockGetUser(token),
    },
  },
  supabase: {},
}));

let mockPlayRequest = async () => ({
  data: {
    tokenPayloadExternal: {
      appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' },
      deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
    },
  },
});
const mockIntegrityRequest = jest.fn((opts) => mockPlayRequest(opts));

jest.mock('google-auth-library', () => ({
  GoogleAuth: function GoogleAuth() {
    return {
      getClient: async () => ({ request: (opts) => mockIntegrityRequest(opts) }),
    };
  },
}));

const integrityRouter = require('../../../src/gateway/routes/integrityVerify');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrity', integrityRouter);
  return app;
}

describe('T-51 POST /api/integrity/verify requires authentication', () => {
  beforeAll(() => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify({
      type: 'service_account',
      client_email: 'fake@example.test',
      private_key: 'fake-key',
    });
  });

  beforeEach(() => {
    mockGetUserImpl = async (token) =>
      token === VALID_TOKEN
        ? { data: { user: FAKE_USER }, error: null }
        : { data: { user: null }, error: { message: 'invalid' } };
  });

  test('returns 401 and does not call Play Integrity when no bearer token is sent', async () => {
    const res = await request(createApp())
      .post('/api/integrity/verify')
      .send({ token: 'integrity-token-from-anonymous-caller' });

    expect(res.status).toBe(401);
    expect(mockIntegrityRequest).not.toHaveBeenCalled();
  });

  test('returns 401 for an invalid bearer token', async () => {
    const res = await request(createApp())
      .post('/api/integrity/verify')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ token: 'integrity-token' });

    expect(res.status).toBe(401);
    expect(mockIntegrityRequest).not.toHaveBeenCalled();
  });

  test('with a valid bearer token the handler runs and returns the verdict', async () => {
    const res = await request(createApp())
      .post('/api/integrity/verify')
      .set('Authorization', `Bearer ${VALID_TOKEN}`)
      .send({ token: 'integrity-token' });

    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(true);
    expect(mockIntegrityRequest).toHaveBeenCalledTimes(1);
  });
});
