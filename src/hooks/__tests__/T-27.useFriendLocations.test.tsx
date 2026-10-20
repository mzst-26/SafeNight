import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState } from 'react-native';

import { useFriendLocations, type FriendLocationResult } from '@/src/hooks/useFriendLocations';
import { contactsApi } from '@/src/services/userApi';

jest.mock('@/src/services/userApi', () => ({
  contactsApi: { getAll: jest.fn() },
}));

const liveContact = {
  user: { id: 'friend-1', name: 'Ada' },
  nickname: null,
  is_live: true,
  live_session: {
    current_lat: 51.5,
    current_lng: -0.12,
    destination_name: 'Home',
    path: [],
    route_path: null,
  },
};

function Probe({
  enabled,
  onUpdate,
}: {
  enabled: boolean;
  onUpdate: (state: FriendLocationResult) => void;
}) {
  onUpdate(useFriendLocations(enabled));
  return null;
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useFriendLocations stale data and background checks (T-27)', () => {
  const mockGetAll = contactsApi.getAll as jest.Mock;
  const originalAppState = AppState.currentState;
  let renderer: ReactTestRenderer | null = null;
  let latest: FriendLocationResult;

  const mount = async () => {
    await act(async () => {
      renderer = create(
        <Probe
          enabled
          onUpdate={(state) => {
            latest = state;
          }}
        />,
      );
    });
    await flush();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (AppState as any).currentState = 'active';
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = null;
    }
    (AppState as any).currentState = originalAppState;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('keeps the last markers, flags them stale, and timestamps them when a later request fails', async () => {
    mockGetAll.mockResolvedValueOnce([liveContact]);
    await mount();

    expect(latest.friends).toHaveLength(1);
    expect(typeof latest.friends[0].updatedAt).toBe('number');
    expect(latest.friends[0].stale).toBe(false);

    mockGetAll.mockRejectedValueOnce(new Error('network down'));
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    await flush();

    expect(latest.friends).toHaveLength(1);
    expect(typeof latest.friends[0].updatedAt).toBe('number');
    expect(latest.friends[0].stale).toBe(true);
  });

  it('returns a skipped status, not found 0, when checked while the app is backgrounded', async () => {
    (AppState as any).currentState = 'background';
    mockGetAll.mockResolvedValue([liveContact]);
    await mount();

    let result!: Awaited<ReturnType<FriendLocationResult['checkNow']>>;
    await act(async () => {
      result = await latest.checkNow();
    });

    expect(mockGetAll).not.toHaveBeenCalled();
    expect(result.status).toBe('skipped');
    expect(result.found).not.toBe(0);
  });
});
