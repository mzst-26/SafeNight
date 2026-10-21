/**
 * actions.js
 *
 * Validation for what the model may ask the client to do (contract G3). Anything not in the
 * allowed set is dropped silently. The model only ever names candidate ids and route ids; it never
 * supplies coordinates. Candidate coordinates come from the client and are checked against the
 * bounding box of the routes.
 */

const MAX_ACTIONS = 4;
const MAX_CANDIDATES = 12;
/** Candidates may sit this many degrees outside the routes' bounding box. */
const BOX_MARGIN_DEG = 0.01;
const MAX_LABEL_LENGTH = 80;
const CANDIDATE_KINDS = ['stretch_midpoint', 'route_start', 'route_end'];
const CANDIDATE_ID_RE = /^p(?:[1-9]|1[0-2])$/;

/** Plain text from the client or the model: control characters removed, whitespace collapsed, capped. */
const cleanText = (value, max = MAX_LABEL_LENGTH) => {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
};

const isCoordinate = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

/** A box spanning more than this many degrees of longitude is an antimeridian crossing: no candidate is valid. */
const LNG_SPAN_LIMIT_DEG = 180;
const BOUNDS_INVALID = 'bounds_invalid';

/**
 * Bounding box of the start and end point of each route, and of the worst-stretch endpoints, or null when
 * the routes carry none. Candidate points are not included: they are checked against this box.
 * @param {Array<object>} routes raw routes from the request body
 */
const routeBounds = (routes) => {
  if (!Array.isArray(routes)) return null;
  const box = { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity };
  for (const route of routes) {
    if (!route || typeof route !== 'object') continue;
    const stretch = route.worstStretch || {};
    for (const point of [route.start, route.end, stretch.start, stretch.end]) {
      if (!point || !isCoordinate(point.lat, point.lng)) continue;
      box.minLat = Math.min(box.minLat, point.lat);
      box.maxLat = Math.max(box.maxLat, point.lat);
      box.minLng = Math.min(box.minLng, point.lng);
      box.maxLng = Math.max(box.maxLng, point.lng);
    }
  }
  return box.minLat === Infinity ? null : box;
};

/** Reason string for the response analysis when the route points cross the antimeridian, else null. */
const routeBoundsReason = (routes) => {
  const box = routeBounds(routes);
  return box && box.maxLng - box.minLng > LNG_SPAN_LIMIT_DEG ? BOUNDS_INVALID : null;
};

/**
 * @param {Array<object>} list candidate points from the client: {id, label, lat, lng, kind}
 * @param {Array<object>} routes raw routes from the request body (their bounding box is the limit)
 * @returns {Array<{id: string, label: string, lat: number, lng: number, kind: string}>} at most 12
 */
const validateCandidates = (list, routes) => {
  if (!Array.isArray(list)) return [];
  const box = routeBounds(routes);
  if (!box || box.maxLng - box.minLng > LNG_SPAN_LIMIT_DEG) return [];

  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (out.length >= MAX_CANDIDATES) break;
    if (!c || typeof c !== 'object') continue;
    if (typeof c.id !== 'string' || !CANDIDATE_ID_RE.test(c.id) || seen.has(c.id)) continue;
    if (!CANDIDATE_KINDS.includes(c.kind)) continue;
    if (!isCoordinate(c.lat, c.lng)) continue;
    if (
      c.lat < box.minLat - BOX_MARGIN_DEG ||
      c.lat > box.maxLat + BOX_MARGIN_DEG ||
      c.lng < box.minLng - BOX_MARGIN_DEG ||
      c.lng > box.maxLng + BOX_MARGIN_DEG
    ) {
      continue;
    }
    const label = cleanText(c.label);
    if (!label) continue;
    seen.add(c.id);
    out.push({ id: c.id, label, lat: c.lat, lng: c.lng, kind: c.kind });
  }
  return out;
};

const inZoomRange = (zoom) => Number.isFinite(zoom) && zoom >= 10 && zoom <= 19;

/** Returns the clean action, or null when it is not allowed. Only whitelisted fields are copied. */
const toAction = (raw, routeSet, candidateSet) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  switch (raw.type) {
    case 'pan_to': {
      if (!candidateSet.has(raw.candidateId)) return null;
      const action = { type: 'pan_to', candidateId: raw.candidateId };
      if (raw.zoom !== undefined) {
        if (!inZoomRange(raw.zoom)) return null;
        action.zoom = raw.zoom;
      }
      return action;
    }
    case 'zoom':
      return Number.isInteger(raw.delta) && raw.delta >= -2 && raw.delta <= 2 ? { type: 'zoom', delta: raw.delta } : null;
    case 'fit_route':
    case 'show_findings':
      return routeSet.has(raw.routeId) ? { type: raw.type, routeId: raw.routeId } : null;
    case 'propose_reroute_via': {
      if (!candidateSet.has(raw.candidateId)) return null;
      const label = cleanText(raw.label);
      if (!label) return null;
      // A reroute is never run directly: the client always asks the walker first.
      return { type: 'propose_reroute_via', candidateId: raw.candidateId, label, requiresConfirmation: true };
    }
    default:
      return null;
  }
};

/**
 * @param {Array<object>} rawActions the model's actions
 * @param {{routeIds: string[], candidateIds: string[]}} ids the ids the model may use
 * @returns {Array<object>} at most 4 valid actions, in order; everything else is dropped
 */
const validateActions = (rawActions, { routeIds = [], candidateIds = [] } = {}) => {
  if (!Array.isArray(rawActions)) return [];
  const routeSet = new Set(routeIds);
  const candidateSet = new Set(candidateIds);
  const out = [];
  for (const raw of rawActions) {
    if (out.length >= MAX_ACTIONS) break;
    const action = toAction(raw, routeSet, candidateSet);
    if (action) out.push(action);
  }
  return out;
};

module.exports = {
  validateActions,
  validateCandidates,
  routeBounds,
  routeBoundsReason,
  cleanText,
  MAX_ACTIONS,
  MAX_CANDIDATES,
  MAX_LABEL_LENGTH,
};
