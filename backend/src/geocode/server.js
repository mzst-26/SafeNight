/**
 * SafeNight — Geocode Microservice (port 3005)
 *
 * Dedicated service for all searching and geocoding operations:
 *   • Place autocomplete / search
 *   • Forward geocoding  (placeId → lat/lng)
 *   • Reverse geocoding  (lat/lng → address)
 *
 * All responses are served from an in-process TTL cache, making
 * repeated lookups instant and reducing load on Nominatim.
 *
 * Moving geocoding off the API gateway means:
 *   - Gateway can focus on directions, static maps and AI explanations
 *   - Geocode cache is isolated — gateway restarts don't flush it
 *   - Geocode can be scaled independently on Render / Railway
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

const geocodeRouter = require('./routes/geocode');

const app = express();
const PORT = process.env.PORT || 3005;

// ─── Trust proxy (Render / reverse-proxy sets X-Forwarded-For) ────────────────
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(createCorsMiddleware());

// ─── Rate limiting — 200 req / 15 min per IP ──────────────────────────────────
// Slightly higher than gateway because many geocode calls are cache-served
// and don't touch Nominatim at all.
app.use('/api/', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 200 }));

// ─── Body parser ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/geocode', geocodeRouter);

// Also expose the classic /api/places/* paths so the gateway can forward
// existing calls here without a client-side change in older installs.
app.use('/api/places', require('./routes/legacyPlaces'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', healthCheck('geocode-service'));

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[geocode] Geocode service running on http://0.0.0.0:${PORT}`);
  console.log(`[geocode] Routes: /api/geocode/autocomplete, /api/geocode/details, /api/geocode/reverse`);
  console.log(`[geocode] Legacy: /api/places/autocomplete, /api/places/details (compat shim)`);
});
