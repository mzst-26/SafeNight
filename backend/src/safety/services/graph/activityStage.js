/**
 * Activity factor: open places, CCTV cameras and transit stops near an edge. Collection happens once per
 * graph, scoring once per edge.
 */
const { buildSpatialGrid, countNearby } = require('../geo');
const { ACTIVITY_FLOOR, GRAPH } = require('../../scoring/config');
const { isPlaceOpen } = require('./openingHours');

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

/** Points of the places that are open at the given hour (nodes, or ways via their centre). */
function collectOpenPlaces(placeData, hour, now, tick) {
  const places = [];
  for (const el of placeData?.elements || []) {
    tick();
    const point = pointOf(el);
    if (point && isPlaceOpen(el.tags, hour, now)) places.push(point);
  }
  return places;
}

/**
 * Collects the activity sources and their spatial grids.
 * Activity is unknown only when the area has no place, transit or CCTV data at all.
 * @returns {{cctvNodes: Array, transitNodes: Array, cctvGrid: object, placeGrid: object, transitGrid: object,
 *   activityAvailable: boolean}}
 */
function collectActivitySources(cctvData, placeData, transitData, { hour, now }, tick) {
  const cctvNodes = collectNodePoints(cctvData, tick);
  const placeNodes = collectOpenPlaces(placeData, hour, now, tick);
  const transitNodes = collectNodePoints(transitData, tick);
  const rawCount = (placeData?.elements?.length || 0)
    + (transitData?.elements?.length || 0)
    + (cctvData?.elements?.length || 0);
  return {
    cctvNodes,
    transitNodes,
    cctvGrid: buildSpatialGrid(cctvNodes),
    placeGrid: buildSpatialGrid(placeNodes),
    transitGrid: buildSpatialGrid(transitNodes),
    activityAvailable: rawCount > 0,
  };
}

/** Weight on open places by hour: places close late at night, so they count for less. */
function nightDiscountFor(hour) {
  const d = GRAPH.NIGHT_DISCOUNT;
  if (hour >= d.LATE_FROM_HOUR || hour < d.LATE_TO_HOUR) return d.LATE;
  return hour >= d.EVENING_FROM_HOUR ? d.EVENING : d.DAY;
}

/**
 * Activity near an edge midpoint.
 * @param {object} sources Result of collectActivitySources.
 * @param {number} midLat
 * @param {number} midLng
 * @param {number} hour London hour.
 * @returns {{cctvCount: number, transitCount: number, cctvScore: number, placeScore: number,
 *   activity: {safety: number|null, n: number}, activitySafety: number|null}}
 */
function activityAt(sources, midLat, midLng, hour) {
  const cctvCount = countNearby(sources.cctvGrid, midLat, midLng, GRAPH.CCTV_RADIUS_M);
  const transitCount = countNearby(sources.transitGrid, midLat, midLng, GRAPH.TRANSIT_RADIUS_M);
  const placesOpen = countNearby(sources.placeGrid, midLat, midLng, GRAPH.PLACE_RADIUS_M);
  const nightDiscount = nightDiscountFor(hour);
  const cctvScore = Math.min(1.0, cctvCount * GRAPH.CCTV_WEIGHT);
  const placeScore = Math.min(1.0, placesOpen * GRAPH.PLACE_WEIGHT * nightDiscount);
  let activity = { safety: null, n: 0 };
  let activitySafety = null;
  if (sources.activityAvailable) {
    const activityLoad = GRAPH.PLACE_WEIGHT * placesOpen * nightDiscount
      + GRAPH.CCTV_WEIGHT * cctvCount + GRAPH.TRANSIT_WEIGHT * transitCount;
    // Floor: data exists but nothing is nearby is a quiet street, never a hostile one (safety 0).
    activitySafety = ACTIVITY_FLOOR + (1 - ACTIVITY_FLOOR) * (1 - Math.exp(-activityLoad));
    activity = { safety: activitySafety, n: GRAPH.ACTIVITY_N };
  }
  return { cctvCount, transitCount, cctvScore, placeScore, activity, activitySafety };
}

module.exports = { collectActivitySources, nightDiscountFor, activityAt, pointOf };
