import React from 'react';
import { act, create } from 'react-test-renderer';

import { useSafeRoutes, type UseSafeRoutesState } from '@/src/hooks/useSafeRoutes';
import { fetchSafeRoutes } from '@/src/services/safeRoutes';
import type { TripTimeState } from '@/src/utils/tripTime';

jest.mock('@/src/services/safeRoutes', () => ({ fetchSafeRoutes: jest.fn() }));
jest.mock('@/src/types/limitError', () => ({ LimitError: class LimitError extends Error {} }));

const fetchMock = fetchSafeRoutes as jest.Mock;
const O = { latitude: 51.5, longitude: -0.1 };
const D = { latitude: 51.52, longitude: -0.12 };

let latest!: UseSafeRoutesState;
function Probe({ time, noDest }: { time: TripTimeState; noDest?: boolean }) {
  latest = useSafeRoutes(O, noDest ? null : D, 'free', 3, null, time);
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useSafeRoutes time handling', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-21T14:00:00Z') }); // 15:00 London
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ status: 'OK', routes: [{ id: 'r' }], meta: {} });
  });
  afterEach(() => jest.useRealTimers());

  const NOW: TripTimeState = { mode: 'now', hhmm: null };
  const at = (hhmm: string): TripTimeState => ({ mode: 'leave_at', hhmm });

  it('passes the chosen state (not a resolved ISO) to fetchSafeRoutes', async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe time={at('17:00')} />);
    });
    await flush();
    expect(fetchMock.mock.calls[0][5]).toEqual(at('17:00'));
    act(() => r.unmount());
  });

  it('debounces re-runs: several stepper taps cause exactly one extra fetch', async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe time={NOW} />);
    });
    await flush();
    expect(latest.status).toBe('ready');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (const t of ['17:00', '17:15', '17:30', '17:45']) {
      act(() => r.update(<Probe time={at(t)} />));
      act(() => {
        jest.advanceTimersByTime(100);
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1); // nothing yet
    expect(latest.timeUpdating).toBe(true); // results still for "now"

    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][5]).toEqual(at('17:45'));
    expect(latest.timeUpdating).toBe(false);
    act(() => r.unmount());
  });

  it('does not search when no routes are shown', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    let r: any;
    await act(async () => {
      r = create(<Probe time={NOW} />);
    });
    // still loading the first request; change in same bucket -> no extra
    act(() => r.update(<Probe time={NOW} />));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => r.unmount());
  });

  it('does not search for a time change while idle (no destination), and later searches use the new time', async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe time={NOW} noDest />);
    });
    act(() => r.update(<Probe time={at('17:00')} noDest />));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      r.update(<Probe time={at('17:00')} />);
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][5]).toEqual(at('17:00'));
    act(() => r.unmount());
  });
});
