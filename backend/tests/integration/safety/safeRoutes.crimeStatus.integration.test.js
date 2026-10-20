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

// The real graph and scoring run. buildGraph is wrapped only so the test can read the options it receives.
jest.mock('../../../src/safety/services/safetyGraph', () => {
  const actual = jest.requireActual('../../../src/safety/services/safetyGraph');
  return {
    ...actual,
    buildGraph: jest.fn(actual.buildGraph),
  };
});

const sourceFusion = require('../../../src/safety/services/sourceFusionEngine');
const crimeClient = require('../../../src/safety/services/crimeClient');
const safetyGraph = require('../../../src/safety/services/safetyGraph');

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = require('../../../src/safety/routes/safeRoutes');
  app.use('/api/safe-routes', router);
  return app;
}

/** Local OSM fixture for one residential street. Shift lat/lng per test so the orchestrator cache is not reused. */
function mockOneStreet(shift = 0) {
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
    _sourceMeta: {
      roads: meta,
      lights: meta,
      cctv: meta,
      places: meta,
      transit: meta,
    },
  });
}

function query(shift) {
  return {
    origin_lat: 50.37 + shift,
    origin_lng: -4.14 + shift,
    dest_lat: 50.38 + shift,
    dest_lng: -4.13 + shift,
  };
}

describe('safeRoutes crime status wiring', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('passes crimeStatus and now into buildGraph when the crime source is unavailable', async () => {
    const app = buildApp();
    mockOneStreet(0.0101);
    crimeClient.fetchCrimesWithStatus.mockResolvedValueOnce({ crimes: [], status: 'unavailable' });

    const res = await request(app).get('/api/safe-routes').query(query(0.0101));

    expect(res.status).toBe(200);
    expect(safetyGraph.buildGraph).toHaveBeenCalled();
    const options = safetyGraph.buildGraph.mock.calls[0][7];
    expect(options.crimeStatus).toBe('unavailable');
    expect(options.now).toBeInstanceOf(Date);
  });

  test('passes crimeStatus ok when the crime source answered', async () => {
    const app = buildApp();
    mockOneStreet(0.0202);
    crimeClient.fetchCrimesWithStatus.mockResolvedValueOnce({ crimes: [], status: 'ok' });

    const res = await request(app).get('/api/safe-routes').query(query(0.0202));

    expect(res.status).toBe(200);
    expect(safetyGraph.buildGraph.mock.calls[0][7].crimeStatus).toBe('ok');
  });

  test('the response carries crime status in meta and on each route', async () => {
    const app = buildApp();
    mockOneStreet(0.0404);
    crimeClient.fetchCrimesWithStatus.mockResolvedValueOnce({ crimes: [], status: 'unavailable' });

    const res = await request(app).get('/api/safe-routes').query(query(0.0404));

    expect(res.status).toBe(200);
    expect(res.body.meta.dataQuality).toMatchObject({
      crime: 'unavailable',
      lighting: expect.stringMatching(/^(verified|mixed|estimated)$/),
    });
    const [route] = res.body.routes;
    expect(route.safety.dataQuality).toEqual({
      crime: 'unavailable',
      lighting: res.body.meta.dataQuality.lighting,
    });
    expect(route.safety.reason).toEqual(expect.any(String));
    expect(route.segments[0].color).toMatch(/^#[0-9A-F]{6}$/i);
    expect(route.segments[0]).toMatchObject({ risk: expect.any(Number), litEstimate: expect.any(String) });
    expect(route.routeStats.crimeCount).toBe(0);
  });
});

describe('safeRoutes request hardening', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('max_distance that is not a number is rejected with INVALID_MAX_DISTANCE', async () => {
    const app = buildApp();

    const res = await request(app)
      .get('/api/safe-routes')
      .query({ ...query(0.0505), max_distance: 'abc' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_MAX_DISTANCE');
    expect(res.body.message).toMatch(/max_distance/);
    expect(sourceFusion.fetchRoadNetwork).not.toHaveBeenCalled();
  });

  test('the SSE stream reports INVALID_MAX_DISTANCE as an error event with a message', async () => {
    const app = buildApp();

    const res = await request(app)
      .get('/api/safe-routes/stream')
      .query({ ...query(0.0707), max_distance: 'abc' })
      .buffer(true)
      .parse((response, callback) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => callback(null, body));
      });

    expect(res.body).toMatch(/event: error/);
    expect(res.body).toMatch(/INVALID_MAX_DISTANCE/);
    expect(res.body).toMatch(/max_distance/);
    expect(sourceFusion.fetchRoadNetwork).not.toHaveBeenCalled();
  });

  test('an empty origin_lat is rejected instead of being read as 0', async () => {
    const app = buildApp();

    const res = await request(app)
      .get('/api/safe-routes')
      .query({ ...query(0.0606), origin_lat: '' });

    expect(res.status).toBe(400);
    expect(sourceFusion.fetchRoadNetwork).not.toHaveBeenCalled();
  });
});
