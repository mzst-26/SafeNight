/**
 * agentInsights.js
 *
 * POST /api/agent-insights (contract G1 to G4 in docs/ai-insights-task-sheet.md).
 *
 * The analysis and the route decision are computed here in code (lib/explainFacts thresholds).
 * The model only chooses among candidate ids and allowed actions, and phrases the message.
 * Any model failure still returns 200 with the deterministic analysis, decision and fixed message.
 * No map or app code runs here: the server returns actions and the client runs them.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { sanitizeRoute } = require('./explain');
const { analyseRoutes, decide, routeLabel } = require('../agent/analysis');
const { validateActions, validateCandidates, cleanText } = require('../agent/actions');
const { runAgent, buildToolDefinitions } = require('../agent/loop');

const router = express.Router();

const DEFAULT_AGENT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** One model call is capped at this many milliseconds; the loop makes at most 4 calls. */
const MODEL_CALL_TIMEOUT_MS = 10_000;
const MAX_ROUTES = 3;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

// ─── Per-IP limit: each request can cost up to 4 paid model calls ───────────────
const AGENT_WINDOW_MS = 15 * 60 * 1000;
const AGENT_MAX_PER_WINDOW = 20;
const agentLimiter = rateLimit({
  windowMs: AGENT_WINDOW_MS,
  max: AGENT_MAX_PER_WINDOW,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many insight requests — please try again later.',
      retry_after: Math.ceil(AGENT_WINDOW_MS / 1000),
    });
  },
});

const isId = (value) => typeof value === 'string' && ID_RE.test(value);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Validates the body and returns the sanitised parts, or { error } when it is not acceptable.
 * Route fields are sanitised by explain.js sanitizeRoute, the same as /explain-route.
 */
const parseRequest = (body) => {
  if (!isObject(body)) return { error: 'Missing required fields: routes, bestRouteId' };
  const { routes: rawRoutes, bestRouteId, candidatePoints, answer, trip } = body;

  if (!Array.isArray(rawRoutes) || rawRoutes.length < 1 || rawRoutes.length > MAX_ROUTES) {
    return { error: `routes must be an array of 1 to ${MAX_ROUTES} routes` };
  }
  if (!isId(bestRouteId)) return { error: 'Invalid bestRouteId' };

  const routes = rawRoutes.map((r) => sanitizeRoute(r));
  if (routes.some((r) => r === null)) return { error: 'Invalid routes' };
  if (!routes.some((r) => r.routeId === bestRouteId)) {
    return { error: 'bestRouteId must match one of the routes' };
  }
  if (candidatePoints !== undefined && candidatePoints !== null && !Array.isArray(candidatePoints)) {
    return { error: 'candidatePoints must be an array' };
  }
  if (answer !== undefined && answer !== null && !(isObject(answer) && isId(answer.questionId) && isId(answer.choiceId))) {
    return { error: 'Invalid answer' };
  }
  if (trip !== undefined && trip !== null && !(isObject(trip) && (trip.leaveAtIso === undefined || typeof trip.leaveAtIso === 'string'))) {
    return { error: 'Invalid trip' };
  }

  return {
    routes,
    rawRoutes,
    bestRouteId,
    candidatePoints: candidatePoints || [],
    answer: answer || null,
  };
};

/** The deterministic message, built from the decision's fixed reasons. Used when the model's message is not usable. */
const fixedMessage = (decision) => {
  const switchLine = decision.kind === 'switch' ? ["Tap 'Use this route' to take the other route."] : [];
  return [...decision.reasons, ...switchLine, 'Stay aware of your surroundings.'].join(' ');
};

/** The model call, through OpenRouter, with reasoning off and a per-call timeout. */
const callOpenRouter = ({ apiKey, model }) => async ({ messages, tools }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_CALL_TIMEOUT_MS);
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Title': 'SafeNight',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 600,
        temperature: 0.2,
        reasoning: { enabled: false },
      }),
    });
    if (!response.ok) {
      // The provider message is not logged or returned: it can contain key fragments.
      throw new Error(`agent model call failed with status ${response.status}`);
    }
    const data = await response.json();
    return data?.choices?.[0]?.message ?? null;
  } finally {
    clearTimeout(timer);
  }
};

const NO_AGENT_OUTPUT = Object.freeze({ actions: [], question: null, message: null });

/** Facts the model may read. Everything here was computed by the app, except the client labels, which are cleaned. */
const buildFacts = ({ routes, analysis, decision, candidates, answer }) => ({
  routes: routes.map((route, index) => ({
    label: routeLabel(index),
    routeId: route.routeId,
    durationMin: Math.max(1, Math.round(route.durationSeconds / 60)),
    score: route.score,
    risks: analysis.routes[index].findings.filter((f) => f.severity === 'risk').map((f) => f.text),
    strengths: analysis.routes[index].findings.filter((f) => f.severity === 'info').map((f) => f.text),
  })),
  decision: {
    kind: decision.kind,
    label: routeLabel(routes.findIndex((r) => r.routeId === decision.routeId)),
    reasons: decision.reasons,
  },
  candidates: candidates.map((c) => ({ ...c, label: cleanText(c.label) })),
  answer: answer ? { questionId: answer.questionId, choiceId: answer.choiceId } : null,
});

/**
 * POST /api/agent-insights
 *
 * Body: { bestRouteId, routes (max 3), candidatePoints?, trip?, answer? }
 * Returns: { analysis, decision, message, actions, question? }
 */
router.post('/agent-insights', express.json({ limit: '450kb' }), agentLimiter, async (req, res) => {
  const started = Date.now();
  const parsed = parseRequest(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const { routes, rawRoutes, bestRouteId, candidatePoints, answer } = parsed;
  const analysis = analyseRoutes(routes);
  const decision = decide(routes, bestRouteId);
  const candidates = validateCandidates(candidatePoints, rawRoutes);
  const routeIds = routes.map((r) => r.routeId);
  const candidateIds = candidates.map((c) => c.id);

  let agent = NO_AGENT_OUTPUT;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('[Agent Insights] OPENROUTER_API_KEY is not configured; returning the deterministic result');
  } else {
    const model = process.env.OPENROUTER_AGENT_MODEL || DEFAULT_AGENT_MODEL;
    try {
      agent = await runAgent({
        facts: buildFacts({ routes, analysis, decision, candidates, answer }),
        tools: buildToolDefinitions({ routeIds, candidateIds }),
        callModel: callOpenRouter({ apiKey, model }),
        validateActions: (raw) => validateActions(raw, { routeIds, candidateIds }),
      });
    } catch (error) {
      console.error(`[Agent Insights] agent failed after ${Date.now() - started}ms:`, error.message);
      agent = NO_AGENT_OUTPUT;
    }
  }

  const response = {
    analysis,
    decision,
    message: agent.message || fixedMessage(decision),
    actions: agent.actions,
  };
  if (agent.question) response.question = agent.question;
  res.json(response);
});

module.exports = router;
