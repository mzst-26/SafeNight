/**
 * Route-level aggregation of per-edge safety risk (spec sections 11.1 and 11.5).
 *
 * Pure functions only. A route's risk blends the length-weighted mean with a
 * length-weighted cubic power mean, so a dark stretch counts more than the same
 * length spread thinly. Splitting an edge in two never changes the result.
 */

const { CUBE_MEAN_BLEND, RISK_POOR_THRESHOLD, MAX_LENGTH_RATIO } = require('./config');
const { assertFinite, assertNonNegative, assertInRange } = require('./validation');

/**
 * Largest length (m) an edge or route may have. Longer values are rejected so the sums stay finite.
 * This is an input bound, not a tunable, so it is not in config.
 */
const MAX_LENGTH_M = 1e7;
const METRES_PER_MILE = 1609.344;
const METRES_PER_KM = 1000;
const LIGHTING_CAUSE = 'lighting';
const ONLY_ROUTE_REASON = 'Only route found';

/**
 * @typedef {object} Point
 * @property {number} lat
 * @property {number} lng
 */

/**
 * @typedef {object} Edge
 * @property {number} lengthM Edge length in metres.
 * @property {number} risk Edge risk in [0, 1], lower is safer.
 * @property {number} certainty Evidence strength in [0, 1].
 * @property {string|null} cause Dominant risk factor for the edge.
 * @property {Point} start
 * @property {Point} end
 */

/**
 * @typedef {object} Stretch
 * @property {Point} start
 * @property {Point} end
 * @property {number} lengthM
 * @property {string|null} cause
 */

/**
 * @typedef {object} RouteAggregate
 * @property {number} routeRisk
 * @property {number} mean Length-weighted mean risk.
 * @property {number} m3 Length-weighted cubic power mean of risk.
 * @property {number} score Displayed score, round(100 * (1 - routeRisk)).
 * @property {number} certainty Length-weighted mean certainty.
 * @property {Stretch|null} worstStretch Longest run of poor edges, or null.
 */

/**
 * Throws TypeError unless an edge has finite lengthM >= 0, risk in [0, 1] and
 * certainty in [0, 1].
 * @param {Edge} edge
 */
function assertEdge(edge) {
  assertInRange('edge.lengthM', edge.lengthM, 0, MAX_LENGTH_M);
  assertInRange('edge.risk', edge.risk, 0, 1);
  assertInRange('edge.certainty', edge.certainty, 0, 1);
}

/**
 * Sums a numeric projection over a list.
 * @param {Array<object>} items
 * @param {(item: object) => number} project
 * @returns {number}
 */
function sumBy(items, project) {
  return items.reduce((total, item) => total + project(item), 0);
}

/**
 * Total length of a run of edges.
 * @param {Array<Edge>} run
 * @returns {number}
 */
function runLength(run) {
  return sumBy(run, (edge) => edge.lengthM);
}

/**
 * Splits edges into maximal runs of consecutive poor edges.
 * @param {Array<Edge>} edges
 * @param {number} threshold Risk at or above which an edge is poor.
 * @returns {Array<Array<Edge>>}
 */
function poorRuns(edges, threshold) {
  const runs = [];
  let current = [];

  for (const edge of edges) {
    if (edge.risk >= threshold) {
      current.push(edge);
    } else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    runs.push(current);
  }
  return runs;
}

/**
 * Most common cause in a run, weighted by edge length. Ties go to the cause
 * that appears first in the run.
 * @param {Array<Edge>} run
 * @returns {string|null}
 */
function dominantCause(run) {
  const lengthByCause = new Map();

  for (const edge of run) {
    if (!edge.cause) continue;
    lengthByCause.set(edge.cause, (lengthByCause.get(edge.cause) || 0) + edge.lengthM);
  }

  let dominant = null;
  let dominantLength = 0;
  for (const [cause, length] of lengthByCause) {
    if (length > dominantLength) {
      dominant = cause;
      dominantLength = length;
    }
  }
  return dominant;
}

/**
 * Merges a run of poor edges into one stretch.
 * @param {Array<Edge>} run
 * @returns {Stretch}
 */
function mergeRun(run) {
  return {
    start: run[0].start,
    end: run[run.length - 1].end,
    lengthM: runLength(run),
    cause: dominantCause(run),
  };
}

/**
 * Longest merged run of consecutive poor edges.
 * @param {Array<Edge>} edges Edges with positive length.
 * @param {number} threshold
 * @returns {Stretch|null}
 */
function worstStretch(edges, threshold) {
  const runs = poorRuns(edges, threshold);
  if (runs.length === 0) return null;

  const longest = runs.reduce((best, run) => (runLength(run) > runLength(best) ? run : best));
  return mergeRun(longest);
}

/**
 * Aggregates per-edge risk into a single route risk and score.
 * Zero-length edges are ignored.
 * @param {Array<Edge>} edges
 * @param {{g?: number, poorThreshold?: number}} [options]
 * @returns {RouteAggregate}
 * @throws {TypeError} When edges is empty or has no positive-length edge.
 */
function aggregateRoute(edges, { g = CUBE_MEAN_BLEND, poorThreshold = RISK_POOR_THRESHOLD } = {}) {
  assertInRange('g', g, 0, 1);
  assertInRange('poorThreshold', poorThreshold, 0, 1);
  if (poorThreshold === 0) throw new TypeError('poorThreshold must be > 0');

  if (!Array.isArray(edges) || edges.length === 0) {
    throw new TypeError('aggregateRoute requires a non-empty array of edges');
  }
  edges.forEach(assertEdge);

  const measured = edges.filter((edge) => edge.lengthM > 0);
  if (measured.length === 0) {
    throw new TypeError('aggregateRoute requires at least one edge with positive length');
  }

  const totalLength = runLength(measured);
  const mean = sumBy(measured, (edge) => edge.lengthM * edge.risk) / totalLength;
  const m3 = Math.cbrt(sumBy(measured, (edge) => edge.lengthM * edge.risk ** 3) / totalLength);
  const routeRisk = (1 - g) * mean + g * m3;

  return {
    routeRisk,
    mean,
    m3,
    score: Math.round(100 * (1 - routeRisk)),
    certainty: sumBy(measured, (edge) => edge.lengthM * edge.certainty) / totalLength,
    worstStretch: worstStretch(measured, poorThreshold),
  };
}

/**
 * Exposure ("harm per walk"): routeRisk times length in kilometres.
 * @param {number} routeRisk in [0, 1]
 * @param {number} lengthM >= 0
 * @returns {number}
 * @throws {TypeError} When routeRisk is outside [0, 1] or lengthM is negative or not finite.
 */
function exposure(routeRisk, lengthM) {
  assertInRange('routeRisk', routeRisk, 0, 1);
  assertNonNegative('lengthM', lengthM);
  return routeRisk * (lengthM / METRES_PER_KM);
}

/**
 * Orders routes by exposure, then routeRisk, then length.
 * @param {{routeRisk: number, lengthM: number}} a
 * @param {{routeRisk: number, lengthM: number}} b
 * @returns {number}
 */
function compareRoutes(a, b) {
  return (
    exposure(a.routeRisk, a.lengthM) - exposure(b.routeRisk, b.lengthM) ||
    a.routeRisk - b.routeRisk ||
    a.lengthM - b.lengthM
  );
}

/**
 * Throws TypeError unless a route has finite lengthM > 0 and finite routeRisk.
 * @param {{lengthM: number, routeRisk: number}} route
 */
function assertRankable(route) {
  assertInRange('route.lengthM', route.lengthM, 0, MAX_LENGTH_M);
  if (route.lengthM <= 0) throw new TypeError('route.lengthM must be > 0');
  assertInRange('route.routeRisk', route.routeRisk, 0, 1);
}

/**
 * Ranks candidate routes by exposure. Routes longer than MAX_LENGTH_RATIO (1.5) times the shortest are
 * kept at the end, marked excluded. The single shortest route is always kept.
 * @param {Array<{id: *, lengthM: number, routeRisk: number}>} routes
 * @returns {Array<object>} Routes with exposure and excluded attached; empty for no routes.
 * @throws {TypeError} When a route has a non-positive or non-finite lengthM, or a non-finite routeRisk.
 */
function rankRoutes(routes) {
  if (!Array.isArray(routes)) throw new TypeError('routes must be an array');
  if (routes.length === 0) return [];
  routes.forEach(assertRankable);

  const shortestIndex = routes.reduce(
    (best, route, index) => (route.lengthM < routes[best].lengthM ? index : best),
    0,
  );
  const cap = MAX_LENGTH_RATIO * routes[shortestIndex].lengthM;
  const keep = routes.map((route, index) => index === shortestIndex || route.lengthM <= cap);
  const scored = routes.map((route) => ({
    ...route,
    exposure: exposure(route.routeRisk, route.lengthM),
  }));

  const kept = scored.filter((_, index) => keep[index]).sort(compareRoutes);
  const dropped = scored.filter((_, index) => !keep[index]).sort(compareRoutes);

  return [
    ...kept.map((route) => ({ ...route, excluded: false })),
    ...dropped.map((route) => ({ ...route, excluded: true })),
  ];
}

/**
 * Chooses the route in the list with the best value, using a strict
 * comparison so the first of equal candidates wins.
 * @param {Array<object>} routes Non-empty.
 * @param {(candidate: object, current: object) => boolean} isBetter
 * @returns {object}
 */
function pickBest(routes, isBetter) {
  return routes.reduce((chosen, route) => (isBetter(route, chosen) ? route : chosen));
}

/**
 * Describes how the best route's length compares with another route's. Lengths
 * that round to the same tenth of a mile count as the same length.
 * @param {object} best
 * @param {object} other
 * @returns {string}
 */
function lengthClause(best, other) {
  const deltaM = best.lengthM - other.lengthM;
  const miles = Math.round((Math.abs(deltaM) / METRES_PER_MILE) * 10) / 10;

  if (miles === 0) return `about the same length as Route ${other.id}`;
  const text = `${miles.toFixed(1)} mi`;
  return deltaM < 0
    ? `${text} shorter than Route ${other.id}`
    : `${text} longer than Route ${other.id}`;
}

/**
 * Describes how the best route's score compares with another route's.
 * @param {object} best
 * @param {object} other
 * @returns {string|null} Null when the scores are equal.
 */
function scoreClause(best, other) {
  const difference = best.score - other.score;
  if (difference === 0) return null;

  const points = Math.abs(difference);
  return difference > 0
    ? `scores ${points} higher than Route ${other.id}`
    : `Route ${other.id} scores ${points} higher`;
}

/**
 * Describes a poor stretch the best route avoids: an alternative whose longest
 * poor stretch is longer than the best route's (or the best route has none).
 * @param {object} best
 * @param {Array<object>} alternatives
 * @returns {string|null}
 */
function stretchClause(best, alternatives) {
  const bestStretchM = best.worstStretch ? best.worstStretch.lengthM : 0;
  const worse = alternatives.filter(
    (route) => route.worstStretch && route.worstStretch.lengthM > bestStretchM,
  );
  if (worse.length === 0) return null;

  const avoided = pickBest(worse, (route, current) =>
    route.worstStretch.lengthM > current.worstStretch.lengthM,
  );
  const qualifier = avoided.worstStretch.cause === LIGHTING_CAUSE ? 'dark' : 'high-risk';
  return `avoids a ${Math.round(avoided.worstStretch.lengthM)} m ${qualifier} stretch`;
}

/**
 * Throws TypeError unless a candidate's numbers are finite, so no reason text
 * can ever contain NaN or Infinity.
 * @param {object} route
 */
function assertCandidate(route) {
  assertFinite('route.lengthM', route.lengthM);
  assertFinite('route.routeRisk', route.routeRisk);
  assertFinite('route.score', route.score);
  if (route.worstStretch) assertFinite('route.worstStretch.lengthM', route.worstStretch.lengthM);
}

/**
 * Builds a one-line, data-derived reason for the best route. Every claim is
 * computed from the inputs. The length and score clauses compare against one
 * route only: the runner-up, the best alternative by exposure.
 *
 * "Safest and shortest" is decided on the unrounded routeRisk, so two routes that
 * round to the same displayed score are still compared on their real risk.
 *
 * `best` is normally the rank-1 route from rankRoutes. The formatter also calls this
 * for later routes, and then the reason leads with "Route N" instead of "Lowest overall
 * exposure", so no rank-1 assumption is enforced here.
 *
 * @param {{id: *, lengthM: number, routeRisk: number, score: number, worstStretch?: Stretch|null}} best
 * @param {Array<object>} others Candidate routes; entries with best's id are ignored.
 * @returns {string}
 * @throws {TypeError} When a candidate has a non-finite lengthM, routeRisk, score or stretch length.
 */
function buildReason(best, others) {
  [best, ...others].forEach(assertCandidate);

  const alternatives = others.filter((route) => route.id !== best.id);
  if (alternatives.length === 0) return ONLY_ROUTE_REASON;

  const runnerUp = [...alternatives].sort(compareRoutes)[0];
  const isSafestAndShortest = alternatives.every(
    (route) => best.routeRisk <= route.routeRisk && best.lengthM <= route.lengthM,
  );

  if (isSafestAndShortest) {
    const stretch = stretchClause(best, alternatives);
    return stretch ? `Safest and shortest: ${stretch}` : 'Safest and shortest';
  }

  const isLowestExposure =
    exposure(best.routeRisk, best.lengthM) <= exposure(runnerUp.routeRisk, runnerUp.lengthM);
  const lead = isLowestExposure ? 'Lowest overall exposure' : `Route ${best.id}`;
  const clauses = [
    lengthClause(best, runnerUp),
    scoreClause(best, runnerUp),
    stretchClause(best, alternatives),
  ].filter(Boolean);

  return `${lead}: ${clauses.join(', ')}`;
}

module.exports = {
  aggregateRoute,
  exposure,
  rankRoutes,
  buildReason,
};
