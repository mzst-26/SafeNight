/**
 * Route-level aggregation of per-edge safety risk (spec sections 11.1 and 11.5).
 *
 * Pure functions only. A route's risk blends the length-weighted mean with a
 * length-weighted cubic power mean, so a dark stretch counts more than the same
 * length spread thinly. Splitting an edge in two never changes the result.
 */

/** Weight of the cubic power mean in routeRisk (spec 11.5). */
const G = 0.4;
/** Edge risk at or above which an edge counts as part of a poor stretch. */
const POOR = 0.6;
/** Routes longer than this multiple of the shortest route are excluded. */
const MAX_LENGTH_RATIO = 1.5;
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
function aggregateRoute(edges, { g = G, poorThreshold = POOR } = {}) {
  if (!Array.isArray(edges) || edges.length === 0) {
    throw new TypeError('aggregateRoute requires a non-empty array of edges');
  }

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
 * @param {number} routeRisk
 * @param {number} lengthM
 * @returns {number}
 */
function exposure(routeRisk, lengthM) {
  return routeRisk * (lengthM / METRES_PER_KM);
}

/**
 * Orders routes by exposure, then routeRisk, then length.
 * @param {{exposure: number, routeRisk: number, lengthM: number}} a
 * @param {{exposure: number, routeRisk: number, lengthM: number}} b
 * @returns {number}
 */
function compareRoutes(a, b) {
  return a.exposure - b.exposure || a.routeRisk - b.routeRisk || a.lengthM - b.lengthM;
}

/**
 * Ranks candidate routes by exposure. Routes longer than 1.5x the shortest are
 * kept at the end, marked excluded. The shortest route is always kept.
 * @param {Array<{id: *, lengthM: number, routeRisk: number}>} routes
 * @returns {Array<object>} Routes with exposure and excluded attached.
 */
function rankRoutes(routes) {
  if (routes.length === 0) return [];

  const shortest = Math.min(...routes.map((route) => route.lengthM));
  const cap = MAX_LENGTH_RATIO * shortest;
  const scored = routes.map((route) => ({
    ...route,
    exposure: exposure(route.routeRisk, route.lengthM),
  }));

  const kept = scored.filter((route) => route.lengthM <= cap).sort(compareRoutes);
  const dropped = scored.filter((route) => route.lengthM > cap).sort(compareRoutes);

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
 * Formats a distance in metres as miles with one decimal place.
 * @param {number} metres
 * @returns {string}
 */
function milesText(metres) {
  return (Math.abs(metres) / METRES_PER_MILE).toFixed(1);
}

/**
 * Describes how the best route's length compares with another route's.
 * @param {object} best
 * @param {object} other
 * @returns {string}
 */
function lengthClause(best, other) {
  const deltaM = best.lengthM - other.lengthM;
  const miles = milesText(deltaM);

  if (miles === '0.0') return `about the same length as Route ${other.id}`;
  return deltaM < 0
    ? `${miles} mi shorter than Route ${other.id}`
    : `${miles} mi longer than Route ${other.id}`;
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
 * Builds a one-line, data-derived reason for the best route. Every claim is
 * computed from the inputs.
 * @param {{id: *, lengthM: number, routeRisk: number, score: number, worstStretch?: Stretch|null}} best
 * @param {Array<object>} others Candidate routes; entries with best's id are ignored.
 * @returns {string}
 */
function buildReason(best, others) {
  const alternatives = others.filter((route) => route.id !== best.id);
  if (alternatives.length === 0) return ONLY_ROUTE_REASON;

  const shortest = pickBest(alternatives, (route, current) => route.lengthM < current.lengthM);
  const highestScore = pickBest(alternatives, (route, current) => route.score > current.score);
  const bestExposure = exposure(best.routeRisk, best.lengthM);
  const isSafestAndShortest = alternatives.every(
    (route) => best.score >= route.score && best.lengthM <= route.lengthM,
  );
  const isLowestExposure = alternatives.every(
    (route) => bestExposure <= exposure(route.routeRisk, route.lengthM),
  );

  if (isSafestAndShortest) {
    const stretch = stretchClause(best, alternatives);
    return stretch ? `Safest and shortest: ${stretch}` : 'Safest and shortest';
  }

  const lead = isLowestExposure ? 'Lowest overall exposure' : `Route ${best.id}`;
  const clauses = [
    lengthClause(best, shortest),
    scoreClause(best, highestScore),
    stretchClause(best, alternatives),
  ].filter(Boolean);

  return clauses.length > 0 ? `${lead}: ${clauses.join(', ')}` : lead;
}

module.exports = {
  aggregateRoute,
  exposure,
  rankRoutes,
  buildReason,
};
