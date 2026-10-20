// server.js pulls in the spatial index (flatbush is ESM-only under this jest config),
// so stub the data and pipeline modules; only the pure compare helper is under test.
jest.mock('../../src/dataStore', () => ({ queryBboxData: jest.fn(), getStats: jest.fn() }));
jest.mock('../../src/pipeline', () => ({ runPipeline: jest.fn() }));

const { safeKeyEquals } = require('../../src/server');

describe('safeKeyEquals', () => {
  test('returns true for an identical key', () => {
    expect(safeKeyEquals('s3cret-key-value', 's3cret-key-value')).toBe(true);
  });

  test('returns false for a same-length key that differs', () => {
    expect(safeKeyEquals('s3cret-key-valuX', 's3cret-key-value')).toBe(false);
  });

  test('returns false when the provided key is shorter', () => {
    expect(safeKeyEquals('s3cret', 's3cret-key-value')).toBe(false);
  });

  test('returns false when the provided key is longer', () => {
    expect(safeKeyEquals('s3cret-key-value-extra', 's3cret-key-value')).toBe(false);
  });

  test('returns false when no key is provided', () => {
    expect(safeKeyEquals(undefined, 's3cret-key-value')).toBe(false);
  });

  test('returns false when the header is an array', () => {
    expect(safeKeyEquals(['s3cret-key-value'], 's3cret-key-value')).toBe(false);
  });
});
