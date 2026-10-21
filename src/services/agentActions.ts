/**
 * agentActions — runs the validated actions from the AI Insights agent (contract G3, G5, H6).
 *
 * runAgentActions runs the map actions (pan, zoom, fit, highlight) and never a reroute.
 * A reroute is offered to the walker as an option (rerouteOptions) and runs only when the walker
 * taps it (rerouteVia). Only candidate ids and route ids are accepted; unknown ids and unknown
 * types are skipped. Labels come from the client's candidate list, never from the model.
 */
import type {
  AgentAction,
  AgentActionResult,
  AgentRouteGeometry,
  CandidatePoint,
} from '@/src/services/agentClient';
import {
  runExpansionSearch,
  type ExpansionOutcome,
  type ExpansionRouteFetch,
  type ExpansionScorer,
} from '@/src/services/agentExpansion';
import type { MapController } from '@/src/services/mapController';
import type { LatLng } from '@/src/types/geo';

/** The server allows at most four actions; anything beyond that is ignored. */
const MAX_ACTIONS = 4;
const MIN_ZOOM = 10;
const MAX_ZOOM = 19;
const MAX_ZOOM_DELTA = 2;

/** What expand_search needs: the search itself, and where its new routes go. Absent on a map that cannot expand. */
export interface AgentExpansionContext {
  origin: LatLng;
  destination: LatLng;
  /** Routes on the agent's map before this round. New routes fill up to the map's total of 6. */
  existingCount: number;
  fetchRoute: ExpansionRouteFetch;
  scoreRoutes: ExpansionScorer;
  /** Called once per expand_search that ran, with the routes it found (possibly none). */
  onRoutes: (outcome: ExpansionOutcome) => void;
}

export interface AgentActionContext {
  candidates: CandidatePoint[];
  routes: AgentRouteGeometry[];
  controller: MapController | null;
  expansion?: AgentExpansionContext;
}

/** A reroute the walker can choose. The label is the client's candidate label. */
export interface RerouteOption {
  candidateId: string;
  label: string;
  point: LatLng;
}

const findCandidate = (candidates: CandidatePoint[], id: unknown) =>
  typeof id === 'string' ? candidates.find((c) => c.id === id) : undefined;

const findRoute = (routes: AgentRouteGeometry[], id: unknown) =>
  typeof id === 'string' ? routes.find((r) => r.id === id) : undefined;

/** South, west, north, east of one route's own points. */
const boundsOf = (route: AgentRouteGeometry) => {
  const lats = route.path.map((p) => p.latitude);
  const lngs = route.path.map((p) => p.longitude);
  return {
    south: Math.min(...lats),
    west: Math.min(...lngs),
    north: Math.max(...lats),
    east: Math.max(...lngs),
  };
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** The reroute options the agent proposed, using the client's labels and coordinates. */
export function rerouteOptions(actions: AgentAction[], candidates: CandidatePoint[]): RerouteOption[] {
  const seen = new Set<string>();
  const options: RerouteOption[] = [];
  for (const action of actions.slice(0, MAX_ACTIONS)) {
    if (!action || typeof action !== 'object' || action.type !== 'propose_reroute_via') continue;
    const candidate = findCandidate(candidates, action.candidateId);
    if (!candidate || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    options.push({
      candidateId: candidate.id,
      label: candidate.label,
      point: { latitude: candidate.lat, longitude: candidate.lng },
    });
  }
  return options;
}

/** The one reroute path: sets the via pin, which makes the app search again. */
export function rerouteVia(option: RerouteOption, setViaPin: (point: LatLng) => void): void {
  setViaPin(option.point);
}

/**
 * Runs the map actions on the given map and returns one result per action (ok: it ran on the map).
 * The results go back to the agent in the next round. propose_reroute_via is offered, not run, so it
 * counts as ok; unknown types and unknown ids count as not ok.
 */
export async function runAgentActions(
  actions: AgentAction[],
  ctx: AgentActionContext,
): Promise<AgentActionResult[]> {
  const { controller } = ctx;
  const results: AgentActionResult[] = [];
  // New routes this call has added, so a second expand_search in the same round counts them.
  let addedRoutes = 0;

  for (const action of actions.slice(0, MAX_ACTIONS)) {
    if (!action || typeof action !== 'object') continue;

    let ok = false;
    switch (action.type) {
      case 'pan_to': {
        const candidate = findCandidate(ctx.candidates, action.candidateId);
        if (!candidate || !controller) break;
        const zoom =
          isFiniteNumber(action.zoom) && action.zoom >= MIN_ZOOM && action.zoom <= MAX_ZOOM
            ? action.zoom
            : undefined;
        controller.panTo(candidate.lat, candidate.lng, zoom);
        ok = true;
        break;
      }

      case 'zoom': {
        if (!controller || !isFiniteNumber(action.delta)) break;
        if (Math.abs(action.delta) > MAX_ZOOM_DELTA) break;
        controller.zoomBy(action.delta);
        ok = true;
        break;
      }

      case 'fit_route': {
        const route = findRoute(ctx.routes, action.routeId);
        if (!route || !controller || route.path.length === 0) break;
        controller.fitBounds(boundsOf(route));
        ok = true;
        break;
      }

      case 'show_findings': {
        const route = findRoute(ctx.routes, action.routeId);
        if (!route || !controller) break;
        ok = controller.highlight(route.id);
        break;
      }

      case 'expand_search': {
        const expansion = ctx.expansion;
        const ids = Array.isArray(action.candidateIds)
          ? action.candidateIds.filter((id): id is string => typeof id === 'string')
          : [];
        if (!expansion || ids.length === 0) break;
        const outcome = await runExpansionSearch({
          candidateIds: ids,
          candidates: ctx.candidates,
          origin: expansion.origin,
          destination: expansion.destination,
          existingCount: expansion.existingCount + addedRoutes,
          fetchRoute: expansion.fetchRoute,
          scoreRoutes: expansion.scoreRoutes,
        });
        addedRoutes += outcome.routes.length;
        expansion.onRoutes(outcome);
        // One result per requested point, so a failed point is reported as ok false.
        results.push(...outcome.results);
        continue;
      }

      case 'propose_reroute_via':
        // Offered to the walker as an option (rerouteOptions), never run here.
        ok = true;
        break;

      default:
        // Unknown action types are dropped, not an error.
        break;
    }
    results.push({ type: action.type, ok });
  }

  return results;
}
