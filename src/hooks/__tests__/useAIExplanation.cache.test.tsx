import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useAIExplanation, type UseAIExplanationState } from '@/src/hooks/useAIExplanation';
import { fetchAIExplanation } from '@/src/services/openai';
import { setMapSnapshotProvider } from '@/src/services/mapSnapshot';
import type { DirectionsRoute } from '@/src/types/geo';

jest.mock('@/src/services/openai', () => ({ fetchAIExplanation: jest.fn() }));

const fetchMock = fetchAIExplanation as jest.MockedFunction<typeof fetchAIExplanation>;

// Route ids repeat across searches (the client names them safe-route-0, -1, -2), so the
// cache must look at the route data, not just the ids.
function routesWith(distances: number[]): DirectionsRoute[] {
  return distances.map((distanceMeters, i) => ({
    id: `safe-route-${i}`,
    distanceMeters,
    durationSeconds: distanceMeters,
  })) as unknown as DirectionsRoute[];
}

function scoresWith(values: number[]) {
  return Object.fromEntries(values.map((score, i) => [`safe-route-${i}`, { score }])) as any;
}

let latest: UseAIExplanationState;

function Harness(props: { routes: DirectionsRoute[]; scores: any; best: string; safeRoutes?: any[] }) {
  latest = useAIExplanation({} as any, props.routes, props.scores, props.best, props.safeRoutes as any);
  return null;
}

function mount(routes: DirectionsRoute[], scores: any, best = 'safe-route-0', safeRoutes?: any[]): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Harness routes={routes} scores={scores} best={best} safeRoutes={safeRoutes} />);
  });
  return renderer;
}

async function askAndSettle(renderer: ReactTestRenderer) {
  await act(async () => {
    latest.ask();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return renderer;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('useAIExplanation cache is per route, not per route id', () => {
  test('a new search with the same ids but different routes asks the model again', async () => {
    fetchMock.mockResolvedValueOnce('Explanation for search one.');
    fetchMock.mockResolvedValueOnce('Explanation for search two.');

    const first = mount(routesWith([1000, 1200, 1400]), scoresWith([80, 60, 55]));
    await askAndSettle(first);
    expect(latest.explanation).toBe('Explanation for search one.');

    const second = mount(routesWith([2500, 2700, 2900]), scoresWith([70, 65, 50]));
    await askAndSettle(second);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(latest.explanation).toBe('Explanation for search two.');
  });

  test('the same route asked again is served from the cache', async () => {
    fetchMock.mockResolvedValueOnce('Cached explanation.');

    const renderer = mount(routesWith([3000, 3100]), scoresWith([75, 40]), 'safe-route-0');
    await askAndSettle(renderer);
    await askAndSettle(renderer);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latest.explanation).toBe('Cached explanation.');
  });

  test('the same ids with a changed score (for example after a time change) asks again', async () => {
    fetchMock.mockResolvedValueOnce('Before the time change.');
    fetchMock.mockResolvedValueOnce('After the time change.');

    await askAndSettle(mount(routesWith([4000, 4100]), scoresWith([80, 50])));
    await askAndSettle(mount(routesWith([4000, 4100]), scoresWith([60, 50])));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(latest.explanation).toBe('After the time change.');
  });

  test('sends the risk context for each route: unlit stretch, darkness, dead ends and missing crime data', async () => {
    fetchMock.mockResolvedValueOnce('Risk context sent.');
    const safeRoutes = [
      {
        id: 'safe-route-0',
        safety: {
          worstStretch: { start: { lat: 0, lng: 0 }, end: { lat: 0, lng: 0 }, lengthM: 320, cause: 'lighting' },
          timeline: { leaveAtIso: '', arriveAtIso: '', darknessAtStart: 0.9, darknessAtArrival: 0.9, label: 'dark' },
          dataQuality: { lighting: 'estimated', crime: 'unavailable' },
        },
        routeStats: { deadEnds: 2 },
      },
    ];

    await askAndSettle(mount(routesWith([5000, 5100]), scoresWith([70, 60]), 'safe-route-0', safeRoutes));

    const sent = fetchMock.mock.calls[0][0] as any;
    expect(sent.routes[0]).toMatchObject({
      worstStretch: { lengthM: 320, cause: 'lighting' },
      darknessAtStart: 0.9,
      darknessAtArrival: 0.9,
      lightingQuality: 'estimated',
      deadEnds: 2,
      crimeDataUnavailable: true,
    });
  });

  test('sends the map picture with the question when the map can provide one', async () => {
    const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
    setMapSnapshotProvider(async () => JPEG);
    fetchMock.mockResolvedValueOnce('With a picture.');

    await askAndSettle(mount(routesWith([6000, 6100]), scoresWith([70, 50])));

    expect((fetchMock.mock.calls[0][0] as any).mapImage).toBe(JPEG);
    setMapSnapshotProvider(null);
  });

  test('asks without a picture when the map has none', async () => {
    setMapSnapshotProvider(async () => null);
    fetchMock.mockResolvedValueOnce('Without a picture.');

    await askAndSettle(mount(routesWith([6200, 6300]), scoresWith([70, 50])));

    expect((fetchMock.mock.calls[0][0] as any).mapImage).toBeUndefined();
    setMapSnapshotProvider(null);
  });

  test('a cached explanation is shown without taking a new picture', async () => {
    const provider = jest.fn(async () => 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==');
    setMapSnapshotProvider(provider);
    fetchMock.mockResolvedValueOnce('Once only.');

    const renderer = mount(routesWith([6400, 6500]), scoresWith([70, 50]));
    await askAndSettle(renderer);
    await askAndSettle(renderer);

    expect(provider).toHaveBeenCalledTimes(1);
    expect(latest.explanation).toBe('Once only.');
    setMapSnapshotProvider(null);
  });
});
