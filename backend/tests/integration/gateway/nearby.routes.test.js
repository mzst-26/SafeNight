/**
 * Integration tests for gateway routes/nearby.js (Overpass proxy).
 * Upstream fetch is mocked. No network calls.
 *
 * The router holds a module-level cache and rate limiter, so each test
 * reloads the module to start with an empty cache and a fresh limiter.
 */

const express = require('express');
const request = require('supertest');

let nearbyRouter;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/nearby', nearbyRouter);
  return app;
}

function mockOverpassJson(body) {
  global.fetch = jest.fn(async () => ({ json: async () => body }));
}

// Decode the form-encoded Overpass query sent in the upstream request body.
function overpassQueryFromCall(callIndex = 0) {
  const [, opts] = global.fetch.mock.calls[callIndex];
  return decodeURIComponent(opts.body.replace(/^data=/, ''));
}

beforeEach(() => {
  jest.resetModules();
  nearbyRouter = require('../../../src/gateway/routes/nearby');
  global.fetch = jest.fn();
});

describe('GET /api/nearby input validation', () => {
  test('returns 400 when lat is missing', async () => {
    const res = await request(createApp()).get('/api/nearby').query({ lng: -4.14 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid latitude: undefined' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 when lng is missing', async () => {
    const res = await request(createApp()).get('/api/nearby').query({ lat: 50.37 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid longitude: undefined' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 for latitude outside [-90, 90]', async () => {
    const res = await request(createApp()).get('/api/nearby').query({ lat: -91, lng: 0 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid latitude: -91' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 for a non-numeric longitude', async () => {
    const res = await request(createApp()).get('/api/nearby').query({ lat: 50, lng: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid longitude: abc' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('falls back to the default 200 m radius when radius is above the 500 m cap', async () => {
    mockOverpassJson({ elements: [] });
    const res = await request(createApp())
      .get('/api/nearby')
      .query({ lat: 50.37, lng: -4.14, radius: 9999 });

    expect(res.status).toBe(200);
    expect(overpassQueryFromCall()).toContain('(around:200,50.37,-4.14)');
  });

  test('uses a valid radius within the cap', async () => {
    mockOverpassJson({ elements: [] });
    await request(createApp()).get('/api/nearby').query({ lat: 50.37, lng: -4.14, radius: 300 });
    expect(overpassQueryFromCall()).toContain('(around:300,50.37,-4.14)');
  });
});

describe('GET /api/nearby upstream behaviour', () => {
  test('returns named places with normalised location and types, dropping unnamed elements', async () => {
    mockOverpassJson({
      elements: [
        { type: 'node', id: 1, lat: 50.37, lon: -4.14, tags: { name: 'Cafe A', amenity: 'cafe' } },
        { type: 'way', id: 2, center: { lat: 50.371, lon: -4.141 }, tags: { shop: 'bakery', brand: 'BakeCo' } },
        { type: 'node', id: 3, lat: 50.38, lon: -4.15, tags: {} },
        { type: 'node', id: 4, lat: 1, lon: 1, tags: { name: 'Pitch', leisure: 'sports_centre' } },
      ],
    });

    const res = await request(createApp())
      .get('/api/nearby')
      .query({ lat: 50.37, lng: -4.14 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.count).toBe(3);
    expect(res.body.results).toEqual([
      {
        place_id: 'osm-node-1',
        name: 'Cafe A',
        location: { lat: 50.37, lng: -4.14 },
        types: ['cafe'],
        open_now: true,
        business_status: 'OPERATIONAL',
      },
      {
        place_id: 'osm-way-2',
        name: 'BakeCo',
        location: { lat: 50.371, lng: -4.141 },
        types: ['shop', 'bakery'],
        open_now: true,
        business_status: 'OPERATIONAL',
      },
      {
        place_id: 'osm-node-4',
        name: 'Pitch',
        location: { lat: 1, lng: 1 },
        types: ['sports_centre'],
        open_now: true,
        business_status: 'OPERATIONAL',
      },
    ]);
  });

  test('returns ZERO_RESULTS with count 0 when Overpass has no elements', async () => {
    mockOverpassJson({ elements: [] });
    const res = await request(createApp())
      .get('/api/nearby')
      .query({ lat: 50.37, lng: -4.14 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ZERO_RESULTS', results: [], count: 0 });
  });

  test('posts the query to the Overpass interpreter as form data', async () => {
    mockOverpassJson({ elements: [] });
    await request(createApp()).get('/api/nearby').query({ lat: 50.37, lng: -4.14 });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  test('serves a repeat request for the same rounded coordinates from cache', async () => {
    mockOverpassJson({ elements: [{ type: 'node', id: 1, lat: 50.37, lon: -4.14, tags: { name: 'Cafe A' } }] });
    const app = createApp();

    const first = await request(app).get('/api/nearby').query({ lat: 50.37, lng: -4.14 });
    // 50.3704 and -4.1401 round to the same 3 dp cache key.
    const second = await request(app).get('/api/nearby').query({ lat: 50.3704, lng: -4.1401 });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(second.body).toEqual(first.body);
    expect(second.body.count).toBe(1);
  });

  test('does not reuse a cached result for a different radius', async () => {
    mockOverpassJson({ elements: [] });
    const app = createApp();

    await request(app).get('/api/nearby').query({ lat: 50.37, lng: -4.14, radius: 200 });
    await request(app).get('/api/nearby').query({ lat: 50.37, lng: -4.14, radius: 300 });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('returns 500 with a generic body when the Overpass fetch rejects', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('fake overpass connection refused');
    });
    const res = await request(createApp())
      .get('/api/nearby')
      .query({ lat: 50.37, lng: -4.14 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(res.text).not.toContain('fake overpass connection refused');
    expect(res.text).not.toContain('    at ');
  });

  test('returns 500 when the Overpass body is not JSON', async () => {
    global.fetch = jest.fn(async () => ({
      json: async () => {
        throw new SyntaxError('fake unexpected token <');
      },
    }));
    const res = await request(createApp())
      .get('/api/nearby')
      .query({ lat: 50.37, lng: -4.14 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

describe('GET /api/nearby rate limit', () => {
  test('rejects the 31st request in a minute with 429', async () => {
    mockOverpassJson({ elements: [] });
    const app = createApp();

    for (let i = 0; i < 30; i++) {
      const ok = await request(app).get('/api/nearby').query({ lat: 50.37, lng: -4.14 });
      expect(ok.status).toBe(200);
    }

    const limited = await request(app).get('/api/nearby').query({ lat: 50.37, lng: -4.14 });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      error: 'Nearby search rate limit exceeded — max 30 per minute.',
    });
  });
});
