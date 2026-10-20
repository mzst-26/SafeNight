/* eslint-env jest */

// Uses the real route breakdown and ranking. Only the POI collector is stubbed, since it is not under test here.
jest.mock('../../../../src/safety/routes/safeRoutesPoiCollector', () => ({
  collectRoutePOIs: jest.fn(() => ({
    cctv: [], transit: [], deadEnds: [], lights: [], places: [], crimes: [],
  })),
}));

const { buildRouteResponses } = require('../../../../src/safety/routes/safeRoutesResponseFormatter');

function edge(distance, risk) {
  return {
    from: 'n1', to: 'n2', distance, risk, certainty: 0.8, safetyScore: 1 - risk, cause: 'lighting',
    start: { lat: 50.37, lng: -4.14 }, end: { lat: 50.38, lng: -4.13 },
    highway: 'residential', roadName: '', isDeadEnd: false, hasSidewalk: true,
    surfacePenalty: 0, surfaceType: 'paved', roadScore: 0.5, lightScore: 0.5, crimeScore: 0.5,
    cctvScore: 0, placeScore: 0, trafficScore: 0.5, nearbyTransitCount: 0, nearbyCctvCount: 0,
  };
}

const osmNodes = new Map([
  ['n1', { lat: 50.37, lng: -4.14 }],
  ['n2', { lat: 50.38, lng: -4.13 }],
  ['n3', { lat: 50.39, lng: -4.12 }],
]);

function buildArgs(rawRoutes, edges) {
  return {
    rawRoutes,
    osmNodes,
    edges,
    cctvNodes: [],
    transitNodes: [],
    nodeDegree: new Map(),
    crimes: [],
    allData: { lights: { elements: [] }, places: { elements: [] } },
    oLat: 50.37, oLng: -4.14, dLat: 50.38, dLng: -4.13,
    enableOpeningHoursParse: false,
    responsePolicy: undefined,
    straightLineDist: 1000,
    crimeStatus: 'ok',
  };
}

describe('safeRoutesResponseFormatter with a zero-length route among the candidates', () => {
  // Route A: 1000 m at risk 0.4, the shortest real route, so the cap base. Route B: 2100 m at risk 0.1. Its
  // exposure is lower than A's, but it is more than 2.0x A's length, so it must be listed after A.
  const edges = [edge(1000, 0.4), edge(2100, 0.1)];
  const zero = { path: ['n1'], edges: [], totalDist: 0 };
  const routeA = { path: ['n1', 'n2'], edges: [0], totalDist: 1000 };
  const routeB = { path: ['n1', 'n3'], edges: [1], totalDist: 2100 };

  test('a 0 m route does not become the length cap base, so a real route over 2.0x the shortest is listed last', () => {
    const responseRoutes = buildRouteResponses(buildArgs([zero, routeA, routeB], edges));

    expect(responseRoutes.map((r) => r.legs[0].distance.value)).toEqual([0, 1000, 2100]);
  });

  test('the zero-length route is reported with its true 0 m length, not 1 m', () => {
    const [first] = buildRouteResponses(buildArgs([zero, routeA], edges));

    expect(first.legs[0].distance).toEqual({ text: '0 m', value: 0 });
  });
});
