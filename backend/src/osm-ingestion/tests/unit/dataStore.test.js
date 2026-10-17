const fs = require('fs');
const path = require('path');
const os = require('os');

describe('dataStore before first publish', () => {
  let tmpDir;
  let warnSpy;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safenight-datastore-'));
    process.env.PUBLISH_DIR = path.join(tmpDir, 'published');
    jest.resetModules();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.PUBLISH_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('does not warn when meta.json is missing (ingestion not finished yet)', async () => {
    const dataStore = require('../../src/dataStore');

    await dataStore.reloadIfNeeded();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('queryBboxData still reports dataset not loaded when nothing is published', async () => {
    const dataStore = require('../../src/dataStore');

    await expect(dataStore.queryBboxData(51, -0.1, 51.02, -0.08)).rejects.toThrow('Dataset not loaded');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('still warns on a real load failure (meta.json present, index files broken)', async () => {
    const publishDir = path.join(tmpDir, 'published');
    fs.mkdirSync(publishDir, { recursive: true });
    fs.writeFileSync(path.join(publishDir, 'meta.json'), '{}');

    const dataStore = require('../../src/dataStore');
    await dataStore.reloadIfNeeded();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[dataStore] Failed to load dataset'));
  });
});
