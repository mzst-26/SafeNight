import { act, create } from 'react-test-renderer';

import * as Location from 'expo-location';
import { liveApi } from '@/src/services/userApi';
import { useLiveTracking, useWatchContact } from '@/src/hooks/useLiveTracking';

jest.mock('expo-location', () => ({
  Accuracy: { High: 5 },
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

jest.mock('@/src/services/userApi', () => ({
  liveApi: {
    start: jest.fn(),
    end: jest.fn(),
    updateLocation: jest.fn(),
    heartbeat: jest.fn(),
    getMySession: jest.fn(),
    registerPushToken: jest.fn(),
    watchContact: jest.fn(),
  },
}));

type Hook = ReturnType<typeof useLiveTracking>;

let latest: Hook;

function Probe({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  latest = useLiveTracking(isLoggedIn);
  return null;
}

const mockLocation = Location as unknown as Record<string, jest.Mock>;
const mockLiveApi = liveApi as unknown as Record<string, jest.Mock>;

const FIX = { coords: { latitude: 51.5, longitude: -0.12 } };
const UPLOAD_FAILING = 'Live location updates are failing. Retrying.';

function httpError(status: number) {
  return Object.assign(new Error(`Location update failed (${status})`), { status });
}

/** Advance fake time and let the async tick callbacks settle. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function startTrackingForTest() {
  let result: unknown;
  await act(async () => {
    result = await latest.startTracking({});
  });
  return result;
}

function resetHappyPathMocks() {
  jest.clearAllMocks();
  mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockLocation.getCurrentPositionAsync.mockResolvedValue(FIX);
  mockLocation.watchPositionAsync.mockImplementation(async () => ({ remove: jest.fn() }));
  mockLiveApi.start.mockResolvedValue({ id: 's1' });
  mockLiveApi.end.mockResolvedValue(undefined);
  mockLiveApi.heartbeat.mockResolvedValue(undefined);
  mockLiveApi.getMySession.mockResolvedValue(null);
}

describe('useLiveTracking upload failures (T-11)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetHappyPathMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sets an error after three consecutive failed uploads and delays the next tick', async () => {
    mockLiveApi.updateLocation.mockRejectedValue(httpError(500));
    await act(async () => {
      create(<Probe />);
    });
    await startTrackingForTest();

    await advance(5000); // tick 1 fails
    expect(mockLiveApi.updateLocation).toHaveBeenCalledTimes(1);
    await advance(5000); // backoff: no tick yet
    expect(mockLiveApi.updateLocation).toHaveBeenCalledTimes(1);
    await advance(5000); // backoff elapsed: tick 2 fails
    expect(mockLiveApi.updateLocation).toHaveBeenCalledTimes(2);
    await advance(20000); // second backoff elapsed: tick 3 fails
    expect(mockLiveApi.updateLocation).toHaveBeenCalledTimes(3);

    expect(latest.error).toBe(UPLOAD_FAILING);

    await advance(5000); // third backoff is longer than one normal interval
    expect(mockLiveApi.updateLocation).toHaveBeenCalledTimes(3);
  });

  it('stops the session and reports "session ended" on a 403', async () => {
    mockLiveApi.updateLocation.mockRejectedValue(httpError(403));
    await act(async () => {
      create(<Probe />);
    });
    await startTrackingForTest();
    await advance(5000);

    expect(latest.isTracking).toBe(false);
    expect(latest.session).toBeNull();
    expect(latest.error).toBe('Session ended');

    await advance(60000); // no further uploads once the session has ended
    expect(mockLiveApi.updateLocation).toHaveBeenCalledTimes(1);
  });

  it('stops the session and reports "session ended" on a 401', async () => {
    mockLiveApi.updateLocation.mockRejectedValue(httpError(401));
    await act(async () => {
      create(<Probe />);
    });
    await startTrackingForTest();
    await advance(5000);

    expect(latest.isTracking).toBe(false);
    expect(latest.session).toBeNull();
    expect(latest.error).toBe('Session ended');
  });

  it('never overlaps upload ticks while an upload is in flight', async () => {
    mockLiveApi.updateLocation.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      create(<Probe />);
    });
    await startTrackingForTest();

    await advance(5000);
    await advance(5000);
    await advance(5000);

    expect(mockLiveApi.updateLocation).toHaveBeenCalledTimes(1);
  });
});

describe('useLiveTracking start/stop lifecycle (T-12)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetHappyPathMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not leak timers or watchers when startTracking is called twice', async () => {
    const removers: jest.Mock[] = [];
    mockLocation.watchPositionAsync.mockImplementation(async () => {
      const remove = jest.fn();
      removers.push(remove);
      return { remove };
    });
    await act(async () => {
      create(<Probe />);
    });
    await act(async () => {
      await latest.startTracking({});
      await latest.startTracking({});
    });
    expect(mockLocation.watchPositionAsync).toHaveBeenCalledTimes(1);
    expect(mockLiveApi.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latest.stopTracking();
    });

    expect(removers).toHaveLength(1);
    removers.forEach((remove) => expect(remove).toHaveBeenCalled());

    // A leaked upload or heartbeat timer would fire here
    const heartbeatsAtStop = mockLiveApi.heartbeat.mock.calls.length;
    await advance(60000);
    expect(mockLiveApi.heartbeat).toHaveBeenCalledTimes(heartbeatsAtStop);
    expect(mockLiveApi.updateLocation).not.toHaveBeenCalled();
  });
});

describe('useLiveTracking restore on mount (T-13)', () => {
  const SESSION = { id: 's-restore' };

  /** Let the mount effect's chain of awaited mocks settle. */
  async function settle() {
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
  }

  beforeEach(() => {
    jest.useFakeTimers();
    resetHappyPathMocks();
    mockLiveApi.updateLocation.mockResolvedValue(undefined);
    mockLiveApi.getMySession.mockResolvedValue(SESSION);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('restarts the watcher and uploads within 5 s when a session exists and permission is granted', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    await act(async () => {
      create(<Probe isLoggedIn />);
    });
    await settle();

    expect(latest.isTracking).toBe(true);
    expect(mockLocation.watchPositionAsync).toHaveBeenCalledTimes(1);

    await advance(5000);
    expect(mockLiveApi.updateLocation).toHaveBeenCalledWith(FIX.coords.latitude, FIX.coords.longitude);
  });

  it('does not report tracking when a session exists but permission is not granted', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await act(async () => {
      create(<Probe isLoggedIn />);
    });
    await settle();

    expect(latest.isTracking).toBe(false);
    expect(mockLocation.watchPositionAsync).not.toHaveBeenCalled();
    await advance(5000);
    expect(mockLiveApi.updateLocation).not.toHaveBeenCalled();
  });
});

describe('useWatchContact (T-26)', () => {
  type Watch = ReturnType<typeof useWatchContact>;
  let latestWatch: Watch;

  function WatchProbe({ userId }: { userId: string | null }) {
    latestWatch = useWatchContact(userId);
    return null;
  }

  const contact = (userId: string) => ({
    active: true,
    user: { name: userId, username: null },
    session: {
      id: `session-${userId}`,
      current_lat: 51.5,
      current_lng: -0.12,
      started_at: new Date(0).toISOString(),
      last_update_at: new Date(0).toISOString(),
    },
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('drops a poll result that resolves after the userId has changed', async () => {
    let resolveFirst!: (value: unknown) => void;
    mockLiveApi.watchContact.mockImplementation((id: string) =>
      id === 'A'
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(contact('B')),
    );

    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<WatchProbe userId="A" />);
    });
    await act(async () => {
      tree!.update(<WatchProbe userId="B" />);
    });
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(latestWatch.data?.user?.name).toBe('B');

    // Contact A's poll finally answers, after the switch to B
    await act(async () => {
      resolveFirst(contact('A'));
    });

    expect(latestWatch.data?.user?.name).toBe('B');
    tree!.unmount();
  });

  it('clears the previous location when a poll fails', async () => {
    let calls = 0;
    mockLiveApi.watchContact.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return contact('A');
      throw new Error('Failed to watch contact');
    });

    let tree: ReturnType<typeof create> | undefined;
    await act(async () => {
      tree = create(<WatchProbe userId="A" />);
    });
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
    expect(latestWatch.data?.user?.name).toBe('A');

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(latestWatch.error).toBe('Failed to watch contact');
    expect(latestWatch.data).toBeNull();
    expect(latestWatch.active).toBe(false);
    tree!.unmount();
  });
});

describe('useLiveTracking stop and restore races (H-4, H-6)', () => {
  /** Flush microtasks until the condition holds (bounded). */
  async function settleUntil(condition: () => boolean) {
    for (let i = 0; i < 100 && !condition(); i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  beforeEach(() => {
    jest.useFakeTimers();
    resetHappyPathMocks();
    mockLiveApi.updateLocation.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not re-arm uploads when stop happens while an upload is in flight', async () => {
    let finishUpload!: () => void;
    mockLiveApi.updateLocation.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishUpload = resolve;
      }),
    );
    await act(async () => {
      create(<Probe />);
    });
    await startTrackingForTest();

    await advance(5000); // tick 1 starts and stays in flight
    expect(mockLiveApi.updateLocation).toHaveBeenCalledTimes(1);

    await act(async () => {
      await latest.stopTracking();
    });
    await act(async () => {
      finishUpload();
    });

    await advance(60000);
    expect(mockLiveApi.updateLocation).toHaveBeenCalledTimes(1);
  });

  it('removes a watcher that resolves after stopTracking', async () => {
    const remove = jest.fn();
    let resolveWatch!: (sub: { remove: jest.Mock }) => void;
    mockLocation.watchPositionAsync.mockImplementation(
      () => new Promise((resolve) => {
        resolveWatch = resolve;
      }),
    );
    await act(async () => {
      create(<Probe />);
    });

    let starting!: Promise<unknown>;
    await act(async () => {
      starting = latest.startTracking({});
    });
    await settleUntil(() => mockLocation.watchPositionAsync.mock.calls.length > 0);

    await act(async () => {
      await latest.stopTracking();
    });
    await act(async () => {
      resolveWatch({ remove });
    });
    await act(async () => {
      await starting;
    });

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not start a second watcher when startTracking runs during a pending restore', async () => {
    const SESSION = { id: 's-restore-race' };
    mockLiveApi.getMySession.mockResolvedValue(SESSION);
    let fixCalls = 0;
    let resolveRestoreFix!: (fix: unknown) => void;
    mockLocation.getCurrentPositionAsync.mockImplementation(() => {
      fixCalls += 1;
      return fixCalls === 1
        ? new Promise((resolve) => {
            resolveRestoreFix = resolve;
          })
        : Promise.resolve(FIX);
    });
    await act(async () => {
      create(<Probe isLoggedIn />);
    });
    await settleUntil(() => fixCalls === 1);

    let starting!: Promise<unknown>;
    await act(async () => {
      starting = latest.startTracking({});
    });
    await act(async () => {
      resolveRestoreFix(FIX);
    });
    await act(async () => {
      await starting;
    });
    await settleUntil(() => mockLocation.watchPositionAsync.mock.calls.length > 0);
    await settleUntil(() => latest.isTracking);

    expect(mockLocation.watchPositionAsync).toHaveBeenCalledTimes(1);
  });
});
