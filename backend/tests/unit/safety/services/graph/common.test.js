const path = require('path');
const common = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/common'));

describe('graph/common', () => {
  test('createSearchCancelledError is a 409 SEARCH_CANCELLED with a default message', () => {
    const err = common.createSearchCancelledError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ code: 'SEARCH_CANCELLED', statusCode: 409, message: 'Route search cancelled.' });
    expect(common.createSearchCancelledError('custom').message).toBe('custom');
  });

  test('throwIfCancelled throws only when a function says so', () => {
    expect(() => common.throwIfCancelled(() => true)).toThrow(expect.objectContaining({ code: 'SEARCH_CANCELLED' }));
    expect(() => common.throwIfCancelled(() => false)).not.toThrow();
    expect(() => common.throwIfCancelled(null)).not.toThrow();
    expect(() => common.throwIfCancelled(undefined)).not.toThrow();
    expect(() => common.throwIfCancelled('yes')).not.toThrow();
  });

  test('cancelCallbackOf returns the callback or null', () => {
    const fn = () => false;
    expect(common.cancelCallbackOf({ shouldCancel: fn })).toBe(fn);
    expect(common.cancelCallbackOf({ shouldCancel: 'x' })).toBeNull();
    expect(common.cancelCallbackOf({})).toBeNull();
    expect(common.cancelCallbackOf(null)).toBeNull();
    expect(common.cancelCallbackOf(undefined)).toBeNull();
  });

  test('createTicker checks for cancellation every 2048 calls, not before', () => {
    const shouldCancel = jest.fn(() => false);
    const tick = common.createTicker(shouldCancel);
    for (let i = 0; i < 2047; i++) tick();
    expect(shouldCancel).not.toHaveBeenCalled();
    tick();
    expect(shouldCancel).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 2048; i++) tick();
    expect(shouldCancel).toHaveBeenCalledTimes(2);
  });

  test('createTicker throws SEARCH_CANCELLED at the checkpoint when cancelled, and tolerates no callback', () => {
    const tick = common.createTicker(() => true);
    expect(() => { for (let i = 0; i < 2048; i++) tick(); }).toThrow(expect.objectContaining({ code: 'SEARCH_CANCELLED' }));
    const quiet = common.createTicker(null);
    expect(() => { for (let i = 0; i < 5000; i++) quiet(); }).not.toThrow();
  });

  test('clamp01 clamps to the unit interval', () => {
    expect([-0.5, 0, 0.3, 1, 7].map(common.clamp01)).toEqual([0, 0, 0.3, 1, 1]);
  });

  test('hasOwnKey ignores inherited keys such as constructor', () => {
    const table = { gravel: 0.04 };
    expect(common.hasOwnKey(table, 'gravel')).toBe(true);
    expect(common.hasOwnKey(table, 'constructor')).toBe(false);
    expect(common.hasOwnKey(table, undefined)).toBe(false);
  });

  test('debugLog is callable and silent without SAFE_ROUTES_DEBUG', () => {
    expect(() => common.debugLog('x', 1)).not.toThrow();
  });
});

describe('graph/common debugLog with SAFE_ROUTES_DEBUG=1', () => {
  test('forwards to console.log', () => {
    const previous = process.env.SAFE_ROUTES_DEBUG;
    process.env.SAFE_ROUTES_DEBUG = '1';
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      let mod;
      jest.isolateModules(() => { mod = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/common')); });
      mod.debugLog('hello', 2);
      expect(spy).toHaveBeenCalledWith('hello', 2);
    } finally {
      spy.mockRestore();
      if (previous === undefined) delete process.env.SAFE_ROUTES_DEBUG;
      else process.env.SAFE_ROUTES_DEBUG = previous;
    }
  });
});
