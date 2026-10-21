import type { CandidatePoint } from '@/src/services/agentClient';
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
