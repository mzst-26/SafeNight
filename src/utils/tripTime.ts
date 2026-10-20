/**
 * tripTime.ts — pure helpers for the leave-at / arrive-by control.
 *
 * The user picks a London wall-clock HH:MM. We turn it into an ISO-8601 string with the
 * explicit Europe/London offset (the backend contract), DST-correct via Intl.
 */

export type TripTimeMode = 'now' | 'leave_at' | 'arrive_by';

export interface TripTimeState {
  mode: TripTimeMode;
  /** London wall-clock "HH:MM"; null for 'now'. */
  hhmm: string | null;
}

export interface TimeParams {
  leave_at?: string;
  arrive_by?: string;
}

export type TimelineLabel = 'daylight' | 'dusk' | 'dark_by_arrival' | 'dark_from_start';

export interface RouteTimeline {
  leaveAtIso: string;
  arriveAtIso: string;
  darknessAtStart?: boolean;
  darknessAtArrival?: boolean;
  label: TimelineLabel;
}

export const TIME_ZONE = 'Europe/London';
export const NOW_STATE: TripTimeState = { mode: 'now', hhmm: null };
export const BUCKET_MS = 15 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const DAY_MIN = 24 * 60;

// ── London zone arithmetic ───────────────────────────────────────────────────

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

let formatter: Intl.DateTimeFormat | null = null;

function londonParts(date: Date): Parts {
  formatter ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const out: Record<string, number> = {};
  for (const p of formatter.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year, mo: out.month, d: out.day, h: out.hour % 24, mi: out.minute, s: out.second };
}

/** Offset of London from UTC at `date`, in minutes (0 or 60). */
function londonOffsetMin(date: Date): number {
  const p = londonParts(date);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / MINUTE_MS);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO-8601 with the Europe/London offset, second precision. */
export function londonIso(date: Date): string {
  const p = londonParts(date);
  const off = londonOffsetMin(date);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return (
    `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** London "HH:MM" of an instant. */
function londonHhmm(date: Date): string {
  const p = londonParts(date);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** The instant at which London wall clock reads y-mo-d h:mi. */
function londonWallToInstant(y: number, mo: number, d: number, h: number, mi: number): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  let guess = naive - londonOffsetMin(new Date(naive)) * MINUTE_MS;
  guess = naive - londonOffsetMin(new Date(guess)) * MINUTE_MS;
  return new Date(guess);
}

function parseHhmm(hhmm: string): { h: number; mi: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}

// ── State -> instant -> params ───────────────────────────────────────────────

export interface ResolvedTripTime {
  mode: 'leave_at' | 'arrive_by';
  instant: Date;
  isTomorrow: boolean;
}

/** Resolve a chosen HH:MM against `now`; an earlier time rolls to tomorrow. Null for 'now'. */
export function resolveTripTime(state: TripTimeState, now: Date): ResolvedTripTime | null {
  if (state.mode === 'now' || !state.hhmm) return null;
  const t = parseHhmm(state.hhmm);
  if (!t) return null;
  const today = londonParts(now);
  let instant = londonWallToInstant(today.y, today.mo, today.d, t.h, t.mi);
  const nowMinute = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  let isTomorrow = false;
  if (instant.getTime() < nowMinute) {
    // Calendar-day arithmetic on the London date, then re-resolve so DST is applied to the new day.
    const next = new Date(Date.UTC(today.y, today.mo - 1, today.d + 1));
    instant = londonWallToInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), t.h, t.mi);
    isTomorrow = true;
  }
  return { mode: state.mode, instant, isTomorrow };
}

export function toTimeParams(state: TripTimeState, now: Date): TimeParams {
  const resolved = resolveTripTime(state, now);
  if (!resolved) return {};
  const iso = londonIso(resolved.instant);
  return resolved.mode === 'leave_at' ? { leave_at: iso } : { arrive_by: iso };
}

const ceilTo15 = (ms: number) => Math.ceil(ms / BUCKET_MS) * BUCKET_MS;

export function defaultTimeState(mode: TripTimeMode, now: Date): TripTimeState {
  if (mode === 'now') return NOW_STATE;
  const base = mode === 'arrive_by' ? now.getTime() + 30 * MINUTE_MS : now.getTime();
  // London offsets are whole hours, so UTC quarter-hours equal London quarter-hours.
  return { mode, hhmm: londonHhmm(new Date(ceilTo15(base))) };
}

export function stepHhmm(hhmm: string, deltaMin: number): string {
  const t = parseHhmm(hhmm) ?? { h: 0, mi: 0 };
  const total = (((t.h * 60 + t.mi + deltaMin) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function describeTripTime(state: TripTimeState, now: Date): string {
  const resolved = resolveTripTime(state, now);
  if (!resolved || !state.hhmm) return 'Leave now';
  const verb = resolved.mode === 'leave_at' ? 'Leave at' : 'Arrive by';
  return `${verb} ${state.hhmm}${resolved.isTomorrow ? ' · Tomorrow' : ''}`;
}

// ── Cache / URL helpers ──────────────────────────────────────────────────────

/** Cache-key fragment: mode + 15-minute bucket ('now' when no time is chosen). */
export function timeBucketKey(params: TimeParams | undefined): string {
  if (!params) return 'now';
  const mode = params.leave_at ? 'leave_at' : params.arrive_by ? 'arrive_by' : null;
  if (!mode) return 'now';
  const ms = Date.parse((params.leave_at ?? params.arrive_by) as string);
  if (!Number.isFinite(ms)) return 'now';
  return `${mode}:${Math.floor(ms / BUCKET_MS)}`;
}

export function appendTimeQuery(url: string, params: TimeParams | undefined): string {
  if (!params) return url;
  if (params.leave_at) return `${url}&leave_at=${encodeURIComponent(params.leave_at)}`;
  if (params.arrive_by) return `${url}&arrive_by=${encodeURIComponent(params.arrive_by)}`;
  return url;
}

// ── Timeline labels ──────────────────────────────────────────────────────────

const LABEL_TEXT: Record<TimelineLabel, string> = {
  daylight: 'Daylight',
  dusk: 'Dusk on route',
  dark_by_arrival: 'Dark by arrival',
  dark_from_start: 'Dark from start',
};

export function timelineLabelText(label: TimelineLabel): string {
  return LABEL_TEXT[label] ?? '';
}

/** 'Leaves 17:10 · Arrives 17:50 · Dark by arrival', or null if the timeline is unusable. */
export function formatTimelineSummary(timeline: RouteTimeline | null | undefined): string | null {
  if (!timeline) return null;
  const leave = Date.parse(timeline.leaveAtIso);
  const arrive = Date.parse(timeline.arriveAtIso);
  if (!Number.isFinite(leave) || !Number.isFinite(arrive)) return null;
  const parts = [`Leaves ${londonHhmm(new Date(leave))}`, `Arrives ${londonHhmm(new Date(arrive))}`];
  const text = timelineLabelText(timeline.label);
  if (text) parts.push(text);
  return parts.join(' · ');
}
