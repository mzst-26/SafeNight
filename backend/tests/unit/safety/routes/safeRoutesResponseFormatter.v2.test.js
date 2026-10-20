/* eslint-env jest */

// v2 formatter contract. safetyGraph is mocked: its v2 breakdown is derived from the edges it is
// given, so the expected numbers can be worked out by hand in each test.

jest.mock('../../../../src/safety/services/safetyGraph', () => ({
  useV2: jest.fn(() => true),
  routeToPolyline: jest.fn(() => [
    { lat: 50.37, lng: -4.14 },
    { lat: 50.38, lng: -4.13 },
  ]),
  routeSafetyBreakdown: jest.fn((edges, usedEdgeIdxs) => {
    const used = usedEdgeIdxs.map((i) => edges[i]);
    const total = used.reduce((sum, e) => sum + e.distance, 0);
    const mean = used.reduce((sum, e) => sum + e.risk * e.distance, 0) / total;
    const m3 = Math.cbrt(used.reduce((sum, e) => sum + e.risk ** 3 * e.distance, 0) / total);
    const routeRisk = 0.6 * mean + 0.4 * m3;
    const certainty = used.reduce((sum, e) => sum + e.certainty * e.distance, 0) / total;
    const maxRisk = Math.max(...used.map((e) => e.risk));
    const poor = used.find((e) => e.risk >= 0.6);
    const lighting = used.reduce((sum, e) => sum + e.lightScore * e.distance, 0) / total;
    return {
      // Legacy overall deliberately differs from 1 - routeRisk, so a test can tell which one is used.
      overall: 0.5,
      roadType: 0.5,
      lighting,
      crime: 0.5,
      cctv: 0.5,
      openPlaces: 0.5,
      traffic: 0.5,
      roadTypes: { residential: total },
      mainRoadRatio: 0,
      routeRisk,
      mean,
      m3,
      certainty,
      worstStretch: poor
        ? { start: { lat: 50.37, lng: -4.14 }, end: { lat: 50.38, lng: -4.13 }, lengthM: 300, cause: 'lighting' }
        : null,
      riskVector: { mean, p95: maxRisk, max: maxRisk, uncertainty: 1 - certainty },
    };
  }),
}));

jest.mock('../../../../src/safety/routes/safeRoutesPoiCollector', () => ({
  collectRoutePOIs: jest.fn((path, osmNodes, cctv, transit, degree, lights, places, crimeNodes) => ({
    cctv: [],
    transit: [],
    deadEnds: [],
    lights: [],
    places: [],
    crimes: (crimeNodes || []).map((c) => ({ lat: c.lat, lng: c.lng, category: c.category })),
  })),
}));

const {
  buildRouteResponses,
  clusterCrimes,
  lightingQualityFor,
  riskToRampColor,
} = require('../../../../src/safety/routes/safeRoutesResponseFormatter');
const { buildReason } = require('../../../../src/safety/scoring/routeAggregate');

// The frontend ramp (src/components/maps/routeLayers.ts), read from source so the two copies cannot drift apart.
const RISK_RAMP = (() => {
  const source = require('fs').readFileSync(
    require('path').resolve(__dirname, '../../../../../src/components/maps/routeLayers.ts'),
    'utf8',
  );
  const block = /RISK_RAMP: readonly string\[\] = Object\.freeze\(\[([^\]]*)\]\)/.exec(source);
  return block[1].match(/#[0-9A-Fa-f]{6}/g);
})();
const UNKNOWN_RISK_COLOR = '#8A8F98';

const CENTRE = { lat: 50.37, lng: -4.14 };

/** Nodes n0..nN on a short line; edges connect consecutive nodes. */
function buildEdges(count, overrides = {}) {
  const osmNodes = new Map();
  for (let i = 0; i <= count; i++) {
    osmNodes.set(`n${i}`, { lat: CENTRE.lat + i * 0.001, lng: CENTRE.lng });
  }
  const edges = [];
  for (let i = 0; i < count; i++) {
    edges.push({
      from: `n${i}`,
      to: `n${i + 1}`,
      distance: 100,
      lengthM: 100,
      safetyScore: 0.6,
      risk: 0.3,
      certainty: 0.8,
      cause: null,
      litEstimate: 'estimated_lit',
      highway: 'residential',
      roadName: 'Main St',
      isDeadEnd: false,
      hasSidewalk: true,
      surfacePenalty: 0,
      surfaceType: 'paved',
      lightScore: 0.7,
      crimeScore: 0.8,
      cctvScore: 0.4,
      placeScore: 0.3,
      trafficScore: 0.5,
      nearbyTransitCount: 0,
      nearbyCctvCount: 0,
      ...overrides,
    });
  }
  return { osmNodes, edges };
}

/** A raw route over edges [0..count-1] of buildEdges output. */
function rawRoute(count, extra = {}) {
  const path = Array.from({ length: count + 1 }, (_, i) => `n${i}`);
  const edgeIdxs = Array.from({ length: count }, (_, i) => i);
  return { path, edges: edgeIdxs, totalDist: count * 100, ...extra };
}

function baseArgs(overrides = {}) {
  const { osmNodes, edges } = buildEdges(4);
  return {
    rawRoutes: [rawRoute(4)],
    osmNodes,
    edges,
    weights: {},
    cctvNodes: [],
    transitNodes: [],
    nodeDegree: new Map(),
    crimes: [],
    allData: { lights: { elements: [] }, places: { elements: [] } },
    oLat: CENTRE.lat,
    oLng: CENTRE.lng,
    dLat: 50.374,
    dLng: CENTRE.lng,
    enableOpeningHoursParse: false,
    edgeConfidences: [],
    straightLineDist: 400,
    crimeStatus: 'ok',
    ...overrides,
  };
}

describe('safeRoutesResponseFormatter (v2)', () => {
  test('score comes from routeRisk, not the legacy overall value', () => {
    const { osmNodes, edges } = buildEdges(4, { risk: 0.39 });
    const [route] = buildRouteResponses(baseArgs({ osmNodes, edges }));

    // routeRisk = 0.6 * 0.39 + 0.4 * 0.39 = 0.39 -> score 61
    expect(route.safety.score).toBe(61);
    expect(route.safety.label).toBe('Safe');
    expect(route.safety.color).toBe('#558B2F');
  });

  test('the v1 lighting override is disabled: a dark route is labelled by its score alone', () => {
    const { osmNodes, edges } = buildEdges(4, { risk: 0.4, lightScore: 0.1 });
    const args = baseArgs({ osmNodes, edges });
    const [route] = buildRouteResponses(args);

    // Score 60 with 10% lighting: v1 forced "Use Caution" here; v2 must not.
    expect(route.safety.score).toBe(60);
    expect(route.safety.breakdown.lighting).toBe(10);
    expect(route.safety.label).toBe('Safe');
  });

  test('exposes certainty, worstStretch and dataQuality on safety', () => {
    const { osmNodes, edges } = buildEdges(4, { risk: 0.7, certainty: 0.5 });
    const [route] = buildRouteResponses(baseArgs({ osmNodes, edges, crimeStatus: 'unavailable' }));

    expect(route.safety.certainty).toBeCloseTo(0.5, 2);
    expect(route.safety.worstStretch).toEqual({
      start: { lat: 50.37, lng: -4.14 },
      end: { lat: 50.38, lng: -4.13 },
      lengthM: 300,
      cause: 'lighting',
    });
    expect(route.safety.dataQuality).toEqual({
      crime: 'unavailable',
      lighting: 'estimated',
    });
  });

  test('worstStretch is null when no edge is poor', () => {
    const { osmNodes, edges } = buildEdges(4, { risk: 0.2 });
    const [route] = buildRouteResponses(baseArgs({ osmNodes, edges }));

    expect(route.safety.worstStretch).toBeNull();
  });

  test('caution flag reads the high-risk edge (riskVector.max) and stays off for safe routes', () => {
    const risky = buildEdges(4, { risk: 0.2 });
    risky.edges[2] = { ...risky.edges[2], risk: 0.8 };
    const [riskyRoute] = buildRouteResponses(baseArgs(risky));
    expect(riskyRoute.safety.caution).toBe('Includes unverified or high-risk segments');

    const calm = buildEdges(4, { risk: 0.2 });
    const [calmRoute] = buildRouteResponses(baseArgs(calm));
    expect(calmRoute.safety.caution).toBeNull();
  });

  test('safety.reason is buildReason over all routes, with ids matching the displayed Route N labels', () => {
    // Route A (raw index 0): 400 m, risk 0.5 everywhere, exposure 0.20.
    // Route B (raw index 1): 500 m, risk 0.2 everywhere, exposure 0.10, so B ranks first.
    const short = buildEdges(4, { risk: 0.5 });
    const long = buildEdges(5, { risk: 0.2 });
    const osmNodes = new Map([...short.osmNodes, ...long.osmNodes]);
    const edges = [...short.edges, ...long.edges];
    const routeA = rawRoute(4);
    const routeB = { path: ['n0', 'n1', 'n2', 'n3', 'n4', 'n5'], edges: [4, 5, 6, 7, 8], totalDist: 500 };

    const responseRoutes = buildRouteResponses(
      baseArgs({ osmNodes, edges, rawRoutes: [routeA, routeB], straightLineDist: 400 }),
    );

    expect(responseRoutes).toHaveLength(2);
    expect(responseRoutes[0].legs[0].distance.value).toBe(500);
    expect(responseRoutes[0].isSafest).toBe(true);
    expect(responseRoutes[1].isSafest).toBe(false);
    expect(responseRoutes[1].summary).toBe('Route 2');

    const expected = buildReason(
      { id: 1, lengthM: 500, routeRisk: 0.2, score: 80, worstStretch: null },
      [
        { id: 1, lengthM: 500, routeRisk: 0.2, score: 80, worstStretch: null },
        { id: 2, lengthM: 400, routeRisk: 0.5, score: 50, worstStretch: null },
      ],
    );
    expect(responseRoutes[0].safety.reason).toBe(expected);
    expect(responseRoutes[0].safety.reason).toMatch(/Lowest overall exposure/);
    expect(responseRoutes[0].safety.reason).toMatch(/Route 2/);
    expect(responseRoutes[0].safety.reason).not.toMatch(/NaN|Infinity/);
  });

  test('routes longer than 1.5x the shortest are ranked last and marked excluded', () => {
    const shortRoute = buildEdges(4, { risk: 0.5 });
    const longBlock = buildEdges(12, { risk: 0.01 });
    const osmNodes = new Map([...shortRoute.osmNodes, ...longBlock.osmNodes]);
    const edges = [...shortRoute.edges, ...longBlock.edges];
    const shortRaw = rawRoute(4);
    const longRaw = { path: Array.from({ length: 13 }, (_, i) => `n${i}`), edges: Array.from({ length: 12 }, (_, i) => 4 + i), totalDist: 1200 };

    const responseRoutes = buildRouteResponses(
      baseArgs({ osmNodes, edges, rawRoutes: [longRaw, shortRaw], straightLineDist: 400 }),
    );

    expect(responseRoutes.map((r) => r.legs[0].distance.value)).toEqual([400, 1200]);
    expect(responseRoutes[0].isSafest).toBe(true);
  });

  test('segments gain risk, litEstimate, certainty and cause, and keep the legacy fields', () => {
    const { osmNodes, edges } = buildEdges(2, { risk: 0.65, certainty: 0.4, cause: 'crime', litEstimate: 'estimated_unlit', safetyScore: 0.35 });
    const [route] = buildRouteResponses(baseArgs({ osmNodes, edges, rawRoutes: [rawRoute(2)] }));

    expect(route.segments).toHaveLength(2);
    expect(route.segments[0]).toMatchObject({
      risk: 0.65,
      litEstimate: 'estimated_unlit',
      certainty: 0.4,
      cause: 'crime',
      safetyScore: 0.35,
      highway: 'residential',
      distance: 100,
    });
  });

  test('segment colour follows the six-step risk ramp, not the legacy lighting override', () => {
    const { osmNodes, edges } = buildEdges(2, { risk: 0.1, lightScore: 0.1 });
    edges[0] = { ...edges[0], risk: 0.1, lightScore: 0.05 };
    edges[1] = { ...edges[1], risk: 0.95, lightScore: 0.9 };
    const [route] = buildRouteResponses(baseArgs({ osmNodes, edges, rawRoutes: [rawRoute(2)] }));

    expect(route.segments[0].color).toBe(RISK_RAMP[0]);
    expect(route.segments[1].color).toBe(RISK_RAMP[5]);
  });

  test('riskToRampColor uses the same thresholds as the frontend ramp', () => {
    expect(riskToRampColor(0)).toBe(RISK_RAMP[0]);
    // Bucket boundaries sit at multiples of 1/6 (floor(risk * 6)).
    expect(riskToRampColor(0.16)).toBe(RISK_RAMP[0]);
    expect(riskToRampColor(0.17)).toBe(RISK_RAMP[1]);
    expect(riskToRampColor(0.2)).toBe(RISK_RAMP[1]);
    expect(riskToRampColor(0.5)).toBe(RISK_RAMP[3]);
    expect(riskToRampColor(0.8)).toBe(RISK_RAMP[4]);
    expect(riskToRampColor(0.9999)).toBe(RISK_RAMP[5]);
    expect(riskToRampColor(1)).toBe(RISK_RAMP[5]);
    expect(riskToRampColor(-0.5)).toBe(RISK_RAMP[0]);
    expect(riskToRampColor(2)).toBe(RISK_RAMP[5]);
    expect(riskToRampColor(Number.NaN)).toBe(UNKNOWN_RISK_COLOR);
    expect(riskToRampColor(undefined)).toBe(UNKNOWN_RISK_COLOR);
  });

  test('stops emitting generalUncertaintyBoxes and uncertaintyBoxes but keeps lightUncertaintySpans', () => {
    const { osmNodes, edges } = buildEdges(2, { risk: 0.4 });
    const [route] = buildRouteResponses(
      baseArgs({
        osmNodes,
        edges,
        rawRoutes: [rawRoute(2)],
        edgeConfidences: [
          { score: 0.1, reason: 'uncertain', needsVerification: true },
          { score: 0.2, reason: 'uncertain', needsVerification: true },
        ],
      }),
    );

    expect(route.generalUncertaintyBoxes).toEqual([]);
    expect(route.uncertaintyBoxes).toEqual([]);
    expect(Array.isArray(route.lightUncertaintySpans)).toBe(true);
  });

  describe('crime clustering', () => {
    test('crimes within one 120 m cell collapse into a single cluster with a count and max severity', () => {
      const clusters = clusterCrimes([
        { lat: 50.37, lng: -4.14, category: 'shoplifting' },
        { lat: 50.37, lng: -4.14, category: 'violent-crime' },
        { lat: 50.37001, lng: -4.14001, category: 'burglary' },
      ]);

      expect(clusters).toHaveLength(1);
      expect(clusters[0]).toMatchObject({ count: 3, maxSeverity: 1, kind: 'crime' });
      expect(clusters[0].lat).toBeCloseTo(50.37, 4);
      expect(clusters[0].lng).toBeCloseTo(-4.14, 4);
    });

    test('crimes more than a cell apart stay separate and are ordered by count', () => {
      const clusters = clusterCrimes([
        { lat: 50.37, lng: -4.14, category: 'burglary' },
        { lat: 50.4, lng: -4.1, category: 'burglary' },
        { lat: 50.4, lng: -4.1, category: 'burglary' },
      ]);

      expect(clusters).toHaveLength(2);
      expect(clusters.map((c) => c.count)).toEqual([2, 1]);
    });

    test('clusters are capped at 60 markers', () => {
      const crimes = Array.from({ length: 100 }, (_, i) => ({
        lat: 50.3 + i * 0.01,
        lng: -4.14,
        category: 'burglary',
      }));

      const clusters = clusterCrimes(crimes, { cap: 60 });

      expect(clusters).toHaveLength(60);
    });

    test('invalid crime coordinates are ignored', () => {
      const clusters = clusterCrimes([
        { lat: Number.NaN, lng: -4.14, category: 'burglary' },
        { lat: 50.37, lng: Number.POSITIVE_INFINITY, category: 'burglary' },
        { lat: 50.37, lng: -4.14, category: 'burglary' },
      ]);

      expect(clusters).toHaveLength(1);
      expect(clusters[0].count).toBe(1);
    });

    test('routePOIs.crimes holds clusters while routeStats.crimeCount is the true total', () => {
      const crimes = Array.from({ length: 25 }, () => ({ lat: 50.37, lng: -4.14, category: 'burglary' }));
      const [route] = buildRouteResponses(baseArgs({ crimes }));

      expect(route.routePOIs.crimes).toHaveLength(1);
      expect(route.routePOIs.crimes[0]).toMatchObject({ count: 25, kind: 'crime' });
      expect(route.routeStats.crimeCount).toBe(25);
    });

    test('compact mode caps crime clusters at the compact poi cap', () => {
      const crimes = Array.from({ length: 40 }, (_, i) => ({
        lat: 50.3 + i * 0.01,
        lng: -4.14,
        category: 'burglary',
      }));
      const [route] = buildRouteResponses(
        baseArgs({
          crimes,
          responsePolicy: { verbosity: 'compact', poiCaps: { crimes: 12 } },
        }),
      );

      expect(route.routePOIs.crimes).toHaveLength(12);
      expect(route.routeStats.crimeCount).toBe(40);
    });
  });

  describe('lighting data quality', () => {
    test.each([
      [1, 'verified'],
      [0.7, 'verified'],
      [0.69, 'mixed'],
      [0.3, 'mixed'],
      [0.29, 'estimated'],
      [0, 'estimated'],
    ])('a verified fraction of %s is reported as %s', (fraction, expected) => {
      expect(lightingQualityFor(fraction)).toBe(expected);
    });

    test('a route is verified when 70% of its length has a lit or unlit (not estimated) tag', () => {
      const { osmNodes, edges } = buildEdges(10, { litEstimate: 'estimated_lit' });
      for (let i = 0; i < 7; i++) edges[i] = { ...edges[i], litEstimate: 'lit' };
      const [route] = buildRouteResponses(baseArgs({ osmNodes, edges, rawRoutes: [rawRoute(10)] }));

      expect(route.safety.dataQuality.lighting).toBe('verified');
    });

    test('a route is mixed at 30% verified length', () => {
      const { osmNodes, edges } = buildEdges(10, { litEstimate: 'estimated_unlit' });
      for (let i = 0; i < 3; i++) edges[i] = { ...edges[i], litEstimate: 'unlit' };
      const [route] = buildRouteResponses(baseArgs({ osmNodes, edges, rawRoutes: [rawRoute(10)] }));

      expect(route.safety.dataQuality.lighting).toBe('mixed');
    });
  });

  describe('compact mode', () => {
    test('keeps every new safety field and drops segments', () => {
      const { osmNodes, edges } = buildEdges(4, { risk: 0.7, certainty: 0.5 });
      const [route] = buildRouteResponses(
        baseArgs({
          osmNodes,
          edges,
          crimeStatus: 'ok',
          responsePolicy: { verbosity: 'compact', poiCaps: {} },
        }),
      );

      expect(route.segments).toBeUndefined();
      expect(route.legs).toBeUndefined();
      expect(route.safety).toMatchObject({
        score: expect.any(Number),
        label: expect.any(String),
        color: expect.any(String),
        breakdown: expect.any(Object),
        certainty: expect.any(Number),
        reason: expect.any(String),
        dataQuality: { crime: 'ok', lighting: 'estimated' },
      });
      expect(route.safety.worstStretch).toMatchObject({ lengthM: 300, cause: 'lighting' });
      expect(route.routeStats.crimeCount).toBe(0);
      expect(route.generalUncertaintyBoxes).toEqual([]);
      expect(route.uncertaintyBoxes).toEqual([]);
      expect(route.lightUncertaintySpans).toEqual(expect.any(Array));
    });
  });

  test('crimeStatus defaults to unavailable when the caller does not provide one', () => {
    const args = baseArgs();
    delete args.crimeStatus;
    const [route] = buildRouteResponses(args);

    expect(route.safety.dataQuality.crime).toBe('unavailable');
  });
});
