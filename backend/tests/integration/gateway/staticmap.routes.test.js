/**
 * Integration tests for gateway routes/staticmap.js (OSM static map proxy).
 * Upstream fetch is mocked. No network calls.
 *
 * The route builds its upstream URL from a fixed host. It takes no host or
 * URL parameter, so there is no host allowlist to enforce; the host-fixed
 * test below documents that. Width and height are capped at 2048 px.
 */

const express = require('express');
const request = require('supertest');

let staticmapRouter;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/staticmap', staticmapRouter);
  return app;
}

const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function mockUpstreamImage({ ok = true, status = 200 } = {}) {
  global.fetch = jest.fn(async () => ({
    ok,
    status,
    headers: new Headers({ 'content-type': 'image/png' }),
    arrayBuffer: async () => PNG_BYTES.buffer.slice(0),
  }));
}

beforeEach(() => {
  jest.resetModules();
  staticmapRouter = require('../../../src/gateway/routes/staticmap');
  global.fetch = jest.fn();
});

describe('GET /api/staticmap dimension validation', () => {
  test('returns 400 when width is missing', async () => {
    const res = await request(createApp()).get('/api/staticmap').query({ height: 400 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid width: undefined' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 when height is missing', async () => {
    const res = await request(createApp()).get('/api/staticmap').query({ width: 600 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid height: undefined' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 for a zero width', async () => {
    const res = await request(createApp()).get('/api/staticmap').query({ width: 0, height: 400 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid width: 0' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 for a negative height', async () => {
    const res = await request(createApp()).get('/api/staticmap').query({ width: 600, height: -5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid height: -5' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 for a width above the 2048 px cap', async () => {
    const res = await request(createApp()).get('/api/staticmap').query({ width: 2049, height: 400 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid width: 2049' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 for a height above the 2048 px cap', async () => {
    const res = await request(createApp()).get('/api/staticmap').query({ width: 600, height: 5000 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid height: 5000' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 for a non-numeric width', async () => {
    const res = await request(createApp()).get('/api/staticmap').query({ width: 'wide', height: 400 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid width: wide' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('accepts exactly 2048 px on each axis (boundary)', async () => {
    mockUpstreamImage();
    const res = await request(createApp())
      .get('/api/staticmap')
      .query({ width: 2048, height: 2048 });
    expect(res.status).toBe(200);
    expect(global.fetch.mock.calls[0][0]).toContain('size=2048x2048');
  });
});

describe('GET /api/staticmap upstream URL and host', () => {
  test('requests the fixed OSM static map host with the default London centre', async () => {
    mockUpstreamImage();
    await request(createApp()).get('/api/staticmap').query({ width: 600, height: 400 });

    expect(global.fetch.mock.calls[0][0]).toBe(
      'https://staticmap.openstreetmap.de/staticmap.php?center=51.5072,-0.1276&zoom=14&size=600x400&maptype=mapnik',
    );
  });

  test('ignores host and url query parameters and always uses the OSM host', async () => {
    // Documents current behaviour: the route has no host allowlist because
    // it never forwards a caller-supplied host.
    mockUpstreamImage();
    await request(createApp())
      .get('/api/staticmap')
      .query({ width: 600, height: 400, host: 'evil.example', url: 'https://evil.example/x.png' });

    const upstream = new URL(global.fetch.mock.calls[0][0]);
    expect(upstream.hostname).toBe('staticmap.openstreetmap.de');
    expect(global.fetch.mock.calls[0][0]).not.toContain('evil.example');
  });

  test('centres on the origin when only origin coordinates are supplied', async () => {
    mockUpstreamImage();
    await request(createApp())
      .get('/api/staticmap')
      .query({ width: 600, height: 400, origin_lat: 50.37, origin_lng: -4.14 });

    expect(global.fetch.mock.calls[0][0]).toContain('center=50.37,-4.14&zoom=14');
  });

  test('centres between origin and destination and widens zoom to 12 for a large spread', async () => {
    mockUpstreamImage();
    await request(createApp())
      .get('/api/staticmap')
      .query({ width: 600, height: 400, origin_lat: 50, origin_lng: -4, dest_lat: 51, dest_lng: -4 });

    expect(global.fetch.mock.calls[0][0]).toContain('center=50.5,-4&zoom=12');
  });

  test('falls back to the default centre when origin latitude is out of range', async () => {
    // Invalid origin coordinates are ignored and the default centre is used.
    mockUpstreamImage();
    const res = await request(createApp())
      .get('/api/staticmap')
      .query({ width: 600, height: 400, origin_lat: 200, origin_lng: -4 });

    expect(res.status).toBe(200);
    expect(global.fetch.mock.calls[0][0]).toContain('center=51.5072,-0.1276');
  });
});

describe('GET /api/staticmap responses', () => {
  test('streams the upstream image with content type and 24h cache header', async () => {
    mockUpstreamImage();
    const res = await request(createApp())
      .get('/api/staticmap')
      .query({ width: 600, height: 400 })
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    expect(Buffer.compare(res.body, Buffer.from(PNG_BYTES))).toBe(0);
  });

  test('passes through a non-OK upstream status with a generic error body', async () => {
    mockUpstreamImage({ ok: false, status: 503 });
    const res = await request(createApp())
      .get('/api/staticmap')
      .query({ width: 600, height: 400 });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Static map request failed' });
  });

  test('returns 500 with a generic body when the upstream fetch rejects', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('fake tile server reset');
    });
    const res = await request(createApp())
      .get('/api/staticmap')
      .query({ width: 600, height: 400 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(res.text).not.toContain('fake tile server reset');
    expect(res.text).not.toContain('    at ');
  });
});
