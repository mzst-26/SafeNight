/**
 * Pure, renderer-agnostic route layer builder.
 *
 * Turns one selected route's data into a JSON layer spec (data, not code) that
 * both the Leaflet (web) and MapLibre (native) renderers consume, so the two
 * cannot diverge. No React, no map SDK imports, no mutation of inputs.
 */

// ── Public types ─────────────────────────────────────────────────────────────

/** A WGS84 point. Named GeoPoint so it cannot be confused with src/types/geo.ts LatLng ({latitude, longitude}). */
export interface GeoPoint {
  lat: number;
  lng: number;
}

export type LitEstimate = 'lit' | 'unlit' | 'estimated_lit' | 'estimated_unlit';

export interface LayerSegment {
  start: GeoPoint;
  end: GeoPoint;
  /** 0..1, higher = riskier. Authoritative when finite. */
  risk?: number;
  /** Legacy 0..1 field, higher = safer. Used as 1 - safetyScore when risk is missing. */
  safetyScore?: number;
  /** 0..1 evidence strength. Below 0.4 the line is dashed. */
  certainty?: number;
  litEstimate?: LitEstimate;
  /** Accepted for pass-through compatibility; not used for colour (risk is authoritative). */
  lightScore?: number;
  /** Road name for the label drawn along the line. Empty or absent means no label. */
  roadName?: string;
}

export interface WorstStretchInput {
  start: GeoPoint;
  end: GeoPoint;
  lengthM: number;
  cause: string | null;
}

export interface CrimeInput extends GeoPoint {
  severity?: number;
  /**
   * Incidents represented by this point (v2 server-side clusters). Defaults to 1.
   * Non-finite or non-positive values count as 1; fractions are floored.
   */
  count?: number;
}

export interface RouteLayerInput {
  segments?: LayerSegment[];
  worstStretch?: WorstStretchInput | null;
  crimes?: CrimeInput[];
  /**
   * Street lights, always included as candidates (unless a different category is highlighted).
   * The renderer hides them below LIGHTS_MIN_ZOOM, so the spec does not change as the user zooms.
   */
  lights?: GeoPoint[];
  cctv?: GeoPoint[];
  places?: GeoPoint[];
  /** Route data quality from the server (v2). Absent on v1 routes. */
  dataQuality?: RouteLayerDataQuality;
}

/** Data quality flags for a route. Mirrors RouteDataQuality in src/services/safeRoutes.ts. */
export interface RouteLayerDataQuality {
  crime?: 'ok' | 'unavailable';
  lighting?: 'verified' | 'mixed' | 'estimated';
}

export type HighlightCategory = 'crime' | 'light' | 'cctv' | 'shop';

export interface RouteLayerOptions {
  /**
   * Accepted for source compatibility and not used. Zoom gating moved to the renderers
   * (see LIGHTS_MIN_ZOOM), so buildRouteLayers returns the same spec at every zoom.
   */
  zoom?: number;
  /**
   * null (nothing highlighted) shows the default layers: lights and crime clusters.
   * A category shows only that category: 'light', 'cctv' or 'shop' points, or 'crime' clusters.
   */
  highlightCategory?: HighlightCategory | null;
  /**
   * Grid cell size for crime clustering in metres (default 120). Must be finite
   * and > 0; zero, negative, NaN or infinite values fall back to the default.
   */
  clusterCellMetres?: number;
}

export interface LineLayer {
  coords: Array<[number, number]>;
  /** Road name for the label along this line, when the run is one named road. */
  roadName?: string;
  /** Mean risk of the merged segments. */
  risk: number;
  color: string;
  dashed: boolean;
}

export interface Callout {
  lat: number;
  lng: number;
  text: string;
  kind: 'worst-stretch';
}

export interface CrimeCluster {
  lat: number;
  lng: number;
  count: number;
  maxSeverity: number;
}

export interface PointLayer {
  kind: 'light' | 'cctv' | 'shop';
  lat: number;
  lng: number;
}

export interface RouteLayerSpec {
  lines: LineLayer[];
  callouts: Callout[];
  crimeClusters: CrimeCluster[];
  points: PointLayer[];
  legend: {
    ramp: Array<{ from: number; to: number; color: string }>;
    /** Label for the dashed swatch. */
    dashedLabel: string;
    /** Short data-gap notes to show under the legend, e.g. 'Crime data unavailable'. Empty when there are none. */
    notes?: string[];
  };
}

// ── Colour ramp ──────────────────────────────────────────────────────────────

/**
 * Six-step sequential ramp, index 0 = lowest risk (bright teal) to index 5 =
 * highest risk (deep maroon), one hue path teal, green, olive, brown, red,
 * maroon. Found by a numeric search over OKLCH lightness steps and pinned by
 * routeLayers.test.ts:
 * - every step is at least 3:1 against the #F2EFE9 basemap and against white;
 * - relative luminance strictly decreases with risk, so adjacent steps stay
 *   apart for colour-blind users (separation comes from lightness, not hue);
 * - the minimum adjacent dE76 is 13.3 (protan), 10.9 (deutan), 10.2 (tritan,
 *   Machado 2009 severity 1.0) and 19.5 (normal), against a required 10.
 * The backend formatter (backend/src/safety/routes/safeRoutesResponseFormatter.js)
 * carries a copy of these values and must be kept in sync.
 * Frozen: the palette is shared module state and must not be mutated.
 */
export const RISK_STEPS = 6;
export const RISK_RAMP: readonly string[] = Object.freeze([
  '#26998E',
  '#617933',
  '#715200',
  '#693000',
  '#55120B',
  '#370412',
]);

/** Neutral grey for a non-finite risk value. Deliberately off-ramp. */
export const UNKNOWN_RISK_COLOR = '#8A8F98';

/**
 * Severity used for a crime that has no finite severity. Mirrors the backend
 * fallback `CRIME.SEVERITY_FALLBACK` (0.4, backend/src/safety/scoring/config.js),
 * which backend/src/safety/services/crimeSeverity.js applies to unknown
 * categories. Keep the two values in sync.
 */
export const DEFAULT_CRIME_SEVERITY = 0.4;

const DASHED_CERTAINTY_BELOW = 0.4;
const WORST_STRETCH_MIN_M = 50;
/** Cap per point kind (lights, cctv, shops), applied after highlight filtering. */
const MAX_POINTS_PER_KIND = 150;
/**
 * Renderers draw light points only from this zoom up, unless 'light' is highlighted.
 * buildRouteLayers always includes lights, so the zoom rule lives here, not in the spec.
 */
export const LIGHTS_MIN_ZOOM = 17;
const DEFAULT_CLUSTER_CELL_M = 120;
/**
 * Most crime clusters the map draws for one route. Clusters beyond this are dropped, lowest
 * count times max severity first, so dense areas do not bury the map in markers.
 */
export const CRIME_CLUSTER_MAP_CAP = 12;
const METRES_PER_DEG_LAT = 111320;
const DEG_TO_RAD = Math.PI / 180;
const MAX_LAT_DEG = 90;
const MAX_LNG_DEG = 180;
/** Segment ends closer than this (degrees, ~0.1 m) count as the same point. */
const JOIN_EPSILON_DEG = 1e-6;
/** The only lit-estimate values that render dashed, regardless of certainty. */
const ESTIMATED_LIGHTING: ReadonlySet<LitEstimate | undefined> = new Set<LitEstimate | undefined>([
  'estimated_lit',
  'estimated_unlit',
]);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Maps a finite risk to its ramp index in 0..RISK_STEPS-1 (risk is clamped to 0..1).
 * Throws a TypeError for non-finite input: a non-finite value has no bucket.
 * Callers holding untrusted values should use riskToColor, which returns UNKNOWN_RISK_COLOR.
 */
export function riskBucket(risk: number): number {
  if (!isFiniteNumber(risk)) {
    throw new TypeError(`riskBucket requires a finite number, got ${String(risk)}`);
  }
  return Math.min(RISK_STEPS - 1, Math.floor(clamp01(risk) * RISK_STEPS));
}

export function riskToColor(risk: number): string {
  if (!isFiniteNumber(risk)) return UNKNOWN_RISK_COLOR;
  return RISK_RAMP[riskBucket(risk)];
}

// ── Validation helpers ───────────────────────────────────────────────────────

/** True for a non-null object whose lat/lng are finite and within WGS84 bounds (poles and antimeridian inclusive). */
const isValidCoord = <T extends Partial<GeoPoint>>(p: T | null | undefined): p is T & GeoPoint => {
  if (!p || typeof p !== 'object') return false;
  const { lat, lng } = p;
  return (
    isFiniteNumber(lat) &&
    isFiniteNumber(lng) &&
    Math.abs(lat) <= MAX_LAT_DEG &&
    Math.abs(lng) <= MAX_LNG_DEG
  );
};

const sameJoin = (a: GeoPoint, b: GeoPoint) =>
  Math.abs(a.lat - b.lat) < JOIN_EPSILON_DEG && Math.abs(a.lng - b.lng) < JOIN_EPSILON_DEG;

/** Risk from `risk`, else 1 - `safetyScore`, else null (segment is skipped). */
function segmentRisk(seg: LayerSegment): number | null {
  if (isFiniteNumber(seg.risk)) return clamp01(seg.risk);
  if (isFiniteNumber(seg.safetyScore)) return clamp01(1 - clamp01(seg.safetyScore));
  return null;
}

function isDashed(seg: LayerSegment): boolean {
  if (ESTIMATED_LIGHTING.has(seg.litEstimate)) return true;
  return isFiniteNumber(seg.certainty) && seg.certainty < DASHED_CERTAINTY_BELOW;
}

// ── Builders ─────────────────────────────────────────────────────────────────

interface Run {
  coords: Array<[number, number]>;
  end: GeoPoint;
  bucket: number;
  dashed: boolean;
  roadName: string;
  riskSum: number;
  count: number;
}

/** Merges consecutive contiguous segments that share a colour bucket and dash flag. */
function buildLines(segments: LayerSegment[]): LineLayer[] {
  const runs: Run[] = [];
  let current: Run | null = null;

  for (const seg of segments) {
    if (!isValidCoord(seg.start) || !isValidCoord(seg.end)) continue;
    const risk = segmentRisk(seg);
    if (risk === null) continue;

    const bucket = riskBucket(risk);
    const dashed = isDashed(seg);
    const continues =
      current !== null &&
      current.bucket === bucket &&
      current.dashed === dashed &&
      current.roadName === (seg.roadName ?? '') &&
      sameJoin(current.end, seg.start);

    if (current && continues) {
      current.coords.push([seg.end.lat, seg.end.lng]);
      current.end = seg.end;
      current.riskSum += risk;
      current.count += 1;
    } else {
      current = {
        coords: [
          [seg.start.lat, seg.start.lng],
          [seg.end.lat, seg.end.lng],
        ],
        end: seg.end,
        bucket,
        dashed,
        roadName: seg.roadName ?? '',
        riskSum: risk,
        count: 1,
      };
      runs.push(current);
    }
  }

  return runs.map((run) => ({
    coords: run.coords,
    risk: run.riskSum / run.count,
    color: RISK_RAMP[run.bucket],
    dashed: run.dashed,
    roadName: run.roadName || undefined,
  }));
}

/**
 * Point on the drawn polyline halfway, by distance along the path, between the vertices nearest
 * the stretch's start and end. Null when there is no path with length to measure.
 */
function pointHalfwayAlongPath(
  lines: LineLayer[],
  start: GeoPoint,
  end: GeoPoint,
): GeoPoint | null {
  const pts: Array<[number, number]> = lines.flatMap((line) => line.coords);
  if (pts.length < 2) return null;

  const meanLat = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
  const metresPerDegLng = METRES_PER_DEG_LAT * Math.cos(meanLat * DEG_TO_RAD);
  const toXY = (lat: number, lng: number): [number, number] => [
    lng * metresPerDegLng,
    lat * METRES_PER_DEG_LAT,
  ];

  // Cumulative distance at each vertex, in local planar metres.
  const xy = pts.map(([lat, lng]) => toXY(lat, lng));
  const cum: number[] = [0];
  for (let i = 1; i < xy.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  if (total === 0) return { lat: pts[0][0], lng: pts[0][1] };

  // Distance along the path of the closest point on the polyline to a given point.
  const alongPath = (p: GeoPoint): number => {
    const [px, py] = toXY(p.lat, p.lng);
    let bestDist = Infinity;
    let bestS = 0;
    for (let i = 0; i < xy.length - 1; i += 1) {
      const [ax, ay] = xy[i];
      const dx = xy[i + 1][0] - ax;
      const dy = xy[i + 1][1] - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / len2);
      const qx = ax + t * dx;
      const qy = ay + t * dy;
      const dist = Math.hypot(px - qx, py - qy);
      if (dist < bestDist) {
        bestDist = dist;
        bestS = cum[i] + t * (cum[i + 1] - cum[i]);
      }
    }
    return bestS;
  };

  const target = (alongPath(start) + alongPath(end)) / 2;
  for (let i = 0; i < xy.length - 1; i += 1) {
    if (target <= cum[i + 1]) {
      const span = cum[i + 1] - cum[i];
      const t = span === 0 ? 0 : (target - cum[i]) / span;
      return {
        lat: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        lng: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
      };
    }
  }
  return { lat: pts[pts.length - 1][0], lng: pts[pts.length - 1][1] };
}

/**
 * The worst-stretch callout sits on the selected route's drawn path, halfway along it between
 * the stretch's ends. Without drawable lines it falls back to the chord midpoint.
 */
function buildCallouts(
  stretch: WorstStretchInput | null | undefined,
  lines: LineLayer[],
): Callout[] {
  if (!stretch || !isValidCoord(stretch.start) || !isValidCoord(stretch.end)) return [];
  if (!isFiniteNumber(stretch.lengthM) || stretch.lengthM < WORST_STRETCH_MIN_M) return [];

  const onPath = pointHalfwayAlongPath(lines, stretch.start, stretch.end);
  const label = stretch.cause === 'lighting' ? 'Unlit stretch' : 'High-risk stretch';
  return [
    {
      lat: onPath ? onPath.lat : (stretch.start.lat + stretch.end.lat) / 2,
      lng: onPath ? onPath.lng : (stretch.start.lng + stretch.end.lng) / 2,
      text: `${label} · ${Math.round(stretch.lengthM)} m`,
      kind: 'worst-stretch',
    },
  ];
}

/** Grid-clusters crimes so individual incidents are never drawn. */
function buildCrimeClusters(crimes: CrimeInput[] | undefined, cellM: number): CrimeCluster[] {
  const list: CrimeInput[] = crimes ?? [];
  const valid = list.filter(isValidCoord);
  if (valid.length === 0) return [];

  const meanLat = valid.reduce((sum, c) => sum + c.lat, 0) / valid.length;
  const metresPerDegLng = METRES_PER_DEG_LAT * Math.cos(meanLat * DEG_TO_RAD);

  const cells = new Map<
    string,
    { latSum: number; lngSum: number; count: number; maxSeverity: number }
  >();
  for (const crime of valid) {
    const x = crime.lng * metresPerDegLng;
    const y = crime.lat * METRES_PER_DEG_LAT;
    const key = `${Math.floor(x / cellM)}:${Math.floor(y / cellM)}`;
    const severity = isFiniteNumber(crime.severity)
      ? Math.max(0, crime.severity)
      : DEFAULT_CRIME_SEVERITY;
    const weight = isFiniteNumber(crime.count) && crime.count >= 1 ? Math.floor(crime.count) : 1;

    const cell = cells.get(key);
    if (cell) {
      cell.latSum += crime.lat * weight;
      cell.lngSum += crime.lng * weight;
      cell.count += weight;
      cell.maxSeverity = Math.max(cell.maxSeverity, severity);
    } else {
      cells.set(key, {
        latSum: crime.lat * weight,
        lngSum: crime.lng * weight,
        count: weight,
        maxSeverity: severity,
      });
    }
  }

  const clusters: CrimeCluster[] = Array.from(cells.values()).map((cell) => ({
    lat: cell.latSum / cell.count,
    lng: cell.lngSum / cell.count,
    count: cell.count,
    maxSeverity: cell.maxSeverity,
  }));

  // Keep the most important clusters (count times max severity, then the same tie-break as the
  // output order), then return the kept ones in output order.
  const byImportance = (a: CrimeCluster, b: CrimeCluster) =>
    b.count * b.maxSeverity - a.count * a.maxSeverity ||
    b.count - a.count ||
    a.lat - b.lat ||
    a.lng - b.lng;
  return clusters
    .sort(byImportance)
    .slice(0, CRIME_CLUSTER_MAP_CAP)
    .sort((a, b) => b.count - a.count || a.lat - b.lat || a.lng - b.lng);
}

/** Evenly samples `items` down to `cap` entries (order preserved). */
function evenSample<T>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items;
  const out: T[] = [];
  for (let i = 0; i < cap; i += 1) {
    out.push(items[Math.floor((i * items.length) / cap)]);
  }
  return out;
}

const HIGHLIGHT_CATEGORIES: ReadonlySet<string> = new Set<HighlightCategory>([
  'crime',
  'light',
  'cctv',
  'shop',
]);

/** Unknown or missing highlights mean "nothing highlighted" (the default layers). */
function normaliseHighlight(value: unknown): HighlightCategory | null {
  return typeof value === 'string' && HIGHLIGHT_CATEGORIES.has(value) ? (value as HighlightCategory) : null;
}

/**
 * Point kinds shown for a highlight. Nothing highlighted shows lights only (cctv and shops
 * are opt-in). A highlighted point category shows only that kind. 'crime' shows no points.
 */
function pointSourcesFor(
  input: RouteLayerInput,
  highlight: HighlightCategory | null,
): Array<[PointLayer['kind'], GeoPoint[] | undefined]> {
  switch (highlight) {
    case null:
    case 'light':
      return [['light', input.lights]];
    case 'cctv':
      return [['cctv', input.cctv]];
    case 'shop':
      return [['shop', input.places]];
    default:
      return [];
  }
}

/**
 * Valid points of one kind, evenly capped. Highlight filtering happens before this, so a
 * highlighted kind always gets its own cap instead of competing with other kinds.
 */
function buildPointsOfKind(kind: PointLayer['kind'], list: GeoPoint[] | undefined): PointLayer[] {
  const valid: PointLayer[] = [];
  (Array.isArray(list) ? list : []).forEach((p) => {
    if (isValidCoord(p)) valid.push({ kind, lat: p.lat, lng: p.lng });
  });
  return evenSample(valid, MAX_POINTS_PER_KIND);
}

const LEGEND_DASHED_LABEL = 'Estimated lighting or low certainty';
const CRIME_UNAVAILABLE_NOTE = 'Crime data unavailable';

function buildLegendNotes(dataQuality: RouteLayerInput['dataQuality']): string[] {
  const notes: string[] = [];
  if (dataQuality && typeof dataQuality === 'object' && dataQuality.crime === 'unavailable') {
    notes.push(CRIME_UNAVAILABLE_NOTE);
  }
  return notes;
}

/**
 * Builds the renderer-agnostic layer spec for one selected route.
 * Never throws on missing or malformed data; invalid entries are skipped.
 *
 * The spec does not depend on zoom. Light points are always candidates; renderers hide them
 * below LIGHTS_MIN_ZOOM unless 'light' is highlighted. Crime clusters appear only when nothing
 * or 'crime' is highlighted.
 */
export function buildRouteLayers(
  input: RouteLayerInput | null | undefined,
  options: RouteLayerOptions | null | undefined,
): RouteLayerSpec {
  const data: RouteLayerInput = input ?? {};
  const opts: RouteLayerOptions = options ?? {};
  const highlight = normaliseHighlight(opts.highlightCategory);
  const cellM =
    isFiniteNumber(opts.clusterCellMetres) && opts.clusterCellMetres > 0
      ? opts.clusterCellMetres
      : DEFAULT_CLUSTER_CELL_M;
  const showCrime = highlight === null || highlight === 'crime';

  const lines = buildLines(Array.isArray(data.segments) ? data.segments : []);
  return {
    lines,
    callouts: buildCallouts(data.worstStretch, lines),
    crimeClusters: showCrime ? buildCrimeClusters(data.crimes, cellM) : [],
    points: pointSourcesFor(data, highlight).flatMap(([kind, list]) => buildPointsOfKind(kind, list)),
    legend: {
      ramp: RISK_RAMP.map((color, i) => ({
        from: i / RISK_STEPS,
        to: (i + 1) / RISK_STEPS,
        color,
      })),
      dashedLabel: LEGEND_DASHED_LABEL,
      notes: buildLegendNotes(data.dataQuality),
    },
  };
}
