/**
 * Shared input guards for the scoring modules. Every guard throws TypeError
 * so callers get one consistent failure mode for bad input.
 */

/**
 * @param {string} name Parameter name used in the error message.
 * @param {*} value
 * @returns {number} The value, when it is a finite number.
 * @throws {TypeError}
 */
function assertFinite(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

/**
 * @param {string} name
 * @param {*} value
 * @returns {number} The value, when it is a finite number >= 0.
 * @throws {TypeError}
 */
function assertNonNegative(name, value) {
  assertFinite(name, value);
  if (value < 0) throw new TypeError(`${name} must be >= 0`);
  return value;
}

/**
 * @param {string} name
 * @param {*} value
 * @param {number} min Inclusive lower bound.
 * @param {number} max Inclusive upper bound.
 * @returns {number} The value, when it is a finite number within [min, max].
 * @throws {TypeError}
 */
function assertInRange(name, value, min, max) {
  assertFinite(name, value);
  if (value < min || value > max) {
    throw new TypeError(`${name} must be within [${min}, ${max}]`);
  }
  return value;
}

module.exports = { assertFinite, assertNonNegative, assertInRange };
