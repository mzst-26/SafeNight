/**
 * analysis.js
 *
 * Deterministic analysis and route decision for the AI Insights agent (contract G1 and G2).
 * Pure functions: no I/O and no model. The same input always gives the same output.
 * The risk thresholds live in lib/explainFacts.js and are shared with the explain prompt.
 */

const { buildRiskItems, buildStrengths } = require('../lib/explainFacts');

/** A switch is only offered to a route whose score is at most this many points below the recommended one. */
const SWITCH_MAX_SCORE_GAP = 5;
/** A switch target may add at most this many seconds of walking to the recommended route (contract H2). */
const SWITCH_MAX_EXTRA_WALK_SEC = 300;

/** Labels follow input order, as in the explain prompt ("Route 1", "Route 2", ...). */
const routeLabel = (index) => `Route ${index + 1}`;

const risksOf = (analysis, index) => analysis.routes[index].findings.filter((f) => f.severity === 'risk');

/** Contract H2: more than 300 s of extra walking. */
const walksTooLong = (alt, best) => alt.durationSeconds - best.durationSeconds > SWITCH_MAX_EXTRA_WALK_SEC;
/** Contract H2: more than 20% extra distance. Written as 5 * alt > 6 * best (alt > 1.2 * best) to avoid float error. */
const distanceTooLong = (alt, best) => alt.distanceMeters * 5 > best.distanceMeters * 6;
/** Contract H3: a route whose street lighting is only estimated is never a switch target. */
const lightingConfirmed = (route) => route.lightingQuality !== 'estimated';

/** The highest-scoring index in the list; ties keep the earlier one (the list is in input order). */
const highestScoring = (routes, indices) =>
  indices.reduce((a, b) => (routes[b].score > routes[a].score ? b : a));

/**
 * @param {Array<object>} routes sanitised routes (see explain.js sanitizeRoute)
 * @returns {{routes: Array<{routeId: string, findings: Array<{id: string, severity: string, text: string}>}>}}
 */
const analyseRoutes = (routes) => ({
  routes: routes.map((route, index) => {
    const findings = buildRiskItems(route).map(({ id, severity, text }) => ({ id, severity, text }));
    const others = routes.filter((_, i) => i !== index).map((r) => r.breakdown);
    buildStrengths(route.breakdown, others).forEach((phrase, i) => {
      findings.push({ id: `strength_${i + 1}`, severity: 'info', text: `Leads the other routes on ${phrase}.` });
    });
    return { routeId: route.routeId, findings };
  }),
});

/**
 * Keep the recommended route unless a switch target exists. A switch target must satisfy ALL of these:
 *   1. it has no risk findings,
 *   2. its score is at least the recommended score minus SWITCH_MAX_SCORE_GAP,
 *   3. it adds at most 300 s of walking and at most 20% more distance (contract H2),
 *   4. its street lighting is not estimated (contract H3).
 * The recommended route itself must have at least one risk finding.
 * Among qualifying routes the highest score wins; ties go to the earlier route.
 * When none qualifies, the keep reason explains the highest-scoring risk-free route.
 *
 * @returns {{kind: 'keep'|'switch', routeId: string, reasons: string[]}}
 */
const decide = (routes, bestRouteId) => {
  const analysis = analyseRoutes(routes);
  let bestIndex = routes.findIndex((r) => r.routeId === bestRouteId);
  if (bestIndex === -1) bestIndex = 0;
  const best = routes[bestIndex];
  const bestLabel = routeLabel(bestIndex);
  const bestRisks = risksOf(analysis, bestIndex);

  if (bestRisks.length === 0) {
    return { kind: 'keep', routeId: best.routeId, reasons: [`${bestLabel} has no risks.`] };
  }

  const risksSentence = `Be careful: ${bestLabel} has risks: ${bestRisks.map((f) => f.text).join('; ')}.`;
  const keep = (...reasons) => ({ kind: 'keep', routeId: best.routeId, reasons: [risksSentence, ...reasons] });

  if (routes.length === 1) return keep('This is the only route found.');

  const riskFree = routes
    .map((_, i) => i)
    .filter((i) => i !== bestIndex && risksOf(analysis, i).length === 0);
  if (riskFree.length === 0) return keep('No other route is free of risks.');

  const scoreOk = (alt) => alt.score >= best.score - SWITCH_MAX_SCORE_GAP;
  const eligible = riskFree.filter((i) => {
    const alt = routes[i];
    return scoreOk(alt) && !walksTooLong(alt, best) && !distanceTooLong(alt, best) && lightingConfirmed(alt);
  });

  if (eligible.length > 0) {
    const pick = highestScoring(routes, eligible);
    const alt = routes[pick];
    return {
      kind: 'switch',
      routeId: alt.routeId,
      reasons: [
        risksSentence,
        `${routeLabel(pick)} has no risks and scores ${alt.score} out of 100, close to ${best.score} out of 100.`,
      ],
    };
  }

  // No switch target: explain why the highest-scoring risk-free route is not one, checking the cap first.
  const topIndex = highestScoring(routes, riskFree);
  const top = routes[topIndex];
  const topLabel = routeLabel(topIndex);
  if (walksTooLong(top, best) || distanceTooLong(top, best)) {
    return keep(`${topLabel} has no risks but is much longer to walk than ${bestLabel}.`);
  }
  if (!lightingConfirmed(top)) {
    return keep(`${topLabel} has no risks but its street lighting is estimated, not confirmed, so it is not a switch.`);
  }
  return keep(
    `${topLabel} has no risks but scores ${top.score} out of 100, well below ${best.score} out of 100.`,
  );
};

module.exports = { analyseRoutes, decide, routeLabel, SWITCH_MAX_SCORE_GAP };
