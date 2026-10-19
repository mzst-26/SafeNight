/**
 * Evidence strength shared by lightingInference and edgeRisk, so the two modules
 * cannot drift apart on how much an estimate with n observations is worth.
 */

const { EVIDENCE_PSEUDO_COUNT } = require('./config');
const { assertNonNegative } = require('./validation');

/**
 * How much evidence backs an estimate, in [0, 1). An estimate with n equal to
 * EVIDENCE_PSEUDO_COUNT counts as half-certain.
 * @param {number} n Observations behind the estimate, finite and >= 0.
 * @returns {number} n / (n + EVIDENCE_PSEUDO_COUNT)
 * @throws {TypeError} When n is not a finite number >= 0.
 */
function evidenceStrength(n) {
  assertNonNegative('n', n);
  return n / (n + EVIDENCE_PSEUDO_COUNT);
}

module.exports = { evidenceStrength };
