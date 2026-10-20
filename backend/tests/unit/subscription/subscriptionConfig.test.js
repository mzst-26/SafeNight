/**
 * Unit tests for user/lib/subscriptionConfig.js (tier limits and entitlement helpers).
 *
 * The file defines two tiers (free, pro) and FEATURE_LIMITS. There is no
 * 'premium' tier in this file; unknown tiers fall back to the free column.
 * Time-window tests pin the system clock. The DB loader uses a fake client.
 */

const {
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
} = require('../../../src/user/lib/subscriptionConfig');

afterEach(() => {
  jest.useRealTimers();
});

describe('TIERS and TIER_RANK', () => {
  test('free tier is GBP 0 with no billing period', () => {
    expect(TIERS.free).toEqual({
      name: 'Free',
      description: 'Basic safety features',
      price: 0,
      currency: 'GBP',
    });
  });

  test('pro tier is GBP 4.99 billed monthly', () => {
    expect(TIERS.pro).toEqual({
      name: 'Guarded',
      description: 'Full safety suite for regular walkers',
      price: 4.99,
      currency: 'GBP',
      billingPeriod: 'month',
    });
  });

  test('ranks free below pro', () => {
    expect(TIER_RANK).toEqual({ free: 0, pro: 1 });
  });
});

describe('FEATURE_LIMITS per-tier values', () => {
  test.each([
    ['route_search', 'free', { limit: 10, per: 'day' }],
    ['route_search', 'pro', { limit: -1 }],
    ['route_distance', 'free', { limit: 1 }],
    ['route_distance', 'pro', { limit: 10 }],
    ['navigation_start', 'free', { limit: 5, per: 'day' }],
    ['navigation_start', 'pro', { limit: -1 }],
    ['emergency_contacts', 'free', { limit: 2 }],
    ['emergency_contacts', 'pro', { limit: 5 }],
    ['live_sessions', 'free', { limit: 2, per: 'month' }],
    ['live_sessions', 'pro', { limit: -1 }],
    ['ai_explanation', 'free', { limit: 2, per: 'day' }],
    ['ai_explanation', 'pro', { limit: 10, per: 'day' }],
    ['safety_reports', 'free', { limit: -1 }],
    ['safety_reports', 'pro', { limit: -1 }],
    ['usage_stats', 'free', { limit: -1 }],
    ['push_notifications', 'pro', { limit: -1 }],
  ])('%s for %s is %j', (feature, tier, expected) => {
    expect(FEATURE_LIMITS[feature][tier]).toEqual(expected);
  });

  test('defines exactly nine features', () => {
    expect(Object.keys(FEATURE_LIMITS)).toHaveLength(9);
  });
});

describe('getFeatureLimit', () => {
  test('returns the free config for route_search', () => {
    expect(getFeatureLimit('route_search', 'free')).toEqual({ limit: 10, per: 'day' });
  });

  test('returns the pro config for route_search (unlimited)', () => {
    expect(getFeatureLimit('route_search', 'pro')).toEqual({ limit: -1 });
  });

  test('returns null for an unknown feature', () => {
    expect(getFeatureLimit('teleport', 'pro')).toBeNull();
  });

  test('unknown tier falls back to the free limits', () => {
    expect(getFeatureLimit('emergency_contacts', 'premium')).toEqual({ limit: 2 });
    expect(getFeatureLimit('route_search', 'enterprise')).toEqual({ limit: 10, per: 'day' });
  });
});

describe('tierAtLeast', () => {
  test.each([
    ['pro', 'free', true],
    ['pro', 'pro', true],
    ['free', 'free', true],
    ['free', 'pro', false],
  ])('tierAtLeast(%s, %s) is %s', (user, required, expected) => {
    expect(tierAtLeast(user, required)).toBe(expected);
  });

  test('unknown user tier is treated as free (rank 0)', () => {
    expect(tierAtLeast('premium', 'free')).toBe(true);
    expect(tierAtLeast('premium', 'pro')).toBe(false);
  });

  test('unknown required tier must fail closed for a free user', () => {
    // Expected: a free user cannot satisfy a tier that does not exist.
    // Known defect candidate: TIER_RANK['premium'] is undefined, so the
    // right-hand side becomes 0 and the free user passes.
    expect(tierAtLeast('free', 'premium')).toBe(false);
  });
});

describe('isFeatureEnabled', () => {
  test('is true for a positive limit', () => {
    expect(isFeatureEnabled('route_distance', 'free')).toBe(true);
  });

  test('is true for unlimited (-1)', () => {
    expect(isFeatureEnabled('safety_reports', 'free')).toBe(true);
  });

  test('is false for an unknown feature', () => {
    expect(isFeatureEnabled('teleport', 'pro')).toBe(false);
  });

  test('is false when a feature limit is 0 (disabled)', () => {
    FEATURE_LIMITS.test_disabled_feature = {
      description: 'test only',
      free: { limit: 0 },
      pro: { limit: 0 },
    };
    try {
      expect(isFeatureEnabled('test_disabled_feature', 'free')).toBe(false);
      expect(isFeatureEnabled('test_disabled_feature', 'pro')).toBe(false);
    } finally {
      delete FEATURE_LIMITS.test_disabled_feature;
    }
  });
});

describe('getTierFeatures', () => {
  test('free: route_search is a 10-per-day capped feature', () => {
    expect(getTierFeatures('free').route_search).toEqual({
      description: 'Route safety searches',
      limit: 10,
      per: 'day',
      enabled: true,
      unlimited: false,
    });
  });

  test('pro: route_search is unlimited with no window', () => {
    expect(getTierFeatures('pro').route_search).toEqual({
      description: 'Route safety searches',
      limit: -1,
      per: null,
      enabled: true,
      unlimited: true,
    });
  });

  test('pro: route_distance is capped at 10 km', () => {
    const f = getTierFeatures('pro').route_distance;
    expect(f.limit).toBe(10);
    expect(f.unlimited).toBe(false);
  });

  test('returns one entry per feature', () => {
    expect(Object.keys(getTierFeatures('free'))).toHaveLength(9);
  });

  test('unknown tier uses free values', () => {
    expect(getTierFeatures('premium').emergency_contacts.limit).toBe(2);
  });
});

describe('getAllTiers', () => {
  test('returns free then pro with ranks 0 and 1', () => {
    const tiers = getAllTiers();
    expect(tiers.map((t) => t.id)).toEqual(['free', 'pro']);
    expect(tiers.map((t) => t.rank)).toEqual([0, 1]);
  });

  test('each tier embeds its feature table', () => {
    const pro = getAllTiers().find((t) => t.id === 'pro');
    expect(pro.price).toBe(4.99);
    expect(pro.features.emergency_contacts.limit).toBe(5);
    expect(Object.keys(pro.features)).toHaveLength(9);
  });
});

describe('getWindowStart', () => {
  // Local-time constructors keep these assertions valid in any TZ.
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 9, 20, 15, 30, 0)); // 20 Oct 2026, 15:30 local
  });

  test('day starts at local midnight of today', () => {
    expect(getWindowStart('day')).toBe(new Date(2026, 9, 20).toISOString());
  });

  test('month starts on the first day of the current month', () => {
    expect(getWindowStart('month')).toBe(new Date(2026, 9, 1).toISOString());
  });

  test('year starts on 1 January of the current year', () => {
    expect(getWindowStart('year')).toBe(new Date(2026, 0, 1).toISOString());
  });

  test('lifetime and null have no window', () => {
    expect(getWindowStart('lifetime')).toBeNull();
    expect(getWindowStart(null)).toBeNull();
  });

  test('day window does not move forward within the same day', () => {
    const before = getWindowStart('day');
    jest.setSystemTime(new Date(2026, 9, 20, 23, 59, 0));
    expect(getWindowStart('day')).toBe(before);
  });
});

describe('loadDbLimits and clearDbLimitsCache', () => {
  const ROWS = [
    { feature: 'route_search', tier: 'free', max_count: 3, per_interval: 'day' },
    { feature: 'live_sessions', tier: 'pro', max_count: -1, per_interval: null },
  ];

  function fakeSupabase(result) {
    const select = jest.fn(async () => result);
    const from = jest.fn(() => ({ select }));
    return { client: { from }, from, select };
  }

  beforeEach(() => {
    clearDbLimitsCache();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-20T10:00:00Z'));
  });

  test('builds a feature -> tier -> limit map from feature_limits rows', async () => {
    const db = fakeSupabase({ data: ROWS, error: null });
    const map = await loadDbLimits(db.client);

    expect(db.from).toHaveBeenCalledWith('feature_limits');
    expect(map).toEqual({
      route_search: { free: { limit: 3, per: 'day' } },
      live_sessions: { pro: { limit: -1 } },
    });
  });

  test('omits the per key when per_interval is null', async () => {
    const db = fakeSupabase({ data: ROWS, error: null });
    const map = await loadDbLimits(db.client);
    expect(map.live_sessions.pro).not.toHaveProperty('per');
  });

  test('serves the cached map within the 5 minute TTL without re-querying', async () => {
    const db = fakeSupabase({ data: ROWS, error: null });
    await loadDbLimits(db.client);
    jest.setSystemTime(new Date('2026-10-20T10:04:59Z'));
    await loadDbLimits(db.client);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  test('re-queries once the 5 minute TTL has elapsed', async () => {
    const db = fakeSupabase({ data: ROWS, error: null });
    await loadDbLimits(db.client);
    jest.setSystemTime(new Date('2026-10-20T10:05:00.001Z'));
    await loadDbLimits(db.client);
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  test('returns null when the query reports an error', async () => {
    const db = fakeSupabase({ data: null, error: { message: 'fake db down' } });
    await expect(loadDbLimits(db.client)).resolves.toBeNull();
  });

  test('returns null when the client throws', async () => {
    const client = {
      from: () => {
        throw new Error('fake connection refused');
      },
    };
    await expect(loadDbLimits(client)).resolves.toBeNull();
  });

  test('clearDbLimitsCache forces the next call to query again', async () => {
    const db = fakeSupabase({ data: ROWS, error: null });
    await loadDbLimits(db.client);
    clearDbLimitsCache();
    await loadDbLimits(db.client);
    expect(db.select).toHaveBeenCalledTimes(2);
  });
});
