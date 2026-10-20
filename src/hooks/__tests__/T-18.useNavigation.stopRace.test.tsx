import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useNavigation, type NavigationInfo } from '@/src/hooks/useNavigation';
import type { DirectionsRoute } from '@/src/types/geo';
import * as Location from 'expo-location';

jest.mock('expo-location', () => ({
  Accuracy: {
    Balanced: 'Balanced',
    BestForNavigation: 'BestForNavigation',
  },
  requestForegroundPermissionsAsync: jest.fn(),
  watchHeadingAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

function Probe({
  route,
  onUpdate,
}: {
  route: DirectionsRoute | null;
  onUpdate: (state: NavigationInfo) => void;
}) {
  const nav = useNavigation(route);
  onUpdate(nav);
  return null;
}

const createRoute = (): DirectionsRoute => ({
  id: 'route-stop-race',
  distanceMeters: 220,
  durationSeconds: 160,
  encodedPolyline: 'abc',
  path: [
    { latitude: 51.5, longitude: -0.12 },
    { latitude: 51.5, longitude: -0.118 },
  ],
  steps: [
    {
      instruction: 'Head east',
      distanceMeters: 220,
      durationSeconds: 160,
      startLocation: { latitude: 51.5, longitude: -0.12 },
      endLocation: { latitude: 51.5, longitude: -0.118 },
      maneuver: 'straight',
    },
  ],
});

describe('useNavigation stop() during a pending start (T-18)', () => {
  const mockRequestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
  const mockWatchHeading = Location.watchHeadingAsync as jest.Mock;
  const mockWatchPosition = Location.watchPositionAsync as jest.Mock;
  const mockGetCurrentPosition = Location.getCurrentPositionAsync as jest.Mock;

  let renderer: ReactTestRenderer | null = null;
  let latest: NavigationInfo;
  let removeHeadingWatch: jest.Mock;
  let removePositionWatch: jest.Mock;

  const mount = async (route: DirectionsRoute | null) => {
    await act(async () => {
      renderer = create(
        <Probe
          route={route}
          onUpdate={(state) => {
            latest = state;
          }}
        />,
      );
    });
  };

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    removeHeadingWatch = jest.fn();
    removePositionWatch = jest.fn();

    mockRequestPermission.mockResolvedValue({ status: 'granted' });
    mockWatchHeading.mockResolvedValue({ remove: removeHeadingWatch });
    mockWatchPosition.mockResolvedValue({ remove: removePositionWatch });
    mockGetCurrentPosition.mockResolvedValue({
      coords: { latitude: 51.5, longitude: -0.12, heading: 90 },
    });
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

  it('removes a position watcher that resolves after stop() and clears its poll interval', async () => {
    let resolvePosition!: (sub: { remove: jest.Mock }) => void;
    mockWatchPosition.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePosition = resolve;
        }),
    );

    await mount(createRoute());
    await act(async () => {
      latest.start();
    });
    await flush();
    expect(mockWatchPosition).toHaveBeenCalledTimes(1);

    await act(async () => {
      latest.stop();
    });

    await act(async () => {
      resolvePosition({ remove: removePositionWatch });
    });
    await flush();

    expect(removePositionWatch).toHaveBeenCalled();

    mockGetCurrentPosition.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
  });

  it('does not attach any watcher when stop() happens during the permission prompt', async () => {
    let resolvePermission!: (value: { status: string }) => void;
    mockRequestPermission.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePermission = resolve;
        }),
    );

    await mount(createRoute());
    await act(async () => {
      latest.start();
    });

    await act(async () => {
      latest.stop();
    });

    await act(async () => {
      resolvePermission({ status: 'granted' });
    });
    await flush();

    expect(mockWatchPosition).not.toHaveBeenCalled();
    expect(mockWatchHeading).not.toHaveBeenCalled();
  });
});
