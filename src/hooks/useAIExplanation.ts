import { useCallback, useRef, useState } from 'react';

import type { RouteScore } from '@/src/hooks/useAllRoutesSafety';
import { fetchAIExplanation, type CompactRouteInfo } from '@/src/services/openai';
import type { SafeRoute } from '@/src/services/safeRoutes';
import type { SafetyMapResult } from '@/src/services/safetyMapData';
import { subscriptionApi } from '@/src/services/userApi';
import type { DirectionsRoute } from '@/src/types/google';
import { LimitError, emitLimitReached } from '@/src/types/limitError';

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
// Module-level cache: keyed by a fingerprint of the search (route IDs + best)
// so only ONE AI call is made per search. Persists across re-renders.
// ---------------------------------------------------------------------------
const explanationCache = new Map<string, string>();

/** Build a stable cache key from the set of route IDs + the chosen best */
const buildCacheKey = (routes: DirectionsRoute[], bestRouteId: string): string =>
  `${routes.map((r) => r.id).sort().join('|')}__best=${bestRouteId}`;

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
      setError('No safest route selected yet.');
      setStatus('error');
      return;
    }

    // ── Check client-side cache first ──
    const cacheKey = buildCacheKey(routes, bestRouteId);
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

    // ── Pre-check subscription limit before calling backend ──
    try {
      const check = await subscriptionApi.checkFeature('ai_explanation');
      if (!check.allowed) {
        emitLimitReached({
          feature: 'ai_explanation',
          currentTier: check.tier,
          limit: check.limit,
          used: check.used,
          remaining: check.remaining,
          per: check.per || null,
          resetsAt: check.resets_at || null,
          message: `You've used all ${check.limit} AI explanations${check.per ? ` per ${check.per}` : ''} on the ${check.tier} plan.`,
          errorType: check.reason === 'upgrade_required' ? 'upgrade_required' : 'limit_reached',
        });
        setStatus('idle');
        return;
      }
    } catch {
      // If check fails, proceed anyway — backend will enforce if needed
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

    fetchAIExplanation({
      routes: compactRoutes,
      bestRouteId,
    })
      .then((text) => {
        // Store in client cache so repeat asks return instantly
        explanationCache.set(cacheKey, text);
        activeCacheKeyRef.current = cacheKey;
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
