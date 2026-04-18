/**
 * useAutoPlaceSearch
 *
 * Replaces the old usePlaceAutocomplete + manual prediction selection.
 * When the user types a query and pauses (600 ms debounce), the hook
 * automatically fetches predictions and selects the first result.
 * Predictions are also exposed so the UI can show a dropdown letting
 * the user pick a different result.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchPlaceDetails, fetchPlacePredictions } from '@/src/services/osmDirections';
import { AppError } from '@/src/types/errors';
import type { LatLng, PlaceDetails, PlacePrediction } from '@/src/types/google';

export type AutoSearchStatus = 'idle' | 'searching' | 'found' | 'error';

export interface UseAutoPlaceSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  place: PlaceDetails | null;
  predictions: PlacePrediction[];
  status: AutoSearchStatus;
  error: AppError | null;
  /** Select a specific prediction from the dropdown */
  selectPrediction: (prediction: PlacePrediction) => void;
  /** Clear selected place (e.g. user taps ✕) */
  clear: () => void;
}

export const useAutoPlaceSearch = (
  locationBias?: LatLng | null,
  options?: { subscriptionTier?: string; radiusMiles?: number },
): UseAutoPlaceSearchReturn => {
  const [query, setQuery] = useState('');
  const [place, setPlace] = useState<PlaceDetails | null>(null);
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [status, setStatus] = useState<AutoSearchStatus>('idle');
  const [error, setError] = useState<AppError | null>(null);

  // Track whether the user is actively editing (vs. programmatic set)
  const skipAutoRef = useRef(false);
  // The query text that selectPrediction programmatically set
  const selectedQueryRef = useRef<string | null>(null);

  const setQueryWrapped = useCallback((q: string) => {
    // After selectPrediction, Android can re-fire onChangeText with the same
    // programmatic text.  Swallow that one echo but let genuine edits through.
    if (selectedQueryRef.current !== null) {
      if (q === selectedQueryRef.current) {
        // Same text → Android echo → ignore
        selectedQueryRef.current = null;
        return;
      }
      // Different text → user actually typed → proceed normally
      selectedQueryRef.current = null;
    }
    skipAutoRef.current = false;
    setPlace(null);
    setError(null);
    setStatus('idle');
    setQuery(q);
  }, []);

  const selectPrediction = useCallback((prediction: PlacePrediction) => {
    skipAutoRef.current = true;
    selectedQueryRef.current = prediction.primaryText;
    setPredictions([]);
    setQuery(prediction.primaryText);

    if (prediction.location) {
      setPlace({
        placeId: prediction.placeId,
        name: prediction.fullText,
        location: prediction.location,
        source: prediction.source,
      });
      setStatus('found');
    } else {
      // Prediction has no coordinates — fetch details to resolve location
      setStatus('searching');
      fetchPlaceDetails(prediction.placeId)
        .then((details) => {
          setPlace(details);
          setStatus('found');
        })
        .catch(() => {
          setError(new AppError('place_details_error', 'Could not resolve location'));
          setStatus('error');
        });
    }
  }, []);

  const clear = useCallback(() => {
    skipAutoRef.current = true;
    setQuery('');
    setPlace(null);
    setPredictions([]);
    setError(null);
    setStatus('idle');
  }, []);

  useEffect(() => {
    if (skipAutoRef.current) return;

    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setStatus('idle');
      setPredictions([]);
      return;
    }

    // If we already resolved this query, skip
    if (place) return;

    setError(null);

    const timer = setTimeout(async () => {
      // Only update status once the user has paused — avoids a state update on every keystroke
      setStatus('searching');
      try {
        const tier = (options?.subscriptionTier || 'free').toLowerCase();
        const defaultRadiusMiles = tier === 'free' ? 5 : 10;
        const radiusMiles = options?.radiusMiles ?? defaultRadiusMiles;
        const radiusMeters = Math.round(radiusMiles * 1609.34);
        const results = await fetchPlacePredictions(trimmed, {
          locationBias: locationBias ?? undefined,
          radiusMeters: locationBias ? radiusMeters : undefined,
          subscriptionTier: tier,
        });

        if (results.length === 0) {
          setStatus('error');
          setPredictions([]);
          setError(new AppError('no_results', 'No places found'));
          return;
        }

        // Expose all predictions for the dropdown — user must click to select
        setPredictions(results);
        setStatus('idle');
      } catch (e) {
        setStatus('error');
        setPredictions([]);
        setError(
          e instanceof AppError
            ? e
            : new AppError('autocomplete_error', 'Search failed', e),
        );
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [
    query,
    locationBias?.latitude,
    locationBias?.longitude,
    place,
    options?.subscriptionTier,
    options?.radiusMiles,
  ]);

  return { query, setQuery: setQueryWrapped, place, predictions, status, error, selectPrediction, clear };
};
