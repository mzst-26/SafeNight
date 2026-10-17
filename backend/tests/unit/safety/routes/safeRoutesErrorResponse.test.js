const { routeErrorResponse } = require('../../../../src/safety/routes/safeRoutesResponseFormatter');

describe('routeErrorResponse', () => {
  test('passes a 404 answer with a code through with its status and message', () => {
    const err = Object.assign(new Error('We found roads in this area but none of them are walkable.'), {
      statusCode: 404,
      code: 'NO_WALKING_NETWORK',
      roadCount: 1524,
    });

    expect(routeErrorResponse(err)).toEqual({
      status: 404,
      payload: {
        error: 'NO_WALKING_NETWORK',
        message: 'We found roads in this area but none of them are walkable.',
      },
    });
  });

  test('leaves plain errors to the 500 fallback', () => {
    expect(routeErrorResponse(new Error('boom'))).toBeNull();
  });

  test('leaves server-side statuses to the 500 fallback', () => {
    const err = Object.assign(new Error('upstream broke'), { statusCode: 502, code: 'UPSTREAM_BAD' });
    expect(routeErrorResponse(err)).toBeNull();
  });

  test('requires a code, so a bare 404 is not treated as a known answer', () => {
    expect(routeErrorResponse(Object.assign(new Error('not found'), { statusCode: 404 }))).toBeNull();
  });

  test('handles missing input', () => {
    expect(routeErrorResponse(null)).toBeNull();
    expect(routeErrorResponse(undefined)).toBeNull();
  });
});
