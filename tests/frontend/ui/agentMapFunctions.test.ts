import { buildLeafletHtml } from '@/src/components/maps/RouteMap.web';
import { buildMapHtml } from '@/src/components/maps/RouteMap.native';

jest.mock('react-native-webview', () => ({ WebView: () => null }));

const FOUR_FUNCTIONS = [
  'window.agentPanTo = function',
  'window.agentZoomBy = function',
  'window.agentFitBounds = function',
  'window.agentHighlight = function',
];

/** The page's inline script. Parsing it (without running it) catches a broken template string. */
const inlineScript = (html: string): string => {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('no inline script in page');
  return match[1];
};

describe('web map (Leaflet iframe) agent functions', () => {
  const html = buildLeafletHtml(false);

  test.each(FOUR_FUNCTIONS)('defines %s', (fn) => {
    expect(html).toContain(fn);
  });

  test('the page script parses', () => {
    expect(() => new Function(inlineScript(html))).not.toThrow();
  });

  test('pan and zoom use the existing Leaflet map variable', () => {
    expect(html).toMatch(/window\.agentPanTo = function[\s\S]*?map\.setView\(/);
    expect(html).toMatch(/window\.agentZoomBy = function[\s\S]*?map\.setZoom\(/);
  });

  test('fit bounds uses map.fitBounds', () => {
    expect(html).toMatch(/window\.agentFitBounds = function[\s\S]*?map\.fitBounds\(/);
  });

  test('highlight draws only the worst stretch (rlStretchPath) with its callout, not the whole route', () => {
    expect(html).toMatch(/window\.agentHighlight = function\(routeId\)\{[\s\S]*?rlStretchPath\([\s\S]*?rlStretchCalloutText\(/);
    expect(html).not.toMatch(/window\.agentHighlight = function[\s\S]*?route\.path\.map\(/);
  });
});

describe('native map (MapLibre WebView) agent functions', () => {
  const html = buildMapHtml();

  test.each(FOUR_FUNCTIONS)('defines %s', (fn) => {
    expect(html).toContain(fn);
  });

  test('the page script parses', () => {
    expect(() => new Function(inlineScript(html))).not.toThrow();
  });

  test('pan, zoom and fit use the MapLibre map variable', () => {
    expect(html).toMatch(/window\.agentPanTo = function[\s\S]*?map\.easeTo\(/);
    expect(html).toMatch(/window\.agentZoomBy = function[\s\S]*?map\.zoomTo\(/);
    expect(html).toMatch(/window\.agentFitBounds = function[\s\S]*?map\.fitBounds\(/);
  });

  test('highlight draws only the worst stretch on a MapLibre highlight layer and returns true', () => {
    expect(html).toContain("id:'agent-highlight-line'");
    expect(html).toContain("source:'agent-highlight'");
    expect(html).toMatch(/window\.agentHighlight = function\(routeId\)\{[\s\S]*?rlStretchPath\([\s\S]*?return true;\s*\}/);
    expect(html).not.toMatch(/window\.agentHighlight = function\(routeId\)\{\s*return false;/);
  });

  test('the highlight source is added with the other route sources', () => {
    expect(html).toMatch(/addSource\('agent-highlight'/);
  });
});
