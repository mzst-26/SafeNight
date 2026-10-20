const {
  createSafeRoutesOrchestrator,
  MAX_ROUTE_CACHE_BYTES,
} = require('../../../../src/safety/routes/safeRoutesOrchestrator');

function makeOrchestrator({ result = () => ({ routes: [1] }), maxCacheBytes } = {}) {
  const computeSafeRoutes = jest.fn(async (oLat) => result(oLat));
  const orchestrator = createSafeRoutesOrchestrator({
    computeSafeRoutes,
    estimateRequestLoadUnits: () => 1,
    enqueueComputeJob: ({ run }) => run(),
    waitWithCancellation: async (promise) => promise,
    formatWaitMmSs: () => '00:05',
    ...(maxCacheBytes != null ? { maxCacheBytes } : {}),
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

describe('safeRoutesOrchestrator cache key and byte budget', () => {
  test('requests that differ only in maxDistanceKm are not served from one cache entry', async () => {
    // The response echoes maxDistanceKm in its meta, so the two answers differ.
    const { computeSafeRoutes, orchestrator } = makeOrchestrator();

    await orchestrator.resolveSafeRoutesRequest(params({ maxDistanceKm: 2 }));
    const second = await orchestrator.resolveSafeRoutesRequest(params({ maxDistanceKm: 5 }));

    expect(second.source).toBe('computed');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
  });

  test('the default cache budget is 64 MB', () => {
    expect(MAX_ROUTE_CACHE_BYTES).toBe(64 * 1024 * 1024);
  });

  test('the cache evicts the oldest entries once the byte budget is exceeded', async () => {
    // Each result serialises to roughly 600 bytes, so three of them exceed the 1500-byte budget.
    const { computeSafeRoutes, orchestrator } = makeOrchestrator({
      result: () => ({ payload: 'x'.repeat(600) }),
      maxCacheBytes: 1500,
    });

    await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.1 }));
    await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.2 }));
    await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.3 }));
    expect(computeSafeRoutes).toHaveBeenCalledTimes(3);

    const newest = await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.3 }));
    expect(newest.source).toBe('cache');

    const oldest = await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.1 }));
    expect(oldest.source).toBe('computed');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(4);
  });

  test('entries within the byte budget stay cached', async () => {
    const { computeSafeRoutes, orchestrator } = makeOrchestrator({
      result: () => ({ payload: 'x'.repeat(100) }),
      maxCacheBytes: 100000,
    });

    await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.1 }));
    const again = await orchestrator.resolveSafeRoutesRequest(params({ oLat: 50.1 }));

    expect(again.source).toBe('cache');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(1);
  });
});
