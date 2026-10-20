const {
  checkOpenNow,
  heuristicOpen,
  safetyLabel,
} = require("./safeRoutesUtils");
const { collectRoutePOIs } = require("./safeRoutesPoiCollector");
const { encodePolyline } = require("../services/geo");
const {
  routeToPolyline,
  routeSafetyBreakdown,
} = require("../services/safetyGraph");
const {
  buildRouteLightGapSpans,
} = require("../services/lightConfidenceEngine");
const { severityOf } = require("../services/crimeSeverity");
const { rankRoutes, buildReason } = require("../scoring/routeAggregate");
const { RISK_POOR_THRESHOLD } = require("../scoring/config");
const { normalizeCrimeStatus } = require("../services/graph/clock");
const { normalizeResponsePolicy, buildRouteVertices, limitRoutePois } = require("./safeRoutesPoiLimiter");

const WALKING_SPEED_MPS = 1.35;

// Scoring output: score, segment colour, reason and crime markers follow the definitions below.

// Six-step risk ramp, index 0 = lowest risk. Must match RISK_RAMP in
// src/components/maps/routeLayers.ts (the frontend test pins the same values).
const RISK_RAMP = ["#26998E", "#617933", "#715200", "#693000", "#55120B", "#370412"];
const UNKNOWN_RISK_COLOR = "#8A8F98";

const CRIME_CLUSTER_CELL_M = 120;
const CRIME_CLUSTER_CAP = 60;
const METRES_PER_DEG_LAT = 111320;
const LIGHTING_VERIFIED_FRACTION = 0.7;
const LIGHTING_MIXED_FRACTION = 0.3;
const CAUTION_TEXT = "Includes unverified or high-risk segments";

const round2 = (value) => Math.round(value * 100) / 100;
const round6 = (value) => Math.round(value * 1e6) / 1e6;

/** Colour for a risk in [0, 1] from the six-step ramp; grey for a non-finite value. */
function riskToRampColor(risk) {
  if (!Number.isFinite(risk)) return UNKNOWN_RISK_COLOR;
  const clamped = Math.min(1, Math.max(0, risk));
  return RISK_RAMP[Math.min(RISK_RAMP.length - 1, Math.floor(clamped * RISK_RAMP.length))];
}

/** Lighting data quality from the share of route length with a surveyed (lit/unlit) tag. */
function lightingQualityFor(verifiedFraction) {
  if (!Number.isFinite(verifiedFraction)) return "estimated";
  if (verifiedFraction >= LIGHTING_VERIFIED_FRACTION) return "verified";
  if (verifiedFraction >= LIGHTING_MIXED_FRACTION) return "mixed";
  return "estimated";
}

function edgeLengthM(edge) {
  return Number.isFinite(edge.lengthM) ? edge.lengthM : edge.distance || 0;
}

/**
 * Groups crimes into ~120 m cells. Each cluster is { lat, lng, count, maxSeverity, kind }, where
 * lat/lng is the centroid. Ordered by count, then severity, then position, and capped.
 * Points without finite, in-range coordinates are ignored.
 */
function clusterCrimes(crimes, { cap = CRIME_CLUSTER_CAP, cellM = CRIME_CLUSTER_CELL_M } = {}) {
  const valid = (Array.isArray(crimes) ? crimes : []).filter(
    (c) =>
      c &&
      Number.isFinite(c.lat) && Number.isFinite(c.lng) &&
      Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180,
  );
  if (valid.length === 0) return [];

  const meanLat = valid.reduce((sum, c) => sum + c.lat, 0) / valid.length;
  const metresPerDegLng = METRES_PER_DEG_LAT * Math.max(1e-6, Math.cos((meanLat * Math.PI) / 180));
  const cellLat = cellM / METRES_PER_DEG_LAT;
  const cellLng = cellM / metresPerDegLng;

  const cells = new Map();
  for (const crime of valid) {
    const key = `${Math.floor(crime.lat / cellLat)}:${Math.floor(crime.lng / cellLng)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { count: 0, sumLat: 0, sumLng: 0, maxSeverity: 0 };
      cells.set(key, cell);
    }
    cell.count += 1;
    cell.sumLat += crime.lat;
    cell.sumLng += crime.lng;
    cell.maxSeverity = Math.max(cell.maxSeverity, severityOf(crime.category));
  }

  return [...cells.values()]
    .map((cell) => ({
      lat: round6(cell.sumLat / cell.count),
      lng: round6(cell.sumLng / cell.count),
      count: cell.count,
      maxSeverity: round2(cell.maxSeverity),
      kind: "crime",
    }))
    .sort((a, b) => b.count - a.count || b.maxSeverity - a.maxSeverity || a.lat - b.lat || a.lng - b.lng)
    .slice(0, cap);
}

/** Stretch in the API shape: rounded length, endpoints and cause. */
function formatWorstStretch(stretch) {
  if (!stretch) return null;
  return {
    start: stretch.start,
    end: stretch.end,
    lengthM: Math.round(stretch.lengthM),
    cause: stretch.cause ?? null,
  };
}

/**
 * Ranks the candidate routes by exposure and gives each its display id, 1-based, matching the
 * "Route N" summary label. Returns prepared entries in display order plus buildReason candidates.
 */
function rankForDisplay(prepared) {
  // A 0 m route (start equals end) has no length to rank by. It goes first, as in rankRoutesByExposure, and is
  // kept out of rankRoutes so it cannot become the shortest route that sets the 2.0x cap.
  const zeroLength = prepared.filter((entry) => !(entry.route.totalDist > 0));
  const measured = prepared.filter((entry) => entry.route.totalDist > 0);
  const ranked = rankRoutes(
    measured.map((entry) => ({
      id: entry.index,
      lengthM: entry.route.totalDist,
      routeRisk: entry.breakdown.routeRisk,
    })),
  );
  const ordered = [...zeroLength, ...ranked.map((r) => prepared[r.id])];
  const candidates = ordered.map((entry, position) => ({
    id: position + 1,
    lengthM: entry.route.totalDist > 0 ? Math.max(1, entry.route.totalDist) : 0,
    routeRisk: entry.breakdown.routeRisk,
    score: Math.round(100 * (1 - entry.breakdown.routeRisk)),
    worstStretch: entry.breakdown.worstStretch
      ? { lengthM: entry.breakdown.worstStretch.lengthM, cause: entry.breakdown.worstStretch.cause ?? null }
      : null,
  }));
  return { ordered, candidates };
}
function buildLightUncertaintySpans(route, edges, osmNodes, edgeConfidences) {
  return buildRouteLightGapSpans(route, edges, osmNodes, edgeConfidences, {
    lowThreshold: 0.58,
    continueThreshold: 0.72,
    minSpanDistance: 90,
  }).map((span) => {
    const startNode = osmNodes.get(span.startNodeId);
    const endNode = osmNodes.get(span.endNodeId);
    if (!startNode || !endNode) return null;

    return {
      start: { lat: startNode.lat, lng: startNode.lng },
      end: { lat: endNode.lat, lng: endNode.lng },
      edgeCount: span.edgeCount,
      distance: span.distance,
      reason: span.reason === 'explicit_dark_span' ? 'explicit_dark' : 'light_uncertain',
      confidence: span.confidence,
    };
  }).filter(Boolean);
}

/** Scores as whole percentages, the shape both payloads share. */
function breakdownPercentages(breakdown) {
  return {
    roadType: Math.round(breakdown.roadType * 100),
    lighting: Math.round(breakdown.lighting * 100),
    crime: Math.round(breakdown.crime * 100),
    cctv: Math.round(breakdown.cctv * 100),
    openPlaces: Math.round(breakdown.openPlaces * 100),
    traffic: Math.round(breakdown.traffic * 100),
  };
}

function buildCompactRoutePayload({
  route,
  idx,
  score100,
  label,
  color,
  breakdown,
  routeStats,
  limitedRoutePOIs,
  durationSec,
  queryFootprints,
  lightUncertaintySpans,
  safetyScoring = {},
}) {
  return {
    routeIndex: idx,
    isSafest: idx === 0,
    overview_polyline: route.overview_polyline,
    summary: route.summary,
    distance: route.legs[0]?.distance,
    duration: route.legs[0]?.duration,
    safety: {
      score: score100,
      label,
      color,
      breakdown: breakdownPercentages(breakdown),
      ...safetyScoring,
    },
    routeStats: {
      deadEnds: routeStats.deadEnds,
      sidewalkPct: routeStats.sidewalkPct,
      unpavedPct: routeStats.unpavedPct,
      transitStopsNearby: routeStats.transitStopsNearby,
      cctvCamerasNearby: routeStats.cctvCamerasNearby,
      estimatedDurationSec: durationSec,
      ...(routeStats.crimeCount !== undefined ? { crimeCount: routeStats.crimeCount } : {}),
    },
    routePOIs: limitedRoutePOIs,
    queryFootprints,
    lightUncertaintySpans,
    // Uncertainty is drawn as dashed lines on the segments, so these two stay empty. Kept in the payload so
    // clients that still read them get a list.
    generalUncertaintyBoxes: [],
    uncertaintyBoxes: [],
  };
}

function collectLightNodes(lightElements) {
  const lightNodes = [];
  for (const el of lightElements || []) {
    if (
      el.type === "node" &&
      el.tags?.highway === "street_lamp" &&
      el.lat &&
      el.lon
    ) {
      lightNodes.push({ lat: el.lat, lng: el.lon });
    }
  }
  return lightNodes;
}

function collectOpenPlaceNodes(placeElements, enableOpeningHoursParse, openPlacesOnly = true) {
  const placeNodes = [];
  for (const el of placeElements || []) {
    const lat = el.lat || el.center?.lat;
    const lng = el.lon || el.center?.lon;
    if (!lat || !lng) continue;

    const name =
      el.tags?.name ||
      el.tags?.["name:en"] ||
      el.tags?.brand ||
      el.tags?.operator ||
      "";
    const amenity =
      el.tags?.amenity ||
      el.tags?.shop ||
      el.tags?.leisure ||
      el.tags?.tourism ||
      "";
    const hoursRaw = el.tags?.opening_hours || "";

    let open = null;
    let nextChange = null;

    if (enableOpeningHoursParse && hoursRaw) {
      const parsed = checkOpenNow(hoursRaw);
      open = parsed.open;
      nextChange = parsed.nextChange;
    }

    if (open === null) {
      const heuristic = heuristicOpen(amenity);
      open = heuristic.open;
      nextChange = heuristic.nextChange;
    }

    if (openPlacesOnly && open !== true) continue;

    placeNodes.push({
      lat,
      lng,
      name,
      amenity,
      open,
      nextChange,
      opening_hours: hoursRaw,
    });
  }

  return placeNodes;
}

/**
 * Walks the edges of a route once and gathers the segment list and the totals the route stats need.
 * @returns {object} segments, deadEndCount, sidewalkDist, unpavedDist, transitStopCount, cctvNearCount,
 *   roadNameChanges, verifiedLengthM and totalLengthM.
 */
function walkRouteEdges(route, edges, osmNodes) {
  const walk = {
    segments: [],
    deadEndCount: 0,
    sidewalkDist: 0,
    unpavedDist: 0,
    transitStopCount: 0,
    cctvNearCount: 0,
    roadNameChanges: [],
    verifiedLengthM: 0,
    totalLengthM: 0,
  };
  let lastRoadName = "";
  let cumulativeDist = 0;

  for (let i = 0; i < route.edges.length; i++) {
    const edge = edges[route.edges[i]];
    const nodeA = osmNodes.get(route.path[i]);
    const nodeB = osmNodes.get(route.path[i + 1]);
    if (!nodeA || !nodeB) continue;

    if (edge.isDeadEnd) walk.deadEndCount++;
    if (edge.hasSidewalk) walk.sidewalkDist += edge.distance;
    if (edge.surfacePenalty > 0) walk.unpavedDist += edge.distance;
    walk.transitStopCount += edge.nearbyTransitCount;
    walk.cctvNearCount += edge.nearbyCctvCount;

    const roadName = edge.roadName || "";
    if (roadName && roadName !== lastRoadName) {
      walk.roadNameChanges.push({ segmentIndex: i, name: roadName, distance: Math.round(cumulativeDist) });
      lastRoadName = roadName;
    }
    cumulativeDist += edge.distance;

    const lengthM = edgeLengthM(edge);
    walk.totalLengthM += lengthM;
    if (edge.litEstimate === "lit" || edge.litEstimate === "unlit") walk.verifiedLengthM += lengthM;

    walk.segments.push(segmentPayload(edge, nodeA, nodeB));
  }
  return walk;
}

/** One route segment in the API shape. */
function segmentPayload(edge, nodeA, nodeB) {
  return {
    start: { lat: nodeA.lat, lng: nodeA.lng },
    end: { lat: nodeB.lat, lng: nodeB.lng },
    safetyScore: edge.safetyScore,
    color: riskToRampColor(edge.risk),
    highway: edge.highway,
    roadName: edge.roadName,
    isDeadEnd: edge.isDeadEnd,
    hasSidewalk: edge.hasSidewalk,
    surfaceType: edge.surfaceType,
    lightScore: edge.lightScore,
    crimeScore: edge.crimeScore,
    cctvScore: edge.cctvScore,
    placeScore: edge.placeScore,
    trafficScore: edge.trafficScore,
    distance: Math.round(edge.distance),
    risk: edge.risk,
    litEstimate: edge.litEstimate ?? null,
    certainty: edge.certainty ?? null,
    cause: edge.cause ?? null,
  };
}

/** The route-level stats block (dead ends, sidewalk and unpaved shares, nearby transit and cameras). */
function buildRouteStats(route, walk, crimeCount) {
  const share = (dist) => (route.totalDist > 0 ? Math.round((dist / route.totalDist) * 100) : 0);
  return {
    deadEnds: walk.deadEndCount,
    sidewalkPct: share(walk.sidewalkDist),
    unpavedPct: share(walk.unpavedDist),
    transitStopsNearby: Math.min(walk.transitStopCount, 50),
    cctvCamerasNearby: Math.min(walk.cctvNearCount, 50),
    roadNameChanges: walk.roadNameChanges,
    crimeCount,
  };
}

/** A high-risk edge on the route raises the caution flag. */
function cautionFlagFor(breakdown) {
  return breakdown.riskVector && breakdown.riskVector.max >= RISK_POOR_THRESHOLD ? CAUTION_TEXT : null;
}

/** Distance and duration texts for the single leg of a route. */
function legSummary(totalDist, durationSec, oLat, oLng, dLat, dLng) {
  return {
    distance: {
      text: totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)} km` : `${Math.round(totalDist)} m`,
      value: Math.round(totalDist),
    },
    duration: {
      text:
        durationSec >= 3600
          ? `${Math.floor(durationSec / 3600)} hr ${Math.round((durationSec % 3600) / 60)} mins`
          : `${Math.round(durationSec / 60)} mins`,
      value: durationSec,
    },
    start_location: { lat: oLat, lng: oLng },
    end_location: { lat: dLat, lng: dLng },
    steps: [],
  };
}

/** The POIs of one route, capped per category, with crimes clustered server-side. */
function buildLimitedRoutePois(route, ctx) {
  const routePOIs = collectRoutePOIs(
    route.path,
    ctx.osmNodes,
    ctx.cctvNodes,
    ctx.transitNodes,
    ctx.nodeDegree,
    ctx.lightNodes,
    ctx.placeNodes,
    ctx.crimes,
  );
  const routeVertices = buildRouteVertices(route.path, ctx.osmNodes);
  const limited = limitRoutePois(routePOIs, ctx.policy.poiCaps, routeVertices, ctx.oLat, ctx.oLng);
  // Crime markers are clustered server-side; the true total goes to routeStats.crimeCount.
  limited.crimes = clusterCrimes(routePOIs.crimes, {
    cap: Math.min(ctx.policy.poiCaps.crimes, CRIME_CLUSTER_CAP),
  });
  return { limitedRoutePOIs: limited, crimeCount: (routePOIs.crimes || []).length };
}

/** The riskVector block of the full payload: rounded to two decimals, with the detour ratio added. */
function riskVectorPayload(riskVector, detourRatio) {
  if (!riskVector) return null;
  return {
    mean: round2(riskVector.mean),
    p95: round2(riskVector.p95),
    max: round2(riskVector.max),
    uncertainty: round2(riskVector.uncertainty),
    detourRatio: round2(detourRatio),
  };
}

/** The full route payload (segments, legs, POIs and the safety block). */
function buildFullRoutePayload(p) {
  const { idx, route, breakdown, ctx } = p;
  return {
    routeIndex: idx,
    isSafest: idx === 0,
    overview_polyline: { points: encodePolyline(p.polyline) },
    legs: [legSummary(route.totalDist, p.durationSec, ctx.oLat, ctx.oLng, ctx.dLat, ctx.dLng)],
    summary: idx === 0 ? "Safest Route" : `Route ${idx + 1}`,
    safety: {
      score: p.score100,
      label: p.label,
      color: p.color,
      breakdown: breakdownPercentages(breakdown),
      roadTypes: breakdown.roadTypes,
      mainRoadRatio: Math.round(breakdown.mainRoadRatio * 100),
      riskVector: riskVectorPayload(breakdown.riskVector, p.detourRatio),
      caution: cautionFlagFor(breakdown),
      ...p.safetyScoring,
    },
    segments: p.walk.segments,
    routeStats: p.routeStats,
    routePOIs: p.limitedRoutePOIs,
    queryFootprints: ctx.verificationFootprints,
    lightUncertaintySpans: p.lightUncertaintySpans,
    generalUncertaintyBoxes: [],
    uncertaintyBoxes: [],
  };
}

/** Formats one ranked route (index idx) as the API payload, full or compact by policy. */
function formatRoute({ route, breakdown }, idx, candidates, ctx) {
  const { osmNodes, edges } = ctx;
  const score100 = Math.round(100 * (1 - breakdown.routeRisk));
  const { label, color } = safetyLabel(score100);
  const durationSec = Math.round(route.totalDist / WALKING_SPEED_MPS);
  const walk = walkRouteEdges(route, edges, osmNodes);
  const { limitedRoutePOIs, crimeCount } = buildLimitedRoutePois(route, ctx);
  const lightingQuality = lightingQualityFor(walk.totalLengthM > 0 ? walk.verifiedLengthM / walk.totalLengthM : NaN);
  const lightUncertaintySpans = buildLightUncertaintySpans(route, edges, osmNodes, ctx.edgeConfidences);
  const safetyScoring = {
    certainty: Number.isFinite(breakdown.certainty) ? round2(breakdown.certainty) : null,
    reason: buildReason(candidates[idx], candidates),
    worstStretch: formatWorstStretch(breakdown.worstStretch),
    dataQuality: { crime: ctx.crimeStatus, lighting: lightingQuality },
  };
  const routeStats = buildRouteStats(route, walk, crimeCount);

  const fullRoutePayload = buildFullRoutePayload({
    idx,
    route,
    breakdown,
    ctx,
    polyline: routeToPolyline(osmNodes, route.path),
    durationSec,
    detourRatio: ctx.straightLineDist > 0 ? route.totalDist / ctx.straightLineDist : 0,
    score100,
    label,
    color,
    walk,
    routeStats,
    limitedRoutePOIs,
    lightUncertaintySpans,
    safetyScoring,
  });
  if (ctx.policy.verbosity !== "compact") return fullRoutePayload;
  return buildCompactRoutePayload({
    route: fullRoutePayload,
    idx,
    score100,
    label,
    color,
    breakdown,
    routeStats,
    limitedRoutePOIs,
    durationSec,
    queryFootprints: ctx.verificationFootprints,
    lightUncertaintySpans,
    safetyScoring,
  });
}

/**
 * Formats the candidate routes as the API response, best route first. Candidates are ranked by exposure here,
 * so index 0 is the recommended route and "Route N" in a reason is the 1-based display position.
 *
 * @param {object} args
 * @param {Array<object>} args.rawRoutes Routes from findKSafestRoutes ({path, edges, totalDist}).
 * @param {Map} args.osmNodes
 * @param {Array<object>} args.edges Graph edges.
 * @param {Array<object>} args.cctvNodes
 * @param {Array<object>} args.transitNodes
 * @param {Map} args.nodeDegree
 * @param {Array<object>} args.crimes Crime rows for the route POIs.
 * @param {{lights?: object, places?: object}} args.allData Raw OSM data for lamp and place POIs.
 * @param {number} args.oLat Origin latitude.
 * @param {number} args.oLng Origin longitude.
 * @param {number} args.dLat Destination latitude.
 * @param {number} args.dLng Destination longitude.
 * @param {boolean} args.enableOpeningHoursParse Parse place opening_hours tags.
 * @param {object} [args.responsePolicy] Verbosity and POI caps (see normalizeResponsePolicy).
 * @param {Array|null} [args.edgeConfidences] Per-edge light confidence, used for light-uncertainty spans.
 * @param {number} [args.straightLineDist] Straight-line metres, for the detour ratio.
 * @param {Array<object>} [args.verificationFootprints]
 * @param {string} [args.crimeStatus] 'ok' or 'unavailable'; anything else, including a missing value, is reported as unavailable (normalizeCrimeStatus).
 * @returns {Array<object>} One payload per route.
 */
function buildRouteResponses({
  rawRoutes,
  osmNodes,
  edges,
  cctvNodes,
  transitNodes,
  nodeDegree,
  crimes,
  allData,
  oLat,
  oLng,
  dLat,
  dLng,
  enableOpeningHoursParse,
  responsePolicy,
  edgeConfidences = null,
  straightLineDist = 0,
  verificationFootprints = [],
  crimeStatus,
}) {
  const policy = normalizeResponsePolicy(responsePolicy);
  const prepared = rawRoutes.map((route, index) => ({
    index,
    route,
    breakdown: routeSafetyBreakdown(edges, route.edges),
  }));
  const { ordered, candidates } = rankForDisplay(prepared);
  const ctx = {
    osmNodes,
    edges,
    cctvNodes,
    transitNodes,
    nodeDegree,
    crimes,
    oLat,
    oLng,
    dLat,
    dLng,
    policy,
    edgeConfidences,
    straightLineDist,
    verificationFootprints,
    crimeStatus: normalizeCrimeStatus(crimeStatus),
    lightNodes: collectLightNodes(allData?.lights?.elements),
    placeNodes: collectOpenPlaceNodes(allData?.places?.elements, enableOpeningHoursParse, policy.openPlacesOnly),
  };
  return ordered.map((entry, idx) => formatRoute(entry, idx, candidates, ctx));
}

/**
 * Errors such as NO_WALKING_NETWORK or NO_ROUTE_FOUND carry a 4xx status and a code: they are answers
 * about the request, not server faults. Returns the status and payload to send, or null for everything else.
 */
function routeErrorResponse(err) {
  if (!err || !Number.isInteger(err.statusCode) || err.statusCode < 400 || err.statusCode >= 500 || !err.code) {
    return null;
  }
  return {
    status: err.statusCode,
    payload: { error: err.code, message: err.message },
  };
}

module.exports = {
  collectLightNodes,
  collectOpenPlaceNodes,
  buildRouteResponses,
  routeErrorResponse,
  clusterCrimes,
  lightingQualityFor,
  riskToRampColor,
};
