/**
 * Lighting factor: the inputs buildGraph feeds to inferLighting (lamps, lit-way vertices, area lamp density,
 * road proximity of footways), the lights-cache override, and the lit estimate label.
 */
const { buildSpatialGrid, countNearby } = require('../geo');
const { scoreFromCache } = require('../lightsCacheClient');
const {
  inferLighting, effectiveLit, SIDEWALK_LIKE_HIGHWAYS,
} = require('../../scoring/lightingInference');
const { buildRoadProximityIndex, isNearRoad, ROAD_HIGHWAYS } = require('../../scoring/roadProximity');
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
 * Lazy road-proximity index for footway-like ways: segments of trunk..service roads, sampled into a grid, built
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

/**
 * Lighting for one segment: lamps within LAMP_RADIUS_M, a lit=yes way vertex within LAMP_RADIUS_M (a tag, not a
 * lamp: weaker evidence), for footway-like ways whether a road is within reach (sidewalk or isolated), then the
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
  const nearRoad = SIDEWALK_LIKE_HIGHWAYS.has(highway) ? isNearRoad(context.roadIndex(), midLat, midLng) : undefined;
  const lampCountNearPath = countNearby(sources.lampGrid, midLat, midLng, LAMP_NEAR_PATH_M);
  const area = context.areaStats.get(areaCellKey(midLat, midLng));
  const areaWayKm = area.wayKm;
  const areaLampDensityPerKm = areaWayKm > 0 ? area.lamps / areaWayKm : 0;

  const inferred = inferLighting({
    tags, lampCount30m, areaLampDensityPerKm, areaWayKm, nearRoad, litNeighbour,
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
  applyLightsCache,
  litEstimateOf,
  lightingAt,
};
