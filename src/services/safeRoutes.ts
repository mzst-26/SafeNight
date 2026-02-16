/**
 * safeRoutes.ts — Frontend service for the safety-first pathfinding API.
 *
 * Calls the backend /api/safe-routes endpoint which builds an OSM walking
 * graph, scores edges using multiple safety factors (lighting, road type,
 * crime, open places, foot traffic), and returns 3–5 diverse routes ranked
 * by overall safety.
 */

import { env } from '@/src/config/env';
import { AppError } from '@/src/types/errors';
import type { DirectionsRoute, LatLng, RouteSegment } from '@/src/types/google';
import { emitLimitReached, LimitError, parseLimitResponse } from '@/src/types/limitError';
import { decodePolyline } from '@/src/utils/polyline';

const BACKEND_BASE = env.safetyApiUrl;

// ── Subscription tier distance limits (fallback only — prefer DB value) ──────
const DISTANCE_LIMITS_KM: Record<string, number> = {
  free: 1,      // 1 km for free users
  pro: 10,      // 10 km for pro users
  premium: 20,  // 20 km for premium users
};

/** Fallback: compute limit from tier when DB value is not available */
export function getMaxDistanceKmForTier(tier: string): number {
  return DISTANCE_LIMITS_KM[tier?.toLowerCase()] ?? DISTANCE_LIMITS_KM.free;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SafetyBreakdown {
  roadType: number;    // 0-100
  lighting: number;    // 0-100
  crime: number;       // 0-100 (higher = safer)
  cctv: number;        // 0-100 (CCTV/surveillance coverage)
  openPlaces: number;  // 0-100
  traffic: number;     // 0-100
}

export interface RouteSafety {
  score: number;            // 0-100
  label: string;            // "Very Safe" | "Safe" | "Moderate" | "Use Caution"
  color: string;            // hex colour
  breakdown: SafetyBreakdown;
  roadTypes: Record<string, number>;  // e.g. { primary: 40, residential: 35, footway: 25 }
  mainRoadRatio: number;    // 0-100
}

export interface SafeRoute extends DirectionsRoute {
  routeIndex: number;
  isSafest: boolean;
  safety: RouteSafety;
  safetySegments: RouteSegment[];
  enrichedSegments?: EnrichedSegment[];
  routeStats?: RouteStats;
  routePOIs?: RoutePOIs;
}

export interface RouteStats {
  deadEnds: number;
  sidewalkPct: number;
  unpavedPct: number;
  transitStopsNearby: number;
  cctvCamerasNearby: number;
  roadNameChanges: Array<{ segmentIndex: number; name: string; distance: number }>;
}

export interface RoutePOIs {
  cctv: Array<{ lat: number; lng: number }>;
  transit: Array<{ lat: number; lng: number }>;
  deadEnds: Array<{ lat: number; lng: number }>;
  lights: Array<{ lat: number; lng: number }>;
  places: Array<{ lat: number; lng: number }>;
  crimes: Array<{ lat: number; lng: number; category?: string }>;
}

export interface EnrichedSegment {
  startCoord: { latitude: number; longitude: number };
  endCoord: { latitude: number; longitude: number };
  midpointCoord: { latitude: number; longitude: number };
  safetyScore: number;
  color: string;
  highway: string;
  roadName: string;
  isDeadEnd: boolean;
  hasSidewalk: boolean;
  surfaceType: string;
  lightScore: number;
  crimeScore: number;
  cctvScore: number;
  placeScore: number;
  trafficScore: number;
  distance: number;
}

export interface SafeRoutesResponse {
  status: string;
  routes: SafeRoute[];
  meta: {
    straightLineDistanceKm: number;
    maxDistanceKm: number;
    routeCount: number;
    dataQuality: {
      roads: number;
      crimes: number;
      lightElements: number;
      cctvCameras: number;
      places: number;
      transitStops: number;
    };
    timing: {
      totalMs: number;
      dataFetchMs: number;
      graphBuildMs: number;
      pathfindMs: number;
    };
    computeTimeMs: number;
  };
  error?: string;
  message?: string;
}

// ── API response shape (before mapping) ─────────────────────────────────────

interface RawSafeRouteSegment {
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  safetyScore: number;
  color: string;
  highway: string;
  roadName?: string;
  isDeadEnd?: boolean;
  hasSidewalk?: boolean;
  surfaceType?: string;
  lightScore?: number;
  crimeScore?: number;
  cctvScore?: number;
  placeScore?: number;
  trafficScore?: number;
  distance?: number;
}

interface RawSafeRoute {
  routeIndex: number;
  isSafest: boolean;
  overview_polyline: { points: string };
  legs: Array<{
    distance: { text: string; value: number };
    duration: { text: string; value: number };
    start_location: { lat: number; lng: number };
    end_location: { lat: number; lng: number };
    steps: Array<unknown>;
  }>;
  summary: string;
  safety: {
    score: number;
    label: string;
    color: string;
    breakdown: SafetyBreakdown;
    roadTypes: Record<string, number>;
    mainRoadRatio: number;
  };
  segments: RawSafeRouteSegment[];
  routeStats?: {
    deadEnds: number;
    sidewalkPct: number;
    unpavedPct: number;
    transitStopsNearby: number;
    cctvCamerasNearby: number;
    roadNameChanges: Array<{ segmentIndex: number; name: string; distance: number }>;
  };
  routePOIs?: {
    cctv: Array<{ lat: number; lng: number }>;
    transit: Array<{ lat: number; lng: number }>;
    deadEnds: Array<{ lat: number; lng: number }>;
    lights: Array<{ lat: number; lng: number }>;
    places: Array<{ lat: number; lng: number }>;
    crimes: Array<{ lat: number; lng: number; category?: string }>;
  };
}

interface RawResponse {
  status: string;
  routes?: RawSafeRoute[];
  meta?: SafeRoutesResponse['meta'];
  error?: string;
  message?: string;
  detail?: string;
  // Extra fields from specific error responses
  estimatedDataPoints?: number;
  areaKm2?: number;
  maxDistanceKm?: number;
  actualDistanceKm?: number;
  graphNodes?: number;
  graphEdges?: number;
  roadCount?: number;
  which?: string;
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: SafeRoutesResponse;
  timestamp: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;

function cacheKey(origin: LatLng, dest: LatLng): string {
  return `${origin.latitude.toFixed(4)},${origin.longitude.toFixed(4)}->${dest.latitude.toFixed(4)},${dest.longitude.toFixed(4)}`;
}

// ── Main function ────────────────────────────────────────────────────────────

/**
 * Fetch 3–5 safety-ranked walking routes from the backend.
 *
 * @throws AppError with code 'DESTINATION_OUT_OF_RANGE' if > 20 km
 * @throws AppError with code 'safe_routes_error' on other failures
 */
export async function fetchSafeRoutes(
  origin: LatLng,
  destination: LatLng,
  subscriptionTier: string = 'free',
  maxDistanceKmOverride?: number,
): Promise<SafeRoutesResponse> {
  const key = cacheKey(origin, destination);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('[safeRoutes] 📋 Cache hit');
    return cached.data;
  }

  // Use the DB-driven override if provided, otherwise fall back to hardcoded tier lookup
  const maxDistanceKm = maxDistanceKmOverride ?? getMaxDistanceKmForTier(subscriptionTier);
  const url =
    `${BACKEND_BASE}/api/safe-routes?` +
    `origin_lat=${origin.latitude}&origin_lng=${origin.longitude}` +
    `&dest_lat=${destination.latitude}&dest_lng=${destination.longitude}` +
    `&max_distance=${maxDistanceKm}`;

  console.log(`[safeRoutes] 🔍 Fetching safe routes from ${BACKEND_BASE}...`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000); // 60s timeout

  try {
    const resp = await fetch(url, { signal: controller.signal });
    console.log(`[safeRoutes] ✅ Got response: ${resp.status} ${resp.statusText}`);
    clearTimeout(timer);

    const raw: RawResponse = await resp.json();
    console.log(`[safeRoutes] ✅ Parsed JSON - routes: ${raw.routes?.length || 0}`);

    if (!resp.ok) {
      // Check for subscription limit error (403)
      if (resp.status === 403) {
        const limitInfo = parseLimitResponse(raw as any);
        if (limitInfo) {
          emitLimitReached(limitInfo);
          throw new LimitError(limitInfo);
        }
      }

      // Collect all extra fields from the backend into a details object
      const details: Record<string, unknown> = {};
      if (raw.detail) details.detail = raw.detail;
      if (raw.estimatedDataPoints) details.estimatedDataPoints = raw.estimatedDataPoints;
      if (raw.areaKm2) details.areaKm2 = raw.areaKm2;
      if (raw.maxDistanceKm) details.maxDistanceKm = raw.maxDistanceKm;
      if (raw.actualDistanceKm) details.actualDistanceKm = raw.actualDistanceKm;
      if (raw.graphNodes) details.graphNodes = raw.graphNodes;
      if (raw.graphEdges) details.graphEdges = raw.graphEdges;
      if (raw.roadCount != null) details.roadCount = raw.roadCount;
      if (raw.which) details.which = raw.which;

      if (raw.error === 'DESTINATION_OUT_OF_RANGE') {
        throw new AppError(
          'DESTINATION_OUT_OF_RANGE',
          raw.message || 'Destination is too far away. Maximum walking distance is 10 km.',
          undefined,
          details,
        );
      }
      if (raw.error === 'NO_ROUTE_FOUND') {
        throw new AppError(
          'NO_ROUTE_FOUND',
          raw.message || 'No walking route found between these points.',
          undefined,
          details,
        );
      }
      if (raw.error === 'NO_NEARBY_ROAD') {
        throw new AppError(
          'NO_NEARBY_ROAD',
          raw.message || 'No walkable road found near one of your locations.',
          undefined,
          details,
        );
      }
      throw new AppError(
        raw.error || 'safe_routes_error',
        raw.message || `Server returned ${resp.status}`,
        undefined,
        details,
      );
    }

    if (raw.status !== 'OK' || !raw.routes || raw.routes.length === 0) {
      throw new AppError(
        'safe_routes_no_results',
        raw.message || 'No safe routes found between these points.',
      );
    }

    // Map raw response into our typed SafeRoute objects
    const routes: SafeRoute[] = raw.routes.map((r, idx) => {
      const encoded = r.overview_polyline?.points ?? '';
      const path = decodePolyline(encoded);
      const leg = r.legs?.[0];

      // Map raw segments to RouteSegment type
      const safetySegments: RouteSegment[] = (r.segments || []).map((seg) => ({
        startCoord: { latitude: seg.start.lat, longitude: seg.start.lng },
        endCoord: { latitude: seg.end.lat, longitude: seg.end.lng },
        midpointCoord: {
          latitude: (seg.start.lat + seg.end.lat) / 2,
          longitude: (seg.start.lng + seg.end.lng) / 2,
        },
        distanceMeters: seg.distance ?? 0,
        lightingScore: (seg.lightScore ?? (r.safety?.breakdown?.lighting ?? 0) / 100),
        crimeScore: (seg.crimeScore ?? (r.safety?.breakdown?.crime ?? 0) / 100),
        activityScore: (r.safety?.breakdown?.openPlaces ?? 0) / 100,
        combinedScore: seg.safetyScore,
        color: seg.color,
      }));

      // Map enriched segments for the chart
      const enrichedSegments: EnrichedSegment[] = (r.segments || []).map((seg) => ({
        startCoord: { latitude: seg.start.lat, longitude: seg.start.lng },
        endCoord: { latitude: seg.end.lat, longitude: seg.end.lng },
        midpointCoord: {
          latitude: (seg.start.lat + seg.end.lat) / 2,
          longitude: (seg.start.lng + seg.end.lng) / 2,
        },
        safetyScore: seg.safetyScore,
        color: seg.color,
        highway: seg.highway,
        roadName: seg.roadName ?? '',
        isDeadEnd: seg.isDeadEnd ?? false,
        hasSidewalk: seg.hasSidewalk ?? false,
        surfaceType: seg.surfaceType ?? 'paved',
        lightScore: seg.lightScore ?? 0,
        crimeScore: seg.crimeScore ?? 0,
        cctvScore: seg.cctvScore ?? 0,
        placeScore: seg.placeScore ?? 0,
        trafficScore: seg.trafficScore ?? 0,
        distance: seg.distance ?? 0,
      }));

      return {
        id: `safe-route-${idx}`,
        routeIndex: r.routeIndex,
        isSafest: r.isSafest,
        distanceMeters: leg?.distance?.value ?? 0,
        durationSeconds: leg?.duration?.value ?? 0,
        encodedPolyline: encoded,
        path,
        summary: r.summary,
        steps: [],
        segments: safetySegments,
        safetySegments,
        enrichedSegments,
        safety: r.safety,
        routeStats: r.routeStats,
        routePOIs: r.routePOIs,
      };
    });

    const result: SafeRoutesResponse = {
      status: 'OK',
      routes,
      meta: raw.meta!,
    };

    cache.set(key, { data: result, timestamp: Date.now() });
    console.log(
      `[safeRoutes] ✅ ${routes.length} routes, safest: ${routes[0]?.safety?.score}/100 "${routes[0]?.safety?.label}"`,
    );
    return result;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof AppError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new AppError('safe_routes_timeout', 'Safe routes request timed out. Please try again.');
    }
    throw new AppError('safe_routes_error', 'Failed to fetch safe routes', err);
  }
}
