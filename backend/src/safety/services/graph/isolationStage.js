/**
 * Isolation factor: dead ends (at true node degree) and footpaths with nothing lit around them.
 */
const { GRAPH, PATH_CLASS_HIGHWAYS } = require('../../scoring/config');
const { clamp01 } = require('./common');

/** A segment is a dead end when either end has degree 1 (or is unknown), counting every highway way. */
function isDeadEnd(nodeDegree, from, to) {
  return (nodeDegree.get(from) || 0) <= 1 || (nodeDegree.get(to) || 0) <= 1;
}

/**
 * An unlit isolated path: a path-class way with no lamp within LAMP_NEAR_PATH_M, not tagged lit=yes, and not a
 * sidewalk. A sidewalk (footway-like way beside a road) is lit with, and walked beside, the road, so it is not
 * isolated.
 * @param {string} highway
 * @param {object} tags
 * @param {number} lampCountNearPath Lamps within LAMP_NEAR_PATH_M.
 * @param {boolean|undefined} nearRoad Whether a road is within reach (undefined when not footway-like).
 * @returns {boolean}
 */
function isUnlitPath(highway, tags, lampCountNearPath, nearRoad) {
  return PATH_CLASS_HIGHWAYS.has(highway) && lampCountNearPath === 0 && tags.lit !== 'yes' && nearRoad !== true;
}

/**
 * Isolation safety in [0, 1]: one minus the dead-end and unlit-path penalties.
 * @param {boolean} deadEnd
 * @param {boolean} unlitPath
 * @returns {number}
 */
function isolationSafetyOf(deadEnd, unlitPath) {
  return clamp01(1 - (deadEnd ? GRAPH.DEAD_END_PENALTY : 0) - (unlitPath ? GRAPH.UNLIT_PATH_PENALTY : 0));
}

module.exports = { isDeadEnd, isUnlitPath, isolationSafetyOf };
