/**
 * cors.js — Shared CORS middleware configuration.
 *
 * Reads ALLOWED_ORIGINS from env and builds a CORS middleware
 * that whitelists those origins + allows no-origin requests
 * (mobile apps, server-to-server).
 */

const cors = require('cors');

function createCorsMiddleware() {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))  // strip trailing slashes
    .filter(Boolean);

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, server-to-server, curl)
      if (!origin) return callback(null, true);
      // Exact match against whitelist
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // In development or if no origins configured, allow all
      if (allowedOrigins.length === 0 || process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Integrity-Token', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200,
    preflightContinue: false,
  });
}

module.exports = { createCorsMiddleware };
