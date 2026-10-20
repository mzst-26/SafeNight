const {
  createSafeRoutesOrchestrator,
  CRIME_OUTAGE_TTL_MS,
} = require('../../../../src/safety/routes/safeRoutesOrchestrator');

const FIVE_MIN = 5 * 60 * 1000;

function makeOrchestrator(result) {
  const computeSafeRoutes = jest.fn(async () => result);
  const orchestrator = createSafeRoutesOrchestrator({
    computeSafeRoutes,
    estimateRequestLoadUnits: () => 1,
    enqueueComputeJob: ({ run }) => run(),
    waitWithCancellation: async (promise) => promise,
    formatWaitMmSs: () => '00:05',
  });
  return { computeSafeRoutes, orchestrator };
}

function params(overrides = {}) {
  return {
    oLat: 50.37,
    oLng: -4.14,
    dLat: 50.38,
    dLng: -4.13,
    straightLineDist: 1000,
    straightLineKm: 1,
    maxDistanceKm: 2,
    wpLat: null,
    wpLng: null,
    cancelToken: null,
    responsePolicy: { verbosity: 'full', openPlacesOnly: true, poiCaps: {} },
    ...overrides,
  };
}

describe('safeRoutesOrchestrator route cache precision, options and outage TTL', () => {
  let nowMs;
  let dateSpy;

  beforeEach(() => {
    nowMs = 1_700_000_000_000;
    dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  describe('cache key precision (about 1 m, 1e-5 degrees)', () => {
    test('origins about 11 m apart are not served from one cache entry', async () => {
      const { computeSafeRoutes, orchestrator } = makeOrchestrator({ routes: [1] });

      await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.37 }));
      const second = await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.3701 }));

      expect(second.source).toBe('computed');
      expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
    });

    test('origins within about 1 m of each other share one cache entry', async () => {
      const { computeSafeRoutes, orchestrator } = makeOrchestrator({ routes: [1] });

      await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.37 }));
      const second = await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.370004 }));

      expect(second.source).toBe('cache');
      expect(computeSafeRoutes).toHaveBeenCalledTimes(1);
    });
  });

  describe('request options that change the response are part of the key', () => {
    test('a different departure hour is computed separately', async () => {
      const { computeSafeRoutes, orchestrator } = makeOrchestrator({ routes: [1] });

      await orchestrator.resolveSafeRoutesRequest(params({ departureHour: 2 }));
      const second = await orchestrator.resolveSafeRoutesRequest(params({ departureHour: 14 }));

      expect(second.source).toBe('computed');
      expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
    });

    test('allowing hazards is computed separately from the default', async () => {
      const { computeSafeRoutes, orchestrator } = makeOrchestrator({ routes: [1] });

      await orchestrator.resolveSafeRoutesRequest(params({ allowHazards: false }));
      const second = await orchestrator.resolveSafeRoutesRequest(params({ allowHazards: true }));

      expect(second.source).toBe('computed');
      expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
    });
  });

  describe('per-entry TTL for crime outage answers', () => {
    test('the outage TTL is 20 seconds', () => {
      expect(CRIME_OUTAGE_TTL_MS).toBe(20 * 1000);
    });

    test('an answer with meta.crimeStatus unavailable expires after 20 seconds', async () => {
      const { computeSafeRoutes, orchestrator } = makeOrchestrator({
        routes: [1],
        meta: { crimeStatus: 'unavailable' },
      });

      await orchestrator.resolveSafeRoutesRequest(params());
      nowMs += 10 * 1000;
      const within = await orchestrator.resolveSafeRoutesRequest(params());
      expect(within.source).toBe('cache');

      nowMs += 11 * 1000;
      const after = await orchestrator.resolveSafeRoutesRequest(params());
      expect(after.source).toBe('computed');
      expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
    });

    test('an answer with meta.dataQuality.crime unavailable also expires after 20 seconds', async () => {
      const { computeSafeRoutes, orchestrator } = makeOrchestrator({
        routes: [1],
        meta: { dataQuality: { crime: 'unavailable' } },
      });

      await orchestrator.resolveSafeRoutesRequest(params());
      nowMs += 21 * 1000;
      const after = await orchestrator.resolveSafeRoutesRequest(params());

      expect(after.source).toBe('computed');
      expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
    });

    test('a healthy answer keeps the 5 minute TTL', async () => {
      const { computeSafeRoutes, orchestrator } = makeOrchestrator({
        routes: [1],
        meta: { crimeStatus: 'ok' },
      });

      await orchestrator.resolveSafeRoutesRequest(params());
      nowMs += 60 * 1000;
      const within = await orchestrator.resolveSafeRoutesRequest(params());
      expect(within.source).toBe('cache');

      nowMs += FIVE_MIN;
      const after = await orchestrator.resolveSafeRoutesRequest(params());
      expect(after.source).toBe('computed');
      expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
    });
  });
});
