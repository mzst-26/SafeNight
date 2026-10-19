/**
 * lightingInference.js — Evidence-weighted estimate that a road segment is lit.
 *
 * Combines explicit OSM lighting tags, a tag-based prior and nearby street-lamp
 * evidence into { pLit, n }: the probability the segment is lit and the strength
 * of the evidence behind it. effectiveLit shrinks that estimate towards 0.5 when
 * the evidence is thin, so a guess never looks as certain as a surveyed tag.
 *
 * All functions are pure and never mutate their inputs.
 */

/** Pseudo-count n0: how much the neutral 0.5 counts against the evidence. */
const PRIOR_STRENGTH = 4;
const NEUTRAL_LIT = 0.5;

/** Explicit lit tag values and their evidence. Anything else falls through. */
const EXPLICIT_LIT = new Map([
  ['yes', { pLit: 0.95, n: 20 }],
  ['24/7', { pLit: 0.95, n: 20 }],
  ['no', { pLit: 0.05, n: 20 }],
  ['limited', { pLit: 0.5, n: 10 }],
  ['automatic', { pLit: 0.5, n: 10 }],
]);

/** Lamp evidence within 30 m. */
const LAMP_PLIT_ONE = 0.85;
const LAMP_PLIT_MANY = 0.92;
const LAMP_MANY_THRESHOLD = 3;
const LAMP_EVIDENCE_N = 6;

/** Absence of lamps is informative only where lamps are mapped nearby. */
const ABSENCE_MIN_LAMP_DENSITY_PER_KM = 2;
const ABSENCE_MIN_AREA_WAY_KM = 0.3;
const ABSENCE_PLIT_FACTOR = 0.6;
const ABSENCE_EVIDENCE_N = 3;

/** Speed limits: OSM bare numbers are km/h; 30 mph is about 48 km/h. */
const MPH_TO_KMH = 1.609344;
const URBAN_SPEED_MAX_KMH = 50;
const MAXSPEED_PATTERN = /^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?$/i;

const SIDEWALK_PRESENT = new Set(['yes', 'both', 'left', 'right', 'separate']);
const PATH_HIGHWAYS = new Set(['path', 'track', 'bridleway', 'footway', 'cycleway', 'steps']);
const MAJOR_HIGHWAYS = new Set(['trunk', 'primary', 'secondary']);
const RESIDENTIAL_HIGHWAYS = new Set(['living_street', 'residential']);

const PRIOR_PATH = Object.freeze({ pLit: 0.15, n: 3 });
const PRIOR_MAJOR = Object.freeze({ pLit: 0.85, n: 4 });
const PRIOR_URBAN_SPEED = Object.freeze({ pLit: 0.8, n: 4 });
const PRIOR_RESIDENTIAL_SIDEWALK = Object.freeze({ pLit: 0.8, n: 4 });
const PRIOR_RESIDENTIAL = Object.freeze({ pLit: 0.7, n: 3 });
const PRIOR_TERTIARY = Object.freeze({ pLit: 0.7, n: 3 });
const PRIOR_SERVICE = Object.freeze({ pLit: 0.4, n: 2 });
const PRIOR_UNKNOWN = Object.freeze({ pLit: 0.4, n: 2 });

/**
 * Parse an OSM maxspeed value into km/h.
 * @param {string|undefined} value - e.g. '30 mph', '30', '50 km/h'
 * @returns {number|null} speed in km/h, or null when not a plain number
 */
function parseMaxspeedKmh(value) {
  if (value === undefined) return null;
  const match = MAXSPEED_PATTERN.exec(value.trim());
  if (!match) return null;
  const speed = Number(match[1]);
  return match[2] && match[2].toLowerCase() === 'mph' ? speed * MPH_TO_KMH : speed;
}

/**
 * Prior from road class, speed and sidewalk tags (no lamp evidence).
 * @param {Object} tags - OSM tags
 * @returns {{pLit: number, n: number}}
 */
function tagPrior(tags) {
  const { highway } = tags;
  if (PATH_HIGHWAYS.has(highway)) return PRIOR_PATH;
  if (MAJOR_HIGHWAYS.has(highway)) return PRIOR_MAJOR;

  const speedKmh = parseMaxspeedKmh(tags.maxspeed);
  if (speedKmh !== null && speedKmh <= URBAN_SPEED_MAX_KMH) return PRIOR_URBAN_SPEED;

  if (RESIDENTIAL_HIGHWAYS.has(highway)) {
    return SIDEWALK_PRESENT.has(tags.sidewalk) ? PRIOR_RESIDENTIAL_SIDEWALK : PRIOR_RESIDENTIAL;
  }
  if (highway === 'tertiary') return PRIOR_TERTIARY;
  if (highway === 'service') return PRIOR_SERVICE;
  return PRIOR_UNKNOWN;
}

/**
 * @param {*} value
 * @param {string} name
 * @throws {TypeError}
 */
function assertNonNegativeNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`);
  }
}

/**
 * @param {*} value
 * @param {string} name
 * @throws {TypeError}
 */
function assertOptionalString(value, name) {
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`${name} must be a string when present`);
  }
}

/**
 * @param {*} tags
 * @throws {TypeError}
 */
function assertTags(tags) {
  if (tags === null || typeof tags !== 'object' || Array.isArray(tags)) {
    throw new TypeError('tags must be an object');
  }
  assertOptionalString(tags.highway, 'tags.highway');
  assertOptionalString(tags.lit, 'tags.lit');
  assertOptionalString(tags.maxspeed, 'tags.maxspeed');
  assertOptionalString(tags.sidewalk, 'tags.sidewalk');
}

/**
 * Estimate P(lit) and its evidence strength for one road segment.
 *
 * An explicit lit tag is ground truth and wins outright. Otherwise the tag prior
 * is raised by nearby lamps, or lowered when lamps are mapped densely around
 * the segment but none is nearby.
 *
 * @param {Object} input
 * @param {Object} input.tags - OSM tags of the way
 * @param {number} input.lampCount30m - street lamps within 30 m (integer >= 0)
 * @param {number} input.areaLampDensityPerKm - mapped lamps per km in the surrounding area
 * @param {number} input.areaWayKm - mapped road length in the surrounding area, km
 * @returns {{pLit: number, n: number, source: 'tag'|'lamp'|'absence'|'prior'}}
 * @throws {TypeError} when any input is malformed
 */
function inferLighting({ tags, lampCount30m, areaLampDensityPerKm, areaWayKm }) {
  assertTags(tags);
  if (!Number.isInteger(lampCount30m) || lampCount30m < 0) {
    throw new TypeError('lampCount30m must be a non-negative integer');
  }
  assertNonNegativeNumber(areaLampDensityPerKm, 'areaLampDensityPerKm');
  assertNonNegativeNumber(areaWayKm, 'areaWayKm');

  if (EXPLICIT_LIT.has(tags.lit)) {
    return { ...EXPLICIT_LIT.get(tags.lit), source: 'tag' };
  }

  const prior = tagPrior(tags);

  if (lampCount30m >= 1) {
    const pLit = Math.max(
      prior.pLit,
      lampCount30m >= LAMP_MANY_THRESHOLD ? LAMP_PLIT_MANY : LAMP_PLIT_ONE,
    );
    return { pLit, n: prior.n + LAMP_EVIDENCE_N, source: 'lamp' };
  }

  const absenceIsInformative = areaLampDensityPerKm > ABSENCE_MIN_LAMP_DENSITY_PER_KM
    && areaWayKm >= ABSENCE_MIN_AREA_WAY_KM;
  if (absenceIsInformative) {
    return {
      pLit: prior.pLit * ABSENCE_PLIT_FACTOR,
      n: prior.n + ABSENCE_EVIDENCE_N,
      source: 'absence',
    };
  }

  return { pLit: prior.pLit, n: prior.n, source: 'prior' };
}

/**
 * Shrink an estimate towards 0.5 in proportion to how little evidence it has.
 * @param {{pLit: number, n: number}} estimate
 * @returns {number} effective P(lit) in [0, 1]
 * @throws {TypeError} when pLit is not in [0, 1] or n is negative
 */
function effectiveLit({ pLit, n }) {
  if (typeof pLit !== 'number' || !Number.isFinite(pLit) || pLit < 0 || pLit > 1) {
    throw new TypeError('pLit must be a number in [0, 1]');
  }
  assertNonNegativeNumber(n, 'n');
  return (pLit * n + NEUTRAL_LIT * PRIOR_STRENGTH) / (n + PRIOR_STRENGTH);
}

/**
 * How much evidence backs an estimate, in [0, 1).
 * @param {{n: number}} estimate
 * @returns {number} n / (n + n0)
 * @throws {TypeError} when n is negative or not finite
 */
function lightingCertainty({ n }) {
  assertNonNegativeNumber(n, 'n');
  return n / (n + PRIOR_STRENGTH);
}

module.exports = {
  inferLighting,
  effectiveLit,
  lightingCertainty,
};
