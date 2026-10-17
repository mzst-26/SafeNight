const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('exportToGeoJSON osmium arguments', () => {
  let spawnMock;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('child_process', () => {
      spawnMock = jest.fn(() => {
        const child = new EventEmitter();
        setImmediate(() => child.emit('exit', 0));
        return child;
      });
      return { spawn: spawnMock };
    });
  });

  afterEach(() => {
    jest.dontMock('child_process');
  });

  test('passes osmium the id and way_nodes attributes with -a, not a config file with -c', async () => {
    const { exportToGeoJSON } = require('../../src/normalize');

    await exportToGeoJSON('in.osm.pbf', 'out.geojsonseq');

    const args = spawnMock.mock.calls[0][1];
    expect(args).toContain('-a');
    expect(args[args.indexOf('-a') + 1]).toBe('id,way_nodes');
    expect(args).not.toContain('-c');
  });
});

describe('normalizeWays record mapping', () => {
  let dir;

  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safenight-normalize-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('maps osmium @id and @way_nodes into id and nodes, and drops @ keys from tags', async () => {
    // Shape produced by `osmium export -f geojsonseq -a id,way_nodes` (verified on a sample PBF)
    const feature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-0.1, 51.0], [-0.09, 51.01]] },
      properties: { '@id': 1, '@way_nodes': [10, 11], highway: 'residential' },
    };
    // osmium geojsonseq prefixes each record with an RS byte (0x1e), and a highway-tagged Point is not a road
    const crossing = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-0.1, 51.0] },
      properties: { '@id': 99, highway: 'crossing' },
    };
    const inPath = path.join(dir, 'ways.geojsonseq');
    const outPath = path.join(dir, 'uk-roads.jsonl');
    fs.writeFileSync(inPath, `\x1e${JSON.stringify(feature)}\n\x1e${JSON.stringify(crossing)}\n`);

    const { normalizeWays } = require('../../src/normalize');
    const count = await normalizeWays(inPath, outPath);

    expect(count).toBe(1);
    const record = JSON.parse(fs.readFileSync(outPath, 'utf8').trim());
    expect(record.id).toBe(1);
    expect(record.nodes).toEqual([10, 11]);
    expect(record.coords).toEqual([[-0.1, 51.0], [-0.09, 51.01]]);
    expect(record.tags).toEqual({ highway: 'residential' });
    expect(record.bbox).toEqual({ minLon: -0.1, minLat: 51.0, maxLon: -0.09, maxLat: 51.01 });
  });
});
