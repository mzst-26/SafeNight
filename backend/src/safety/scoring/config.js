/**
 * Tunable constants for the v2 safety scoring model (spec section 11).
 * Every scoring tunable lives here so the rationale sits next to the number.
 * The one exception is the per-category crime severity table, which is data and
 * lives in services/crimeSeverity.js.
 */

// Floor on a factor's safety before taking its log: one factor at 0 bounds edge risk below 1.
const MIN_FACTOR_SAFETY = 0.05;

// Base weights per factor, before the darkness gate and level renormalisation. Sum to 1.
const BASE_WEIGHTS = Object.freeze({
  // Darkness is the main night-time hazard; scaled by darkness so daylight routes ignore it. Was 0.30: with the
  // lighting estimate no longer shrunk by 4 (LIGHTING.SHRINK_PSEUDO_COUNT) it spans a wider range, so the weight
  // can fall a little and the calibration archetypes still land in range (scripts/eval/calibration-table.js).
  lighting: 0.28,
  // Recent crime is the other direct harm signal, but cells are coarse (500 m, 12 months), so it sits just below lighting.
  crime: 0.25,
  // Road class only; dead-end and footpath effects moved to isolation, so this drops from the old 0.22-0.25.
  road: 0.15,
  // Open places, CCTV and transit merged; matches the old CCTV+openPlaces weight (0.15-0.19) with transit folded in.
  // Was 0.18: raised to 0.20 so a quiet street (nothing open nearby at night) sits clearly below a busy one, which
  // keeps unmapped residential (C) and the crime hotspot (G) under their calibration ceilings.
  activity: 0.2,
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
const CUBE_MEAN_BLEND = 0.4;

// Evidence strength: an estimate with n = EVIDENCE_PSEUDO_COUNT counts as half-certain.
// Used by edge risk and lighting alike, through evidence.js.
const EVIDENCE_PSEUDO_COUNT = 4;

// Crime risk (empirical-Bayes shrinkage towards an area prior). Units are in crimes, km and months.
const CRIME = Object.freeze({
  // Recency: a crime one half-life old counts half as much. Four months keeps the latest few months dominant within a 12-month window.
  HALF_LIFE_MONTHS: 4,
  // Prior weight k in km-equivalents: 2 km of local exposure carries as much weight as the area prior.
  PRIOR_STRENGTH: 2,
  // Weighted crimes per km that map to a risk of 1 - e^-1 (~0.63). Was 6: 20 violent crimes in a 500 m cell with
  // about 2.5 km of mapped road is 4.4 per km, which reads 53% risk at 6 and 67% at 4 (hotspot target). Confirm on real data via the eval backtest.
  RATE_SCALE: 4,
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

  // Pseudo-count of neutral evidence in effectiveLit: (pLit*n + 0.5*c) / (n + c). Lighting only; the
  // certainty weight (EVIDENCE_PSEUDO_COUNT, 4) is separate. The priors below are already shrunk towards 0.5
  // and use a small n, so shrinking again by 4 double-counts the caution: in the Plymouth backtest it made
  // the estimate worse than the road-class rate (Brier .139 vs .121, AUC .79 vs .82) while the raw pLit was on
  // par. At 1 the estimate beats it (see scripts/eval/README.md). Explicit tags still dominate (n = 20).
  SHRINK_PSEUDO_COUNT: 1,

  // Explicit OSM lit tags are surveyed, so they carry strong evidence (n = 20).
  // 'limited' and 'automatic' are conditional, so they stay at 0.5 with less weight (n = 10).
  EXPLICIT: Object.freeze({
    yes: Object.freeze({ pLit: 0.95, n: 20 }),
    '24/7': Object.freeze({ pLit: 0.95, n: 20 }),
    no: Object.freeze({ pLit: 0.05, n: 20 }),
    limited: Object.freeze({ pLit: 0.5, n: 10 }),
    automatic: Object.freeze({ pLit: 0.5, n: 10 }),
  }),

  // Street-lamp evidence within LAMP_RADIUS_M of the segment.
  LAMP: Object.freeze({
    // One lamp within LAMP_RADIUS_M is a strong sign the segment is lit; the one-lamp level, not the many-lamp level.
    PLIT_ONE: 0.85,
    // Three or more lamps indicate a well-lit stretch.
    PLIT_MANY: 0.92,
    MANY_THRESHOLD: 3,
    // Evidence added to n when lamps are found.
    EVIDENCE_N: 6,
  }),

  // A lit=yes way vertex within LAMP_RADIUS_M of the segment (a neighbouring way is tagged lit). This is
  // evidence from a mapper's tag, not a lamp: it says the street next door is lit, so it is weaker than a lamp.
  NEIGHBOUR_LIT: Object.freeze({
    // Same floor as one lamp: a tagged-lit neighbour makes lit likely, but it never reaches the many-lamp level.
    PLIT: 0.85,
    // Half the lamp evidence (LAMP.EVIDENCE_N = 6): the tag may describe the neighbour, not this segment.
    EVIDENCE_N: 3,
  }),

  // Absence of lamps is informative only for isolated paths (not roads), and only where lamps are mapped nearby.
  // On roads it points the wrong way: Plymouth backtest, ways with no mapped lamp within 30 m are still ~82% lit,
  // because lamps are sparsely mapped. On a path with no road beside it, a lamp-free surrounding is real information.
  ABSENCE: Object.freeze({
    // Below this density the area's lamp mapping is too sparse for a missing lamp to mean anything.
    MIN_LAMP_DENSITY_PER_KM: 2,
    // Need enough mapped road in the area to judge.
    MIN_AREA_WAY_KM: 0.3,
    // A densely lamped area with no lamp here lowers an isolated path's P(lit) to 60% of its prior.
    PLIT_FACTOR: 0.6,
    // Evidence added to n for an informative absence.
    EVIDENCE_N: 3,
  }),

  // A footway, cycleway, steps or pedestrian way within SIDEWALK_RADIUS_M of a road is treated as that road's
  // sidewalk: Plymouth backtest, such ways are mostly lit because the road beside them is. Roads here are
  // trunk to service; footway-like and path classes never count as the road.
  SIDEWALK_RADIUS_M: 25,

  // Tag-based priors by road class and speed, used when there is no explicit lit tag. Road-class priors are the
  // Plymouth backtest lit rates shrunk towards 0.5 (about observed * 0.9 + 0.05) with small n, because the
  // labelled sample is the 42% of ways a mapper chose to tag and untagged streets are probably less lit.
  PRIOR: Object.freeze({
    // path, track and bridleway: mostly unlit (observed path .19, track .02).
    PATH: Object.freeze({ pLit: 0.12, n: 3 }),
    // Footway-like way within SIDEWALK_RADIUS_M of a road. Observed lit rate near a road: footway .65, steps .61,
    // cycleway .87, pedestrian .95 (pooled about .68), well above the same classes far from a road. The pooled
    // rate is shrunk only slightly: a prior of .88 (the road rate) was too high for footways and steps.
    SIDEWALK_NEAR_ROAD: Object.freeze({ pLit: 0.72, n: 3 }),
    // Footway-like way with no road nearby: a park or woodland path. Observed: footway .36, steps .43, cycleway .64
    // (pooled about .41, tagged ways only). Held below that because untagged park paths are likely darker.
    SIDEWALK_ISOLATED: Object.freeze({ pLit: 0.33, n: 3 }),
    // Footway-like way when the caller has no geometry: the observed pooled rate (footway .54, steps .55), weak.
    SIDEWALK_UNKNOWN: Object.freeze({ pLit: 0.5, n: 2 }),
    // Trunk, primary and secondary roads (observed .89 to .98); one shared value, so trunk (.89) sets it.
    MAJOR: Object.freeze({ pLit: 0.9, n: 4 }),
    // An urban speed limit (at most URBAN_SPEED_MAX_KMH) implies street lighting (30 mph ways are ~95% lit).
    URBAN_SPEED: Object.freeze({ pLit: 0.9, n: 4 }),
    // Residential roads with a sidewalk (observed residential .97).
    RESIDENTIAL_SIDEWALK: Object.freeze({ pLit: 0.9, n: 4 }),
    // Residential roads without sidewalk information: same class rate, a little less certain.
    RESIDENTIAL: Object.freeze({ pLit: 0.88, n: 3 }),
    // Tertiary roads (observed .98).
    TERTIARY: Object.freeze({ pLit: 0.9, n: 3 }),
    // Service roads are often private and sometimes unlit (observed .68).
    SERVICE: Object.freeze({ pLit: 0.62, n: 3 }),
    // Unclassified roads (observed .77) and anything else with no class information.
    UNKNOWN: Object.freeze({ pLit: 0.72, n: 3 }),
  }),

  // An OSM maxspeed at or under this (km/h) counts as urban, which implies lit streets.
  URBAN_SPEED_MAX_KMH: 50,
  // Converts an mph maxspeed to km/h.
  MPH_TO_KMH: 1.609344,
  // Named maxspeed values with a fixed speed. GB:urban is the UK built-up limit: 30 mph, about 48 km/h.
  NAMED_MAXSPEED_KMH: Object.freeze({ 'gb:urban': 48 }),
});

// Floor for the activity factor: a street with no open places, cameras or transit nearby is
// quiet, not hostile, so activity safety never drops below this. Equal to PRIOR_SAFETY.activity so
// that having activity data that shows nothing nearby is never worse than having no data at all.
const ACTIVITY_FLOOR = 0.4;

// Roads at or above this speed (km/h, 50 mph) with no sidewalk are treated as walking hazards.
// Set well above urban limits because 95% of ways carry no sidewalk tag at all.
const HAZARD_SPEED_KMH = 80;

// Longest route, as a multiple of the shortest, that may still be recommended.
const MAX_LENGTH_RATIO = 1.5;

// Radius (m) within which a mapped street lamp counts as lighting an edge. This is the radius
// the caller (safetyGraph) uses when it counts lamps for lightingInference's lampCount30m input,
// so the count and the constant must agree. lightingInference itself only sees the count.
const LAMP_RADIUS_M = 30;

module.exports = Object.freeze({
  ACTIVITY_FLOOR,
  HAZARD_SPEED_KMH,
  MAX_LENGTH_RATIO,
  LAMP_RADIUS_M,
  MIN_FACTOR_SAFETY,
  BASE_WEIGHTS,
  PRIOR_SAFETY,
  RISK_POOR_THRESHOLD,
  CAUSE_MIN_RISK,
  CUBE_MEAN_BLEND,
  EVIDENCE_PSEUDO_COUNT,
  CRIME,
  DARKNESS,
  LIGHTING,
});
