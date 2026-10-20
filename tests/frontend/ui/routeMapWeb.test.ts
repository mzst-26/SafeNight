import { buildLeafletHtml } from '@/src/components/maps/RouteMap.web';

describe('RouteMap.web buildLeafletHtml', () => {
  it('hides leaflet zoom controls for web layout', () => {
    const html = buildLeafletHtml(false);
    expect(html).toContain('.leaflet-control-zoom');
    // We intentionally hide the controls via display:none
    expect(html).toMatch(/\.leaflet-control-zoom\s*\{\s*display:\s*none/i);
  });

  it('includes basic map container', () => {
    const html = buildLeafletHtml(false);
    expect(html).toContain('<div id="map"></div>');
  });

  it('routes selected candidate card button to safe-route action instead of plain selection', () => {
    const html = buildLeafletHtml(false);
    expect(html).toContain("sendMsg('findSafeRoutes', { id:m.id });");
  });

  describe('Leaflet 1.9.4 subresource integrity', () => {
    const CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    const JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';

    it('pins the stylesheet with its sha256 integrity and crossorigin="anonymous"', () => {
      const html = buildLeafletHtml(false);
      const tag = html.match(/<link rel="stylesheet" href="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.css"([^>]*)\/>/);
      expect(tag).not.toBeNull();
      expect(tag?.[1]).toContain(`integrity="${CSS_SRI}"`);
      expect(tag?.[1]).toContain('crossorigin="anonymous"');
    });

    it('pins the script with its sha256 integrity and crossorigin="anonymous"', () => {
      const html = buildLeafletHtml(false);
      const tag = html.match(/<script src="https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js"([^>]*)><\/script>/);
      expect(tag).not.toBeNull();
      expect(tag?.[1]).toContain(`integrity="${JS_SRI}"`);
      expect(tag?.[1]).toContain('crossorigin="anonymous"');
    });
  });
});
