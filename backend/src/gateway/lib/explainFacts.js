/**
 * explainFacts.js
 *
 * Deterministic facts about the recommended route. The model only phrases these;
 * it never computes them. Breakdown factor values are safety scores (0-100): higher means safer.
 */

const FACTOR_KEYS = ['roadType', 'lighting', 'crime', 'cctv', 'openPlaces', 'traffic'];
/** Smaller gaps are noise, not a reason to choose one route over another. */
const MIN_FACTOR_GAP = 5;
/** A stretch shorter than this is not worth warning about. */
const LONG_STRETCH_M = 150;
/** Darkness fraction (0-1) from which a moment counts as dark. */
const DARK_FRACTION = 0.5;
/** Overall score gap (points) below which the routes count as only slightly apart. */
const CLOSE_SCORE_POINTS = 3;

const STRENGTH_PHRASES = {
  roadType: 'stronger main roads and paved paths',
  lighting: 'better street lighting',
  crime: 'fewer recorded crimes',
  cctv: 'more CCTV coverage',
  openPlaces: 'more open shops and cafes nearby',
  traffic: 'more foot traffic',
};

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

/** Factors where the chosen route leads every alternative by the gap: reasons in their own right. */
const buildStrengths = (chosenBreakdown, altBreakdowns) => {
  if (altBreakdowns.length === 0 || !chosenBreakdown) return [];
  if (!altBreakdowns.every(Boolean)) return [];
  return FACTOR_KEYS.filter((factor) =>
    altBreakdowns.every((alt) => chosenBreakdown[factor] - alt[factor] >= MIN_FACTOR_GAP),
  ).map((factor) => STRENGTH_PHRASES[factor]);
};

const roundToTen = (metres) => Math.round(metres / 10) * 10;

/** Plain-English risks on the recommended route itself, whichever route the user picks instead. */
const buildRisks = (route) => {
  const risks = [];
  const stretch = route.worstStretch;
  if (stretch && stretch.lengthM >= LONG_STRETCH_M) {
    risks.push(
      stretch.cause === 'lighting'
        ? `a ${roundToTen(stretch.lengthM)} m stretch with no street lighting`
        : `a ${roundToTen(stretch.lengthM)} m stretch of higher risk`,
    );
  }
  if (route.darknessAtStart >= DARK_FRACTION) {
    risks.push('it is already dark when you set off');
  } else if (route.darknessAtArrival >= DARK_FRACTION) {
    risks.push('it gets dark during the walk');
  }
  if (route.deadEnds > 0) risks.push('the route includes a dead end');
  if (route.crimeDataUnavailable) risks.push('crime data is missing for this area, so the score may be too high');
  if (route.lightingQuality === 'estimated') risks.push('street lighting on this route is estimated, not confirmed');
  return risks;
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
      closeScores: alternatives.length > 0 && alternatives.every((a) => Math.abs(a.scoreDelta) < CLOSE_SCORE_POINTS),
      strengths: buildStrengths(
        chosen.breakdown,
        routes.filter((_, idx) => idx !== chosenIdx).map((alt) => alt.breakdown),
      ),
      risks: buildRisks(chosen),
    },
    alternatives,
  };
};

const SYSTEM_PROMPT = [
  'You explain to a pedestrian, in simple plain English, why the recommended walking route is the better choice, and whether they should be careful on it and what to be careful of.',
  '- Use only the facts in the user message. Do not invent places, numbers, incidents or conditions.',
  '- Do not compare routes with each other. Do not mention other routes by number, and do not give distances or times against them.',
  '- Give the main reasons this route is better, in everyday words.',
  '- Say whether the person should be careful. If risks are listed, name them plainly and suggest what to do, for example stay on well-lit main roads, keep to busier streets, or share your location.',
  '- If a risk would apply whichever route is chosen, such as walking in the dark, say so.',
  '- Only talk about darkness, lighting or crime when they are listed in the facts.',
  '- Do not write raw factor names, keys or scores such as "crime=80". Do not use bullet points or generic safety tips.',
  '- Write 3-4 short sentences, under 100 words.',
  '- End with exactly: "Note: scores are estimates based on open data and may not reflect real-time conditions. Always stay aware of your surroundings."',
].join('\n');

const joinPhrases = (items) => {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

/**
 * @param {{chosen: object, alternatives: Array<object>}} facts from buildComparisonFacts
 * @returns {Array<{role: string, content: string}>} chat messages for the model
 */
const buildExplainMessages = (facts) => {
  const { chosen, alternatives } = facts;
  const lines = [`Recommended route: about ${chosen.durationMin} min walk, safety score ${chosen.score} out of 100.`];

  if (alternatives.length === 0) {
    lines.push('Only one route was found.');
  } else if (chosen.closeScores) {
    lines.push('This route is only slightly safer than the other options.');
  }

  if (chosen.strengths.length > 0) {
    lines.push(`Why it is the better choice: ${joinPhrases(chosen.strengths)}.`);
  } else {
    lines.push('No single factor makes it clearly better, so it ranks first on its overall score.');
  }

  if (chosen.risks.length > 0) {
    lines.push('Risks on this route:');
    lines.push(...chosen.risks.map((risk) => `- ${risk}`));
  } else {
    lines.push('No specific risks were found on this route.');
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ];
};

module.exports = { buildComparisonFacts, buildExplainMessages, FACTOR_KEYS, MIN_FACTOR_GAP };
