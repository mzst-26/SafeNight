/**
 * compactRoutes — builds the aggregated, per-route data sent to the backend for AI answers.
 * Pure: no hooks, no network. The explanation and the AI Insights agent both use it.
 */
import type { RouteScore } from '@/src/hooks/useAllRoutesSafety';
import type { CompactRouteInfo } from '@/src/services/openai';
import type { SafeRoute } from '@/src/services/safeRoutes';
import type { DirectionsRoute } from '@/src/types/geo';

/** Top routes sent to the backend. */
export const MAX_COMPACT_ROUTES = 3;

export const buildCompactRoutes = (
  routes: DirectionsRoute[],
  scores: Record<string, RouteScore>,
  safeRoutes?: SafeRoute[],
): CompactRouteInfo[] =>
  routes.slice(0, MAX_COMPACT_ROUTES).map((r) => {
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
      worstStretch: safety?.worstStretch
        ? { lengthM: safety.worstStretch.lengthM, cause: safety.worstStretch.cause }
        : null,
      darknessAtStart: safety?.timeline?.darknessAtStart,
      darknessAtArrival: safety?.timeline?.darknessAtArrival,
      lightingQuality: safety?.dataQuality?.lighting,
      deadEnds: stats?.deadEnds,
      crimeDataUnavailable: safety?.dataQuality?.crime === 'unavailable',
    };
  });
