import fs from 'node:fs';
import path from 'node:path';

import {
  buildNativeRouteLayerCollections,
  type NativeRouteLayerCollections,
} from '@/src/components/maps/RouteMap.native';
import { RISK_RAMP, type RouteLayerSpec } from '@/src/components/maps/routeLayers';

// The WebView native module is not available under jest; only the pure helper is exercised.
jest.mock('react-native-webview', () => ({ WebView: () => null }));

const nativeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/components/maps/RouteMap.native.tsx'),
  'utf8',
);

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Builder-shaped spec: line coords are [lat, lng] (see routeLayers.ts buildLines). */
const spec: RouteLayerSpec = {
  lines: [
    { coords: [[51.5, -0.1], [51.501, -0.1]], risk: 0.1, color: RISK_RAMP[0], dashed: false },
    { coords: [[51.501, -0.1], [51.502, -0.1]], risk: 0.9, color: RISK_RAMP[5], dashed: true },
    { coords: [[51.502, -0.1], [51.503, -0.1]], risk: 0.5, color: RISK_RAMP[2], dashed: false },
  ],
  callouts: [{ lat: 51.5015, lng: -0.1, text: 'Unlit stretch · 240 m', kind: 'worst-stretch' }],
  crimeClusters: [
    { lat: 51.5, lng: -0.11, count: 12, maxSeverity: 0.7 },
    { lat: 51.51, lng: -0.12, count: 3, maxSeverity: 0.4 },
  ],
  points: [
    { kind: 'light', lat: 51.5005, lng: -0.1 },
    { kind: 'cctv', lat: 51.5006, lng: -0.1 },
    { kind: 'shop', lat: 51.5007, lng: -0.1 },
  ],
  legend: {
    ramp: RISK_RAMP.map((color, i) => ({ from: i / 6, to: (i + 1) / 6, color })),
    dashedLabel: 'Dashed: estimated lighting or low certainty',
  },
};

const emptySpec: RouteLayerSpec = {
  lines: [],
  callouts: [],
  crimeClusters: [],
  points: [],
  legend: { ramp: [], dashedLabel: '' },
};

// ── Pure helper: RouteLayerSpec -> GeoJSON FeatureCollections ────────────────

describe('buildNativeRouteLayerCollections (pure)', () => {
  it('emits every line in casing and splits solid from dashed', () => {
    const c: NativeRouteLayerCollections = buildNativeRouteLayerCollections(spec, null);
    expect(c.casing.features).toHaveLength(3);
    expect(c.solid.features).toHaveLength(2);
    expect(c.dashed.features).toHaveLength(1);
    expect(c.solid.features.map((f) => f.properties.color)).toEqual([RISK_RAMP[0], RISK_RAMP[2]]);
    expect(c.dashed.features[0].properties.color).toBe(RISK_RAMP[5]);
  });

  it('never puts a dashed line into the solid collection', () => {
    const c = buildNativeRouteLayerCollections(spec, null);
    const solidColours = c.solid.features.map((f) => f.properties.color);
    expect(solidColours).not.toContain(RISK_RAMP[5]);
  });

  it('converts builder [lat, lng] coordinates to GeoJSON [lng, lat]', () => {
    const c = buildNativeRouteLayerCollections(spec, null);
    expect(c.solid.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [-0.1, 51.5],
        [-0.1, 51.501],
      ],
    });
  });

  it('emits crime only as cluster badges with count labels, never individual crime features', () => {
    const c = buildNativeRouteLayerCollections(spec, null);
    expect(c.clusters.features).toHaveLength(2);
    expect(c.clusters.features.map((f) => f.properties.label)).toEqual(['12', '3']);
    expect(c.clusters.features[0].properties.count).toBe(12);
    expect(c.clusters.features[0].properties.maxSeverity).toBe(0.7);
    expect(Object.keys(c).sort()).toEqual(
      ['callouts', 'casing', 'clusters', 'dashed', 'points', 'solid'],
    );
  });

  it('emits the worst-stretch callout text unchanged', () => {
    const c = buildNativeRouteLayerCollections(spec, null);
    expect(c.callouts.features).toHaveLength(1);
    expect(c.callouts.features[0].properties.text).toBe('Unlit stretch · 240 m');
    expect(c.callouts.features[0].geometry.coordinates).toEqual([-0.1, 51.5015]);
  });

  it('always includes lights (the layer minzoom gates them) and gates cctv and shops on highlight', () => {
    const none = buildNativeRouteLayerCollections(spec, null);
    expect(none.points.features.map((f) => f.properties.kind)).toEqual(['light']);

    const cctv = buildNativeRouteLayerCollections(spec, 'cctv');
    expect(cctv.points.features.map((f) => f.properties.kind)).toEqual(['light', 'cctv']);

    const shop = buildNativeRouteLayerCollections(spec, 'shop');
    expect(shop.points.features.map((f) => f.properties.kind)).toEqual(['light', 'shop']);
  });

  it('flags the highlighted category for emphasis (larger radius in the renderer)', () => {
    const c = buildNativeRouteLayerCollections(spec, 'cctv');
    const byKind = Object.fromEntries(c.points.features.map((f) => [f.properties.kind, f.properties.emph]));
    expect(byKind).toEqual({ light: 0, cctv: 1 });
  });

  it('drops non-finite coordinates instead of throwing', () => {
    const bad: RouteLayerSpec = {
      ...spec,
      lines: [{ coords: [[Number.NaN, -0.1], [51.6, -0.1]], risk: 0.2, color: RISK_RAMP[0], dashed: false }],
      crimeClusters: [{ lat: Number.POSITIVE_INFINITY, lng: 0, count: 2, maxSeverity: 0.4 }],
    };
    const c = buildNativeRouteLayerCollections(bad, null);
    expect(c.casing.features).toHaveLength(0);
    expect(c.clusters.features).toHaveLength(0);
  });

  it('returns empty collections for an empty spec', () => {
    const c = buildNativeRouteLayerCollections(emptySpec, null);
    for (const fc of [c.casing, c.solid, c.dashed, c.clusters, c.callouts, c.points]) {
      expect(fc).toEqual({ type: 'FeatureCollection', features: [] });
    }
  });
});

// ── Source inspection: supply chain, layer config, legacy path ──────────────

describe('RouteMap.native MapLibre supply chain', () => {
  it('pins maplibre-gl to the exact 4.7.1 release, not a floating major', () => {
    expect(nativeSource).toContain('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js');
    expect(nativeSource).toContain('https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css');
    expect(nativeSource).not.toContain('maplibre-gl@4/');
  });

  it('carries verified SRI hashes (sha384) for the pinned script and stylesheet', () => {
    expect(nativeSource).toContain(
      'integrity="sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj"',
    );
    expect(nativeSource).toContain(
      'integrity="sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V"',
    );
    expect(nativeSource).toMatch(/maplibre-gl\.js"[^>]*crossorigin="anonymous"/);
    expect(nativeSource).toMatch(/maplibre-gl\.css"[^>]*crossorigin="anonymous"/);
  });

  it('leaves the WebView originWhitelist unchanged', () => {
    expect(nativeSource).toContain('originWhitelist={["*"]}');
  });
});

describe('RouteMap.native routeLayers drawing (MapLibre)', () => {
  it('draws a white casing (width 11) under the colour-driven solid line', () => {
    expect(nativeSource).toMatch(/id:'rl-casing'[\s\S]*?'line-color':'#ffffff'[\s\S]*?'line-width':11/);
    expect(nativeSource).toMatch(/id:'rl-solid'[\s\S]*?'line-color':\['get','color'\]/);
  });

  it('draws dashed estimated lines in their own layer with round caps and [0.1, 2.2] dash units', () => {
    expect(nativeSource).toMatch(/id:'rl-dashed'[\s\S]*?'line-dasharray':\[0\.1,2\.2\]/);
    expect(nativeSource).toMatch(/id:'rl-dashed'[\s\S]*?'line-cap':'round'/);
  });

  it('renders unselected routes thin grey with an invisible wide hit layer for tap-to-select', () => {
    expect(nativeSource).toMatch(
      /id:'rl-unselected-line'[\s\S]*?'line-color':'#98a2b3'[\s\S]*?'line-opacity':0\.55[\s\S]*?'line-width':4/,
    );
    expect(nativeSource).toMatch(/id:'rl-unselected-hit'[\s\S]*?'line-width':22[\s\S]*?'line-opacity':0/);
    expect(nativeSource).toContain("map.on('click','rl-unselected-hit'");
  });

  it('gates lights by MapLibre minzoom 17 and lets a light highlight show them at any zoom', () => {
    expect(nativeSource).toMatch(/id:'rl-lights'[\s\S]*?minzoom:17/);
    expect(nativeSource).toMatch(/setLayerZoomRange\('rl-lights'/);
  });

  it('gates cctv and shop points on the highlighted category in the builder, and sends the highlight to the WebView', () => {
    // Behaviour is covered by the pure-helper tests above; here we check the wiring.
    expect(nativeSource).toContain('p.kind === "light" || p.kind === highlight');
    expect(nativeSource).toContain('highlightCategory: p.highlightCategory ?? null,');
    expect(nativeSource).toMatch(/id:'rl-cctv'[\s\S]*?'circle-color':'#8b5cf6'/);
    expect(nativeSource).toMatch(/id:'rl-shop'[\s\S]*?'circle-color':'#22c55e'/);
  });

  it('renders crime as count badges (bold white on #b42318 with a ring, text >= 12px)', () => {
    expect(nativeSource).toContain('.rl-cluster{');
    const badge = nativeSource.match(/\.rl-cluster\{[^}]*\}/)?.[0] ?? '';
    expect(badge).toContain('background:#b42318');
    expect(badge).toContain('color:#fff');
    expect(badge).toMatch(/font-weight:700/);
    expect(badge).toMatch(/box-shadow:0 0 0 2px #fff/);
    const size = Number(badge.match(/font-size:(\d+)px/)?.[1]);
    expect(size).toBeGreaterThanOrEqual(12);
  });

  it('renders the worst-stretch callout at >= 13px with a white halo', () => {
    const callout = nativeSource.match(/\.rl-callout\{[^}]*\}/)?.[0] ?? '';
    expect(callout).not.toBe('');
    expect(Number(callout.match(/font-size:(\d+)px/)?.[1])).toBeGreaterThanOrEqual(13);
    expect(callout).toContain('text-shadow:');
    expect(callout).toContain('#fff');
  });

  it('shows a collapsible bottom-left legend with Safer/Riskier labels, a dotted sample and >= 12px text', () => {
    expect(nativeSource).toMatch(/rl-legend[^{]*\{[^}]*left:12px/);
    expect(nativeSource).toMatch(/rl-legend[^{]*\{[^}]*bottom:/);
    expect(nativeSource).toContain('Safer');
    expect(nativeSource).toContain('Riskier');
    expect(nativeSource).toContain('Estimated lighting');
    expect(nativeSource).toContain('aria-expanded');
    expect(nativeSource).toMatch(/\.rl-legend[^{]*\{[^}]*font-size:1[2-9]px/);
    expect(nativeSource).toMatch(/stroke-dasharray="0\.1 12"/);
  });

  it('builds the legend gradient from the RISK_RAMP colours sent as JSON', () => {
    expect(nativeSource).toContain('legend.ramp');
    expect(nativeSource).toContain('linear-gradient(to right');
  });

  it('suppresses individual crime dots and legacy route segments when routeLayers is set', () => {
    expect(nativeSource).toContain('var routeLayersMode = !!rl;');
    expect(nativeSource).toMatch(/\['crime',\s*'light',\s*'cctv',\s*'shop'\]/);
    expect(nativeSource).toMatch(/if\(routeLayersMode\)\{\s*segF\s*=\s*\[\];\s*remF\s*=\s*\[\];/);
  });

  it('keeps search candidates drawn in routeLayers mode', () => {
    expect(nativeSource).toContain("kind:'search_candidate'");
    expect(nativeSource).toContain("String(m.id).indexOf('search-candidate:')===0");
  });
});

describe('RouteMap.native legacy path (routeLayers null) is untouched', () => {
  it('keeps the legacy unselected, segment and safety-circle paint values', () => {
    expect(nativeSource).toContain(
      "paint:{'line-color':'#98a2b3','line-opacity':0.5,'line-width':5}",
    );
    expect(nativeSource).toContain(
      "paint:{'line-color':['get','color'],'line-opacity':0.9,'line-width':7}",
    );
    expect(nativeSource).toContain("map.addLayer({ id:'safety-circles', type:'circle', source:'safety-markers',");
  });

  it('keeps legacy segment drawing as the default source of route-segments', () => {
    expect(nativeSource).toContain(
      "map.getSource('route-segments').setData({type:'FeatureCollection',features:segF});",
    );
    expect(nativeSource).toContain('if(data.segments&&data.segments.length>0){');
  });
});

describe('RouteMap.native routeLayers wiring (React side)', () => {
  it('passes routeLayers and highlightCategory through the latest-props ref', () => {
    expect(nativeSource).toMatch(/propsRef\.current = \{[\s\S]*?routeLayers,[\s\S]*?highlightCategory,/);
  });

  it('includes routeLayers and highlightCategory in the update effect deps', () => {
    expect(nativeSource).toMatch(/\}, \[\s*origin,[\s\S]*?routeLayers,[\s\S]*?highlightCategory,[\s\S]*?pushUpdate,\s*\]\);/);
  });

  it('sends the built layer collections (or null) in the updateMap payload', () => {
    expect(nativeSource).toContain('routeLayers: p.routeLayers');
    expect(nativeSource).toContain('buildNativeRouteLayerCollections(p.routeLayers, p.highlightCategory)');
  });
});
