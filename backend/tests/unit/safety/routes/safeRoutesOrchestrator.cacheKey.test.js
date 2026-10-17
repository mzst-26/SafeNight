const {
  createSafeRoutesOrchestrator,
} = require('../../../../src/safety/routes/safeRoutesOrchestrator');

function makeOrchestrator() {
  const computeSafeRoutes = jest.fn(async () => ({ routes: [1] }));
  const orchestrator = createSafeRoutesOrchestrator({
    computeSafeRoutes,
    estimateRequestLoadUnits: () => 1,
    enqueueComputeJob: ({ run }) => run(),
    waitWithCancellation: async (promise) => promise,
    formatWaitMmSs: () => '00:05',
  });
  return { computeSafeRoutes, orchestrator };
}

function params(responsePolicy) {
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
    responsePolicy,
  };
}

describe('safeRoutesOrchestrator cache key covers response policy', () => {
  test('requests that differ only in openPlacesOnly are not served from one cache entry', async () => {
    const { computeSafeRoutes, orchestrator } = makeOrchestrator();

    await orchestrator.resolveSafeRoutesRequest(params({ verbosity: 'full', openPlacesOnly: false, poiCaps: {} }));
    const second = await orchestrator.resolveSafeRoutesRequest(params({ verbosity: 'full', openPlacesOnly: true, poiCaps: {} }));

    expect(second.source).toBe('computed');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
  });

  test('an uncapped (Infinity) POI cap is not served from the default-cap entry', async () => {
    const { computeSafeRoutes, orchestrator } = makeOrchestrator();

    await orchestrator.resolveSafeRoutesRequest(params({ verbosity: 'full', openPlacesOnly: true, poiCaps: {} }));
    const second = await orchestrator.resolveSafeRoutesRequest(
      params({ verbosity: 'full', openPlacesOnly: true, poiCaps: { cctv: Infinity } }),
    );

    expect(second.source).toBe('computed');
    expect(computeSafeRoutes).toHaveBeenCalledTimes(2);
  });
});
