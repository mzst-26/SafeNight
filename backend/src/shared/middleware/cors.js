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
    .map((o) => o.trim())
    .filter(Boolean);

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    optionsSuccessStatus: 200,
  });
}

module.exports = { createCorsMiddleware };
