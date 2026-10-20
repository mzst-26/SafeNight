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
  /** 0..1 darkness fraction at the start / arrival (the backend emits numbers); `label` is the summary. */
  darknessAtStart?: number;
  darknessAtArrival?: number;
  label: TimelineLabel;
}

const TIME_ZONE = 'Europe/London';
export const NOW_STATE: TripTimeState = { mode: 'now', hhmm: null };
// Must match CACHE_BUCKET_MS in backend/src/safety/routes/safeRoutesTime.js. Change both together.
const BUCKET_MS = 15 * 60 * 1000;

const MINUTE_MS = 60 * 1000;
const DAY_MIN = 24 * 60;
const ceilTo15 = (ms: number) => Math.ceil(ms / BUCKET_MS) * BUCKET_MS;

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
let deviceFallback = false;

/** True when Intl could not provide Europe/London and the device zone is used instead. */
export function usingDeviceTime(): boolean {
  return deviceFallback;
}

function devicePartsOf(date: Date): Parts {
  return {
    y: date.getFullYear(),
    mo: date.getMonth() + 1,
    d: date.getDate(),
    h: date.getHours(),
    mi: date.getMinutes(),
    s: date.getSeconds(),
  };
}

function londonParts(date: Date): Parts {
  if (!deviceFallback) {
    try {
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
    } catch {
      // Some runtimes ship without full Intl/time-zone data. Never throw during render.
      deviceFallback = true;
    }
  }
  return devicePartsOf(date);
}

/** Note shown beside the time chip: which clock the chosen time is on. Null when it is the device clock too. */
export function timeZoneNote(): string | null {
  if (deviceFallback) return '(device time)';
  try {
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return device === TIME_ZONE ? null : '(London time)';
  } catch {
    return '(device time)';
  }
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
export function londonHhmm(date: Date): string {
  const p = londonParts(date);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** The instant at which London wall clock reads y-mo-d h:mi. */
function londonWallToInstant(y: number, mo: number, d: number, h: number, mi: number): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  let guess = naive - londonOffsetMin(new Date(naive)) * MINUTE_MS;
  guess = naive - londonOffsetMin(new Date(guess)) * MINUTE_MS;
  const wall = (ms: number) => {
    const p = londonParts(new Date(ms));
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, 0);
  };
  if (wall(guess) === naive) return new Date(guess);
  // The wall time does not exist (spring-forward gap, e.g. 01:30 on 2026-03-29): use the first
  // valid instant after the gap (02:00 BST).
  let probe = naive - 3 * 60 * MINUTE_MS;
  while (wall(probe) < naive) probe += MINUTE_MS;
  return new Date(probe);
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
  // Never exceed the backend horizon (+24h): e.g. "tomorrow" can be 25h away across a clock change.
  const max = tripTimeBounds(state.mode, now).max;
  if (instant.getTime() > now.getTime() + 23 * 60 * MINUTE_MS + 55 * MINUTE_MS) instant = max;
  return { mode: state.mode, instant, isTomorrow };
}

// ── Stepper bounds ───────────────────────────────────────────────────────────

/** Earliest and latest instants the stepper may produce. */
export function tripTimeBounds(
  mode: 'leave_at' | 'arrive_by',
  now: Date,
): { min: Date; max: Date } {
  const floorMs = now.getTime() + (mode === 'arrive_by' ? 15 * MINUTE_MS : 0);
  return {
    min: new Date(ceilTo15(floorMs)),
    max: new Date(Math.floor((now.getTime() + (24 * 60 - 15) * MINUTE_MS) / BUCKET_MS) * BUCKET_MS),
  };
}

/** Can the stepper move by `deltaMin` without hitting a bound or leaving the 24h horizon? */
export function canStepTripTime(state: TripTimeState, deltaMin: number, now: Date): boolean {
  const resolved = resolveTripTime(state, now);
  if (!resolved) return false;
  const { min, max } = tripTimeBounds(resolved.mode, now);
  return deltaMin < 0 ? resolved.instant > min : resolved.instant < max;
}

/** Move the chosen time by `deltaMin`, clamped to [floor, now+23h45m]. Never wraps a day. */
export function stepTripTime(state: TripTimeState, deltaMin: number, now: Date): TripTimeState {
  if (!canStepTripTime(state, deltaMin, now)) return state;
  const resolved = resolveTripTime(state, now) as ResolvedTripTime;
  const { min, max } = tripTimeBounds(resolved.mode, now);
  const target = resolved.instant.getTime() + deltaMin * MINUTE_MS;
  const clamped = Math.min(max.getTime(), Math.max(min.getTime(), target));
  return { mode: state.mode, hhmm: londonHhmm(new Date(clamped)) };
}

export function toTimeParams(state: TripTimeState, now: Date): TimeParams {
  const resolved = resolveTripTime(state, now);
  if (!resolved) return {};
  const iso = londonIso(resolved.instant);
  return resolved.mode === 'leave_at' ? { leave_at: iso } : { arrive_by: iso };
}


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
  return `${verb} ${londonHhmm(resolved.instant)}${resolved.isTomorrow ? ' · Tomorrow' : ''}`;
}

// ── Cache / URL helpers ──────────────────────────────────────────────────────

/** 15-minute bucket key for a chosen time as of `now` ('now' when leaving now). */
export function tripTimeBucket(state: TripTimeState, now: Date): string {
  return timeBucketKey(toTimeParams(state, now));
}

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

/** Arrival and label only, for cards where the departure is the same for every route. */
export function formatArrivalSummary(timeline: RouteTimeline | null | undefined): string | null {
  if (!timeline) return null;
  const arrive = Date.parse(timeline.arriveAtIso);
  if (!Number.isFinite(arrive)) return null;
  const parts = [`Arrives ${londonHhmm(new Date(arrive))}`];
  const text = timelineLabelText(timeline.label);
  if (text) parts.push(text);
  return parts.join(' · ');
}

/** Every 15-minute HH:MM a user may pick for `mode` (same bounds as the native stepper). */
export function tripTimeSlots(mode: 'leave_at' | 'arrive_by', now: Date): string[] {
  const { min, max } = tripTimeBounds(mode, now);
  const slots: string[] = [];
  for (let t = min.getTime(); t <= max.getTime(); t += 15 * MINUTE_MS) {
    slots.push(londonHhmm(new Date(t)));
  }
  return slots;
}
