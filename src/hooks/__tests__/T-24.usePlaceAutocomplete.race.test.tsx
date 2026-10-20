import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { usePlaceAutocomplete, type UsePlaceAutocompleteState } from '@/src/hooks/usePlaceAutocomplete';
import { fetchPlacePredictions } from '@/src/services/osmDirections';
import type { PlacePrediction } from '@/src/types/geo';

jest.mock('@/src/services/osmDirections', () => ({
  fetchPlacePredictions: jest.fn(),
}));

const prediction = (placeId: string, description: string): PlacePrediction =>
  ({ placeId, description, mainText: description, secondaryText: '' } as unknown as PlacePrediction);

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

function Probe({
  query,
  onUpdate,
}: {
  query: string;
  onUpdate: (state: UsePlaceAutocompleteState) => void;
}) {
  onUpdate(usePlaceAutocomplete(query));
  return null;
}

describe('usePlaceAutocomplete stale responses (T-24)', () => {
  const mockFetch = fetchPlacePredictions as jest.Mock;
  let renderer: ReactTestRenderer | null = null;
  let latest: UsePlaceAutocompleteState;

  const render = (query: string) =>
    act(() => {
      if (!renderer) {
        renderer = create(
          <Probe
            query={query}
            onUpdate={(state) => {
              latest = state;
            }}
          />,
        );
      } else {
        renderer.update(
          <Probe
            query={query}
            onUpdate={(state) => {
              latest = state;
            }}
          />,
        );
      }
    });

  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    renderer = null;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('ignores predictions from an older query that resolves after a newer one', async () => {
    const older = deferred<PlacePrediction[]>();
    const newer = deferred<PlacePrediction[]>();
    mockFetch.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    render('oxford');
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    render('oxford street');
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      newer.resolve([prediction('new', 'Oxford Street, London')]);
      await newer.promise;
    });
    await act(async () => {
      older.resolve([prediction('old', 'Oxford Circus, London')]);
      await older.promise;
    });

    expect(latest.status).toBe('ready');
    expect(latest.predictions.map((p) => p.placeId)).toEqual(['new']);
  });

  it('ignores an error from an older query after a newer query has succeeded', async () => {
    const older = deferred<PlacePrediction[]>();
    const newer = deferred<PlacePrediction[]>();
    mockFetch.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    render('brixton');
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    render('brixton road');
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await act(async () => {
      newer.resolve([prediction('new', 'Brixton Road, London')]);
      await newer.promise;
    });
    await act(async () => {
      older.promise.catch(() => undefined);
      older.resolve([]);
      await older.promise;
    });

    expect(latest.status).toBe('ready');
    expect(latest.error).toBeNull();
    expect(latest.predictions.map((p) => p.placeId)).toEqual(['new']);
  });
});
