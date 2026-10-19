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
// a footway beside another footway says nothing about lighting. OSM taxonomy, not a tunable.
const ROAD_HIGHWAYS = new Set([
  'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
]);

// Spacing of the sample points along a road segment (m). A sampling detail, not a model tunable.
const SAMPLE_STEP_M = 10;
const GRID_CELL_DEG = 0.0005; // ~55 m, same as the other proximity grids

/**
 * Build a proximity index over road segments.
 * @param {Array<{aLat: number, aLng: number, bLat: number, bLng: number}>} segments
 * @returns {{grid: Map<string, Array<{lat: number, lng: number}>>, cellSize: number}}
 */
function buildRoadProximityIndex(segments) {
  const samples = [];
  for (const { aLat, aLng, bLat, bLng } of segments) {
    const length = fastDistance(aLat, aLng, bLat, bLng);
    const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP_M));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      samples.push({ lat: aLat + (bLat - aLat) * t, lng: aLng + (bLng - aLng) * t });
    }
  }
  return buildSpatialGrid(samples, 'lat', 'lng', GRID_CELL_DEG);
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

module.exports = { buildRoadProximityIndex, isNearRoad, ROAD_HIGHWAYS };
