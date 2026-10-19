const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

function createApp() {
  let createCorsMiddleware;
  jest.isolateModules(() => {
    ({ createCorsMiddleware } = require('../../../../src/shared/middleware/cors'));
  });
  const app = express();
  app.use(createCorsMiddleware());
  app.get('/x', (_req, res) => res.json({ ok: true }));
  app.use((err, _req, res, _next) => res.status(403).json({ error: 'cors' }));
  return app;
}

describe('CORS middleware', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('production: allowed origin is reflected with credentials', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com/';
    const res = await request(createApp()).get('/x').set('Origin', 'https://app.example.com');
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('production: unknown origin gets no CORS grant', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    const res = await request(createApp()).get('/x').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('production with ALLOWED_ORIGINS unset fails closed (no wildcard-with-credentials)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOWED_ORIGINS;
    const res = await request(createApp()).get('/x').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('requests without an Origin (mobile app, server-to-server) still pass', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOWED_ORIGINS = 'https://app.example.com';
    const res = await request(createApp()).get('/x');
    expect(res.status).toBe(200);
  });
});

describe('trust proxy on public Express apps', () => {
  // Caddy is exactly one proxy hop in front of each service. trust proxy = 1
  // makes req.ip the client address Caddy saw, which the rate limiters key on.
  test.each(['gateway', 'user', 'geocode', 'safety', 'subscription'])('%s/server.js sets trust proxy to 1', (svc) => {
    const src = fs.readFileSync(path.join(__dirname, '../../../../src', svc, 'server.js'), 'utf8');
    expect(src).toMatch(/app\.set\(\s*['"]trust proxy['"]\s*,\s*1\s*\)/);
  });

  test('with trust proxy = 1, req.ip is the client address set by the single proxy hop', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.get('/ip', (req, res) => res.json({ ip: req.ip }));
    const res = await request(app).get('/ip').set('X-Forwarded-For', '1.2.3.4, 203.0.113.9');
    // A client-supplied left-most value (1.2.3.4) is ignored; only the hop Caddy appended is trusted.
    expect(res.body.ip).toBe('203.0.113.9');
  });
});
