/**
 * stripeClient.js — Singleton Stripe SDK instance.
 *
 * Centralises Stripe initialisation so all routes share one client.
 * Fails fast at import time if STRIPE_SECRET_KEY is missing.
 */

const Stripe = require('stripe');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error('[stripe] STRIPE_SECRET_KEY is not set. Stripe operations will fail.');
}

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2024-12-18.acacia',
      maxNetworkRetries: 2,
      timeout: 10000, // 10s
    })
  : null;

/**
 * Get the Stripe instance. Throws if not configured.
 * @returns {Stripe}
 */
function getStripe() {
  if (!stripe) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in .env');
  }
  return stripe;
}

module.exports = { getStripe };
