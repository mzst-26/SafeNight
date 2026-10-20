const { parseRouteRequest } = require('../../../../src/safety/routes/safeRoutesRequestPolicy');

const SAME_LOCATION = 'SAME_LOCATION';

const request = {
  query: { origin_lat: '51.50', origin_lng: '-0.12', dest_lat: '51.51', dest_lng: '-0.11' },
};

describe('safeRoutesRequestPolicy same-location boundary (10 m)', () => {
  // The distance comes from the injected haversine, so the boundary is exact and independent of coordinate rounding.
  test('a trip of exactly 10 m is the same location', () => {
    const result = parseRouteRequest(request, 20, () => 10);
    expect(result).toMatchObject({ ok: false, error: SAME_LOCATION });
  });

  test('a trip of 10.5 m is not the same location', () => {
    const result = parseRouteRequest(request, 20, () => 10.5);
    expect(result.error).not.toBe(SAME_LOCATION);
  });
});
