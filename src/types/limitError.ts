/**
 * LimitError — Thrown when a subscription limit is reached.
 *
 * Carries structured info from the backend's 403 response so the UI
 * can display a meaningful upgrade prompt.
 */

export interface LimitInfo {
  /** Which feature was blocked (e.g. 'emergency_contacts', 'live_sessions') */
  feature: string;
  /** User's current tier */
  currentTier: string;
  /** Max allowed for this tier */
  limit: number;
  /** How many the user has used */
  used: number;
  /** How many remain (will be 0 when blocked) */
  remaining: number;
  /** Time window: 'day' | 'month' | null */
  per: string | null;
  /** ISO timestamp when the limit resets (null if lifetime cap) */
  resetsAt: string | null;
  /** Human-readable message from the backend */
  message: string;
  /** 'limit_reached' or 'upgrade_required' */
  errorType: 'limit_reached' | 'upgrade_required';
}

export class LimitError extends Error {
  readonly info: LimitInfo;

  constructor(info: LimitInfo) {
    super(info.message);
    this.name = 'LimitError';
    this.info = info;
  }
}

/**
 * Parse a 403 response body into LimitInfo, or return null if it's
 * not a subscription limit error.
 */
export function parseLimitResponse(body: Record<string, unknown>): LimitInfo | null {
  const errorType = body.error;
  if (errorType !== 'limit_reached' && errorType !== 'upgrade_required') {
    return null;
  }

  return {
    feature: (body.feature as string) || 'unknown',
    currentTier: (body.current_tier as string) || 'free',
    limit: (body.limit as number) ?? 0,
    used: (body.used as number) ?? 0,
    remaining: (body.remaining as number) ?? 0,
    per: (body.per as string) || null,
    resetsAt: (body.resets_at as string) || null,
    message: (body.message as string) || 'You have reached your usage limit.',
    errorType: errorType as 'limit_reached' | 'upgrade_required',
  };
}

// ─── Global event system for limit errors ────────────────────────────────────
// Any service layer code can emit a limit event; the modal listener in the
// HomeScreen picks it up and shows the popup.

type LimitListener = (info: LimitInfo) => void;
const limitListeners = new Set<LimitListener>();

/** Subscribe to limit events. Returns unsubscribe fn. */
export function onLimitReached(listener: LimitListener): () => void {
  limitListeners.add(listener);
  return () => { limitListeners.delete(listener); };
}

/** Emit a limit event so the modal shows. */
export function emitLimitReached(info: LimitInfo): void {
  limitListeners.forEach((fn) => fn(info));
}
