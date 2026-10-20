/* eslint-env jest */
jest.mock('../../../../src/safety/services/safetyGraph', () => ({
  routeToPolyline: jest.fn(() => [{ lat: 51.5, lng: -0.12 }, { lat: 51.51, lng: -0.11 }]),
  routeSafetyBreakdown: jest.fn((edges, used) => {
    const e = edges[used[0]];
    return {
      overall: 0.5, roadType: 0.5, lighting: 0.5, crime: 0.5, cctv: 0.5, openPlaces: 0.5, traffic: 0.5,
      roadTypes: { residential: e.distance }, mainRoadRatio: 0, routeRisk: e.risk, mean: e.risk, m3: e.risk,
      certainty: 0.8, worstStretch: null,
      riskVector: { mean: e.risk, p95: e.risk, max: e.risk, uncertainty: 0.2 },
    };
  }),
}));

const {
  buildRouteResponses,
  collectOpenPlaceNodes,
} = require('../../../../src/safety/routes/safeRoutesResponseFormatter');
const { resolveTripTime } = require('../../../../src/safety/routes/safeRoutesTime');

const edge = {
  from: 'n1', to: 'n2', distance: 1350, safetyScore: 0.6, risk: 0.4, certainty: 0.8, highway: 'residential',
  roadName: 'A', isDeadEnd: false, hasSidewalk: true, surfacePenalty: 0, surfaceType: 'paved', lightScore: 0.7,
  crimeScore: 0.8, cctvScore: 0.4, placeScore: 0.3, trafficScore: 0.5, nearbyTransitCount: 0, nearbyCctvCount: 0,
};
const build = (extra) => buildRouteResponses({
  rawRoutes: [{ path: ['n1', 'n2'], edges: [0], totalDist: 1350 * 75 * 60 / 1000 * 1.35 / 1.35 }],
  osmNodes: new Map([['n1', { lat: 51.5, lng: -0.12 }], ['n2', { lat: 51.51, lng: -0.11 }]]),
  edges: [{ ...edge, distance: 1350 * 75 * 60 / 1000 }],
  cctvNodes: [], transitNodes: [], nodeDegree: new Map(), crimes: [],
  allData: { lights: { elements: [] }, places: { elements: [] } },
  oLat: 51.5, oLng: -0.12, dLat: 51.51, dLng: -0.11, enableOpeningHoursParse: false,
  ...extra,
});

describe('route timeline in the response', () => {
  // Route is 1350 * 4.5 = 6075 m, i.e. 75 min at 1.35 m/s.
  const trip = resolveTripTime({
    leaveAt: Date.parse('2026-10-20T17:10:00+01:00'), nowMs: Date.parse('2026-10-20T16:00:00Z'), etaSec: 4500,
  });

  test.each([['full'], ['compact']])('%s mode carries safety.timeline', (verbosity) => {
    const [route] = build({ trip, responsePolicy: { verbosity, openPlacesOnly: true, poiCaps: {} } });
    expect(route.safety.timeline).toMatchObject({
      leaveAtIso: '2026-10-20T16:10:00.000Z',
      arriveAtIso: '2026-10-20T17:25:00.000Z',
      label: 'dark_by_arrival',
    });
    expect(route.safety.timeline.darknessAtStart).toBeLessThan(0.15);
    expect(route.safety.timeline.darknessAtArrival).toBeGreaterThanOrEqual(0.85);
  });

  test('no timeline when no trip is supplied (older callers)', () => {
    const [route] = build({});
    expect(route.safety.timeline).toBeUndefined();
  });
});

describe('collectOpenPlaceNodes uses the chosen time', () => {
  const pub = [{ type: 'node', lat: 51.5, lon: -0.12, tags: { amenity: 'pub', name: 'The Pub' } }];

  test('a pub is listed at 11:00 and dropped at 03:00 London time', () => {
    const eleven = collectOpenPlaceNodes(pub, false, true, { atMs: Date.parse('2026-10-20T10:00:00Z'), londonHour: 11 });
    const three = collectOpenPlaceNodes(pub, false, true, { atMs: Date.parse('2026-10-20T02:00:00Z'), londonHour: 3 });
    expect(eleven).toHaveLength(1);
    expect(three).toHaveLength(0);
  });
  test('with openPlacesOnly=false the closed pub is kept and marked closed', () => {
    const three = collectOpenPlaceNodes(pub, false, false, { atMs: Date.parse('2026-10-20T02:00:00Z'), londonHour: 3 });
    expect(three[0].open).toBe(false);
  });
  test('parsed opening_hours is evaluated at the chosen instant', () => {
    const tagged = [{ type: 'node', lat: 51.5, lon: -0.12, tags: { amenity: 'cafe', opening_hours: 'Mo-Su 10:00-22:00' } }];
    expect(collectOpenPlaceNodes(tagged, true, true, { atMs: Date.parse('2026-10-20T16:00:00Z'), londonHour: 17 })).toHaveLength(1);
    expect(collectOpenPlaceNodes(tagged, true, true, { atMs: Date.parse('2026-10-20T02:00:00Z'), londonHour: 3 })).toHaveLength(0);
  });
});
