import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useNavigation, type NavigationInfo } from '@/src/hooks/useNavigation';
import { WALKING_SPEED_MPS } from '@/src/utils/tripTime';
import type { DirectionsRoute } from '@/src/types/geo';
import * as Location from 'expo-location';

jest.mock('@/src/services/userApi', () => ({
  subscriptionApi: {
    ensureFeatureAllowed: jest.fn(async () => undefined),
    consume: jest.fn(async () => undefined),
    syncFromLimitInfo: jest.fn(async () => undefined),
  },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 'Balanced', BestForNavigation: 'BestForNavigation' },
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
  onUpdate(useNavigation(route));
  return null;
}

const route: DirectionsRoute = {
  id: 'route-walking-speed',
  distanceMeters: 1000,
  durationSeconds: Math.round(1000 / WALKING_SPEED_MPS),
  encodedPolyline: 'abc',
  path: [
    { latitude: 51.5, longitude: -0.12 },
    { latitude: 51.5, longitude: -0.11 },
  ],
  steps: [
    {
      instruction: 'Head east',
      distanceMeters: 1000,
      durationSeconds: Math.round(1000 / WALKING_SPEED_MPS),
      startLocation: { latitude: 51.5, longitude: -0.12 },
      endLocation: { latitude: 51.5, longitude: -0.11 },
      maneuver: 'straight',
    },
  ],
};

describe('navigation ETA uses the shared walking speed (T-22)', () => {
  let renderer: ReactTestRenderer | null = null;
  let latest: NavigationInfo;
  let positionCallback: ((loc: any) => void) | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    positionCallback = null;
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.watchHeadingAsync as jest.Mock).mockResolvedValue({ remove: jest.fn() });
    (Location.watchPositionAsync as jest.Mock).mockImplementation(async (_o: unknown, cb: any) => {
      positionCallback = cb;
      return { remove: jest.fn() };
    });
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({
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

  it('remaining ETA equals remaining distance divided by WALKING_SPEED_MPS', async () => {
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

    await act(async () => {
      latest.start();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      positionCallback?.({ coords: { latitude: 51.5, longitude: -0.12, heading: -1 } });
    });

    expect(latest.state).toBe('navigating');
    expect(latest.remainingDistance).toBeGreaterThan(0);
    expect(Math.abs(latest.remainingDuration - latest.remainingDistance / WALKING_SPEED_MPS)).toBeLessThanOrEqual(1);
  });
});
