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
    expect(result.value.responsePolicy).toEqual({
      verbosity: RESPONSE_VERBOSITY_FULL,
      poiCaps: FULL_MODE_POI_CAPS,
    });
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
});
