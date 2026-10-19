/**
 * Tunable constants for the v2 safety scoring model (spec section 11).
 * Every scoring tunable lives here so the rationale sits next to the number.
 * The one exception is the per-category crime severity table, which is data and
 * lives in services/crimeSeverity.js.
 */

// Floor on a factor's safety before taking its log: one factor at 0 bounds edge risk below 1.
const EPS = 0.05;

// Base weights per factor, before the darkness gate and level renormalisation. Sum to 1.
const BASE_WEIGHTS = Object.freeze({
  // Darkness is the main night-time hazard; scaled by darkness so daylight routes ignore it.
  lighting: 0.3,
  // Recent crime is the other direct harm signal, but cells are coarse (500 m, 12 months), so it sits just below lighting.
  crime: 0.25,
  // Road class only; dead-end and footpath effects moved to isolation, so this drops from the old 0.22-0.25.
  road: 0.15,
  // Open places, CCTV and transit merged; matches the old CCTV+openPlaces weight (0.15-0.19) with transit folded in.
  activity: 0.18,
  // New factor (dead ends, footpath through nothing); weakest evidence, so the smallest weight.
  isolation: 0.12,
});

// Neutral prior safety for a factor with no data (null safety). It is used with n = 0, so it
// carries no evidence, but it still counts in the blend: missing data is never silently good.
// Each prior is at or below 0.6, so an unknown factor never reads as clearly safe (0.95 and up).
const PRIOR_SAFETY = Object.freeze({
  // No evidence either way; the tag-based lighting prior is also centred on 0.5.
  lighting: 0.5,
  // Most streets have modest recorded crime, so the prior leans slightly safe but stays cautious.
  crime: 0.6,
  // Road class alone does not establish safety, so the prior sits at the mid-point.
  road: 0.5,
  // Below the mid-point: at night, unmapped activity more often means a quiet street, so the cautious case is assumed.
  activity: 0.4,
  // Most streets are not dead ends or isolated footpaths, so the prior is mildly safe.
  isolation: 0.6,
});

// A route edge counts as "poor" when its risk reaches this level (used for worstStretch reporting).
const RISK_POOR_THRESHOLD = 0.6;

// dominantCause is only reported when edge risk reaches this level, so safe edges carry no cause.
const CAUSE_MIN_RISK = 0.1;

// Blend between mean edge risk and the cube-mean (M3) in route aggregation; higher favours worst stretches.
const G = 0.4;

// Evidence strength: an estimate with n = N0 counts as half-certain. Used by edge risk and lighting alike.
const N0 = 4;

// Crime risk (empirical-Bayes shrinkage towards an area prior). Units are in crimes, km and months.
const CRIME = Object.freeze({
  // Recency: a crime one half-life old counts half as much. Four months keeps the latest few months dominant within a 12-month window.
  HALF_LIFE_MONTHS: 4,
  // Prior weight k in km-equivalents: 2 km of local exposure carries as much weight as the area prior.
  PRIOR_STRENGTH: 2,
  // Weighted crimes per km that map to a risk of 1 - e^-1 (~0.63).
  RATE_SCALE: 6,
  // Severity for a category missing from the table. Middling, so unrecognised data is neither ignored nor alarming.
  SEVERITY_FALLBACK: 0.4,
});

// Darkness: a smoothstep over solar elevation in degrees, 0 in daylight and 1 at full night.
const DARKNESS = Object.freeze({
  // Elevation at which darkness starts (civil dusk): 6 deg above the horizon is daylit.
  START_DEG: 6,
  // Elevation at which darkness is complete (end of civil twilight): 6 deg below the horizon.
  FULL_DEG: -6,
});

// Lighting inference: P(lit) estimates from tags, lamps and mapping completeness.
const LIGHTING = Object.freeze({
  // Neutral P(lit) that effectiveLit shrinks towards: 0.5 is "no idea".
  NEUTRAL_LIT: 0.5,

  // Explicit OSM lit tags are surveyed, so they carry strong evidence (n = 20).
  // 'limited' and 'automatic' are conditional, so they stay at 0.5 with less weight (n = 10).
  EXPLICIT: Object.freeze({
    yes: Object.freeze({ pLit: 0.95, n: 20 }),
    '24/7': Object.freeze({ pLit: 0.95, n: 20 }),
    no: Object.freeze({ pLit: 0.05, n: 20 }),
    limited: Object.freeze({ pLit: 0.5, n: 10 }),
    automatic: Object.freeze({ pLit: 0.5, n: 10 }),
  }),

  // Street-lamp evidence within 30 m of the segment.
  LAMP: Object.freeze({
    // One lamp within 30 m is a strong sign the segment is lit; the one-lamp level, not the many-lamp level.
    PLIT_ONE: 0.85,
    // Three or more lamps indicate a well-lit stretch.
    PLIT_MANY: 0.92,
    MANY_THRESHOLD: 3,
    // Evidence added to n when lamps are found.
    EVIDENCE_N: 6,
  }),

  // Absence of lamps is informative only where lamps are mapped nearby (mapping completeness).
  ABSENCE: Object.freeze({
    // Below this density the area's lamp mapping is too sparse for a missing lamp to mean anything.
    MIN_LAMP_DENSITY_PER_KM: 2,
    // Need enough mapped road in the area to judge.
    MIN_AREA_WAY_KM: 0.3,
    // A densely lamped area with no lamp here lowers P(lit) to 60% of its prior.
    PLIT_FACTOR: 0.6,
    // Evidence added to n for an informative absence.
    EVIDENCE_N: 3,
  }),

  // Tag-based priors by road class and speed, used when there is no explicit lit tag.
  PRIOR: Object.freeze({
    // Footpaths and tracks are usually unlit.
    PATH: Object.freeze({ pLit: 0.15, n: 3 }),
    // Trunk, primary and secondary roads are almost always lit in built-up areas.
    MAJOR: Object.freeze({ pLit: 0.85, n: 4 }),
    // An urban speed limit (at most URBAN_SPEED_MAX_KMH) implies street lighting.
    URBAN_SPEED: Object.freeze({ pLit: 0.8, n: 4 }),
    // Residential roads with a sidewalk are very likely lit.
    RESIDENTIAL_SIDEWALK: Object.freeze({ pLit: 0.8, n: 4 }),
    // Residential roads without sidewalk information are likely lit but less certain.
    RESIDENTIAL: Object.freeze({ pLit: 0.7, n: 3 }),
    // Tertiary roads are usually through routes in built-up areas, so likely lit.
    TERTIARY: Object.freeze({ pLit: 0.7, n: 3 }),
    // Service roads are often private and sometimes unlit.
    SERVICE: Object.freeze({ pLit: 0.4, n: 2 }),
    // Unclassified roads and anything else with no class information.
    UNKNOWN: Object.freeze({ pLit: 0.4, n: 2 }),
  }),

  // An OSM maxspeed at or under this (km/h) counts as urban, which implies lit streets.
  URBAN_SPEED_MAX_KMH: 50,
  // Converts an mph maxspeed to km/h.
  MPH_TO_KMH: 1.609344,
  // Named maxspeed values with a fixed speed. GB:urban is the UK built-up limit: 30 mph, about 48 km/h.
  NAMED_MAXSPEED_KMH: Object.freeze({ 'gb:urban': 48 }),
});

module.exports = Object.freeze({
  EPS,
  BASE_WEIGHTS,
  PRIOR_SAFETY,
  RISK_POOR_THRESHOLD,
  CAUSE_MIN_RISK,
  G,
  N0,
  CRIME,
  DARKNESS,
  LIGHTING,
});
