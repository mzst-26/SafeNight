/**
 * crimeSeverity.js — Severity of each UK Police API crime category.
 *
 * The single source of the category table. Used by the legacy crime client (to tag each
 * crime) and by the scoring model (to weight crimes), so the two can never disagree.
 * Severity runs from 0 to 1: violent crime is most severe, shoplifting least.
 */

const { CRIME } = require('../scoring/config');

/** Police API category slug -> severity in (0, 1]. */
const CRIME_SEVERITY = Object.freeze({
  'violent-crime': 1.0,
  robbery: 1.0,
  'sexual-offences': 1.0,
  'possession-of-weapons': 0.9,
  'public-order': 0.7,
  'criminal-damage-arson': 0.6,
  burglary: 0.5,
  'vehicle-crime': 0.4,
  drugs: 0.4,
  'theft-from-the-person': 0.8, // direct threat to pedestrians
  'bicycle-theft': 0.3,
  shoplifting: 0.2,
  'other-theft': 0.3,
  'anti-social-behaviour': 0.3,
  'other-crime': 0.4,
  unknown: 0.4,
});

/**
 * Severity of a crime category. Anything not in the table (including a missing or
 * non-string category, and inherited object keys such as 'constructor') gets the
 * single fallback CRIME.SEVERITY_FALLBACK (0.4) from config.
 *
 * @param {*} category Police API crime category slug.
 * @returns {number} Severity in (0, 1].
 */
function severityOf(category) {
  return Object.prototype.hasOwnProperty.call(CRIME_SEVERITY, category)
    ? CRIME_SEVERITY[category]
    : CRIME.SEVERITY_FALLBACK;
}

module.exports = { CRIME_SEVERITY, severityOf };
