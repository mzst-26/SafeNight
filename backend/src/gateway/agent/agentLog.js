/**
 * agentLog.js — step-by-step debug log for the AI Insights agent.
 *
 * Development only (NODE_ENV !== 'production'). Callers pass counts, ids of the app's own choosing, timings and
 * status codes only. Never pass coordinates, the picture, the API key, a route path or the walker's words.
 */
const agentLog = (step, fields = {}) => {
  if (process.env.NODE_ENV === 'production') return;
  console.log(`[Agent] ${step} ${JSON.stringify(fields)}`);
};

module.exports = { agentLog };
