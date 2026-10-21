/**
 * insightsTone — the colour and motion of the "AI Insights / Rethink" button, by trip time.
 *
 * Times are read in London time, like the rest of the app. Each window starts at its
 * `fromHour` (inclusive) and runs to the next window's start. Late night wraps past midnight.
 */

export type InsightsTone = 'morning' | 'afternoon' | 'evening' | 'late';

const TIME_ZONE = 'Europe/London';

/** Windows in order of the day, starting at 05:00. Edit here to change the hours. */
export const INSIGHTS_WINDOWS: ReadonlyArray<{ tone: InsightsTone; fromHour: number }> = [
  { tone: 'morning', fromHour: 5 },
  { tone: 'afternoon', fromHour: 12 },
  { tone: 'evening', fromHour: 18 },
  { tone: 'late', fromHour: 22 },
];

const londonHour = (date: Date): number => {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(date)
    .find((part) => part.type === 'hour');
  return Number(hour?.value ?? 0);
};

/** The window a London hour falls in; hours before 05:00 belong to the late-night window. */
const toneForHour = (hour: number): InsightsTone => {
  let tone: InsightsTone = 'late';
  for (const window of INSIGHTS_WINDOWS) {
    if (hour >= window.fromHour) tone = window.tone;
  }
  return tone;
};

/**
 * @param leaveAtIso the walk's start time (ISO 8601), or null to use `now`
 */
export const insightsToneFor = (leaveAtIso: string | null | undefined, now: Date = new Date()): InsightsTone => {
  const parsed = leaveAtIso ? new Date(leaveAtIso) : now;
  const when = Number.isNaN(parsed.getTime()) ? now : parsed;
  return toneForHour(londonHour(when));
};

/** Only the late-night window moves, to say the insights matter now. */
export const shouldBounce = (tone: InsightsTone): boolean => tone === 'late';
