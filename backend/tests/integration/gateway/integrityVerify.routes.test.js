/**
 * Integration tests for gateway routes/integrityVerify.js: input validation
 * and the upstream Play Integrity call only. Google auth is mocked; auth on
 * this route is covered elsewhere and is not asserted here.
 */

const express = require('express');
const request = require('supertest');

jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn(),
}));

// Auth is stubbed as a pass-through so these tests cover validation and the
// upstream call only. The real middleware loads Supabase and exits without env.
jest.mock('../../../src/user/middleware/authMiddleware', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'fake-user-id' };
    next();
  },
}));

const FAKE_CREDENTIALS = JSON.stringify({
  type: 'service_account',
  client_email: 'fake-sa@example.test',
  private_key: 'fake-private-key',
});

let integrityRouter;
let mockUpstreamRequest;
let savedCredentials;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrity', integrityRouter);
  return app;
}

function verdictPayload({ app = 'PLAY_RECOGNIZED', device = ['MEETS_DEVICE_INTEGRITY'] } = {}) {
  return {
    data: {
      tokenPayloadExternal: {
        appIntegrity: { appRecognitionVerdict: app },
        deviceIntegrity: { deviceRecognitionVerdict: device },
        accountDetails: { appLicensingVerdict: 'LICENSED' },
      },
    },
  };
}

beforeEach(() => {
  savedCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = FAKE_CREDENTIALS;

  // Reset module state so the cached auth client does not leak between tests.
  jest.resetModules();
  const { GoogleAuth } = require('google-auth-library');
  mockUpstreamRequest = jest.fn(async () => verdictPayload());
  GoogleAuth.mockImplementation(() => ({
    getClient: async () => ({ request: mockUpstreamRequest }),
  }));
  integrityRouter = require('../../../src/gateway/routes/integrityVerify');
});

afterEach(() => {
  if (savedCredentials === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  else process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = savedCredentials;
});

describe('POST /api/integrity/verify input validation', () => {
  test('returns 400 when the body has no token', async () => {
    const res = await request(createApp()).post('/api/integrity/verify').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing or invalid integrity token' });
    expect(mockUpstreamRequest).not.toHaveBeenCalled();
  });

  test('returns 400 when the token is an empty string', async () => {
    const res = await request(createApp()).post('/api/integrity/verify').send({ token: '' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing or invalid integrity token' });
    expect(mockUpstreamRequest).not.toHaveBeenCalled();
  });

  test('returns 400 when the token is a number', async () => {
    const res = await request(createApp()).post('/api/integrity/verify').send({ token: 12345 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing or invalid integrity token' });
    expect(mockUpstreamRequest).not.toHaveBeenCalled();
  });

  test('returns 400 when the token is an array', async () => {
    const res = await request(createApp())
      .post('/api/integrity/verify')
      .send({ token: ['fake-token'] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing or invalid integrity token' });
    expect(mockUpstreamRequest).not.toHaveBeenCalled();
  });
});

describe('POST /api/integrity/verify upstream call', () => {
  test('sends the token to decodeIntegrityToken for the SafeNight package', async () => {
    await request(createApp()).post('/api/integrity/verify').send({ token: 'fake-token' });

    expect(mockUpstreamRequest).toHaveBeenCalledTimes(1);
    expect(mockUpstreamRequest).toHaveBeenCalledWith({
      url: 'https://playintegrity.googleapis.com/v1/com.safenight.app:decodeIntegrityToken',
      method: 'POST',
      data: { integrity_token: 'fake-token' },
    });
  });

  test('reports passed true when app is PLAY_RECOGNIZED and device meets integrity', async () => {
    const res = await request(createApp())
      .post('/api/integrity/verify')
      .send({ token: 'fake-token' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      passed: true,
      appRecognitionVerdict: 'PLAY_RECOGNIZED',
      deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
      accountDetails: { appLicensingVerdict: 'LICENSED' },
    });
  });

  test('reports passed false when the app is not recognised', async () => {
    mockUpstreamRequest.mockResolvedValueOnce(verdictPayload({ app: 'UNRECOGNIZED_VERSION' }));
    const res = await request(createApp())
      .post('/api/integrity/verify')
      .send({ token: 'fake-token' });

    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(false);
    expect(res.body.appRecognitionVerdict).toBe('UNRECOGNIZED_VERSION');
  });

  test('reports passed false and an empty device list when device verdicts are absent', async () => {
    mockUpstreamRequest.mockResolvedValueOnce({
      data: {
        tokenPayloadExternal: {
          appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' },
        },
      },
    });
    const res = await request(createApp())
      .post('/api/integrity/verify')
      .send({ token: 'fake-token' });

    expect(res.status).toBe(200);
    expect(res.body.passed).toBe(false);
    expect(res.body.deviceRecognitionVerdict).toEqual([]);
  });

  test('returns 502 when the upstream response has no tokenPayloadExternal', async () => {
    mockUpstreamRequest.mockResolvedValueOnce({ data: {} });
    const res = await request(createApp())
      .post('/api/integrity/verify')
      .send({ token: 'fake-token' });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Unexpected response from Play Integrity API' });
  });

  test('returns 500 with a generic body when the upstream call rejects', async () => {
    mockUpstreamRequest.mockRejectedValueOnce(new Error('fake upstream unavailable'));
    const res = await request(createApp())
      .post('/api/integrity/verify')
      .send({ token: 'fake-token' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Integrity verification failed' });
    expect(res.text).not.toContain('fake upstream unavailable');
    expect(res.text).not.toContain('    at ');
  });
});
