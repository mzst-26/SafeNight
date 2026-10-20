const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('../../src/spatialIndex', () => ({
  loadIndex: jest.fn(),
  queryBbox: jest.fn(() => []),
  fetchFeaturesByIds: jest.fn(async () => []),
}));

describe('dataStore.closeIndexes', () => {
  let tmpDir;
  let warnSpy;
  let logSpy;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safenight-datastore-close-'));
    process.env.PUBLISH_DIR = path.join(tmpDir, 'published');
    fs.mkdirSync(process.env.PUBLISH_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.PUBLISH_DIR, 'meta.json'), '{}');
    jest.resetModules();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
    delete process.env.PUBLISH_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('closes each loaded handle exactly once and tolerates a second call', async () => {
    const spatialIndex = require('../../src/spatialIndex');
    const waysHandle = { close: jest.fn(async () => {}) };
    const nodesHandle = { close: jest.fn(async () => {}) };
    spatialIndex.loadIndex.mockResolvedValueOnce(waysHandle).mockResolvedValueOnce(nodesHandle);

    const dataStore = require('../../src/dataStore');
    await dataStore.reloadIfNeeded();

    await dataStore.closeIndexes();

    expect(waysHandle.close).toHaveBeenCalledTimes(1);
    expect(nodesHandle.close).toHaveBeenCalledTimes(1);

    await expect(dataStore.closeIndexes()).resolves.toBeUndefined();
    expect(waysHandle.close).toHaveBeenCalledTimes(1);
    expect(nodesHandle.close).toHaveBeenCalledTimes(1);
  });

  test('resets module state so queries report dataset not loaded', async () => {
    const spatialIndex = require('../../src/spatialIndex');
    spatialIndex.loadIndex
      .mockResolvedValueOnce({ close: jest.fn(async () => {}) })
      .mockResolvedValueOnce({ close: jest.fn(async () => {}) });

    const dataStore = require('../../src/dataStore');
    await dataStore.reloadIfNeeded();
    await dataStore.closeIndexes();

    const stats = await dataStore.getStats();
    expect(stats.loaded).toBe(false);
  });
});
