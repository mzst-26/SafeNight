/* eslint-env jest */
/* global describe, test, expect */

const {
  buildSafeRoutesMeta,
} = require('../../../../src/safety/routes/safeRoutesMetaBuilder');

describe('safeRoutesMetaBuilder', () => {
  test('buildSafeRoutesMeta returns expected response meta shape', () => {
    const meta = buildSafeRoutesMeta({
      straightLineKm: 3.26,
      maxDistanceKm: 10,
      responseRoutes: [{ routeIndex: 0 }, { routeIndex: 1 }],
      roadCount: 120,
      crimes: [{ category: 'theft' }, { category: 'robbery' }],
      allData: {
        lights: { elements: [{}, {}] },
        cctv: { elements: [{}, {}, {}] },
        places: { elements: [{}] },
        transit: { elements: [{}, {}, {}, {}] },
      },
      elapsed: 456,
      phase1Time: 50,
      dataTime: 80,
      graphTime: 120,
      pathfindTime: 140,
      recorrectionMs: 0,
    });

    expect(meta).toEqual({
      straightLineDistanceKm: 3.3,
      maxDistanceKm: 10,
      routeCount: 2,
      dataQuality: {
        roads: 120,
        crimes: 2,
        lightElements: 2,
        cctvCameras: 3,
        places: 1,
        transitStops: 4,
      },
      timing: {
        totalMs: 456,
        corridorDiscoveryMs: 50,
        safetyDataFetchMs: 80,
        graphBuildMs: 120,
        pathfindMs: 140,
        recorrectionMs: 0,
      },
      computeTimeMs: 456,
    });
  });
});
