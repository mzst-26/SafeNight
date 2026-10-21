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

/** Labels follow input order, as in the explain prompt ("Route 1", "Route 2", ...). */
const routeLabel = (index) => `Route ${index + 1}`;

const risksOf = (analysis, index) => analysis.routes[index].findings.filter((f) => f.severity === 'risk');

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
 * Keep the recommended route unless ALL of these hold:
 *   1. it has at least one risk finding,
 *   2. another route has zero risk findings,
 *   3. that route's score is at least the recommended score minus SWITCH_MAX_SCORE_GAP.
 * Among qualifying routes the highest score wins; ties go to the earlier route.
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

  // Highest score first; riskFree is in input order, so a tie keeps the earlier route.
  const pick = riskFree.reduce((a, b) => (routes[b].score > routes[a].score ? b : a));
  const alt = routes[pick];
  const altLabel = routeLabel(pick);

  if (alt.score >= best.score - SWITCH_MAX_SCORE_GAP) {
    return {
      kind: 'switch',
      routeId: alt.routeId,
      reasons: [
        risksSentence,
        `${altLabel} has no risks and scores ${alt.score} out of 100, close to ${best.score} out of 100.`,
      ],
    };
  }
  return keep(
    `${altLabel} has no risks but scores ${alt.score} out of 100, well below ${best.score} out of 100.`,
  );
};

module.exports = { analyseRoutes, decide, routeLabel, SWITCH_MAX_SCORE_GAP };
