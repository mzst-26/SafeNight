/**
 * SafeNight — API Gateway Service
 *
 * Lightweight proxy service that handles:
 * - Walking directions (OSRM)
 * - Static map tiles (OSM)
 * - Nearby places (Overpass)
 * - AI route explanations (OpenAI)
 *
 * Place search and geocoding have been moved to the dedicated
 * Geocode microservice (port 3005) for better isolation and caching.
 *
 * This service is I/O-bound (proxying external APIs) and uses
 * minimal CPU/memory, making it ideal for Render free tier.
 *
 * Security: Helmet headers, CORS whitelist, rate limiting, input validation.
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');

const { createCorsMiddleware } = require('../shared/middleware/cors');
const { createRateLimiter } = require('../shared/middleware/rateLimiter');
const { errorHandler } = require('../shared/middleware/errorHandler');
const { healthCheck } = require('../shared/middleware/healthCheck');

// Route handlers
const directionsRouter = require('./routes/directions');
const staticmapRouter = require('./routes/staticmap');
const nearbyRouter = require('./routes/nearby');
const explainRouter = require('./routes/explain');
const integrityVerifyRouter = require('./routes/integrityVerify');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Trust proxy (Render / reverse-proxy sets X-Forwarded-For) ────────────────
app.set('trust proxy', 1);

// ─── Security headers ───────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(createCorsMiddleware());

// ─── Rate limiting — 100 req / 15 min per IP ────────────────────────────────
app.use('/api/', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 100 }));

// ─── Body parser ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/directions', directionsRouter);
app.use('/api/staticmap', staticmapRouter);
app.use('/api/nearby', nearbyRouter);
app.use('/api', explainRouter);
app.use('/api/integrity', integrityVerifyRouter);

// ─── Health check ────────────────────────────────────────────────────────────────────
// Note: /api/places/* is now served by the geocode microservice on port 3005.
app.get('/api/health', healthCheck('api-gateway'));

// ─── Error handler ────────────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ─────────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[gateway] API Gateway running on http://0.0.0.0:${PORT}`);
  console.log(`[gateway] Routes: directions, staticmap, nearby, explain`);
  console.log(`[gateway] Geocoding/search: moved to geocode-service on port 3005`);
});
