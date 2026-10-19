/* eslint-env jest */
const {
  buildSafeRoutesMeta,
} = require('../../../../src/safety/routes/safeRoutesMetaBuilder');

function baseArgs(overrides = {}) {
  return {
    straightLineKm: 1.2,
    maxDistanceKm: 10,
    responseRoutes: [{ routeIndex: 0, safety: { dataQuality: { crime: 'ok', lighting: 'mixed' } } }],
    roadCount: 10,
    crimes: [],
    allData: {
      lights: { elements: [] },
      cctv: { elements: [] },
      places: { elements: [] },
      transit: { elements: [] },
    },
    elapsed: 1,
    phase1Time: 0,
    dataTime: 0,
    graphTime: 0,
    pathfindTime: 0,
    recorrectionMs: 0,
    ...overrides,
  };
}

describe('safeRoutesMetaBuilder dataQuality (v2)', () => {
  test('adds crime status and the safest route lighting quality to meta.dataQuality', () => {
    const meta = buildSafeRoutesMeta(baseArgs({ crimeStatus: 'unavailable' }));

    expect(meta.dataQuality.crime).toBe('unavailable');
    expect(meta.dataQuality.lighting).toBe('mixed');
  });

  test('takes lighting from the first (recommended) route', () => {
    const meta = buildSafeRoutesMeta(
      baseArgs({
        crimeStatus: 'ok',
        responseRoutes: [
          { routeIndex: 0, safety: { dataQuality: { crime: 'ok', lighting: 'verified' } } },
          { routeIndex: 1, safety: { dataQuality: { crime: 'ok', lighting: 'estimated' } } },
        ],
      }),
    );

    expect(meta.dataQuality.lighting).toBe('verified');
  });

  test('without crimeStatus (v1) meta.dataQuality gains no new keys', () => {
    const meta = buildSafeRoutesMeta(baseArgs());

    expect(meta.dataQuality.crime).toBeUndefined();
    expect(meta.dataQuality.lighting).toBeUndefined();
    expect(meta.dataQuality.roads).toBe(10);
  });
});
