/**
 * SafeNight — Subscription Service (Stripe)
 *
 * Dedicated microservice for payment processing via Stripe.
 * Runs on port 3004. Handles:
 *
 *   - Creating Stripe Checkout Sessions (upgrade flow)
 *   - Stripe Customer Portal (manage/cancel subscriptions)
 *   - Stripe Webhooks (payment events → DB updates)
 *   - Subscription status queries
 *
 * Security:
 *   - Stripe webhook signature verification (STRIPE_WEBHOOK_SECRET)
 *   - JWT auth for user-facing endpoints (shared Supabase auth)
 *   - Helmet headers + CORS whitelist
 *   - Rate limiting per user/IP
 *   - No secrets exposed to frontend
 *
 * Architecture:
 *   The subscription service talks to Stripe and Supabase.
 *   The user service (port 3003) remains the source of truth for
 *   subscription tier — this service updates it via Supabase when
 *   Stripe events occur.
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');

const { createCorsMiddleware } = require('../shared/middleware/cors');
const { createRateLimiter } = require('../shared/middleware/rateLimiter');
const { errorHandler } = require('../shared/middleware/errorHandler');
const { healthCheck } = require('../shared/middleware/healthCheck');

const stripeRoutes = require('./routes/stripe');
const { stripeWebhookHandler } = require('./routes/webhook');

const app = express();
const PORT = process.env.PORT || 3004;

// ─── Trust proxy ─────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─── Security headers ───────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(createCorsMiddleware());

// ─── Stripe webhook — MUST use raw body for signature verification ───────────
// This MUST be registered BEFORE express.json() so the raw body is preserved.
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler,
);

// ─── Body parser (after webhook route) ───────────────────────────────────────
app.use(express.json({ limit: '10kb' }));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use(
  '/api/stripe',
  createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 }),
  stripeRoutes,
);

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/api/health', healthCheck('subscription-service'));

// ─── Error handler ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[subscription] Subscription Service running on http://0.0.0.0:${PORT}`);
  console.log(`[subscription] Routes: stripe (checkout, portal, status, webhook)`);

  // Validate required env vars at startup
  const required = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn(`[subscription] ⚠️  Missing env vars: ${missing.join(', ')}`);
    console.warn(`[subscription] ⚠️  Stripe features will not work until these are set.`);
  }
});
