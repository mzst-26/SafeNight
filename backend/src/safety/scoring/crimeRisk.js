/**
 * crimeRisk.js — severity-weighted, recency-decayed, empirically shrunk crime risk.
 *
 * Pure functions, no I/O. Spec: docs/superpowers/specs/2026-10-19-safety-scoring-v2-design.md §11.4, §11.7.
 *
 * Units: weighted crimes are dimensionless (severity * recency); exposure is km;
 * rates are weighted crimes per km over the window.
 */

// Copied from services/crimeClient.js CRIME_SEVERITY. Deliberately not imported:
// the v2 scoring module must not depend on the legacy client.
const CRIME_SEVERITY = {
  'violent-crime':          1.0,
  'robbery':                1.0,
  'sexual-offences':        1.0,
  'possession-of-weapons':  0.9,
  'public-order':           0.7,
  'criminal-damage-arson':  0.6,
  'burglary':               0.5,
  'vehicle-crime':          0.4,
  'drugs':                  0.4,
  'theft-from-the-person':  0.8,
  'bicycle-theft':          0.3,
  'shoplifting':            0.2,
  'other-theft':            0.3,
  'anti-social-behaviour':  0.3,
  'other-crime':            0.4,
  'unknown':                0.4,
};

const UNKNOWN_CATEGORY_SEVERITY = 0.3;
const DEFAULT_HALF_LIFE_MONTHS = 4;
const DEFAULT_PRIOR_STRENGTH = 2;

/** Weighted crimes per km that map to a risk of 1 - e^-1 (~0.63). */
const RATE_SCALE = 6;

const STATUS_OK = 'ok';
const STATUS_UNAVAILABLE = 'unavailable';
const VALID_STATUSES = new Set([STATUS_OK, STATUS_UNAVAILABLE]);

/**
 * @param {unknown} value
 * @param {string} name
 */
function assertNonNegativeFinite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite number >= 0`);
  }
}

/**
 * @param {string} category Police API crime category slug.
 * @returns {number} Severity in (0, 1]; 0.3 for unrecognised categories.
 */
function severityOf(category) {
  return Object.prototype.hasOwnProperty.call(CRIME_SEVERITY, category)
    ? CRIME_SEVERITY[category]
    : UNKNOWN_CATEGORY_SEVERITY;
}

/**
 * Exponential recency decay: a crime one half-life old counts half as much.
 *
 * @param {number} monthsAgo Finite, >= 0.
 * @param {number} [halfLifeMonths=4] Positive; Infinity means no decay.
 * @returns {number} Weight in (0, 1].
 * @throws {TypeError} On invalid monthsAgo or halfLifeMonths.
 */
function recencyWeight(monthsAgo, halfLifeMonths = DEFAULT_HALF_LIFE_MONTHS) {
  assertNonNegativeFinite(monthsAgo, 'monthsAgo');
  if (typeof halfLifeMonths !== 'number' || Number.isNaN(halfLifeMonths) || halfLifeMonths <= 0) {
    throw new TypeError('halfLifeMonths must be > 0');
  }
  return Math.pow(0.5, monthsAgo / halfLifeMonths);
}

/**
 * Sum of severity * recency over crimes. Entries with a non-finite monthsAgo are skipped.
 *
 * @param {Array<{category: string, monthsAgo: number}>} crimes
 * @param {{halfLifeMonths?: number}} [options]
 * @returns {number}
 * @throws {TypeError} If crimes is not an array, or an age is negative.
 */
function weightedCrimeCount(crimes, { halfLifeMonths = DEFAULT_HALF_LIFE_MONTHS } = {}) {
  if (!Array.isArray(crimes)) {
    throw new TypeError('crimes must be an array');
  }
  return crimes.reduce((sum, crime) => {
    if (!Number.isFinite(crime.monthsAgo)) return sum;
    return sum + severityOf(crime.category) * recencyWeight(crime.monthsAgo, halfLifeMonths);
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
 * @param {number} [params.priorStrength=2] Prior weight k in km-equivalents, > 0.
 * @param {'ok'|'unavailable'} [params.status='ok']
 * @returns {{risk: number, lambda: number, n: number, status: string}}
 * @throws {TypeError} On invalid inputs.
 */
function crimeRisk({
  weightedCount,
  exposureKm,
  priorRate,
  priorStrength = DEFAULT_PRIOR_STRENGTH,
  status = STATUS_OK,
}) {
  assertNonNegativeFinite(weightedCount, 'weightedCount');
  assertNonNegativeFinite(exposureKm, 'exposureKm');
  assertNonNegativeFinite(priorRate, 'priorRate');
  if (typeof priorStrength !== 'number' || !Number.isFinite(priorStrength) || priorStrength <= 0) {
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
  const risk = -Math.expm1(-lambda / RATE_SCALE);

  return { risk, lambda, n, status };
}

module.exports = {
  severityOf,
  recencyWeight,
  weightedCrimeCount,
  crimeRisk,
  RATE_SCALE,
};
