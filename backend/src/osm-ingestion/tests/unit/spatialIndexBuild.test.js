const fs = require('fs');
const path = require('path');
const os = require('os');

describe('buildIndex round trip', () => {
  let dir;

  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safenight-index-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('builds a Flatbush index that can be loaded and queried', async () => {
    const dataPath = path.join(dir, 'uk-roads.jsonl');
    fs.writeFileSync(
      dataPath,
      [
        JSON.stringify({ type: 'way', id: 1, nodes: [10, 11], tags: { highway: 'residential' }, bbox: { minLon: -0.1, minLat: 51.0, maxLon: -0.09, maxLat: 51.01 } }),
        JSON.stringify({ type: 'way', id: 2, nodes: [20, 21], tags: { highway: 'primary' }, bbox: { minLon: 1.0, minLat: 52.0, maxLon: 1.1, maxLat: 52.1 } }),
      ].join('\n') + '\n',
    );
    const indexPath = path.join(dir, 'ways-rtree.idx');
    const offsetsPath = path.join(dir, 'ways-offsets.bin');

    const { buildIndex, loadIndex, queryBbox } = require('../../src/spatialIndex');
    await buildIndex(dataPath, indexPath, offsetsPath);

    const index = await loadIndex(indexPath, dataPath, offsetsPath);
    const ids = queryBbox(index, 51.0, -0.1, 51.02, -0.08);
    await index.close?.();

    expect(ids).toHaveLength(1);
  });

  test('builds the index under plain Node, as the service runs it (Jest transforms hide this)', () => {
    const dataPath = path.join(dir, 'uk-roads.jsonl');
    fs.writeFileSync(
      dataPath,
      JSON.stringify({ type: 'way', id: 1, nodes: [10, 11], tags: { highway: 'residential' }, bbox: { minLon: -0.1, minLat: 51.0, maxLon: -0.09, maxLat: 51.01 } }) + '\n',
    );
    const indexPath = path.join(dir, 'ways-rtree.idx');
    const offsetsPath = path.join(dir, 'ways-offsets.bin');
    const modulePath = path.resolve(__dirname, '../../src/spatialIndex.js');
    const script = `
      const { buildIndex, loadIndex, queryBbox } = require(${JSON.stringify(modulePath)});
      (async () => {
        await buildIndex(${JSON.stringify(dataPath)}, ${JSON.stringify(indexPath)}, ${JSON.stringify(offsetsPath)});
        const index = await loadIndex(${JSON.stringify(indexPath)}, ${JSON.stringify(dataPath)}, ${JSON.stringify(offsetsPath)});
        console.log(queryBbox(index, 51.0, -0.1, 51.02, -0.08).length);
      })().catch((err) => { console.error(err.message); process.exit(1); });
    `;

    const out = require('child_process').execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, DATA_DIR: dir },
      encoding: 'utf8',
    });

    expect(out.trim()).toBe('1');
  });
});
