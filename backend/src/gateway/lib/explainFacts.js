/**
 * explainFacts.js
 *
 * Deterministic comparison of the recommended route against the alternatives.
 * The model only phrases these facts; it never computes them.
 * Breakdown factor values are safety scores (0-100): higher means safer.
 */

const FACTOR_KEYS = ['roadType', 'lighting', 'crime', 'cctv', 'openPlaces', 'traffic'];
/** Smaller gaps are noise, not a reason to choose one route over another. */
const MIN_FACTOR_GAP = 5;

const indexOfChosen = (routes, bestRouteId) => {
  const idx = routes.findIndex((r) => r.routeId === bestRouteId);
  return idx === -1 ? 0 : idx;
};

/** Factor gaps as chosen minus alternative: advantages are chosen-safer, disadvantages are alternative-safer. */
const factorGaps = (chosenBreakdown, altBreakdown) => {
  const advantages = [];
  const disadvantages = [];
  if (!chosenBreakdown || !altBreakdown) return { advantages, disadvantages };

  for (const factor of FACTOR_KEYS) {
    const delta = Math.round(chosenBreakdown[factor] - altBreakdown[factor]);
    if (delta >= MIN_FACTOR_GAP) advantages.push({ factor, delta });
    else if (delta <= -MIN_FACTOR_GAP) disadvantages.push({ factor, delta });
  }

  advantages.sort((a, b) => b.delta - a.delta);
  disadvantages.sort((a, b) => a.delta - b.delta);
  return { advantages, disadvantages };
};

/**
 * @param {Array<object>} routes sanitised routes, safest first
 * @param {string} bestRouteId id of the recommended route (falls back to the first route)
 * @returns {{chosen: object, alternatives: Array<object>}}
 *   Distance, time and score deltas are chosen minus alternative, so a positive
 *   distance or time delta means the recommended route is longer.
 */
const buildComparisonFacts = (routes, bestRouteId) => {
  const chosenIdx = indexOfChosen(routes, bestRouteId);
  const chosen = routes[chosenIdx];

  const alternatives = routes
    .map((alt, idx) => ({ alt, idx }))
    .filter(({ idx }) => idx !== chosenIdx)
    .map(({ alt, idx }) => {
      const { advantages, disadvantages } = factorGaps(chosen.breakdown, alt.breakdown);
      return {
        label: `Route ${idx + 1}`,
        distanceDeltaM: Math.round(chosen.distanceMeters - alt.distanceMeters),
        durationDeltaMin: Math.round((chosen.durationSeconds - alt.durationSeconds) / 60),
        scoreDelta: Math.round(chosen.score - alt.score),
        comparable: Boolean(chosen.breakdown && alt.breakdown),
        advantages,
        disadvantages,
      };
    });

  return {
    chosen: {
      routeId: chosen.routeId,
      distanceM: Math.round(chosen.distanceMeters),
      durationMin: Math.max(1, Math.round(chosen.durationSeconds / 60)),
      score: Math.round(chosen.score),
    },
    alternatives,
  };
};


const FACTOR_LABELS = {
  roadType: 'main-road and paved-path quality',
  lighting: 'street lighting',
  crime: 'fewer recorded crimes',
  cctv: 'CCTV coverage',
  openPlaces: 'open shops and venues',
  traffic: 'foot traffic',
};

/** Points below which the scores are too close to justify a strong claim. */
const SIMILAR_SCORE_GAP = 3;

const SYSTEM_PROMPT = [
  'You explain to a pedestrian why the recommended walking route was chosen over the other routes shown.',
  '- Use only the facts in the user message. Do not invent numbers, places, incidents or conditions.',
  '- Each factor value is a safety score from 0 to 100, where higher means safer.',
  '- Explain why the recommended route beats each alternative: name its most important advantages, then the trade-off (how much longer or shorter it is, and any factor where the alternative is safer).',
  '- If the safety scores are very close, say the routes are similar in safety and explain what still puts the recommended route first.',
  '- Use plain English. Do not write raw factor names, keys or formulas such as "crime=80".',
  '- Write 2-3 sentences, under 100 words. No bullet points, no generic safety tips.',
  '- End with exactly: "Note: scores are estimates based on open data and may not reflect real-time conditions. Always stay aware of your surroundings."',
].join('\n');

/** Gaps are named by factor; the caller says which route is the safer one. */
const describeGaps = (gaps) =>
  gaps.map((g) => `${FACTOR_LABELS[g.factor]} (about ${Math.abs(g.delta)} points)`).join('; ');


/** Plain-English user message: the facts only, no raw keys. */
const describeTrip = (alt) => {
  const sameDistance = alt.distanceDeltaM === 0;
  const sameTime = alt.durationDeltaMin === 0;
  if (sameDistance && sameTime) return 'the same distance and time as this route';

  const parts = [];
  if (!sameDistance) parts.push(`${Math.abs(alt.distanceDeltaM)} m ${alt.distanceDeltaM > 0 ? 'longer' : 'shorter'}`);
  if (!sameTime) parts.push(`${Math.abs(alt.durationDeltaMin)} min ${alt.durationDeltaMin > 0 ? 'longer' : 'shorter'}`);
  return `${parts.join(' and ')} than this route`;
};

const describeAlternative = (alt, chosen) => {
  const lines = [
    `- ${alt.label}: the recommended route is ${describeTrip(alt)}. Its safety score is ${chosen.score - alt.scoreDelta} (recommended: ${chosen.score}).`,
  ];
  if (!alt.comparable) {
    lines.push('  Factor details are not available for this comparison.');
    return lines.join('\n');
  }
  lines.push(
    alt.advantages.length > 0
      ? `  Recommended route is safer on: ${describeGaps(alt.advantages)}.`
      : '  Recommended route has no clear safety advantage on any factor.',
  );
  lines.push(
    alt.disadvantages.length > 0
      ? `  This route is safer on: ${describeGaps(alt.disadvantages)}.`
      : '  This route has no clear safety advantage on any factor.',
  );
  return lines.join('\n');
};

/**
 * @param {{chosen: object, alternatives: Array<object>}} facts from buildComparisonFacts
 * @returns {Array<{role: string, content: string}>} chat messages for the model
 */
const buildExplainMessages = (facts) => {
  const { chosen, alternatives } = facts;
  const lines = [
    `Recommended route: ${chosen.distanceM} m, about ${chosen.durationMin} min, safety score ${chosen.score}/100.`,
  ];

  if (alternatives.length === 0) {
    lines.push('Only one route was found, so there is nothing to compare against.');
  } else {
    const closeScores = alternatives.every((a) => Math.abs(a.scoreDelta) < SIMILAR_SCORE_GAP);
    if (closeScores) lines.push(`All safety scores are within ${SIMILAR_SCORE_GAP} points of each other.`);
    lines.push('Alternatives:');
    lines.push(...alternatives.map((alt) => describeAlternative(alt, chosen)));
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ];
};

module.exports = { buildComparisonFacts, buildExplainMessages, FACTOR_KEYS, MIN_FACTOR_GAP };

