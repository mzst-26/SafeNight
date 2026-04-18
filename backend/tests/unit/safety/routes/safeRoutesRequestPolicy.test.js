const {
  parseRouteRequest,
  buildOutOfRangeMessage,
  buildOutOfRangePayload,
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
