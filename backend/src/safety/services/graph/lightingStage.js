/**
 * Lighting factor: the inputs buildGraph feeds to inferLighting (lamps, lit-way vertices, area lamp density,
 * road proximity of footways), the lights-cache override, and the lit estimate label.
 */
const { buildSpatialGrid, countNearby } = require('../geo');
const { scoreFromCache } = require('../lightsCacheClient');
const {
  inferLighting, effectiveLit, SIDEWALK_LIKE_HIGHWAYS,
} = require('../../scoring/lightingInference');
const {
  buildRoadProximityIndex, isNearRoad, classifyWayContext, ROAD_HIGHWAYS,
} = require('../../scoring/roadProximity');
const { GRAPH, LAMP_RADIUS_M, LAMP_NEAR_PATH_M } = require('../../scoring/config');

/**
 * Street lamps and the vertices of lit=yes ways, with spatial grids.
 * @param {{elements: Array<object>}|null} lightData
 * @param {Map<number, {lat: number, lng: number}>} osmNodes
 * @param {() => void} tick
 * @returns {{lamps: Array<{lat: number, lng: number}>, lampGrid: object, litGrid: object}}
 */
function collectLightSources(lightData, osmNodes, tick) {
  const lamps = [];
  const litWayPositions = [];
  for (const el of lightData?.elements || []) {
    tick();
    if (el.type === 'node' && el.tags?.highway === 'street_lamp') lamps.push({ lat: el.lat, lng: el.lon });
    if (el.type === 'way' && el.tags?.lit === 'yes' && el.nodes) {
      for (const nid of el.nodes) {
        const n = osmNodes.get(nid);
        if (n) litWayPositions.push({ lat: n.lat, lng: n.lng });
      }
    }
  }
  return { lamps, lampGrid: buildSpatialGrid(lamps), litGrid: buildSpatialGrid(litWayPositions) };
}

/** Area cell key (about 300 m) used for lamp density and road length. */
function areaCellKey(lat, lng) {
  return `${Math.floor(lat / GRAPH.AREA_CELL_DEG)},${Math.floor(lng / GRAPH.AREA_CELL_DEG)}`;
}

/**
 * Per-area lamp counts and mapped road length (km), and the total road length.
 * @param {Array<{lat: number, lng: number}>} lamps
 * @param {Array<{dist: number, midLat: number, midLng: number}>} segments
 * @returns {{areaStats: Map<string, {lamps: number, wayKm: number}>, totalWayKm: number}}
 */
function buildAreaStats(lamps, segments) {
  const areaStats = new Map();
  const areaAt = (key) => {
    let stats = areaStats.get(key);
    if (!stats) {
      stats = { lamps: 0, wayKm: 0 };
      areaStats.set(key, stats);
    }
    return stats;
  };
  for (const lamp of lamps) areaAt(areaCellKey(lamp.lat, lamp.lng)).lamps += 1;
  let totalWayKm = 0;
  for (const p of segments) {
    const km = p.dist / 1000;
    totalWayKm += km;
    areaAt(areaCellKey(p.midLat, p.midLng)).wayKm += km;
  }
  return { areaStats, totalWayKm };
}

/**
 * Lazy road-proximity index for footway-like ways: segments of primary..service roads (trunk and motorway are barriers), sampled into a grid, built
 * on first use, so each lookup is a few cells (no scan of every road per footway).
 * @param {Array<{highway: string, nA: object, nB: object}>} segments
 * @returns {() => object}
 */
function createRoadIndexGetter(segments) {
  let index = null;
  return () => {
    if (!index) {
      index = buildRoadProximityIndex(
        segments.filter((p) => ROAD_HIGHWAYS.has(p.highway))
          .map((p) => ({ aLat: p.nA.lat, aLng: p.nA.lng, bLat: p.nB.lat, bLng: p.nB.lng })),
      );
    }
    return index;
  };
}

/**
 * Way-level context of footway-like ways: 'alongside' a street, 'crossing' a motorway/trunk, or 'isolated'. Decided
 * from ALL segments of the OSM way (segment.wayId), once per way and cached, so every edge of a way gets the same
 * answer and a bridge over a trunk road is not a sidewalk because one sample sits near a road.
 * @param {Array<{wayId?: number, idx: number, highway: string, nA: object, nB: object}>} segments
 * @param {Array<{aLat: number, aLng: number, bLat: number, bLng: number}>} barrierSegments Motorway/trunk geometry.
 * @param {() => object} roadIndex Lazy qualifying-street index (createRoadIndexGetter).
 * @returns {(segment: object) => 'alongside'|'crossing'|'isolated'}
 */
function createWayContextGetter(segments, barrierSegments, roadIndex) {
  let byWay = null;
  let barrierIndex = null;
  const cache = new Map();
  const keyOf = (segment) => (segment.wayId === undefined ? `segment:${segment.idx}` : segment.wayId);
  return (segment) => {
    const key = keyOf(segment);
    if (cache.has(key)) return cache.get(key);
    if (!byWay) {
      byWay = new Map();
      for (const p of segments) {
        if (!SIDEWALK_LIKE_HIGHWAYS.has(p.highway)) continue;
        const k = keyOf(p);
        if (!byWay.has(k)) byWay.set(k, []);
        byWay.get(k).push({ a: p.nA, b: p.nB });
      }
    }
    if (!barrierIndex) barrierIndex = buildRoadProximityIndex(barrierSegments);
    const context = classifyWayContext(byWay.get(key) || [{ a: segment.nA, b: segment.nB }], roadIndex(), barrierIndex);
    cache.set(key, context);
    return context;
  };
}

/**
 * Applies a lights-cache record to the inferred lighting. A verified unlit record beats everything, an
 * explicit lit tag beats the rest, a verified lit record beats an inference, and an unverified record feeds
 * the estimate with modest evidence.
 * @param {{pLit: number, n: number, source: string}} inferred
 * @param {{lit_status?: string, confidence?: number}|null} cache
 * @returns {{pLit: number, n: number, source: string}}
 */
function applyLightsCache(inferred, cache) {
  const confidence = cache?.confidence || 0;
  const verified = (status) => cache?.lit_status === status && confidence >= GRAPH.CACHE_VERIFIED_CONFIDENCE;
  if (verified('unlit')) return { ...GRAPH.CACHE_VERIFIED_UNLIT, source: 'cache' };
  if (inferred.source === 'tag') return inferred; // explicit lit tag is ground truth
  if (verified('lit')) return { ...GRAPH.CACHE_VERIFIED_LIT, source: 'cache' };
  const cached = cache ? scoreFromCache(cache) : null;
  return cached ? { pLit: cached.score, n: GRAPH.CACHE_LIGHT_N, source: 'cache' } : inferred;
}

/** Edge lit estimate label. Only tags and lamps count as 'lit', only tags and cache as 'unlit'. */
function litEstimateOf(source, effective) {
  if ((source === 'tag' || source === 'lamp') && effective >= 0.7) return 'lit';
  if ((source === 'tag' || source === 'cache') && effective <= 0.2) return 'unlit';
  return effective >= 0.5 ? 'estimated_lit' : 'estimated_unlit';
}

/** Way-level context when the context provides it, else the legacy midpoint test (unit tests build bare contexts). */
function wayContextOf(segment, context) {
  if (context.wayContext) return context.wayContext(segment);
  return isNearRoad(context.roadIndex(), segment.midLat, segment.midLng) ? 'alongside' : 'isolated';
}

/**
 * Lighting for one segment: lamps within LAMP_RADIUS_M, a lit=yes way vertex within LAMP_RADIUS_M (a tag, not a
 * lamp: weaker evidence), for footway-like ways whether the way runs along a street, crosses a trunk road or is isolated (way level), then the
 * estimate. Also returns nearRoad and the lamp count within LAMP_NEAR_PATH_M, which the isolation factor needs.
 * @param {object} segment From collectWalkableSegments.
 * @param {{lampGrid: object, litGrid: object}} sources
 * @param {{areaStats: Map, roadIndex: () => object}} context
 * @param {object|null} cache Lights-cache record for this edge.
 * @returns {{lighting: object, lightingSafety: number, litEstimate: string, nearRoad: boolean|undefined,
 *   lampCountNearPath: number}}
 */
function lightingAt(segment, sources, context, cache) {
  const { midLat, midLng, highway, tags } = segment;
  const litNeighbour = countNearby(sources.litGrid, midLat, midLng, LAMP_RADIUS_M) > 0;
  const lampCount30m = countNearby(sources.lampGrid, midLat, midLng, LAMP_RADIUS_M);
  const wayContext = SIDEWALK_LIKE_HIGHWAYS.has(highway) ? wayContextOf(segment, context) : undefined;
  const nearRoad = wayContext === undefined ? undefined : wayContext === 'alongside';
  const crossing = wayContext === 'crossing';
  const lampCountNearPath = countNearby(sources.lampGrid, midLat, midLng, LAMP_NEAR_PATH_M);
  const area = context.areaStats.get(areaCellKey(midLat, midLng));
  const areaWayKm = area.wayKm;
  const areaLampDensityPerKm = areaWayKm > 0 ? area.lamps / areaWayKm : 0;

  const inferred = inferLighting({
    tags, lampCount30m, areaLampDensityPerKm, areaWayKm, nearRoad, litNeighbour, crossing,
  });
  const lighting = applyLightsCache(inferred, cache);
  const lightingSafety = effectiveLit(lighting);
  return {
    lighting,
    lightingSafety,
    litEstimate: litEstimateOf(lighting.source, lightingSafety),
    nearRoad,
    lampCountNearPath,
  };
}

module.exports = {
  collectLightSources,
  areaCellKey,
  buildAreaStats,
  createRoadIndexGetter,
  createWayContextGetter,
  applyLightsCache,
  litEstimateOf,
  lightingAt,
};
