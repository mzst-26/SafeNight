/**
 * Tunable constants for the v2 safety scoring model (spec section 11).
 * Every tunable lives here so the rationale sits next to the number.
 */

// Floor on a factor's safety before taking its log/power: one factor at 0 bounds edge risk below 1.
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

// A route edge counts as "poor" when its risk reaches this level (used for worstStretch reporting).
const RISK_POOR_THRESHOLD = 0.6;

// dominantCause is only reported when edge risk reaches this level, so safe edges carry no cause.
const CAUSE_MIN_RISK = 0.1;

// Blend between mean edge risk and the cube-mean (M3) in route aggregation; higher favours worst stretches.
const G = 0.4;

// Prior evidence strength: an estimate with n = N0 counts as half-certain.
const N0 = 4;

module.exports = Object.freeze({
  EPS,
  BASE_WEIGHTS,
  RISK_POOR_THRESHOLD,
  CAUSE_MIN_RISK,
  G,
  N0,
});
