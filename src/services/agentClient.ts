/**
 * agentClient — talks to POST /api/agent-insights (contract G1 in docs/ai-insights-task-sheet.md).
 *
 * The request carries only route data and candidate ids built here. It never carries the user's
 * email or any other identifier, and the model never supplies coordinates: it names candidate ids.
 */
import { env } from '@/src/config/env';
import { buildCompactRoutes } from '@/src/services/compactRoutes';
import type { CompactRouteInfo } from '@/src/services/openai';
import type { RouteScore } from '@/src/hooks/useAllRoutesSafety';
import type { SafeRoute } from '@/src/services/safeRoutes';
import type { DirectionsRoute, LatLng } from '@/src/types/geo';

const AGENT_TIMEOUT_MS = 45_000;
const MAX_CANDIDATES = 12;

// ── G1 request and response types ───────────────────────────────────────────

export interface AgentWorstStretch {
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  lengthM: number;
  cause: string | null;
}

export interface AgentRouteInfo extends Omit<CompactRouteInfo, 'worstStretch'> {
  worstStretch?: AgentWorstStretch | null;
}

export type CandidateKind = 'stretch_midpoint' | 'route_start' | 'route_end';

export interface CandidatePoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
  kind: CandidateKind;
}

export interface AgentInsightsRequest {
  bestRouteId: string;
  routes: AgentRouteInfo[];
  trip: { leaveAtIso?: string };
  candidatePoints: CandidatePoint[];
  answer?: { questionId: string; choiceId: string };
}

export type AgentAction =
  | { type: 'pan_to'; candidateId: string; zoom?: number }
  | { type: 'zoom'; delta: number }
  | { type: 'fit_route'; routeId: string }
  | { type: 'show_findings'; routeId: string }
  | { type: 'propose_reroute_via'; candidateId: string; label: string; requiresConfirmation: true };

export interface AgentQuestion {
  id: string;
  text: string;
  choices: Array<{ id: string; label: string }>;
}

export interface AgentInsightsResponse {
  analysis: {
    routes: Array<{
      routeId: string;
      findings: Array<{ id: string; severity: 'info' | 'caution' | 'risk'; text: string }>;
    }>;
  };
  decision: { kind: 'keep' | 'switch'; routeId: string; reasons: string[] };
  message: string;
  actions: AgentAction[];
  question?: AgentQuestion;
}

// ── Typed error ─────────────────────────────────────────────────────────────

export type AgentErrorKind = 'config' | 'network' | 'timeout' | 'http' | 'invalid';

export class AgentInsightsError extends Error {
  readonly kind: AgentErrorKind;
  readonly status: number | null;

  constructor(kind: AgentErrorKind, status: number | null, message: string) {
    super(message);
    this.name = 'AgentInsightsError';
    this.kind = kind;
    this.status = status;
  }
}

// ── Candidate points (G2: ids only, built on the client) ────────────────────

/** A route as the agent needs it: its path for fitting, and its worst stretch for candidates. */
export interface AgentRouteGeometry {
  id: string;
  path: LatLng[];
  worstStretch?: AgentWorstStretch | null;
}

const pointKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

/**
 * The points the model may refer to, in order: each route's worst-stretch midpoint, then the
 * route's start and end. Identical points are listed once. At most 12, with ids p1..pN.
 */
export function buildCandidatePoints(routes: AgentRouteGeometry[]): CandidatePoint[] {
  const points: CandidatePoint[] = [];
  const seen = new Set<string>();

  const add = (label: string, kind: CandidateKind, lat: number, lng: number) => {
    if (points.length >= MAX_CANDIDATES) return;
    const key = pointKey(lat, lng);
    if (seen.has(key)) return;
    seen.add(key);
    points.push({ id: `p${points.length + 1}`, label, lat, lng, kind });
  };

  routes.forEach((route, index) => {
    const number = index + 1;
    const stretch = route.worstStretch;
    if (stretch) {
      add(
        `Middle of the weakest stretch on route ${number}`,
        'stretch_midpoint',
        (stretch.start.lat + stretch.end.lat) / 2,
        (stretch.start.lng + stretch.end.lng) / 2,
      );
    }
    const first = route.path[0];
    const last = route.path[route.path.length - 1];
    if (first) add('Start of the walk', 'route_start', first.latitude, first.longitude);
    if (last) add('End of the walk', 'route_end', last.latitude, last.longitude);
  });

  return points;
}

// ── Request context (what the panel needs for one search) ───────────────────

export interface AgentContext {
  /** The G1 body, without an answer. */
  body: AgentInsightsRequest;
  /** Candidate points the body refers to, for resolving ids. */
  candidates: CandidatePoint[];
  /** Route geometry for fit_route and show_findings. */
  routes: AgentRouteGeometry[];
}

export interface BuildAgentContextInput {
  routes: DirectionsRoute[];
  safeRoutes: SafeRoute[];
  scores: Record<string, RouteScore>;
  bestRouteId: string | null;
}

/** Builds the request body and the candidate list from the same top routes, so their ids agree. */
export function buildAgentContext(input: BuildAgentContextInput): AgentContext {
  const top = input.routes.slice(0, 3);
  const fullStretch = (routeId: string) =>
    input.safeRoutes.find((sr) => sr.id === routeId)?.safety?.worstStretch ?? null;

  // Compact data as the explanation sends it, with the worst stretch's ends so the model can name them.
  const compact = buildCompactRoutes(top, input.scores, input.safeRoutes);
  const routes: AgentRouteInfo[] = compact.map((route) => {
    const stretch = fullStretch(route.routeId);
    return {
      ...route,
      worstStretch: stretch
        ? {
            start: { lat: stretch.start.lat, lng: stretch.start.lng },
            end: { lat: stretch.end.lat, lng: stretch.end.lng },
            lengthM: stretch.lengthM,
            cause: stretch.cause,
          }
        : null,
    };
  });

  const geometry: AgentRouteGeometry[] = top.map((route) => ({
    id: route.id,
    path: route.path,
    worstStretch: fullStretch(route.id),
  }));
  const candidates = buildCandidatePoints(geometry);

  const leaveAtIso = input.safeRoutes.find((r) => r.isSafest)?.safety?.timeline?.leaveAtIso;
  const body: AgentInsightsRequest = {
    bestRouteId: input.bestRouteId ?? top[0]?.id ?? '',
    routes,
    trip: leaveAtIso ? { leaveAtIso } : {},
    candidatePoints: candidates,
  };

  return { body, candidates, routes: geometry };
}

// ── Network ─────────────────────────────────────────────────────────────────

const isDecision = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return (d.kind === 'keep' || d.kind === 'switch') && typeof d.routeId === 'string' && Array.isArray(d.reasons);
};

/** Accepts a parsed body that has the fields the panel needs; fills in an empty action list. */
const normaliseResponse = (data: unknown): AgentInsightsResponse | null => {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (!isDecision(record.decision) || typeof record.message !== 'string') return null;
  return {
    ...(record as unknown as AgentInsightsResponse),
    actions: Array.isArray(record.actions) ? (record.actions as AgentAction[]) : [],
  };
};

/**
 * POST the request to /api/agent-insights. Resolves with the G1 response, or throws an
 * AgentInsightsError whose `kind` says what went wrong.
 */
export async function postAgentInsights(body: AgentInsightsRequest): Promise<AgentInsightsResponse> {
  const apiBaseUrl = env.apiBaseUrl;
  if (!apiBaseUrl) {
    throw new AgentInsightsError('config', null, 'Missing EXPO_PUBLIC_API_BASE_URL.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/api/agent-insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw controller.signal.aborted
      ? new AgentInsightsError('timeout', null, 'AI Insights took too long. Please try again.')
      : new AgentInsightsError('network', null, 'Could not reach AI Insights.');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new AgentInsightsError('http', response.status, `AI Insights backend error ${response.status}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AgentInsightsError('invalid', response.status, 'AI Insights sent an unreadable reply.');
  }

  const normalised = normaliseResponse(data);
  if (!normalised) {
    throw new AgentInsightsError('invalid', response.status, 'AI Insights sent an incomplete reply.');
  }
  return normalised;
}
