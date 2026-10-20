/**
 * The time context of one graph build: the London hour, the darkness at that time and place, the factor
 * weights, and the normalised crime status.
 */
const { darknessForHour } = require('../../scoring/darkness');
const { getWeights } = require('../../scoring/weights');
const { CRIME_STATUS } = require('../../scoring/config');

const LONDON_HOUR_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: 'numeric',
  hourCycle: 'h23',
});

/** London wall-clock hour (0-23) of an instant. */
function londonHourOf(date) {
  const part = LONDON_HOUR_FORMAT.formatToParts(date).find((p) => p.type === 'hour');
  return Number(part.value) % 24;
}

/**
 * Crime status as the graph understands it. Only an explicit 'ok' counts as data; a missing or unrecognised
 * value is an outage, so a caller that forgets to pass it gets the cautious answer, never "no crime".
 * @param {*} status
 * @returns {'ok'|'unavailable'}
 */
function normalizeCrimeStatus(status) {
  return status === CRIME_STATUS.OK ? CRIME_STATUS.OK : CRIME_STATUS.UNAVAILABLE;
}

/**
 * @param {{north: number, south: number, east: number, west: number}} bbox
 * @param {{hour?: number, now?: Date, level?: string, crimeStatus?: string}} options
 * @returns {{now: Date, hour: number, darkness: number, weights: object, crimeStatus: string}}
 */
function resolveBuildClock(bbox, options) {
  const now = options.now instanceof Date ? options.now : new Date();
  const hour = options.hour != null ? options.hour : londonHourOf(now);
  const darkness = darknessForHour({
    lat: (bbox.north + bbox.south) / 2,
    lng: (bbox.east + bbox.west) / 2,
    hour,
    now,
  });
  return {
    now,
    hour,
    darkness,
    weights: getWeights({ darkness, safetyLevel: options.level }),
    crimeStatus: normalizeCrimeStatus(options.crimeStatus),
  };
}

module.exports = { londonHourOf, normalizeCrimeStatus, resolveBuildClock };
