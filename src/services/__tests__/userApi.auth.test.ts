const FAKE_ACCESS = 'eyJfakeheader.fakepayloadAUTH.fakesig';

const mockStore: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete mockStore[key];
    }),
    multiSet: jest.fn(async (pairs: [string, string][]) => {
      pairs.forEach(([k, v]) => {
        mockStore[k] = v;
      });
    }),
    multiGet: jest.fn(async () => []),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach((k) => delete mockStore[k]);
    }),
  },
}));

function jsonResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe('liveApi.updateLocation (T-11)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
    mockStore['safenight_access_token'] = FAKE_ACCESS;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('throws with the HTTP status when the server rejects the upload', async () => {
    global.fetch = jest.fn(async () => jsonResponse(503)) as unknown as typeof fetch;
    const { liveApi } = require('../userApi');

    await expect(liveApi.updateLocation(51.5, -0.12)).rejects.toMatchObject({ status: 503 });
  });

  it('resolves when the server accepts the upload', async () => {
    global.fetch = jest.fn(async () => jsonResponse(200)) as unknown as typeof fetch;
    const { liveApi } = require('../userApi');

    await expect(liveApi.updateLocation(51.5, -0.12)).resolves.toBeUndefined();
  });
});

const OLD_ACCESS = 'old-access-token';
const NEW_ACCESS = 'new-access-token';
const REFRESH = 'refresh-token-1';

function seedSession() {
  mockStore['safenight_access_token'] = OLD_ACCESS;
  mockStore['safenight_refresh_token'] = REFRESH;
  mockStore['safenight_expires_at'] = String(Date.now() + 60 * 60 * 1000);
}

/** Yield to the event loop until the condition holds (bounded). */
async function waitUntil(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('token refresh (T-14)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
    seedSession();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends exactly one refresh for two parallel 401s and both requests succeed', async () => {
    let refreshCalls = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls += 1;
        await refreshGate;
        return jsonResponse(200, {
          access_token: NEW_ACCESS,
          refresh_token: 'refresh-token-2',
          expires_in: 3600,
        });
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return auth === `Bearer ${NEW_ACCESS}` ? jsonResponse(200, [{ id: 'c1' }]) : jsonResponse(401);
    }) as unknown as typeof fetch;

    const { contactsApi } = require('../userApi');
    const first = contactsApi.getAll();
    const second = contactsApi.getAll();

    await waitUntil(() => refreshCalls > 0);
    releaseRefresh();
    const [a, b] = await Promise.all([first, second]);

    expect(refreshCalls).toBe(1);
    expect(a).toEqual([{ id: 'c1' }]);
    expect(b).toEqual([{ id: 'c1' }]);
  });

  it('keeps the stored session when refresh returns 503', async () => {
    global.fetch = jest.fn(async (url: string) =>
      url.endsWith('/api/auth/refresh') ? jsonResponse(503) : jsonResponse(401),
    ) as unknown as typeof fetch;

    const { contactsApi } = require('../userApi');
    await expect(contactsApi.getAll()).rejects.toThrow('Failed to fetch contacts');

    expect(mockStore['safenight_access_token']).toBe(OLD_ACCESS);
    expect(mockStore['safenight_refresh_token']).toBe(REFRESH);
  });

  it('keeps the stored session when refresh hits a network error', async () => {
    global.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/api/auth/refresh')) throw new TypeError('Network request failed');
      return jsonResponse(401);
    }) as unknown as typeof fetch;

    const { contactsApi } = require('../userApi');
    await expect(contactsApi.getAll()).rejects.toThrow();

    expect(mockStore['safenight_access_token']).toBe(OLD_ACCESS);
    expect(mockStore['safenight_refresh_token']).toBe(REFRESH);
  });

  it('clears the session when refresh is rejected with 401', async () => {
    global.fetch = jest.fn(async (url: string) =>
      url.endsWith('/api/auth/refresh') ? jsonResponse(401) : jsonResponse(401),
    ) as unknown as typeof fetch;

    const { contactsApi } = require('../userApi');
    await expect(contactsApi.getAll()).rejects.toThrow('Failed to fetch contacts');

    expect(mockStore['safenight_access_token']).toBeUndefined();
    expect(mockStore['safenight_refresh_token']).toBeUndefined();
  });
});

describe('getProfile logout triggers (T-15)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
    seedSession();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('keeps the session on a 401 from /api/auth/me when the refresh is unavailable (503)', async () => {
    jest.useFakeTimers();
    // Refresh is unavailable (503), so the 401 from /me reaches getProfile
    global.fetch = jest.fn(async (url: string) =>
      url.endsWith('/api/auth/refresh') ? jsonResponse(503) : jsonResponse(401),
    ) as unknown as typeof fetch;
    const { authApi, onSessionChange } = require('../userApi');
    const events: string[] = [];
    const unsubscribe = onSessionChange((event: string) => events.push(event));

    const pending = authApi.getProfile();
    await jest.advanceTimersByTimeAsync(20_000);
    const profile = await pending;
    unsubscribe();

    expect(profile).toBeNull();
    expect(mockStore['safenight_access_token']).toBe(OLD_ACCESS);
    expect(mockStore['safenight_refresh_token']).toBe(REFRESH);
    expect(events).not.toContain('expired');
  });

  it('ends the session when the refresh behind a 401 from /api/auth/me is rejected (400)', async () => {
    global.fetch = jest.fn(async (url: string) =>
      url.endsWith('/api/auth/refresh') ? jsonResponse(400) : jsonResponse(401),
    ) as unknown as typeof fetch;
    const { authApi, onSessionChange } = require('../userApi');
    const events: string[] = [];
    const unsubscribe = onSessionChange((event: string) => events.push(event));

    const profile = await authApi.getProfile();
    unsubscribe();

    expect(profile).toBeNull();
    expect(mockStore['safenight_access_token']).toBeUndefined();
    expect(events).toContain('expired');
  });

  it('ends the session on 403 account_disabled from /api/auth/me without retrying', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async () =>
      jsonResponse(403, { error: 'account_disabled' }),
    ) as unknown as typeof fetch;
    const { authApi } = require('../userApi');

    const pending = authApi.getProfile();
    await jest.advanceTimersByTimeAsync(20_000);
    const profile = await pending;

    expect(profile).toBeNull();
    expect(mockStore['safenight_access_token']).toBeUndefined();
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });
});

describe('clearSession (T-16)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
    seedSession();
    global.fetch = jest.fn(async () => jsonResponse(200)) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete (globalThis as any).__safenight_access_token;
  });

  it('removes the sendBeacon token cache global', async () => {
    const { authApi } = require('../userApi');
    await authApi.logout();

    expect((globalThis as any).__safenight_access_token).toBeUndefined();
  });
});

describe('clearSession removes local user data (T-17)', () => {
  const originalFetch = global.fetch;
  const SAVED_PLACES_KEY = '@safenight_saved_places';

  beforeEach(() => {
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
    seedSession();
    mockStore['safenight_user_email'] = 'user@example.test';
    mockStore[SAVED_PLACES_KEY] = JSON.stringify([{ id: 'p1', label: 'Home' }]);
    global.fetch = jest.fn(async () => jsonResponse(200)) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('removes saved places and the user email on logout', async () => {
    const { authApi } = require('../userApi');
    await authApi.logout();

    expect(mockStore[SAVED_PLACES_KEY]).toBeUndefined();
    expect(mockStore['safenight_user_email']).toBeUndefined();
  });

  it('removes saved places and the user email on account deletion', async () => {
    const { authApi } = require('../userApi');
    await authApi.deleteAccount();

    expect(mockStore[SAVED_PLACES_KEY]).toBeUndefined();
    expect(mockStore['safenight_user_email']).toBeUndefined();
  });
});

describe('registerPushToken retry (T-20)', () => {
  const originalFetch = global.fetch;
  const PENDING_KEY = 'safenight_pending_push_token';

  beforeEach(() => {
    jest.useFakeTimers();
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
    seedSession();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('retries after a failed attempt and the second attempt succeeds', async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Network request failed');
      return jsonResponse(200);
    }) as unknown as typeof fetch;
    const { liveApi } = require('../userApi');

    const pending = liveApi.registerPushToken('ExponentPushToken[retry-test]');
    await jest.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1); // first attempt failed; the retry is still waiting

    await jest.advanceTimersByTimeAsync(10_000);
    await pending;

    expect(calls).toBe(2);
    expect(mockStore[PENDING_KEY]).toBeUndefined();
  });
});

describe('ensureFeatureAllowed missing feature (T-30)', () => {
  const SUBSCRIPTION_CACHE_KEY = 'safenight_subscription_limits_cache_v1';

  beforeEach(() => {
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
    seedSession();
    mockStore['safenight_user_id'] = 'user-1';
    mockStore[SUBSCRIPTION_CACHE_KEY] = JSON.stringify({
      userId: 'user-1',
      tier: 'free',
      hydratedAt: Date.now(),
      features: {
        safety_reports: {
          limit: 5,
          per: 'month',
          enabled: true,
          unlimited: false,
          used: 0,
          remaining: 5,
        },
      },
    });
  });

  it('denies a feature missing from the snapshot and marks the cache for rehydrate', async () => {
    const { subscriptionApi } = require('../userApi');
    await subscriptionApi.clearCache();
    mockStore[SUBSCRIPTION_CACHE_KEY] = JSON.stringify({
      userId: 'user-1',
      tier: 'free',
      hydratedAt: Date.now(),
      features: {
        safety_reports: {
          limit: 5,
          per: 'month',
          enabled: true,
          unlimited: false,
          used: 0,
          remaining: 5,
        },
      },
    });

    const result = await subscriptionApi.ensureFeatureAllowed('route_search');

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('rehydrate_required');
    // The snapshot is dropped so the next check hydrates it again
    expect(mockStore[SUBSCRIPTION_CACHE_KEY]).toBeUndefined();
  });
});

describe('refresh finishing after logout (H-1)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
    seedSession();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('does not store refreshed tokens when logout happens before the refresh resolves', async () => {
    let refreshCalls = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    global.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        refreshCalls += 1;
        await refreshGate;
        return jsonResponse(200, {
          access_token: NEW_ACCESS,
          refresh_token: 'refresh-token-2',
          expires_in: 3600,
        });
      }
      if (url.endsWith('/api/auth/logout')) return jsonResponse(200);
      return jsonResponse(401);
    }) as unknown as typeof fetch;

    const { authApi, contactsApi } = require('../userApi');
    const pending = contactsApi.getAll().catch(() => null);
    await waitUntil(() => refreshCalls > 0);

    await authApi.logout();
    releaseRefresh();
    await pending;

    expect(mockStore['safenight_access_token']).toBeUndefined();
    expect(mockStore['safenight_refresh_token']).toBeUndefined();
  });
});

describe('registerPushToken retry after logout (H-3)', () => {
  const originalFetch = global.fetch;
  const PENDING_KEY = 'safenight_pending_push_token';

  beforeEach(() => {
    jest.useFakeTimers();
    Object.keys(mockStore).forEach((k) => delete mockStore[k]);
    seedSession();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('does not send the push token from a retry scheduled before logout', async () => {
    let registrationCalls = 0;
    global.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/api/auth/update-profile')) {
        registrationCalls += 1;
        throw new TypeError('Network request failed');
      }
      return jsonResponse(200);
    }) as unknown as typeof fetch;
    const { authApi, liveApi } = require('../userApi');

    const pending = liveApi.registerPushToken('ExponentPushToken[user-a]');
    await jest.advanceTimersByTimeAsync(0);
    expect(registrationCalls).toBe(1); // first attempt failed; retry is waiting

    await authApi.logout();
    await jest.advanceTimersByTimeAsync(10_000);
    await pending;

    expect(registrationCalls).toBe(1);
    expect(mockStore[PENDING_KEY]).toBeUndefined();
  });
});
