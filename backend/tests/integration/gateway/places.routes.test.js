/**
 * Integration tests for gateway routes/places.js (Nominatim proxy).
 * Upstream fetch is mocked. No network calls.
 */

const express = require('express');
const request = require('supertest');

let placesRouter;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/places', placesRouter);
  return app;
}

function mockUpstreamJson(body) {
  global.fetch = jest.fn(async () => ({ json: async () => body }));
}

beforeEach(() => {
  // Reloads the module so the module-level Nominatim throttle state starts fresh.
  jest.resetModules();
  placesRouter = require('../../../src/gateway/routes/places');
  global.fetch = jest.fn();
});

describe('GET /api/places/autocomplete input validation', () => {
  test('returns 400 when input is missing', async () => {
    const res = await request(createApp()).get('/api/places/autocomplete');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing or empty input' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 when input is whitespace only', async () => {
    const res = await request(createApp()).get('/api/places/autocomplete').query({ input: '   ' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing or empty input' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 when input exceeds 300 characters', async () => {
    const res = await request(createApp())
      .get('/api/places/autocomplete')
      .query({ input: 'a'.repeat(301) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Input too long (max 300 chars)' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 for latitude above 90 when location bias is supplied', async () => {
    const res = await request(createApp())
      .get('/api/places/autocomplete')
      .query({ input: 'Royal', lat: 91, lng: 0 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid latitude: 91' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 for longitude above 180 when location bias is supplied', async () => {
    const res = await request(createApp())
      .get('/api/places/autocomplete')
      .query({ input: 'Royal', lat: 50, lng: 181 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid longitude: 181' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/places/autocomplete upstream behaviour', () => {
  test('maps Nominatim results to predictions with the OSM place_id format', async () => {
    mockUpstreamJson([
      {
        osm_type: 'node',
        osm_id: 123,
        lat: '50.37',
        lon: '-4.14',
        name: 'Royal Parade',
        display_name: 'Royal Parade, Plymouth, England',
      },
    ]);

    const res = await request(createApp())
      .get('/api/places/autocomplete')
      .query({ input: 'Royal Parade' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'OK',
      predictions: [
        {
          place_id: 'osm-node-123',
          description: 'Royal Parade, Plymouth, England',
          structured_formatting: {
            main_text: 'Royal Parade',
            secondary_text: 'Plymouth, England',
          },
          lat: 50.37,
          lng: -4.14,
        },
      ],
    });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('https://nominatim.openstreetmap.org/search?format=json&q=Royal%20Parade&limit=5');
    expect(opts.headers['User-Agent']).toBe('SafeNightHome/1.0');
  });

  test('returns ZERO_RESULTS with an empty predictions array', async () => {
    mockUpstreamJson([]);
    const res = await request(createApp())
      .get('/api/places/autocomplete')
      .query({ input: 'zzzz' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ZERO_RESULTS', predictions: [] });
  });

  test('adds a viewbox around the location when lat and lng are supplied', async () => {
    mockUpstreamJson([]);
    await request(createApp())
      .get('/api/places/autocomplete')
      .query({ input: 'Cafe', lat: 50, lng: -4 });

    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('&viewbox=-4.5,50.5,-3.5,49.5&bounded=0');
  });

  test('returns 500 with a generic body when the upstream fetch rejects', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('fake upstream reset');
    });
    const res = await request(createApp())
      .get('/api/places/autocomplete')
      .query({ input: 'Royal' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(res.text).not.toContain('fake upstream reset');
    expect(res.text).not.toContain('    at ');
  });

  test('returns 500 when the upstream body is not JSON', async () => {
    global.fetch = jest.fn(async () => ({
      json: async () => {
        throw new SyntaxError('fake unexpected token');
      },
    }));
    const res = await request(createApp())
      .get('/api/places/autocomplete')
      .query({ input: 'Royal' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

describe('GET /api/places/details', () => {
  test('returns 400 when place_id is missing', async () => {
    const res = await request(createApp()).get('/api/places/details');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing or empty placeId' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 for a place_id containing characters outside the allowed set', async () => {
    const res = await request(createApp())
      .get('/api/places/details')
      .query({ place_id: 'osm-node-1;DROP' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid placeId format' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns 400 for a place_id longer than 512 characters', async () => {
    const res = await request(createApp())
      .get('/api/places/details')
      .query({ place_id: 'a'.repeat(513) });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'placeId too long' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test.each([
    ['osm-node-123', 'N123'],
    ['osm-way-7', 'W7'],
    ['osm-relation-9', 'R9'],
  ])('looks up %s with osm_ids=%s', async (placeId, osmIds) => {
    mockUpstreamJson([{ lat: '50.37', lon: '-4.14', name: 'Place' }]);
    await request(createApp()).get('/api/places/details').query({ place_id: placeId });

    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain(`/lookup?format=json&osm_ids=${osmIds}&addressdetails=1`);
  });

  test('returns OK with name and geometry for a found OSM place', async () => {
    mockUpstreamJson([{ lat: '50.37', lon: '-4.14', name: 'Royal Parade', display_name: 'x' }]);
    const res = await request(createApp())
      .get('/api/places/details')
      .query({ place_id: 'osm-node-123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'OK',
      result: {
        place_id: 'osm-node-123',
        name: 'Royal Parade',
        geometry: { location: { lat: 50.37, lng: -4.14 } },
      },
    });
  });

  test('falls back to a text search for a non-OSM place_id', async () => {
    mockUpstreamJson([]);
    await request(createApp()).get('/api/places/details').query({ place_id: 'legacy123' });

    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('/search?format=json&q=legacy123&limit=1');
  });

  test('returns NOT_FOUND with null result when upstream has no match', async () => {
    mockUpstreamJson([]);
    const res = await request(createApp())
      .get('/api/places/details')
      .query({ place_id: 'osm-node-999' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'NOT_FOUND', result: null });
  });

  test('returns 500 with a generic body when the upstream fetch rejects', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('fake upstream timeout');
    });
    const res = await request(createApp())
      .get('/api/places/details')
      .query({ place_id: 'osm-node-123' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(res.text).not.toContain('fake upstream timeout');
    expect(res.text).not.toContain('    at ');
  });
});
