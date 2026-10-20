const {
  parseRouteRequest,
  buildOutOfRangeMessage,
  buildOutOfRangePayload,
  RESPONSE_VERBOSITY_FULL,
  RESPONSE_VERBOSITY_COMPACT,
  FULL_MODE_POI_CAPS,
  COMPACT_MODE_POI_CAPS,
  POI_CAP_MAX,
  MAX_SEARCH_BBOX_KM2,
  searchBboxAreaKm2,
} = require('../../../../src/safety/routes/safeRoutesRequestPolicy');
const { haversine } = require('../../../../src/safety/services/geo');

function makeReq(query = {}) {
  return {
    query,
  };
}

describe('safeRoutesRequestPolicy', () => {
  test('parseRouteRequest returns error for invalid origin latitude', () => {
    const req = makeReq({
      origin_lat: 120,
      origin_lng: -4.14,
      dest_lat: 50.38,
      dest_lng: -4.13,
    });

    const result = parseRouteRequest(req, 20, () => 1000);

    expect(result.ok).toBe(false);
  });

  test('parseRouteRequest returns parsed values for valid coordinates', () => {
    const req = makeReq({
      origin_lat: 50.37,
      origin_lng: -4.14,
      dest_lat: 50.38,
      dest_lng: -4.13,
    });

    const result = parseRouteRequest(req, 20, () => 1000);

    expect(result.value.straightLineKm).toBe(1);
    expect(result.value.departureHour).toBeNull();
    expect(result.value.allowHazards).toBe(false);
    expect(result.value.responsePolicy).toEqual({
      verbosity: RESPONSE_VERBOSITY_FULL,
      openPlacesOnly: true,
      poiCaps: FULL_MODE_POI_CAPS,
    });
  });

  test('parseRouteRequest parses departure_hour and allow_hazards', () => {
    const req = makeReq({
      origin_lat: 50.37,
      origin_lng: -4.14,
      dest_lat: 50.38,
      dest_lng: -4.13,
      departure_hour: '2',
      allow_hazards: 'true',
    });

    const result = parseRouteRequest(req, 20, () => 1000);

    expect(result.value.departureHour).toBe(2);
    expect(result.value.allowHazards).toBe(true);
  });

  test('parseRouteRequest rejects invalid departure_hour', () => {
    const req = makeReq({
      origin_lat: 50.37,
      origin_lng: -4.14,
      dest_lat: 50.38,
      dest_lng: -4.13,
      departure_hour: '25',
    });

    const result = parseRouteRequest(req, 20, () => 1000);

    expect(result.value.departureHour).toBeNull();
  });

  test('parseRouteRequest supports compact response mode and compact defaults', () => {
    const req = makeReq({
      origin_lat: 50.37,
      origin_lng: -4.14,
      dest_lat: 50.38,
      dest_lng: -4.13,
      verbosity: 'compact',
    });

    const result = parseRouteRequest(req, 20, () => 1000);

    expect(result.value.responsePolicy).toEqual({
      verbosity: RESPONSE_VERBOSITY_COMPACT,
      openPlacesOnly: true,
      poiCaps: COMPACT_MODE_POI_CAPS,
    });
  });

  test('parseRouteRequest applies global and per-category poi caps', () => {
    const req = makeReq({
      origin_lat: 50.37,
      origin_lng: -4.14,
      dest_lat: 50.38,
      dest_lng: -4.13,
      poi_cap: '25',
      poi_cap_dead_ends: '7',
      poi_cap_places: '5',
    });

    const result = parseRouteRequest(req, 20, () => 1000);

    expect(result.value.responsePolicy).toEqual({
      verbosity: RESPONSE_VERBOSITY_FULL,
      openPlacesOnly: true,
      poiCaps: {
        cctv: 25,
        transit: 25,
        deadEnds: 7,
        lights: 25,
        places: 5,
        crimes: 25,
      },
    });
  });

  test('buildOutOfRangeMessage renders a user distance limit message', () => {
    const message = buildOutOfRangeMessage(8, 3);

    expect(message).toContain('limit is');
  });

  test('buildOutOfRangePayload includes out-of-range error code', () => {
    const payload = buildOutOfRangePayload({
      oLat: 50.37,
      oLng: -4.14,
      dLat: 50.47,
      dLng: -4.04,
      straightLineKm: 12,
      maxDistanceKm: 3,
    });

    expect(payload.error).toBe('DESTINATION_OUT_OF_RANGE');
  });

  describe('request hardening (security review)', () => {
    const VALID = {
      origin_lat: '50.37',
      origin_lng: '-4.14',
      dest_lat: '50.38',
      dest_lng: '-4.13',
    };
    const parse = (overrides = {}) =>
      parseRouteRequest(makeReq({ ...VALID, ...overrides }), 20, () => 1000);

    test.each([
      ['empty origin_lat', { origin_lat: '' }],
      ['whitespace origin_lat', { origin_lat: '   ' }],
      ['empty origin_lng', { origin_lng: '' }],
      ['empty dest_lat', { dest_lat: '' }],
      ['empty dest_lng', { dest_lng: '' }],
      ['array origin_lat', { origin_lat: ['50.37', '50.38'] }],
    ])('rejects %s instead of parsing it as 0', (_label, overrides) => {
      const result = parse(overrides);

      expect(result.ok).toBe(false);
    });

    test('an empty waypoint is ignored rather than becoming a waypoint at 0,0', () => {
      const result = parse({ waypoint_lat: '', waypoint_lng: '' });

      expect(result.ok).toBe(true);
      expect(result.value.wpLat).toBeNull();
      expect(result.value.wpLng).toBeNull();
    });

    test('an empty departure_hour is treated as absent, not midnight', () => {
      const result = parse({ departure_hour: '' });

      expect(result.value.departureHour).toBeNull();
    });

    test('max_distance absent uses the default limit', () => {
      const result = parse();

      expect(result.value.maxDistanceKm).toBe(20);
    });

    test('max_distance below the default is honoured', () => {
      const result = parse({ max_distance: '5' });

      expect(result.value.maxDistanceKm).toBe(5);
    });

    test('max_distance above the default is capped at the default', () => {
      const result = parse({ max_distance: '50' });

      expect(result.value.maxDistanceKm).toBe(20);
    });

    test.each([
      ['NaN text', 'abc'],
      ['Infinity', 'Infinity'],
      ['negative', '-3'],
      ['zero', '0'],
    ])('max_distance %s is rejected with INVALID_MAX_DISTANCE', (_label, raw) => {
      const result = parse({ max_distance: raw });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_MAX_DISTANCE');
      expect(result.message).toMatch(/max_distance/);
    });

    test('poi_cap Infinity is clamped to the server maximum, never passed through', () => {
      const result = parse({ poi_cap: 'Infinity' });

      expect(Number.isFinite(result.value.responsePolicy.poiCaps.cctv)).toBe(true);
      expect(result.value.responsePolicy.poiCaps.cctv).toBeLessThanOrEqual(POI_CAP_MAX);
      expect(result.value.responsePolicy.poiCaps.cctv).toBeGreaterThan(0);
    });

    test('the server-side POI cap ceiling is 500', () => {
      expect(POI_CAP_MAX).toBe(500);
    });

    test('an explicit poi_cap above the ceiling is clamped to 500', () => {
      const result = parse({ poi_cap: '5000' });

      expect(result.value.responsePolicy.poiCaps.cctv).toBe(500);
      expect(result.value.responsePolicy.poiCaps.crimes).toBe(500);
    });

    test('per-category poi_cap_crimes of Infinity is clamped too', () => {
      const result = parse({ poi_cap_crimes: 'Infinity' });

      expect(Number.isFinite(result.value.responsePolicy.poiCaps.crimes)).toBe(true);
      expect(result.value.responsePolicy.poiCaps.crimes).toBeLessThanOrEqual(POI_CAP_MAX);
    });

    test('the uncapped keywords are clamped to the server maximum as well', () => {
      const result = parse({ poi_cap: 'uncapped' });

      expect(Number.isFinite(result.value.responsePolicy.poiCaps.places)).toBe(true);
      expect(result.value.responsePolicy.poiCaps.places).toBeLessThanOrEqual(POI_CAP_MAX);
    });

    test('a NaN poi_cap falls back to the default cap', () => {
      const result = parse({ poi_cap: 'abc' });

      expect(result.value.responsePolicy.poiCaps).toEqual(FULL_MODE_POI_CAPS);
    });
  });

  describe('waypoint detour and search area limits', () => {
    // Real haversine: the policy's distance checks must use true metres, not the stub used above.
    const ROUTE = {
      origin_lat: '51.50',
      origin_lng: '-0.12',
      dest_lat: '51.51',
      dest_lng: '-0.11',
    };
    const parseReal = (overrides = {}) =>
      parseRouteRequest(makeReq({ ...ROUTE, ...overrides }), 20, haversine);

    test('PoC: a waypoint on the far side of Europe is rejected as INVALID_WAYPOINT', () => {
      const result = parseReal({ waypoint_lat: '51.5', waypoint_lng: '4.5' });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_WAYPOINT');
      expect(typeof result.message).toBe('string');
    });

    test('a waypoint whose detour exceeds 2.5x the straight line is rejected', () => {
      // About 3.3 km north of the origin; the detour is roughly 5.6 km against a 1.3 km straight line.
      const result = parseReal({ waypoint_lat: '51.53', waypoint_lng: '-0.12' });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_WAYPOINT');
    });

    test('a waypoint close to the straight line is accepted', () => {
      const result = parseReal({ waypoint_lat: '51.505', waypoint_lng: '-0.115' });

      expect(result.ok).toBe(true);
      expect(result.value.wpLat).toBe(51.505);
      expect(result.value.wpLng).toBe(-0.115);
    });

    test('the detour is capped at maxDistanceKm: a waypoint within 2.5x but over max_distance is rejected', () => {
      // Detour about 3.0 km: inside 2.5x the 1.3 km straight line (3.3 km) but over a 2 km limit.
      const waypoint = { waypoint_lat: '51.5175', waypoint_lng: '-0.12' };

      expect(parseReal(waypoint).ok).toBe(true);
      const limited = parseReal({ ...waypoint, max_distance: '2' });
      expect(limited.ok).toBe(false);
      expect(limited.error).toBe('INVALID_WAYPOINT');
    });

    test('a waypoint farther than maxDistanceKm from the origin is rejected', () => {
      const result = parseReal({ waypoint_lat: '51.52', waypoint_lng: '-0.12', max_distance: '1' });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('INVALID_WAYPOINT');
    });

    test('MAX_SEARCH_BBOX_KM2 is 900', () => {
      expect(MAX_SEARCH_BBOX_KM2).toBe(900);
    });

    test('a long north-south trip within the 20 km premium range is inside the search area limit', () => {
      // About 19 km: the square search box with its corridor buffer is roughly 480 km2.
      const result = parseReal({ dest_lat: '51.17', origin_lat: '51.00' });

      expect(result.ok).toBe(true);
    });

    test('an ordinary short route is inside the search area limit', () => {
      const result = parseReal();

      expect(result.ok).toBe(true);
    });

    test('assertSearchBboxWithinLimit throws a 400 AREA_TOO_LARGE error above the limit and passes below it', () => {
      const { assertSearchBboxWithinLimit } = require('../../../../src/safety/routes/safeRoutesRequestPolicy');
      const small = { south: 51.0, north: 51.01, west: -0.1, east: -0.09 };
      const large = { south: 51.0, north: 51.9, west: -0.1, east: 0.3 }; // about 100 km x 28 km

      expect(() => assertSearchBboxWithinLimit(small)).not.toThrow();
      let thrown = null;
      try {
        assertSearchBboxWithinLimit(large);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).not.toBeNull();
      expect(thrown.statusCode).toBe(400);
      expect(thrown.code).toBe('AREA_TOO_LARGE');
    });

    test('searchBboxAreaKm2 measures the box in km2', () => {
      // 0.1 deg of latitude is about 11.1 km; 0.2 deg of longitude at 51 N is about 13.9 km.
      const area = searchBboxAreaKm2({ south: 51.0, north: 51.1, west: -0.1, east: 0.1 });

      expect(area).toBeGreaterThan(150);
      expect(area).toBeLessThan(160);
    });
  });
});
