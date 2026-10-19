/**
 * crimeRisk.js — severity-weighted, recency-decayed, empirically shrunk crime risk.
 *
 * Pure functions, no I/O. Spec: docs/superpowers/specs/2026-10-19-safety-scoring-v2-design.md §11.4, §11.7.
 *
 * Units: weighted crimes are dimensionless (severity * recency); exposure is km;
 * rates are weighted crimes per km over the window.
 */

const { CRIME } = require('./config');
const { assertFinite, assertNonNegative } = require('./validation');
const { severityOf } = require('../services/crimeSeverity');

const STATUS_OK = 'ok';
const STATUS_UNAVAILABLE = 'unavailable';
const VALID_STATUSES = new Set([STATUS_OK, STATUS_UNAVAILABLE]);

/**
 * Exponential recency decay: a crime one half-life old counts half as much.
 *
 * @param {number} monthsAgo Finite, >= 0.
 * @param {number} [halfLifeMonths=CRIME.HALF_LIFE_MONTHS] Positive; Infinity means no decay.
 * @returns {number} Weight in (0, 1].
 * @throws {TypeError} On invalid monthsAgo or halfLifeMonths.
 */
function recencyWeight(monthsAgo, halfLifeMonths = CRIME.HALF_LIFE_MONTHS) {
  assertNonNegative('monthsAgo', monthsAgo);
  if (typeof halfLifeMonths !== 'number' || Number.isNaN(halfLifeMonths) || halfLifeMonths <= 0) {
    throw new TypeError('halfLifeMonths must be > 0');
  }
  return Math.pow(0.5, monthsAgo / halfLifeMonths);
}

/**
 * Sum of severity * recency over crimes.
 *
 * Null or undefined entries are skipped. A row whose monthsAgo is not finite, or is negative,
 * still happened, so it is counted at full recency weight (as if monthsAgo were 0). Treating it
 * as zero harm would understate the risk of a real crime just because its date is bad.
 *
 * @param {Array<{category: string, monthsAgo: number}>} crimes
 * @param {{halfLifeMonths?: number}} [options]
 * @returns {number}
 * @throws {TypeError} If crimes is not an array.
 */
function weightedCrimeCount(crimes, { halfLifeMonths = CRIME.HALF_LIFE_MONTHS } = {}) {
  if (!Array.isArray(crimes)) {
    throw new TypeError('crimes must be an array');
  }
  return crimes.reduce((sum, crime) => {
    if (!crime) return sum;
    const usableAge = Number.isFinite(crime.monthsAgo) && crime.monthsAgo >= 0;
    const monthsAgo = usableAge ? crime.monthsAgo : 0;
    return sum + severityOf(crime.category) * recencyWeight(monthsAgo, halfLifeMonths);
  }, 0);
}

/**
 * Empirical-Bayes crime risk for one cell or segment.
 *
 *   lambda = (weightedCount + k * priorRate) / (exposureKm + k)
 *   risk   = 1 - exp(-lambda / RATE_SCALE)
 *   n      = exposureKm / (exposureKm + k)     (share of the estimate from local data)
 *
 * With status 'unavailable' the local data is absent, so the estimate is the prior alone:
 * lambda = priorRate and n = 0. The caller decides the status; it is honoured as given.
 *
 * @param {object} params
 * @param {number} params.weightedCount Severity- and recency-weighted crime count, >= 0.
 * @param {number} params.exposureKm Exposure in km, >= 0.
 * @param {number} params.priorRate Area mean in weighted crimes per km, >= 0.
 * @param {number} [params.priorStrength=CRIME.PRIOR_STRENGTH] Prior weight k in km-equivalents, > 0.
 * @param {'ok'|'unavailable'} [params.status='ok']
 * @returns {{risk: number, lambda: number, n: number, status: string}}
 * @throws {TypeError} On invalid inputs.
 */
function crimeRisk({
  weightedCount,
  exposureKm,
  priorRate,
  priorStrength = CRIME.PRIOR_STRENGTH,
  status = STATUS_OK,
}) {
  assertNonNegative('weightedCount', weightedCount);
  assertNonNegative('exposureKm', exposureKm);
  assertNonNegative('priorRate', priorRate);
  assertFinite('priorStrength', priorStrength);
  if (priorStrength <= 0) {
    throw new TypeError('priorStrength must be a finite number > 0');
  }
  if (!VALID_STATUSES.has(status)) {
    throw new TypeError(`status must be one of: ${[...VALID_STATUSES].join(', ')}`);
  }

  const unavailable = status === STATUS_UNAVAILABLE;
  const lambda = unavailable
    ? priorRate
    : (weightedCount + priorStrength * priorRate) / (exposureKm + priorStrength);
  const n = unavailable ? 0 : exposureKm / (exposureKm + priorStrength);
  const risk = -Math.expm1(-lambda / CRIME.RATE_SCALE);

  return { risk, lambda, n, status };
}

module.exports = {
  recencyWeight,
  weightedCrimeCount,
  crimeRisk,
};
