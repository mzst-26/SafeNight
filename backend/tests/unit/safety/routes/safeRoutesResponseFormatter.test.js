/* eslint-env jest */

jest.mock('../../../../src/safety/routes/safeRoutesUtils', () => ({
  checkOpenNow: jest.fn(() => ({ open: true, nextChange: 'closes at 22:00' })),
  heuristicOpen: jest.fn(() => ({ open: true, nextChange: 'opens at 07:00' })),
  safetyLabel: jest.fn(() => ({ label: 'Safe', color: '#558B2F' })),
}));

jest.mock('../../../../src/safety/routes/safeRoutesPoiCollector', () => ({
  collectRoutePOIs: jest.fn(() => ({
    cctv: [],
    transit: [],
    deadEnds: [],
    lights: [],
    places: [],
    crimes: [],
  })),
}));

jest.mock('../../../../src/safety/services/safetyGraph', () => ({
  routeToPolyline: jest.fn(() => [
    { lat: 50.37, lng: -4.14 },
    { lat: 50.38, lng: -4.13 },
  ]),
  routeSafetyBreakdown: jest.fn(() => ({
    overall: 0.61,
    routeRisk: 0.39,
    mean: 0.39,
    m3: 0.39,
    certainty: 0.8,
    worstStretch: null,
    riskVector: { mean: 0.39, p95: 0.4, max: 0.4, uncertainty: 0.2 },
    roadType: 0.6,
    lighting: 0.6,
    crime: 0.6,
    cctv: 0.6,
    openPlaces: 0.6,
    traffic: 0.6,
    roadTypes: { residential: 100 },
    mainRoadRatio: 0.2,
  })),
}));

jest.mock('../../../../src/safety/services/geo', () => ({
  encodePolyline: jest.fn(() => 'encoded'),
}));

const {
  collectLightNodes,
  collectOpenPlaceNodes,
  buildRouteResponses,
} = require('../../../../src/safety/routes/safeRoutesResponseFormatter');
const safeRoutesUtils = require('../../../../src/safety/routes/safeRoutesUtils');
const {
  collectRoutePOIs,
} = require('../../../../src/safety/routes/safeRoutesPoiCollector');

describe('safeRoutesResponseFormatter', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('collectLightNodes keeps only street lamp nodes with coordinates', () => {
    const result = collectLightNodes([
      { type: 'node', tags: { highway: 'street_lamp' }, lat: 50.1, lon: -4.1 },
      { type: 'node', tags: { highway: 'bus_stop' }, lat: 50.2, lon: -4.2 },
      { type: 'way', tags: { highway: 'street_lamp' }, lat: 50.3, lon: -4.3 },
    ]);

    expect(result).toEqual([{ lat: 50.1, lng: -4.1 }]);
  });

  test('collectOpenPlaceNodes keeps open places and maps metadata', () => {
    const result = collectOpenPlaceNodes(
      [
        {
          lat: 50.37,
          lon: -4.14,
          tags: {
            name: 'Cafe',
            amenity: 'cafe',
            opening_hours: 'Mo-Su 08:00-18:00',
          },
        },
      ],
      true,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      lat: 50.37,
      lng: -4.14,
      name: 'Cafe',
      amenity: 'cafe',
      open: true,
    });
  });

  test('collectOpenPlaceNodes filters closed places when heuristic reports closed', () => {
    safeRoutesUtils.heuristicOpen.mockReturnValueOnce({
      open: false,
      nextChange: 'opens at 07:00',
    });

    const result = collectOpenPlaceNodes(
      [
        {
          lat: 50.37,
          lon: -4.14,
          tags: {
            name: 'Night Closed Cafe',
            amenity: 'cafe',
          },
        },
      ],
      false,
    );

    expect(result).toEqual([]);
  });

  test('collectOpenPlaceNodes uses heuristic branch when parser is disabled', () => {
    safeRoutesUtils.heuristicOpen.mockReturnValueOnce({
      open: true,
      nextChange: 'closes at 20:00',
    });

    const result = collectOpenPlaceNodes(
      [
        {
          lat: 50.37,
          lon: -4.14,
          tags: {
            name: 'Heuristic Place',
            amenity: 'library',
          },
        },
      ],
      false,
    );

    expect(result).toHaveLength(1);
    expect(result[0].nextChange).toBe('closes at 20:00');
  });

  test('buildRouteResponses returns route payload with expected shape', () => {
    const responseRoutes = buildRouteResponses({
      rawRoutes: [
        {
          path: ['n1', 'n2', 'n3'],
          edges: [0, 1],
          totalDist: 1400,
        },
      ],
      osmNodes: new Map([
        ['n1', { lat: 50.37, lng: -4.14 }],
        ['n2', { lat: 50.38, lng: -4.13 }],
        ['n3', { lat: 50.38, lng: -4.13 }],
      ]),
      edges: [
        {
          from: 'n1',
          to: 'n2',
          distance: 700,
          safetyScore: 0.6,
          risk: 0.4,
          certainty: 0.8,
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
          nearbyTransitCount: 2,
          nearbyCctvCount: 1,
        },
        {
          from: 'n2',
          to: 'n3',
          distance: 700,
          safetyScore: 0.45,
          risk: 0.55,
          certainty: 0.8,
          highway: 'path',
          roadName: '',
          isDeadEnd: false,
          hasSidewalk: false,
          surfacePenalty: 0,
          surfaceType: 'gravel',
          lightScore: 0.1,
          crimeScore: 0.9,
          cctvScore: 0.0,
          placeScore: 0.05,
          trafficScore: 0.1,
          nearbyTransitCount: 0,
          nearbyCctvCount: 0,
        },
      ],
      cctvNodes: [],
      transitNodes: [],
      nodeDegree: new Map(),
      crimes: [],
      allData: {
        lights: { elements: [] },
        places: { elements: [] },
      },
      oLat: 50.37,
      oLng: -4.14,
      dLat: 50.38,
      dLng: -4.13,
      enableOpeningHoursParse: false,
      edgeConfidences: [
        { score: 0, reason: 'explicit_lit_no', needsVerification: true },
        { score: 0.35, reason: 'uncertain', needsVerification: false },
      ],
    });

    expect(responseRoutes).toHaveLength(1);
    expect(responseRoutes[0]).toMatchObject({
      routeIndex: 0,
      isSafest: true,
      overview_polyline: { points: 'encoded' },
      summary: 'Safest Route',
      safety: {
        score: 61,
        label: 'Safe',
        color: '#558B2F',
      },
      routeStats: {
        deadEnds: 0,
        sidewalkPct: 50,
      },
    });
    expect(responseRoutes[0].segments).toHaveLength(2);
    expect(responseRoutes[0].lightUncertaintySpans).toHaveLength(1);
    // Uncertainty is drawn as dashed segments, so the legacy box lists stay empty.
    expect(responseRoutes[0].generalUncertaintyBoxes).toEqual([]);
    expect(responseRoutes[0].uncertaintyBoxes).toEqual([]);
  });

  test('buildRouteResponses in compact mode excludes heavy fields', () => {
    const responseRoutes = buildRouteResponses({
      rawRoutes: [
        {
          path: ['n1', 'n2'],
          edges: [0],
          totalDist: 1000,
        },
      ],
      osmNodes: new Map([
        ['n1', { lat: 50.37, lng: -4.14 }],
        ['n2', { lat: 50.38, lng: -4.13 }],
      ]),
      edges: [
        {
          distance: 1000,
          safetyScore: 0.6,
          risk: 0.4,
          certainty: 0.8,
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
          nearbyTransitCount: 2,
          nearbyCctvCount: 1,
        },
      ],
      cctvNodes: [],
      transitNodes: [],
      nodeDegree: new Map(),
      crimes: [],
      allData: {
        lights: { elements: [] },
        places: { elements: [] },
      },
      oLat: 50.37,
      oLng: -4.14,
      dLat: 50.38,
      dLng: -4.13,
      enableOpeningHoursParse: false,
      responsePolicy: {
        verbosity: 'compact',
        poiCaps: {
          cctv: 10,
          transit: 10,
          deadEnds: 10,
          lights: 10,
          places: 10,
          crimes: 10,
        },
      },
    });

    const route = responseRoutes[0];
    expect(route.legs).toBeUndefined();
    expect(route.segments).toBeUndefined();
    expect(route.distance).toMatchObject({ value: 1000 });
    expect(route.duration).toMatchObject({ value: expect.any(Number) });
    expect(route.safety.breakdown).toBeDefined();
    expect(route.routeStats.roadNameChanges).toBeUndefined();
  });

  test('buildRouteResponses enforces poi caps for full mode', () => {
    collectRoutePOIs.mockReturnValueOnce({
      cctv: [
        { lat: 50.37001, lng: -4.14001 },
        { lat: 50.37100, lng: -4.14100 },
        { lat: 50.37200, lng: -4.14200 },
      ],
      transit: [
        { lat: 50.37002, lng: -4.14002 },
        { lat: 50.37300, lng: -4.14300 },
      ],
      deadEnds: [
        { lat: 50.37003, lng: -4.14003 },
        { lat: 50.37400, lng: -4.14400 },
      ],
      lights: [
        { lat: 50.37004, lng: -4.14004 },
        { lat: 50.37500, lng: -4.14500 },
      ],
      places: [
        { lat: 50.37005, lng: -4.14005, name: 'A', amenity: 'cafe' },
        { lat: 50.37600, lng: -4.14600, name: 'B', amenity: 'shop' },
      ],
      crimes: [
        { lat: 50.37006, lng: -4.14006, category: 'theft' },
        { lat: 50.37700, lng: -4.14700, category: 'burglary' },
      ],
    });

    const responseRoutes = buildRouteResponses({
      rawRoutes: [
        {
          path: ['n1', 'n2'],
          edges: [0],
          totalDist: 1000,
        },
      ],
      osmNodes: new Map([
        ['n1', { lat: 50.37, lng: -4.14 }],
        ['n2', { lat: 50.38, lng: -4.13 }],
      ]),
      edges: [
        {
          distance: 1000,
          safetyScore: 0.6,
          risk: 0.4,
          certainty: 0.8,
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
          nearbyTransitCount: 2,
          nearbyCctvCount: 1,
        },
      ],
      cctvNodes: [],
      transitNodes: [],
      nodeDegree: new Map(),
      crimes: [],
      allData: {
        lights: { elements: [] },
        places: { elements: [] },
      },
      oLat: 50.37,
      oLng: -4.14,
      dLat: 50.38,
      dLng: -4.13,
      enableOpeningHoursParse: false,
      responsePolicy: {
        verbosity: 'full',
        poiCaps: {
          cctv: 2,
          transit: 1,
          deadEnds: 1,
          lights: 1,
          places: 1,
          crimes: 1,
        },
      },
    });

    const route = responseRoutes[0];
    expect(route.segments).toHaveLength(1);
    expect(route.routePOIs.cctv).toHaveLength(2);
    expect(route.routePOIs.transit).toHaveLength(1);
    expect(route.routePOIs.deadEnds).toHaveLength(1);
    expect(route.routePOIs.lights).toHaveLength(1);
    expect(route.routePOIs.places).toHaveLength(1);
    expect(route.routePOIs.crimes).toHaveLength(1);
    expect(route.routePOIs.cctv[0]).toEqual({ lat: 50.37001, lng: -4.14001 });
  });

  describe('route-aware POI selection and open-place filtering', () => {
    // Two-segment route: n1 -> n2 -> n3. n3 is far from the origin.
    const buildArgs = (responsePolicy) => ({
      rawRoutes: [{ path: ['n1', 'n2', 'n3'], edges: [0, 1], totalDist: 2000 }],
      osmNodes: new Map([
        ['n1', { lat: 50.37, lng: -4.14 }],
        ['n2', { lat: 50.38, lng: -4.13 }],
        ['n3', { lat: 50.39, lng: -4.12 }],
      ]),
      edges: [
        {
          distance: 1000,
          safetyScore: 0.6,
          risk: 0.4,
          certainty: 0.8,
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
        },
        {
          distance: 1000,
          safetyScore: 0.6,
          risk: 0.4,
          certainty: 0.8,
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
        },
      ],
      cctvNodes: [],
      transitNodes: [],
      nodeDegree: new Map(),
      crimes: [],
      allData: { lights: { elements: [] }, places: { elements: [] } },
      oLat: 50.37,
      oLng: -4.14,
      dLat: 50.39,
      dLng: -4.12,
      enableOpeningHoursParse: false,
      responsePolicy,
    });

    const emptyPOIs = () => ({
      cctv: [],
      transit: [],
      deadEnds: [],
      lights: [],
      places: [],
      crimes: [],
    });

    test('cap keeps POIs spread across route segments instead of clustering at the origin', () => {
      // Three CCTV cameras near segment 0 (close to origin), three near segment 1.
      collectRoutePOIs.mockReturnValueOnce({
        ...emptyPOIs(),
        cctv: [
          { lat: 50.3701, lng: -4.1401 },
          { lat: 50.3702, lng: -4.1402 },
          { lat: 50.3703, lng: -4.1403 },
          { lat: 50.3851, lng: -4.1251 },
          { lat: 50.3852, lng: -4.1252 },
          { lat: 50.3853, lng: -4.1253 },
        ],
      });

      const [route] = buildRouteResponses(
        buildArgs({
          verbosity: 'full',
          poiCaps: { ...emptyPOIs(), cctv: 2 },
        }),
      );

      expect(route.routePOIs.cctv).toHaveLength(2);
      const lats = route.routePOIs.cctv.map((p) => p.lat);
      expect(lats.some((lat) => lat < 50.38)).toBe(true);
      expect(lats.some((lat) => lat > 50.38)).toBe(true);
    });

    test('Infinity cap keeps every POI', () => {
      const cctv = Array.from({ length: 12 }, (_, i) => ({
        lat: 50.37 + i * 0.001,
        lng: -4.14 + i * 0.001,
      }));
      collectRoutePOIs.mockReturnValueOnce({ ...emptyPOIs(), cctv });

      const [route] = buildRouteResponses(
        buildArgs({
          verbosity: 'full',
          poiCaps: {
            cctv: Infinity,
            transit: Infinity,
            deadEnds: Infinity,
            lights: Infinity,
            places: Infinity,
            crimes: Infinity,
          },
        }),
      );

      expect(route.routePOIs.cctv).toHaveLength(12);
    });

    test('collectOpenPlaceNodes keeps closed places when openPlacesOnly is false', () => {
      const closed = { open: false, nextChange: 'opens at 07:00' };
      safeRoutesUtils.heuristicOpen
        .mockReturnValueOnce(closed)
        .mockReturnValueOnce(closed);
      const elements = [
        { lat: 50.37, lon: -4.14, tags: { name: 'Closed Cafe', amenity: 'cafe' } },
      ];

      expect(collectOpenPlaceNodes(elements, false, true)).toEqual([]);

      const result = collectOpenPlaceNodes(elements, false, false);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'Closed Cafe', open: false });
    });
  });
});
