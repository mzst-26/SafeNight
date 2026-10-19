const { EPS, N0, CAUSE_MIN_RISK } = require('./config');

// Risk reported when no factor carries any weight: maximal uncertainty, not evidence of danger.
const NO_EVIDENCE_RISK = 0.5;

/**
 * True when a factor has a usable safety value (null or undefined means unavailable).
 * @param {Object<string, {safety: number|null, n: number}>} factors
 * @param {string} name
 */
function isAvailable(factors, name) {
  const factor = factors[name];
  return factor !== undefined && factor !== null && factor.safety !== null && factor.safety !== undefined;
}

/**
 * Weights restricted to available factors and renormalised to sum to 1.
 * Empty when nothing available carries weight.
 * @returns {Object<string, number>}
 */
function availableShares(factors, weights) {
  const names = Object.keys(weights).filter((name) => isAvailable(factors, name));
  const total = names.reduce((sum, name) => sum + weights[name], 0);
  if (total === 0) return {};
  return Object.fromEntries(names.map((name) => [name, weights[name] / total]));
}

/** Evidence strength of an estimate backed by n observations, in [0, 1). */
function evidenceStrength(n) {
  return n / (n + N0);
}

/** Weighted log-survival contribution of one factor: -w * ln(max(eps, s)), always >= 0. */
function contributionOf(safety, share, eps) {
  return -share * Math.log(Math.max(eps, safety));
}

/** Name of the factor with the largest contribution. */
function strongestFactor(contributions) {
  return contributions.reduce((best, current) => (current.value > best.value ? current : best)).name;
}

/**
 * Combined risk for one edge: 1 - prod_i(max(eps, s_i)^w_i) over available factors.
 * @param {{factors: Object<string, {safety: number|null, n: number}>,
 *          weights: Object<string, number>, eps?: number}} options
 * @returns {{risk: number, certainty: number, dominantCause: string|null}}
 */
function edgeRisk({ factors, weights, eps = EPS }) {
  const shares = availableShares(factors, weights);
  const names = Object.keys(shares);
  if (names.length === 0) return { risk: NO_EVIDENCE_RISK, certainty: 0, dominantCause: null };

  const contributions = names.map((name) => ({
    name,
    value: contributionOf(factors[name].safety, shares[name], eps),
  }));
  const risk = 1 - Math.exp(-contributions.reduce((sum, c) => sum + c.value, 0));
  const certainty = names.reduce((sum, name) => sum + shares[name] * evidenceStrength(factors[name].n), 0);
  const dominantCause = risk < CAUSE_MIN_RISK ? null : strongestFactor(contributions);

  return { risk, certainty, dominantCause };
}

module.exports = { edgeRisk };
