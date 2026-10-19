/**
 * Pure helper that builds the per-route data for the route comparison cards.
 *
 * "Fastest" is the route with the smallest duration (ties go to the earlier route in the input).
 * Deltas are `route - fastest`, so positive distance means longer than the fastest route, and
 * positive score means safer. No React, no I/O, and the input is not mutated.
 */
import type { RouteDataQuality } from "@/src/services/safeRoutes";

export interface RouteComparisonSource {
  id: string;
  /** 0-100 safety score. */
  score: number | null | undefined;
  /** 0-1 evidence strength (v2). */
  certainty?: number | null;
  /** One-sentence explanation (v2). */
  reason?: string | null;
  dataQuality?: RouteDataQuality | null;
  durationSec: number;
  distanceM: number;
}

export interface RouteComparison {
  routeId: string;
  score: number | null;
  certainty: number | null;
  reason: string | null;
  dataQuality: RouteDataQuality | null;
  durationSec: number;
  distanceM: number;
  /** Score minus the fastest route's score. Null if either score is missing. */
  deltaScoreVsFastest: number | null;
  /** Distance minus the fastest route's distance, in metres. Null if no fastest route. */
  deltaDistanceVsFastest: number | null;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function pickFastest(routes: RouteComparisonSource[]): RouteComparisonSource | null {
  let fastest: RouteComparisonSource | null = null;
  for (const route of routes) {
    if (!isFiniteNumber(route.durationSec)) continue;
    if (fastest === null || route.durationSec < fastest.durationSec) fastest = route;
  }
  return fastest;
}

export function buildRouteComparison(routes: RouteComparisonSource[]): RouteComparison[] {
  const fastest = pickFastest(routes);

  return routes.map((route) => {
    const score = isFiniteNumber(route.score) ? route.score : null;
    const fastestScore = fastest && isFiniteNumber(fastest.score) ? fastest.score : null;

    return {
      routeId: route.id,
      score,
      certainty: isFiniteNumber(route.certainty) ? route.certainty : null,
      reason: typeof route.reason === "string" ? route.reason : null,
      dataQuality: route.dataQuality ?? null,
      durationSec: route.durationSec,
      distanceM: route.distanceM,
      deltaScoreVsFastest:
        score !== null && fastestScore !== null ? score - fastestScore : null,
      deltaDistanceVsFastest:
        fastest && isFiniteNumber(route.distanceM) && isFiniteNumber(fastest.distanceM)
          ? route.distanceM - fastest.distanceM
          : null,
    };
  });
}
