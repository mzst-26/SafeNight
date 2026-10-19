const request = require('supertest');
const express = require('express');

// Local OSM fails → route handler must fall back to Overpass and report it honestly.
jest.mock('../../../src/safety/services/sourceFusionEngine', () => ({
  fetchRoadNetwork: jest.fn(),
  fetchSafetyData: jest.fn(),
  fetchOsmOnlySafetyData: jest.fn(),
}));

jest.mock('../../../src/safety/services/overpassClient', () => ({
  fetchAllSafetyData: jest.fn(),
  fetchRoadNetworkOnly: jest.fn(),
  overpassQuery: jest.fn(),
}));

jest.mock('../../../src/safety/services/crimeClient', () => ({
  fetchCrimesInBbox: jest.fn(async () => []),
  fetchCrimesWithStatus: jest.fn(async () => ({ crimes: [], status: 'ok' })),
}));

const sourceFusion = require('../../../src/safety/services/sourceFusionEngine');
const overpassClient = require('../../../src/safety/services/overpassClient');

function overpassFixture() {
  return {
    roads: {
      elements: [
        { type: 'way', id: 1, nodes: [10, 11], tags: { highway: 'residential' } },
        { type: 'node', id: 10, lat: 50.37, lon: -4.14 },
        { type: 'node', id: 11, lat: 50.38, lon: -4.13 },
      ],
    },
    lights: { elements: [] },
    cctv: { elements: [] },
    places: { elements: [] },
    transit: { elements: [] },
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/safe-routes', require('../../../src/safety/routes/safeRoutes'));
  return app;
}

const QUERY = {
  origin_lat: 50.37,
  origin_lng: -4.14,
  dest_lat: 50.38,
  dest_lng: -4.13,
};

describe('safeRoutes Overpass fallback provenance', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('reports osm (not local_osm) for lights when local OSM fails and Overpass serves the data', async () => {
    sourceFusion.fetchSafetyData.mockRejectedValue(new Error('local ingestion down'));
    overpassClient.fetchAllSafetyData.mockResolvedValue(overpassFixture());

    const res = await request(buildApp()).get('/api/safe-routes').query(QUERY);

    expect(res.status).toBe(200);
    expect(overpassClient.fetchAllSafetyData).toHaveBeenCalled();
    expect(res.body.meta.sourceProvenance.lights.source).toBe('osm');
    expect(res.body.meta.dataQuality.freshness.lightsSource).toBe('osm');
  });

  test('reports local_osm for lights when local OSM serves the data', async () => {
    const fixture = overpassFixture();
    sourceFusion.fetchSafetyData.mockResolvedValue({
      ...fixture,
      _sourceMeta: {
        roads: { source: 'local_osm', reason: 'local-osm-primary' },
        lights: { source: 'local_osm', reason: 'local-osm-primary' },
        cctv: { source: 'local_osm', reason: 'local-osm-primary' },
        places: { source: 'local_osm', reason: 'local-osm-primary' },
        transit: { source: 'local_osm', reason: 'local-osm-primary' },
      },
    });

    const res = await request(buildApp()).get('/api/safe-routes').query({ ...QUERY, origin_lat: 50.3705 });

    expect(res.status).toBe(200);
    expect(overpassClient.fetchAllSafetyData).not.toHaveBeenCalled();
    expect(res.body.meta.dataQuality.freshness.lightsSource).toBe('local_osm');
  });
});
