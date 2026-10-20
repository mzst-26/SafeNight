/**
 * crimeClient.js — UK Police API client with crime-type weighting.
 *
 * ACCURACY IMPROVEMENTS:
 *   • Tags each crime with its category severity (violent > property > nuisance); the scoring model
 *     (scoring/crimeRisk.js) weights crimes by severity and by the month they were recorded
 *   • 24-hour cache — crime data only updates monthly
 *   • Handles API limits gracefully
 *
 * OUTAGE CONTRACT (fetchCrimesWithStatus):
 *   • { status: 'ok', crimes } for a usable 200 response (including a genuine empty list),
 *     or for a stale cache entry that is still inside the allowed stale window.
 *   • { status: 'unavailable', crimes: [] } for a non-OK HTTP status, a network error with no
 *     usable stale cache, or an unparseable body. Failures are never cached, so an outage can
 *     never be stored as a good zero.
 */

const POLICE_API_BASE = 'https://data.police.uk/api';

const { createSafetyCacheStore } = require('./cacheStore');
// Severity table lives in crimeSeverity.js (shared with the scoring model).
const { CRIME_SEVERITY, severityOf } = require('./crimeSeverity');
// Outage status values are defined once, in the scoring model.
const { STATUS_OK: CRIME_STATUS_OK, STATUS_UNAVAILABLE: CRIME_STATUS_UNAVAILABLE } = require('../scoring/crimeRisk');

// ── Crime data cache (24h — data updates monthly) ───────────────────────────
const CRIME_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CRIME_CACHE_MAX_ENTRIES = 30;
const CRIME_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const crimeCacheStore = createSafetyCacheStore({
  namespace: 'crime-data',
  ttlMs: CRIME_CACHE_TTL,
  maxEntries: CRIME_CACHE_MAX_ENTRIES,
  maxBytes: CRIME_CACHE_MAX_BYTES,
});
const backgroundRefreshInflight = new Map();
const liveFetchInProgress = new Set();

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return raw === '1' || String(raw).toLowerCase() === 'true';
}

const SAFE_ROUTES_ALLOW_STALE_CACHE = envFlag('SAFE_ROUTES_ALLOW_STALE_CACHE', true);
const SAFE_ROUTES_MAX_STALE_MS = envInt('SAFE_ROUTES_MAX_STALE_MS', 10 * 60 * 1000);
const CRIME_MAX_STALE_MS = envInt('SAFE_ROUTES_CRIME_MAX_STALE_MS', SAFE_ROUTES_MAX_STALE_MS);
const CRIME_STALE_FETCH_GRACE_MS = envInt('SAFE_ROUTES_CRIME_STALE_FETCH_GRACE_MS', 1200);

// Cache keys snap to a 1/200 degree grid (~550m).
const CRIME_KEY_GRID = 200;

/**
 * Snaps a bbox outward to the key grid: south/west down, north/east up. The fetched box then always
 * covers the requested area, and it is exactly the box the cache key names.
 */
function snapBboxToKeyGrid(bbox) {
  const eps = 1e-9; // absorbs float noise, e.g. 51.0 * 200 = 10199.999999999998
  return {
    south: Math.floor(bbox.south * CRIME_KEY_GRID + eps) / CRIME_KEY_GRID,
    west: Math.floor(bbox.west * CRIME_KEY_GRID + eps) / CRIME_KEY_GRID,
    north: Math.ceil(bbox.north * CRIME_KEY_GRID - eps) / CRIME_KEY_GRID,
    east: Math.ceil(bbox.east * CRIME_KEY_GRID - eps) / CRIME_KEY_GRID,
  };
}

function crimeCacheKey(bbox) {
  return `crime:${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
}

function emitSourceMeta(onSourceMeta, meta) {
  if (typeof onSourceMeta !== 'function') return;
  try {
    onSourceMeta(meta);
  } catch {
    // No-op: observability callbacks should never break request flow.
  }
}

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.resolve({ timedOut: true });
  }

  let timeoutHandle;
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });

  return Promise.race([
    promise
      .then((value) => ({ timedOut: false, value, error: null }))
      .catch((error) => ({ timedOut: false, value: null, error })),
    timeoutPromise,
  ]).finally(() => clearTimeout(timeoutHandle));
}

function unavailable() {
  return { status: CRIME_STATUS_UNAVAILABLE, crimes: [] };
}

/**
 * Converts one Police API row into a crime, or null when its coordinates are not usable.
 * Coordinates arrive as strings; they must parse to finite numbers inside the valid range.
 */
function toCrime(row) {
  const lat = Number.parseFloat(row?.location?.latitude);
  const lng = Number.parseFloat(row?.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  const category = row.category || 'unknown';
  return {
    lat,
    lng,
    category,
    severity: severityOf(category),
    month: row.month || '',
  };
}

/**
 * Fetches the live Police response for a bbox and caches it when it is a genuine answer.
 * Never throws for upstream failures: they come back as { status: 'unavailable' }.
 * Only an abort of the caller's own signal is rethrown, so the caller can cancel.
 */
async function fetchAndCacheLiveData(key, bbox, liveSignal) {
  liveFetchInProgress.add(key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const abortFromParent = () => controller.abort();
  if (liveSignal) liveSignal.addEventListener('abort', abortFromParent, { once: true });

  const { south, west, north, east } = bbox;
  const poly = [
    `${south},${west}`,
    `${south},${east}`,
    `${north},${east}`,
    `${north},${west}`,
  ].join(':');

  try {
    let resp;
    try {
      resp = await fetch(
        `${POLICE_API_BASE}/crimes-street/all-crime?poly=${poly}`,
        { signal: controller.signal },
      );
    } catch (err) {
      if (err?.name === 'AbortError' && liveSignal?.aborted) throw err;
      console.warn(
        err?.name === 'AbortError'
          ? '[crimeClient] Police API timed out'
          : `[crimeClient] Police API error: ${String(err?.message || err).slice(0, 180)}`,
      );
      return unavailable();
    }

    if (!resp.ok) {
      console.warn(`[crimeClient] Police API ${resp.status} — crime data unavailable`);
      return unavailable();
    }

    let body;
    try {
      body = await resp.json();
    } catch (err) {
      console.warn(`[crimeClient] Police API body unparseable: ${String(err?.message || err).slice(0, 180)}`);
      return unavailable();
    }
    if (!Array.isArray(body)) {
      console.warn('[crimeClient] Police API body is not a list — crime data unavailable');
      return unavailable();
    }

    const crimes = [];
    for (const row of body) {
      const crime = toCrime(row);
      if (crime) crimes.push(crime);
    }

    // A genuine 200 (including an empty list) is a real answer and is cached as such.
    await crimeCacheStore.set(key, crimes);
    return { status: CRIME_STATUS_OK, crimes };
  } finally {
    clearTimeout(timer);
    if (liveSignal) liveSignal.removeEventListener('abort', abortFromParent);
    liveFetchInProgress.delete(key);
  }
}

/**
 * Fetch street-level crimes within a bounding box, with an explicit outage status.
 *
 * @param {{south:number, west:number, north:number, east:number}} bbox
 * @param {{signal?: AbortSignal, onSourceMeta?: Function}} [options]
 * @returns {Promise<{status: 'ok'|'unavailable', crimes: Array<{lat:number, lng:number, category:string, severity:number, month:string}>}>}
 */
async function fetchCrimesWithStatus(bbox, options = {}) {
  const { signal = null, onSourceMeta = null } = options;
  // Snap first: the key, the live request and any background refresh all use this same box.
  bbox = snapBboxToKeyGrid(bbox);
  const key = crimeCacheKey(bbox);
  const cacheEntry = await crimeCacheStore.getWithMeta(key, {
    allowStale: SAFE_ROUTES_ALLOW_STALE_CACHE,
    maxStaleMs: CRIME_MAX_STALE_MS,
  });

  if (cacheEntry && cacheEntry.stale === false) {
    console.log(`[crimeClient] 📋 Fresh cache hit (${cacheEntry.data.length} crimes, age=${cacheEntry.ageMs}ms, layer=${cacheEntry.cacheLayer})`);
    emitSourceMeta(onSourceMeta, {
      source: 'cache_fresh',
      stale: false,
      cacheAgeMs: cacheEntry.ageMs,
      cacheLayer: cacheEntry.cacheLayer,
    });
    return { status: CRIME_STATUS_OK, crimes: cacheEntry.data };
  }

  const scheduleBackgroundRefresh = () => {
    if (liveFetchInProgress.has(key)) return;
    if (backgroundRefreshInflight.has(key)) return;

    const refreshPromise = (async () => {
      try {
        const live = await fetchAndCacheLiveData(key, bbox, null);
        if (live.status === CRIME_STATUS_OK) {
          console.log('[crimeClient] ♻️ Background refresh completed');
        }
      } catch (err) {
        console.warn(`[crimeClient] ⚠️ Background refresh failed: ${String(err?.message || err).slice(0, 180)}`);
      } finally {
        backgroundRefreshInflight.delete(key);
      }
    })();

    backgroundRefreshInflight.set(key, refreshPromise);
  };

  if (!cacheEntry) {
    const live = await fetchAndCacheLiveData(key, bbox, signal);
    emitSourceMeta(onSourceMeta, {
      source: live.status === CRIME_STATUS_OK ? 'live' : 'live_error',
      stale: false,
      cacheAgeMs: null,
      cacheLayer: null,
    });
    return live;
  }

  const livePromise = fetchAndCacheLiveData(key, bbox, signal);
  const liveResult = await withTimeout(livePromise, CRIME_STALE_FETCH_GRACE_MS);

  if (!liveResult.timedOut && !liveResult.error && liveResult.value.status === CRIME_STATUS_OK) {
    emitSourceMeta(onSourceMeta, {
      source: 'live',
      stale: false,
      cacheAgeMs: null,
      cacheLayer: null,
    });
    return liveResult.value;
  }

  if (!liveResult.timedOut && liveResult.error) {
    if (liveResult.error.name === 'AbortError' && signal?.aborted) {
      throw liveResult.error;
    }

    console.warn(
      `[crimeClient] ⚠️ Live fetch failed, serving stale cache (age=${cacheEntry.ageMs}ms, layer=${cacheEntry.cacheLayer}): ${String(liveResult.error?.message || liveResult.error).slice(0, 180)}`,
    );
  } else if (!liveResult.timedOut) {
    console.warn(
      `[crimeClient] ⚠️ Live crime fetch unavailable, serving stale cache (age=${cacheEntry.ageMs}ms, layer=${cacheEntry.cacheLayer})`,
    );
  }

  if (liveResult.timedOut) {
    console.warn(
      `[crimeClient] 🕒 Serving stale cache after ${CRIME_STALE_FETCH_GRACE_MS}ms live wait (age=${cacheEntry.ageMs}ms, layer=${cacheEntry.cacheLayer})`,
    );
  }

  scheduleBackgroundRefresh();
  emitSourceMeta(onSourceMeta, {
    source: 'cache_stale',
    stale: true,
    cacheAgeMs: cacheEntry.ageMs,
    cacheLayer: cacheEntry.cacheLayer,
    staleFallbackReason: liveResult.timedOut ? 'live_slow' : 'live_error',
    backgroundRefreshTriggered: true,
  });
  livePromise.catch((err) => {
    if (err.name === 'AbortError' && signal?.aborted) return;
    console.warn(`[crimeClient] ⚠️ Live request after stale fallback failed: ${String(err?.message || err).slice(0, 180)}`);
  });
  return { status: CRIME_STATUS_OK, crimes: cacheEntry.data };
}

/**
 * Legacy API: crimes only. An outage yields [] exactly as before; callers that need to tell an
 * outage from a real zero must use fetchCrimesWithStatus.
 */
async function fetchCrimesInBbox(bbox, options = {}) {
  const { crimes } = await fetchCrimesWithStatus(bbox, options);
  return crimes;
}

function __resetForTests() {
  crimeCacheStore.clearMemory();
  backgroundRefreshInflight.clear();
  liveFetchInProgress.clear();
}

module.exports = {
  fetchCrimesWithStatus,
  fetchCrimesInBbox,
  CRIME_STATUS_OK,
  CRIME_STATUS_UNAVAILABLE,
  CRIME_SEVERITY,
  CRIME_CACHE_MAX_BYTES,
  // Test-only hook: never part of the production surface.
  ...(process.env.NODE_ENV === 'test' ? { __resetForTests } : {}),
};
