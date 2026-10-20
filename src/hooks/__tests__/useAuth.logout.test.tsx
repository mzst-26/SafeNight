import { act, create } from 'react-test-renderer';

import { useAuth } from '@/src/hooks/useAuth';
import {
  authApi,
  contactsApi,
  getTokenExpiresAt,
  onSessionChange,
  refreshIfNeeded,
  subscriptionApi,
  usageApi,
} from '@/src/services/userApi';

jest.mock('@/src/services/userApi', () => ({
  authApi: {
    isLoggedIn: jest.fn(),
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    logout: jest.fn(),
  },
  contactsApi: {},
  subscriptionApi: { refreshOnAppOpen: jest.fn() },
  usageApi: { track: jest.fn() },
  getTokenExpiresAt: jest.fn(),
  onSessionChange: jest.fn(),
  refreshIfNeeded: jest.fn(),
}));

type Hook = ReturnType<typeof useAuth>;
let latest: Hook;

function Probe() {
  latest = useAuth();
  return null;
}

const mockAuth = authApi as unknown as Record<string, jest.Mock>;
const mockGetTokenExpiresAt = getTokenExpiresAt as jest.Mock;
const mockRefreshIfNeeded = refreshIfNeeded as jest.Mock;
const mockOnSessionChange = onSessionChange as jest.Mock;

let sessionListener: ((event: string) => void) | null = null;

/** Let pending microtasks (AsyncStorage-style awaits) run. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
}

describe('useAuth refresh scheduling (LOGIC-23)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    sessionListener = null;
    // Logged out at mount so the initial load does not schedule its own refresh
    mockAuth.isLoggedIn.mockResolvedValue(false);
    mockAuth.logout.mockResolvedValue(undefined);
    mockRefreshIfNeeded.mockResolvedValue(true);
    // Refresh becomes due in 30 s
    mockGetTokenExpiresAt.mockResolvedValue(Date.now() + 2 * 60_000 + 30_000);
    mockOnSessionChange.mockImplementation((listener: (event: string) => void) => {
      sessionListener = listener;
      return () => {};
    });
    (usageApi.track as jest.Mock).mockResolvedValue(undefined);
    (subscriptionApi.refreshOnAppOpen as jest.Mock).mockResolvedValue(null);
    expect(contactsApi).toBeDefined();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs one refresh when scheduleRefresh is called twice before either resolves', async () => {
    await act(async () => {
      create(<Probe />);
    });
    await settle();
    mockRefreshIfNeeded.mockClear();

    // Two overlapping schedules: neither awaited before the second starts
    sessionListener?.('refreshed');
    sessionListener?.('refreshed');
    await settle();

    await advance(30_000);
    expect(mockRefreshIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('cancels a schedule that is still resolving when the user logs out', async () => {
    await act(async () => {
      create(<Probe />);
    });
    await settle();
    mockRefreshIfNeeded.mockClear();

    sessionListener?.('refreshed');
    await act(async () => {
      await latest.logout();
    });
    await settle();

    await advance(60_000);
    expect(mockRefreshIfNeeded).not.toHaveBeenCalled();
  });
});

describe('useAuth profile retry ladder (T-15)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    sessionListener = null;
    // Clear the shared-load dedup window left by earlier tests
    jest.advanceTimersByTime(10_000);
    mockAuth.isLoggedIn.mockResolvedValue(true);
    mockAuth.getProfile.mockResolvedValue(null); // profile unavailable on every attempt
    mockAuth.logout.mockResolvedValue(undefined);
    mockRefreshIfNeeded.mockResolvedValue(true);
    mockGetTokenExpiresAt.mockResolvedValue(null);
    mockOnSessionChange.mockImplementation((listener: (event: string) => void) => {
      sessionListener = listener;
      return () => {};
    });
    (usageApi.track as jest.Mock).mockResolvedValue(undefined);
    (subscriptionApi.refreshOnAppOpen as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the session and does not log out when getProfile returns null for every retry', async () => {
    await act(async () => {
      create(<Probe />);
    });
    await settle();

    // Walk through the full retry ladder (5 s + 12 s + 25 s) and past the old logout timer
    await advance(5_000);
    await advance(12_000);
    await advance(25_000);
    await advance(60_000);

    expect(latest.isLoggedIn).toBe(true);
    expect(latest.reconnecting).toBe(true);
    expect(mockAuth.logout).not.toHaveBeenCalled();
  });
});
