const { sharedCorridorFraction, expansionAllowed } = require('../../../src/gateway/agent/corridor');

// Points along a straight east-west line at latitude 51.5. Offsets are in metres, converted to degrees.
const LAT = 51.5;
const pointAt = (lngOffsetM, latOffsetM = 0) => ({
  lat: LAT + latOffsetM / 111320,
  lng: -1.0 + lngOffsetM / (111320 * Math.cos((LAT * Math.PI) / 180)),
});
/** A straight path from x0 to x1 metres east, sampled every 20 m, at a given north offset. */
const straight = (x0, x1, latOffsetM = 0) => {
  const points = [];
  for (let x = x0; x <= x1; x += 20) points.push(pointAt(x, latOffsetM));
  return points;
};

const route = (routeId, path, overrides = {}) => ({
  routeId,
  path,
  distanceMeters: 1000,
  durationSeconds: 600,
  score: 80,
  breakdown: { roadType: 50, lighting: 50, crime: 50, cctv: 50, openPlaces: 50, traffic: 50 },
  lightingQuality: 'verified',
  darknessAtStart: 0.2,
  ...overrides,
});

const unlitRisk = { worstStretch: { lengthM: 200, cause: 'lighting' } };

describe('sharedCorridorFraction', () => {
  test('returns 1 when route A runs along the same path as route B', () => {
    const a = straight(0, 1000);
    const b = straight(0, 1000);
    expect(sharedCorridorFraction(route('a', a), route('b', b))).toBeCloseTo(1, 2);
  });

  test('counts a route that runs 20 m away from the other as shared (within 150 m)', () => {
    const a = straight(0, 1000);
    const b = straight(0, 1000, 20);
    expect(sharedCorridorFraction(route('a', a), route('b', b))).toBeCloseTo(1, 2);
  });

  test('gives a fraction of route A length, not of route B', () => {
    // A is 1000 m long; B covers only its first 500 m. The 150 m corridor reaches to 650 m of A.
    const a = straight(0, 1000);
    const b = straight(0, 500);
    expect(sharedCorridorFraction(route('a', a), route('b', b))).toBeCloseTo(0.65, 1);
    expect(sharedCorridorFraction(route('b', b), route('a', a))).toBeCloseTo(1, 1);
  });

  test('returns 0 for a route that is clearly different (more than 150 m away)', () => {
    const a = straight(0, 1000);
    const b = straight(0, 1000, 800);
    expect(sharedCorridorFraction(route('a', a), route('b', b))).toBe(0);
  });

  test('returns 0 when either route has no path points', () => {
    const a = straight(0, 1000);
    expect(sharedCorridorFraction(route('a', []), route('b', a))).toBe(0);
    expect(sharedCorridorFraction(route('a', a), route('b', undefined))).toBe(0);
  });
});

describe('expansionAllowed', () => {
  // Two routes through the same park path, and one route that is clearly different.
  const parkA = route('rec', straight(0, 1000), unlitRisk);
  const parkB = route('alt', straight(0, 1000, 15));
  const far = route('far', straight(0, 1000, 900));

  test('is true for a late trip, shared park path, and a risk on the recommended route', () => {
    expect(
      expansionAllowed({ routes: [parkA, parkB], recommendedRouteId: 'rec', darknessAtStart: 0.1, tone: 'late' }),
    ).toBe(true);
  });

  test('is true when darkness at start is at least 0.85, even without a late tone', () => {
    expect(
      expansionAllowed({ routes: [parkA, parkB], recommendedRouteId: 'rec', darknessAtStart: 0.85, tone: 'day' }),
    ).toBe(true);
  });

  test('is false when the trip is neither late nor dark at start', () => {
    expect(
      expansionAllowed({ routes: [parkA, parkB], recommendedRouteId: 'rec', darknessAtStart: 0.84, tone: 'day' }),
    ).toBe(false);
  });

  test('is false with fewer than two routes', () => {
    expect(
      expansionAllowed({ routes: [parkA], recommendedRouteId: 'rec', darknessAtStart: 0.9, tone: 'late' }),
    ).toBe(false);
  });

  test('is false when a route is clearly different from the recommended one', () => {
    expect(
      expansionAllowed({ routes: [parkA, parkB, far], recommendedRouteId: 'rec', darknessAtStart: 0.9, tone: 'late' }),
    ).toBe(false);
  });

  test('is false when the recommended route has no risk finding', () => {
    const safe = route('rec', straight(0, 1000));
    expect(
      expansionAllowed({ routes: [safe, parkB], recommendedRouteId: 'rec', darknessAtStart: 0.9, tone: 'late' }),
    ).toBe(false);
  });

  test('is false when the recommended route id is not in the routes', () => {
    expect(
      expansionAllowed({ routes: [parkA, parkB], recommendedRouteId: 'missing', darknessAtStart: 0.9, tone: 'late' }),
    ).toBe(false);
  });
});
