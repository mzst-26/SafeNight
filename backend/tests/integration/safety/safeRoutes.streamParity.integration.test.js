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

// Wrap the orchestrator so the tests see exactly what each endpoint hands to it. The computation itself is
// stubbed: these tests are about the arguments, and the real compute path reaches the network.
const mockResolveCalls = [];
jest.mock('../../../src/safety/routes/safeRoutesOrchestrator', () => {
  const actual = jest.requireActual('../../../src/safety/routes/safeRoutesOrchestrator');
  return {
    ...actual,
    createSafeRoutesOrchestrator: (deps) => {
      const real = actual.createSafeRoutesOrchestrator(deps);
      return {
        ...real,
        resolveSafeRoutesRequest: async (args) => {
          mockResolveCalls.push(args);
          return { result: { status: 'OK', routes: [] }, source: 'computed' };
        },
      };
    },
  };
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/safe-routes', require('../../../src/safety/routes/safeRoutes'));
  return app;
}

const QUERY = {
  origin_lat: '51.50',
  origin_lng: '-0.12',
  dest_lat: '51.51',
  dest_lng: '-0.11',
  departure_hour: '2',
  allow_hazards: 'true',
};

describe('safe-routes GET and stream hand the same options to the orchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveCalls.length = 0;
  });

  test('GET passes departure hour and hazard flag through', async () => {
    await request(buildApp()).get('/api/safe-routes').query(QUERY);

    expect(mockResolveCalls).toHaveLength(1);
    expect(mockResolveCalls[0].departureHour).toBe(2);
    expect(mockResolveCalls[0].allowHazards).toBe(true);
  });

  test('stream passes the same departure hour and hazard flag as GET', async () => {
    await request(buildApp()).get('/api/safe-routes/stream').query(QUERY);

    expect(mockResolveCalls).toHaveLength(1);
    expect(mockResolveCalls[0].departureHour).toBe(2);
    expect(mockResolveCalls[0].allowHazards).toBe(true);
  });
});
