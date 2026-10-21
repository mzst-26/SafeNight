/**
 * agentActions — runs the validated actions from the AI Insights agent (contract G3, G5, H6).
 *
 * runAgentActions runs the map actions (pan, zoom, fit, highlight) and never a reroute.
 * A reroute is offered to the walker as an option (rerouteOptions) and runs only when the walker
 * taps it (rerouteVia). Only candidate ids and route ids are accepted; unknown ids and unknown
 * types are skipped. Labels come from the client's candidate list, never from the model.
 */
import type { AgentAction, AgentRouteGeometry, CandidatePoint } from '@/src/services/agentClient';
import type { MapController } from '@/src/services/mapController';
import type { LatLng } from '@/src/types/geo';

/** The server allows at most four actions; anything beyond that is ignored. */
const MAX_ACTIONS = 4;
const MIN_ZOOM = 10;
const MAX_ZOOM = 19;
const MAX_ZOOM_DELTA = 2;

export interface AgentActionContext {
  candidates: CandidatePoint[];
  routes: AgentRouteGeometry[];
  controller: MapController | null;
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

export async function runAgentActions(actions: AgentAction[], ctx: AgentActionContext): Promise<void> {
  const { controller } = ctx;

  for (const action of actions.slice(0, MAX_ACTIONS)) {
    if (!action || typeof action !== 'object') continue;

    switch (action.type) {
      case 'pan_to': {
        const candidate = findCandidate(ctx.candidates, action.candidateId);
        if (!candidate || !controller) break;
        const zoom =
          isFiniteNumber(action.zoom) && action.zoom >= MIN_ZOOM && action.zoom <= MAX_ZOOM
            ? action.zoom
            : undefined;
        controller.panTo(candidate.lat, candidate.lng, zoom);
        break;
      }

      case 'zoom': {
        if (!controller || !isFiniteNumber(action.delta)) break;
        if (Math.abs(action.delta) > MAX_ZOOM_DELTA) break;
        controller.zoomBy(action.delta);
        break;
      }

      case 'fit_route': {
        const route = findRoute(ctx.routes, action.routeId);
        if (!route || !controller || route.path.length === 0) break;
        controller.fitBounds(boundsOf(route));
        break;
      }

      case 'show_findings': {
        const route = findRoute(ctx.routes, action.routeId);
        if (!route || !controller) break;
        controller.highlight(route.id);
        break;
      }

      default:
        // propose_reroute_via is offered as an option (rerouteOptions), never run here.
        // Unknown action types are dropped, not an error.
        break;
    }
  }
}
