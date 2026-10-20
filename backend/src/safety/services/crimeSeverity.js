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

/**
 * Pedestrian relevance of each category: how much a recorded crime says about danger to someone walking past.
 * Distinct from severity (how serious the offence is): a shoplifting or a stolen car is serious for its victim
 * but says little about a walker's risk, while a street assault says a lot. Used by the crime factor in the graph.
 */
const PEDESTRIAN_RELEVANCE = Object.freeze({
  'violent-crime': 1.0,
  robbery: 1.0,
  'sexual-offences': 1.0,
  'theft-from-the-person': 0.8,
  'possession-of-weapons': 0.9,
  'public-order': 0.5,
  'criminal-damage-arson': 0.4,
  burglary: 0.2,
  'vehicle-crime': 0.1,
  drugs: 0.2,
  'other-crime': 0.3,
  'anti-social-behaviour': 0.2,
  'other-theft': 0.15,
  shoplifting: 0.05,
  'bicycle-theft': 0.05,
});

// Offences against the person or carried on the person: never discounted for footfall, because a crowd does not
// make them less relevant to someone walking there. Theft from the person (pickpocketing, snatching) and possession
// of weapons are in this pool on purpose even though neither is strictly "violent crime": both happen to people in
// the street and they are the kinds of crime a busy place breeds rather than dilutes (crowds are where pockets are
// picked), so dividing them by presence would hide exactly the risk a pedestrian faces in a busy centre.
const VIOLENT_CATEGORIES = Object.freeze(new Set([
  'violent-crime', 'robbery', 'sexual-offences', 'theft-from-the-person', 'possession-of-weapons',
]));

/** Pedestrian relevance of a category in (0, 1]; anything not in the table takes CRIME.RELEVANCE_FALLBACK. */
function relevanceOf(category) {
  return Object.prototype.hasOwnProperty.call(PEDESTRIAN_RELEVANCE, category)
    ? PEDESTRIAN_RELEVANCE[category]
    : CRIME.RELEVANCE_FALLBACK;
}

/** True for the violent pool (never discounted for footfall). */
function isViolentCategory(category) {
  return typeof category === 'string' && VIOLENT_CATEGORIES.has(category);
}

module.exports = {
  CRIME_SEVERITY, severityOf, PEDESTRIAN_RELEVANCE, relevanceOf, isViolentCategory,
};
