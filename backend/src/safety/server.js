/**
 * SafeNight — Safety Compute Service
 *
 * CPU-intensive service that handles:
 * - A* pathfinding with safety-weighted cost function
 * - Overpass API data fetching (roads, lights, CCTV, transit)
 * - UK Police crime data with severity weighting
 * - Pre-computed coverage maps (lighting, crime density)
 * - K-diverse route computation with iterative penalty
 *
 * This service is CPU-bound and benefits from running on a
 * dedicated instance separate from the lightweight API gateway.
 *
 * Optimisations:
 * - Request coalescing (identical concurrent requests share computation)
 * - 5-minute route cache
 * - 30-minute Overpass data cache
 * - 24-hour crime data cache
 * - Spatial grid indexing with O(1) lookups
 * - Float32Array coverage maps (~25m cell resolution)
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const os = require('os');

const { createCorsMiddleware } = require('../shared/middleware/cors');
const { createRateLimiter } = require('../shared/middleware/rateLimiter');
const { errorHandler } = require('../shared/middleware/errorHandler');
const { healthCheck } = require('../shared/middleware/healthCheck');

const safeRoutesRouter = require('./routes/safeRoutes');

const app = express();
const PORT = process.env.PORT || 3002;
const SAFE_ROUTES_CACHE_DIR = (process.env.SAFE_ROUTES_CACHE_DIR || '').trim();

// ─── Trust proxy (Render / reverse-proxy sets X-Forwarded-For) ────────────────
app.set('trust proxy', 1);

// ─── Security headers ───────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(createCorsMiddleware());

// ─── Rate limiting — 60 req / 15 min (lower: expensive operations) ──────────
app.use('/api/', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 60 }));

// ─── Body parser ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/safe-routes', safeRoutesRouter);

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/api/health', healthCheck('safety-service'));

// ─── Error handler ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const parallelism = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : Math.max(1, os.cpus()?.length || 1);
  console.log(`[safety] Safety Compute Service running on http://0.0.0.0:${PORT}`);
  console.log(`[safety] Routes: safe-routes (A* pathfinding)`);
  console.log(`[safety] Rate limit: 60 req / 15 min per IP`);
  console.log(`[safety] Runtime: node=${process.version}, parallelism=${parallelism}`);
  console.log(`[safety] Queue controls: maxConcurrent=${process.env.SAFE_ROUTES_MAX_CONCURRENT || 'auto'}, maxLoadUnits=${process.env.SAFE_ROUTES_MAX_SERVER_LOAD_UNITS || 'auto'}, maxQueue=${process.env.SAFE_ROUTES_MAX_QUEUE_LENGTH || 200}, maxQueueWaitMs=${process.env.SAFE_ROUTES_MAX_QUEUE_WAIT_MS || 180000}`);
  if (SAFE_ROUTES_CACHE_DIR) {
    console.log(`[safety] Persistent cache: enabled (SAFE_ROUTES_CACHE_DIR=${SAFE_ROUTES_CACHE_DIR})`);
  } else {
    console.log('[safety] Persistent cache: disabled (set SAFE_ROUTES_CACHE_DIR to enable)');
  }
});
