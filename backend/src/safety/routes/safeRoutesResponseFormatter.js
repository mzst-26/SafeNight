const {
  checkOpenNow,
  heuristicOpen,
  safetyLabel,
  segmentColor,
} = require("./safeRoutesUtils");
const { collectRoutePOIs } = require("./safeRoutesPoiCollector");
const { encodePolyline } = require("../services/geo");
const safetyGraphModule = require("../services/safetyGraph");
const {
  routeToPolyline,
  routeSafetyBreakdown,
} = safetyGraphModule;
const {
  buildRouteLightGapSpans,
} = require("../services/lightConfidenceEngine");
const { severityOf } = require("../services/crimeSeverity");
const { rankRoutes, buildReason } = require("../scoring/routeAggregate");
const { RISK_POOR_THRESHOLD } = require("../scoring/config");

const WALKING_SPEED_MPS = 1.35;

// ── v2 scoring output ───────────────────────────────────────────────────────
// v1 output is unchanged. When the v2 model is on, the score, segment colour, reason and
// crime markers follow the definitions below.

/** True when the v2 scoring model is enabled. Missing flag support counts as off. */
function isScoringV2Enabled() {
  return typeof safetyGraphModule.useV2 === "function" && safetyGraphModule.useV2() === true;
}

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
const CRIME_STATUS_UNAVAILABLE = "unavailable";

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
 * Ranks the candidate routes by exposure (v2) and gives each its display id, 1-based, matching the
 * "Route N" summary label. Returns prepared entries in display order plus buildReason candidates.
 */
function rankForDisplay(prepared) {
  const ranked = rankRoutes(
    prepared.map((entry) => ({
      id: entry.index,
      lengthM: Math.max(1, entry.route.totalDist),
      routeRisk: entry.breakdown.routeRisk,
    })),
  );
  const ordered = ranked.map((r) => prepared[r.id]);
  const candidates = ordered.map((entry, position) => ({
    id: position + 1,
    lengthM: Math.max(1, entry.route.totalDist),
    routeRisk: entry.breakdown.routeRisk,
    score: Math.round(100 * (1 - entry.breakdown.routeRisk)),
    worstStretch: entry.breakdown.worstStretch
      ? { lengthM: entry.breakdown.worstStretch.lengthM, cause: entry.breakdown.worstStretch.cause ?? null }
      : null,
  }));
  return { ordered, candidates };
}
const DEFAULT_RESPONSE_POLICY = {
  verbosity: "full",
  poiCaps: {
    cctv: 500,
    transit: 500,
    deadEnds: 500,
    lights: 500,
    places: 500,
    crimes: 500,
  },
};

function normalizeResponsePolicy(responsePolicy) {
  const verbosity = responsePolicy?.verbosity === "compact" ? "compact" : "full";
  const openPlacesOnly = responsePolicy?.openPlacesOnly !== false;
  const mergedPoiCaps = {
    ...DEFAULT_RESPONSE_POLICY.poiCaps,
    ...(responsePolicy?.poiCaps || {}),
  };

  const poiCaps = {};
  for (const [category, value] of Object.entries(mergedPoiCaps)) {
    if (value === Infinity) {
      poiCaps[category] = Infinity;
      continue;
    }

    poiCaps[category] = Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : DEFAULT_RESPONSE_POLICY.poiCaps[category];
  }

  return {
    verbosity,
    openPlacesOnly,
    poiCaps,
  };
}

function distanceSqFromOrigin(point, oLat, oLng) {
  const dLat = point.lat - oLat;
  const dLng = point.lng - oLng;
  return dLat * dLat + dLng * dLng;
}

function buildRouteVertices(routePath, osmNodes) {
  const vertices = [];
  for (const nodeId of routePath || []) {
    const node = osmNodes.get(nodeId);
    if (!node) continue;
    if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) continue;
    vertices.push({ lat: node.lat, lng: node.lng });
  }
  return vertices;
}

function distanceSqToSegment(point, from, to) {
  const segLat = to.lat - from.lat;
  const segLng = to.lng - from.lng;
  const segLenSq = segLat * segLat + segLng * segLng;
  if (segLenSq <= 0) {
    return distanceSqFromOrigin(point, from.lat, from.lng);
  }

  const relLat = point.lat - from.lat;
  const relLng = point.lng - from.lng;
  const projection = (relLat * segLat + relLng * segLng) / segLenSq;
  const clamped = Math.max(0, Math.min(1, projection));
  const nearestLat = from.lat + segLat * clamped;
  const nearestLng = from.lng + segLng * clamped;
  return distanceSqFromOrigin(point, nearestLat, nearestLng);
}

function nearestRouteSegment(point, routeVertices) {
  if (!Array.isArray(routeVertices) || routeVertices.length < 2) {
    return null;
  }

  let segmentIndex = 0;
  let distanceSq = Infinity;

  for (let i = 0; i < routeVertices.length - 1; i++) {
    const from = routeVertices[i];
    const to = routeVertices[i + 1];
    const candidateDistanceSq = distanceSqToSegment(point, from, to);
    if (candidateDistanceSq < distanceSq) {
      distanceSq = candidateDistanceSq;
      segmentIndex = i;
    }
  }

  return { segmentIndex, distanceSq };
}

function limitCategoryPoisByOrigin(points, cap, oLat, oLng) {
  if (!Array.isArray(points)) return [];
  if (cap === Infinity) return points;
  if (!Number.isFinite(cap) || cap < 1) return [];
  if (points.length <= cap) return points;

  return points
    .map((point, index) => ({
      point,
      index,
      distanceSq: distanceSqFromOrigin(point, oLat, oLng),
    }))
    .sort((a, b) => a.distanceSq - b.distanceSq || a.index - b.index)
    .slice(0, cap)
    .map((entry) => entry.point);
}

function limitCategoryPois(points, cap, routeVertices, oLat, oLng) {
  if (!Array.isArray(routeVertices) || routeVertices.length < 2) {
    return limitCategoryPoisByOrigin(points, cap, oLat, oLng);
  }
  if (!Array.isArray(points)) return [];
  if (cap === Infinity) return points;
  if (!Number.isFinite(cap) || cap < 1) return [];
  if (points.length <= cap) return points;

  const segmentBuckets = new Map();
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const nearest = nearestRouteSegment(point, routeVertices);
    const segmentIndex = nearest?.segmentIndex ?? 0;
    if (!segmentBuckets.has(segmentIndex)) {
      segmentBuckets.set(segmentIndex, []);
    }

    segmentBuckets.get(segmentIndex).push({
      point,
      index,
      distanceSq: nearest?.distanceSq ?? Infinity,
      fallbackDistanceSq: distanceSqFromOrigin(point, oLat, oLng),
    });
  }

  const segmentOrder = Array.from(segmentBuckets.keys()).sort((a, b) => a - b);
  for (const bucket of segmentBuckets.values()) {
    bucket.sort(
      (a, b) => (
        a.distanceSq - b.distanceSq ||
        a.fallbackDistanceSq - b.fallbackDistanceSq ||
        a.index - b.index
      ),
    );
  }

  const selected = [];
  let madeProgress = true;

  while (selected.length < cap && madeProgress) {
    madeProgress = false;
    for (const segmentIndex of segmentOrder) {
      const bucket = segmentBuckets.get(segmentIndex);
      if (!bucket?.length) continue;
      selected.push(bucket.shift().point);
      madeProgress = true;
      if (selected.length >= cap) break;
    }
  }

  return selected;
}

function limitRoutePois(routePOIs, poiCaps, routeVertices, oLat, oLng) {
  return {
    cctv: limitCategoryPois(routePOIs?.cctv, poiCaps.cctv, routeVertices, oLat, oLng),
    transit: limitCategoryPois(routePOIs?.transit, poiCaps.transit, routeVertices, oLat, oLng),
    deadEnds: limitCategoryPois(routePOIs?.deadEnds, poiCaps.deadEnds, routeVertices, oLat, oLng),
    lights: limitCategoryPois(routePOIs?.lights, poiCaps.lights, routeVertices, oLat, oLng),
    places: limitCategoryPois(routePOIs?.places, poiCaps.places, routeVertices, oLat, oLng),
    crimes: limitCategoryPois(routePOIs?.crimes, poiCaps.crimes, routeVertices, oLat, oLng),
  };
}

function applyLightingOverride(label, color, score100, lightingPct) {
  if (!Number.isFinite(lightingPct)) {
    return { label, color };
  }

  if (lightingPct <= 20 && score100 >= 55) {
    return { label: "Use Caution", color: "#C62828" };
  }

  if (lightingPct <= 35 && score100 >= 75) {
    return { label: "Moderate", color: "#F9A825" };
  }

  return { label, color };
}

function buildUncertaintyBoxes(route, edges, osmNodes, edgeConfidences) {
  const boxes = [];
  const bufferDeg = 30 / 111320;
  for (const edgeIdx of route.edges || []) {
    const conf = edgeConfidences?.[edgeIdx];
    if (!conf?.needsVerification) continue;
    const edge = edges?.[edgeIdx];
    if (!edge) continue;
    const from = osmNodes.get(edge.from);
    const to = osmNodes.get(edge.to);
    if (!from || !to) continue;
    boxes.push({
      south: Math.min(from.lat, to.lat) - bufferDeg,
      west: Math.min(from.lng, to.lng) - bufferDeg,
      north: Math.max(from.lat, to.lat) + bufferDeg,
      east: Math.max(from.lng, to.lng) + bufferDeg,
    });
  }
  return boxes;
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

function buildGeneralUncertaintyBoxes(route, edges, osmNodes, edgeConfidences) {
  const boxes = [];
  const routeEdges = route.edges || [];
  const sparseHighways = new Set(['footway', 'path', 'steps', 'track', 'cycleway']);
  let current = null;

  const isSparseContext = (edge) => {
    if (!edge) return false;
    const nearbyContext = (edge.nearbyTransitCount || 0) + (edge.nearbyCctvCount || 0);
    const placeScore = Number(edge.placeScore || 0);
    const trafficScore = Number(edge.trafficScore || 0);
    const roadName = String(edge.roadName || '');
    return (
      nearbyContext === 0 &&
      placeScore < 0.15 &&
      trafficScore < 0.35 &&
      sparseHighways.has(edge.highway) &&
      roadName.length === 0
    );
  };

  const flush = () => {
    if (!current) return;
    if (!Number.isFinite(current.minLat)) {
      current = null;
      return;
    }
    const bufferDeg = 30 / 111320;
    boxes.push({
      south: current.minLat - bufferDeg,
      west: current.minLng - bufferDeg,
      north: current.maxLat + bufferDeg,
      east: current.maxLng + bufferDeg,
      reason: 'sparse_context',
      edgeCount: current.edgeCount,
      distance: Math.round(current.distance),
      confidence: Math.round((current.confidence ?? 0) * 100) / 100,
    });
    current = null;
  };

  for (const edgeIdx of routeEdges) {
    const conf = edgeConfidences?.[edgeIdx];
    const edge = edges?.[edgeIdx];
    if (!edge || !conf) {
      flush();
      continue;
    }

    const isLightIssue = conf.needsVerification || conf.reason === 'explicit_lit_no';
    if (isLightIssue || !isSparseContext(edge)) {
      flush();
      continue;
    }

    const from = osmNodes.get(edge.from);
    const to = osmNodes.get(edge.to);
    if (!from || !to) {
      flush();
      continue;
    }

    if (!current) {
      current = {
        minLat: Infinity,
        minLng: Infinity,
        maxLat: -Infinity,
        maxLng: -Infinity,
        edgeCount: 0,
        distance: 0,
        confidence: 1,
      };
    }

    current.minLat = Math.min(current.minLat, from.lat, to.lat);
    current.minLng = Math.min(current.minLng, from.lng, to.lng);
    current.maxLat = Math.max(current.maxLat, from.lat, to.lat);
    current.maxLng = Math.max(current.maxLng, from.lng, to.lng);
    current.edgeCount += 1;
    current.distance += edge.distance || 0;
    current.confidence = Math.min(current.confidence, Number.isFinite(conf.score) ? conf.score : 1);
  }

  flush();
  return boxes;
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
  uncertaintyBoxes,
  lightUncertaintySpans,
  generalUncertaintyBoxes,
  safetyV2 = {},
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
      breakdown: {
        roadType: Math.round(breakdown.roadType * 100),
        lighting: Math.round(breakdown.lighting * 100),
        crime: Math.round(breakdown.crime * 100),
        cctv: Math.round(breakdown.cctv * 100),
        openPlaces: Math.round(breakdown.openPlaces * 100),
        traffic: Math.round(breakdown.traffic * 100),
      },
      ...safetyV2,
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
    generalUncertaintyBoxes,
    uncertaintyBoxes,
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

function buildRouteResponses({
  rawRoutes,
  osmNodes,
  edges,
  weights,
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
  crimeStatus = CRIME_STATUS_UNAVAILABLE,
}) {
  const normalizedResponsePolicy = normalizeResponsePolicy(responsePolicy);
  const lightNodes = collectLightNodes(allData?.lights?.elements);
  const placeNodes = collectOpenPlaceNodes(
    allData?.places?.elements,
    enableOpeningHoursParse,
    normalizedResponsePolicy.openPlacesOnly,
  );

  // v2 ranks by exposure before anything is formatted, so index 0 is the recommended route.
  const v2 = isScoringV2Enabled();
  const prepared = rawRoutes.map((route, index) => ({
    index,
    route,
    breakdown: routeSafetyBreakdown(edges, route.edges, weights, edgeConfidences),
  }));
  const { ordered, candidates } = v2
    ? rankForDisplay(prepared)
    : { ordered: prepared, candidates: null };

  const routes = ordered.map(({ route, breakdown }, idx) => {
    const polyline = routeToPolyline(osmNodes, route.path);
    let score100;
    let label;
    let color;
    if (v2) {
      score100 = Math.round(100 * (1 - breakdown.routeRisk));
      ({ label, color } = safetyLabel(score100));
    } else {
      score100 = Math.round(breakdown.overall * 100);
      const lightingPct = Math.round((breakdown.lighting || 0) * 100);
      const baseLabel = safetyLabel(score100);
      ({ label, color } = applyLightingOverride(
        baseLabel.label,
        baseLabel.color,
        score100,
        lightingPct,
      ));
    }
    const durationSec = Math.round(route.totalDist / WALKING_SPEED_MPS);
    const detourRatio = straightLineDist > 0 ? route.totalDist / straightLineDist : 0;

    const segments = [];
    let deadEndCount = 0;
    let sidewalkDist = 0;
    let unpavedDist = 0;
    let transitStopCount = 0;
    let cctvNearCount = 0;
    const roadNameChanges = [];
    let lastRoadName = "";
    let cumulativeDist = 0;
    let verifiedLengthM = 0;
    let totalLengthM = 0;

    for (let i = 0; i < route.edges.length; i++) {
      const edge = edges[route.edges[i]];
      const nodeA = osmNodes.get(route.path[i]);
      const nodeB = osmNodes.get(route.path[i + 1]);
      if (!nodeA || !nodeB) continue;

      if (edge.isDeadEnd) deadEndCount++;
      if (edge.hasSidewalk) sidewalkDist += edge.distance;
      if (edge.surfacePenalty > 0) unpavedDist += edge.distance;
      transitStopCount += edge.nearbyTransitCount;
      cctvNearCount += edge.nearbyCctvCount;

      const roadName = edge.roadName || "";
      if (roadName && roadName !== lastRoadName) {
        roadNameChanges.push({
          segmentIndex: i,
          name: roadName,
          distance: Math.round(cumulativeDist),
        });
        lastRoadName = roadName;
      }
      cumulativeDist += edge.distance;

      const lengthM = edgeLengthM(edge);
      totalLengthM += lengthM;
      if (edge.litEstimate === "lit" || edge.litEstimate === "unlit") {
        verifiedLengthM += lengthM;
      }

      const edgeColor = v2
        ? riskToRampColor(edge.risk)
        : edge.lightScore <= 0.2
          ? "#C62828"
          : edge.lightScore <= 0.35
            ? "#F9A825"
            : segmentColor(edge.safetyScore);

      segments.push({
        start: { lat: nodeA.lat, lng: nodeA.lng },
        end: { lat: nodeB.lat, lng: nodeB.lng },
        safetyScore: edge.safetyScore,
        color: edgeColor,
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
        ...(v2
          ? {
              risk: edge.risk,
              litEstimate: edge.litEstimate ?? null,
              certainty: edge.certainty ?? null,
              cause: edge.cause ?? null,
            }
          : {}),
      });
    }

    const lightingQuality = lightingQualityFor(
      totalLengthM > 0 ? verifiedLengthM / totalLengthM : NaN,
    );
    // v2: a high-risk edge on the route. v1 keeps its original (inverted-name) rule.
    const cautionFlag = v2
      ? breakdown.riskVector && breakdown.riskVector.max >= RISK_POOR_THRESHOLD
        ? CAUTION_TEXT
        : null
      : breakdown.riskVector && breakdown.riskVector.max < 0.2 && breakdown.riskVector.uncertainty > 0.15
        ? CAUTION_TEXT
        : null;

    const routePOIs = collectRoutePOIs(
      route.path,
      osmNodes,
      cctvNodes,
      transitNodes,
      nodeDegree,
      lightNodes,
      placeNodes,
      crimes,
    );
    const routeVertices = buildRouteVertices(route.path, osmNodes);
    const limitedRoutePOIs = limitRoutePois(
      routePOIs,
      normalizedResponsePolicy.poiCaps,
      routeVertices,
      oLat,
      oLng,
    );
    if (v2) {
      // Crime markers are clustered server-side; the true total goes to routeStats.crimeCount.
      limitedRoutePOIs.crimes = clusterCrimes(routePOIs.crimes, {
        cap: Math.min(normalizedResponsePolicy.poiCaps.crimes, CRIME_CLUSTER_CAP),
      });
    }
    // v2 draws uncertainty as dashed lines on the segments, so the boxes are not emitted.
    const uncertaintyBoxes = v2
      ? []
      : buildUncertaintyBoxes(route, edges, osmNodes, edgeConfidences);
    const lightUncertaintySpans = buildLightUncertaintySpans(
      route,
      edges,
      osmNodes,
      edgeConfidences,
    );
    const generalUncertaintyBoxes = v2
      ? []
      : buildGeneralUncertaintyBoxes(route, edges, osmNodes, edgeConfidences);

    const safetyV2 = v2
      ? {
          certainty: Number.isFinite(breakdown.certainty) ? round2(breakdown.certainty) : null,
          reason: buildReason(candidates[idx], candidates),
          worstStretch: formatWorstStretch(breakdown.worstStretch),
          dataQuality: {
            crime: crimeStatus,
            lighting: lightingQuality,
          },
        }
      : {};

    const routeStats = {
      deadEnds: deadEndCount,
      sidewalkPct:
        route.totalDist > 0
          ? Math.round((sidewalkDist / route.totalDist) * 100)
          : 0,
      unpavedPct:
        route.totalDist > 0
          ? Math.round((unpavedDist / route.totalDist) * 100)
          : 0,
      transitStopsNearby: Math.min(transitStopCount, 50),
      cctvCamerasNearby: Math.min(cctvNearCount, 50),
      roadNameChanges,
      ...(v2 ? { crimeCount: (routePOIs.crimes || []).length } : {}),
    };

    const fullRoutePayload = {
      routeIndex: idx,
      isSafest: idx === 0,
      overview_polyline: { points: encodePolyline(polyline) },
      legs: [
        {
          distance: {
            text:
              route.totalDist >= 1000
                ? `${(route.totalDist / 1000).toFixed(1)} km`
                : `${Math.round(route.totalDist)} m`,
            value: Math.round(route.totalDist),
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
        },
      ],
      summary: idx === 0 ? "Safest Route" : `Route ${idx + 1}`,
      safety: {
        score: score100,
        label,
        color,
        breakdown: {
          roadType: Math.round(breakdown.roadType * 100),
          lighting: Math.round(breakdown.lighting * 100),
          crime: Math.round(breakdown.crime * 100),
          cctv: Math.round(breakdown.cctv * 100),
          openPlaces: Math.round(breakdown.openPlaces * 100),
          traffic: Math.round(breakdown.traffic * 100),
        },
        roadTypes: breakdown.roadTypes,
        mainRoadRatio: Math.round(breakdown.mainRoadRatio * 100),
        riskVector: breakdown.riskVector
          ? {
              mean: Math.round(breakdown.riskVector.mean * 100) / 100,
              p95: Math.round(breakdown.riskVector.p95 * 100) / 100,
              max: Math.round(breakdown.riskVector.max * 100) / 100,
              uncertainty: Math.round(breakdown.riskVector.uncertainty * 100) / 100,
              detourRatio: Math.round(detourRatio * 100) / 100,
            }
          : null,
        caution: cautionFlag,
        ...safetyV2,
      },
      segments,
      routeStats,
      routePOIs: limitedRoutePOIs,
      queryFootprints: verificationFootprints,
      lightUncertaintySpans,
      generalUncertaintyBoxes,
      uncertaintyBoxes,
    };

    if (normalizedResponsePolicy.verbosity === "compact") {
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
        queryFootprints: verificationFootprints,
        lightUncertaintySpans,
        generalUncertaintyBoxes,
        uncertaintyBoxes,
        safetyV2,
      });
    }

    return fullRoutePayload;
  });

  const minRoutes = Math.min(3, rawRoutes.length);
  return routes.slice(0, Math.max(minRoutes, routes.length));
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
  isScoringV2Enabled,
  clusterCrimes,
  lightingQualityFor,
  riskToRampColor,
};
