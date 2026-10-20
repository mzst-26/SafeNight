/**
 * Per-route safety breakdown: route-level risk from aggregateRoute plus length-weighted factor values.
 */
const { aggregateRoute } = require('../../scoring/routeAggregate');
const { toAggregateEdge } = require('./ranking');

/** Highway classes counted as main roads in mainRoadRatio. */
const MAIN_ROAD_CLASSES = ['primary', 'secondary', 'tertiary', 'trunk'];

/** Breakdown of a route with no distance: all zeros. */
function emptyBreakdown() {
  return {
    roadType: 0, lighting: 0, crime: 0, cctv: 0, openPlaces: 0,
    traffic: 0, overall: 0, roadTypes: {}, mainRoadRatio: 0,
    riskVector: { mean: 0, p95: 0, max: 0, uncertainty: 0 },
    routeRisk: 0, mean: 0, m3: 0, certainty: 0, worstStretch: null,
  };
}

/** Length-weighted mean of an edge field. */
function weightedMean(segments, field, totalDist) {
  return segments.reduce((sum, e) => sum + (e[field] || 0) * e.distance, 0) / totalDist;
}

/**
 * Distance per highway class, as whole-percent shares, and the main-road share.
 * @returns {{roadTypePct: Object<string, number>, mainRoadRatio: number}}
 */
function roadTypeShares(segments, totalDist) {
  const roadTypes = {};
  for (const e of segments) roadTypes[e.highway] = (roadTypes[e.highway] || 0) + e.distance;
  const roadTypePct = {};
  for (const [type, dist] of Object.entries(roadTypes)) {
    roadTypePct[type] = Math.round((dist / totalDist) * 100);
  }
  const mainRoadDist = MAIN_ROAD_CLASSES.reduce((sum, type) => sum + (roadTypes[type] || 0), 0);
  return { roadTypePct, mainRoadRatio: mainRoadDist / totalDist };
}

/** Nearest-rank p95 and max over edge risks (unweighted). */
function riskPercentiles(segments) {
  const risks = segments.filter((e) => e.distance > 0).map((e) => e.risk).sort((a, b) => a - b);
  return { p95: risks[Math.ceil(0.95 * risks.length) - 1], max: risks[risks.length - 1] };
}

/**
 * Breakdown of a route. The score is 1 - routeRisk (aggregateRoute), the same value the ranking uses.
 * Per-factor values are length-weighted from the edge fields; riskVector describes risk (mean, p95 and max
 * edge risk), and its uncertainty is 1 - certainty. An empty route (no distance) returns zeros.
 *
 * @param {Array<object>} edges
 * @param {Array<number>} usedEdgeIdxs Edge indexes of the route, in order.
 * @returns {object}
 */
function routeSafetyBreakdown(edges, usedEdgeIdxs) {
  const segments = usedEdgeIdxs.map((eIdx) => edges[eIdx]);
  const totalDist = segments.reduce((sum, e) => sum + e.distance, 0);
  if (totalDist === 0) return emptyBreakdown();

  const agg = aggregateRoute(segments.map(toAggregateEdge));
  const { roadTypePct, mainRoadRatio } = roadTypeShares(segments, totalDist);
  const { p95, max } = riskPercentiles(segments);

  return {
    roadType: weightedMean(segments, 'roadScore', totalDist),
    lighting: weightedMean(segments, 'lightScore', totalDist),
    crime: weightedMean(segments, 'crimeScore', totalDist),
    cctv: weightedMean(segments, 'cctvScore', totalDist),
    openPlaces: weightedMean(segments, 'placeScore', totalDist),
    traffic: weightedMean(segments, 'trafficScore', totalDist),
    overall: 1 - agg.routeRisk,
    roadTypes: roadTypePct,
    mainRoadRatio,
    riskVector: { mean: agg.mean, p95, max, uncertainty: 1 - agg.certainty },
    routeRisk: agg.routeRisk,
    mean: agg.mean,
    m3: agg.m3,
    certainty: agg.certainty,
    worstStretch: agg.worstStretch,
  };
}

module.exports = { routeSafetyBreakdown, emptyBreakdown, roadTypeShares, riskPercentiles };
