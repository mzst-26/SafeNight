/**
 * Trip time handling for /api/safe-routes: leave_at / arrive_by parsing, the instant the graph is scored at,
 * the per-route daylight timeline and the cache time bucket. Pure functions; the clock is always passed in.
 *
 * v1 approximation: the whole graph is evaluated at ONE instant, the mid-walk time t0 + ETA/2, so darkness and
 * place presence are not re-evaluated along the walk. Each route reports darkness at its own start and arrival
 * (timeline) so the client can show when a walk crosses dusk.
 */
const { darknessFactor, londonWallMs, londonWallToInstantMs } = require('../scoring/darkness');
const { londonHourOf } = require('../services/graph/clock');

/** The one walking speed (m/s) used for every backend duration. */
const WALKING_SPEED_MPS = 1.35;
/** Walked distance is estimated as straight line times this when no route exists yet. */
const ETA_DETOUR_FACTOR = 1.3;
const TIMEZONE = 'Europe/London';
const MIN_MS = 60_000;
const TIME_HORIZON_MS = 24 * 3_600_000;
const LEAVE_AT_PAST_MS = 5 * MIN_MS;
const ARRIVE_BY_MIN_LEAD_MS = 5 * MIN_MS;
// Must match BUCKET_MS in src/utils/tripTime.ts (the client cache/search-id bucket). Change both together.
const CACHE_BUCKET_MS = 15 * MIN_MS;
/** arrive_by is re-scored once when the real duration differs from the assumed one by more than this. */
const ARRIVE_BY_TOLERANCE_SEC = 120;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const DAYLIGHT_BELOW = 0.15;
const DARK_FROM = 0.85;

const INVALID_TIME = 'INVALID_TIME';
const TIME_OUT_OF_RANGE = 'TIME_OUT_OF_RANGE';

// Date, time and a mandatory explicit offset (Z, +HH:MM or +HHMM).
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

const invalid = (message) => ({ ok: false, error: INVALID_TIME, message });

/** Straight-line metres to an ETA estimate in seconds. */
function estimateEtaSec(straightLineM) {
  return (straightLineM * ETA_DETOUR_FACTOR) / WALKING_SPEED_MPS;
}

/** One time param: absent/blank -> null; otherwise epoch ms or an INVALID_TIME error. */
function parseInstant(raw, name) {
  if (raw == null) return { ms: null };
  if (Array.isArray(raw)) return { error: invalid(`${name} must be given once.`) };
  if (typeof raw !== 'string') return { error: invalid(`${name} must be an ISO-8601 timestamp with a UTC offset.`) };
  // A '+' in an unencoded query string is decoded to a space ('...T17:10:00 01:00'): restore it.
  const trimmed = raw.trim().replace(/^(.*T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?) (\d{2}:?\d{2})$/, '$1+$2');
  if (trimmed === '') return { ms: null };
  if (!ISO_WITH_OFFSET.test(trimmed)) {
    return {
      error: invalid(`${name} must be an ISO-8601 timestamp with an explicit UTC offset, e.g. 2026-10-21T17:10:00+01:00 or ...Z.`),
    };
  }
  const ms = Date.parse(trimmed);
  // Date.parse rolls impossible days (30 Feb) forward; check the calendar date survives.
  const [y, mo, d] = trimmed.slice(0, 10).split('-').map(Number);
  const rolled = new Date(Date.UTC(y, mo - 1, d));
  const calendarOk = rolled.getUTCFullYear() === y && rolled.getUTCMonth() === mo - 1 && rolled.getUTCDate() === d;
  if (!Number.isFinite(ms) || !calendarOk) return { error: invalid(`${name} is not a valid date and time.`) };
  return { ms };
}

/**
 * Validates leave_at / arrive_by.
 * @returns {{ok: true, value: {leaveAtMs: number|null, arriveByMs: number|null}}
 *   | {ok: false, error: string, message: string}}
 */
function parseTimeParams(query = {}, nowMs = Date.now()) {
  const leave = parseInstant(query.leave_at, 'leave_at');
  if (leave.error) return leave.error;
  const arrive = parseInstant(query.arrive_by, 'arrive_by');
  if (arrive.error) return arrive.error;
  if (leave.ms != null && arrive.ms != null) {
    return invalid('Give either leave_at or arrive_by, not both.');
  }
  if (leave.ms != null && (leave.ms < nowMs - LEAVE_AT_PAST_MS || leave.ms > nowMs + TIME_HORIZON_MS)) {
    return {
      ok: false,
      error: TIME_OUT_OF_RANGE,
      message: 'leave_at must be between 5 minutes ago and 24 hours from now.',
    };
  }
  if (arrive.ms != null && (arrive.ms < nowMs + ARRIVE_BY_MIN_LEAD_MS || arrive.ms > nowMs + TIME_HORIZON_MS)) {
    return {
      ok: false,
      error: TIME_OUT_OF_RANGE,
      message: 'arrive_by must be between 5 minutes and 24 hours from now.',
    };
  }
  return { ok: true, value: { leaveAtMs: leave.ms, arriveByMs: arrive.ms } };
}

const asMs = (v) => (v instanceof Date ? v.getTime() : v);

/** Instant of "today at this London hour" (today is the London calendar day of nowMs). */
function todayAtLondonHourMs(hour, nowMs) {
  const wall = londonWallMs(nowMs);
  const midnightWall = wall - (wall % MS_PER_DAY);
  return londonWallToInstantMs(midnightWall + hour * MS_PER_HOUR);
}

/**
 * Resolves the trip's timing.
 * @param {{leaveAt?: number|Date|null, arriveBy?: number|Date|null, departureHour?: number|null,
 *   nowMs: number, etaSec: number}} args Instants are epoch ms (or Date).
 * @returns {{mode: 'now'|'leave_at'|'arrive_by'|'departure_hour', t0Ms: number, midMs: number, etaSec: number,
 *   arriveByMs: number|null, londonHour: (ms: number) => number}}
 */
function resolveTripTime({ leaveAt = null, arriveBy = null, departureHour = null, nowMs, etaSec }) {
  const leaveMs = asMs(leaveAt);
  const arriveMs = asMs(arriveBy);
  const eta = Number.isFinite(etaSec) && etaSec > 0 ? etaSec : 0;
  let mode = 'now';
  let t0Ms = nowMs;
  if (leaveMs != null) {
    mode = 'leave_at';
    t0Ms = leaveMs;
  } else if (arriveMs != null) {
    mode = 'arrive_by';
    t0Ms = arriveMs - eta * 1000;
  } else if (departureHour != null) {
    mode = 'departure_hour';
    t0Ms = todayAtLondonHourMs(departureHour, nowMs);
  }
  return {
    mode,
    t0Ms,
    midMs: t0Ms + (eta * 1000) / 2,
    etaSec: eta,
    arriveByMs: mode === 'arrive_by' ? arriveMs : null,
    londonHour: (ms) => londonHourOf(new Date(ms)),
  };
}

/** True when an arrive_by trip should be re-scored with the real duration. */
function needsArriveBySecondPass({ mode, assumedEtaSec, actualSec }) {
  return mode === 'arrive_by' && Math.abs(actualSec - assumedEtaSec) > ARRIVE_BY_TOLERANCE_SEC;
}

/**
 * The trip to re-score with when an arrive_by estimate was off, or null when no second pass is needed.
 * @param {object} request The resolveTripTime arguments minus etaSec.
 * @param {object} trip The trip the first pass used.
 * @param {number} actualSec Duration of the best route found.
 */
function rescoredTrip(request, trip, actualSec) {
  if (!needsArriveBySecondPass({ mode: trip.mode, assumedEtaSec: trip.etaSec, actualSec })) return null;
  return resolveTripTime({ ...request, etaSec: actualSec });
}

/** Label rules: dark at the start, else dark by arrival, else daylight if both ends are bright, else dusk. */
function timelineLabel(darknessAtStart, darknessAtArrival) {
  if (darknessAtStart >= DARK_FROM) return 'dark_from_start';
  if (darknessAtArrival >= DARK_FROM) return 'dark_by_arrival';
  if (darknessAtStart < DAYLIGHT_BELOW && darknessAtArrival < DAYLIGHT_BELOW) return 'daylight';
  return 'dusk';
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Per-route timeline: darkness at the start point/instant and at the arrival point/instant.
 * Labels use the unrounded darkness.
 */
function buildTimeline({ lat, lng, destLat = lat, destLng = lng, t0Ms, durationSec }) {
  const arriveMs = t0Ms + durationSec * 1000;
  const start = darknessFactor({ lat, lng, date: new Date(t0Ms) });
  const arrival = darknessFactor({ lat: destLat, lng: destLng, date: new Date(arriveMs) });
  return {
    leaveAtIso: new Date(t0Ms).toISOString(),
    arriveAtIso: new Date(arriveMs).toISOString(),
    darknessAtStart: round2(start),
    darknessAtArrival: round2(arrival),
    label: timelineLabel(start, arrival),
  };
}

/** meta.time block. */
function buildMetaTime(trip) {
  return {
    mode: trip.mode,
    leaveAtIso: new Date(trip.t0Ms).toISOString(),
    arriveByIso: trip.arriveByMs != null ? new Date(trip.arriveByMs).toISOString() : null,
    timezone: TIMEZONE,
  };
}

const routeDurationSec = (route) =>
  route?.legs?.[0]?.duration?.value ?? route?.duration?.value ?? route?.routeStats?.estimatedDurationSec ?? 0;

/**
 * Re-stamps a (possibly cached or coalesced) response with the REQUESTING trip's instants: meta.time and every
 * route's safety.timeline. Scores and geometry are kept. Returns a copy; the input is never mutated, so the
 * cached object stays as computed. A response without meta.time is returned as is.
 * @param {object} response
 * @param {{request: {leaveAt?: number, arriveBy?: number, departureHour?: number, nowMs: number},
 *   oLat: number, oLng: number, dLat: number, dLng: number}} args
 */
function restampTime(response, { request, oLat, oLng, dLat, dLng }) {
  if (!response?.meta?.time || !Array.isArray(response.routes)) return response;
  // arrive_by: the leave time follows the recommended route's duration; other modes ignore the ETA.
  const trip = resolveTripTime({ ...request, etaSec: routeDurationSec(response.routes[0]) });
  return {
    ...response,
    meta: { ...response.meta, time: buildMetaTime(trip) },
    routes: response.routes.map((route) => {
      if (!route?.safety) return route;
      const timeline = buildTimeline({
        lat: oLat, lng: oLng, destLat: dLat, destLng: dLng, t0Ms: trip.t0Ms, durationSec: routeDurationSec(route),
      });
      return { ...route, safety: { ...route.safety, timeline } };
    }),
  };
}

/**
 * The time component of the route cache key: the mode plus the 15-minute bucket (floor) of the mid-walk
 * instant. Leave-now has no bucket (as before this change): the 5 minute cache TTL bounds its staleness, and a
 * bucket would only add misses at bucket edges.
 */
function cacheTimePart({ leaveAtMs = null, arriveByMs = null, departureHour = null, straightLineDist = 0, nowMs }) {
  const trip = resolveTripTime({
    leaveAt: leaveAtMs,
    arriveBy: arriveByMs,
    departureHour,
    nowMs,
    etaSec: estimateEtaSec(straightLineDist),
  });
  if (trip.mode === 'now') return 'now';
  return `${trip.mode}:${Math.floor(trip.midMs / CACHE_BUCKET_MS)}`;
}

module.exports = {
  WALKING_SPEED_MPS,
  TIMEZONE,
  TIME_HORIZON_MS,
  CACHE_BUCKET_MS,
  ARRIVE_BY_TOLERANCE_SEC,
  INVALID_TIME,
  TIME_OUT_OF_RANGE,
  estimateEtaSec,
  parseTimeParams,
  resolveTripTime,
  needsArriveBySecondPass,
  rescoredTrip,
  timelineLabel,
  buildTimeline,
  buildMetaTime,
  restampTime,
  cacheTimePart,
};
