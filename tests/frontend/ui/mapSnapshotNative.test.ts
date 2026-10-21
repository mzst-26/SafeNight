import { buildMapHtml } from '@/src/components/maps/RouteMap.native';

jest.mock('react-native-webview', () => ({ WebView: () => null }));

describe('native map snapshot for the AI explanation', () => {
  const html = buildMapHtml();

  test('the page defines a snapshot function that reads the MapLibre canvas', () => {
    expect(html).toContain('window.rlSnapshot = function');
    expect(html).toContain("map.getCanvas()");
  });

  test('the snapshot is a scaled-down JPEG and is sent back as a snapshot message', () => {
    expect(html).toMatch(/toDataURL\('image\/jpeg', 0\.7\)/);
    expect(html).toContain("sendMsg('snapshot'");
  });

  test('it sends null instead of a blank picture when the map is not loaded', () => {
    expect(html).toMatch(/if \(!map \|\| !map\.loaded\(\)\) \{ done\(null\); return; \}/);
  });
});
