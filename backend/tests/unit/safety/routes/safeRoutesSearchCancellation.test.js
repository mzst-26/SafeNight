const {
  createCancellationToken,
  withSearchCancellation,
} = require('../../../../src/safety/routes/safeRoutesRuntime');

describe('withSearchCancellation', () => {
  test('hands the safest-path search a shouldCancel that follows the request cancel token', () => {
    const token = createCancellationToken();
    const search = jest.fn(() => 'routes');
    const wrapped = withSearchCancellation(search, token);

    const result = wrapped({}, [], new Map(), 1, 2, 300, 3, { allowHazards: true });

    expect(result).toBe('routes');
    const passedOptions = search.mock.calls[0][7];
    expect(passedOptions.allowHazards).toBe(true);
    expect(passedOptions.shouldCancel()).toBe(false);

    token.cancel('client disconnected');

    expect(passedOptions.shouldCancel()).toBe(true);
  });

  test('works when the caller passes no options', () => {
    const token = createCancellationToken();
    const search = jest.fn(() => []);
    const wrapped = withSearchCancellation(search, token);

    wrapped({}, [], new Map(), 1, 2, 300, 3);

    expect(search.mock.calls[0][7].shouldCancel()).toBe(false);
  });
});
