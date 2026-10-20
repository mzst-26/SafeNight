/**
 * Whether a mapped place is open at a given London hour. Used for the activity factor.
 */
const OpeningHours = require('opening_hours');
const { OPENING_HOURS } = require('../../scoring/config');

// Parsing opening_hours strings is optional and off by default (it is slow and many tags are malformed).
const ENABLE_PLACE_OPENING_HOURS_PARSE = process.env.SAFE_ROUTES_PARSE_PLACE_OPENING_HOURS === '1';

/**
 * Drops public-holiday clauses, which the parser cannot evaluate without a holiday calendar: a separate
 * rule ("PH off") and a suffix on a rule ("Mo-Fr 09:00-17:00, PH off").
 * @param {string} raw
 * @returns {string} The cleaned rule list, possibly empty.
 */
function stripPublicHolidayClauses(raw) {
  return raw
    .split(';').map((s) => s.trim())
    .filter((s) => !/^\s*PH\b/.test(s))
    .map((s) => s.replace(/,\s*PH\b[^;]*/g, ''))
    .filter(Boolean).join('; ');
}

/**
 * Open state from an opening_hours tag, or null when the tag is missing, empty after cleaning, or unparseable.
 * @param {string} hoursRaw
 * @param {Date} now
 * @returns {boolean|null}
 */
function parseOpenState(hoursRaw, now) {
  try {
    const cleaned = stripPublicHolidayClauses(hoursRaw);
    if (!cleaned) return null;
    const oh = new OpeningHours(cleaned, { address: { country_code: 'gb' } });
    return oh.getState(now);
  } catch {
    return null;
  }
}

/**
 * Time-of-day heuristic by place type: always open, open in the evening, extended shop hours, or daytime only.
 * @param {object} tags OSM tags of the place.
 * @param {number} hour London hour 0-23 (24 allowed).
 * @returns {boolean}
 */
function heuristicOpen(tags, hour) {
  const type = (tags?.amenity || tags?.shop || '').toLowerCase();
  const within = ({ from, to }) => hour >= from && hour < to;
  if (OPENING_HOURS.ALWAYS_OPEN.includes(type)) return true;
  if (OPENING_HOURS.EVENING.includes(type)) return within(OPENING_HOURS.EVENING_HOURS);
  if (OPENING_HOURS.EXTENDED_SHOPS.includes(type)) return within(OPENING_HOURS.EXTENDED_SHOP_HOURS);
  return within(OPENING_HOURS.DEFAULT_HOURS);
}

/**
 * Open or closed at a London hour. Takes the hour and instant from the caller, so the result never depends on
 * the server clock.
 * @param {object} tags OSM tags of the place.
 * @param {number} hour London hour.
 * @param {Date} now Instant used for parsed opening_hours rules.
 * @returns {boolean}
 */
function isPlaceOpen(tags, hour, now) {
  const hoursRaw = tags?.opening_hours || '';
  const parsed = ENABLE_PLACE_OPENING_HOURS_PARSE && hoursRaw ? parseOpenState(hoursRaw, now) : null;
  return Boolean(parsed === null ? heuristicOpen(tags, hour) : parsed);
}

module.exports = { isPlaceOpen, heuristicOpen, stripPublicHolidayClauses, parseOpenState };
