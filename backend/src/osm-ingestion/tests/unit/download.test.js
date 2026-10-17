const fs = require('fs');
const path = require('path');
const os = require('os');

describe('downloadPbf reuse', () => {
  let dataDir;
  let fetchSpy;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safenight-download-'));
    process.env.DATA_DIR = dataDir;
    jest.resetModules();
    // Reject before any file is opened, so a fetch attempt is observable without leaving writes behind
    fetchSpy = jest.fn(async () => {
      throw new Error('network disabled in test');
    });
    global.fetch = fetchSpy;
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('reuses an existing fresh PBF when reuseIfFresh is set', async () => {
    const pbf = path.join(dataDir, 'gb-latest.osm.pbf');
    fs.writeFileSync(pbf, 'existing-pbf');

    const { downloadPbf } = require('../../src/download');
    const result = await downloadPbf({ reuseIfFresh: true, maxAgeHours: 48 });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.path).toBe(pbf);
    expect(fs.readFileSync(pbf, 'utf8')).toBe('existing-pbf');
  });

  test('downloads when reuseIfFresh is not set, even if a PBF exists', async () => {
    fs.writeFileSync(path.join(dataDir, 'gb-latest.osm.pbf'), 'existing-pbf');

    const { downloadPbf } = require('../../src/download');
    await expect(downloadPbf()).rejects.toThrow();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test('downloads when the existing PBF is older than maxAgeHours', async () => {
    const pbf = path.join(dataDir, 'gb-latest.osm.pbf');
    fs.writeFileSync(pbf, 'stale-pbf');
    const old = new Date(Date.now() - 49 * 3600 * 1000);
    fs.utimesSync(pbf, old, old);

    const { downloadPbf } = require('../../src/download');
    await expect(downloadPbf({ reuseIfFresh: true, maxAgeHours: 48 })).rejects.toThrow();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
