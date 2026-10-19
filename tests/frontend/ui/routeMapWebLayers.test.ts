import { readFileSync } from 'fs';
import { join } from 'path';

import { buildLeafletHtml } from '@/src/components/maps/RouteMap.web';
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

const makeEl = (): any => {
  const cache: Record<string, any> = {};
  const listeners: Record<string, (ev?: any) => void> = {};
  return {
    style: {},
    className: '',
    innerHTML: '',
    listeners,
    classList: { add: () => undefined, remove: () => undefined, toggle: () => undefined },
    setAttribute: () => undefined,
    addEventListener: (ev: string, fn: (ev?: any) => void) => {
      listeners[ev] = fn;
    },
    querySelector: (sel: string) => {
      if (!cache[sel]) cache[sel] = makeEl();
      return cache[sel];
    },
  };
};

const SCRIPT_RE = /<script>([\s\S]*?)<\/script>/;

type HarnessOptions = {
  zoom?: number;
  parentOrigin?: string | 'throw';
};

function loadRouteMap(opts: HarnessOptions = {}) {
  const match = buildLeafletHtml(false).match(SCRIPT_RE);
  if (!match) throw new Error('inline map script not found in buildLeafletHtml output');

  const state = { zoom: opts.zoom ?? 16 };
  const zoomEndHandlers: Array<() => void> = [];
  const fakeMap: any = {
    on: (ev: string, fn: () => void) => {
      if (ev === 'zoomend') zoomEndHandlers.push(fn);
      return fakeMap;
    },
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
    innerWidth: 400,
    innerHeight: 800,
    addEventListener: () => undefined,
    dispatchEvent: () => true,
    parent: { postMessage, location: parentLocation },
  };

  const doc: any = {
    body: makeEl(),
    createElement: () => makeEl(),
    getElementById: () => makeEl(),
  };

  const L: any = {
    map: () => fakeMap,
    tileLayer: () => ({ addTo: () => undefined }),
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
    points: typeof routePointsLayer !== 'undefined' ? routePointsLayer : null
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
    () => 0,
    () => undefined,
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
    fireZoomEnd: () => zoomEndHandlers.forEach((fn) => fn()),
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
      expect(lines.some((l) => l.options.weight === 22)).toBe(false);
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
      expect(coloured[1].options.dashArray).toBe('1 10');

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

    it('gives unselected routes a thin grey line plus an invisible wide hit line that selects the route', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec }));

      const lines = polylines(h.groups.routes);
      const grey = lines.filter((l) => l.options.color === '#98a2b3' && l.options.weight === 4);
      expect(grey).toHaveLength(1);
      expect(grey[0].options).toMatchObject({ weight: 4, opacity: 0.55 });

      const hit = lines.filter((l) => l.options.weight === 22);
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
        expect(b.options.icon.iconSize[0]).toBeGreaterThanOrEqual(26);
        expect(b.options.icon.html).toMatch(/rl-crime[^>]*>\d+</);
      });
      const countOf = (html: string) => Number(html.match(/>(\d+)</)?.[1]);
      expect(badges.map((b: FakeLayer) => countOf(b.options.icon.html))).toEqual(
        builtSpec.crimeClusters.map((c) => c.count),
      );
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

      expect(polylines(h.groups.routes).some((l) => l.options.weight === 22)).toBe(false);
      expect(h.groups.overlay.layers).toHaveLength(0);
    });
  });

  describe('legend chip', () => {
    it('is visible with a gradient from RISK_RAMP and the Safer/Riskier/Estimated lighting labels when a route is selected', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec }));

      const legend = h.getLegend();
      expect(legend.style.display).toBe('');
      RISK_RAMP.forEach((colour) => expect(legend.innerHTML).toContain(colour));
      expect(legend.innerHTML).toContain('Safer');
      expect(legend.innerHTML).toContain('Riskier');
      expect(legend.innerHTML).toContain('Estimated lighting');
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

    it('starts expanded and remembers collapse across updates', () => {
      const h = loadRouteMap();
      h.updateMap(basePayload({ routeLayers: builtSpec }));

      const legend = h.getLegend();
      const body = legend.querySelector('.rl-legend-body');
      const head = legend.querySelector('.rl-legend-head');
      expect(body.style.display).toBe('');

      head.listeners.click({ stopPropagation: () => undefined });
      expect(body.style.display).toBe('none');

      h.updateMap(basePayload({ routeLayers: builtSpec }));
      expect(legend.querySelector('.rl-legend-body').style.display).toBe('none');

      head.listeners.click({ stopPropagation: () => undefined });
      expect(legend.querySelector('.rl-legend-body').style.display).toBe('');
    });

    it('uses CSS sizes of at least 12px for legend text and 13px for callouts', () => {
      const html = buildLeafletHtml(false);
      const size = (selector: string) => {
        const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{[^}]*?font(?:-size)?:\\s*(?:\\d+\\s+)?(\\d+)px`);
        return Number(html.match(re)?.[1]);
      };
      expect(size('.rl-legend')).toBeGreaterThanOrEqual(12);
      expect(size('.rl-callout')).toBeGreaterThanOrEqual(13);
      expect(size('.rl-crime')).toBeGreaterThanOrEqual(12);
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
  });
});
