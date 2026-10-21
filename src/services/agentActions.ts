/**
 * agentActions — runs the validated actions from the AI Insights agent (contract G3, G5).
 *
 * Pure apart from the calls it makes to the controller, confirm and setViaPin it is given.
 * Only candidate ids and route ids are accepted; unknown ids and unknown types are skipped.
 * propose_reroute_via never touches the map or the via pin without a yes from the walker.
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
  /** Asks the walker. Resolves true only on an explicit yes. */
  confirm: (request: { candidate: CandidatePoint; label: string }) => Promise<boolean>;
  /** Sets the via pin, which makes the app search again. Called only after a yes. */
  setViaPin?: (point: LatLng) => void;
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

      case 'propose_reroute_via': {
        const candidate = findCandidate(ctx.candidates, action.candidateId);
        if (!candidate) break;
        const label = typeof action.label === 'string' ? action.label : candidate.label;
        const accepted = await ctx.confirm({ candidate, label });
        if (accepted && ctx.setViaPin) {
          ctx.setViaPin({ latitude: candidate.lat, longitude: candidate.lng });
        }
        break;
      }

      default:
        // Unknown action type: dropped, not an error.
        break;
    }
  }
}
