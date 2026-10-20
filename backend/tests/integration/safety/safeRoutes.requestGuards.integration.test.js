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
const crimeClient = require('../../../src/safety/services/crimeClient');

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = require('../../../src/safety/routes/safeRoutes');
  app.use('/api/safe-routes', router);
  return app;
}

function expectNoUpstreamFetch() {
  expect(sourceFusion.fetchRoadNetwork).not.toHaveBeenCalled();
  expect(sourceFusion.fetchSafetyData).not.toHaveBeenCalled();
  expect(crimeClient.fetchCrimesWithStatus).not.toHaveBeenCalled();
}

describe('safe-routes request guards (waypoint detour and search area)', () => {
  const ROUTE = {
    origin_lat: '51.50',
    origin_lng: '-0.12',
    dest_lat: '51.51',
    dest_lng: '-0.11',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('PoC: a waypoint at 51.5,4.5 is refused with 400 INVALID_WAYPOINT before any upstream fetch', async () => {
    const res = await request(buildApp())
      .get('/api/safe-routes')
      .query({ ...ROUTE, waypoint_lat: '51.5', waypoint_lng: '4.5' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_WAYPOINT');
    expectNoUpstreamFetch();
  });

  test('the stream endpoint refuses an oversized waypoint the same way, with no upstream fetch', async () => {
    const res = await request(buildApp())
      .get('/api/safe-routes/stream')
      .query({ ...ROUTE, waypoint_lat: '51.5', waypoint_lng: '4.5' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('INVALID_WAYPOINT');
    expectNoUpstreamFetch();
  });
});
