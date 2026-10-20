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

  describe('check order and same-location refusal (final review F13/F16)', () => {
    // About 66 km and a box of roughly 1900 km2: over both the distance limit and the area limit.
    const FAR = {
      origin_lat: '50.0',
      origin_lng: '-4.0',
      dest_lat: '50.3',
      dest_lng: '-3.2',
    };

    test('GET: a far trip returns DESTINATION_OUT_OF_RANGE, not AREA_TOO_LARGE, with no upstream fetch', async () => {
      const res = await request(buildApp()).get('/api/safe-routes').query(FAR);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('DESTINATION_OUT_OF_RANGE');
      expect(res.body.maxDistanceKm).toBe(20);
      expect(typeof res.body.message).toBe('string');
      expectNoUpstreamFetch();
    });

    test('stream: a far trip returns DESTINATION_OUT_OF_RANGE, not AREA_TOO_LARGE, with no upstream fetch', async () => {
      const res = await request(buildApp()).get('/api/safe-routes/stream').query(FAR);

      expect(res.status).toBe(200);
      expect(res.text).toContain('DESTINATION_OUT_OF_RANGE');
      expect(res.text).not.toContain('AREA_TOO_LARGE');
      expectNoUpstreamFetch();
    });

    test('GET: a waypoint on a far trip is refused as out of range before the waypoint guard runs', async () => {
      const res = await request(buildApp())
        .get('/api/safe-routes')
        .query({ ...FAR, waypoint_lat: '50.15', waypoint_lng: '-3.6' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('DESTINATION_OUT_OF_RANGE');
      expectNoUpstreamFetch();
    });

    test('GET: origin equal to destination is refused with SAME_LOCATION and a message, no upstream fetch', async () => {
      const res = await request(buildApp())
        .get('/api/safe-routes')
        .query({ ...ROUTE, dest_lat: ROUTE.origin_lat, dest_lng: ROUTE.origin_lng });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('SAME_LOCATION');
      expect(typeof res.body.message).toBe('string');
      expectNoUpstreamFetch();
    });

    test('stream: origin equal to destination is refused with SAME_LOCATION, no upstream fetch', async () => {
      const res = await request(buildApp())
        .get('/api/safe-routes/stream')
        .query({ ...ROUTE, dest_lat: ROUTE.origin_lat, dest_lng: ROUTE.origin_lng });

      expect(res.status).toBe(200);
      expect(res.text).toContain('SAME_LOCATION');
      expectNoUpstreamFetch();
    });

    test('GET: an 18.5 km trip passes the guards and reaches the upstream road fetch', async () => {
      sourceFusion.fetchRoadNetwork.mockRejectedValueOnce(new Error('stop after guards'));

      const res = await request(buildApp())
        .get('/api/safe-routes')
        .query({ origin_lat: '51.00', origin_lng: '-0.12', dest_lat: '51.1665', dest_lng: '-0.12' });

      expect(res.body.error).not.toBe('DESTINATION_OUT_OF_RANGE');
      expect(res.body.error).not.toBe('AREA_TOO_LARGE');
      expect(sourceFusion.fetchRoadNetwork).toHaveBeenCalled();
    });
  });
});
