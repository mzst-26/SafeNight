const request = require('supertest');
const express = require('express');

jest.mock('../../../src/safety/services/sourceFusionEngine', () => ({
  fetchRoadNetwork: jest.fn(),
  fetchSafetyData: jest.fn(),
  fetchOsmOnlySafetyData: jest.fn(),
}));

jest.mock('../../../src/safety/services/crimeClient', () => ({
  fetchCrimesWithStatus: jest.fn(async () => ({ crimes: [], status: 'ok' })),
  fetchCrimesInBbox: jest.fn(async () => []),
}));

const sourceFusion = require('../../../src/safety/services/sourceFusionEngine');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/safe-routes', require('../../../src/safety/routes/safeRoutes'));
  return app;
}

/**
 * One residential street, node 10 at (50.37, -4.14) and node 11 about 1.4 km away. Both endpoints of the trip
 * sit a few metres from node 10, so they snap to the same graph node. The per-test shift keeps the
 * orchestrator cache from reusing an earlier answer.
 */
function mockOneStreet(shift) {
  const roads = {
    elements: [
      { type: 'way', id: 1, nodes: [10, 11], tags: { highway: 'residential' } },
      { type: 'node', id: 10, lat: 50.37 + shift, lon: -4.14 + shift },
      { type: 'node', id: 11, lat: 50.38 + shift, lon: -4.13 + shift },
    ],
  };
  const meta = { source: 'local_osm', reason: 'local-osm-primary' };
  sourceFusion.fetchRoadNetwork.mockResolvedValue({ ...roads, _sourceMeta: meta });
  sourceFusion.fetchSafetyData.mockResolvedValue({
    roads,
    lights: { elements: [] },
    cctv: { elements: [] },
    places: { elements: [] },
    transit: { elements: [] },
    _sourceMeta: { roads: meta, lights: meta, cctv: meta, places: meta, transit: meta },
  });
}

/** Origin on node 10, destination about 30 m north of it. */
function trip(shift) {
  return {
    origin_lat: String(50.37 + shift),
    origin_lng: String(-4.14 + shift),
    dest_lat: String(50.37 + shift + 0.00027),
    dest_lng: String(-4.14 + shift),
  };
}

describe('a trip whose endpoints snap to one graph node', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET refuses it with 400 SAME_LOCATION and returns no routes', async () => {
    mockOneStreet(0.0311);

    const res = await request(buildApp()).get('/api/safe-routes').query(trip(0.0311));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('SAME_LOCATION');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.routes).toBeUndefined();
  });

  test('the stream sends the same SAME_LOCATION error event', async () => {
    mockOneStreet(0.0312);

    const res = await request(buildApp())
      .get('/api/safe-routes/stream')
      .query(trip(0.0312))
      .buffer(true)
      .parse((response, callback) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => callback(null, body));
      });

    expect(res.body).toMatch(/event: error/);
    expect(res.body).toMatch(/"error":"SAME_LOCATION"/);
    expect(res.body).not.toMatch(/"routes"/);
  });
});
