/**
 * spatial.js — Spatial blocks for leave-block-out cross-validation, plus a seeded RNG.
 *
 * Neighbouring streets share lamps, traffic and mapping habits, so random k-fold on ways
 * leaks. Holding out whole 1 km blocks removes most of that shared context.
 */

const METRES_PER_DEG_LAT = 111320;
const DEFAULT_BLOCK_M = 1000;

/**
 * Key of the 1 km block containing a point. Blocks are a grid in metres anchored at origin.
 * @param {number} lat
 * @param {number} lng
 * @param {{south: number, west: number, north?: number}} origin - south-west corner of the study area;
 *   north, when given, sets the mid-latitude used for the longitude scale
 * @param {number} [blockM=1000]
 * @returns {string} "row,col"
 */
function blockKeyOf(lat, lng, origin, blockM = DEFAULT_BLOCK_M) {
  const midLat = origin.north === undefined ? origin.south : (origin.south + origin.north) / 2;
  const metresPerDegLng = METRES_PER_DEG_LAT * Math.cos(midLat * Math.PI / 180);
  const row = Math.floor(((lat - origin.south) * METRES_PER_DEG_LAT) / blockM);
  const col = Math.floor(((lng - origin.west) * metresPerDegLng) / blockM);
  return `${row},${col}`;
}

/**
 * Seeded 32-bit PRNG (mulberry32). Returns a function giving floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle, in place, driven by rng(). Returns the same array. */
function shuffleInPlace(array, rng) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Assign each block key to one of k folds. Blocks are sorted, shuffled with the seed, then dealt
 * round-robin, so fold sizes differ by at most one block and the result does not depend on input order.
 * @param {string[]} blockKeys - unique block keys
 * @param {number} k - number of folds
 * @param {number} seed
 * @returns {Map<string, number>} block key -> fold index in [0, k)
 */
function assignFolds(blockKeys, k, seed) {
  const unique = [...new Set(blockKeys)].sort();
  if (unique.length < k) {
    throw new RangeError(`need at least ${k} blocks for ${k} folds, got ${unique.length}`);
  }
  shuffleInPlace(unique, mulberry32(seed));
  const folds = new Map();
  unique.forEach((key, i) => folds.set(key, i % k));
  return folds;
}

module.exports = {
  blockKeyOf,
  assignFolds,
  mulberry32,
  shuffleInPlace,
  DEFAULT_BLOCK_M,
};
