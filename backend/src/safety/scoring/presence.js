/**
 * presence.js — Presence index P(hour, x): how likely it is that other people are around a point at this hour.
 *
 *   P = clamp01( B(class) * (0.35 + 0.65 * L) * H(hour, type) + LATE )
 *
 * B: footfall base by settlement class; L: food/drink venue density within 1 km; H: hour-of-day curve by place type;
 * LATE: venues open late within 80 m. Pure functions; every number lives in config.js (PRESENCE). Spec section 12.
 */
const { PRESENCE } = require('./config');

const TYPES = new Set(['centre', 'residential', 'park']);

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Venue factor L in [0, 1]: log10(1 + venues) / log10(1 + VENUE_SATURATION).
 * @param {number} venues Food and drink venues within VENUE_RADIUS_M.
 * @returns {number}
 */
function venueFactor(venues) {
  const n = Number.isFinite(venues) && venues > 0 ? venues : 0;
  return clamp01(Math.log10(1 + n) / Math.log10(1 + PRESENCE.VENUE_SATURATION));
}

/** Linear interpolation over [hour, value] anchors, wrapping at 24. */
function interpolate(anchors, hour) {
  const h = ((hour % 24) + 24) % 24;
  let prev = anchors[anchors.length - 1];
  let prevHour = prev[0] - 24;
  for (const [ah, av] of anchors) {
    if (h <= ah) {
      if (ah === prevHour) return av;
      return prev[1] + ((av - prev[1]) * (h - prevHour)) / (ah - prevHour);
    }
    prev = [ah, av];
    prevHour = ah;
  }
  const [firstHour, firstValue] = anchors[0];
  return prev[1] + ((firstValue - prev[1]) * (h - prevHour)) / (firstHour + 24 - prevHour);
}

/**
 * Hour factor H for a place type.
 * @param {'centre'|'residential'|'park'} type
 * @param {number} hour London hour, 0 to 24 (fractions allowed).
 * @param {number} [darkness=0] Used by parks only: by day a park is busy, after dusk empty.
 * @returns {number}
 */
function hourFactor(type, hour, darkness = 0) {
  if (!TYPES.has(type)) throw new TypeError(`type must be one of: ${[...TYPES].join(', ')}`);
  if (!Number.isFinite(hour)) throw new TypeError('hour must be a finite number');
  if (type === 'park') {
    const p = PRESENCE.HOUR_CURVE.park;
    const h = ((hour % 24) + 24) % 24;
    if (h >= p.NIGHT_FROM_HOUR || h < p.NIGHT_TO_HOUR) return p.NIGHT;
    const d = clamp01(darkness);
    return p.DAY - (p.DAY - p.NIGHT) * d;
  }
  return interpolate(PRESENCE.HOUR_CURVE[type], hour);
}

/**
 * Place type of a location.
 * @param {{remoteness?: number, venues?: number, openPlaces80m?: number}} input
 * @returns {'centre'|'residential'|'park'}
 */
function deriveType({ remoteness = 0, venues = 0, openPlaces80m = 0 } = {}) {
  if (remoteness >= PRESENCE.PARK_MIN_REMOTENESS) return 'park';
  if (venues >= PRESENCE.CENTRE_MIN_VENUES || openPlaces80m >= PRESENCE.CENTRE_MIN_OPEN_PLACES) return 'centre';
  return 'residential';
}

/** True when the hour is in the late window, in which open venues are notable. */
function isLateHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  return h >= PRESENCE.LATE_FROM_HOUR || h < PRESENCE.LATE_TO_HOUR;
}

/**
 * Presence index at a point and hour.
 * @param {object} input
 * @param {'metropolis'|'city'|'largeTown'|'town'|'village'|'rural'} input.settlementClass
 * @param {number} input.venueDensity Food/drink venues within 1 km.
 * @param {'centre'|'residential'|'park'} input.type
 * @param {number} input.hour London hour.
 * @param {number} [input.lateVenuesNearby=0] Venues open now within 80 m (counted only in the late window).
 * @param {number} [input.darkness=0] Park curve only.
 * @returns {number} Presence in [0, 1].
 * @throws {TypeError} On an unknown class or type, or a non-finite hour.
 */
function presenceAt({
  settlementClass, venueDensity, type, hour, lateVenuesNearby = 0, darkness = 0,
}) {
  if (!Object.prototype.hasOwnProperty.call(PRESENCE.CLASS_BASE, settlementClass)) {
    throw new TypeError(`settlementClass must be one of: ${Object.keys(PRESENCE.CLASS_BASE).join(', ')}`);
  }
  const base = PRESENCE.CLASS_BASE[settlementClass];
  const h = hourFactor(type, hour, darkness);
  const late = isLateHour(hour)
    ? PRESENCE.LATE_MAX * Math.min(1, Math.max(0, lateVenuesNearby) / PRESENCE.LATE_VENUES_FULL)
    : 0;
  return clamp01(base * (PRESENCE.VENUE_FLOOR + PRESENCE.VENUE_SPAN * venueFactor(venueDensity)) * h + late);
}

module.exports = { presenceAt, venueFactor, hourFactor, deriveType, isLateHour };
