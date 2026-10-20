/**
 * roadProximity.js — Is a point within reach of a road?
 *
 * Used by lighting inference to tell a sidewalk (a footway beside a road, lit with it) from an
 * isolated path. Roads are sampled every SAMPLE_STEP_M along their length into the shared spatial
 * grid, so a query is a few cell lookups however many roads there are (no O(n*m) scan) and a
 * long segment with no vertex near the point is still found. Sampling can overstate the distance
 * to a road by at most about SAMPLE_STEP_M^2 / (8 * radius), under 0.5 m for the 25 m radius.
 *
 * Pure geometry; imports only the spatial-grid helpers.
 */

const { LIGHTING } = require('./config');
const { fastDistance, buildSpatialGrid } = require('../services/geo');

// Road classes that make a nearby footway a sidewalk. Footway-like and path classes are excluded:
// a footway beside another footway says nothing about lighting. Motorway and trunk (and their links) are excluded
// too: they are barriers, not street frontage, and a footway beside or over one is not lit with it (see
// BARRIER_HIGHWAYS). OSM taxonomy, not a tunable.
const ROAD_HIGHWAYS = new Set([
  'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
]);

// Roads a footway may cross on a bridge or underpass. A path crossing one is a crossing structure, not a sidewalk.
const BARRIER_HIGHWAYS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);

// Spacing of the sample points along a road segment (m). A sampling detail, not a model tunable.
const SAMPLE_STEP_M = 10;
const GRID_CELL_DEG = 0.0005; // ~55 m, same as the other proximity grids

/** Planar bearing in degrees [0, 360) of a to b, longitude scaled by cos(lat). Only differences of bearings are used. */
function bearingDeg(aLat, aLng, bLat, bLng) {
  const dx = (bLng - aLng) * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  const dy = bLat - aLat;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** Angle between two undirected lines, in degrees [0, 90]. */
function lineAngleDeg(b1, b2) {
  const d = Math.abs(b1 - b2) % 180;
  return Math.min(d, 180 - d);
}

/**
 * Build a proximity index over road segments.
 * @param {Array<{aLat: number, aLng: number, bLat: number, bLng: number}>} segments
 * @returns {{grid: Map<string, Array<{lat: number, lng: number}>>, cellSize: number}}
 */
function buildRoadProximityIndex(segments, cellDeg = GRID_CELL_DEG) {
  const samples = [];
  for (const { aLat, aLng, bLat, bLng } of segments) {
    const length = fastDistance(aLat, aLng, bLat, bLng);
    const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP_M));
    const segment = { aLat, aLng, bLat, bLng };
    const bearing = bearingDeg(aLat, aLng, bLat, bLng);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      samples.push({ lat: aLat + (bLat - aLat) * t, lng: aLng + (bLng - aLng) * t, bearing, segment });
    }
  }
  return buildSpatialGrid(samples, 'lat', 'lng', cellDeg);
}

/** Calls visit(sample, distanceM) for every indexed sample within radiusM of the point. */
function forEachSampleWithin(index, lat, lng, radiusM, visit) {
  const { grid, cellSize } = index;
  const reach = Math.ceil((radiusM / 111_320) / cellSize) + 1;
  const r0 = Math.floor(lat / cellSize);
  const c0 = Math.floor(lng / cellSize);
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const cell = grid.get(`${r0 + dr},${c0 + dc}`);
      if (!cell) continue;
      for (const sample of cell) {
        const d = fastDistance(lat, lng, sample.lat, sample.lng);
        if (d <= radiusM) visit(sample, d);
      }
    }
  }
}

/** Nearest indexed sample within radiusM of the point, or null. */
function nearestSample(index, lat, lng, radiusM) {
  let best = null;
  let bestDist = Infinity;
  forEachSampleWithin(index, lat, lng, radiusM, (sample, d) => {
    if (d < bestDist) { best = sample; bestDist = d; }
  });
  return best;
}

/**
 * Distance in metres to the nearest indexed sample within maxM of the point, or Infinity when none is.
 * Sampling overstates the distance by under a metre at the radii used for remoteness.
 * @param {{grid: Map, cellSize: number}} index - from buildRoadProximityIndex
 * @returns {number}
 */
function nearestRoadDistance(index, lat, lng, maxM) {
  let best = Infinity;
  forEachSampleWithin(index, lat, lng, maxM, (sample, d) => { if (d < best) best = d; });
  return best;
}

/** True when the two planar segments intersect or touch (local metres: longitude scaled by cos(lat)). */
function segmentsIntersect(p, seg) {
  const k = Math.cos(p.a.lat * Math.PI / 180);
  const pa = [p.a.lng * k, p.a.lat];
  const pb = [p.b.lng * k, p.b.lat];
  const sa = [seg.aLng * k, seg.aLat];
  const sb = [seg.bLng * k, seg.bLat];
  // Side of o->a that b lies on: -1, 0 (on the line, within about 1 cm) or 1.
  const side = (o, a, b) => {
    const v = (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    return Math.abs(v) < 1e-14 ? 0 : Math.sign(v);
  };
  const s1 = side(pa, pb, sa);
  const s2 = side(pa, pb, sb);
  const s3 = side(sa, sb, pa);
  const s4 = side(sa, sb, pb);
  if (s1 === 0 && s2 === 0 && s3 === 0 && s4 === 0) return false; // collinear: running along it, not across it
  // A touch (a sample exactly on the road) counts: sampled paths often have a point right on the crossing.
  return s1 * s2 <= 0 && s3 * s4 <= 0;
}

/**
 * True when some road lies within radiusM of the point.
 * @param {{grid: Map, cellSize: number}} index - from buildRoadProximityIndex
 * @param {number} lat
 * @param {number} lng
 * @param {number} [radiusM=LIGHTING.SIDEWALK_RADIUS_M]
 * @returns {boolean}
 * @throws {TypeError} when lat, lng or radiusM is not a finite number (radius also >= 0)
 */
function isNearRoad(index, lat, lng, radiusM = LIGHTING.SIDEWALK_RADIUS_M) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new TypeError('lat and lng must be finite numbers');
  if (!Number.isFinite(radiusM) || radiusM < 0) throw new TypeError('radiusM must be a finite number >= 0');
  const { grid, cellSize } = index;
  const reach = Math.ceil((radiusM / 111_320) / cellSize) + 1;
  const r0 = Math.floor(lat / cellSize);
  const c0 = Math.floor(lng / cellSize);
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const cell = grid.get(`${r0 + dr},${c0 + dc}`);
      if (!cell) continue;
      for (const sample of cell) {
        if (fastDistance(lat, lng, sample.lat, sample.lng) <= radiusM) return true;
      }
    }
  }
  return false;
}

/** Points of a way at most SAMPLE_STEP_M apart: [{lat, lng, bearing, pieceStart}] plus the sub-pieces between them. */
function samplePath(segments) {
  const points = [];
  const pieces = [];
  let totalM = 0;
  for (const { a, b } of segments) {
    const length = fastDistance(a.lat, a.lng, b.lat, b.lng);
    totalM += length;
    const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP_M));
    const bearing = bearingDeg(a.lat, a.lng, b.lat, b.lng);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const at = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, bearing };
      points.push(at);
      if (i > 0) pieces.push({ a: points[points.length - 2], b: at, bearing });
    }
  }
  return { points, pieces, totalM };
}

/** True when the path piece crosses a barrier road, by intersection or by a crosswise approach within range. */
function pieceCrossesBarrier(piece, barriers, nearM, minAngleDeg) {
  const midLat = (piece.a.lat + piece.b.lat) / 2;
  const midLng = (piece.a.lng + piece.b.lng) / 2;
  const reachM = nearM + SAMPLE_STEP_M;
  let crossing = false;
  forEachSampleWithin(barriers, midLat, midLng, reachM, (sample, d) => {
    if (crossing) return;
    if (segmentsIntersect(piece, sample.segment)) crossing = true;
    else if (d <= nearM && lineAngleDeg(piece.bearing, sample.bearing) > minAngleDeg) crossing = true;
  });
  return crossing;
}

/**
 * Way-level context of a footway-like OSM way, from ALL its segments:
 *  - 'crossing': some part of the way intersects a motorway/trunk (or comes within CROSSING_NEAR_M of one at a
 *    crosswise bearing): a bridge, underpass or ramp, which the road's lighting does not reach;
 *  - 'alongside': at least MIN_ALONGSIDE_FRACTION of the way's sample points are within SIDEWALK_RADIUS_M of a
 *    qualifying street and (for ways of SHORT_LINK_M or more) run roughly parallel to it (within
 *    MAX_PARALLEL_ANGLE_DEG): a sidewalk, lit with that street;
 *  - 'isolated': anything else.
 * The midpoint test this replaces called a footbridge over a trunk road "sidewalk-like" because the trunk was
 * within 25 m at one sample.
 *
 * @param {Array<{a: {lat: number, lng: number}, b: {lat: number, lng: number}}>} segments - the way, in any order
 * @param {{grid: Map, cellSize: number}} roadIndex - qualifying streets (ROAD_HIGHWAYS), from buildRoadProximityIndex
 * @param {{grid: Map, cellSize: number}|null} barrierIndex - motorway/trunk segments, or null when unknown
 * @param {{bridge?: boolean}} [options] - bridge: the OSM way is tagged bridge=yes (optional; absent changes nothing).
 *   A bridge within BRIDGE_NEAR_M of a barrier road at more than BRIDGE_MIN_ANGLE_DEG passes over it: crossing.
 * @returns {'alongside'|'crossing'|'isolated'}
 */
function classifyWayContext(segments, roadIndex, barrierIndex, { bridge = false } = {}) {
  const { points, pieces, totalM } = samplePath(segments);
  if (points.length === 0) return 'isolated';
  const cfg = LIGHTING.WAY_CONTEXT;

  if (barrierIndex && pieces.some((piece) => pieceCrossesBarrier(piece, barrierIndex, cfg.CROSSING_NEAR_M, cfg.CROSSING_MIN_ANGLE_DEG))) {
    return 'crossing';
  }
  if (bridge === true && barrierIndex
    && pieces.some((piece) => pieceCrossesBarrier(piece, barrierIndex, cfg.BRIDGE_NEAR_M, cfg.BRIDGE_MIN_ANGLE_DEG))) {
    return 'crossing';
  }

  const checkAngle = totalM >= cfg.SHORT_LINK_M;
  let along = 0;
  for (const point of points) {
    const road = nearestSample(roadIndex, point.lat, point.lng, LIGHTING.SIDEWALK_RADIUS_M);
    if (road && (!checkAngle || lineAngleDeg(point.bearing, road.bearing) <= cfg.MAX_PARALLEL_ANGLE_DEG)) along += 1;
  }
  return along / points.length >= cfg.MIN_ALONGSIDE_FRACTION ? 'alongside' : 'isolated';
}

module.exports = {
  buildRoadProximityIndex, isNearRoad, nearestRoadDistance, classifyWayContext, ROAD_HIGHWAYS, BARRIER_HIGHWAYS,
};
