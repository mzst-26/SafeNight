const fs = require('fs');
const os = require('os');
const path = require('path');

const { createSafetyCacheStore } = require('../../../../src/safety/services/cacheStore');

describe('cacheStore', () => {
  let cacheDir;

  afterEach(() => {
    if (cacheDir) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      cacheDir = null;
    }
  });

  test('returns fresh values from memory and expires stale entries', async () => {
    const store = createSafetyCacheStore({
      namespace: 'memory-only',
      ttlMs: 100,
      cacheDir: '',
    });

    await store.set('bbox:1', { value: 1 });
    await expect(store.get('bbox:1')).resolves.toEqual({ value: 1 });

    await new Promise((resolve) => setTimeout(resolve, 140));
    await expect(store.get('bbox:1')).resolves.toBeNull();
  });

  test('persists entries to disk using hashed filenames and survives new store instance', async () => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safenight-cache-'));
    const key = 'bbox:51.5001,-0.1,51.6001,-0.0';

    const storeA = createSafetyCacheStore({
      namespace: 'overpass-data',
      ttlMs: 5000,
      cacheDir,
    });

    await storeA.set(key, { elements: [{ id: 1 }] });

    const files = fs.readdirSync(cacheDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^overpass-data-[a-f0-9]{64}\.json$/);
    expect(files[0]).not.toContain('bbox:51.5001');

    const storeB = createSafetyCacheStore({
      namespace: 'overpass-data',
      ttlMs: 5000,
      cacheDir,
    });

    await expect(storeB.get(key)).resolves.toEqual({ elements: [{ id: 1 }] });
  });

  test('removes stale disk entries on read', async () => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safenight-cache-'));
    const key = 'crime:1,2,3,4';

    const storeA = createSafetyCacheStore({
      namespace: 'crime-data',
      ttlMs: 80,
      cacheDir,
    });

    await storeA.set(key, [{ category: 'unknown' }]);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const storeB = createSafetyCacheStore({
      namespace: 'crime-data',
      ttlMs: 80,
      cacheDir,
    });

    await expect(storeB.get(key)).resolves.toBeNull();
    expect(fs.readdirSync(cacheDir).length).toBe(0);
  });

  describe('memory limits (final review F17)', () => {
    test('inserting more fresh entries than maxEntries keeps the memory layer at maxEntries', async () => {
      const store = createSafetyCacheStore({
        namespace: 'cap-entries',
        ttlMs: 60_000,
        maxEntries: 3,
        cacheDir: '',
      });

      for (let i = 1; i <= 5; i += 1) {
        await store.set(`k${i}`, { i });
      }

      const survivors = [];
      for (let i = 1; i <= 5; i += 1) {
        if ((await store.get(`k${i}`)) !== null) survivors.push(i);
      }
      expect(survivors).toEqual([3, 4, 5]);
    });

    test('the oldest inserted entry is evicted first, regardless of freshness', async () => {
      const store = createSafetyCacheStore({
        namespace: 'cap-oldest',
        ttlMs: 60_000,
        maxEntries: 2,
        cacheDir: '',
      });

      await store.set('first', 1);
      await store.set('second', 2);
      await store.set('third', 3);

      await expect(store.get('first')).resolves.toBeNull();
      await expect(store.get('second')).resolves.toBe(2);
      await expect(store.get('third')).resolves.toBe(3);
    });

    test('re-setting an existing key refreshes its position so it is not the first evicted', async () => {
      const store = createSafetyCacheStore({
        namespace: 'cap-refresh',
        ttlMs: 60_000,
        maxEntries: 2,
        cacheDir: '',
      });

      await store.set('a', 1);
      await store.set('b', 2);
      await store.set('a', 10);
      await store.set('c', 3);

      await expect(store.get('b')).resolves.toBeNull();
      await expect(store.get('a')).resolves.toBe(10);
      await expect(store.get('c')).resolves.toBe(3);
    });

    test('a byte budget evicts the oldest entries once the estimated JSON size exceeds it', async () => {
      // Each value serialises to about 600 bytes, so three of them exceed a 1500-byte budget.
      const store = createSafetyCacheStore({
        namespace: 'cap-bytes',
        ttlMs: 60_000,
        maxEntries: 100,
        maxBytes: 1500,
        cacheDir: '',
      });
      const big = (tag) => ({ tag, payload: 'x'.repeat(600) });

      await store.set('one', big(1));
      await store.set('two', big(2));
      await store.set('three', big(3));

      await expect(store.get('one')).resolves.toBeNull();
      await expect(store.get('two')).resolves.toEqual(big(2));
      await expect(store.get('three')).resolves.toEqual(big(3));
    });

    test('an entry evicted from memory is still served from disk', async () => {
      cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safenight-cache-'));
      const store = createSafetyCacheStore({
        namespace: 'cap-disk',
        ttlMs: 60_000,
        maxEntries: 1,
        cacheDir,
      });

      await store.set('older', { v: 1 });
      await store.set('newer', { v: 2 });

      await expect(store.get('older')).resolves.toEqual({ v: 1 });
    });
  });
});
