/**
 * subscriptionMiddleware.js — Feature gating by subscription tier.
 *
 * Provides two composable middlewares:
 *
 *   attachSubscription   — loads the user's active tier onto req.subscription
 *                          (automatically used by the others, but can be
 *                           used standalone for routes that just need tier info)
 *
 *   requireTier(tier)    — blocks the request if the user's tier is below
 *                          the required level (e.g. requireTier('pro'))
 *
 *   checkFeatureLimit(feature) — checks counted limits (route_search, contacts,
 *                                 live_sessions, etc.) and returns 403 with a
 *                                 clear upgrade message when exceeded
 *
 * All three require `requireAuth` to have run first (req.user must exist).
 *
 * Usage in routes:
 *   router.post('/start', checkFeatureLimit('live_sessions'), handler);
 *   router.get('/stats',  requireTier('pro'), handler);
 */

const { supabase } = require('../lib/supabase');
const {
  getFeatureLimit,
  tierAtLeast,
  isFeatureEnabled,
  getWindowStart,
  TIER_RANK,
  loadDbLimits,
} = require('../lib/subscriptionConfig');

// ─── attachSubscription ──────────────────────────────────────────────────────
// Loads the user's active subscription tier from the DB and caches it on req.
// Subsequent middleware in the same request can read req.subscription.tier.

async function attachSubscription(req, res, next) {
  // Already attached (e.g. by a previous middleware in the chain)
  if (req.subscription) return next();

  if (!req.user?.id) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Fast path: read the denormalized tier from profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription')
      .eq('id', req.user.id)
      .single();

    const tier = profile?.subscription || 'free';

    // Validate against subscriptions table (check not expired)
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('tier, status, expires_at, is_gift, gift_start_date, gift_end_date')
      .eq('user_id', req.user.id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // If active sub exists and isn't expired, use its tier
    let effectiveTier = 'free';
    let isGift = false;
    let giftEndDate = null;
    let expiresAt = null;

    if (sub && sub.status === 'active') {
      // For gift subscriptions, check gift_end_date; otherwise check expires_at
      const expiryDate = sub.is_gift ? sub.gift_end_date : sub.expires_at;
      
      if (!expiryDate || new Date(expiryDate) > new Date()) {
        effectiveTier = sub.tier;
        isGift = sub.is_gift || false;
        giftEndDate = sub.gift_end_date || null;
        expiresAt = sub.expires_at || null;
      } else {
        // Subscription expired — mark it and fall back to free
        await supabase
          .from('subscriptions')
          .update({ status: 'expired' })
          .eq('user_id', req.user.id)
          .eq('status', 'active')
          .lt('expires_at', new Date().toISOString());

        // Also expire gift subs past their gift_end_date
        await supabase
          .from('subscriptions')
          .update({ status: 'expired' })
          .eq('user_id', req.user.id)
          .eq('status', 'active')
          .eq('is_gift', true)
          .lt('gift_end_date', new Date().toISOString());

        // Update denormalized field
        await supabase
          .from('profiles')
          .update({ subscription: 'free' })
          .eq('id', req.user.id);
      }
    }

    // Sync denormalized field if out of date
    if (tier !== effectiveTier) {
      await supabase
        .from('profiles')
        .update({ subscription: effectiveTier })
        .eq('id', req.user.id);
    }

    req.subscription = {
      tier: effectiveTier,
      rank: TIER_RANK[effectiveTier] ?? 0,
      sub: sub || null,
      isGift,
      giftEndDate,
      expiresAt,
    };

    next();
  } catch (err) {
    console.error('[subscription] Error loading tier:', err.message);
    // Don't block the request — default to free
    req.subscription = { tier: 'free', rank: 0, sub: null };
    next();
  }
}

// ─── requireTier ─────────────────────────────────────────────────────────────
// Returns middleware that blocks requests from users below the given tier.
//
//   router.get('/stats', requireTier('pro'), handler);

function requireTier(minimumTier) {
  return async (req, res, next) => {
    // Ensure subscription is loaded
    if (!req.subscription) {
      await new Promise((resolve) => attachSubscription(req, res, resolve));
      if (res.headersSent) return; // attachSubscription sent a 401
    }

    if (!tierAtLeast(req.subscription.tier, minimumTier)) {
      return res.status(403).json({
        error: 'upgrade_required',
        message: `This feature requires a ${minimumTier} subscription or higher`,
        current_tier: req.subscription.tier,
        required_tier: minimumTier,
      });
    }

    next();
  };
}

// ─── checkFeatureLimit ───────────────────────────────────────────────────────
// Returns middleware that counts the user's usage of a feature and blocks
// if they've hit their tier's limit.
//
//   router.post('/invite', checkFeatureLimit('emergency_contacts'), handler);
//
// Responds with 403 + remaining/limit info so the frontend can show a
// meaningful upgrade prompt.

function checkFeatureLimit(feature) {
  return async (req, res, next) => {
    // Ensure subscription is loaded
    if (!req.subscription) {
      await new Promise((resolve) => attachSubscription(req, res, resolve));
      if (res.headersSent) return;
    }

    const tier = req.subscription.tier;

    // Try DB-driven limits first, fall back to hardcoded JS config
    let config = null;
    const dbLimits = await loadDbLimits(supabase);
    if (dbLimits && dbLimits[feature] && dbLimits[feature][tier]) {
      config = dbLimits[feature][tier];
    } else {
      config = getFeatureLimit(feature, tier);
    }

    if (!config) {
      // Unknown feature — allow (fail open for safety, log for debugging)
      console.warn(`[subscription] Unknown feature: ${feature}`);
      return next();
    }

    // Feature disabled for this tier
    if (config.limit === 0) {
      return res.status(403).json({
        error: 'upgrade_required',
        message: `${feature} is not available on the ${tier} plan`,
        feature,
        current_tier: tier,
        limit: 0,
        used: 0,
        remaining: 0,
      });
    }

    // Unlimited
    if (config.limit === -1) {
      req.featureLimit = { feature, limit: -1, used: 0, remaining: -1, unlimited: true };
      return next();
    }

    // Count current usage
    try {
      const used = await countFeatureUsage(req.user.id, feature, config);

      if (used >= config.limit) {
        const perLabel = config.per ? ` per ${config.per}` : '';
        return res.status(403).json({
          error: 'limit_reached',
          message: `You've reached your ${tier} plan limit of ${config.limit} ${feature}${perLabel}. Upgrade for more.`,
          feature,
          current_tier: tier,
          limit: config.limit,
          used,
          remaining: 0,
          per: config.per || null,
          resets_at: config.per ? getNextReset(config.per) : null,
        });
      }

      // Attach limit info so route handlers can include it in responses
      req.featureLimit = {
        feature,
        limit: config.limit,
        used,
        remaining: config.limit - used,
        unlimited: false,
        per: config.per || null,
      };

      next();
    } catch (err) {
      console.error(`[subscription] Error counting ${feature}:`, err.message);
      // Fail open — don't block the user
      next();
    }
  };
}

// ─── Usage counting ──────────────────────────────────────────────────────────

async function countFeatureUsage(userId, feature, config) {
  const featureConfig = require('../lib/subscriptionConfig').FEATURE_LIMITS[feature];
  const windowStart = config.per ? getWindowStart(config.per) : null;

  // Count from the appropriate table
  if (featureConfig?.count_table === 'emergency_contacts') {
    // Count accepted contacts where user is either side
    const { count } = await supabase
      .from('emergency_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'accepted')
      .or(`user_id.eq.${userId},contact_id.eq.${userId}`);
    return count || 0;
  }

  if (featureConfig?.count_table === 'live_sessions') {
    let query = supabase
      .from('live_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (windowStart) {
      query = query.gte('started_at', windowStart);
    }

    const { count } = await query;
    return count || 0;
  }

  if (featureConfig?.count_table === 'safety_reports') {
    let query = supabase
      .from('safety_reports')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (windowStart) {
      query = query.gte('created_at', windowStart);
    }

    const { count } = await query;
    return count || 0;
  }

  // Default: count from usage_events by event_type
  const eventType = featureConfig?.usage_event || feature;
  let query = supabase
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', eventType);

  if (windowStart) {
    query = query.gte('created_at', windowStart);
  }

  const { count } = await query;
  return count || 0;
}

/** Get the next reset timestamp for a given interval */
function getNextReset(per) {
  const now = new Date();
  switch (per) {
    case 'day': {
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return tomorrow.toISOString();
    }
    case 'month': {
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return nextMonth.toISOString();
    }
    case 'year': {
      const nextYear = new Date(now.getFullYear() + 1, 0, 1);
      return nextYear.toISOString();
    }
    default:
      return null;
  }
}

module.exports = {
  attachSubscription,
  requireTier,
  checkFeatureLimit,
};
