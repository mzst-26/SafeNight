/**
 * Safest-path search over the scored graph: A* with a straight-line heuristic, the hazard filter, the
 * nearest-node snap and path-to-polyline conversion.
 */
const { fastDistance, findNearby } = require('../geo');
const { parseMaxspeedKmh } = require('../../scoring/lightingInference');
const { HAZARD_SPEED_KMH, SEARCH } = require('../../scoring/config');
const { debugLog, throwIfCancelled } = require('./common');
const { MinHeap } = require('./minHeap');
const { createSearchBudget, createRouteBudgetError } = require('./searchBudget');

/**
 * Nearest graph node to a coordinate: the closest node within maxDist metres that has at least one edge.
 * @param {object} nodeGrid Spatial grid from buildGraph.
 * @param {Map<number, Array>} adjacency
 * @param {number} lat
 * @param {number} lng
 * @param {number} [maxDist] Snap radius in metres.
 * @returns {number|null} Node id, or null when none is near.
 */
function findNearestNode(nodeGrid, adjacency, lat, lng, maxDist = SEARCH.NEAREST_NODE_MAX_M) {
  const nearby = findNearby(nodeGrid, lat, lng, maxDist);
  for (const item of nearby) {
    if (adjacency.has(item.id)) return item.id;
  }
  return null;
}

/**
 * Hard constraints: obvious hazards avoided by default. A road at or above HAZARD_SPEED_KMH with no sidewalk
 * (maxspeed is parsed with its unit, so '40 mph' is about 64 km/h), or an unlit tunnel.
 * @param {object} edge
 * @param {boolean} [allowHazards] When true nothing is a hazard.
 * @returns {boolean}
 */
function isHazardEdge(edge, allowHazards = false) {
  if (allowHazards) return false;
  const raw = typeof edge.maxspeed === 'string' ? edge.maxspeed.trim().toLowerCase() : undefined;
  const speedKmh = parseMaxspeedKmh(raw);
  const isHighSpeedNoSidewalk = speedKmh !== null && speedKmh >= HAZARD_SPEED_KMH && !edge.hasSidewalk;
  const isUnlitTunnel = edge.isTunnel && !edge.isLit;
  return isHighSpeedNoSidewalk || isUnlitTunnel;
}

/**
 * Walks the predecessor map back from the end node.
 * @returns {{path: Array, usedEdges: Array<number>}|null} Null when the chain is broken.
 */
function reconstructPath(prev, startId, endId) {
  const path = [];
  const usedEdges = [];
  let node = endId;
  while (node !== startId) {
    path.push(node);
    const p = prev.get(node);
    if (!p) return null;
    usedEdges.push(p.edgeIdx);
    node = p.prevNode;
  }
  path.push(startId);
  path.reverse();
  usedEdges.reverse();
  return { path, usedEdges };
}

/** Route summary: path, edge indexes, total metres and the length-weighted mean safety. */
function summariseRoute(edges, path, usedEdges) {
  let totalDist = 0;
  let totalWeightedSafety = 0;
  for (const eIdx of usedEdges) {
    const e = edges[eIdx];
    totalDist += e.distance;
    totalWeightedSafety += e.safetyScore * e.distance;
  }
  return {
    path,
    edges: usedEdges,
    totalDist,
    avgSafety: totalDist > 0 ? totalWeightedSafety / totalDist : 0,
  };
}

/** Counts a heap pop against the budget: checks cancellation periodically. */
function countPop(budget) {
  budget.pops += 1;
  if ((budget.pops & SEARCH.CANCEL_CHECK_MASK) === 0) throwIfCancelled(budget.shouldCancel);
}

/** Counts an expansion against the budget; throws once the budget is exceeded. */
function countExpansion(budget) {
  budget.expansions += 1;
  if (budget.expansions > budget.maxExpansions) throw createRouteBudgetError();
}

/**
 * Relaxes the edges out of `current`: updates scores and pushes improved neighbours onto the heap.
 * An edge costs distance / safety, so safer edges are cheaper per metre. Uncertainty is already inside edge
 * risk (through the priors), so there is no separate confidence penalty.
 */
function relaxNeighbors(current, search, graph, endNode, maxDistM, allowHazards) {
  const { gScore, realDist, prev, closed, heap } = search;
  const neighbors = graph.adjacency.get(current);
  if (!neighbors) return;
  const currentG = gScore.get(current) ?? Infinity;

  for (const { edgeIdx, neighborId } of neighbors) {
    if (closed.has(neighborId)) continue;
    const edge = graph.edges[edgeIdx];
    if (isHazardEdge(edge, allowHazards)) continue;

    const effectiveSafety = Math.max(SEARCH.MIN_EFFECTIVE_SAFETY, edge.safetyScore - edge.penalty);
    const tentativeG = currentG + edge.distance / effectiveSafety;
    const newRealDist = (realDist.get(current) || 0) + edge.distance;
    if (newRealDist > maxDistM * SEARCH.MAX_DETOUR_FACTOR) continue;

    if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
      gScore.set(neighborId, tentativeG);
      realDist.set(neighborId, newRealDist);
      prev.set(neighborId, { prevNode: current, edgeIdx });
      // Heuristic: remaining straight-line distance, admissible because safety is at most 1.0.
      const nNode = graph.osmNodes.get(neighborId);
      const h = nNode ? fastDistance(nNode.lat, nNode.lng, endNode.lat, endNode.lng) : 0;
      heap.push(neighborId, tentativeG + h);
    }
  }
}

/**
 * A* search that minimises cost = distance / safety.
 *
 * Uses straight-line distance to the destination as the admissible heuristic, which focuses the search toward
 * the goal instead of expanding in all directions.
 *
 * @param {Map} osmNodes
 * @param {Array<object>} edges
 * @param {Map} adjacency
 * @param {number} startId
 * @param {number} endId
 * @param {number} maxDistM Straight-line based cap; a path may be up to SEARCH.MAX_DETOUR_FACTOR times it.
 * @param {{budget?: object, maxExpansions?: number, shouldCancel?: Function, allowHazards?: boolean}} [options]
 * @returns {{path: Array, edges: Array<number>, totalDist: number, avgSafety: number}|null} Null when no path.
 * @throws SEARCH_CANCELLED, or NO_ROUTE_FOUND when the expansion budget is exceeded.
 */
function aStarSafety(osmNodes, edges, adjacency, startId, endId, maxDistM, options = {}) {
  const endNode = osmNodes.get(endId);
  const sNode = osmNodes.get(startId);
  if (!adjacency.has(startId) || !adjacency.has(endId) || !endNode || !sNode) {
    debugLog('[A*] start or end missing from the graph');
    return null;
  }

  const search = {
    gScore: new Map([[startId, 0]]),
    realDist: new Map([[startId, 0]]),
    prev: new Map(),
    closed: new Set(),
    heap: new MinHeap(),
  };
  search.heap.push(startId, fastDistance(sNode.lat, sNode.lng, endNode.lat, endNode.lng));
  // Shared across candidate searches when called from findKSafestRoutes; a standalone call gets its own.
  const budget = options.budget || createSearchBudget(options);
  const graph = { osmNodes, edges, adjacency };

  while (search.heap.size > 0) {
    const { id: current } = search.heap.pop();
    countPop(budget);
    if (search.closed.has(current)) continue;
    search.closed.add(current);
    countExpansion(budget);
    if (current === endId) break;
    relaxNeighbors(current, search, graph, endNode, maxDistM, options.allowHazards);
  }

  if (!search.prev.has(endId) && startId !== endId) {
    debugLog(`[A*] no path found after visiting ${search.closed.size} nodes`);
    return null;
  }
  const rebuilt = reconstructPath(search.prev, startId, endId);
  return rebuilt ? summariseRoute(edges, rebuilt.path, rebuilt.usedEdges) : null;
}

/**
 * Converts a route (list of node ids) to a polyline [{lat, lng}, ...], skipping unknown nodes.
 * @param {Map} osmNodes
 * @param {Array<number>} path
 * @returns {Array<{lat: number, lng: number}>}
 */
function routeToPolyline(osmNodes, path) {
  const points = [];
  for (const nid of path) {
    const node = osmNodes.get(nid);
    if (node) points.push({ lat: node.lat, lng: node.lng });
  }
  return points;
}

module.exports = { findNearestNode, isHazardEdge, aStarSafety, routeToPolyline, reconstructPath, summariseRoute };
