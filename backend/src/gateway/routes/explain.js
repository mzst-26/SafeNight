/**
 * explain.js
 *
 * Backend endpoint for AI route explanation.
 * Receives AGGREGATED route data (no per-segment data) and calls OpenAI.
 * Caches explanations for 1 hour to minimise API costs.
 * Limits to top 3 routes. The comparison is computed in lib/explainFacts.js; the model only phrases it.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { buildComparisonFacts, buildExplainMessages } = require('../lib/explainFacts');
const router = express.Router();

// Bump when the prompt or the facts change so cached explanations are not served stale.
const PROMPT_VERSION = 'v2';
// Cheapest model we can verify; override with OPENAI_EXPLAIN_MODEL once pricing is checked.
const EXPLAIN_MODEL = process.env.OPENAI_EXPLAIN_MODEL || 'gpt-4o-mini';

// ─── Per-IP limit for the paid LLM call ──────────────────────────────────────
// Keyed by IP only: this route is unauthenticated, so a Bearer token here is
// not verified and must not be able to mint fresh buckets.
const EXPLAIN_WINDOW_MS = 15 * 60 * 1000;
const EXPLAIN_MAX_PER_WINDOW = 20;
const explainLimiter = rateLimit({
  windowMs: EXPLAIN_WINDOW_MS,
  max: EXPLAIN_MAX_PER_WINDOW,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too many explanation requests — please try again later.',
      retry_after: Math.ceil(EXPLAIN_WINDOW_MS / 1000),
    });
  },
});

// ─── Input sanitising (everything here ends up in the LLM prompt) ───────────
const MAX_ID_LENGTH = 64;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const ROAD_TYPE_KEY_RE = /^[A-Za-z0-9_]{1,32}$/;
const MAX_ROAD_TYPES = 12;

/** Coerce to a finite number clamped to [min, max]; anything else becomes 0. */
const num = (value, min = 0, max = 1e7) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
};

const sanitizeRoute = (r) => {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const routeId = typeof r.routeId === 'string' || typeof r.routeId === 'number' ? String(r.routeId) : '';
  if (!ID_RE.test(routeId)) return null;
  const out = {
    routeId,
    distanceMeters: num(r.distanceMeters, 0, 1e6),
    durationSeconds: num(r.durationSeconds, 0, 1e6),
    score: Math.round(num(r.score, 0, 100)),
  };
  if (r.breakdown && typeof r.breakdown === 'object') {
    const b = r.breakdown;
    out.breakdown = {
      roadType: num(b.roadType, 0, 100),
      lighting: num(b.lighting, 0, 100),
      crime: num(b.crime, 0, 100),
      cctv: num(b.cctv, 0, 100),
      openPlaces: num(b.openPlaces, 0, 100),
      traffic: num(b.traffic, 0, 100),
    };
  }
  if (r.totals && typeof r.totals === 'object') {
    const t = r.totals;
    out.totals = {
      crimes: Math.round(num(t.crimes)),
      lights: Math.round(num(t.lights)),
      cctv: Math.round(num(t.cctv)),
      places: Math.round(num(t.places)),
      busStops: Math.round(num(t.busStops)),
      deadEnds: Math.round(num(t.deadEnds)),
    };
  }
  if (r.roadData && typeof r.roadData === 'object') {
    const rd = r.roadData;
    const roadTypes = {};
    if (rd.roadTypes && typeof rd.roadTypes === 'object') {
      for (const [k, v] of Object.entries(rd.roadTypes)) {
        if (Object.keys(roadTypes).length >= MAX_ROAD_TYPES) break;
        if (ROAD_TYPE_KEY_RE.test(k)) roadTypes[k] = Math.round(num(v, 0, 100));
      }
    }
    out.roadData = {
      mainRoadPct: Math.round(num(rd.mainRoadPct, 0, 100)),
      pavedPct: Math.round(num(rd.pavedPct, 0, 100)),
      sidewalkPct: Math.round(num(rd.sidewalkPct, 0, 100)),
      roadTypes: Object.keys(roadTypes).length > 0 ? roadTypes : null,
    };
  }
  return out;
};

// ─── 1-hour explanation cache ────────────────────────────────────────────────
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_ENTRIES = 1000;
const explanationCache = new Map(); // key → { explanation, timestamp }
const inFlightExplanations = new Map(); // key → Promise<string>

/** Evict expired entries (runs on each request, lightweight) */
const evictExpired = () => {
  const now = Date.now();
  for (const [key, entry] of explanationCache) {
    if (now - entry.timestamp > CACHE_TTL) explanationCache.delete(key);
  }
  // Map iterates in insertion order, so this drops the oldest entries first.
  while (explanationCache.size >= MAX_CACHE_ENTRIES) {
    explanationCache.delete(explanationCache.keys().next().value);
  }
};

/** Build a stable cache key from route data */
const buildCacheKey = (routes, bestRouteId) => {
  // Order is kept on purpose: "Route N" labels follow the input order.
  const routePart = routes
    .map((r) => `${r.routeId}:${r.distanceMeters}:${r.durationSeconds}:${r.score}:${JSON.stringify(r.breakdown ?? null)}`)
    .join('|');
  return `${routePart}__best=${bestRouteId}__${PROMPT_VERSION}`;
};

/**
 * POST /api/explain-route
 *
 * Body (compact — no segments):
 * {
 *   routes: CompactRouteInfo[] (max 3),
 *   bestRouteId: string
 * }
 *
 * Returns: { explanation: string, cached: boolean }
 */
router.post('/explain-route', explainLimiter, async (req, res) => {
  const requestStartedAt = Date.now();
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('[Explain Route] OPENAI_API_KEY is not configured');
      return res
        .status(500)
        .json({ error: 'Route explanation is unavailable' });
    }

    const { routes: rawRoutes, bestRouteId: rawBestRouteId } = req.body || {};

    // Validate input
    if (!rawRoutes || !Array.isArray(rawRoutes) || !rawBestRouteId) {
      return res.status(400).json({
        error: 'Missing required fields: routes, bestRouteId',
      });
    }

    const bestRouteId = String(rawBestRouteId);
    if (bestRouteId.length > MAX_ID_LENGTH || !ID_RE.test(bestRouteId)) {
      return res.status(400).json({ error: 'Invalid bestRouteId' });
    }

    // Limit to top 3 routes and keep only typed, bounded fields
    const routes = rawRoutes.slice(0, 3).map(sanitizeRoute);
    if (routes.length === 0 || routes.some((r) => r === null)) {
      return res.status(400).json({ error: 'Invalid routes' });
    }
    if (!routes.some((r) => r.routeId === bestRouteId)) {
      return res.status(400).json({ error: 'bestRouteId must match one of the routes' });
    }

    // ── Check cache ──
    evictExpired();
    const cacheKey = buildCacheKey(routes, bestRouteId);
    const cached = explanationCache.get(cacheKey);
    if (cached) {
      console.log(`[OpenAI] ✅ Cache hit — skipping API call (${Date.now() - requestStartedAt}ms total)`);
      return res.json({ explanation: cached.explanation, cached: true });
    }

    const inFlight = inFlightExplanations.get(cacheKey);
    if (inFlight) {
      console.log('[OpenAI] ♻️ Reusing in-flight explanation request');
      const explanation = await inFlight;
      return res.json({ explanation, cached: false });
    }

    // ── Build the comparison facts and the chat messages (facts are computed, the model only phrases them) ──
    const messages = buildExplainMessages(buildComparisonFacts(routes, bestRouteId));

    const startedOpenAIAt = Date.now();
    console.log(`[OpenAI] 🌐 API call → ${EXPLAIN_MODEL} (${PROMPT_VERSION}, ${messages.length} messages)`);

    const requestPromise = (async () => {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: EXPLAIN_MODEL,
          messages,
          max_tokens: 200,
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // Log the provider message server-side only: it can contain key fragments.
        console.error(`[OpenAI] ❌ status=${response.status}: ${errorData?.error?.message || 'unknown error'}`);
        const err = new Error('Route explanation is temporarily unavailable');
        err.statusCode = 502;
        err.expose = true;
        throw err;
      }

      const data = await response.json();
      const explanation =
        data?.choices?.[0]?.message?.content?.trim() ||
        'Unable to generate explanation';

      explanationCache.set(cacheKey, {
        explanation,
        timestamp: Date.now(),
      });

      return explanation;
    })();

    inFlightExplanations.set(cacheKey, requestPromise);

    let explanation;
    try {
      explanation = await requestPromise;
    } finally {
      const active = inFlightExplanations.get(cacheKey);
      if (active === requestPromise) inFlightExplanations.delete(cacheKey);
    }

    console.log(
      `[OpenAI] ✅ Success (${explanation.length} chars), OpenAI ${Date.now() - startedOpenAIAt}ms, total ${Date.now() - requestStartedAt}ms`
    );

    res.json({ explanation, cached: false });
  } catch (error) {
    console.error(`[Explain Route] Error after ${Date.now() - requestStartedAt}ms:`, error.message);
    if (error.expose) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: 'Route explanation is temporarily unavailable' });
  }
});

module.exports = router;
module.exports.MAX_CACHE_ENTRIES = MAX_CACHE_ENTRIES;
