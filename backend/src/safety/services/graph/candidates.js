/**
 * K diverse candidate routes: repeated A* searches, each penalising the edges of the routes found so far,
 * then ranking by exposure.
 */
const { SEARCH } = require('../../scoring/config');
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
 * Generate K diverse routes using iterative penalty + A*, ranked by exposure. All searches share one expansion
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
  } finally {
    // Penalties belong to this call only. They are cleared on a throw too (cancel or budget).
    for (const e of edges) e.penalty = 0;
  }
  return rankRoutesByExposure(routes, edges);
}

module.exports = { findKSafestRoutes, countEdgeOverlap };
