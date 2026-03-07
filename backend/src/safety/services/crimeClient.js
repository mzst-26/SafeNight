/**
 * crimeClient.js — UK Police API client with crime-type weighting.
 *
 * ACCURACY IMPROVEMENTS:
 *   • Categorises crimes by severity (violent > property > nuisance)
 *   • Returns severity weight with each crime for distance-weighted scoring
 *   • 24-hour cache — crime data only updates monthly
 *   • Handles API limits gracefully
 */

const POLICE_API_BASE = 'https://data.police.uk/api';

// ── Crime severity weights ──────────────────────────────────────────────────
// Higher = more impact on safety score. Violent crimes matter MUCH more.
const CRIME_SEVERITY = {
  'violent-crime':          1.0,   // Most dangerous
  'robbery':                1.0,
  'sexual-offences':        1.0,
  'possession-of-weapons':  0.9,
  'public-order':           0.7,
  'criminal-damage-arson':  0.6,
  'burglary':               0.5,
  'vehicle-crime':          0.4,
  'drugs':                  0.4,
  'theft-from-the-person':  0.8,   // Direct threat to pedestrians
  'bicycle-theft':          0.3,
  'shoplifting':            0.2,
  'other-theft':            0.3,
  'anti-social-behaviour':  0.3,
  'other-crime':            0.4,
  'unknown':                0.4,
};

// ── Crime data cache (24h — data updates monthly) ───────────────────────────
const crimeCache = new Map();
const CRIME_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function crimeCacheKey(bbox) {
  const r = (v) => Math.round(v * 200) / 200; // ~550m grid
  return `crime:${r(bbox.south)},${r(bbox.west)},${r(bbox.north)},${r(bbox.east)}`;
}

/**
 * Fetch street-level crimes within a bounding box.
 * Returns array of { lat, lng, category, severity, month }.
 */
async function fetchCrimesInBbox(bbox, options = {}) {
  const { signal = null } = options;
  const key = crimeCacheKey(bbox);
  const cached = crimeCache.get(key);
  if (cached && Date.now() - cached.timestamp < CRIME_CACHE_TTL) {
    console.log(`[crimeClient] 📋 Cache hit (${cached.data.length} crimes)`);
    return cached.data;
  }

  const { south, west, north, east } = bbox;
  const poly = [
    `${south},${west}`,
    `${south},${east}`,
    `${north},${east}`,
    `${north},${west}`,
  ].join(':');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const abortFromParent = () => controller.abort();
    if (signal) signal.addEventListener('abort', abortFromParent, { once: true });

    const resp = await fetch(
      `${POLICE_API_BASE}/crimes-street/all-crime?poly=${poly}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abortFromParent);

    if (resp.status === 503) {
      console.warn('[crimeClient] Police API returned 503 — skipping');
      return [];
    }
    if (!resp.ok) {
      const text = await resp.text();
      console.warn(`[crimeClient] Police API ${resp.status}: ${text.slice(0, 200)}`);
      return [];
    }

    const crimes = await resp.json();
    if (!Array.isArray(crimes)) return [];

    const result = crimes
      .filter((c) => c.location?.latitude && c.location?.longitude)
      .map((c) => {
        const category = c.category || 'unknown';
        return {
          lat: parseFloat(c.location.latitude),
          lng: parseFloat(c.location.longitude),
          category,
          severity: CRIME_SEVERITY[category] || 0.4,
          month: c.month || '',
        };
      });

    // Cache result
    crimeCache.set(key, { data: result, timestamp: Date.now() });

    // Evict stale entries
    if (crimeCache.size > 30) {
      const now = Date.now();
      for (const [k, v] of crimeCache) {
        if (now - v.timestamp > CRIME_CACHE_TTL) crimeCache.delete(k);
      }
    }

    return result;
  } catch (err) {
    if (err.name === 'AbortError') {
      if (signal?.aborted) {
        throw err;
      }
      console.warn('[crimeClient] Police API timed out');
    } else {
      console.warn('[crimeClient] Police API error:', err.message);
    }
    return [];
  }
}

module.exports = { fetchCrimesInBbox, CRIME_SEVERITY };
