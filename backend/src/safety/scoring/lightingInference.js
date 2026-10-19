/**
 * lightingInference.js — Evidence-weighted estimate that a road segment is lit.
 *
 * Combines explicit OSM lighting tags, a tag-based prior and nearby street-lamp
 * evidence into { pLit, n }: the probability the segment is lit and the strength
 * of the evidence behind it. effectiveLit shrinks that estimate towards 0.5 when
 * the evidence is thin, so a guess never looks as certain as a surveyed tag.
 *
 * Every numeric tunable lives in config.js (LIGHTING, EVIDENCE_PSEUDO_COUNT). The sets below are
 * OSM class taxonomy, not tunables. Evidence strength comes from evidence.js, shared with edgeRisk.
 *
 * All functions are pure and never mutate their inputs.
 */

const { LIGHTING, EVIDENCE_PSEUDO_COUNT } = require('./config');
const { assertNonNegative, assertNonNegativeInteger, assertInRange } = require('./validation');
const { evidenceStrength } = require('./evidence');

const MAXSPEED_PATTERN = /^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?$/;

const SIDEWALK_PRESENT = new Set(['yes', 'both', 'left', 'right', 'separate']);
const PATH_HIGHWAYS = new Set(['path', 'track', 'bridleway', 'footway', 'cycleway', 'steps']);
const MAJOR_HIGHWAYS = new Set(['trunk', 'primary', 'secondary']);
const RESIDENTIAL_HIGHWAYS = new Set(['living_street', 'residential']);

/** Own-property lookup, so inherited keys such as 'constructor' never match a tag value. */
function hasOwn(object, key) {
  return key !== undefined && Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * Trim and lower-case the tag values used for inference, so ' Footway ', 'FOOTWAY' and
 * 'footway' are the same class. Absent tags stay undefined.
 * @param {Object} tags - validated OSM tags
 * @returns {{highway: string|undefined, lit: string|undefined, maxspeed: string|undefined, sidewalk: string|undefined}}
 */
function normaliseTags(tags) {
  const norm = (value) => (value === undefined ? undefined : value.trim().toLowerCase());
  return {
    highway: norm(tags.highway),
    lit: norm(tags.lit),
    maxspeed: norm(tags.maxspeed),
    sidewalk: norm(tags.sidewalk),
  };
}

/**
 * Parse an OSM maxspeed value into km/h. A list ('30;50') uses its first value.
 * Zero, negative and non-numeric values give null, so they cannot count as urban.
 * @param {string|undefined} value - normalised: trimmed and lower-case, e.g. '30 mph', '30', '50 km/h', 'gb:urban'
 * @returns {number|null} speed in km/h, or null when there is no usable limit
 */
function parseMaxspeedKmh(value) {
  if (value === undefined) return null;
  const first = value.split(';')[0].trim();
  if (hasOwn(LIGHTING.NAMED_MAXSPEED_KMH, first)) return LIGHTING.NAMED_MAXSPEED_KMH[first];

  const match = MAXSPEED_PATTERN.exec(first);
  if (!match) return null;
  const speed = Number(match[1]);
  if (speed <= 0) return null;
  return match[2] === 'mph' ? speed * LIGHTING.MPH_TO_KMH : speed;
}

/**
 * Prior from road class, speed and sidewalk tags (no lamp evidence).
 * Path classes are checked before speed, so a footway with a speed tag stays a path.
 * @param {{highway, maxspeed, sidewalk}} tags - normalised tags
 * @returns {{pLit: number, n: number}}
 */
function tagPrior({ highway, maxspeed, sidewalk }) {
  if (PATH_HIGHWAYS.has(highway)) return LIGHTING.PRIOR.PATH;
  if (MAJOR_HIGHWAYS.has(highway)) return LIGHTING.PRIOR.MAJOR;

  const speedKmh = parseMaxspeedKmh(maxspeed);
  if (speedKmh !== null && speedKmh <= LIGHTING.URBAN_SPEED_MAX_KMH) return LIGHTING.PRIOR.URBAN_SPEED;

  if (RESIDENTIAL_HIGHWAYS.has(highway)) {
    return SIDEWALK_PRESENT.has(sidewalk)
      ? LIGHTING.PRIOR.RESIDENTIAL_SIDEWALK
      : LIGHTING.PRIOR.RESIDENTIAL;
  }
  if (highway === 'tertiary') return LIGHTING.PRIOR.TERTIARY;
  if (highway === 'service') return LIGHTING.PRIOR.SERVICE;
  return LIGHTING.PRIOR.UNKNOWN;
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
 * @param {number} input.lampCount30m - street lamps within LAMP_RADIUS_M of the segment, counted by the caller (integer >= 0)
 * @param {number} input.areaLampDensityPerKm - mapped lamps per km in the surrounding area
 * @param {number} input.areaWayKm - mapped road length in the surrounding area, km
 * @returns {{pLit: number, n: number, source: 'tag'|'lamp'|'absence'|'prior'}}
 * @throws {TypeError} when any input is malformed
 */
function inferLighting({ tags, lampCount30m, areaLampDensityPerKm, areaWayKm }) {
  assertTags(tags);
  assertNonNegativeInteger('lampCount30m', lampCount30m);
  assertNonNegative('areaLampDensityPerKm', areaLampDensityPerKm);
  assertNonNegative('areaWayKm', areaWayKm);

  const normalised = normaliseTags(tags);
  if (hasOwn(LIGHTING.EXPLICIT, normalised.lit)) {
    return { ...LIGHTING.EXPLICIT[normalised.lit], source: 'tag' };
  }

  const prior = tagPrior(normalised);

  if (lampCount30m >= 1) {
    const pLit = Math.max(
      prior.pLit,
      lampCount30m >= LIGHTING.LAMP.MANY_THRESHOLD ? LIGHTING.LAMP.PLIT_MANY : LIGHTING.LAMP.PLIT_ONE,
    );
    return { pLit, n: prior.n + LIGHTING.LAMP.EVIDENCE_N, source: 'lamp' };
  }

  const absenceIsInformative = areaLampDensityPerKm > LIGHTING.ABSENCE.MIN_LAMP_DENSITY_PER_KM
    && areaWayKm >= LIGHTING.ABSENCE.MIN_AREA_WAY_KM;
  if (absenceIsInformative) {
    return {
      pLit: prior.pLit * LIGHTING.ABSENCE.PLIT_FACTOR,
      n: prior.n + LIGHTING.ABSENCE.EVIDENCE_N,
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
  assertInRange('pLit', pLit, 0, 1);
  assertNonNegative('n', n);
  return (pLit * n + LIGHTING.NEUTRAL_LIT * EVIDENCE_PSEUDO_COUNT) / (n + EVIDENCE_PSEUDO_COUNT);
}

/**
 * How much evidence backs an estimate, in [0, 1). Same formula as edgeRisk's certainty.
 * @param {{n: number}} estimate
 * @returns {number} evidenceStrength(n)
 * @throws {TypeError} when n is negative or not finite
 */
function lightingCertainty({ n }) {
  return evidenceStrength(n);
}

module.exports = {
  inferLighting,
  effectiveLit,
  lightingCertainty,
  parseMaxspeedKmh,
};
