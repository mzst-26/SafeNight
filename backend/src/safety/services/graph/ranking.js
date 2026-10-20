/**
 * Ranking of candidate routes by exposure. Every candidate gets its route risk from aggregateRoute, then routes
 * are ordered by exposure with rankRoutes: exposure = routeRisk * (length in km) ^ LENGTH_EXPOSURE_EXPONENT, and
 * routes longer than MAX_LENGTH_RATIO (2.0) times the shortest stay in the list, marked excluded, at the end.
 */
const { aggregateRoute, rankRoutes } = require('../../scoring/routeAggregate');

/** Converts a graph edge to the shape routeAggregate expects. */
function toAggregateEdge(edge) {
  return {
    lengthM: edge.distance,
    risk: edge.risk,
    certainty: edge.certainty,
    cause: edge.cause,
    start: edge.start,
    end: edge.end,
  };
}

/** Scores of a route with no edges (start equals end): no risk, so it is the safest possible answer. */
const DEGENERATE_ROUTE_FIELDS = Object.freeze({
  routeRisk: 0, mean: 0, m3: 0, score: 100, certainty: 0, worstStretch: null,
  avgSafety: 1, lengthM: 0, exposure: 0, excluded: false,
});

/** Attaches the aggregate fields of a route to it (mutates) and returns its ranking input. */
function attachAggregate(route, id, edges) {
  const agg = aggregateRoute(route.edges.map((eIdx) => toAggregateEdge(edges[eIdx])));
  const lengthM = route.totalDist;
  Object.assign(route, {
    routeRisk: agg.routeRisk,
    mean: agg.mean,
    m3: agg.m3,
    score: agg.score,
    certainty: agg.certainty,
    worstStretch: agg.worstStretch,
    avgSafety: 1 - agg.routeRisk,
    lengthM,
  });
  return { id, lengthM, routeRisk: agg.routeRisk };
}

/**
 * Orders candidate routes by exposure and attaches routeRisk, mean, m3, score, certainty, worstStretch,
 * avgSafety, lengthM, exposure and excluded to each. The displayed score and the order come from this one
 * function. A route with no edges goes first.
 * @param {Array<{edges: Array<number>, totalDist: number}>} routes
 * @param {Array<object>} edges
 * @returns {Array<object>} The routes, best first, excluded ones last.
 */
function rankRoutesByExposure(routes, edges) {
  const measured = [];
  const degenerate = [];

  routes.forEach((route, id) => {
    if (route.edges.length === 0) {
      Object.assign(route, DEGENERATE_ROUTE_FIELDS);
      degenerate.push(route);
    } else {
      measured.push(attachAggregate(route, id, edges));
    }
  });

  const ordered = rankRoutes(measured).map((entry) => {
    const route = routes[entry.id];
    route.exposure = entry.exposure;
    route.excluded = entry.excluded;
    return route;
  });
  return [...degenerate, ...ordered];
}

module.exports = { toAggregateEdge, rankRoutesByExposure };
