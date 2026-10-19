const { EPS, N0, CAUSE_MIN_RISK, PRIOR_SAFETY } = require('./config');
const { assertNonNegative, assertInRange } = require('./validation');

const FACTOR_NAMES = Object.keys(PRIOR_SAFETY);

/** Evidence strength of an estimate backed by n observations, in [0, 1). */
function evidenceStrength(n) {
  return n / (n + N0);
}

/**
 * Resolves one factor to { safety, n, observed }, validating any supplied value.
 * A missing factor or a null/undefined safety is unavailable: it takes the neutral prior
 * from config with n = 0, so it still counts in the blend but adds no certainty.
 * @throws {TypeError} when a supplied safety is not a finite number in [0, 1], or n is not >= 0.
 */
function resolveFactor(factors, name) {
  const factor = factors[name];
  const supplied = factor !== undefined && factor !== null;
  if (supplied) assertNonNegative(`factors.${name}.n`, factor.n);

  if (!supplied || factor.safety === null || factor.safety === undefined) {
    return { safety: PRIOR_SAFETY[name], n: 0, observed: false };
  }
  assertInRange(`factors.${name}.safety`, factor.safety, 0, 1);
  return { safety: factor.safety, n: factor.n, observed: true };
}

/**
 * @throws {TypeError} when weights is malformed or has no positive total.
 */
function assertWeights(weights) {
  if (weights === null || typeof weights !== 'object') {
    throw new TypeError('weights must be an object');
  }
  for (const name of FACTOR_NAMES) {
    assertNonNegative(`weights.${name}`, weights[name]);
  }
  const total = FACTOR_NAMES.reduce((sum, name) => sum + weights[name], 0);
  if (total <= 0) throw new TypeError('weights must have a positive total');
}

/** Name of the observed factor with the largest contribution. */
function strongestFactor(contributions) {
  return contributions.reduce((best, current) => (current.value > best.value ? current : best)).name;
}

/**
 * Combined risk for one edge: 1 - prod_i(max(eps, s_i)^w_i), over every factor with weight.
 *
 * Unavailable factors are not dropped: each takes its neutral prior (config PRIOR_SAFETY) with
 * n = 0. Missing data therefore lowers the score by the prior, never silently to "safe".
 *
 * dominantCause is only ever an observed factor, so a prior is never reported as the cause.
 *
 * @param {{factors: Object<string, {safety: number|null, n: number}>,
 *          weights: Object<string, number>, eps?: number}} options
 * @returns {{risk: number, certainty: number, dominantCause: string|null}}
 * @throws {TypeError} on malformed factors, weights or eps.
 */
function edgeRisk({ factors, weights, eps = EPS }) {
  if (factors === null || typeof factors !== 'object') {
    throw new TypeError('factors must be an object');
  }
  assertWeights(weights);
  assertInRange('eps', eps, 0, 1);
  if (eps === 0 || eps === 1) throw new TypeError('eps must be strictly between 0 and 1');

  const resolved = Object.fromEntries(FACTOR_NAMES.map((name) => [name, resolveFactor(factors, name)]));
  const total = FACTOR_NAMES.reduce((sum, name) => sum + weights[name], 0);

  let logSurvival = 0;
  let certainty = 0;
  const observedContributions = [];
  for (const name of FACTOR_NAMES) {
    const share = weights[name] / total;
    if (share === 0) continue; // zero-weight factors (lighting in daylight) have no influence
    const { safety, n, observed } = resolved[name];
    const value = -share * Math.log(Math.max(eps, safety));
    logSurvival += value;
    certainty += share * evidenceStrength(n);
    if (observed) observedContributions.push({ name, value });
  }

  const risk = 1 - Math.exp(-logSurvival);
  const dominantCause = risk < CAUSE_MIN_RISK || observedContributions.length === 0
    ? null
    : strongestFactor(observedContributions);

  return { risk, certainty, dominantCause };
}

module.exports = { edgeRisk };
