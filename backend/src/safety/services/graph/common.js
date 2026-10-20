/**
 * Small helpers shared by the graph stages: debug logging, cancellation and a work ticker.
 */

const DEBUG_SAFE_ROUTES = process.env.SAFE_ROUTES_DEBUG === '1';

/** console.log when SAFE_ROUTES_DEBUG=1, a no-op otherwise. */
const debugLog = DEBUG_SAFE_ROUTES ? (...args) => console.log(...args) : () => {};

/** Cancellation error: a client that went away or a request that was superseded (HTTP 409). */
function createSearchCancelledError(message = 'Route search cancelled.') {
  const err = new Error(message);
  err.code = 'SEARCH_CANCELLED';
  err.statusCode = 409;
  return err;
}

/**
 * Throws SEARCH_CANCELLED when the caller's shouldCancel callback says so.
 * @param {(() => boolean)|null|undefined} shouldCancel
 */
function throwIfCancelled(shouldCancel) {
  if (typeof shouldCancel === 'function' && shouldCancel()) {
    throw createSearchCancelledError('Route search cancelled during graph computation.');
  }
}

/** The callback when it is a function, else null. */
function cancelCallbackOf(options) {
  return options && typeof options.shouldCancel === 'function' ? options.shouldCancel : null;
}

/**
 * A ticker for long loops: call it once per unit of work and it checks for cancellation every 2048 calls.
 * @param {(() => boolean)|null} shouldCancel
 * @returns {() => void}
 */
function createTicker(shouldCancel) {
  let steps = 0;
  return () => {
    steps += 1;
    if ((steps & 2047) === 0) throwIfCancelled(shouldCancel);
  };
}

/** Clamps to [0, 1]. */
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

/** Own-property test that is safe for keys like "constructor" on plain tables. */
function hasOwnKey(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

module.exports = {
  debugLog,
  createSearchCancelledError,
  throwIfCancelled,
  cancelCallbackOf,
  createTicker,
  clamp01,
  hasOwnKey,
};
