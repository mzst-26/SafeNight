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
const { validateActions, validateCandidates, routeBoundsReason } = require('../agent/actions');
const { runAgent, buildToolDefinitions } = require('../agent/loop');
const { expansionAllowed: corridorExpansionAllowed } = require('../agent/corridor');

const router = express.Router();

const DEFAULT_AGENT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
// The text model cannot read images (OpenRouter answers 404 "No endpoints found that support image input"),
// so a round with a map picture uses a free vision model that also supports tool calls.
const DEFAULT_AGENT_VISION_MODEL = 'dots-studio/dots-3-note-preview:free';
/** The model for one round: the vision model when the round has a picture, else the text model. */
const chooseAgentModel = ({ snapshot, env = process.env }) =>
  snapshot
    ? env.OPENROUTER_AGENT_VISION_MODEL || DEFAULT_AGENT_VISION_MODEL
    : env.OPENROUTER_AGENT_MODEL || DEFAULT_AGENT_MODEL;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** One model call is capped at this many milliseconds; the loop makes at most 4 calls. */
// One budget for the whole agent request, shared by its model calls. After it runs out the walker
// gets the deterministic response. The app waits longer than this (see agentClient.ts).
const AGENT_BUDGET_MS = 60_000;

/** Milliseconds left for a model call, or 0 when the budget is spent. */
const remainingBudgetMs = (deadline, now = Date.now()) => Math.max(0, deadline - now);
const MAX_ROUTES = 6;
const MAX_ROUNDS = 5;
const MAX_SESSION_NUMBER = 999999;
const MAX_RESULTS = 20;
const MAX_RESULT_TYPE_CHARS = 64;
const MAX_SNAPSHOT_CHARS = 400000;
const SNAPSHOT_RE = /^data:image\/(jpeg|png);base64,/;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_PATH_POINTS = 2000;
const TRIP_TONES = ['morning', 'afternoon', 'evening', 'late'];
const RING_ID_RE = /^r[1-8]$/;
const MAX_RING_IDS = 8;

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
/** A finite {lat, lng} within the usual ranges. */
const isPoint = (value) =>
  isObject(value) &&
  Number.isFinite(value.lat) &&
  Number.isFinite(value.lng) &&
  value.lat >= -90 &&
  value.lat <= 90 &&
  value.lng >= -180 &&
  value.lng <= 180;
const isInteger = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
/** The picture the walker's map shows, as a jpeg or png data URL. Its content is never echoed or logged. */
const snapshotOk = (value) =>
  typeof value === 'string' && value.length <= MAX_SNAPSHOT_CHARS && SNAPSHOT_RE.test(value);
/** Results of the previous round: up to 20 of {type, ok}. Missing means none. Returns the cleaned list, or null. */
const cleanResults = (value) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_RESULTS) return null;
  const cleaned = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.ok !== 'boolean') return null;
    if (typeof item.type !== 'string' || item.type.length < 1 || item.type.length > MAX_RESULT_TYPE_CHARS) return null;
    cleaned.push({ type: item.type, ok: item.ok });
  }
  return cleaned;
};

/**
 * The route's path points, cleaned: at most MAX_PATH_POINTS finite {lat, lng}. Missing means none. Returns the list, or null.
 * The points feed the corridor gate only. They are never sent to the model or logged.
 */
const cleanPath = (value) => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_PATH_POINTS) return null;
  const cleaned = [];
  for (const point of value) {
    if (!isPoint(point)) return null;
    cleaned.push({ lat: point.lat, lng: point.lng });
  }
  return cleaned;
};

/** Ring ids the client offered (r1..r8). Only ids are kept: the model names a ring point by id, never by coordinates. */
const ringIdsFrom = (candidates) => {
  const ids = [];
  for (const c of candidates) {
    if (c && typeof c === 'object' && c.kind === 'ring' && RING_ID_RE.test(c.id) && !ids.includes(c.id)) ids.push(c.id);
  }
  return ids.slice(0, MAX_RING_IDS);
};

/**
 * Validates the body and returns the sanitised parts, or { error } when it is not acceptable.
 * Route fields are sanitised by explain.js sanitizeRoute, the same as /explain-route.
 * Route start and end are not read here: they are not part of the agent request.
 */
const parseRequest = (body) => {
  if (!isObject(body)) return { error: 'Missing required fields: routes, bestRouteId' };
  const { sessionNumber, round, results: rawResults, snapshot, routes: rawRoutes, bestRouteId, candidatePoints, answer, trip } = body;

  if (!isInteger(sessionNumber, 1, MAX_SESSION_NUMBER)) {
    return { error: `sessionNumber must be an integer from 1 to ${MAX_SESSION_NUMBER}` };
  }
  if (!isInteger(round, 1, MAX_ROUNDS)) return { error: `round must be an integer from 1 to ${MAX_ROUNDS}` };
  const results = cleanResults(rawResults);
  if (results === null) {
    return { error: `results must be an array of up to ${MAX_RESULTS} items, each {type: string, ok: boolean}` };
  }
  if (snapshot !== undefined && snapshot !== null && !snapshotOk(snapshot)) {
    return { error: `snapshot must be a jpeg or png data URL of at most ${MAX_SNAPSHOT_CHARS} characters` };
  }
  if (!Array.isArray(rawRoutes) || rawRoutes.length < 1 || rawRoutes.length > MAX_ROUTES) {
    return { error: `routes must be an array of 1 to ${MAX_ROUTES} routes` };
  }
  if (!isId(bestRouteId)) return { error: 'Invalid bestRouteId' };

  const routes = rawRoutes.map((r) => sanitizeRoute(r));
  if (routes.some((r) => r === null)) return { error: 'Invalid routes' };
  const paths = rawRoutes.map((r) => cleanPath(r.path));
  if (paths.some((p) => p === null)) {
    return { error: `route path must be an array of at most ${MAX_PATH_POINTS} points, each a finite lat/lng` };
  }
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
  const tone = trip ? trip.tone : undefined;
  if (tone !== undefined && tone !== null && !TRIP_TONES.includes(tone)) {
    return { error: `trip.tone must be one of ${TRIP_TONES.join(', ')}` };
  }

  return {
    round,
    results,
    snapshot: snapshot || null,
    routes,
    paths,
    tone: tone || null,
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

/** The model call, through OpenRouter, with reasoning off. It never runs past the request's deadline. */
const callOpenRouter = ({ apiKey, model, deadline }) => async ({ messages, tools, toolChoice = 'auto' }) => {
  const budget = remainingBudgetMs(deadline);
  if (budget <= 0) throw new Error('agent time budget used up');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
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
        tool_choice: toolChoice,
        max_tokens: 600,
        temperature: 0.2,
        reasoning: { enabled: false },
      }),
    });
    if (!response.ok) {
      // The provider message is not logged or returned: it can contain key fragments.
      throw new Error(`status ${response.status}`);
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
  // Only the id and kind go into the facts: no label (it can hold an address), no coordinates.
  candidates: candidates.map((c) => ({ id: c.id, kind: c.kind })),
  answer: answer ? { questionId: answer.questionId, choiceId: answer.choiceId } : null,
});

/**
 * POST /api/agent-insights
 *
 * Body: { sessionNumber, round, results?, snapshot?, bestRouteId, routes (max 6, with path?), candidatePoints?, trip?, answer? }
 * Returns: { analysis, decision, message, actions, question? }
 */
router.post('/agent-insights', express.json({ limit: '1mb' }), agentLimiter, async (req, res) => {
  const started = Date.now();
  const parsed = parseRequest(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const { round, results, snapshot, routes, paths, tone, rawRoutes, bestRouteId, candidatePoints, answer } = parsed;
  const analysis = analyseRoutes(routes);
  const boundsReason = routeBoundsReason(rawRoutes);
  if (boundsReason) analysis.boundsReason = boundsReason;
  const decision = decide(routes, bestRouteId);
  const candidates = validateCandidates(candidatePoints, rawRoutes);
  const routeIds = routes.map((r) => r.routeId);
  const candidateIds = candidates.map((c) => c.id);

  // Expansion (contract v3, B1 gate): the app decides, from the recommended route's corridor, the trip tone and darkness.
  const routesWithPaths = routes.map((r, i) => ({ ...r, path: paths[i] }));
  const recommended = routesWithPaths.find((r) => r.routeId === decision.routeId);
  const expansionAllowed = corridorExpansionAllowed({
    routes: routesWithPaths,
    recommendedRouteId: decision.routeId,
    darknessAtStart: recommended ? recommended.darknessAtStart : undefined,
    tone,
  });
  const ringIds = expansionAllowed ? ringIdsFrom(candidatePoints) : [];

  let agent = NO_AGENT_OUTPUT;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[Agent Insights] request: ${routes.length} routes, ${candidates.length} candidates, key ${apiKey ? 'set' : 'MISSING'}`);
  }
  // The model reads the walker's map picture. Without one there is nothing for it to read: no model call.
  if (snapshot !== null && !apiKey) {
    console.error('[Agent Insights] OPENROUTER_API_KEY is not configured; returning the deterministic result');
  } else if (snapshot !== null) {
    const model = chooseAgentModel({ snapshot });
    try {
      agent = await runAgent({
        facts: {
          ...buildFacts({ routes, analysis, decision, candidates, answer }),
          snapshot,
          expansionAllowed,
          routeIds,
          round,
          maxRounds: MAX_ROUNDS,
        },
        tools: buildToolDefinitions({ routeIds, candidateIds, ringIds, expansionAllowed }),
        callModel: callOpenRouter({ apiKey, model, deadline: started + AGENT_BUDGET_MS }),
        validateActions: (raw) => validateActions(raw, { routeIds, candidateIds, ringIds }),
      });
    } catch (error) {
      console.error(`[Agent Insights] agent failed after ${Date.now() - started}ms:`, error.message);
      agent = NO_AGENT_OUTPUT;
    }
  }

  // The model's pick counts only when it names one of this request's routes; otherwise the app's suggestion stands.
  const modelPick = routeIds.includes(agent.recommendedRouteId) ? agent.recommendedRouteId : null;
  const response = {
    status: agent.status === 'continue' && round < MAX_ROUNDS ? 'continue' : 'done',
    round,
    maxRounds: MAX_ROUNDS,
    analysis,
    decision,
    recommendedRouteId: modelPick || decision.routeId,
    message: agent.message || fixedMessage(decision),
    actions: agent.actions,
    expansionAllowed,
  };
  if (agent.question) response.question = agent.question;
  res.json(response);
});

module.exports = router;
module.exports.remainingBudgetMs = remainingBudgetMs;
module.exports.AGENT_BUDGET_MS = AGENT_BUDGET_MS;
module.exports.chooseAgentModel = chooseAgentModel;
module.exports.DEFAULT_AGENT_MODEL = DEFAULT_AGENT_MODEL;
module.exports.DEFAULT_AGENT_VISION_MODEL = DEFAULT_AGENT_VISION_MODEL;
