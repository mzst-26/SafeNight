/**
 * SafeNight — User Data Service
 *
 * Handles user authentication, usage tracking, safety reports,
 * and app reviews via Supabase (Postgres + Auth).
 *
 * This is a separate microservice (port 3003) to keep load off
 * the gateway and safety services.
 *
 * Auth: Supabase magic link (passwordless email OTP)
 * DB: Supabase Postgres (free tier — 500MB)
 *
 * Security:
 * - Helmet headers
 * - CORS whitelist
 * - Per-user rate limiting (JWT peek → user ID, fallback to IP)
 * - JWT validation on all protected routes
 * - Supabase service_role key server-side only
 * - Input validation on all endpoints
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');

const { createCorsMiddleware } = require('../shared/middleware/cors');
const { createRateLimiter } = require('../shared/middleware/rateLimiter');
const { errorHandler } = require('../shared/middleware/errorHandler');
const { healthCheck } = require('../shared/middleware/healthCheck');

// Route handlers
const authRouter = require('./routes/auth');
const usageRouter = require('./routes/usage');
const reportsRouter = require('./routes/reports');
const reviewsRouter = require('./routes/reviews');
const contactsRouter = require('./routes/contacts');
const liveRouter = require('./routes/live');
const subscriptionsRouter = require('./routes/subscriptions');
const giftRouter = require('./routes/gift');
const familyRouter = require('./routes/family');

const app = express();
const PORT = process.env.PORT || 3003;

// ─── Trust proxy (Render / reverse-proxy sets X-Forwarded-For) ────────────────
app.set('trust proxy', 1);

// ─── Security headers ───────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ────────────────────────────────────────────────────────────────────
app.use(createCorsMiddleware());

// ─── Body parser ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));

// ─── Routes ──────────────────────────────────────────────────────────────────
// Limits are PER USER (via JWT peek) per 15 minutes; falls back to IP when
// no token is present. magic-link & verify use ipOnly since there's no user yet.
app.use('/api/auth', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 120 }), authRouter);

app.use('/api/usage', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 200 }), usageRouter);
app.use('/api/reports', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 60 }), reportsRouter);
app.use('/api/reviews', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40 }), reviewsRouter);
app.use('/api/contacts', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 100 }), contactsRouter);
app.use('/api/live', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 500 }), liveRouter);
app.use('/api/subscriptions', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 60 }), subscriptionsRouter);
app.use('/api/gift', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 }), giftRouter);
app.use('/api/family', createRateLimiter({ windowMs: 15 * 60 * 1000, max: 60 }), familyRouter);

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/api/health', healthCheck('user-service'));

// ─── Error handler ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[user] User Data Service running on http://0.0.0.0:${PORT}`);
  console.log(`[user] Routes: auth, usage, reports, reviews, contacts, live, subscriptions, gift, family`);
});
