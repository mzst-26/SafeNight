/**
 * lightingInference.js — Evidence-weighted estimate that a road segment is lit.
 *
 * Combines explicit OSM lighting tags, a tag-based prior and nearby street-lamp
 * evidence into { pLit, n }: the probability the segment is lit and the strength
 * of the evidence behind it. effectiveLit shrinks that estimate towards 0.5 when
 * the evidence is thin, so a guess never looks as certain as a surveyed tag.
 *
 * Every numeric tunable lives in config.js (LIGHTING). The sets below are
 * OSM class taxonomy, not tunables. Evidence strength comes from evidence.js, shared with edgeRisk.
 *
 * All functions are pure and never mutate their inputs.
 */

const { LIGHTING, WEAK_LIT } = require('./config');
const { assertNonNegative, assertNonNegativeInteger, assertInRange } = require('./validation');
const { evidenceStrength } = require('./evidence');

const MAXSPEED_PATTERN = /^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?$/;

const SIDEWALK_PRESENT = new Set(['yes', 'both', 'left', 'right', 'separate']);
// Isolated by nature: low prior whatever is around them.
const PATH_HIGHWAYS = new Set(['path', 'track', 'bridleway']);
// Often a sidewalk beside a road, so the prior depends on whether a road is nearby (nearRoad).
const SIDEWALK_LIKE_HIGHWAYS = new Set(['footway', 'cycleway', 'steps', 'pedestrian']);
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
 * True when the way is an isolated path: a path class, or a footway-like way known to have no road nearby.
 * Only these are subject to the absence-of-lamps rule.
 * @param {string|undefined} highway - normalised
 * @param {boolean|undefined} nearRoad
 * @returns {boolean}
 */
function isIsolatedPath(highway, nearRoad, crossing = false) {
  return PATH_HIGHWAYS.has(highway) || (SIDEWALK_LIKE_HIGHWAYS.has(highway) && (nearRoad === false || crossing));
}

/**
 * Prior from road class, speed and sidewalk tags (no lamp evidence).
 * Path and footway-like classes are checked before speed, so a footway with a speed tag keeps its footway prior.
 * @param {{highway, maxspeed, sidewalk}} tags - normalised tags
 * @param {boolean|undefined} nearRoad - runs along a street (way level; undefined: unknown)
 * @param {boolean} [crossing] - crosses a motorway/trunk: a crossing structure, isolated and uncertain
 * @returns {{pLit: number, n: number}}
 */
function tagPrior({ highway, maxspeed, sidewalk }, nearRoad, crossing = false) {
  if (PATH_HIGHWAYS.has(highway)) return LIGHTING.PRIOR.PATH;
  if (SIDEWALK_LIKE_HIGHWAYS.has(highway)) {
    if (crossing) return LIGHTING.PRIOR.CROSSING_STRUCTURE;
    if (nearRoad === true) return LIGHTING.PRIOR.SIDEWALK_NEAR_ROAD;
    return nearRoad === false ? LIGHTING.PRIOR.SIDEWALK_ISOLATED : LIGHTING.PRIOR.SIDEWALK_UNKNOWN;
  }
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
 * @param {*} value
 * @param {string} name
 * @throws {TypeError}
 */
function assertOptionalBoolean(value, name) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean when present`);
  }
}

/**
 * Estimate P(lit) and its evidence strength for one road segment.
 *
 * An explicit lit tag is ground truth and wins outright. Otherwise the tag prior
 * is raised by nearby lamps, or (weaker) by a neighbouring lit=yes way. Where lamps are mapped
 * densely around an isolated path but none is nearby, the prior is lowered; roads are never lowered
 * by missing lamps because lamps are sparsely mapped.
 *
 * @param {Object} input
 * @param {Object} input.tags - OSM tags of the way
 * @param {number} input.lampCount30m - street lamps within LAMP_RADIUS_M of the segment, counted by the caller (integer >= 0)
 * @param {number} input.areaLampDensityPerKm - mapped lamps per km in the surrounding area
 * @param {number} input.areaWayKm - mapped road length in the surrounding area, km
 * @param {boolean} [input.nearRoad] - a road (trunk to service) lies within SIDEWALK_RADIUS_M of the way;
 *   used only for footway-like classes. Omit when unknown.
 * @param {boolean} [input.crossing=false] - a footway-like way that crosses a motorway/trunk (footbridge, underpass,
 *   ramp): takes the crossing-structure prior and counts as an isolated path. Explicit tags and lamps still win.
 * @param {boolean} [input.weakLitTag=false] - the caller judges a lit=yes tag weak evidence (crossing structure or
 *   isolated path, no lamp within LAMP_NEAR_PATH_M, lamps mapped in the area): pLit 0.7, n 6, source 'weak-tag'.
 * @param {boolean} [input.litNeighbour=false] - a vertex of a lit=yes way lies within LAMP_RADIUS_M. Not a lamp.
 * @returns {{pLit: number, n: number, source: 'tag'|'weak-tag'|'lamp'|'neighbour-lit'|'absence'|'prior'}}
 * @throws {TypeError} when any input is malformed
 */
function inferLighting({
  tags, lampCount30m, areaLampDensityPerKm, areaWayKm, nearRoad, litNeighbour = false, crossing = false,
  weakLitTag = false,
}) {
  assertTags(tags);
  assertNonNegativeInteger('lampCount30m', lampCount30m);
  assertNonNegative('areaLampDensityPerKm', areaLampDensityPerKm);
  assertNonNegative('areaWayKm', areaWayKm);
  assertOptionalBoolean(nearRoad, 'nearRoad');
  assertOptionalBoolean(litNeighbour, 'litNeighbour');
  assertOptionalBoolean(crossing, 'crossing');
  assertOptionalBoolean(weakLitTag, 'weakLitTag');

  const normalised = normaliseTags(tags);
  if (weakLitTag && normalised.lit === 'yes' && lampCount30m === 0) {
    // A lit=yes tag on a crossing structure or isolated path with no lamp near it, in an area where lamps are mapped:
    // plausible but unconfirmed (config WEAK_LIT).
    return { ...WEAK_LIT, source: 'weak-tag' };
  }
  if (hasOwn(LIGHTING.EXPLICIT, normalised.lit)) {
    return { ...LIGHTING.EXPLICIT[normalised.lit], source: 'tag' };
  }

  const prior = tagPrior(normalised, nearRoad, crossing);

  if (lampCount30m >= 1) {
    const pLit = Math.max(
      prior.pLit,
      lampCount30m >= LIGHTING.LAMP.MANY_THRESHOLD ? LIGHTING.LAMP.PLIT_MANY : LIGHTING.LAMP.PLIT_ONE,
    );
    return { pLit, n: prior.n + LIGHTING.LAMP.EVIDENCE_N, source: 'lamp' };
  }

  if (litNeighbour) {
    return {
      pLit: Math.max(prior.pLit, LIGHTING.NEIGHBOUR_LIT.PLIT),
      n: prior.n + LIGHTING.NEIGHBOUR_LIT.EVIDENCE_N,
      source: 'neighbour-lit',
    };
  }

  const absenceIsInformative = isIsolatedPath(normalised.highway, nearRoad, crossing)
    && areaLampDensityPerKm > LIGHTING.ABSENCE.MIN_LAMP_DENSITY_PER_KM
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
 * Should a lit=yes tag be treated as weak evidence? Yes when the way is a crossing structure or an isolated path, no
 * mapped lamp lies within LAMP_NEAR_PATH_M, and the surrounding area has mapped lamps (the same density test as the
 * absence rule: only where lamps are mapped does a missing lamp mean anything). Used by the graph builder and the eval
 * replica so the two cannot drift apart.
 * @param {{tags: object, crossing?: boolean, nearRoad?: boolean, lampCountNearPath: number,
 *   areaLampDensityPerKm: number, areaWayKm: number}} input
 * @returns {boolean}
 */
function isWeakLitTag({
  tags, crossing = false, nearRoad, lampCountNearPath, areaLampDensityPerKm, areaWayKm,
}) {
  const { highway, lit } = normaliseTags(tags);
  if (lit !== 'yes' || lampCountNearPath !== 0) return false;
  const isolated = crossing || nearRoad === false || PATH_HIGHWAYS.has(highway);
  return isolated
    && areaLampDensityPerKm > LIGHTING.ABSENCE.MIN_LAMP_DENSITY_PER_KM
    && areaWayKm >= LIGHTING.ABSENCE.MIN_AREA_WAY_KM;
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
  return (pLit * n + LIGHTING.NEUTRAL_LIT * LIGHTING.SHRINK_PSEUDO_COUNT) / (n + LIGHTING.SHRINK_PSEUDO_COUNT);
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
  isWeakLitTag,
  effectiveLit,
  lightingCertainty,
  parseMaxspeedKmh,
  SIDEWALK_LIKE_HIGHWAYS,
};
