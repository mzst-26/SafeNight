/**
 * rateLimiter.js — Shared rate limiting middleware.
 *
 * Supports two modes:
 *   • ipOnly: true  → always key by IP (for unauthenticated endpoints)
 *   • ipOnly: false → peek at JWT to extract user ID; fall back to IP
 *
 * The JWT is only *decoded* (not verified) for the key — real verification
 * happens later in requireAuth. This avoids reordering middleware.
 */

const rateLimit = require('express-rate-limit');

// IP-wide ceiling for JWT-keyed limiters, as a multiple of the per-user max.
const IP_BACKSTOP_MULTIPLIER = 5;

/**
 * Decode a JWT payload without verification (just base64).
 * Returns the parsed payload or null on any failure.
 */
function peekJwtUserId(req) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    const token = header.slice(7);
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    );
    return payload.sub || null; // Supabase puts user id in "sub"
  } catch {
    return null;
  }
}

/**
 * Create a rate limiter middleware.
 * @param {Object} [options]
 * @param {number}  [options.windowMs=900000] - Window in ms (default 15 min)
 * @param {number}  [options.max=100]         - Max requests per window
 * @param {string}  [options.message]         - Error message
 * @param {boolean} [options.ipOnly=false]    - Force IP-only keying
 * @param {number}  [options.ipBackstopMultiplier=5] - IP ceiling = max * this (JWT-keyed mode)
 * @returns {Function|Function[]} middleware (array in JWT-keyed mode; Express accepts both)
 */
function createRateLimiter(options = {}) {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Too many requests — please try again later.',
    ipOnly = false,
    ipBackstopMultiplier = IP_BACKSTOP_MULTIPLIER,
  } = options;

  const handler = (_req, res) => {
    const retryAfter = Math.ceil(windowMs / 1000);
    res.status(429).json({
      error: message,
      retry_after: retryAfter,
    });
  };

  if (ipOnly) {
    return rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.ip,
      handler,
    });
  }

  // The JWT "sub" is NOT verified here, so a client can mint a fresh,
  // unsigned token per request to get a fresh bucket. An IP-keyed backstop
  // (a multiple of max, so shared NATs keep headroom) caps that bypass.
  const ipBackstop = rateLimit({
    windowMs,
    max: Math.max(max, Math.ceil(max * ipBackstopMultiplier)),
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
    handler,
  });

  const perUser = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const sub = peekJwtUserId(req);
      return sub ? `user:${sub}` : `ip:${req.ip}`;
    },
    handler,
  });

  return [ipBackstop, perUser];
}

module.exports = { createRateLimiter };
