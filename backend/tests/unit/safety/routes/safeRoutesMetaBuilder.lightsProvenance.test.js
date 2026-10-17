const { buildSafeRoutesMeta } = require('../../../../src/safety/routes/safeRoutesMetaBuilder');

function build(allDataOverrides, verifiedLightsCount = 0) {
  return buildSafeRoutesMeta({
    straightLineKm: 1,
    maxDistanceKm: 2,
    responseRoutes: [],
    roadCount: 0,
    crimes: [],
    allData: {
      lights: { elements: [] },
      cctv: { elements: [] },
      places: { elements: [] },
      transit: { elements: [] },
      ...allDataOverrides,
    },
    elapsed: 0,
    phase1Time: 0,
    dataTime: 0,
    graphTime: 0,
    pathfindTime: 0,
    recorrectionMs: 0,
    dataSources: null,
    lightVerificationStatus: null,
    verifiedLightsCount,
  });
}

describe('buildSafeRoutesMeta lights provenance', () => {
  test('local OSM data with no fallback metadata reports local_osm, not unknown', () => {
    const meta = build({});

    expect(meta.dataQuality.freshness.lightsSource).toBe('local_osm');
  });

  test('local OSM data with OS gap-fill reports local_osm+os_ngd_gapfill', () => {
    const meta = build({}, 3);

    expect(meta.dataQuality.freshness.lightsSource).toBe('local_osm+os_ngd_gapfill');
  });

  test('a recorded lights source (Overpass fallback) is reported as recorded', () => {
    const meta = build({
      _sourceMeta: { lights: { source: 'osm', reason: 'local-osm-failed-overpass-fallback' } },
    });

    expect(meta.dataQuality.freshness.lightsSource).toBe('osm');
  });
});
