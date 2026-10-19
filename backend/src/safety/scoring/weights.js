const { BASE_WEIGHTS } = require('./config');
const { assertInRange } = require('./validation');
const { SAFETY_LEVEL_STANDARD } = require('../services/safetyLevels');

/**
 * Rescales weights so they sum to 1.
 * @param {Object<string, number>} raw non-negative weights with a positive total
 * @returns {Object<string, number>}
 */
function normalise(raw) {
  const total = Object.values(raw).reduce((sum, w) => sum + w, 0);
  return Object.fromEntries(Object.entries(raw).map(([name, w]) => [name, w / total]));
}

/**
 * Factor weights for one edge, summing to 1.
 * Lighting is scaled by darkness (0 in daylight); standard data level drops activity.
 * @param {{darkness: number, safetyLevel: string}} options
 * @returns {{lighting: number, crime: number, road: number, activity: number, isolation: number}}
 */
function getWeights({ darkness, safetyLevel }) {
  assertInRange('darkness', darkness, 0, 1);
  const raw = { ...BASE_WEIGHTS, lighting: BASE_WEIGHTS.lighting * darkness };
  if (safetyLevel === SAFETY_LEVEL_STANDARD) raw.activity = 0;
  return normalise(raw);
}

module.exports = { getWeights };
