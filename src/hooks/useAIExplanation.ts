import { useCallback, useRef, useState } from 'react';

import type { RouteScore } from '@/src/hooks/useAllRoutesSafety';
import { fetchAIExplanation, type CompactRouteInfo } from '@/src/services/openai';
import type { SafeRoute } from '@/src/services/safeRoutes';
import type { SafetyMapResult } from '@/src/services/safetyMapData';
import type { DirectionsRoute } from '@/src/types/geo';
import { LimitError } from '@/src/types/limitError';

export type AIStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface UseAIExplanationState {
  status: AIStatus;
  explanation: string | null;
  error: string | null;
  /** Call this to trigger the OpenAI request */
  ask: () => void;
  /** Reset back to idle */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Module-level cache. The key is the exact data the model receives, not the route
// ids: the client names routes safe-route-0, -1, -2 in every search, so ids alone
// would hand one search's explanation to a different route.
// ---------------------------------------------------------------------------
const MAX_CACHED_EXPLANATIONS = 50;
const explanationCache = new Map<string, string>();
const inFlightExplanationRequests = new Map<string, Promise<string>>();

const buildCacheKey = (compactRoutes: CompactRouteInfo[], bestRouteId: string): string =>
  JSON.stringify([compactRoutes, bestRouteId]);

const rememberExplanation = (key: string, text: string) => {
  explanationCache.set(key, text);
  // Map keeps insertion order, so the first key is the oldest.
  while (explanationCache.size > MAX_CACHED_EXPLANATIONS) {
    explanationCache.delete(explanationCache.keys().next().value as string);
  }
};

export const useAIExplanation = (
  safetyResult: SafetyMapResult | null,
  routes: DirectionsRoute[],
  scores: Record<string, RouteScore>,
  bestRouteId: string | null,
  /** Pass the full SafeRoute[] so we can extract aggregated safety data */
  safeRoutes?: SafeRoute[],
): UseAIExplanationState => {
  const [status, setStatus] = useState<AIStatus>('idle');
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Track which cache key the current explanation belongs to */
  const activeCacheKeyRef = useRef<string | null>(null);

  const ask = useCallback(async () => {
    if (!safetyResult) {
      setError('Safety analysis not ready yet.');
      setStatus('error');
      return;
    }
    if (!bestRouteId) {
      setError('No route selected yet.');
      setStatus('error');
      return;
    }

    // ── Build compact per-route data: aggregated totals only, top 3 ──
    const compactRoutes: CompactRouteInfo[] = routes.slice(0, 3).map((r) => {
      const safeRoute = safeRoutes?.find((sr) => sr.id === r.id);
      const score = scores[r.id];
      const pois = safeRoute?.routePOIs;
      const stats = safeRoute?.routeStats;
      const safety = safeRoute?.safety;

      return {
        routeId: r.id,
        distanceMeters: r.distanceMeters,
        durationSeconds: r.durationSeconds,
        score: score?.score ?? 0,
        breakdown: safety?.breakdown
          ? {
              roadType: safety.breakdown.roadType,
              lighting: safety.breakdown.lighting,
              crime: safety.breakdown.crime,
              cctv: safety.breakdown.cctv,
              openPlaces: safety.breakdown.openPlaces,
              traffic: safety.breakdown.traffic,
            }
          : undefined,
        totals: pois
          ? {
              crimes: pois.crimes?.length ?? 0,
              lights: pois.lights?.length ?? 0,
              cctv: pois.cctv?.length ?? 0,
              places: pois.places?.length ?? 0,
              busStops: pois.transit?.length ?? 0,
              deadEnds: pois.deadEnds?.length ?? 0,
            }
          : undefined,
        roadData: {
          mainRoadPct: safety?.mainRoadRatio ?? 0,
          pavedPct: 100 - (stats?.unpavedPct ?? 0),
          sidewalkPct: stats?.sidewalkPct ?? 0,
          roadTypes: safety?.roadTypes,
        },
      };
    });

    // ── Check client-side cache first (keyed by the data sent, so only this exact route hits) ──
    const cacheKey = buildCacheKey(compactRoutes, bestRouteId);
    const cached = explanationCache.get(cacheKey);
    if (cached) {
      setExplanation(cached);
      setStatus('ready');
      setError(null);
      activeCacheKeyRef.current = cacheKey;
      return;
    }

    setStatus('loading');
    setError(null);
    setExplanation(null);

    const startedAt = Date.now();
    const existingInFlight = inFlightExplanationRequests.get(cacheKey);
    const rawPromise =
      existingInFlight ??
      fetchAIExplanation({
        routes: compactRoutes,
        bestRouteId,
      });

    if (!existingInFlight) {
      inFlightExplanationRequests.set(cacheKey, rawPromise);
    }

    // Hard 40 s deadline — prevents spinner hanging forever on Render cold-starts
    const DEADLINE_MS = 40_000;
    const deadlinePromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI explanation timed out. Please try again.')), DEADLINE_MS),
    );
    const requestPromise = Promise.race([rawPromise, deadlinePromise]);

    requestPromise
      .then((text) => {
        // Store in client cache so repeat asks return instantly
        rememberExplanation(cacheKey, text);
        activeCacheKeyRef.current = cacheKey;
        console.log(`[AI] ✅ Explanation ready in ${Date.now() - startedAt}ms${existingInFlight ? ' (shared in-flight)' : ''}`);
        setExplanation(text);
        setStatus('ready');
      })
      .catch((err) => {
        // Limit errors handled by the global modal — don't show as AI error
        if (err instanceof LimitError) {
          setStatus('idle');
          return;
        }
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setStatus('error');
      })
      .finally(() => {
        // Only clear if this exact promise is still the active in-flight one
        const active = inFlightExplanationRequests.get(cacheKey);
        if (active === rawPromise) {
          inFlightExplanationRequests.delete(cacheKey);
        }
      });
  }, [safetyResult, routes, scores, bestRouteId, safeRoutes]);

  const reset = useCallback(() => {
    setStatus('idle');
    setExplanation(null);
    setError(null);
    activeCacheKeyRef.current = null;
  }, []);

  return { status, explanation, error, ask, reset };
};
