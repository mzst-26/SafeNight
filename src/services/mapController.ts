/**
 * mapController — lets the AI Insights agent move a mounted map.
 *
 * Same pattern as mapSnapshot: each map (Leaflet iframe on web, MapLibre WebView on native)
 * registers a controller under its instance name while it is mounted and passes null on unmount.
 * 'main' is the walker's map; other names (e.g. 'agent', the AI bubble map) keep their own slot.
 * The agent only ever calls these methods; it never supplies coordinates of its own (those come
 * from candidate ids).
 */

export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface MapController {
  panTo(lat: number, lng: number, zoom?: number): void;
  zoomBy(delta: number): void;
  fitBounds(bounds: MapBounds): void;
  /** Returns false when the map has nothing to highlight for that route. */
  highlight(routeId: string): boolean;
}

const controllers = new Map<string, MapController>();

/** Called by the map on mount (with its controller) and on unmount (with null). */
export const setMapController = (next: MapController | null, name = 'main'): void => {
  if (next) controllers.set(name, next);
  else controllers.delete(name);
};

/** The named map's controller, or null when that map is not mounted. */
export const getMapController = (name = 'main'): MapController | null => controllers.get(name) ?? null;
