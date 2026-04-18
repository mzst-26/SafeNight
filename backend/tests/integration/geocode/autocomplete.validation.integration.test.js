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

  test('returns 400 for invalid limit', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'Plymouth', limit: 'abc' });

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

  test('respects requested result limit and caps output length', async () => {
    const app = createApp();
    global.fetch.mockResolvedValue({
      json: async () => ([
        {
          osm_type: 'node',
          osm_id: 1,
          lat: '51.5000',
          lon: '-0.1200',
          display_name: 'Tesco Express 1, London',
          importance: 0.7,
          address: { shop: 'supermarket', road: 'Road 1', city: 'London' },
        },
        {
          osm_type: 'node',
          osm_id: 2,
          lat: '51.5001',
          lon: '-0.1201',
          display_name: 'Tesco Express 2, London',
          importance: 0.7,
          address: { shop: 'supermarket', road: 'Road 2', city: 'London' },
        },
        {
          osm_type: 'node',
          osm_id: 3,
          lat: '51.5002',
          lon: '-0.1202',
          display_name: 'Tesco Express 3, London',
          importance: 0.7,
          address: { shop: 'supermarket', road: 'Road 3', city: 'London' },
        },
      ]),
    });

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'Tesco', limit: 2 });

    expect(response.status).toBe(200);
    expect(response.body.predictions).toHaveLength(2);
  });

  test('biases branch ranking toward nearby user location', async () => {
    const app = createApp();
    global.fetch
      .mockResolvedValueOnce({
        json: async () => ({
          address: { city: 'London' },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ([
          {
            osm_type: 'node',
            osm_id: 10,
            lat: '51.6000',
            lon: '-0.2500',
            display_name: 'Tesco Superstore Far, London',
            importance: 0.9,
            address: { shop: 'supermarket', road: 'Far Road', city: 'London' },
          },
          {
            osm_type: 'node',
            osm_id: 11,
            lat: '51.5009',
            lon: '-0.1210',
            display_name: 'Tesco Express Near, London',
            importance: 0.7,
            address: { shop: 'supermarket', road: 'Near Road', city: 'London' },
          },
        ]),
      });

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'Tesco', lat: 51.5007, lng: -0.1209 });

    expect(response.status).toBe(200);
    expect(response.body.predictions[0].description).toContain('Near');
  });

  test('adds parking-focused search strategy for parking queries', async () => {
    const app = createApp();
    global.fetch
      .mockResolvedValueOnce({
        json: async () => ([
          {
            osm_type: 'node',
            osm_id: 20,
            lat: '51.5010',
            lon: '-0.1300',
            display_name: 'Oxford Street, London',
            importance: 0.8,
            address: { road: 'Oxford Street', city: 'London' },
          },
        ]),
      })
      .mockResolvedValueOnce({
        json: async () => ([
          {
            osm_type: 'node',
            osm_id: 21,
            lat: '51.5011',
            lon: '-0.1301',
            display_name: 'Oxford Street Car Park, London',
            importance: 0.6,
            class: 'amenity',
            type: 'parking',
            address: { amenity: 'parking', road: 'Oxford Street', city: 'London' },
          },
        ]),
      });

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'parking oxford street' });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(response.body.predictions[0].description.toLowerCase()).toContain('park');
  });

  test('returns 500 when upstream fetch fails', async () => {
    const app = createApp();
    global.fetch.mockRejectedValue(new Error('nominatim offline'));

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'Plymouth' });

    expect(response.status).toBe(500);
  });

  test('filters non-postcode searches to the current city when location bias is provided', async () => {
    const app = createApp();
    global.fetch
      .mockResolvedValueOnce({
        json: async () => ({
          address: { city: 'Plymouth' },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ([
          {
            osm_type: 'node',
            osm_id: 31,
            lat: '50.3720',
            lon: '-4.1420',
            display_name: 'Tesco Express, Plymouth',
            importance: 0.8,
            address: { shop: 'supermarket', city: 'Plymouth' },
          },
          {
            osm_type: 'node',
            osm_id: 32,
            lat: '51.5074',
            lon: '-0.1278',
            display_name: 'Tesco Express, London',
            importance: 0.9,
            address: { shop: 'supermarket', city: 'London' },
          },
        ]),
      });

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'Tesco', lat: 50.3714, lng: -4.1422 });

    expect(response.status).toBe(200);
    expect(response.body.predictions).toHaveLength(1);
    expect(response.body.predictions[0].description).toContain('Plymouth');
  });

  test('falls back to ranked business results when locality metadata filters everything out', async () => {
    const app = createApp();
    global.fetch
      .mockResolvedValueOnce({
        json: async () => ({
          address: { city: 'Plymouth' },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ([
          {
            osm_type: 'node',
            osm_id: 51,
            lat: '51.5074',
            lon: '-0.1278',
            display_name: 'Tesco Extra, London',
            importance: 0.8,
            address: { shop: 'supermarket' },
          },
        ]),
      });

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'Tesco', lat: 50.3714, lng: -4.1422 });

    expect(response.status).toBe(200);
    expect(response.body.predictions).toHaveLength(1);
    expect(response.body.predictions[0].description).toContain('Tesco');
  });

  test('keeps business results near current location when locality cannot be resolved', async () => {
    const app = createApp();
    global.fetch
      .mockResolvedValueOnce({
        json: async () => ({
          address: {},
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ([
          {
            osm_type: 'node',
            osm_id: 61,
            lat: '50.3720',
            lon: '-4.1420',
            display_name: 'Tesco Express, Plymouth',
            importance: 0.7,
            address: { shop: 'supermarket' },
          },
          {
            osm_type: 'node',
            osm_id: 62,
            lat: '51.7470',
            lon: '-0.3370',
            display_name: 'Tesco, St Albans',
            importance: 0.9,
            address: { shop: 'supermarket' },
          },
        ]),
      });

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'Tesco', lat: 50.3714, lng: -4.1422 });

    expect(response.status).toBe(200);
    expect(response.body.predictions).toHaveLength(1);
    expect(response.body.predictions[0].description).toContain('Plymouth');
  });

  test('uses strict local bounds for business queries with location bias', async () => {
    const app = createApp();
    global.fetch
      .mockResolvedValueOnce({
        json: async () => ({
          address: { city: 'Plymouth' },
        }),
      })
      .mockResolvedValueOnce({
        json: async () => ([]),
      });

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'Tesco', lat: 50.3714, lng: -4.1422 });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const searchUrl = String(global.fetch.mock.calls[1][0]);
    expect(searchUrl).toContain('bounded=1');
    expect(searchUrl).toContain('viewbox=');
  });

  test('expands category queries (e.g. restaurants) into related POI searches', async () => {
    const app = createApp();
    global.fetch
      .mockResolvedValueOnce({
        json: async () => ([]),
      })
      .mockResolvedValueOnce({
        json: async () => ([
          {
            osm_type: 'node',
            osm_id: 71,
            lat: '50.3718',
            lon: '-4.1417',
            display_name: 'Cafe Example, Plymouth',
            importance: 0.6,
            address: { amenity: 'cafe', city: 'Plymouth' },
          },
        ]),
      })
      .mockResolvedValue({
        json: async () => ([]),
      });

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'restaurants' });

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(5);

    const calledUrls = global.fetch.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((u) => u.includes('q=cafe'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('q=pub'))).toBe(true);
  });

  test('allows cross-city results when query contains a specific postcode', async () => {
    const app = createApp();
    global.fetch.mockResolvedValueOnce({
      json: async () => ([
        {
          osm_type: 'node',
          osm_id: 41,
          lat: '51.5074',
          lon: '-0.1278',
          display_name: '10 Downing Street, Westminster, London, SW1A 2AA',
          importance: 0.9,
          address: { house_number: '10', road: 'Downing Street', city: 'London', postcode: 'SW1A 2AA' },
        },
      ]),
    });

    const response = await request(app)
      .get('/api/geocode/autocomplete')
      .query({ input: 'SW1A 2AA', lat: 50.3714, lng: -4.1422 });

    expect(response.status).toBe(200);
    expect(response.body.predictions).toHaveLength(1);
    expect(response.body.predictions[0].description).toContain('SW1A 2AA');
  });
});
