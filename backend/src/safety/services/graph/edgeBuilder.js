/**
 * buildGraph: the walking graph with edge risk (spec section 11).
 *
 * Named stages: index the OSM nodes, collect lamps and activity sources, collect the walkable segments (geometry
 * only) with area and crime-cell aggregates, then score every segment from the five factors (lighting, crime,
 * road, activity, isolation) and combine them with edgeRisk. Crime outage leaves the crime factor unknown.
 */
const { edgeRisk } = require('../../scoring/edgeRisk');
const {
  PRIOR_SAFETY, GRAPH, PATH_CLASS_HIGHWAYS, ROAD_TYPE_SCORES, ROAD_SCORE_FALLBACK, SURFACE_PENALTIES,
} = require('../../scoring/config');
const { cancelCallbackOf, createTicker, clamp01, hasOwnKey } = require('./common');
const { resolveBuildClock } = require('./clock');
const { getWeights } = require('../../scoring/weights');
const {
  indexNodes, buildNodeGrid, computeNodeDegree, collectWalkableSegments, collectBarrierSegments,
} = require('./osmIndex');
const {
  collectLightSources, buildAreaStats, createRoadIndexGetter, createWayContextGetter, lightingAt,
} = require('./lightingStage');
const { collectActivitySources, activityAt } = require('./activityStage');
const { buildCrimeModel, crimeFactorAt } = require('./crimeStage');
const {
  isDeadEnd, isUnlitPath, isolationSafetyOf, createRemotenessLookup, remotenessMultiplier,
} = require('./isolationStage');

// Share of safety the remoteness hazard must remove before it is named as the cause of an edge's risk.
const REMOTENESS_CAUSE_MIN_LOSS = 0.15;

/**
 * Road factor: the class score minus the surface penalty, in [0, 1]. Class only: dead ends and footpath
 * effects belong to isolation.
 * @param {string} highway
 * @param {object} tags
 * @returns {{roadSafety: number, surfacePenalty: number}}
 */
function roadFactorOf(highway, tags) {
  const surfacePenalty = hasOwnKey(SURFACE_PENALTIES, tags.surface) ? SURFACE_PENALTIES[tags.surface] : 0;
  const roadSafety = clamp01((ROAD_TYPE_SCORES[highway] || ROAD_SCORE_FALLBACK) - surfacePenalty);
  return { roadSafety, surfacePenalty };
}

/**
 * Scores one segment into an edge: the five factors, their combination, and the legacy per-factor fields the
 * response formatter and the frontend read.
 * @param {object} segment From collectWalkableSegments.
 * @param {object} ctx Build context from prepareContext.
 * @param {object|null} cache Lights-cache record for this edge.
 * @returns {object} The edge.
 */
function scoreSegment(segment, ctx, cache) {
  const { idx, from, to, nA, nB, dist, highway, tags, midLat, midLng } = segment;
  const light = lightingAt(segment, ctx.lightSources, ctx, cache);
  const { roadSafety, surfacePenalty } = roadFactorOf(highway, tags);
  const remote = ctx.remotenessAt(midLat, midLng, !PATH_CLASS_HIGHWAYS.has(highway));
  const act = activityAt(ctx.activitySources, midLat, midLng, ctx.hour, { darkness: ctx.darkness, remoteness: remote.remoteness });
  const deadEnd = isDeadEnd(ctx.nodeDegree, from, to);
  const unlitPath = isUnlitPath(highway, tags, light.lampCountNearPath, light.nearRoad);
  // Footfall: presence discounts non-violent crime; cameras and open places within 80 m give the guardian bonus.
  const crimeFactor = crimeFactorAt(ctx.crimeModel, midLat, midLng, ctx.crimeStatus, {
    presence: act.presence, cctvCount: act.cctvCount, openVenues: act.placesOpen,
  });

  // Daylight is the best lighting there is: the lighting safety blends towards 1 as the sun comes up (darkness 0 gives
  // 1, darkness 1 gives the estimate), and the lighting factor keeps its full weight. The older scheme (lighting weight
  // scaled to 0 by day, the rest renormalised) made a lit street blend WORSE by day than at night, because its good
  // lighting score no longer pulled the mean up, and made lamps matter by day through certainty. Now darkness can only
  // add hazard, and by day every street has the same lighting (so lamps make no difference). Certainty describes how
  // well we know the street, not the time, and uses the same full weights.
  const lightingSafety = ctx.darkness * light.lightingSafety + (1 - ctx.darkness);
  const combined = edgeRisk({
    factors: {
      lighting: { safety: lightingSafety, n: light.lighting.n },
      crime: crimeFactor,
      road: { safety: roadSafety, n: GRAPH.ROAD_N },
      activity: act.activity,
      isolation: { safety: isolationSafetyOf(deadEnd, unlitPath), n: GRAPH.ISOLATION_N },
    },
    weights: ctx.blendWeights,
  });
  // Night remoteness hazard (spec section 12): multiplies the combined safety. The isolation factor alone carries
  // weight 0.12, too little to make a lit but empty park path read Moderate.
  const hazardFactor = remotenessMultiplier({
    remoteness: remote.remoteness, presence: act.presence, darkness: ctx.darkness, lightingEffective: light.lightingSafety,
  });
  const risk = 1 - (1 - combined.risk) * hazardFactor;
  const { certainty } = combined;
  const dominantCause = 1 - hazardFactor >= REMOTENESS_CAUSE_MIN_LOSS ? 'isolation' : combined.dominantCause;

  const litTag = tags.lit || null;
  return {
    idx,
    from,
    to,
    distance: dist,
    highway,
    safetyScore: 1 - risk,
    roadScore: roadSafety,
    lightScore: light.lightingSafety,
    // During a crime-data outage the factor is unknown (null) and takes the flat neutral prior PRIOR_SAFETY.crime
    // (0.6, n = 0), NOT the area prior rate. Deliberate and fail-safe: with the data down we claim nothing about this
    // area, so every street gets the same cautious value instead of a locally flattering or alarming one.
    crimeScore: crimeFactor.safety ?? PRIOR_SAFETY.crime,
    cctvScore: act.cctvScore,
    placeScore: act.placeScore,
    trafficScore: act.activitySafety === null ? roadSafety : (roadSafety + act.activitySafety) / 2,
    penalty: 0,
    hasSidewalk: !!(tags.sidewalk && tags.sidewalk !== 'no'),
    surfaceType: tags.surface || 'paved',
    roadName: tags.name || '',
    nearbyCctvCount: act.cctvCount,
    nearbyTransitCount: act.transitCount,
    surfacePenalty,
    maxspeed: tags.maxspeed || '',
    isTunnel: tags.tunnel === 'yes',
    isLit: litTag === 'yes',
    litTag,
    isDeadEnd: deadEnd,
    risk,
    certainty,
    cause: dominantCause,
    remoteness: remote.remoteness,
    presence: act.presence,
    litEstimate: light.litEstimate,
    pLit: light.lighting.pLit,
    lengthM: dist,
    start: { lat: nA.lat, lng: nA.lng },
    end: { lat: nB.lat, lng: nB.lng },
  };
}

/**
 * Everything the per-edge scoring reads, gathered in dependency order.
 * @returns {object} Context with osmNodes, nodeGrid, nodeDegree, segments, light and activity sources, area
 *   stats, crime model, road index getter, weights, hour, darkness and crimeStatus.
 */
function prepareContext(roadData, lightData, cctvData, placeData, transitData, crimes, bbox, options, tick) {
  const clock = resolveBuildClock(bbox, options);
  const osmNodes = indexNodes(roadData, tick);
  const lightSources = collectLightSources(lightData, osmNodes, tick);
  const activitySources = collectActivitySources(
    cctvData, placeData, transitData, { ...clock, settlementClassAt: options.settlementClassAt }, tick,
  );
  const nodeGrid = buildNodeGrid(osmNodes, tick);
  const nodeDegree = computeNodeDegree(roadData, osmNodes, tick);
  const segments = collectWalkableSegments(roadData, osmNodes, tick);
  const { areaStats, totalWayKm } = buildAreaStats(lightSources.lamps, segments);
  const crimeModel = buildCrimeModel(crimes, bbox, segments, totalWayKm, tick);
  const roadIndex = createRoadIndexGetter(segments);
  const barrierSegments = collectBarrierSegments(roadData, osmNodes, tick);
  return {
    ...clock,
    blendWeights: getWeights({ darkness: 1, safetyLevel: options.level }),
    osmNodes,
    nodeGrid,
    nodeDegree,
    segments,
    lightSources,
    activitySources,
    areaStats,
    crimeModel,
    roadIndex,
    remotenessAt: createRemotenessLookup(segments, activitySources.openPlaces),
    wayContext: createWayContextGetter(segments, barrierSegments, roadIndex),
  };
}

/**
 * Scores every segment and links the edges into a bidirectional adjacency map.
 * @returns {{edges: Array<object>, adjacency: Map<number, Array<{edgeIdx: number, neighborId: number}>>}}
 */
function scoreSegments(ctx, options, tick) {
  const edges = [];
  const adjacency = new Map();
  for (const segment of ctx.segments) {
    tick();
    const cache = options.lightsCacheByEdgeIdx?.get(segment.idx) || null;
    edges.push(scoreSegment(segment, ctx, cache));
    const { idx: edgeIdx, from, to } = segment;
    if (!adjacency.has(from)) adjacency.set(from, []);
    if (!adjacency.has(to)) adjacency.set(to, []);
    adjacency.get(from).push({ edgeIdx, neighborId: to });
    adjacency.get(to).push({ edgeIdx, neighborId: from });
  }
  return { edges, adjacency };
}

/**
 * Build the walking graph with edge risk.
 *
 * @param {{elements: Array<object>}} roadData Overpass-style nodes and highway ways.
 * @param {{elements: Array<object>}|null} lightData Street lamps and lit ways.
 * @param {{elements: Array<object>}|null} cctvData Surveillance cameras.
 * @param {{elements: Array<object>}|null} placeData Places (shops, amenities).
 * @param {{elements: Array<object>}|null} transitData Transit stops.
 * @param {Array<object>} crimes Crime rows with lat, lng, category, month.
 * @param {{north: number, south: number, east: number, west: number}} bbox
 * @param {object} [options]
 * @param {number} [options.hour] London local hour 0-24; defaults to the London hour of options.now.
 * @param {(lat: number, lng: number) => {class: string}} [options.settlementClassAt] Settlement lookup (default: scoring/settlements).
 * @param {Date} [options.now] Instant used for darkness and opening hours; defaults to the current time.
 * @param {string} [options.level] Data level; 'standard' drops the activity factor.
 * @param {'ok'|'unavailable'} [options.crimeStatus] Anything other than 'ok', including a missing value, is treated as unavailable.
 * @param {Map<number, object>} [options.lightsCacheByEdgeIdx] Lights-cache records by edge index.
 * @param {() => boolean} [options.shouldCancel] Cancellation check, polled during long loops.
 * @returns {Promise<object>} osmNodes, edges, adjacency, nodeGrid, weights, cctvNodes, transitNodes, nodeDegree
 *   and darkness.
 */
async function buildGraph(roadData, lightData, cctvData, placeData, transitData, crimes, bbox, options = {}) {
  const tick = createTicker(cancelCallbackOf(options));
  const ctx = prepareContext(roadData, lightData, cctvData, placeData, transitData, crimes, bbox, options, tick);
  const { edges, adjacency } = scoreSegments(ctx, options, tick);
  return {
    osmNodes: ctx.osmNodes,
    edges,
    adjacency,
    nodeGrid: ctx.nodeGrid,
    // The darkness-scaled weights of the clock (reported only: the blend uses ctx.blendWeights, see scoreSegment).
    weights: ctx.weights,
    cctvNodes: ctx.activitySources.cctvNodes,
    transitNodes: ctx.activitySources.transitNodes,
    nodeDegree: ctx.nodeDegree,
    darkness: ctx.darkness,
  };
}

module.exports = { buildGraph, roadFactorOf, scoreSegment, prepareContext, scoreSegments };
