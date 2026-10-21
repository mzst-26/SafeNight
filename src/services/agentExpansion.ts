import type { RouteScore } from '@/src/hooks/useAllRoutesSafety';
import type { AgentActionResult, CandidatePoint } from '@/src/services/agentClient';
import type { SafeRoute } from '@/src/services/safeRoutes';
import type { LatLng } from '@/src/types/geo';

/** Distance from the centre to each expansion ring point, in metres. */
export const RING_RADIUS_M = 800;

const METRES_PER_DEG_LAT = 111320;

const RING_DIRECTIONS: { id: string; label: string; bearingDeg: number }[] = [
  { id: 'r1', label: 'North area', bearingDeg: 0 },
  { id: 'r2', label: 'North-east area', bearingDeg: 45 },
  { id: 'r3', label: 'East area', bearingDeg: 90 },
  { id: 'r4', label: 'South-east area', bearingDeg: 135 },
  { id: 'r5', label: 'South area', bearingDeg: 180 },
  { id: 'r6', label: 'South-west area', bearingDeg: 225 },
  { id: 'r7', label: 'West area', bearingDeg: 270 },
  { id: 'r8', label: 'North-west area', bearingDeg: 315 },
];

/**
 * Eight candidate points around a centre, RING_RADIUS_M away, every 45 degrees
 * starting north and going clockwise. Uses a flat-earth offset, which is accurate
 * enough at this radius.
 */
export function expansionRingPoints(centre: LatLng): CandidatePoint[] {
  const latRad = (centre.latitude * Math.PI) / 180;
  const metresPerDegLng = METRES_PER_DEG_LAT * Math.cos(latRad);

  return RING_DIRECTIONS.map(({ id, label, bearingDeg }) => {
    const rad = (bearingDeg * Math.PI) / 180;
    const northM = RING_RADIUS_M * Math.cos(rad);
    const eastM = RING_RADIUS_M * Math.sin(rad);
    return {
      id,
      label,
      lat: centre.latitude + northM / METRES_PER_DEG_LAT,
      lng: centre.longitude + eastM / metresPerDegLng,
      kind: 'ring',
    };
  });
}

// ── Expansion search (E1) ───────────────────────────────────────────────────

/** At most this many new routes come from one expansion, and the map never holds more than the total. */
export const EXPANSION_MAX_NEW_ROUTES = 3;
export const EXPANSION_MAX_ROUTES = 6;
/** Ids of the routes an expansion adds start with this prefix. The walker's own route ids never do. */
export const EXPANDED_ROUTE_PREFIX = 'expanded-route-';

/** Fetches one walking route from origin to destination that goes through the via point. Null when none. */
export type ExpansionRouteFetch = (
  origin: LatLng,
  destination: LatLng,
  via: LatLng,
) => Promise<SafeRoute | null>;

/** The existing client scorer: one RouteScore per route, keyed by route id. */
export type ExpansionScorer = (routes: SafeRoute[]) => Record<string, RouteScore>;

export interface ExpansionRequest {
  /** Ids the agent named. Only ring points of `candidates` are used; any other id gives ok false. */
  candidateIds: string[];
  candidates: CandidatePoint[];
  origin: LatLng;
  destination: LatLng;
  /** Routes already on the agent's map. New routes fill up to EXPANSION_MAX_ROUTES. */
  existingCount: number;
  fetchRoute: ExpansionRouteFetch;
  scoreRoutes: ExpansionScorer;
}

export interface ExpansionOutcome {
  /** New routes, ids `expanded-route-N` where N is the route's number on the map (4, 5, 6). */
  routes: SafeRoute[];
  scores: Record<string, RouteScore>;
  /** The ring point each new route was searched through, keyed by route id. */
  ringByRoute: Record<string, CandidatePoint>;
  /** One result per requested id, in order: ok false when that point gave no route. */
  results: AgentActionResult[];
}

/**
 * Runs one route search through each named ring point (up to the room left on the map), then scores
 * the new routes with the caller's scorer. A point whose fetch fails, returns nothing, or is not a
 * ring point of this search gives ok false; the others still count.
 */
export async function runExpansionSearch(request: ExpansionRequest): Promise<ExpansionOutcome> {
  const room = Math.max(
    0,
    Math.min(EXPANSION_MAX_NEW_ROUTES, EXPANSION_MAX_ROUTES - request.existingCount),
  );

  // Decide which points get a fetch before any call, so the order and the limit are fixed.
  const plan = request.candidateIds.map((id) => {
    const point = request.candidates.find((c) => c.id === id && c.kind === 'ring');
    return point ?? null;
  });
  let used = 0;
  const jobs = plan.map((point) => {
    if (!point || used >= room) return null;
    used += 1;
    return point;
  });

  const fetched = await Promise.all(
    jobs.map(async (point) => {
      if (!point) return null;
      try {
        return await request.fetchRoute(request.origin, request.destination, {
          latitude: point.lat,
          longitude: point.lng,
        });
      } catch {
        return null;
      }
    }),
  );

  const routes: SafeRoute[] = [];
  const ringByRoute: Record<string, CandidatePoint> = {};
  const results: AgentActionResult[] = fetched.map((route, index) => {
    const point = jobs[index];
    if (!route || !point) return { type: 'expand_search', ok: false };
    const id = `${EXPANDED_ROUTE_PREFIX}${request.existingCount + routes.length + 1}`;
    routes.push({ ...route, id });
    ringByRoute[id] = point;
    return { type: 'expand_search', ok: true };
  });

  const scores = routes.length > 0 ? request.scoreRoutes(routes) : {};
  return { routes, scores, ringByRoute, results };
}

/**
 * The client's score for each route, built the way useHomeScreen builds its routeScores (the same
 * fields from the safety result). Kept here because that map is inline in the hook.
 */
export const scoreExpandedRoutes: ExpansionScorer = (routes) => {
  const scores: Record<string, RouteScore> = {};
  for (const r of routes) {
    scores[r.id] = {
      routeId: r.id,
      score: r.safety.score,
      pathfindingScore: r.safety.score,
      label: r.safety.label,
      color: r.safety.color,
      mainRoadRatio: r.safety.mainRoadRatio / 100,
      dataConfidence: 1,
      status: 'done',
    };
  }
  return scores;
};

/**
 * The route fetch the agent uses: the existing safe-route search with a via point, the same one the
 * walker's reroute uses. Returns the first route it gives, or null.
 */
export const fetchRouteThroughPoint: ExpansionRouteFetch = async (origin, destination, via) => {
  // Loaded here, not at the top, so importing this module does not pull in native storage.
  const { fetchSafeRoutes } = await import('@/src/services/safeRoutes');
  const response = await fetchSafeRoutes(origin, destination, 'free', undefined, via);
  return response.routes[0] ?? null;
};
