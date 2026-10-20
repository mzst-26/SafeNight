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

describe('safeRoutesMetaBuilder dataQuality', () => {
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

  test('a missing crimeStatus fails closed: reported as unavailable, never as no crime', () => {
    const meta = buildSafeRoutesMeta(baseArgs());

    expect(meta.dataQuality.crime).toBe('unavailable');
    expect(meta.dataQuality.lighting).toBe('mixed');
    expect(meta.dataQuality.roads).toBe(10);
  });

  test('an unrecognised crimeStatus is reported as unavailable', () => {
    const meta = buildSafeRoutesMeta(baseArgs({ crimeStatus: 'maybe' }));

    expect(meta.dataQuality.crime).toBe('unavailable');
  });
});
