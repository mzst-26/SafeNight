/* eslint-env jest */
/* global jest, describe, test, expect, afterEach */

jest.mock('../../../../src/safety/routes/safeRoutesUtils', () => ({
  checkOpenNow: jest.fn(() => ({ open: true, nextChange: 'closes at 22:00' })),
  heuristicOpen: jest.fn(() => ({ open: true, nextChange: 'opens at 07:00' })),
  safetyLabel: jest.fn(() => ({ label: 'Safe', color: '#558B2F' })),
  segmentColor: jest.fn(() => '#4CAF50'),
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
      weights: {},
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
        sidewalkPct: 100,
      },
    });
    expect(responseRoutes[0].segments).toHaveLength(1);
  });
});
