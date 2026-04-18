const express = require('express');
const request = require('supertest');

describe('GET /autocomplete validation', () => {
  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createApp() {
    const geocodeRouter = require('../../../src/geocode/routes/geocode');
    const app = express();
    app.use('/api/geocode', geocodeRouter);
    return app;
  }

  test('returns 400 when input is missing', async () => {
    const app = createApp();

    const response = await request(app).get('/api/geocode/autocomplete');

    expect(response.status).toBe(400);
  });

  test('returns 400 for invalid location bias latitude', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'Plymouth', lat: 120, lng: -4.14 });

    expect(response.status).toBe(400);
  });

  test('returns predictions for valid query and caches repeated request', async () => {
    const app = createApp();
    global.fetch.mockResolvedValue({
      json: async () => ([
        {
          osm_type: 'node',
          osm_id: 1,
          lat: '50.3700',
          lon: '-4.1400',
          display_name: 'Main St, Plymouth',
          name: 'Main St',
          importance: 0.8,
          address: {
            house_number: '10',
            road: 'Main St',
            city: 'Plymouth',
            postcode: 'PL1',
          },
        },
      ]),
    });

    const first = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'Main St' });
    const second = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'Main St' });

    expect(first.status).toBe(200);
    expect(first.body.status).toBe('OK');
    expect(first.body.predictions).toHaveLength(1);
    expect(first.body.predictions[0].structured_formatting.main_text).toContain('10 Main St');
    expect(second.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('runs structured address search for address-like inputs', async () => {
    const app = createApp();
    global.fetch
      .mockResolvedValueOnce({
        json: async () => ([
          {
            osm_type: 'node',
            osm_id: 11,
            lat: '50.3700',
            lon: '-4.1400',
            display_name: '431 Eggbuckland Road, Plymouth',
            importance: 0.7,
            address: { road: 'Eggbuckland Road', city: 'Plymouth' },
          },
        ]),
      })
      .mockResolvedValueOnce({
        json: async () => ([
          {
            osm_type: 'node',
            osm_id: 11,
            lat: '50.3700',
            lon: '-4.1400',
            display_name: '431 Eggbuckland Road, Plymouth',
            importance: 0.9,
            address: { house_number: '431', road: 'Eggbuckland Road', city: 'Plymouth' },
          },
        ]),
      });

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: '431 Eggbuckland Road' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('OK');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(response.body.predictions).toHaveLength(1);
  });

  test('returns 500 when upstream fetch fails', async () => {
    const app = createApp();
    global.fetch.mockRejectedValue(new Error('nominatim offline'));

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'Plymouth' });

    expect(response.status).toBe(500);
  });
});
