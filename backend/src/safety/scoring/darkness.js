/**
 * darkness.js — Solar position and darkness factor for lighting inference.
 *
 * Darkness is a smoothstep over solar elevation: 0 at +6 deg (daylight),
 * 1 at -6 deg (dark), smooth in between. Hours are local Europe/London time.
 */

const DEG_TO_RAD = Math.PI / 180;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_MINUS_J2000_DAYS = 10957.5;
const DARKNESS_START_DEG = 6;
const DARKNESS_FULL_DEG = -6;
const LONDON_TZ = 'Europe/London';

const londonFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function norm360(deg) {
  return ((deg % 360) + 360) % 360;
}

function assertLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new TypeError('lat and lng must be finite numbers');
  }
}

function assertDate(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('date must be a valid Date');
  }
}

/**
 * Wall-clock fields of an instant in London, as a UTC-based millisecond value.
 */
function londonWallMs(instantMs) {
  const parts = {};
  for (const { type, value } of londonFormat.formatToParts(instantMs)) {
    parts[type] = Number(value);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/**
 * London UTC offset in milliseconds at the given instant (+3600000 during BST).
 */
function londonOffsetMs(instantMs) {
  const wholeSecondMs = Math.floor(instantMs / 1000) * 1000;
  return londonWallMs(instantMs) - wholeSecondMs;
}

/**
 * Convert a London wall-clock time (as UTC-based ms) to the real instant.
 */
function londonWallToInstantMs(wallMs) {
  const firstGuess = wallMs - londonOffsetMs(wallMs);
  return wallMs - londonOffsetMs(firstGuess);
}

/**
 * Solar elevation above the horizon in degrees (geometric, no refraction).
 * Low-precision almanac method, accurate to about 0.01 deg for 1950-2050.
 */
function sunElevationDeg({ lat, lng, date }) {
  assertLatLng(lat, lng);
  assertDate(date);

  const n = date.getTime() / MS_PER_DAY - UNIX_EPOCH_MINUS_J2000_DAYS;
  const meanLongitude = norm360(280.46 + 0.9856474 * n);
  const meanAnomaly = norm360(357.528 + 0.9856003 * n) * DEG_TO_RAD;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG_TO_RAD;
  const obliquity = (23.439 - 0.0000004 * n) * DEG_TO_RAD;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLongitude),
    Math.cos(eclipticLongitude),
  );
  const gmst = norm360(280.46061837 + 360.98564736629 * n) * DEG_TO_RAD;
  const hourAngle = gmst + lng * DEG_TO_RAD - rightAscension;
  const latRad = lat * DEG_TO_RAD;

  const sinElevation =
    Math.sin(latRad) * Math.sin(declination) +
    Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinElevation))) / DEG_TO_RAD;
}

/**
 * Darkness in [0, 1]: smoothstep of solar elevation, 0 at +6 deg, 1 at -6 deg.
 */
function darknessFactor({ lat, lng, date }) {
  const elevation = sunElevationDeg({ lat, lng, date });
  const span = DARKNESS_START_DEG - DARKNESS_FULL_DEG;
  const x = Math.max(0, Math.min(1, (DARKNESS_START_DEG - elevation) / span));
  return x * x * (3 - 2 * x);
}

/**
 * Darkness at a given London local hour (0-24, may be fractional) on the
 * London calendar day of `now`.
 */
function darknessForHour({ lat, lng, hour, now }) {
  assertLatLng(lat, lng);
  if (!Number.isFinite(hour) || hour < 0 || hour > 24) {
    throw new TypeError('hour must be a number between 0 and 24');
  }
  assertDate(now);

  const today = londonWallMs(now.getTime());
  const localMidnightMs = today - (today % MS_PER_DAY);
  const wallMs = localMidnightMs + Math.round(hour * MS_PER_HOUR);
  const date = new Date(londonWallToInstantMs(wallMs));
  return darknessFactor({ lat, lng, date });
}

module.exports = {
  sunElevationDeg,
  darknessFactor,
  darknessForHour,
};
