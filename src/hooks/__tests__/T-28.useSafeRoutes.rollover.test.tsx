import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useSafeRoutes, type UseSafeRoutesState } from '@/src/hooks/useSafeRoutes';
import { fetchSafeRoutes } from '@/src/services/safeRoutes';

jest.mock('@/src/services/safeRoutes', () => ({
  fetchSafeRoutes: jest.fn(),
}));

const ORIGIN = { latitude: 51.5, longitude: -0.1 };
const DEST = { latitude: 51.52, longitude: -0.12 };

function Probe({
  tripTime,
  onUpdate,
}: {
  tripTime: { mode: 'leave_at' | 'arrive_by' | 'now'; hhmm: string | null };
  onUpdate: (state: UseSafeRoutesState) => void;
}) {
  onUpdate(useSafeRoutes(ORIGIN, DEST, 'free', undefined, null, tripTime));
  return null;
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useSafeRoutes rolls a past leave-at time forward (T-28)', () => {
  const mockFetch = fetchSafeRoutes as jest.Mock;
  let renderer: ReactTestRenderer | null = null;
  let latest: UseSafeRoutesState;

  beforeEach(() => {
    // 08:50 London (BST, UTC+1) on 2026-10-21
    jest.useFakeTimers({ now: new Date('2026-10-21T07:50:00Z') });
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ status: 'OK', routes: [], meta: {} });
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = null;
    }
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('moves the bucket to tomorrow after 09:00 passes and reports timeUpdating', async () => {
    await act(async () => {
      renderer = create(
        <Probe
          tripTime={{ mode: 'leave_at', hhmm: '09:00' }}
          onUpdate={(state) => {
            latest = state;
          }}
        />,
      );
    });
    await flush();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe('ready');
    expect(latest.timeUpdating).toBe(false);

    // Advance to 09:01 London (11 minutes). The 60 s tick must notice the roll-over.
    await act(async () => {
      jest.advanceTimersByTime(11 * 60_000);
    });

    expect(latest.timeUpdating).toBe(true);
  });
});
