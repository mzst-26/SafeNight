/**
 * insightsTone — the colour and motion of the "AI Insights / Rethink" button, by trip time.
 *
 * Times are read in London time, like the rest of the app. Late night is 00:00 to 04:59.
 */

export type InsightsTone = 'day' | 'evening' | 'late';

const TIME_ZONE = 'Europe/London';

const londonHour = (date: Date): number => {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(date)
    .find((part) => part.type === 'hour');
  return Number(hour?.value ?? 0);
};

/**
 * @param leaveAtIso the walk's start time (ISO 8601), or null to use `now`
 */
export const insightsToneFor = (leaveAtIso: string | null | undefined, now: Date = new Date()): InsightsTone => {
  const parsed = leaveAtIso ? new Date(leaveAtIso) : now;
  const when = Number.isNaN(parsed.getTime()) ? now : parsed;
  const hour = londonHour(when);
  if (hour < 5) return 'late';
  if (hour >= 18) return 'evening';
  return 'day';
};

/** Only the late-night button moves, to say the insights matter now. */
export const shouldBounce = (tone: InsightsTone): boolean => tone === 'late';
