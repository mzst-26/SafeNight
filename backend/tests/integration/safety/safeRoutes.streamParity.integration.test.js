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

  describe('leave_at / arrive_by', () => {
    const inHours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
    const { departure_hour: _ignored, ...BASE_QUERY } = QUERY;

    test('both endpoints hand leave_at to the orchestrator as epoch ms', async () => {
      const leave = inHours(2);
      await request(buildApp()).get('/api/safe-routes').query({ ...BASE_QUERY, leave_at: leave });
      await request(buildApp()).get('/api/safe-routes/stream').query({ ...BASE_QUERY, leave_at: leave });

      expect(mockResolveCalls).toHaveLength(2);
      for (const call of mockResolveCalls) {
        expect(call.leaveAtMs).toBe(Date.parse(leave));
        expect(call.arriveByMs).toBeNull();
      }
    });

    test('both endpoints hand arrive_by through', async () => {
      const arrive = inHours(3);
      await request(buildApp()).get('/api/safe-routes').query({ ...BASE_QUERY, arrive_by: arrive });
      await request(buildApp()).get('/api/safe-routes/stream').query({ ...BASE_QUERY, arrive_by: arrive });

      for (const call of mockResolveCalls) {
        expect(call.arriveByMs).toBe(Date.parse(arrive));
        expect(call.leaveAtMs).toBeNull();
      }
    });

    test.each([
      ['no offset', { leave_at: '2026-10-21T17:10:00' }, 'INVALID_TIME'],
      ['both params', { leave_at: new Date(Date.now() + 3_600_000).toISOString(), arrive_by: new Date(Date.now() + 7_200_000).toISOString() }, 'INVALID_TIME'],
      ['too far ahead', { leave_at: new Date(Date.now() + 48 * 3_600_000).toISOString() }, 'TIME_OUT_OF_RANGE'],
    ])('%s: GET answers 400 and the stream emits the same code', async (_name, extra, code) => {
      const res = await request(buildApp()).get('/api/safe-routes').query({ ...BASE_QUERY, ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(code);
      expect(typeof res.body.message).toBe('string');

      const stream = await request(buildApp()).get('/api/safe-routes/stream').query({ ...BASE_QUERY, ...extra });
      expect(stream.text).toContain('event: error');
      expect(stream.text).toContain(`"error":"${code}"`);
      expect(mockResolveCalls).toHaveLength(0);
    });
  });
});
