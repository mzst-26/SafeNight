const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function resolveCacheDir(cacheDir) {
  if (!cacheDir || String(cacheDir).trim() === '') return null;
  return path.resolve(String(cacheDir).trim());
}

function hashCacheKey(namespace, key) {
  return crypto
    .createHash('sha256')
    .update(`${namespace}:${String(key)}`)
    .digest('hex');
}

function sanitizeNamespace(namespace) {
  return String(namespace || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Estimated size of a value: its JSON length. Used only for the memory byte budget. */
function estimateBytes(data) {
  try {
    return String(JSON.stringify(data) ?? '').length;
  } catch {
    return 0;
  }
}

function createSafetyCacheStore(options = {}) {
  const {
    namespace = 'default',
    ttlMs,
    maxEntries = 100,
    maxBytes = Infinity,
    cacheDir = process.env.SAFE_ROUTES_CACHE_DIR,
    now = () => Date.now(),
  } = options;

  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('createSafetyCacheStore requires a positive ttlMs');
  }

  const safeNamespace = sanitizeNamespace(namespace);
  const persistentDir = resolveCacheDir(cacheDir);
  // Memory layer: a Map in insertion order, so the first key is always the oldest. memoryBytes tracks the estimated JSON size.
  const memory = new Map();
  let memoryBytes = 0;

  function getFilePathForKey(key) {
    if (!persistentDir) return null;
    const hashed = hashCacheKey(safeNamespace, key);
    return path.join(persistentDir, `${safeNamespace}-${hashed}.json`);
  }

  async function ensurePersistentDir() {
    if (!persistentDir) return;
    await fs.promises.mkdir(persistentDir, { recursive: true });
  }

  async function deleteDiskEntry(filePath) {
    if (!filePath) return;
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      if (err && err.code !== 'ENOENT') {
        console.warn(`[cacheStore:${safeNamespace}] Failed deleting stale cache entry: ${err.message}`);
      }
    }
  }

  function memoryDelete(key) {
    const existing = memory.get(key);
    if (!existing) return;
    memoryBytes -= existing.bytes;
    memory.delete(key);
  }

  // Evicts oldest-inserted entries (fresh or not) until both the entry cap and the byte budget hold.
  // The entry just stored is never evicted by its own insert.
  function memorySet(key, data, timestamp) {
    memoryDelete(key);
    const bytes = estimateBytes(data);
    memory.set(key, { data, timestamp, bytes });
    memoryBytes += bytes;
    for (const oldestKey of memory.keys()) {
      if (memory.size <= maxEntries && memoryBytes <= maxBytes) break;
      if (oldestKey === key) break;
      memoryDelete(oldestKey);
    }
  }

  function shouldAllowStale(entryAgeMs, maxStaleMs) {
    return Number.isFinite(maxStaleMs) && maxStaleMs > 0 && entryAgeMs < ttlMs + maxStaleMs;
  }

  async function readDiskEntry(filePath) {
    if (!filePath) return null;
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      console.warn(`[cacheStore:${safeNamespace}] Failed reading cache entry: ${err.message}`);
      await deleteDiskEntry(filePath);
      return null;
    }
  }

  async function getWithMeta(key, options = {}) {
    const {
      allowStale = false,
      maxStaleMs = 0,
    } = options;

    const normalizedAllowStale = allowStale === true;
    const normalizedMaxStaleMs = Number(maxStaleMs);
    const nowTs = now();

    const inMemory = memory.get(key);
    if (inMemory) {
      const ageMs = nowTs - inMemory.timestamp;
      if (ageMs < ttlMs) {
        return {
          data: inMemory.data,
          timestamp: inMemory.timestamp,
          ageMs,
          stale: false,
          cacheLayer: 'memory',
        };
      }
      if (normalizedAllowStale && shouldAllowStale(ageMs, normalizedMaxStaleMs)) {
        return {
          data: inMemory.data,
          timestamp: inMemory.timestamp,
          ageMs,
          stale: true,
          cacheLayer: 'memory',
        };
      }
      memoryDelete(key);
    }

    const filePath = getFilePathForKey(key);
    const diskEntry = await readDiskEntry(filePath);
    if (!diskEntry) return null;

    const ageMs = nowTs - diskEntry.timestamp;
    if (ageMs < ttlMs) {
      memorySet(key, diskEntry.data, diskEntry.timestamp);
      return {
        data: diskEntry.data,
        timestamp: diskEntry.timestamp,
        ageMs,
        stale: false,
        cacheLayer: 'disk',
      };
    }

    if (normalizedAllowStale && shouldAllowStale(ageMs, normalizedMaxStaleMs)) {
      memorySet(key, diskEntry.data, diskEntry.timestamp);
      return {
        data: diskEntry.data,
        timestamp: diskEntry.timestamp,
        ageMs,
        stale: true,
        cacheLayer: 'disk',
      };
    }

    await deleteDiskEntry(filePath);
    return null;
  }

  async function get(key) {
    const entry = await getWithMeta(key, { allowStale: false });
    return entry ? entry.data : null;
  }

  async function set(key, data) {
    const timestamp = now();
    const entry = { data, timestamp };
    memorySet(key, data, timestamp);

    const filePath = getFilePathForKey(key);
    if (!filePath) return;

    try {
      await ensurePersistentDir();
      const tempPath = `${filePath}.tmp-${process.pid}-${timestamp}`;
      const payload = JSON.stringify(entry);
      await fs.promises.writeFile(tempPath, payload, 'utf8');
      await fs.promises.rename(tempPath, filePath);
    } catch (err) {
      console.warn(`[cacheStore:${safeNamespace}] Failed writing cache entry: ${err.message}`);
    }
  }

  function clearMemory() {
    memory.clear();
    memoryBytes = 0;
  }

  return {
    async get(key) {
      return get(String(key));
    },
    async getWithMeta(key, options = {}) {
      return getWithMeta(String(key), options);
    },
    async set(key, data) {
      return set(String(key), data);
    },
    clearMemory,
    isPersistent: !!persistentDir,
    persistentDir,
  };
}

module.exports = {
  createSafetyCacheStore,
  hashCacheKey,
};
