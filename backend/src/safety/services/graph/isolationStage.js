/**
 * Isolation factor: dead ends (at true node degree) and footpaths with nothing lit around them.
 */
const { GRAPH, PATH_CLASS_HIGHWAYS, REMOTENESS } = require('../../scoring/config');
const { buildRoadProximityIndex, nearestRoadDistance } = require('../../scoring/roadProximity');
const { remotenessOf, hazardOf, safetyMultiplier } = require('../../scoring/remoteness');
const { buildSpatialGrid, fastDistance } = require('../geo');
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

/** Items of the grid within radiusM of the point, counting stops at `cap` (the ramps saturate there). */
function countUpTo(spatialGrid, lat, lng, radiusM, cap) {
  const { grid, cellSize } = spatialGrid;
  const reach = Math.ceil((radiusM / GRAPH.METRES_PER_DEG_LAT) / cellSize) + 1;
  const r0 = Math.floor(lat / cellSize);
  const c0 = Math.floor(lng / cellSize);
  let count = 0;
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const cell = grid.get(`${r0 + dr},${c0 + dc}`);
      if (!cell) continue;
      for (const item of cell) {
        if (fastDistance(lat, lng, item.lat, item.lng) <= radiusM && ++count >= cap) return count;
      }
    }
  }
  return count;
}

/**
 * Remoteness lookup per point: distance to the nearest non-path road, non-path road segments within
 * REMOTENESS.WAYS_RADIUS_M (by midpoint) and open places within REMOTENESS.PLACES_RADIUS_M. The indexes are built
 * lazily on first use; each lookup is a few grid cells, so O(1) per edge.
 * @param {Array<{highway: string, nA: object, nB: object, midLat: number, midLng: number}>} segments Walkable segments.
 * @param {Array<{lat: number, lng: number}>} openPlaces Open places (activity sources).
 * @returns {(lat: number, lng: number, onRoad?: boolean) => {remoteness: number, nearestRoadM: number, waysNear: number, placesNear: number}}
 */
function createRemotenessLookup(segments, openPlaces) {
  let roadIndex = null;
  let midpointGrid = null;
  let placeGrid = null;
  const build = () => {
    const roads = segments.filter((p) => !PATH_CLASS_HIGHWAYS.has(p.highway));
    roadIndex = buildRoadProximityIndex(
      roads.map((p) => ({ aLat: p.nA.lat, aLng: p.nA.lng, bLat: p.nB.lat, bLng: p.nB.lng })),
      REMOTENESS.GRID_CELL_DEG,
    );
    midpointGrid = buildSpatialGrid(roads.map((p) => ({ lat: p.midLat, lng: p.midLng })), 'lat', 'lng', REMOTENESS.GRID_CELL_DEG);
    placeGrid = buildSpatialGrid(openPlaces, 'lat', 'lng', REMOTENESS.GRID_CELL_DEG);
  };
  return (lat, lng, onRoad = false) => {
    if (!roadIndex) build();
    // A non-path edge is itself the nearest road: skip the sample search (the expensive query).
    const nearestRoadM = onRoad ? 0 : nearestRoadDistance(roadIndex, lat, lng, REMOTENESS.ROAD_FAR_M);
    const waysNear = countUpTo(midpointGrid, lat, lng, REMOTENESS.WAYS_RADIUS_M, REMOTENESS.WAYS_FULL);
    const placesNear = countUpTo(placeGrid, lat, lng, REMOTENESS.PLACES_RADIUS_M, REMOTENESS.PLACES_FULL);
    return { remoteness: remotenessOf({ nearestRoadM, waysNear, placesNear }), nearestRoadM, waysNear, placesNear };
  };
}

/**
 * Multiplier on an edge's safety for its night remoteness hazard (1 means no effect). Applied to the combined edge
 * safety, not inside the isolation factor: that factor's 0.12 weight would cap the effect at a few points, but a lit
 * park path far from any street at 23:00 should read Moderate (spec section 12).
 * @param {{remoteness: number, presence: number, darkness: number, lightingEffective: number}} input
 * @returns {number} In [1 - HAZARD_STRENGTH * 0.8, 1] (0.68 at the default 0.4).
 */
function remotenessMultiplier(input) {
  return safetyMultiplier(hazardOf(input));
}

module.exports = {
  isDeadEnd, isUnlitPath, isolationSafetyOf, createRemotenessLookup, remotenessMultiplier,
};
