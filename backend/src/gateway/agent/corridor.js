/**
 * corridor.js
 *
 * Corridor measure and expansion gate for the AI Insights agent (contract v3, card B1).
 * Pure functions: no I/O, no logging, no model.
 *
 * A route is an object with `path`: an array of {lat, lng} points in walking order.
 * (explain.js sanitizeRoute does not keep path points yet; callers must supply `path`.)
 */

const { buildRiskItems } = require('../lib/explainFacts');

/** Two routes are in the same corridor when a point of one is within this many metres of the other. */
const CORRIDOR_RADIUS_M = 150;
/** Expansion needs at least this share of each route in the recommended route's corridor. */
const MIN_SHARED_FRACTION = 0.6;
/** Expansion is only allowed for a trip at or after this darkness at the start (unit interval). */
const DARK_START_FRACTION = 0.85;
/** Length, in metres, of each sample step along route A when measuring the shared share. */
const SAMPLE_STEP_M = 10;
const EARTH_RADIUS_M = 6371000;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two {lat, lng} points. */
const haversineM = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * Distance in metres from point p to the segment a-b. A local flat projection around p is used,
 * which is accurate enough at the 150 m scale this module works at.
 */
const pointToSegmentM = (p, a, b) => {
  const cosLat = Math.cos(toRad(p.lat));
  const mPerDegLat = (Math.PI * EARTH_RADIUS_M) / 180;
  const mPerDegLng = mPerDegLat * cosLat;
  const ax = (a.lng - p.lng) * mPerDegLng;
  const ay = (a.lat - p.lat) * mPerDegLat;
  const bx = (b.lng - p.lng) * mPerDegLng;
  const by = (b.lat - p.lat) * mPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, (-ax * dx - ay * dy) / lenSq));
  return Math.hypot(ax + t * dx, ay + t * dy);
};

/** Distance in metres from point p to the polyline `path`; Infinity when the path is empty. */
const distanceToPathM = (p, path) => {
  if (path.length === 1) return haversineM(p, path[0]);
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i += 1) {
    best = Math.min(best, pointToSegmentM(p, path[i], path[i + 1]));
  }
  return best;
};

const isPoint = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/** The path points of a route, or [] when it has none usable. */
const pathOf = (route) => (route && Array.isArray(route.path) ? route.path.filter(isPoint) : []);

/**
 * Share (0..1) of route A's length that lies within 150 m of route B's path.
 * Route A is sampled every 10 m along its segments and each sample is weighted by the length it represents,
 * so the result is a share of length, not of point count. Returns 0 when either route has no path.
 *
 * @param {{path: Array<{lat: number, lng: number}>}} routeA
 * @param {{path: Array<{lat: number, lng: number}>}} routeB
 * @returns {number}
 */
const sharedCorridorFraction = (routeA, routeB) => {
  const a = pathOf(routeA);
  const b = pathOf(routeB);
  if (a.length === 0 || b.length === 0) return 0;

  // A single point has no length: it is shared when it lies within the corridor.
  if (a.length === 1) return distanceToPathM(a[0], b) <= CORRIDOR_RADIUS_M ? 1 : 0;

  let total = 0;
  let shared = 0;
  for (let i = 0; i + 1 < a.length; i += 1) {
    const segLen = haversineM(a[i], a[i + 1]);
    if (segLen === 0) continue;
    total += segLen;
    const steps = Math.max(1, Math.ceil(segLen / SAMPLE_STEP_M));
    const stepLen = segLen / steps;
    for (let s = 0; s < steps; s += 1) {
      const t = (s + 0.5) / steps;
      const sample = {
        lat: a[i].lat + (a[i + 1].lat - a[i].lat) * t,
        lng: a[i].lng + (a[i + 1].lng - a[i].lng) * t,
      };
      if (distanceToPathM(sample, b) <= CORRIDOR_RADIUS_M) shared += stepLen;
    }
  }
  if (total === 0) return distanceToPathM(a[0], b) <= CORRIDOR_RADIUS_M ? 1 : 0;
  return shared / total;
};

/**
 * Whether the agent may offer expand_search. True only when ALL of these hold:
 *   - the trip is late (tone 'late') or darkness at start is at least 0.85,
 *   - there are at least two routes and the recommended route exists,
 *   - the recommended route's shared fraction with every other route is at least 0.6,
 *   - the recommended route has at least one risk finding (explainFacts buildRiskItems).
 *
 * @param {{routes: Array<object>, recommendedRouteId: string, darknessAtStart: number, tone: string}} input
 * @returns {boolean}
 */
const expansionAllowed = ({ routes, recommendedRouteId, darknessAtStart, tone }) => {
  const dark = Number.isFinite(darknessAtStart) && darknessAtStart >= DARK_START_FRACTION;
  if (!(tone === 'late' || dark)) return false;
  if (!Array.isArray(routes) || routes.length < 2) return false;

  const recommended = routes.find((r) => r && r.routeId === recommendedRouteId);
  if (!recommended) return false;

  const others = routes.filter((r) => r !== recommended);
  const everyPairShares = others.every(
    (other) => sharedCorridorFraction(recommended, other) >= MIN_SHARED_FRACTION,
  );
  if (!everyPairShares) return false;

  return buildRiskItems(recommended).some((item) => item.severity === 'risk');
};

module.exports = { sharedCorridorFraction, expansionAllowed, haversineM };
