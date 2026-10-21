/**
 * The five factors SafeNight scores each street segment on.
 * Source: backend/src/safety/scoring/config.js (BASE_WEIGHTS).
 * Used by the structured data featureList and the home page intro.
 */
export const FACTOR_NAMES = [
  'Street lighting',
  'Crime density',
  'Road type',
  'Nearby activity',
  'Isolation',
];
