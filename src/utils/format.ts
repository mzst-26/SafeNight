/**
 * format.ts — Shared formatting helpers used across the app.
 */

/** Format metres to a human-readable UK imperial distance string (always miles). */
export const formatDistance = (meters: number): string => {
  const miles = meters / 1609.344;
  if (miles >= 10) return `${Math.round(miles)} mi`;
  return `${miles.toFixed(1)} mi`;
};

/** Format metres to a UK imperial string for navigation turn distances.
 *  < 0.2 mi → yards, otherwise miles. */
export const formatNavDistance = (meters: number): string => {
  const miles = meters / 1609.344;
  if (miles >= 0.2) {
    if (miles >= 10) return `${Math.round(miles)} mi`;
    return `${miles.toFixed(1)} mi`;
  }
  const yards = Math.round(meters * 1.09361);
  // Round to nearest 10 for cleaner readout
  return `${Math.round(yards / 10) * 10} yds`;
};

/** Format seconds to a human-readable duration string. */
export const formatDuration = (seconds: number): string => {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  return `${Math.max(1, Math.round(seconds / 60))} min`;
};

/** Strip HTML tags from instruction strings. */
export const stripHtml = (html: string): string =>
  html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

/** Map Google maneuver strings to Ionicons names. */
export const maneuverIcon = (maneuver?: string): string => {
  switch (maneuver) {
    case 'turn-left':
      return 'arrow-back';
    case 'turn-right':
      return 'arrow-forward';
    case 'turn-slight-left':
      return 'arrow-back';
    case 'turn-slight-right':
      return 'arrow-forward';
    case 'turn-sharp-left':
      return 'return-down-back';
    case 'turn-sharp-right':
      return 'return-down-forward';
    case 'uturn-left':
    case 'uturn-right':
      return 'refresh';
    case 'roundabout-left':
    case 'roundabout-right':
      return 'sync';
    default:
      return 'arrow-up';
  }
};

/** Interpolate between two hex-packed colours (0xRRGGBB). Returns CSS hex. */
export const lerpColor = (a: number, b: number, t: number): string => {
  const clamp = Math.max(0, Math.min(1, t));
  const rA = (a >> 16) & 0xff,
    gA = (a >> 8) & 0xff,
    bA = a & 0xff;
  const rB = (b >> 16) & 0xff,
    gB = (b >> 8) & 0xff,
    bB = b & 0xff;
  const r = Math.round(rA + (rB - rA) * clamp);
  const g = Math.round(gA + (gB - gA) * clamp);
  const bl = Math.round(bA + (bB - bA) * clamp);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
};
