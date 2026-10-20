/**
 * K diverse candidate routes: repeated A* searches, each penalising the edges of the routes found so far,
 * then ranking by exposure.
 */
const { SEARCH, AVOID, RISK_POOR_THRESHOLD, MAX_LENGTH_RATIO } = require('../../scoring/config');
const { throwIfCancelled } = require('./common');
const { aStarSafety } = require('./routing');
const { createSearchBudget } = require('./searchBudget');
const { rankRoutesByExposure } = require('./ranking');

/**
 * Fraction of edgesB that also appear in edgesA. A route with no edges (start equals end) is a duplicate of
 * another such route, so two of them overlap fully; against a route with edges it shares nothing.
 */
function countEdgeOverlap(edgesA, edgesB) {
  if (edgesB.length === 0) return edgesA.length === 0 ? 1 : 0;
  const setA = new Set(edgesA);
  let overlap = 0;
  for (const e of edgesB) if (setA.has(e)) overlap++;
  return overlap / edgesB.length;
}

/**
 * Runs one candidate search. A budget overrun after at least one route was found is not an error: the caller
 * keeps what it has. Cancellation and an overrun with nothing found still throw.
 * @returns {object|null|undefined} The route, null for no path, or undefined when the budget ran out.
 */
function searchCandidate(args, foundCount) {
  try {
    return aStarSafety(...args);
  } catch (err) {
    if (err && err.code === 'NO_ROUTE_FOUND' && foundCount > 0) return undefined;
    throw err;
  }
}

/**
 * Weak stretches of a route: runs of consecutive edges with risk >= RISK_POOR_THRESHOLD whose total length is at
 * least AVOID.MIN_STRETCH_M, longest first, at most AVOID.MAX_STRETCHES.
 * @param {Array<number>} routeEdges Edge indexes in route order.
 * @param {Array<object>} edges
 * @returns {Array<{edges: Array<number>, lengthM: number}>}
 */
function weakStretches(routeEdges, edges) {
  const stretches = [];
  let run = null;
  for (const eIdx of routeEdges) {
    const edge = edges[eIdx];
    if (edge.risk >= RISK_POOR_THRESHOLD) {
      if (!run) { run = { edges: [], lengthM: 0 }; stretches.push(run); }
      run.edges.push(eIdx);
      run.lengthM += edge.distance;
    } else {
      run = null;
    }
  }
  return stretches
    .filter((s) => s.lengthM >= AVOID.MIN_STRETCH_M)
    .sort((a, b) => b.lengthM - a.lengthM)
    .slice(0, AVOID.MAX_STRETCHES);
}

/** True when each route covers at least AVOID.DUPLICATE_OVERLAP of the other's edges (the same route). */
function isSameRoute(a, b) {
  return countEdgeOverlap(a.edges, b.edges) >= AVOID.DUPLICATE_OVERLAP
    && countEdgeOverlap(b.edges, a.edges) >= AVOID.DUPLICATE_OVERLAP;
}

/** Share (by length) of the stretch that the route still uses. */
function stretchReuse(route, stretch, edges) {
  const used = new Set(route.edges);
  const reusedM = stretch.edges.reduce((sum, eIdx) => sum + (used.has(eIdx) ? edges[eIdx].distance : 0), 0);
  return reusedM / stretch.lengthM;
}

/**
 * Avoidance pass: for each weak stretch of the best-ranked route, search again from the origin with the stretch's
 * edges blocked (cost x AVOID.PENALTY, not removed, so a route still exists when there is no way round) and add the
 * result when it really avoids the stretch, is not a copy of an existing candidate and is within the length cap.
 * Mutates `routes` (appends). Shares the caller's budget and cancellation; a budget overrun just ends the pass.
 */
function addAvoidanceCandidates(routes, args, budget, searchOptions) {
  const [, edges] = args;
  if (routes.length === 0) return;
  const best = rankRoutesByExposure(routes, edges)[0];
  if (!best || best.edges.length === 0) return;

  const shortestM = Math.min(...routes.map((r) => r.totalDist));
  for (const stretch of weakStretches(best.edges, edges)) {
    throwIfCancelled(budget.shouldCancel);
    // Ranking-time penalties from the normal pass would mix with the block; the pass is pure safety plus the block.
    for (const e of edges) e.penalty = 0;
    const route = searchCandidate(
      [...args, { ...searchOptions, avoidEdges: new Set(stretch.edges) }],
      routes.length,
    );
    if (route === undefined) return; // budget exhausted: keep what we have
    if (!route) continue;
    if (route.totalDist > MAX_LENGTH_RATIO * shortestM) continue;
    if (stretchReuse(route, stretch, edges) > AVOID.MAX_STRETCH_REUSE) continue;
    if (routes.some((existing) => isSameRoute(existing, route))) continue;
    routes.push(route);
  }
}

/**
 * Generate K diverse routes using iterative penalty + A*, then up to AVOID.MAX_STRETCHES avoidance candidates around
 * the best route's weak stretches (addAvoidanceCandidates), ranked by exposure. All searches share one expansion
 * budget. If a later search exhausts it after a route was found, the routes found so far are returned; if none
 * was found the NO_ROUTE_FOUND error propagates.
 *
 * @param {Map} osmNodes
 * @param {Array<object>} edges
 * @param {Map} adjacency
 * @param {number} startId
 * @param {number} endId
 * @param {number} maxDistM
 * @param {number} [k] Routes wanted.
 * @param {{maxExpansions?: number, shouldCancel?: Function, allowHazards?: boolean}} [options]
 * @returns {Array<object>} Ranked routes (see rankRoutesByExposure).
 */
function findKSafestRoutes(osmNodes, edges, adjacency, startId, endId, maxDistM, k = 5, options = {}) {
  const routes = [];
  // One budget for all k+3 candidate searches, so the cost of this call is bounded as a whole.
  const budget = createSearchBudget(options);
  const searchOptions = { ...options, budget };

  for (const e of edges) e.penalty = 0;

  try {
    for (let i = 0; i < k + SEARCH.EXTRA_SEARCHES; i++) {
      throwIfCancelled(budget.shouldCancel);
      const route = searchCandidate(
        [osmNodes, edges, adjacency, startId, endId, maxDistM, searchOptions],
        routes.length,
      );
      if (!route) break;

      const isDuplicate = routes.some((existing) => countEdgeOverlap(existing.edges, route.edges) > SEARCH.DUPLICATE_OVERLAP);
      if (!isDuplicate) {
        routes.push(route);
        if (routes.length >= k) break;
      }
      for (const eIdx of route.edges) edges[eIdx].penalty += SEARCH.PENALTY_INCREMENT;
    }
    addAvoidanceCandidates(
      routes,
      [osmNodes, edges, adjacency, startId, endId, maxDistM],
      budget,
      searchOptions,
    );
  } finally {
    // Penalties belong to this call only. They are cleared on a throw too (cancel or budget).
    for (const e of edges) e.penalty = 0;
  }
  return rankRoutesByExposure(routes, edges);
}

module.exports = { findKSafestRoutes, countEdgeOverlap, weakStretches };
