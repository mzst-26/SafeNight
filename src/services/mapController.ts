/**
 * mapController — lets the AI Insights agent move the mounted map.
 *
 * Same pattern as mapSnapshot: the map (Leaflet iframe on web, MapLibre WebView on native)
 * registers a controller while it is mounted and passes null on unmount. The agent only ever
 * calls these methods; it never supplies coordinates of its own (those come from candidate ids).
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

let controller: MapController | null = null;

/** Called by the map on mount (with its controller) and on unmount (with null). */
export const setMapController = (next: MapController | null): void => {
  controller = next;
};

/** The mounted map's controller, or null when no map is mounted. */
export const getMapController = (): MapController | null => controller;
