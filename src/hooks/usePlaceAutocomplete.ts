import { useEffect, useState } from 'react';

import { fetchPlacePredictions } from '@/src/services/osmDirections';
import { AppError } from '@/src/types/errors';
import type { LatLng, PlacePrediction } from '@/src/types/geo';

export type AutocompleteStatus = 'idle' | 'loading' | 'error' | 'ready';

export type UsePlaceAutocompleteState = {
  status: AutocompleteStatus;
  predictions: PlacePrediction[];
  error: AppError | null;
};

export const usePlaceAutocomplete = (
  query: string,
  locationBias?: LatLng | null
): UsePlaceAutocompleteState => {
  const [status, setStatus] = useState<AutocompleteStatus>('idle');
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 3) {
      setPredictions([]);
      setStatus('idle');
      setError(null);
      return;
    }

    setStatus('loading');
    setError(null);

    // Set when the query changes or the component unmounts. A response that
    // arrives after that belongs to an older query and must not overwrite state.
    let cancelled = false;

    const timeout = setTimeout(() => {
      fetchPlacePredictions(trimmedQuery, {
        locationBias: locationBias ?? undefined,
        radiusMeters: locationBias ? 5000 : undefined,
      })
        .then((results) => {
          if (cancelled) return;
          setPredictions(results);
          setStatus('ready');
        })
        .catch((caught) => {
          if (cancelled) return;
          const normalizedError =
            caught instanceof AppError
              ? caught
              : new AppError('autocomplete_error', 'Unable to fetch places', caught);

          setError(normalizedError);
          setStatus('error');
        });
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, locationBias?.latitude, locationBias?.longitude]);

  return {
    status,
    predictions,
    error,
  };
};
