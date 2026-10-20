/**
 * Pure helpers for the score pills drawn on the map, one per route.
 *
 * A badge sits at the distance-weighted midpoint of a route's overview polyline, so the pill
 * lands mid-route rather than on a vertex. No React, no I/O, and inputs are not mutated.
 */
import type { RouteBadge } from '@/src/components/maps/RouteMap.types';
import type { LatLng } from '@/src/types/geo';

export interface BadgeRouteInput {
  id: string;
  /** Decoded overview polyline, in order. */
  path: ReadonlyArray<LatLng>;
}

export interface BadgeScoreInput {
  score: number;
}

const EARTH_RADIUS_M = 6371008.8;
const DEG_TO_RAD = Math.PI / 180;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isValidLatLng = (p: LatLng | null | undefined): p is LatLng =>
  !!p &&
  typeof p === 'object' &&
  isFiniteNumber(p.latitude) &&
  isFiniteNumber(p.longitude) &&
  Math.abs(p.latitude) <= 90 &&
  Math.abs(p.longitude) <= 180;

/** Great-circle distance in metres between two WGS84 points (haversine). */
function haversineM(a: LatLng, b: LatLng): number {
  const dLat = (b.latitude - a.latitude) * DEG_TO_RAD;
  const dLng = (b.longitude - a.longitude) * DEG_TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * DEG_TO_RAD) * Math.cos(b.latitude * DEG_TO_RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The point halfway along a polyline by distance. Invalid points are skipped. A zero-length
 * path returns its first valid point. Returns null when no point is valid.
 */
export function routeMidpointByDistance(path: ReadonlyArray<LatLng>): { lat: number; lng: number } | null {
  const pts = path.filter(isValidLatLng);
  if (pts.length === 0) return null;

  let total = 0;
  for (let i = 1; i < pts.length; i += 1) total += haversineM(pts[i - 1], pts[i]);
  if (total === 0) return { lat: pts[0].latitude, lng: pts[0].longitude };

  const half = total / 2;
  let walked = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const segment = haversineM(pts[i - 1], pts[i]);
    if (walked + segment >= half) {
      const t = segment === 0 ? 0 : (half - walked) / segment;
      return {
        lat: pts[i - 1].latitude + (pts[i].latitude - pts[i - 1].latitude) * t,
        lng: pts[i - 1].longitude + (pts[i].longitude - pts[i - 1].longitude) * t,
      };
    }
    walked += segment;
  }
  const last = pts[pts.length - 1];
  return { lat: last.latitude, lng: last.longitude };
}

/**
 * One badge per route that has a finite score and a usable path. The label is the score as a
 * string, and `selected` is true only for `selectedRouteId`.
 */
export function buildRouteBadges(
  routes: ReadonlyArray<BadgeRouteInput>,
  scores: Readonly<Record<string, BadgeScoreInput | undefined>>,
  selectedRouteId: string | null,
): RouteBadge[] {
  const badges: RouteBadge[] = [];
  for (const route of routes) {
    const score = scores[route.id]?.score;
    if (!isFiniteNumber(score)) continue;
    const mid = routeMidpointByDistance(route.path);
    if (mid === null) continue;
    badges.push({
      routeId: route.id,
      lat: mid.lat,
      lng: mid.lng,
      text: String(score),
      selected: route.id === selectedRouteId,
    });
  }
  return badges;
}
