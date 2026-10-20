const { BASE_WEIGHTS, PRIOR_SAFETY, MIN_FACTOR_SAFETY, CAUSE_MIN_RISK, UNCERTAINTY_RISK_LOAD } = require('./config');
const { assertNonNegative, assertInRange } = require('./validation');
const { evidenceStrength } = require('./evidence');

const FACTOR_NAMES = Object.keys(BASE_WEIGHTS);

// A factor missing from either table would silently drop out of the blend or take no prior,
// so the two key sets must match exactly. Checked once, at module load.
{
  const priorNames = Object.keys(PRIOR_SAFETY);
  const sameKeys = priorNames.length === FACTOR_NAMES.length
    && FACTOR_NAMES.every((name) => priorNames.includes(name));
  if (!sameKeys) {
    throw new Error('BASE_WEIGHTS and PRIOR_SAFETY must have the same factor keys');
  }
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
    // A caller may supply a context-specific prior (activity: the hour-dependent floor); it carries no evidence.
    if (supplied && factor.prior !== undefined) assertInRange(`factors.${name}.prior`, factor.prior, 0, 1);
    return { safety: supplied && factor.prior !== undefined ? factor.prior : PRIOR_SAFETY[name], n: 0, observed: false };
  }
  assertInRange(`factors.${name}.safety`, factor.safety, 0, 1);
  return { safety: factor.safety, n: factor.n, observed: true };
}

/**
 * Checks the weight vector. Only the peak weight must be positive: the caller rescales by it,
 * so the total is never formed from raw values that could overflow to Infinity.
 * @throws {TypeError} when weights is malformed or every weight is zero.
 */
function assertWeights(weights) {
  if (weights === null || typeof weights !== 'object') {
    throw new TypeError('weights must be an object');
  }
  for (const name of FACTOR_NAMES) {
    assertNonNegative(`weights.${name}`, weights[name]);
  }
  const peak = Math.max(...FACTOR_NAMES.map((name) => weights[name]));
  if (peak <= 0) throw new TypeError('weights must have a positive total');
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
 * The result then carries a prudent uncertainty load: risk = base + UNCERTAINTY_RISK_LOAD * (1 - certainty) * (1 - base),
 * so unknown costs more than verified at the same estimate and certainty 1 leaves the risk unchanged.
 *
 * dominantCause is only ever an observed factor, so a prior is never reported as the cause.
 *
 * @param {{factors: Object<string, {safety: number|null, n: number}>,
 *          weights: Object<string, number>, eps?: number}} options
 * @returns {{risk: number, certainty: number, dominantCause: string|null}}
 * @throws {TypeError} on malformed factors, weights or eps.
 */
function edgeRisk({ factors, weights, eps = MIN_FACTOR_SAFETY }) {
  if (factors === null || typeof factors !== 'object') {
    throw new TypeError('factors must be an object');
  }
  assertWeights(weights);
  assertInRange('eps', eps, 0, 1);
  if (eps === 0 || eps === 1) throw new TypeError('eps must be strictly between 0 and 1');

  // Scale by the peak first: ratios are at most 1, so their sum is finite and at least 1.
  const peak = Math.max(...FACTOR_NAMES.map((name) => weights[name]));
  const scaled = Object.fromEntries(FACTOR_NAMES.map((name) => [name, weights[name] / peak]));
  const total = FACTOR_NAMES.reduce((sum, name) => sum + scaled[name], 0);

  const resolved = Object.fromEntries(FACTOR_NAMES.map((name) => [name, resolveFactor(factors, name)]));

  let logSurvival = 0;
  let certainty = 0;
  const observedContributions = [];
  for (const name of FACTOR_NAMES) {
    const share = scaled[name] / total;
    if (share === 0) continue; // zero-weight factors (lighting in daylight) have no influence
    const { safety, n, observed } = resolved[name];
    const value = -share * Math.log(Math.max(eps, safety));
    logSurvival += value;
    certainty += share * evidenceStrength(n);
    if (observed) observedContributions.push({ name, value });
  }

  const baseRisk = 1 - Math.exp(-logSurvival);
  // We price what we do not know: less evidence adds a share of the remaining safety to the risk (config).
  const risk = baseRisk + UNCERTAINTY_RISK_LOAD * (1 - certainty) * (1 - baseRisk);
  const dominantCause = risk < CAUSE_MIN_RISK || observedContributions.length === 0
    ? null
    : strongestFactor(observedContributions);

  return { risk, certainty, dominantCause };
}

module.exports = { edgeRisk };
