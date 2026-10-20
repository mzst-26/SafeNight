/**
 * Activity factor: open places, CCTV cameras and transit stops near an edge. Collection happens once per
 * graph, scoring once per edge.
 */
const { buildSpatialGrid, countNearby } = require('../geo');
const {
  ACTIVITY_FLOOR, ACTIVITY_FLOOR_NIGHT, ACTIVITY_FLOOR_FULL_PRESENCE, PLACE_PRESENCE_BASE, PLACE_PRESENCE_SLOPE,
  GRAPH, PRESENCE,
} = require('../../scoring/config');
const { presenceAt, deriveType } = require('../../scoring/presence');
const { isPlaceOpen } = require('./openingHours');
const { clamp01 } = require('./common');

const VENUE_AMENITIES = new Set(PRESENCE.VENUE_AMENITIES);
const SETTLEMENT_CLASSES = new Set(Object.keys(PRESENCE.CLASS_BASE));

/** A point feature with latitude and longitude, from a node or a way's centre; null when it has neither. */
function pointOf(el) {
  const lat = el.lat || el.center?.lat;
  const lng = el.lon || el.center?.lon;
  return lat && lng ? { lat, lng } : null;
}

/** Points of node elements that carry coordinates (CCTV cameras, transit stops). */
function collectNodePoints(data, tick) {
  const points = [];
  for (const el of data?.elements || []) {
    tick();
    if (el.type === 'node' && el.lat && el.lon) points.push({ lat: el.lat, lng: el.lon });
  }
  return points;
}

/**
 * One pass over the places: those open at the given hour (nodes, or ways via their centre) and the food and drink
 * venues, open or not (they set the kind of place; opening is handled separately).
 */
function collectPlaces(placeData, hour, now, tick) {
  const open = [];
  const venues = [];
  for (const el of placeData?.elements || []) {
    tick();
    const point = pointOf(el);
    if (!point) continue;
    if (isPlaceOpen(el.tags, hour, now)) open.push(point);
    if (VENUE_AMENITIES.has(el.tags?.amenity)) venues.push(point);
  }
  return { open, venues };
}

/**
 * The gazetteer lookup, loaded lazily so a missing or broken settlements module never stops a graph build.
 * @returns {((lat: number, lng: number) => {class: string})|null}
 */
function defaultSettlementLookup() {
  try {
    // eslint-disable-next-line global-require
    return require('../../scoring/settlements').settlementClassAt;
  } catch (err) {
    return null;
  }
}

/**
 * Settlement class by location, cached per SETTLEMENT_CELL_DEG (~1 km) cell: the class is computed once per cell, not per edge.
 * A lookup that is missing, throws or returns an unknown class gives PRESENCE.DEFAULT_CLASS.
 * @param {((lat: number, lng: number) => {class?: string}|string)|null|undefined} lookup settlementClassAt-like.
 * @returns {(lat: number, lng: number) => string}
 */
function createSettlementLookup(lookup) {
  const cache = new Map();
  return (lat, lng) => {
    const key = `${Math.floor(lat / PRESENCE.SETTLEMENT_CELL_DEG)},${Math.floor(lng / PRESENCE.SETTLEMENT_CELL_DEG)}`;
    let klass = cache.get(key);
    if (klass === undefined) {
      klass = PRESENCE.DEFAULT_CLASS;
      if (typeof lookup === 'function') {
        try {
          const result = lookup(lat, lng);
          const named = typeof result === 'string' ? result : result?.class;
          if (SETTLEMENT_CLASSES.has(named)) klass = named;
        } catch (err) {
          klass = PRESENCE.DEFAULT_CLASS;
        }
      }
      cache.set(key, klass);
    }
    return klass;
  };
}

/**
 * Collects the activity sources and their spatial grids.
 * Activity is unknown only when the area has no place, transit or CCTV data at all.
 * @param {object} clock Build clock: hour, now, and optionally settlementClassAt (an injected gazetteer lookup).
 * @returns {{cctvNodes: Array, transitNodes: Array, openPlaces: Array, cctvGrid: object, placeGrid: object, transitGrid: object,
 *   venueGrid: object, settlementOf: Function, venueCache: Map, activityAvailable: boolean}}
 */
function collectActivitySources(cctvData, placeData, transitData, { hour, now, settlementClassAt }, tick) {
  const cctvNodes = collectNodePoints(cctvData, tick);
  const { open: placeNodes, venues } = collectPlaces(placeData, hour, now, tick);
  const transitNodes = collectNodePoints(transitData, tick);
  const rawCount = (placeData?.elements?.length || 0)
    + (transitData?.elements?.length || 0)
    + (cctvData?.elements?.length || 0);
  return {
    cctvNodes,
    transitNodes,
    openPlaces: placeNodes,
    cctvGrid: buildSpatialGrid(cctvNodes),
    placeGrid: buildSpatialGrid(placeNodes),
    transitGrid: buildSpatialGrid(transitNodes),
    venueGrid: buildSpatialGrid(venues, 'lat', 'lng', PRESENCE.CELL_DEG),
    settlementOf: createSettlementLookup(settlementClassAt === undefined ? defaultSettlementLookup() : settlementClassAt),
    venueCache: new Map(),
    activityAvailable: rawCount > 0,
  };
}

/** Food/drink venues within VENUE_RADIUS_M of the centre of the point's CELL_DEG cell, cached per cell. */
function venuesNear(sources, lat, lng) {
  const row = Math.floor(lat / PRESENCE.CELL_DEG);
  const col = Math.floor(lng / PRESENCE.CELL_DEG);
  const key = `${row},${col}`;
  let count = sources.venueCache.get(key);
  if (count === undefined) {
    count = countNearby(sources.venueGrid, (row + 0.5) * PRESENCE.CELL_DEG, (col + 0.5) * PRESENCE.CELL_DEG, PRESENCE.VENUE_RADIUS_M);
    sources.venueCache.set(key, count);
  }
  return count;
}

/**
 * Weight of one open place in the activity load, from presence (replaces the global night discount): by day an open
 * place counts in full (1); in the dark it counts PLACE_PRESENCE_BASE + PLACE_PRESENCE_SLOPE * P, at most 1, blended
 * by darkness. Presence (hour curve included) is low in daylight for residential streets because few people are out,
 * but an open shop by day is still a watched place, so daylight is not discounted.
 * @param {number} presence
 * @param {number} [darkness=1]
 */
function placeWeightFor(presence, darkness = 1) {
  const night = Math.min(1, PLACE_PRESENCE_BASE + PLACE_PRESENCE_SLOPE * presence);
  const d = clamp01(darkness);
  return d * night + (1 - d);
}

/**
 * Activity floor: by day always ACTIVITY_FLOOR; in the dark it falls from ACTIVITY_FLOOR (presence at or above
 * ACTIVITY_FLOOR_FULL_PRESENCE) to ACTIVITY_FLOOR_NIGHT (nobody about). Also the prior for unknown activity.
 * @param {{presence: number, darkness: number}} input
 */
function activityFloorFor({ presence, darkness }) {
  const weight = Math.max(1 - clamp01(darkness), clamp01(presence / ACTIVITY_FLOOR_FULL_PRESENCE));
  return ACTIVITY_FLOOR_NIGHT + (ACTIVITY_FLOOR - ACTIVITY_FLOOR_NIGHT) * weight;
}

/**
 * Activity near an edge midpoint.
 * @param {object} sources Result of collectActivitySources.
 * @param {number} midLat
 * @param {number} midLng
 * @param {number} hour London hour.
 * @param {{darkness?: number, remoteness?: number}} [context] darkness (default 1: the cautious case) gates the
 *   floor; remoteness (default 0) decides whether the place is a park.
 * @returns {{cctvCount: number, transitCount: number, placesOpen: number, venues: number, presence: number, type: string,
 *   floor: number, cctvScore: number, placeScore: number, activity: {safety: number|null, n: number, prior: number},
 *   activitySafety: number|null}}
 */
function activityAt(sources, midLat, midLng, hour, { darkness = 1, remoteness = 0 } = {}) {
  const cctvCount = countNearby(sources.cctvGrid, midLat, midLng, GRAPH.CCTV_RADIUS_M);
  const transitCount = countNearby(sources.transitGrid, midLat, midLng, GRAPH.TRANSIT_RADIUS_M);
  const placesOpen = countNearby(sources.placeGrid, midLat, midLng, GRAPH.PLACE_RADIUS_M);
  const venues = venuesNear(sources, midLat, midLng);
  const type = deriveType({ remoteness, venues, openPlaces80m: placesOpen });
  const presence = presenceAt({
    settlementClass: sources.settlementOf(midLat, midLng),
    venueDensity: venues,
    type,
    hour,
    lateVenuesNearby: placesOpen,
    darkness,
  });
  const floor = activityFloorFor({ presence, darkness });
  const placeWeight = placeWeightFor(presence, darkness);
  const cctvScore = Math.min(1.0, cctvCount * GRAPH.CCTV_WEIGHT);
  const placeScore = Math.min(1.0, placesOpen * GRAPH.PLACE_WEIGHT * placeWeight);
  // Unknown activity takes the same floor as its prior, so data showing nothing is never worse than no data.
  let activity = { safety: null, n: 0, prior: floor };
  let activitySafety = null;
  if (sources.activityAvailable) {
    const activityLoad = GRAPH.PLACE_WEIGHT * placesOpen * placeWeight
      + GRAPH.CCTV_WEIGHT * cctvCount + GRAPH.TRANSIT_WEIGHT * transitCount;
    // Floor: data exists but nothing is nearby is a quiet street, never a hostile one (safety 0).
    activitySafety = floor + (1 - floor) * (1 - Math.exp(-activityLoad));
    activity = { safety: activitySafety, n: GRAPH.ACTIVITY_N };
  }
  return {
    cctvCount, transitCount, placesOpen, venues, presence, type, floor, cctvScore, placeScore, activity, activitySafety,
  };
}

module.exports = {
  collectActivitySources,
  createSettlementLookup,
  placeWeightFor,
  activityFloorFor,
  activityAt,
  pointOf,
};
