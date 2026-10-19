const {
  parseRouteRequest,
  buildOutOfRangeMessage,
  buildOutOfRangePayload,
  RESPONSE_VERBOSITY_FULL,
  RESPONSE_VERBOSITY_COMPACT,
  FULL_MODE_POI_CAPS,
  COMPACT_MODE_POI_CAPS,
} = require('../../../../src/safety/routes/safeRoutesRequestPolicy');

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
      expect(result.value.responsePolicy.poiCaps.cctv).toBeLessThanOrEqual(5000);
      expect(result.value.responsePolicy.poiCaps.cctv).toBeGreaterThan(0);
    });

    test('per-category poi_cap_crimes of Infinity is clamped too', () => {
      const result = parse({ poi_cap_crimes: 'Infinity' });

      expect(Number.isFinite(result.value.responsePolicy.poiCaps.crimes)).toBe(true);
      expect(result.value.responsePolicy.poiCaps.crimes).toBeLessThanOrEqual(5000);
    });

    test('the uncapped keywords are clamped to the server maximum as well', () => {
      const result = parse({ poi_cap: 'uncapped' });

      expect(Number.isFinite(result.value.responsePolicy.poiCaps.places)).toBe(true);
      expect(result.value.responsePolicy.poiCaps.places).toBeLessThanOrEqual(5000);
    });

    test('a NaN poi_cap falls back to the default cap', () => {
      const result = parse({ poi_cap: 'abc' });

      expect(result.value.responsePolicy.poiCaps).toEqual(FULL_MODE_POI_CAPS);
    });
  });
});
