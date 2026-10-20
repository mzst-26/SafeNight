/**
 * features.js — Lighting features for one way, computed the way safetyGraph's buildGraph does.
 *
 * Replicated here (not imported) because the graph builder scores a whole network, not one way:
 *   - segments: consecutive vertex pairs, raised to 0.5 m when shorter (GRAPH.MIN_EDGE_LENGTH_M: never dropped)
 *   - area cells: 0.003 deg, keyed by segment midpoint (GRAPH.AREA_CELL_DEG)
 *   - lampCount30m = lamps within LAMP_RADIUS_M; litNeighbour = a lit=yes way vertex within it (separate, weaker
 *     evidence since LI; before LI such a vertex was added to the lamp count)
 *   - nearRoad = a trunk..service road within SIDEWALK_RADIUS_M of the segment midpoint (footway-like ways only matter)
 * The pure geometry helpers (fastDistance, buildSpatialGrid, countNearby, isNearRoad) and the lighting model
 * (inferLighting, effectiveLit, LAMP_RADIUS_M) are imported read-only from src/safety/.
 * safetyGraph.parity.test.js checks the replica against buildGraph on synthetic data.
 *
 * A way is scored at one anchor segment: the one holding the half-length point. buildGraph scores every
 * segment, so this is a per-way approximation of the graph, not a copy of it.
 */

const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'src', 'safety', 'services');
const SCORING = path.join(__dirname, '..', '..', '..', 'src', 'safety', 'scoring');
const { fastDistance, buildSpatialGrid, countNearby } = require(path.join(SRC, 'geo'));
const { inferLighting, isWeakLitTag, effectiveLit } = require(path.join(SCORING, 'lightingInference'));
const { buildRoadProximityIndex, isNearRoad, ROAD_HIGHWAYS } = require(path.join(SCORING, 'roadProximity'));
const { LAMP_RADIUS_M, LAMP_NEAR_PATH_M } = require(path.join(SCORING, 'config'));

const AREA_CELL_DEG = 0.003; // GRAPH.AREA_CELL_DEG in scoring/config.js
const MIN_SEGMENT_M = 0.5; // GRAPH.MIN_EDGE_LENGTH_M: safetyGraph raises shorter segments to this

/**
 * Walkable segments of a way as midpoints, endpoints and lengths. coords are [lng, lat] pairs.
 * @param {Array<[number, number]>} coords
 * @returns {Array<{midLat: number, midLng: number, km: number, aLat: number, aLng: number, bLat: number, bLng: number}>}
 */
function segmentsOf(coords) {
  const segments = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const [lngA, latA] = coords[i];
    const [lngB, latB] = coords[i + 1];
    const dist = Math.max(fastDistance(latA, lngA, latB, lngB), MIN_SEGMENT_M);
    segments.push({
      midLat: (latA + latB) / 2,
      midLng: (lngA + lngB) / 2,
      km: dist / 1000,
      aLat: latA,
      aLng: lngA,
      bLat: latB,
      bLng: lngB,
    });
  }
  return segments;
}

/**
 * The segment holding the half-length point of the way, or null for a way with no segments.
 * @param {Array<{midLat: number, midLng: number, km: number}>} segments
 * @returns {{midLat: number, midLng: number, km: number}|null}
 */
function anchorOf(segments) {
  if (segments.length === 0) return null;
  const total = segments.reduce((sum, s) => sum + s.km, 0);
  let cumulative = 0;
  for (const segment of segments) {
    cumulative += segment.km;
    if (cumulative >= total / 2) return segment;
  }
  return segments[segments.length - 1];
}

/** Key of the 0.003 deg area cell (safetyGraph areaCellKey). */
function areaKeyOf(lat, lng) {
  return `${Math.floor(lat / AREA_CELL_DEG)},${Math.floor(lng / AREA_CELL_DEG)}`;
}

/**
 * Add segment lengths to the area totals, keyed by segment midpoint (mutates area).
 * @param {Map<string, number>} area - area key -> km
 * @param {Array<{midLat: number, midLng: number, km: number}>} segments
 */
function addAreaKm(area, segments) {
  for (const s of segments) {
    const key = areaKeyOf(s.midLat, s.midLng);
    area.set(key, (area.get(key) || 0) + s.km);
  }
}

/**
 * Spatial index of visible street lamps plus lamp counts per area cell.
 * @param {Array<{lat: number, lng: number}>} lamps
 */
function buildLampIndex(lamps) {
  const areaLamps = new Map();
  for (const lamp of lamps) {
    const key = areaKeyOf(lamp.lat, lamp.lng);
    areaLamps.set(key, (areaLamps.get(key) || 0) + 1);
  }
  return { grid: buildSpatialGrid(lamps), areaLamps };
}

/**
 * Spatial index of visible lit=yes way vertices (buildGraph's lit-way vertex index).
 * @param {Array<{lat: number, lng: number}>} positions
 */
function buildLitIndex(positions) {
  return buildSpatialGrid(positions);
}

/**
 * Proximity index over the walkable road segments (trunk..service) of the study area.
 * @param {Array<{highway: string, segments: Array|null}>} roadRecords - records with their segments still attached
 */
function buildRoadIndexFromRecords(roadRecords) {
  const segments = [];
  for (const rec of roadRecords) {
    if (!ROAD_HIGHWAYS.has(rec.highway) || !rec.segments) continue;
    segments.push(...rec.segments);
  }
  return buildRoadProximityIndex(segments);
}

/**
 * Features that inferLighting needs for one anchor point.
 * @param {{anchor: {midLat: number, midLng: number}, lampIndex: object, litIndex: object, areaWayKm: number,
 *   roadIndex?: object}} input - roadIndex is optional: without it nearRoad is undefined (geometry unknown)
 * @returns {{lampCount30m: number, litNeighbour: boolean, nearRoad: boolean|undefined,
 *   areaLampDensityPerKm: number, areaWayKm: number}}
 */
function lightingFeatures({ anchor, lampIndex, litIndex, areaWayKm, roadIndex }) {
  const { midLat, midLng } = anchor;
  const litNeighbour = countNearby(litIndex, midLat, midLng, LAMP_RADIUS_M) > 0;
  const lampCount30m = countNearby(lampIndex.grid, midLat, midLng, LAMP_RADIUS_M);
  const areaLampCount = lampIndex.areaLamps.get(areaKeyOf(midLat, midLng)) || 0;
  const areaLampDensityPerKm = areaWayKm > 0 ? areaLampCount / areaWayKm : 0;
  const nearRoad = roadIndex ? isNearRoad(roadIndex, midLat, midLng) : undefined;
  const lampCountNearPath = countNearby(lampIndex.grid, midLat, midLng, LAMP_NEAR_PATH_M);
  return {
    lampCount30m, lampCountNearPath, litNeighbour, nearRoad, areaLampDensityPerKm, areaWayKm,
  };
}

/**
 * Lighting estimate for a way with the tags it is allowed to see. Pass tags with lit undefined to hide it.
 * @param {object} tags - {highway, maxspeed, sidewalk, lit}
 * @param {{lampCount30m: number, areaLampDensityPerKm: number, areaWayKm: number, litNeighbour?: boolean,
 *   nearRoad?: boolean}} features
 * @returns {{pLit: number, n: number, source: string, effective: number}}
 */
function estimateLighting(tags, features) {
  const { lampCountNearPath, ...inputs } = features;
  const weakLitTag = lampCountNearPath !== undefined && isWeakLitTag({ tags, ...inputs, lampCountNearPath });
  const estimate = inferLighting({ tags, ...inputs, weakLitTag });
  return { ...estimate, effective: effectiveLit(estimate) };
}

module.exports = {
  segmentsOf,
  anchorOf,
  areaKeyOf,
  addAreaKm,
  buildLampIndex,
  buildLitIndex,
  buildRoadIndexFromRecords,
  ROAD_HIGHWAYS,
  lightingFeatures,
  estimateLighting,
  AREA_CELL_DEG,
};
