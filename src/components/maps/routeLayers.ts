/**
 * Pure, renderer-agnostic route layer builder.
 *
 * Turns one selected route's data into a JSON layer spec (data, not code) that
 * both the Leaflet (web) and MapLibre (native) renderers consume, so the two
 * cannot diverge. No React, no map SDK imports, no mutation of inputs.
 */

// ── Public types ─────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

export type LitEstimate = 'lit' | 'unlit' | 'estimated_lit' | 'estimated_unlit';

export interface LayerSegment {
  start: LatLng;
  end: LatLng;
  /** 0..1, higher = riskier. Authoritative when finite. */
  risk?: number;
  /** Legacy 0..1 field, higher = safer. Used as 1 - safetyScore when risk is missing. */
  safetyScore?: number;
  /** 0..1 evidence strength. Below 0.4 the line is dashed. */
  certainty?: number;
  litEstimate?: LitEstimate;
  /** Accepted for pass-through compatibility; not used for colour (risk is authoritative). */
  lightScore?: number;
}

export interface WorstStretchInput {
  start: LatLng;
  end: LatLng;
  lengthM: number;
  cause: string | null;
}

export interface CrimeInput extends LatLng {
  severity?: number;
}

export interface RouteLayerInput {
  segments?: LayerSegment[];
  worstStretch?: WorstStretchInput | null;
  crimes?: CrimeInput[];
  lights?: LatLng[];
  cctv?: LatLng[];
  places?: LatLng[];
}

export type HighlightCategory = 'crime' | 'light' | 'cctv' | 'shop';

export interface RouteLayerOptions {
  zoom: number;
  highlightCategory?: HighlightCategory | null;
  /** Lights are drawn as points from this zoom up (default 17). */
  showLightsAtZoom?: number;
  /** Grid cell size for crime clustering in metres (default 120). */
  clusterCellMetres?: number;
}

export interface LineLayer {
  coords: Array<[number, number]>;
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
    dashedLabel: string;
  };
}

// ── Colour ramp ──────────────────────────────────────────────────────────────

/**
 * Six-step sequential ramp, index 0 = lowest risk (calm pale teal) to index 5 =
 * highest risk (espresso brown). Relative luminance strictly decreases with
 * risk, and the hue path runs teal -> ochre -> burnt orange -> brown, so it
 * stays readable for deuteranopia (see routeLayers.test.ts for the checks).
 */
export const RISK_STEPS = 6;
export const RISK_RAMP: readonly string[] = [
  '#B9E3D9',
  '#6FBFB2',
  '#C9A24B',
  '#B5621E',
  '#7E2E12',
  '#3D1206',
];

/** Neutral grey for a non-finite risk value. Deliberately off-ramp. */
export const UNKNOWN_RISK_COLOR = '#8A8F98';

const DASHED_CERTAINTY_BELOW = 0.4;
const WORST_STRETCH_MIN_M = 50;
const MAX_POINTS = 150;
const DEFAULT_SHOW_LIGHTS_ZOOM = 17;
const DEFAULT_CLUSTER_CELL_M = 120;
const METRES_PER_DEG_LAT = 111320;
/** Segment ends closer than this (degrees, ~0.1 m) count as the same point. */
const JOIN_EPSILON_DEG = 1e-6;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function riskBucket(risk: number): number {
  return Math.min(RISK_STEPS - 1, Math.floor(clamp01(risk) * RISK_STEPS));
}

export function riskToColor(risk: number): string {
  if (!isFiniteNumber(risk)) return UNKNOWN_RISK_COLOR;
  return RISK_RAMP[riskBucket(risk)];
}

// ── Validation helpers ───────────────────────────────────────────────────────

const isValidCoord = (p: unknown): p is LatLng => {
  if (!p || typeof p !== 'object') return false;
  const { lat, lng } = p as LatLng;
  return isFiniteNumber(lat) && isFiniteNumber(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
};

const sameJoin = (a: LatLng, b: LatLng) =>
  Math.abs(a.lat - b.lat) < JOIN_EPSILON_DEG && Math.abs(a.lng - b.lng) < JOIN_EPSILON_DEG;

/** Risk from `risk`, else 1 - `safetyScore`, else null (segment is skipped). */
function segmentRisk(seg: LayerSegment): number | null {
  if (isFiniteNumber(seg.risk)) return clamp01(seg.risk);
  if (isFiniteNumber(seg.safetyScore)) return clamp01(1 - clamp01(seg.safetyScore));
  return null;
}

function isDashed(seg: LayerSegment): boolean {
  if (typeof seg.litEstimate === 'string' && seg.litEstimate.startsWith('estimated')) return true;
  return isFiniteNumber(seg.certainty) && seg.certainty < DASHED_CERTAINTY_BELOW;
}

// ── Builders ─────────────────────────────────────────────────────────────────

interface Run {
  coords: Array<[number, number]>;
  end: LatLng;
  bucket: number;
  dashed: boolean;
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
  }));
}

function buildCallouts(stretch: WorstStretchInput | null | undefined): Callout[] {
  if (!stretch || !isValidCoord(stretch.start) || !isValidCoord(stretch.end)) return [];
  if (!isFiniteNumber(stretch.lengthM) || stretch.lengthM < WORST_STRETCH_MIN_M) return [];

  const label = stretch.cause === 'lighting' ? 'Unlit stretch' : 'High-risk stretch';
  return [
    {
      lat: (stretch.start.lat + stretch.end.lat) / 2,
      lng: (stretch.start.lng + stretch.end.lng) / 2,
      text: `${label} · ${Math.round(stretch.lengthM)} m`,
      kind: 'worst-stretch',
    },
  ];
}

/** Grid-clusters crimes so individual incidents are never drawn. */
function buildCrimeClusters(crimes: CrimeInput[] | undefined, cellM: number): CrimeCluster[] {
  const valid = (crimes ?? []).filter(isValidCoord) as CrimeInput[];
  if (valid.length === 0) return [];

  const meanLat = valid.reduce((sum, c) => sum + c.lat, 0) / valid.length;
  const metresPerDegLng = METRES_PER_DEG_LAT * Math.cos((meanLat * Math.PI) / 180);

  const cells = new Map<
    string,
    { latSum: number; lngSum: number; count: number; maxSeverity: number }
  >();
  for (const crime of valid) {
    const x = crime.lng * metresPerDegLng;
    const y = crime.lat * METRES_PER_DEG_LAT;
    const key = `${Math.floor(x / cellM)}:${Math.floor(y / cellM)}`;
    const severity = isFiniteNumber(crime.severity) ? Math.max(0, crime.severity) : 1;

    const cell = cells.get(key);
    if (cell) {
      cell.latSum += crime.lat;
      cell.lngSum += crime.lng;
      cell.count += 1;
      cell.maxSeverity = Math.max(cell.maxSeverity, severity);
    } else {
      cells.set(key, { latSum: crime.lat, lngSum: crime.lng, count: 1, maxSeverity: severity });
    }
  }

  return Array.from(cells.values())
    .map((cell) => ({
      lat: cell.latSum / cell.count,
      lng: cell.lngSum / cell.count,
      count: cell.count,
      maxSeverity: cell.maxSeverity,
    }))
    .sort((a, b) => a.lat - b.lat || a.lng - b.lng);
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

function buildPoints(input: RouteLayerInput, options: RouteLayerOptions): PointLayer[] {
  const highlight = options.highlightCategory ?? null;
  const showLightsAt = isFiniteNumber(options.showLightsAtZoom)
    ? options.showLightsAtZoom
    : DEFAULT_SHOW_LIGHTS_ZOOM;
  const lightsVisible = highlight === 'light' || (isFiniteNumber(options.zoom) && options.zoom >= showLightsAt);

  const candidates: PointLayer[] = [];
  const add = (kind: PointLayer['kind'], list: LatLng[] | undefined) => {
    (list ?? []).forEach((p) => {
      if (isValidCoord(p)) candidates.push({ kind, lat: p.lat, lng: p.lng });
    });
  };

  if (lightsVisible) add('light', input.lights);
  if (highlight === 'cctv') add('cctv', input.cctv);
  if (highlight === 'shop') add('shop', input.places);

  return evenSample(candidates, MAX_POINTS);
}

const LEGEND_DASHED_LABEL = 'Dashed: estimated lighting or low certainty';

/**
 * Builds the renderer-agnostic layer spec for one selected route.
 * Never throws on missing or malformed data; invalid entries are skipped.
 */
export function buildRouteLayers(
  input: RouteLayerInput | null | undefined,
  options: RouteLayerOptions,
): RouteLayerSpec {
  const data: RouteLayerInput = input ?? {};
  // A missing zoom is NaN, which hides zoom-gated points.
  const opts: RouteLayerOptions = options ?? { zoom: Number.NaN };
  const cellM =
    isFiniteNumber(opts.clusterCellMetres) && opts.clusterCellMetres > 0
      ? opts.clusterCellMetres
      : DEFAULT_CLUSTER_CELL_M;

  return {
    lines: buildLines(Array.isArray(data.segments) ? data.segments : []),
    callouts: buildCallouts(data.worstStretch),
    crimeClusters: buildCrimeClusters(data.crimes, cellM),
    points: buildPoints(data, opts),
    legend: {
      ramp: RISK_RAMP.map((color, i) => ({
        from: i / RISK_STEPS,
        to: (i + 1) / RISK_STEPS,
        color,
      })),
      dashedLabel: LEGEND_DASHED_LABEL,
    },
  };
}
