/**
 * subscriptionConfig.js — Single source of truth for tier limits.
 *
 * To add a new feature:
 *   1. Add a key to FEATURE_LIMITS with limits per tier
 *   2. Use requireTier() or checkFeatureLimit() in the relevant route
 *
 * To add a new tier:
 *   1. Add it to TIERS
 *   2. Add limits for every feature in FEATURE_LIMITS
 *   3. Update TIER_RANK
 *
 * Limits use -1 for "unlimited".
 * Interval-based limits use `per` to define the reset window.
 */

// ─── Tier definitions ────────────────────────────────────────────────────────
const TIERS = {
  free: {
    name: 'Free',
    description: 'Basic safety features',
    price: 0,
    currency: 'GBP',
  },
  pro: {
    name: 'Guarded',
    description: 'Full safety suite for regular walkers',
    price: 4.99,
    currency: 'GBP',
    billingPeriod: 'month',
  },
};

// Rank for >= comparisons: free < pro (Guarded)
const TIER_RANK = { free: 0, pro: 1 };

// ─── Feature limits per tier ─────────────────────────────────────────────────
// Each feature has a key and per-tier config.
//   limit:  -1 = unlimited, 0 = disabled, N = max count
//   per:    'day' | 'month' | 'lifetime' | null (null = total cap, not time-windowed)
//   min_tier: shorthand — if set, any tier below this is blocked entirely
const FEATURE_LIMITS = {
  // ── Route searching ──────────────────────────────────────────────────────
  route_search: {
    description: 'Route safety searches',
    free:    { limit: 10, per: 'day' },
    pro:     { limit: -1 },
    // event_type used to count usage
    usage_event: 'route_search',
  },

  // ── Route distance (km) ──────────────────────────────────────────────────
  route_distance: {
    description: 'Maximum walking route distance (km)',
    free:    { limit: 1 },
    pro:     { limit: 10 },
    // Not counted — used as a cap, checked by the safe-routes endpoint
  },

  // ── Navigation starts ────────────────────────────────────────────────────
  navigation_start: {
    description: 'Turn-by-turn navigation sessions',
    free:    { limit: 5, per: 'day' },
    pro:     { limit: -1 },
    usage_event: 'navigation_start',
  },

  // ── Emergency contacts ───────────────────────────────────────────────────
  emergency_contacts: {
    description: 'Emergency contacts (Safety Circle)',
    free:    { limit: 2 },
    pro:     { limit: 5 },
    // counted via emergency_contacts table, not usage_events
    count_table: 'emergency_contacts',
  },

  // ── Live location sharing ────────────────────────────────────────────────
  live_sessions: {
    description: 'Live location sharing sessions',
    free:    { limit: 2, per: 'month' },
    pro:     { limit: -1 },
    usage_event: 'live_session',
    count_table: 'live_sessions',
  },

  // ── AI route explanation ─────────────────────────────────────────────────
  ai_explanation: {
    description: 'AI-powered route safety explanations',
    free:    { limit: 2, per: 'day' },
    pro:     { limit: 10, per: 'day' },
  },

  // ── Safety reports ───────────────────────────────────────────────────────
  safety_reports: {
    description: 'Safety hazard reports',
    free:    { limit: -1 },
    pro:     { limit: -1 },
    count_table: 'safety_reports',
  },

  // ── Usage stats / history ────────────────────────────────────────────────
  usage_stats: {
    description: 'Personal usage analytics',
    free:    { limit: -1 },
    pro:     { limit: -1 },
  },

  // ── Push notifications (contact alerts) ──────────────────────────────────
  push_notifications: {
    description: 'Push notifications for contact activity',
    free:    { limit: -1 },   // basic push for everyone
    pro:     { limit: -1 },
  },
};

// ─── Helper functions ────────────────────────────────────────────────────────

/** Get the limit config for a feature at a given tier */
function getFeatureLimit(feature, tier) {
  const config = FEATURE_LIMITS[feature];
  if (!config) return null;
  return config[tier] || config.free; // fallback to free
}

/** Check if tier A >= tier B */
function tierAtLeast(userTier, requiredTier) {
  return (TIER_RANK[userTier] ?? 0) >= (TIER_RANK[requiredTier] ?? 0);
}

/** Check if a feature is enabled (limit > 0 or -1) for a tier */
function isFeatureEnabled(feature, tier) {
  const config = getFeatureLimit(feature, tier);
  if (!config) return false;
  return config.limit !== 0;
}

/** Get all features with their limits for a given tier (for frontend display) */
function getTierFeatures(tier) {
  const result = {};
  for (const [key, config] of Object.entries(FEATURE_LIMITS)) {
    const tierConfig = config[tier] || config.free;
    result[key] = {
      description: config.description,
      limit: tierConfig.limit,
      per: tierConfig.per || null,
      enabled: tierConfig.limit !== 0,
      unlimited: tierConfig.limit === -1,
    };
  }
  return result;
}

/** Get all tier info with their features (for pricing page / comparison) */
function getAllTiers() {
  return Object.entries(TIERS).map(([key, info]) => ({
    id: key,
    ...info,
    rank: TIER_RANK[key],
    features: getTierFeatures(key),
  }));
}

/** Get the time window start for a given 'per' interval */
function getWindowStart(per) {
  const now = new Date();
  switch (per) {
    case 'day':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    case 'year':
      return new Date(now.getFullYear(), 0, 1).toISOString();
    default:
      return null; // lifetime / total — no window
  }
}

// ─── DB override loader ─────────────────────────────────────────────────────
// Tries to load feature+tier limits from the feature_limits table.
// Falls back to the hardcoded FEATURE_LIMITS above if DB is unavailable.
let _dbLimitsCache = null;
let _dbLimitsCacheTs = 0;
const DB_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function loadDbLimits(supabase) {
  if (_dbLimitsCache && Date.now() - _dbLimitsCacheTs < DB_CACHE_TTL) {
    return _dbLimitsCache;
  }
  try {
    const { data, error } = await supabase
      .from('feature_limits')
      .select('feature, tier, max_count, per_interval');
    if (error || !data) return null;

    const map = {};
    for (const row of data) {
      if (!map[row.feature]) map[row.feature] = {};
      map[row.feature][row.tier] = {
        limit: row.max_count,
        ...(row.per_interval ? { per: row.per_interval } : {}),
      };
    }
    _dbLimitsCache = map;
    _dbLimitsCacheTs = Date.now();
    return map;
  } catch {
    return null;
  }
}

/** Clear the DB limits cache (e.g. after admin updates) */
function clearDbLimitsCache() {
  _dbLimitsCache = null;
  _dbLimitsCacheTs = 0;
}

module.exports = {
  TIERS,
  TIER_RANK,
  FEATURE_LIMITS,
  getFeatureLimit,
  tierAtLeast,
  isFeatureEnabled,
  getTierFeatures,
  getAllTiers,
  getWindowStart,
  loadDbLimits,
  clearDbLimitsCache,
};
