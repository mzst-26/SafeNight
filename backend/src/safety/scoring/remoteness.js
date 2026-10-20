/**
 * remoteness.js — How remote a point is, and the night hazard that follows.
 *
 *   R0 = 0.40*ramp(distance to nearest non-path road; 25..150 m)
 *      + 0.30*(1 - ramp(non-path road segments within 100 m; 0..10))
 *      + 0.10*(1 - ramp(open places within 100 m; 0..10))        (maximum 0.8)
 *   R' = 0.8 * ramp(R; FREE..0.8)  (suburban streets carry a small R0 that is not remoteness)
 *   H  = R' * (1 - P) * darkness;  H_eff = H * (1 - 0.35 * lightingEffective)
 *   edge safety is multiplied by (1 - 0.6 * H_eff)
 *
 * Pure functions; constants in config.js (REMOTENESS). Spec section 12.
 */
const { REMOTENESS } = require('./config');

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** Linear ramp: 0 at or below `from`, 1 at or above `to`. */
function ramp(value, from, to) {
  return clamp01((value - from) / (to - from));
}

/**
 * Base remoteness R0 in [0, 0.8].
 * @param {{nearestRoadM: number, waysNear: number, placesNear: number}} input nearestRoadM may be Infinity.
 * @returns {number}
 */
function remotenessOf({ nearestRoadM, waysNear, placesNear }) {
  const c = REMOTENESS;
  const distance = Number.isFinite(nearestRoadM) ? nearestRoadM : Infinity;
  return c.ROAD_WEIGHT * ramp(distance, c.ROAD_NEAR_M, c.ROAD_FAR_M)
    + c.WAYS_WEIGHT * (1 - ramp(waysNear, 0, c.WAYS_FULL))
    + c.PLACES_WEIGHT * (1 - ramp(placesNear, 0, c.PLACES_FULL));
}

/**
 * Effective night hazard H_eff in [0, 0.8]: remoteness not covered by other people, only in the dark, eased by light.
 * @param {{remoteness: number, presence: number, darkness: number, lightingEffective: number}} input
 * @returns {number}
 */
function hazardOf({ remoteness, presence, darkness, lightingEffective }) {
  const effectiveRemoteness = REMOTENESS.MAX * ramp(remoteness, REMOTENESS.FREE, REMOTENESS.MAX);
  const hazard = effectiveRemoteness * (1 - clamp01(presence)) * clamp01(darkness);
  return hazard * (1 - REMOTENESS.LIT_RELIEF * clamp01(lightingEffective));
}

/** Multiplier on edge safety for an effective hazard. */
function safetyMultiplier(hazardEffective) {
  return 1 - REMOTENESS.HAZARD_STRENGTH * hazardEffective;
}

module.exports = { ramp, remotenessOf, hazardOf, safetyMultiplier };
