/**
 * safetyGraph.js - the safety-first walking graph and pathfinding (public facade).
 *
 * Each edge is scored from five factors (lighting, crime, road, activity, isolation) and combined into one
 * risk; routes are ranked by exposure (routeRisk x length^0.5). Spec: docs/superpowers/specs/
 * 2026-10-19-safety-scoring-v2-design.md section 11. Tuning constants live in ../scoring/config.js.
 *
 * The implementation is split by responsibility under ./graph/:
 *   osmIndex.js        nodes, nearest-node grid, node degree, walkable segments
 *   lightingStage.js   lamps, area lamp density, road proximity, lights cache, lit estimate
 *   crimeStage.js      crime rows to cells, area prior, per-edge crime risk
 *   activityStage.js   open places, CCTV, transit
 *   openingHours.js    open or closed at a London hour
 *   isolationStage.js  dead ends and unlit footpaths
 *   clock.js           London hour, darkness, weights, normalised crime status
 *   edgeBuilder.js     buildGraph: the named stages in order, edge scoring
 *   routing.js         A* safest path, hazard filter, nearest node, polyline
 *   candidates.js      K diverse routes (iterative penalty + A*)
 *   ranking.js         exposure ranking of candidates
 *   breakdown.js       per-route safety breakdown
 *   distanceGraph.js   distance-only graph and A* (phase 1 corridor)
 *   searchBudget.js    shared A* expansion budget
 *   common.js, minHeap.js   cancellation, debug log, heap
 */

const { buildGraph } = require('./graph/edgeBuilder');
const { crimesToWeightedCounts } = require('./graph/crimeStage');
const { WALKABLE_HIGHWAYS } = require('./graph/osmIndex');
const {
  findNearestNode, aStarSafety, isHazardEdge, routeToPolyline,
} = require('./graph/routing');
const { findKSafestRoutes } = require('./graph/candidates');
const { routeSafetyBreakdown } = require('./graph/breakdown');
const { buildDistanceOnlyGraph, aStarDistance } = require('./graph/distanceGraph');
const { MAX_ASTAR_EXPANSIONS } = require('./graph/searchBudget');
const { ROAD_TYPE_SCORES } = require('../scoring/config');

module.exports = {
  buildGraph,
  buildDistanceOnlyGraph,
  aStarDistance,
  findNearestNode,
  aStarSafety,
  findKSafestRoutes,
  MAX_ASTAR_EXPANSIONS,
  routeToPolyline,
  routeSafetyBreakdown,
  crimesToWeightedCounts,
  ROAD_TYPE_SCORES,
  WALKABLE_HIGHWAYS,
  isHazardEdge,
};
