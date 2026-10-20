import { readFileSync } from 'fs';
import { join } from 'path';

import { buildLeafletHtml } from '@/src/components/maps/RouteMap.web';
import {
  OSM_ATTRIBUTION,
  NATIVE_MAP_ATTRIBUTION,
  RL_ATTRIBUTION_HEIGHT_PX,
  RL_DASH,
  RL_LEGEND_ATTRIBUTION_GAP_PX,
  RL_LINE_OPACITY,
  RL_RELAYOUT_DEBOUNCE_MS,
} from '@/src/components/maps/mapConstants';
import { FakeEl } from './helpers/fakeDom';
import { buildRouteLayers, RISK_RAMP } from '@/src/components/maps/routeLayers';
import type { RouteLayerSpec } from '@/src/components/maps/routeLayers';

/*
 * Behavioural tests for the Leaflet route layers. The real inline <script> from
 * buildLeafletHtml() is executed with a recording fake `L` (layers record their
 * options, groups record what was added to them). Nothing is loaded from the
 * network and no browser is needed.
 */

type FakeLayer = {
  type: 'polyline' | 'marker' | 'circleMarker' | 'polygon' | 'rectangle';
  latlngs: unknown;
  options: Record<string, any>;
  handlers: Record<string, (...args: any[]) => void>;
  on: (ev: string, fn: (...args: any[]) => void) => FakeLayer;
  addTo: (group: FakeGroup) => FakeLayer;
  getElement: () => null;
  setStyle: () => FakeLayer;
};

type FakeGroup = {
  layers: FakeLayer[];
  addTo: () => FakeGroup;
  clearLayers: () => FakeGroup;
  getLayers: () => FakeLayer[];
};

const makeGroup = (): FakeGroup => {
  const group: FakeGroup = {
    layers: [],
    addTo: () => group,
    clearLayers: () => {
      group.layers.length = 0;
      return group;
    },
    getLayers: () => group.layers,
  };
  return group;
};

const makeLayer = (type: FakeLayer['type'], latlngs: unknown, options: Record<string, any>): FakeLayer => {
  const layer: FakeLayer = {
    type,
    latlngs,
    options,
    handlers: {},
    on: (ev, fn) => {
      layer.handlers[ev] = fn;
      return layer;
    },
    addTo: (group) => {
      group.layers.push(layer);
      return layer;
    },
    getElement: () => null,
    setStyle: () => layer,
  };
  return layer;
};

const SCRIPT_RE = /<script>([\s\S]*?)<\/script>/;

type HarnessOptions = {
  zoom?: number;
  /** Pixels per degree at the harness zoom; defaults to the Web Mercator scale 256 * 2^zoom / 360. */
  project?: ((lat: number, lng: number, zoom: number) => { x: number; y: number }) | null;
  parentOrigin?: string | 'throw';
  innerWidth?: number;
};

function loadRouteMap(opts: HarnessOptions = {}) {
  const match = buildLeafletHtml(false).match(SCRIPT_RE);
  if (!match) throw new Error('inline map script not found in buildLeafletHtml output');

  const state = { zoom: opts.zoom ?? 16 };
  const mapHandlers: Record<string, (() => void)[]> = {};
  const tileOptions: Record<string, any>[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let timerId = 0;
  const project =
    opts.project ||
    ((lat: number, lng: number, zoom: number) => {
      const perDeg = (256 * 2 ** zoom) / 360;
      return { x: lng * perDeg, y: -lat * perDeg };
    });
  const fakeMap: any = {
    on: (ev: string, fn: () => void) => {
      (mapHandlers[ev] ??= []).push(fn);
      return fakeMap;
    },
    latLngToContainerPoint: (ll: [number, number]) => project(ll[0], ll[1], state.zoom),
    once: () => fakeMap,
    off: () => fakeMap,
    setView: () => fakeMap,
    getZoom: () => state.zoom,
    getCenter: () => ({ lat: 0, lng: 0 }),
    stop: () => undefined,
    flyTo: () => undefined,
    panTo: () => undefined,
    fitBounds: () => undefined,
    removeLayer: () => undefined,
  };
  if (opts.project === null) delete fakeMap.latLngToContainerPoint;

  const postMessage = jest.fn();
  const parentLocation =
    opts.parentOrigin === 'throw'
      ? {
          get origin(): string {
            throw new Error('cross-origin');
          },
        }
      : { origin: opts.parentOrigin ?? 'http://localhost:8084' };
  const win: any = {
    innerWidth: opts.innerWidth ?? 400,
    innerHeight: 800,
    addEventListener: () => undefined,
    dispatchEvent: () => true,
    parent: { postMessage, location: parentLocation },
  };

  const doc: any = {
    body: new FakeEl('body'),
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: () => new FakeEl('div'),
  };

  const L: any = {
    map: () => fakeMap,
    tileLayer: (_url: string, options: Record<string, any>) => {
      tileOptions.push(options);
      return { addTo: () => undefined };
    },
    layerGroup: () => makeGroup(),
    polyline: (latlngs: unknown, options: Record<string, any>) => makeLayer('polyline', latlngs, options),
    polygon: (latlngs: unknown, options: Record<string, any>) => makeLayer('polygon', latlngs, options),
    rectangle: (latlngs: unknown, options: Record<string, any>) => makeLayer('rectangle', latlngs, options),
    circleMarker: (latlng: unknown, options: Record<string, any>) =>
      makeLayer('circleMarker', latlng, options),
    marker: (latlng: unknown, options: Record<string, any>) => makeLayer('marker', latlng, options),
    divIcon: (options: Record<string, any>) => options,
    control: () => {
      const control: any = {
        addTo(map: unknown) {
          control._el = control.onAdd(map);
          return control;
        },
      };
      return control;
    },
    DomEvent: { disableClickPropagation: () => undefined },
  };

  class FakeCustomEvent {
    detail: unknown;
    constructor(_type: string, init?: { detail?: unknown }) {
      this.detail = init?.detail;
    }
  }

  const body = `${match[1]}
return {
  updateMap: updateMap,
  legendControl: typeof legendControl !== 'undefined' ? legendControl : null,
  getLegend: function () { return typeof legendEl !== 'undefined' ? legendEl : null; },
  groups: {
    routes: layerRoutes,
    markers: layerMarkers,
    overlay: typeof routeOverlayLayer !== 'undefined' ? routeOverlayLayer : null,
    points: typeof routePointsLayer !== 'undefined' ? routePointsLayer : null,
    friends: typeof layerFriends !== 'undefined' ? layerFriends : null,
    labels: typeof layerLabels !== 'undefined' ? layerLabels : null
  }
};`;

  const factory = new Function(
    'window',
    'document',
    'L',
    'requestAnimationFrame',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'CustomEvent',
    body,
  );
  const api = factory(
    win,
    doc,
    L,
    () => 0,
    (fn: () => void, ms: number) => {
      timers.set(++timerId, { fn, ms });
      return timerId;
    },
    (id: number) => {
      timers.delete(id);
    },
    () => 0,
    () => undefined,
    FakeCustomEvent,
  );

  return {
    ...api,
    postMessage,
    setZoom: (z: number) => {
      state.zoom = z;
    },
    tileOptions,
    fireMapEvent: (ev: string) => (mapHandlers[ev] ?? []).forEach((fn) => fn()),
    fireZoomEnd: () => (mapHandlers.zoomend ?? []).forEach((fn) => fn()),
    /** Pending timers created with the overlay relayout debounce delay. */
    pendingRelayouts: () => Array.from(timers.values()).filter((t) => t.ms === RL_RELAYOUT_DEBOUNCE_MS).length,
    /** Runs (once) the debounced overlay relayout timers only; other page timers stay pending. */
    flushRelayout: () => {
      Array.from(timers.entries())
        .filter(([, t]) => t.ms === RL_RELAYOUT_DEBOUNCE_MS)
        .forEach(([id, t]) => {
          timers.delete(id);
          t.fn();
        });
    },
  };
}

type Harness = ReturnType<typeof loadRouteMap>;

const pt = (lat: number, lng: number) => ({ lat, lng });

const ROUTE_A = [pt(51.5, -0.12), pt(51.51, -0.12), pt(51.52, -0.11)];
const ROUTE_B = [pt(51.5, -0.13), pt(51.505, -0.125), pt(51.51, -0.12), pt(51.515, -0.115)];

const routesFixture = () => [
  { id: 'a', selected: false, path: ROUTE_A },
  { id: 'b', selected: true, path: ROUTE_B },
];

function basePayload(over: Record<string, unknown> = {}) {
  return {
    origin: null,
    destination: null,
    routes: routesFixture(),
    showExtraDetail: false,
    segments: [],
    safetyMarkers: [],
    roadLabels: [],
    fitBounds: false,
    fitCandidateBounds: false,
    fitTopPadding: 40,
    fitBottomPadding: 40,
    fitSidePadding: 40,
    candidateFitTopPadding: 40,
    candidateFitBottomPadding: 40,
    candidateFitSidePadding: 40,
    panTo: null,
    navLocation: null,
    navHeading: null,
    highlightCategory: null,
    maxDistanceKm: null,
    friendMarkers: [],
    isInPipMode: false,
    outOfRangeCueToken: 0,
    ...over,
  };
}

const EMPTY_SPEC = buildRouteLayers(null, { zoom: 16 });
const makeSpec = (partial: Partial<RouteLayerSpec>): RouteLayerSpec => ({ ...EMPTY_SPEC, ...partial });

/** Real builder output: two solid/dashed lines, one worst-stretch callout, clustered crimes. */
const builtSpec = buildRouteLayers(
  {
    segments: [
      { start: pt(51.505, -0.125), end: pt(51.51, -0.12), risk: 0.1, certainty: 0.9 },
      { start: pt(51.51, -0.12), end: pt(51.515, -0.115), risk: 0.95, litEstimate: 'estimated_unlit' },
    ],
    worstStretch: { start: pt(51.51, -0.12), end: pt(51.515, -0.115), lengthM: 240, cause: 'lighting' },
    crimes: [pt(51.507, -0.122), pt(51.5071, -0.1221), pt(51.6, -0.2)],
    lights: [pt(51.506, -0.124)],
    cctv: [pt(51.508, -0.123)],
    places: [pt(51.509, -0.121)],
  },
  { zoom: 16 },
);

/** Markup of a divIcon: the shared builders are serialised (strings stay strings). */
const iconHtml = (l: FakeLayer): string => String(l.options.icon?.html ?? '');

const polylines = (group: FakeGroup) => group.layers.filter((l) => l.type === 'polyline');
const circles = (group: FakeGroup) => group.layers.filter((l) => l.type === 'circleMarker');

describe('RouteMap.web Leaflet route layers', () => {
  describe('legacy path (routeLayers null or absent) is unchanged', () => {
    it('draws unselected routes as a single grey weight-5 line with a click handler and no hit line', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload());

      const lines = polylines(h.groups.routes);
      const grey = lines.filter((l) => l.options.color === '#98a2b3');
      expect(grey).toHaveLength(1);
      expect(grey[0].options).toMatchObject({ weight: 5, opacity: 0.6 });
      expect(typeof grey[0].handlers.click).toBe('function');
      expect(lines.some((l) => l.options.weight === 44)).toBe(false);
    });

    it('draws the selected route as a blue weight-6 line when there are no segments', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload());

      const blue = polylines(h.groups.routes).filter((l) => l.options.color === '#4285F4');
      expect(blue).toHaveLength(1);
      expect(blue[0].options).toMatchObject({ weight: 6, opacity: 0.9 });
    });

    it('draws segment colours at weight 7 with no casing when segments are supplied', () => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          segments: [{ color: '#ff00ff', path: ROUTE_B }],
        }),
      );

      const seg = polylines(h.groups.routes).filter((l) => l.options.color === '#ff00ff');
      expect(seg).toHaveLength(1);
      expect(seg[0].options).toMatchObject({ weight: 7, opacity: 0.9 });
      expect(polylines(h.groups.routes).some((l) => l.options.color === '#ffffff')).toBe(false);
    });

    it('still draws safety crime markers as circle markers', () => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          safetyMarkers: [{ id: 'crime-1', kind: 'crime', lat: 51.51, lng: -0.12, label: 'Crime' }],
        }),
      );

      const dots = circles(h.groups.markers);
      expect(dots).toHaveLength(1);
      expect(dots[0].options).toMatchObject({ radius: 4, fillColor: '#ef4444' });
    });

    it('produces identical layers for routeLayers null and for an absent key', () => {
      const serialize = (h: Harness) =>
        JSON.stringify(
          [h.groups.routes, h.groups.markers].map((g: FakeGroup) =>
            g.layers.map((l) => ({ type: l.type, latlngs: l.latlngs, options: l.options })),
          ),
        );

      const absent = loadRouteMap();
      absent.updateMap(basePayload());
      const explicitNull = loadRouteMap();
      explicitNull.updateMap(basePayload({ routeLayers: null }));

      expect(serialize(explicitNull)).toBe(serialize(absent));
    });

    it('keeps the legend hidden and adds no overlay layers', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload());

      expect(h.getLegend()?.style.display).toBe('none');
      expect(h.groups.overlay?.layers ?? []).toHaveLength(0);
      expect(h.groups.points?.layers ?? []).toHaveLength(0);
    });
  });

  describe('routeLayers set', () => {
    it('draws a white casing under every coloured line, casings first, dashed lines with dotted dash', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec }));

      const lines = polylines(h.groups.routes);
      const casings = lines.filter((l) => l.options.color === '#ffffff' && l.options.weight === 11);
      const coloured = lines.filter((l) => l.options.weight === 7);

      expect(casings).toHaveLength(2);
      casings.forEach((c) => expect(c.options).toMatchObject({ opacity: 0.9, lineCap: 'round', lineJoin: 'round' }));
      expect(coloured.map((l) => l.options.color)).toEqual([RISK_RAMP[0], RISK_RAMP[5]]);
      expect(coloured.every((l) => l.options.lineCap === 'round' && l.options.lineJoin === 'round')).toBe(true);

      expect(coloured[0].options.dashArray).toBeUndefined();
      expect(coloured[1].options.dashArray).toBe('0.1 15');

      const lastCasing = Math.max(...casings.map((c) => lines.indexOf(c)));
      const firstColoured = Math.min(...coloured.map((c) => lines.indexOf(c)));
      expect(lastCasing).toBeLessThan(firstColoured);
    });

    it('draws the coloured line along the merged coordinates from the spec', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec }));

      const coloured = polylines(h.groups.routes).filter((l) => l.options.weight === 7);
      expect(coloured[0].latlngs).toEqual([
        [51.505, -0.125],
        [51.51, -0.12],
      ]);
    });

    it('falls back to a single blue selected line when the spec has no usable lines', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: makeSpec({ lines: [] }) }));

      const blue = polylines(h.groups.routes).filter((l) => l.options.color === '#4285F4');
      expect(blue).toHaveLength(1);
    });

    it('ignores the per-segment overlay input and does not draw purple uncertainty boxes', () => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          routeLayers: builtSpec,
          segments: [{ color: '#ff00ff', path: ROUTE_B }],
        }),
      );

      const all = [...h.groups.routes.layers, ...h.groups.markers.layers];
      expect(all.some((l) => l.options.color === '#ff00ff')).toBe(false);
      expect(all.some((l) => l.type === 'rectangle' || l.type === 'polygon')).toBe(false);
    });

    it('gives unselected routes a solid #667085 weight-4 line plus an invisible 44px hit line (touch target) that selects the route', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec }));

      const lines = polylines(h.groups.routes);
      const grey = lines.filter((l) => l.options.color === '#667085' && l.options.weight === 4);
      expect(grey).toHaveLength(1);
      expect(grey[0].options).toMatchObject({ weight: 4, opacity: 1 });

      const hit = lines.filter((l) => l.options.weight === 44);
      expect(hit).toHaveLength(1);
      expect(hit[0].options.opacity).toBe(0);
      expect(hit[0].latlngs).toEqual(ROUTE_A.map((p) => [p.lat, p.lng]));

      (h.postMessage as jest.Mock).mockClear();
      hit[0].handlers.click();
      expect(h.postMessage).toHaveBeenCalledTimes(1);
      const [raw, origin] = (h.postMessage as jest.Mock).mock.calls[0];
      expect(JSON.parse(raw)).toEqual({ type: 'selectRoute', id: 'a' });
      expect(origin).toBe('http://localhost:8084');
    });

    it('draws every wide hit line before the selected route lines, and the selected lines are interactive', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec }));

      const lines = h.groups.routes.layers as FakeLayer[];
      const hitIdx = lines.map((l, i) => (l.type === 'polyline' && l.options.weight === 44 ? i : -1)).filter((i) => i >= 0);
      const selectedIdx = lines
        .map((l, i) => (l.type === 'polyline' && (l.options.weight === 11 || l.options.weight === 7) ? i : -1))
        .filter((i) => i >= 0);

      expect(hitIdx.length).toBeGreaterThan(0);
      expect(Math.max(...hitIdx)).toBeLessThan(Math.min(...selectedIdx));
      lines
        .filter((l, i) => selectedIdx.includes(i))
        .forEach((l) => expect(l.options.interactive).toBe(true));
    });

    it('draws only one worst-stretch callout, above the lines, without interaction', () => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          routeLayers: makeSpec({
            callouts: [
              { lat: 51.5, lng: -0.1, text: 'Unlit stretch · 240 m', kind: 'worst-stretch' },
              { lat: 51.6, lng: -0.2, text: 'Second label', kind: 'worst-stretch' },
            ],
          }),
        }),
      );

      const callouts = h.groups.overlay.layers.filter(
        (l: FakeLayer) => l.type === 'marker' && l.options.icon?.className === 'rl-callout-icon',
      );
      expect(callouts).toHaveLength(1);
      expect(callouts[0].options.icon.html).toContain('Unlit stretch · 240 m');
      expect(callouts[0].options.zIndexOffset).toBeGreaterThanOrEqual(1000);
      expect(callouts[0].options.interactive).toBe(false);
    });

    it('draws crime as count badges only, never as individual crime dots (even when highlighted)', () => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          routeLayers: builtSpec,
          highlightCategory: 'crime',
          safetyMarkers: [{ id: 'crime-1', kind: 'crime', lat: 51.51, lng: -0.12, label: 'Crime' }],
        }),
      );

      expect(circles(h.groups.markers)).toHaveLength(0);
      const badges = h.groups.overlay.layers.filter((l: FakeLayer) => l.options.icon?.className === 'rl-crime-icon');
      expect(badges).toHaveLength(builtSpec.crimeClusters.length);
      badges.forEach((b: FakeLayer) => {
        expect(b.options.icon.iconSize[0]).toBeGreaterThanOrEqual(32);
        expect(b.options.icon.html).toMatch(/rl-crime[^>]*>\d+</);
      });
      const countOf = (html: string) => Number(html.match(/>(\d+)</)?.[1]);
      expect(badges.map((b: FakeLayer) => countOf(b.options.icon.html))).toEqual(
        builtSpec.crimeClusters.map((c) => c.count),
      );
    });

    it('announces each crime badge as an image with its count', () => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          routeLayers: makeSpec({
            crimeClusters: [
              { lat: 51.51, lng: -0.12, count: 1, maxSeverity: 1 },
              { lat: 51.511, lng: -0.12, count: 12, maxSeverity: 1 },
            ],
          }),
        }),
      );

      const badges = h.groups.overlay.layers.filter((l: FakeLayer) => l.options.icon?.className === 'rl-crime-icon');
      expect(badges.map(iconHtml).map((html: string) => html.match(/aria-label="([^"]+)"/)?.[1])).toEqual([
        '1 crime reported',
        '12 crimes reported',
      ]);
      badges.forEach((b: FakeLayer) => expect(iconHtml(b)).toContain('role="img"'));
    });

    it('sizes crime badges 32px, grows to 36px at 100 or more, and caps the label at 99+', () => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          routeLayers: makeSpec({
            crimeClusters: [
              { lat: 51.51, lng: -0.12, count: 5, maxSeverity: 1 },
              { lat: 51.511, lng: -0.12, count: 99, maxSeverity: 1 },
              { lat: 51.512, lng: -0.12, count: 100, maxSeverity: 1 },
              { lat: 51.513, lng: -0.12, count: 250, maxSeverity: 1 },
            ],
          }),
        }),
      );

      const badges = h.groups.overlay.layers.filter((l: FakeLayer) => l.options.icon?.className === 'rl-crime-icon');
      expect(badges.map((b: FakeLayer) => b.options.icon.iconSize[0])).toEqual([32, 32, 36, 36]);
      expect(badges.map((b: FakeLayer) => b.options.icon.html.match(/>([^<]+)</)?.[1])).toEqual([
        '5',
        '99',
        '99+',
        '99+',
      ]);
    });

    it('hides every non-candidate safety marker kind while routeLayers is set', () => {
      const h = loadRouteMap();
      const kinds = ['crime', 'light', 'cctv', 'shop', 'bus_stop', 'dead_end', 'via'];
      h.updateMap(
        basePayload({
          routeLayers: builtSpec,
          safetyMarkers: kinds.map((kind, i) => ({ id: `${kind}-${i}`, kind, lat: 51.51, lng: -0.12, label: kind })),
        }),
      );

      expect(h.groups.markers.layers).toHaveLength(0);
    });

    it('hides lights below zoom 17 and shows them at zoom 17', () => {
      const h = loadRouteMap({ zoom: 16 });
      const spec = makeSpec({ points: [{ kind: 'light', lat: 51.506, lng: -0.124 }] });

      h.updateMap(basePayload({ routeLayers: spec }));
      expect(circles(h.groups.points)).toHaveLength(0);

      h.setZoom(17);
      h.updateMap(basePayload({ routeLayers: spec }));
      const lights = circles(h.groups.points);
      expect(lights).toHaveLength(1);
      expect(lights[0].options).toMatchObject({ radius: 5, fillColor: '#facc15' });
    });

    it('re-filters light points on zoomend without a new payload', () => {
      const h = loadRouteMap({ zoom: 17 });
      h.updateMap(basePayload({ routeLayers: makeSpec({ points: [{ kind: 'light', lat: 51.506, lng: -0.124 }] }) }));
      expect(circles(h.groups.points)).toHaveLength(1);

      h.setZoom(16);
      h.fireZoomEnd();
      expect(circles(h.groups.points)).toHaveLength(0);

      h.setZoom(17);
      h.fireZoomEnd();
      expect(circles(h.groups.points)).toHaveLength(1);
    });

    it('shows lights at zoom 16 when highlighted, larger than unhighlighted points', () => {
      const h = loadRouteMap({ zoom: 16 });
      h.updateMap(
        basePayload({
          routeLayers: makeSpec({ points: [{ kind: 'light', lat: 51.506, lng: -0.124 }] }),
          highlightCategory: 'light',
        }),
      );

      const lights = circles(h.groups.points);
      expect(lights).toHaveLength(1);
      expect(lights[0].options.radius).toBe(7);
    });

    it('shows cctv and shop points only when that category is highlighted', () => {
      const h = loadRouteMap({ zoom: 18 });
      const points = [
        { kind: 'cctv' as const, lat: 51.508, lng: -0.123 },
        { kind: 'shop' as const, lat: 51.509, lng: -0.121 },
      ];

      h.updateMap(basePayload({ routeLayers: makeSpec({ points }) }));
      expect(circles(h.groups.points)).toHaveLength(0);

      h.updateMap(basePayload({ routeLayers: makeSpec({ points }), highlightCategory: 'cctv' }));
      const shown = circles(h.groups.points);
      expect(shown).toHaveLength(1);
      expect(shown[0].options).toMatchObject({ radius: 7, fillColor: '#8b5cf6' });
    });

    it('keeps candidate search pins drawn (non-route UI is untouched)', () => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          routeLayers: builtSpec,
          safetyMarkers: [
            {
              id: 'search-candidate:1',
              kind: 'place',
              lat: 51.512,
              lng: -0.118,
              label: 'Cafe',
              pinColor: '#ef4444',
              isSelected: false,
            },
          ],
        }),
      );

      const pins = h.groups.markers.layers.filter((l: FakeLayer) => String(l.options.icon?.html).includes('search-pin-wrap'));
      expect(pins).toHaveLength(1);
    });

    it('tolerates malformed layer fields without throwing', () => {
      const h = loadRouteMap();
      expect(() =>
        h.updateMap(
          basePayload({
            routeLayers: { lines: 'nope', callouts: null, crimeClusters: 5, points: {} },
          }),
        ),
      ).not.toThrow();

      const blue = polylines(h.groups.routes).filter((l) => l.options.color === '#4285F4');
      expect(blue).toHaveLength(1);
    });

    it('treats an absent routeLayers key as legacy (no hit lines, no overlays)', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload());

      expect(polylines(h.groups.routes).some((l) => l.options.weight === 44)).toBe(false);
      expect(h.groups.overlay.layers).toHaveLength(0);
    });
  });

  describe('legend chip', () => {
    it('is visible with a gradient from RISK_RAMP and the Safer/Riskier/Estimated lighting labels when a route is selected', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec }));

      const legend = h.getLegend();
      expect(legend.style.display).toBe('');
      const body = legend.querySelector('.rl-legend-body').innerHTML;
      RISK_RAMP.forEach((colour) => expect(body).toContain(colour));
      expect(body).toContain('Safer');
      expect(body).toContain('Riskier');
      expect(body).toContain(builtSpec.legend.dashedLabel);
    });

    it('draws six discrete swatches in a row (Safer left, Riskier right) instead of a gradient', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec }));

      const body = h.getLegend().querySelector('.rl-legend-body');
      const swatches = body.querySelectorAll('.rl-legend-swatch');
      expect(swatches.map((s: any) => s.style.background)).toEqual([...RISK_RAMP]);
      expect(body.innerHTML).not.toContain('gradient');
      const labels = body.querySelector('.rl-legend-scale').children.map((c: any) => c.textContent);
      expect(labels).toEqual(['Safer', 'Riskier']);
    });

    it('gives the legend region, toggle and body the same accessibility wiring as native', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec }));

      const legend = h.getLegend();
      expect(legend.getAttribute('role')).toBe('region');
      expect(legend.getAttribute('aria-label')).toBe('Route safety legend');
      const head = legend.querySelector('.rl-legend-head');
      const body = legend.querySelector('.rl-legend-body');
      expect(head.getAttribute('aria-controls')).toBe(body.id);
      expect(head.getAttribute('aria-expanded')).toBe('false');
    });

    it('reads the ramp colours from legend.ramp in the spec, not from a constant', () => {
      const h = loadRouteMap();
      const legend = {
        ramp: ['#010203', '#040506', '#070809', '#0a0b0c', '#0d0e0f', '#101112'].map((color, i) => ({
          from: i / 6,
          to: (i + 1) / 6,
          color,
        })),
        dashedLabel: 'Estimated lighting',
      };
      h.updateMap(basePayload({ routeLayers: makeSpec({ legend }) }));

      const body = h.getLegend().querySelector('.rl-legend-body').innerHTML;
      legend.ramp.forEach((s) => expect(body).toContain(s.color));
      RISK_RAMP.forEach((colour) => expect(body).not.toContain(colour));
    });

    it('drops ramp entries whose colour is not a six-digit hex value', () => {
      const h = loadRouteMap();
      const legend = {
        ramp: [{ from: 0, to: 1, color: '"><img src=x onerror=1>' }, { from: 0, to: 1, color: '#abcdef' }],
        dashedLabel: 'Estimated lighting',
      };
      h.updateMap(basePayload({ routeLayers: makeSpec({ legend }) }));

      const body = h.getLegend().querySelector('.rl-legend-body').innerHTML;
      expect(body).not.toContain('<img');
      expect(body).toContain('#abcdef');
    });

    it('uses legend.dashedLabel for the dashed swatch text, falling back to "Estimated lighting"', () => {
      const custom = loadRouteMap();
      custom.updateMap(
        basePayload({ routeLayers: makeSpec({ legend: { ...EMPTY_SPEC.legend, dashedLabel: 'Dotted means guessed' } }) }),
      );
      expect(custom.getLegend().querySelector('.rl-legend-body').innerHTML).toContain('Dotted means guessed');

      const fallback = loadRouteMap();
      fallback.updateMap(basePayload({ routeLayers: makeSpec({ legend: {} as RouteLayerSpec['legend'] }) }));
      expect(fallback.getLegend().querySelector('.rl-legend-body').innerHTML).toContain('Estimated lighting');
    });

    it('draws the dashed swatch with exactly the same dash pattern as the dashed route line', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec }));

      const dashed = polylines(h.groups.routes).filter((l) => l.options.weight === 7 && l.options.dashArray);
      expect(dashed).toHaveLength(1);
      const swatch = h.getLegend().querySelector('.rl-legend-body').innerHTML;
      expect(swatch.match(/stroke-dasharray="([^"]+)"/)?.[1]).toBe(dashed[0].options.dashArray);
      expect(swatch).toContain('stroke-linecap="round"');
    });

    it('renders legend.notes as extra lines and escapes them', () => {
      const h = loadRouteMap();
      const legend = {
        ramp: [],
        dashedLabel: 'Estimated lighting',
        notes: ['Crime data unavailable', '<b>x</b>'],
      } as unknown as RouteLayerSpec['legend'];
      h.updateMap(basePayload({ routeLayers: makeSpec({ legend }) }));

      const notes = h.getLegend().querySelector('.rl-legend-notes').innerHTML;
      expect(notes).toContain('Crime data unavailable');
      expect(notes).not.toContain('<b>');
      expect(notes).toContain('&lt;b&gt;x&lt;/b&gt;');
      expect(h.getLegend().querySelector('.rl-legend-body').innerHTML).not.toContain('Crime data unavailable');
    });

    it('is collapsed by default at every width', () => {
      for (const innerWidth of [390, 400, 420]) {
        const h = loadRouteMap({ innerWidth });
        h.updateMap(basePayload({ routeLayers: builtSpec }));
        expect(h.getLegend().className).toContain('rl-legend-collapsed');
      }
    });

    it('opens from the header button, and the header reports the state', () => {
      const h = loadRouteMap({ innerWidth: 400 });
      h.updateMap(basePayload({ routeLayers: builtSpec }));
      const head = h.getLegend().querySelector('.rl-legend-head');
      expect(head.getAttribute('aria-expanded')).toBe('false');
      head.listeners.click[0]({ stopPropagation: () => undefined });
      expect(h.getLegend().className).not.toContain('rl-legend-collapsed');
      expect(head.getAttribute('aria-expanded')).toBe('true');
    });

    it('is hidden when no route is selected', () => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          routeLayers: builtSpec,
          routes: [{ id: 'a', selected: false, path: ROUTE_A }],
        }),
      );

      expect(h.getLegend().style.display).toBe('none');
    });

    it('expands on tap and remembers the state across updates', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec }));

      const legend = h.getLegend();
      const head = legend.querySelector('.rl-legend-head');
      expect(legend.className).toContain('rl-legend-collapsed');

      head.listeners.click[0]({ stopPropagation: () => undefined });
      expect(legend.className).not.toContain('rl-legend-collapsed');

      h.updateMap(basePayload({ routeLayers: builtSpec }));
      expect(h.getLegend().className).not.toContain('rl-legend-collapsed');

      head.listeners.click[0]({ stopPropagation: () => undefined });
      expect(h.getLegend().className).toContain('rl-legend-collapsed');
    });

    it('uses CSS sizes of at least 12px for legend text and 13px for callouts', () => {
      const html = buildLeafletHtml(false);
      const size = (selector: string) => {
        const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*?font(?:-size)?:\\s*(?:\\d+\\s+)?(\\d+)px`);
        return Number(html.match(re)?.[1]);
      };
      expect(size('.rl-legend')).toBeGreaterThanOrEqual(12);
      expect(size('.rl-legend-note')).toBeGreaterThanOrEqual(12);
      expect(size('.rl-callout')).toBeGreaterThanOrEqual(13);
      expect(size('.rl-crime')).toBeGreaterThanOrEqual(13);
      expect(size('.rl-pill')).toBeGreaterThanOrEqual(13);
    });

    it('styles the callout as a glass 600-weight pill placed 10px above its anchor', () => {
      const html = buildLeafletHtml(false);
      const rule = html.match(/\.rl-callout\s*\{([^}]*)\}/)?.[1] ?? '';
      expect(rule).toMatch(/background:rgba\(255,255,255,\.7\)/);
      expect(rule).toMatch(/font:600 13px/);
      expect(rule).toMatch(/border-radius:999px/);
      const placement = html.match(/\.rl-callout-icon \.rl-callout\s*\{([^}]*)\}/)?.[1] ?? '';
      expect(placement).toMatch(/translate\(-50%,calc\(-100% - 10px\)\)/);
    });

    it('draws crime badges and score pills in bold 13px type', () => {
      const html = buildLeafletHtml(false);
      expect(html).toMatch(/\.rl-crime\s*\{[^}]*font:700 13px/);
      expect(html).toMatch(/\.rl-pill\s*\{[^}]*font:700 13px/);
    });
  });

  describe('escaping untrusted strings reaching innerHTML', () => {
    const PAYLOADS = ['<u>x</u>', '"><img src=x onerror=1>'];

    it.each(PAYLOADS)('escapes friend names (%s) in the friend chip', (name) => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          friendMarkers: [{ name, lat: 51.51, lng: -0.12, path: [], routePath: [] }],
        }),
      );

      const chip = h.groups.friends.layers[0].options.icon.html as string;
      expect(chip).not.toContain('<u>');
      expect(chip).not.toContain('<img');
      expect(chip).toContain('&lt;');
    });

    it.each(PAYLOADS)('escapes road label names (%s)', (name) => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          showExtraDetail: true,
          routes: routesFixture(),
          roadLabels: [{ name, color: '#111827', lat: 51.51, lng: -0.12 }],
        }),
      );

      const label = h.groups.labels.layers[0].options.icon.html as string;
      expect(label).not.toContain('<u>');
      expect(label).not.toContain('<img');
    });

    it('replaces a road label colour that is not a six-digit hex value with the default', () => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          showExtraDetail: true,
          roadLabels: [{ name: 'A1', color: '"><img src=x onerror=1>', lat: 51.51, lng: -0.12 }],
        }),
      );

      const label = h.groups.labels.layers[0].options.icon.html as string;
      expect(label).not.toContain('<img');
      expect(label).toContain('background:#111827');
    });

    it('keeps a valid six-digit road label colour', () => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          showExtraDetail: true,
          roadLabels: [{ name: 'A1', color: '#ff0000', lat: 51.51, lng: -0.12 }],
        }),
      );

      expect(h.groups.labels.layers[0].options.icon.html).toContain('background:#ff0000');
    });
  });

  describe('routeBadges', () => {
    const badges = () => [
      { routeId: 'a', lat: 51.51, lng: -0.12, text: '62', selected: false },
      { routeId: 'b', lat: 51.52, lng: -0.11, text: '88', selected: true },
    ];

    it('draws one score pill per badge when routeLayers is set, styling the selected one differently', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec, routeBadges: badges() }));

      const pills = h.groups.overlay.layers.filter((l: FakeLayer) => String(l.options.icon?.html).includes('rl-pill-hit'));
      expect(pills).toHaveLength(2);
      expect(pills[0].latlngs).toEqual([51.51, -0.12]);
      expect(pills[0].options.icon.html).toContain('>62<');
      expect(pills[0].options.icon.html).not.toContain('rl-pill-sel');
      expect(pills[1].options.icon.html).toContain('rl-pill-sel');
      expect(pills[1].options.icon.html).toContain('>88<');
    });

    it('wraps each pill in an accessible hit area with the same labels as native', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec, routeBadges: badges() }));

      const pills = h.groups.overlay.layers.filter((l: FakeLayer) => String(l.options.icon?.html).includes('rl-pill-hit'));
      expect(iconHtml(pills[0])).toContain('role="button"');
      expect(iconHtml(pills[0])).toContain('aria-label="Route 1 score 62, tap to select"');
      expect(iconHtml(pills[1])).not.toContain('role="button"');
      expect(iconHtml(pills[1])).toContain('aria-label="Route 2 score 88, selected"');
      const html = buildLeafletHtml(false);
      expect(html).toMatch(/\.rl-pill-hit\s*\{[^}]*min-width:44px;min-height:44px/);
      expect(html).toMatch(/\.rl-pill\s*\{[^}]*min-width:32px;height:28px/);
    });

    it('tapping a non-selected badge posts selectRoute for its route, and the selected badge does nothing', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec, routeBadges: badges() }));

      const pills = h.groups.overlay.layers.filter((l: FakeLayer) => String(l.options.icon?.html).includes('rl-pill-hit'));
      (h.postMessage as jest.Mock).mockClear();

      expect(typeof pills[0].handlers.click).toBe('function');
      pills[0].handlers.click();
      expect(h.postMessage).toHaveBeenCalledTimes(1);
      expect(JSON.parse((h.postMessage as jest.Mock).mock.calls[0][0])).toEqual({ type: 'selectRoute', id: 'a' });

      expect(pills[1].handlers.click).toBeUndefined();
    });

    it('draws no badges on the legacy path (routeLayers absent)', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeBadges: badges() }));

      expect(h.groups.overlay.layers).toHaveLength(0);
    });

    it('escapes badge text', () => {
      const h = loadRouteMap();
      h.updateMap(
        basePayload({
          routeLayers: builtSpec,
          routeBadges: [{ routeId: 'a', lat: 51.51, lng: -0.12, text: '<u>x</u>', selected: false }],
        }),
      );

      const pill = h.groups.overlay.layers.find((l: FakeLayer) => String(l.options.icon?.html).includes('rl-pill-hit'));
      expect(pill.options.icon.html).not.toContain('<u>');
    });
  });

  describe('updateMap concerns (split into functions)', () => {
    it('draws endpoints, selected pins, friends, the range ring and fits bounds without throwing', () => {
      const h = loadRouteMap();
      expect(() =>
        h.updateMap(
          basePayload({
            origin: pt(51.5, -0.13),
            destination: pt(51.515, -0.115),
            maxDistanceKm: 2,
            fitBounds: true,
            friendMarkers: [{ name: 'Sam', lat: 51.51, lng: -0.12, path: ROUTE_A, routePath: ROUTE_A }],
            safetyMarkers: [
              { id: 'search-candidate:1', kind: 'place', lat: 51.512, lng: -0.118, label: 'Cafe', pinColor: '#ef4444', isSelected: true },
              { id: 'crime-1', kind: 'crime', lat: 51.51, lng: -0.12, label: 'Crime' },
            ],
          }),
        ),
      ).not.toThrow();
      expect(circles(h.groups.markers).length).toBeGreaterThanOrEqual(3);
      expect(h.groups.friends.layers.length).toBeGreaterThan(0);
    });
  });

  describe('postMessage target origin', () => {
    it('posts to the parent origin instead of "*" (srcDoc iframe inherits the parent origin)', () => {
      const h = loadRouteMap({ parentOrigin: 'http://localhost:8084' });
      expect(h.postMessage).toHaveBeenCalledWith('{"type":"ready"}', 'http://localhost:8084');
    });

    it.each([
      ['a cross-origin parent (location throws)', 'throw'],
      ['an opaque parent origin', 'null'],
    ])('falls back to "*" for %s', (_label, parentOrigin) => {
      const h = loadRouteMap({ parentOrigin: parentOrigin as string });
      expect(h.postMessage).toHaveBeenCalledWith('{"type":"ready"}', '*');
    });
  });

  describe('React side wiring', () => {
    const source = readFileSync(join(__dirname, '../../../src/components/maps/RouteMap.web.tsx'), 'utf8');

    it('accepts routeLayers as a prop with a null default', () => {
      expect(source).toMatch(/routeLayers\s*=\s*null/);
    });

    it('includes routeLayers in the pushUpdate payload with a null fallback', () => {
      expect(source).toMatch(/routeLayers:\s*p\.routeLayers\s*\?\?\s*null/);
    });

    it('re-pushes when routeLayers changes', () => {
      const deps = source.slice(source.indexOf('// Push when props change'));
      expect(deps.slice(0, deps.indexOf('pushUpdate,\n  ]'))).toMatch(/\brouteLayers,/);
    });

    it('includes routeBadges in the pushUpdate payload with an empty-array fallback', () => {
      expect(source).toMatch(/routeBadges:\s*\(p\.routeBadges \?\? \[\]\)/);
    });

    it('re-pushes when routeBadges changes', () => {
      const deps = source.slice(source.indexOf('// Push when props change'));
      expect(deps.slice(0, deps.indexOf('pushUpdate,\n  ]'))).toMatch(/\brouteBadges,/);
    });
  });
});


// ── FX3: screen-space merging, pill separation, legend and parity ────────────────

describe('RouteMap.web screen-space badge layout', () => {
  const perDeg = (zoom: number) => (256 * 2 ** zoom) / 360;
  const crimeBadges = (h: Harness): FakeLayer[] =>
    h.groups.overlay.layers.filter((l: FakeLayer) => l.options.icon?.className === 'rl-crime-icon');
  const pillMarkers = (h: Harness): FakeLayer[] =>
    h.groups.overlay.layers.filter((l: FakeLayer) => String(l.options.icon?.html).includes('rl-pill-hit'));
  const labelOf = (l: FakeLayer) => iconHtml(l).match(/>([^<]+)</)?.[1];
  const cluster = (lat: number, lng: number, count: number, maxSeverity = 0.5) => ({ lat, lng, count, maxSeverity });
  const draw = (h: Harness, clusters: ReturnType<typeof cluster>[], badges: unknown[] = [], over = {}) =>
    h.updateMap(basePayload({ routeLayers: makeSpec({ crimeClusters: clusters }), routeBadges: badges, ...over }));
  const relayout = (h: Harness, ev: 'zoomend' | 'moveend' = 'zoomend') => {
    h.fireMapEvent(ev);
    h.flushRelayout();
  };

  describe('crime badges', () => {
    it('merges badges that overlap on screen into one badge with the summed count', () => {
      const h = loadRouteMap({ zoom: 16 });
      draw(h, [cluster(51.5, -0.1, 5), cluster(51.5001, -0.1, 3), cluster(51.5, -0.1001, 2)]);

      const badges = crimeBadges(h);
      expect(badges).toHaveLength(1);
      expect(labelOf(badges[0])).toBe('10');
      expect(iconHtml(badges[0])).toContain('aria-label="10 crimes reported"');
      // Count-weighted position: nearer to the biggest cluster than the plain mean.
      const [lat, lng] = badges[0].latlngs as [number, number];
      expect(lat).toBeCloseTo((51.5 * 5 + 51.5001 * 3 + 51.5 * 2) / 10, 8);
      expect(lng).toBeCloseTo((-0.1 * 5 + -0.1 * 3 + -0.1001 * 2) / 10, 8);
    });

    it('keeps badges that are far apart on screen as separate badges', () => {
      const h = loadRouteMap({ zoom: 16 });
      draw(h, [cluster(51.5, -0.1, 5), cluster(51.51, -0.1, 3), cluster(51.52, -0.1, 2)]);
      expect(crimeBadges(h).map(labelOf)).toEqual(['5', '3', '2']);
    });

    it('caps the merged label at 99+ and switches to the large badge', () => {
      const h = loadRouteMap({ zoom: 16 });
      draw(h, [cluster(51.5, -0.1, 60), cluster(51.5, -0.1001, 60)]);
      const badges = crimeBadges(h);
      expect(badges).toHaveLength(1);
      expect(labelOf(badges[0])).toBe('99+');
      expect(badges[0].options.icon.iconSize).toEqual([36, 36]);
      expect(iconHtml(badges[0])).toContain('aria-label="120 crimes reported"');
    });

    it('at city zoom turns a dozen crowded badges into badges whose centres are at least 44px apart', () => {
      const h = loadRouteMap({ zoom: 14 });
      const crowded = Array.from({ length: 12 }, (_, i) => cluster(51.5 + i * 0.001, -0.1 + (i % 2) * 0.0005, i + 1));
      draw(h, crowded);

      const badges = crimeBadges(h);
      expect(badges.length).toBeGreaterThan(0);
      expect(badges.length).toBeLessThan(12);
      const px = badges.map((b) => ({ x: (b.latlngs as number[])[1] * perDeg(14), y: -(b.latlngs as number[])[0] * perDeg(14) }));
      for (let i = 0; i < px.length; i++) {
        for (let j = i + 1; j < px.length; j++) {
          expect(Math.hypot(px[i].x - px[j].x, px[i].y - px[j].y)).toBeGreaterThanOrEqual(44);
        }
      }
      const total = badges.map((b) => iconHtml(b).match(/aria-label="(\d+) /)?.[1]).reduce((sum, n) => sum + Number(n), 0);
      expect(total).toBe(crowded.reduce((sum, c) => sum + c.count, 0));
    });

    it('never draws more badges than clusters (the 12-cluster builder cap is preserved)', () => {
      const h = loadRouteMap({ zoom: 18 });
      draw(h, Array.from({ length: 12 }, (_, i) => cluster(51.5 + i * 0.01, -0.1, 1)));
      expect(crimeBadges(h)).toHaveLength(12);
    });

    it('re-merges when the map zooms out and splits again when it zooms in, after the debounce', () => {
      const h = loadRouteMap({ zoom: 17 });
      draw(h, [cluster(51.5, -0.1, 4), cluster(51.501, -0.1, 3)]);
      expect(crimeBadges(h).map(labelOf)).toEqual(['4', '3']);

      h.setZoom(14);
      h.fireZoomEnd();
      expect(crimeBadges(h)).toHaveLength(2); // nothing happens until the debounce fires
      h.flushRelayout();
      expect(crimeBadges(h).map(labelOf)).toEqual(['7']);

      h.setZoom(17);
      relayout(h, 'moveend');
      expect(crimeBadges(h).map(labelOf)).toEqual(['4', '3']);
    });

    it('debounces: a burst of zoomend and moveend events schedules a single relayout', () => {
      const h = loadRouteMap({ zoom: 17 });
      draw(h, [cluster(51.5, -0.1, 4)]);
      h.fireZoomEnd();
      h.fireZoomEnd();
      h.fireMapEvent('moveend');
      h.fireMapEvent('moveend');
      expect(h.pendingRelayouts()).toBe(1);
    });

    it('leaves the badges alone when a move ends without a zoom change', () => {
      const h = loadRouteMap({ zoom: 17 });
      draw(h, [cluster(51.5, -0.1, 4), cluster(51.51, -0.1, 3)]);
      const before = crimeBadges(h);
      relayout(h, 'moveend');
      expect(crimeBadges(h)).toEqual(before);
      expect(crimeBadges(h)[0]).toBe(before[0]);
    });

    it('does not bring crime badges back when no route is selected', () => {
      const h = loadRouteMap({ zoom: 17 });
      draw(h, [cluster(51.5, -0.1, 4)], [], { routes: [{ id: 'a', selected: false, path: ROUTE_A }] });
      expect(crimeBadges(h)).toHaveLength(0);
      h.setZoom(15);
      relayout(h);
      expect(crimeBadges(h)).toHaveLength(0);
    });

    it('keeps the worst-stretch callout through a relayout', () => {
      const h = loadRouteMap({ zoom: 17 });
      h.updateMap(
        basePayload({
          routeLayers: makeSpec({
            callouts: [{ lat: 51.5, lng: -0.1, text: 'Unlit stretch', kind: 'worst-stretch' }],
            crimeClusters: [cluster(51.5, -0.1, 4)],
          }),
        }),
      );
      h.setZoom(15);
      relayout(h);
      const callouts = h.groups.overlay.layers.filter((l: FakeLayer) => l.options.icon?.className === 'rl-callout-icon');
      expect(callouts).toHaveLength(1);
    });

    it('draws every cluster unmerged when the map cannot project (no exception)', () => {
      const h = loadRouteMap({ zoom: 16, project: null });
      draw(h, [cluster(51.5, -0.1, 5), cluster(51.5001, -0.1, 3)]);
      expect(crimeBadges(h).map(labelOf)).toEqual(['5', '3']);
    });
  });

  describe('score pills', () => {
    const badge = (routeId: string, lat: number, lng: number, text: string, selected = false) => ({
      routeId,
      lat,
      lng,
      text,
      selected,
    });
    const topOf = (l: FakeLayer) => iconHtml(l).match(/style="top:(-?\d+(?:\.\d+)?)px"/)?.[1];

    it('moves the later of two pills whose centres coincide down by 44px so the touch targets do not overlap', () => {
      const h = loadRouteMap({ zoom: 16 });
      draw(h, [], [badge('a', 51.5, -0.1, '62'), badge('b', 51.5, -0.1, '48')]);
      const pills = pillMarkers(h);
      expect(pills).toHaveLength(2);
      expect(topOf(pills[0])).toBeUndefined();
      expect(topOf(pills[1])).toBe('44');
    });

    it('leaves pills that are already 44px or more apart where they are', () => {
      const h = loadRouteMap({ zoom: 16 });
      draw(h, [], [badge('a', 51.5, -0.1, '62'), badge('b', 51.51, -0.1, '48', true)]);
      pillMarkers(h).forEach((p) => expect(topOf(p)).toBeUndefined());
    });

    it('moves the later pill up when it sits above the earlier one', () => {
      const h = loadRouteMap({ zoom: 16 });
      draw(h, [], [badge('a', 51.5, -0.1, '62'), badge('b', 51.50005, -0.1, '48')]);
      expect(Number(topOf(pillMarkers(h)[1]))).toBeLessThan(0);
    });

    it('separates again after a zoom change and keeps taps selecting the route', () => {
      const h = loadRouteMap({ zoom: 17 });
      draw(h, [], [badge('a', 51.5, -0.1, '62'), badge('b', 51.501, -0.1, '48', true)]);
      pillMarkers(h).forEach((p) => expect(topOf(p)).toBeUndefined());

      h.setZoom(14);
      relayout(h);
      const pills = pillMarkers(h);
      expect(pills).toHaveLength(2);
      // The selected pill (second, further north) stays; the first one moves down, at most 44px.
      expect(topOf(pills[1])).toBeUndefined();
      const shift = Number(topOf(pills[0]));
      expect(shift).toBeGreaterThan(0);
      expect(shift).toBeLessThanOrEqual(44);
      // On screen the pills are 0.001deg apart (about 11.7px at zoom 14); after the shift they are 44px apart.
      expect(0.001 * perDeg(14) + shift).toBeGreaterThanOrEqual(44);

      (h.postMessage as jest.Mock).mockClear();
      pills[0].handlers.click();
      expect(JSON.parse((h.postMessage as jest.Mock).mock.calls[0][0])).toEqual({ type: 'selectRoute', id: 'a' });
      expect(pills[1].handlers.click).toBeUndefined();
    });

    it('moves a selected pill off a merged crime badge it would cover, the badge staying put', () => {
      const h = loadRouteMap({ zoom: 16 });
      // Badge 3.6px above the pill centre (46 crimes, merged from two clusters).
      const badgeLat = 51.5 + 3.6 / perDeg(16);
      draw(h, [cluster(badgeLat, -0.1, 30), cluster(badgeLat, -0.1, 16)], [badge('a', 51.5, -0.1, '78', true)]);
      const [crime] = crimeBadges(h);
      expect(labelOf(crime)).toBe('46');
      expect((crime.latlngs as number[])[0]).toBeCloseTo(badgeLat, 9);
      const shift = Number(topOf(pillMarkers(h)[0]));
      expect(Math.abs(shift)).toBeLessThanOrEqual(44);
      // Pill centre vs badge centre (same x): the 44px touch square (half 22) must clear the 16px radius.
      const badgeY = -badgeLat * perDeg(16);
      const pillY = -51.5 * perDeg(16) + shift;
      expect(Math.abs(pillY - badgeY)).toBeGreaterThanOrEqual(22 + 16 - 1e-6);
    });

    it('keeps the selected pill in place and moves the other one when they coincide', () => {
      const h = loadRouteMap({ zoom: 16 });
      draw(h, [], [badge('a', 51.5, -0.1, '62'), badge('b', 51.5, -0.1, '48', true)]);
      const pills = pillMarkers(h);
      expect(Math.abs(Number(topOf(pills[0])))).toBe(44);
      expect(topOf(pills[1])).toBeUndefined();
    });

    it('keeps the pill markers at their geographic position (only the element is shifted)', () => {
      const h = loadRouteMap({ zoom: 16 });
      draw(h, [], [badge('a', 51.5, -0.1, '62'), badge('b', 51.5, -0.1, '48')]);
      expect(pillMarkers(h).map((p) => p.latlngs)).toEqual([
        [51.5, -0.1],
        [51.5, -0.1],
      ]);
    });
  });
});

describe('RouteMap.web legend placement and notes', () => {
  const legendWith = (notes: string[]) =>
    ({ ...EMPTY_SPEC.legend, ramp: builtSpec.legend.ramp, notes }) as unknown as RouteLayerSpec['legend'];

  it('shows a caveat dot on the collapsed legend and opens the note with it', () => {
    const h = loadRouteMap({ innerWidth: 390 });
    h.updateMap(basePayload({ routeLayers: makeSpec({ legend: legendWith(['Crime data unavailable']) }) }));

    const legend = h.getLegend();
    expect(legend.className).toContain('rl-legend-has-notes');
    legend.querySelector('.rl-legend-head').listeners.click[0]({ stopPropagation: () => undefined });
    const holder = legend.querySelector('.rl-legend-notes');
    expect(holder.style.display).not.toBe('none');
    expect(holder.querySelector('.rl-legend-note').textContent).toBe('Crime data unavailable');
  });

  it('keeps the caveat dot after the user collapses the legend', () => {
    const h = loadRouteMap({ innerWidth: 420 });
    h.updateMap(basePayload({ routeLayers: makeSpec({ legend: legendWith(['Crime data unavailable']) }) }));
    const legend = h.getLegend();
    const head = legend.querySelector('.rl-legend-head');
    head.listeners.click[0]({ stopPropagation: () => undefined });
    head.listeners.click[0]({ stopPropagation: () => undefined });
    expect(legend.className).toContain('rl-legend-collapsed');
    expect(legend.className).toContain('rl-legend-has-notes');
  });

  it('lifts the legend so its bottom margin clears the attribution box by at least 4px', () => {
    const html = buildLeafletHtml(false);
    const margin = Number(html.match(/\.leaflet-bottom \.leaflet-control\.rl-legend\s*\{[^}]*margin-bottom:(\d+)px/)?.[1]);
    expect(RL_LEGEND_ATTRIBUTION_GAP_PX).toBeGreaterThanOrEqual(4);
    expect(margin).toBeGreaterThanOrEqual(RL_ATTRIBUTION_HEIGHT_PX + 4);
  });
});

describe('RouteMap.web parity constants', () => {
  it('draws the coloured selected-route lines with the shared line opacity', () => {
    const h = loadRouteMap();
    h.updateMap(basePayload({ routeLayers: builtSpec }));
    const coloured = polylines(h.groups.routes).filter((l) => l.options.weight === 7);
    expect(coloured.length).toBeGreaterThan(0);
    coloured.forEach((l) => expect(l.options.opacity).toBe(RL_LINE_OPACITY));
  });

  it('draws dashed lines with the shared dash string', () => {
    const h = loadRouteMap();
    h.updateMap(basePayload({ routeLayers: builtSpec }));
    const dashed = polylines(h.groups.routes).filter((l) => l.options.dashArray);
    expect(dashed.length).toBeGreaterThan(0);
    dashed.forEach((l) => expect(l.options.dashArray).toBe(RL_DASH));
  });

  it('credits OpenStreetMap through the shared constant, whose text native reuses', () => {
    const h = loadRouteMap();
    expect(h.tileOptions).toHaveLength(1);
    expect(h.tileOptions[0].attribution).toBe(OSM_ATTRIBUTION);
    expect(OSM_ATTRIBUTION).toBe('© OpenStreetMap contributors');
    expect(NATIVE_MAP_ATTRIBUTION.endsWith(OSM_ATTRIBUTION)).toBe(true);
  });
});
