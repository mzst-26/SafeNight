/**
 * openai.ts
 *
 * Lightweight OpenAI chat-completion wrapper.
 * Sends COMPACT aggregated route data (no per-segment data) to the backend,
 * which handles the OpenAI call securely and caches results for 1 hour.
 */

import { env } from '@/src/config/env';
import { subscriptionApi } from '@/src/services/userApi';
import { emitLimitReached, LimitError, parseLimitResponse } from '@/src/types/limitError';

/** Safety factor breakdown scores (0-100 each) */
export interface SafetyBreakdownCompact {
  roadType: number;
  lighting: number;
  crime: number;
  cctv: number;
  openPlaces: number;
  traffic: number;
}

/** Aggregated totals for the whole route (not per-segment) */
export interface RouteTotals {
  crimes: number;
  lights: number;
  cctv: number;
  places: number;
  busStops: number;
  deadEnds: number;
}

/** Road data summary for the whole route */
export interface RouteRoadData {
  mainRoadPct: number;
  pavedPct: number;
  sidewalkPct: number;
  roadTypes?: Record<string, number>;
}

/** Compact per-route info — aggregated totals only, no segments */
export interface CompactRouteInfo {
  routeId: string;
  distanceMeters: number;
  durationSeconds: number;
  score: number;
  breakdown?: SafetyBreakdownCompact;
  totals?: RouteTotals;
  roadData?: RouteRoadData;
}

export interface AIExplanationInput {
  /** Top 3 routes with aggregated data only */
  routes: CompactRouteInfo[];
  /** Which route id is the recommended safest one */
  bestRouteId: string;
}

/**
 * Ask backend for a concise (~100 word) explanation of why the
 * safest route is safer than the alternatives.
 *
 * NOTE: The OpenAI API key is kept SECRET on the backend.
 * The backend also caches explanations for 1 hour.
 */
export const fetchAIExplanation = async (input: AIExplanationInput): Promise<string> => {
  await subscriptionApi.ensureFeatureAllowed('ai_explanation');

  const apiBaseUrl = env.apiBaseUrl;
  if (!apiBaseUrl) {
    throw new Error('Missing EXPO_PUBLIC_API_BASE_URL. Set it in your .env file.');
  }

  const startedAt = Date.now();
  console.log(`[OpenAI] 🌐 Backend call → ${apiBaseUrl}/api/explain-route`);

  const response = await fetch(`${apiBaseUrl}/api/explain-route`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`[OpenAI] ❌ Backend error ${response.status}`);
    // Check for subscription limit error
    if (response.status === 403) {
      try {
        const parsed = JSON.parse(body);
        const limitInfo = parseLimitResponse(parsed);
        if (limitInfo) {
          await subscriptionApi.syncFromLimitInfo(limitInfo);
          emitLimitReached(limitInfo);
          throw new LimitError(limitInfo);
        }
      } catch (e) {
        if (e instanceof LimitError) throw e;
      }
    }
    throw new Error(`Backend error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const explanation: string | undefined = data?.explanation;
  const wasCached: boolean = data?.cached ?? false;
  console.log(
    `[OpenAI] 📦 Response: ${explanation ? explanation.length + ' chars' : 'empty'}${wasCached ? ' (cached)' : ''} in ${Date.now() - startedAt}ms`
  );

  if (!explanation) {
    throw new Error('No explanation from backend');
  }

  await subscriptionApi.consume('ai_explanation');

  return explanation.trim();
};
