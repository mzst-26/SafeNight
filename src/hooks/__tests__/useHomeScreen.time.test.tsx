import React from 'react';
import { act, create } from 'react-test-renderer';

import { useHomeScreen } from '@/src/hooks/useHomeScreen';
import { useSafeRoutes } from '@/src/hooks/useSafeRoutes';
import { NOW_STATE } from '@/src/utils/tripTime';

jest.mock('@/src/hooks/useSafeRoutes', () => ({ useSafeRoutes: jest.fn() }));
jest.mock('@/src/hooks/useOnboarding', () => ({
  useOnboarding: () => ({ status: 'ready', hasAccepted: true, error: null, accept: jest.fn() }),
}));
jest.mock('@/src/hooks/useAuth', () => ({ useAuth: () => ({ user: { subscription: 'free' } }) }));
jest.mock('@/src/hooks/useCurrentLocation', () => ({
  useCurrentLocation: () => ({
    status: 'ready',
    location: { latitude: 51.5, longitude: -0.1 },
    error: null,
    refresh: jest.fn(),
  }),
}));
const searchStub = () => ({ query: '', place: null, predictions: [], clear: jest.fn(), setQuery: jest.fn() });
jest.mock('@/src/hooks/useAutoPlaceSearch', () => ({ useAutoPlaceSearch: () => searchStub() }));
jest.mock('@/src/hooks/useNavigation', () => ({ useNavigation: () => ({ state: 'idle' }) }));
jest.mock('@/src/hooks/useAIExplanation', () => ({ useAIExplanation: () => ({}) }));
jest.mock('@/src/services/openStreetMap', () => ({ reverseGeocode: jest.fn() }));
jest.mock('@/src/components/sheets/DraggableSheet', () => ({ SHEET_DEFAULT: 300 }));
jest.mock('@/src/services/safeRoutes', () => ({
  buildRouteLayerInput: jest.fn(),
  getRouteCrimeTotal: jest.fn(() => 0),
}));

const routesMock = useSafeRoutes as jest.Mock;
let home!: ReturnType<typeof useHomeScreen>;
function Probe() {
  home = useHomeScreen();
  return null;
}

describe('useHomeScreen trip time wiring', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-21T14:00:00Z') }); // 15:00 London
    routesMock.mockReset();
    routesMock.mockReturnValue({
      status: 'idle', routes: [], safestRoute: null, error: null, outOfRange: false,
      outOfRangeMessage: '', meta: null, timeUpdating: false,
    });
  });

  afterEach(() => jest.useRealTimers());

  it('defaults to leave now and passes the state as useSafeRoutes\' 6th argument', () => {
    act(() => { create(<Probe />); });
    expect(home.tripTime).toEqual(NOW_STATE);
    expect(routesMock.mock.calls.at(-1)?.[5]).toEqual(NOW_STATE);
  });

  it('setTripTime reaches useSafeRoutes and resetTripTime returns to leave now', () => {
    act(() => { create(<Probe />); });
    act(() => home.setTripTime({ mode: 'leave_at', hhmm: '17:15' }));
    expect(routesMock.mock.calls.at(-1)?.[5]).toEqual({ mode: 'leave_at', hhmm: '17:15' });
    act(() => home.resetTripTime());
    expect(routesMock.mock.calls.at(-1)?.[5]).toEqual(NOW_STATE);
  });

  it('exposes "Updating for HH:MM" only while useSafeRoutes reports stale results', () => {
    routesMock.mockReturnValue({
      status: 'ready', routes: [], safestRoute: null, error: null, outOfRange: false,
      outOfRangeMessage: '', meta: null, timeUpdating: true,
    });
    act(() => { create(<Probe />); });
    act(() => home.setTripTime({ mode: 'leave_at', hhmm: '17:10' }));
    expect(home.timeUpdatingLabel).toBe('Updating for 17:10');
    routesMock.mockReturnValue({ ...routesMock.mock.results.at(-1)!.value, timeUpdating: false });
    act(() => home.setTripTime({ mode: 'leave_at', hhmm: '17:10' }));
    expect(home.timeUpdatingLabel).toBeNull();
  });
});
