/**
 * features.js — Lighting features for one way, computed the way safetyGraph's buildGraphV2 does.
 *
 * Replicated here (not imported) because buildGraphV2 is not exported:
 *   - segments: consecutive vertex pairs, skipped under 0.5 m (buildGraphV2 phase 1)
 *   - area cells: 0.003 deg, keyed by segment midpoint (V2.AREA_CELL_DEG)
 *   - lampCount30m = lamps within LAMP_RADIUS_M; litNeighbour = a lit=yes way vertex within it (separate, weaker
 *     evidence since LI; before LI such a vertex was added to the lamp count)
 *   - nearRoad = a trunk..service road within SIDEWALK_RADIUS_M of the segment midpoint (footway-like ways only matter)
 * The pure geometry helpers (fastDistance, buildSpatialGrid, countNearby, isNearRoad) and the lighting model
 * (inferLighting, effectiveLit, LAMP_RADIUS_M) are imported read-only from src/safety/.
 * safetyGraph.parity.test.js checks the replica against buildGraph on synthetic data.
 *
 * A way is scored at one anchor segment: the one holding the half-length point. buildGraphV2 scores every
 * segment, so this is a per-way approximation of the graph, not a copy of it.
 */

const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'src', 'safety', 'services');
const SCORING = path.join(__dirname, '..', '..', '..', 'src', 'safety', 'scoring');
const { fastDistance, buildSpatialGrid, countNearby } = require(path.join(SRC, 'geo'));
const { inferLighting, effectiveLit } = require(path.join(SCORING, 'lightingInference'));
const { buildRoadProximityIndex, isNearRoad, ROAD_HIGHWAYS } = require(path.join(SCORING, 'roadProximity'));
const { LAMP_RADIUS_M } = require(path.join(SCORING, 'config'));

const AREA_CELL_DEG = 0.003; // safetyGraph V2.AREA_CELL_DEG
const MIN_SEGMENT_M = 0.5; // safetyGraph skips shorter segments

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
    const dist = fastDistance(latA, lngA, latB, lngB);
    if (dist < MIN_SEGMENT_M) continue;
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
 * Spatial index of visible lit=yes way vertices (buildGraphV2 litWayNodePositions).
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
  return { lampCount30m, litNeighbour, nearRoad, areaLampDensityPerKm, areaWayKm };
}

/**
 * Lighting estimate for a way with the tags it is allowed to see. Pass tags with lit undefined to hide it.
 * @param {object} tags - {highway, maxspeed, sidewalk, lit}
 * @param {{lampCount30m: number, areaLampDensityPerKm: number, areaWayKm: number, litNeighbour?: boolean,
 *   nearRoad?: boolean}} features
 * @returns {{pLit: number, n: number, source: string, effective: number}}
 */
function estimateLighting(tags, features) {
  const estimate = inferLighting({ tags, ...features });
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
