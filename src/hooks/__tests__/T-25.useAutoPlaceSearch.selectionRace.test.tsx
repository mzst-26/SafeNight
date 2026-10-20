import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useAutoPlaceSearch, type UseAutoPlaceSearchReturn } from '@/src/hooks/useAutoPlaceSearch';
import { fetchPlaceDetails, fetchPlacePredictions } from '@/src/services/osmDirections';
import type { PlaceDetails, PlacePrediction } from '@/src/types/geo';

jest.mock('@/src/services/osmDirections', () => ({
  fetchPlaceDetails: jest.fn(),
  fetchPlacePredictions: jest.fn(),
}));

function Probe({ onUpdate }: { onUpdate: (state: UseAutoPlaceSearchReturn) => void }) {
  onUpdate(useAutoPlaceSearch(null));
  return null;
}

/** Prediction A has no coordinates, so selecting it needs a details lookup. */
const predictionA: PlacePrediction = {
  placeId: 'place-a',
  primaryText: 'Slow Place',
  fullText: 'Slow Place, London',
  location: null,
  source: 'osm',
} as unknown as PlacePrediction;

/** Prediction B already has coordinates, so selecting it resolves immediately. */
const predictionB: PlacePrediction = {
  placeId: 'place-b',
  primaryText: 'Fast Place',
  fullText: 'Fast Place, London',
  location: { latitude: 51.51, longitude: -0.12 },
  source: 'osm',
} as unknown as PlacePrediction;

describe('useAutoPlaceSearch selectPrediction race (T-25)', () => {
  const mockDetails = fetchPlaceDetails as jest.Mock;
  let renderer: ReactTestRenderer | null = null;
  let latest: UseAutoPlaceSearchReturn;

  beforeEach(() => {
    jest.clearAllMocks();
    (fetchPlacePredictions as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    renderer = null;
  });

  it('keeps the later selection when an earlier details lookup resolves last', async () => {
    let resolveA!: (details: PlaceDetails) => void;
    mockDetails.mockImplementationOnce(
      () =>
        new Promise<PlaceDetails>((resolve) => {
          resolveA = resolve;
        }),
    );

    await act(async () => {
      renderer = create(
        <Probe
          onUpdate={(state) => {
            latest = state;
          }}
        />,
      );
    });

    await act(async () => {
      latest.selectPrediction(predictionA);
    });
    expect(mockDetails).toHaveBeenCalledWith('place-a');
    expect(latest.status).toBe('searching');

    await act(async () => {
      latest.selectPrediction(predictionB);
    });
    expect(latest.place?.placeId).toBe('place-b');
    expect(latest.status).toBe('found');

    await act(async () => {
      resolveA({
        placeId: 'place-a',
        name: 'Slow Place, London',
        location: { latitude: 51.5, longitude: -0.1 },
        source: 'osm',
      } as PlaceDetails);
      await Promise.resolve();
    });

    expect(latest.place?.placeId).toBe('place-b');
    expect(latest.status).toBe('found');
    expect(latest.error).toBeNull();
  });

  it('ignores a details lookup that resolves after clear()', async () => {
    let resolveA!: (details: PlaceDetails) => void;
    mockDetails.mockImplementationOnce(
      () =>
        new Promise<PlaceDetails>((resolve) => {
          resolveA = resolve;
        }),
    );

    await act(async () => {
      renderer = create(
        <Probe
          onUpdate={(state) => {
            latest = state;
          }}
        />,
      );
    });

    await act(async () => {
      latest.selectPrediction(predictionA);
    });
    await act(async () => {
      latest.clear();
    });

    await act(async () => {
      resolveA({
        placeId: 'place-a',
        name: 'Slow Place, London',
        location: { latitude: 51.5, longitude: -0.1 },
        source: 'osm',
      } as PlaceDetails);
      await Promise.resolve();
    });

    expect(latest.place).toBeNull();
    expect(latest.status).toBe('idle');
  });
});
