import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useCurrentLocation, type UseCurrentLocationState } from '@/src/hooks/useCurrentLocation';
import { getLastKnownLocation } from '@/src/services/location';
import * as Location from 'expo-location';

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 'Balanced', BestForNavigation: 'BestForNavigation' },
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const DAY_MS = 24 * 60 * 60 * 1000;

function Probe({ onUpdate }: { onUpdate: (state: UseCurrentLocationState) => void }) {
  onUpdate(useCurrentLocation());
  return null;
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useCurrentLocation with a stale cached position (T-29)', () => {
  let renderer: ReactTestRenderer | null = null;
  let latest: UseCurrentLocationState;

  beforeEach(() => {
    jest.clearAllMocks();
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 51.5, longitude: -0.12, accuracy: 10 },
      timestamp: Date.now() - 2 * DAY_MS,
    });
    // Live GPS is unavailable, so the only candidate for "ready" is the cache.
    (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error('GPS unavailable'));
  });

  afterEach(async () => {
    if (renderer) {
      await act(async () => {
        renderer?.unmount();
      });
      renderer = null;
    }
  });

  it('does not report ready from a cached position that is two days old', async () => {
    await act(async () => {
      renderer = create(
        <Probe
          onUpdate={(state) => {
            latest = state;
          }}
        />,
      );
    });
    await flush();

    expect(latest.status).not.toBe('ready');
    expect(latest.location).toBeNull();
  });

  it('service returns null for a cached position older than 10 minutes', async () => {
    await expect(getLastKnownLocation()).resolves.toBeNull();
  });

  it('service returns the cached coordinates when the position is fresh', async () => {
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValueOnce({
      coords: { latitude: 51.5, longitude: -0.12, accuracy: 10 },
      timestamp: Date.now() - 2 * 60 * 1000,
    });
    await expect(getLastKnownLocation()).resolves.toEqual({ latitude: 51.5, longitude: -0.12 });
  });
});
