/**
 * routes/geocode.js — Nominatim-backed geocoding endpoints.
 *
 * Endpoints:
 *   GET /api/geocode/autocomplete   — place search / forward geocoding
 *   GET /api/geocode/details        — resolve a placeId → lat/lng
 *   GET /api/geocode/reverse        — lat/lng → address
 *
 * All three use an in-process LRU-style TTL cache so repeated lookups
 * (same search query, same pin location) return instantly without
 * hitting Nominatim's 1 req/sec rate limit.
 *
 * Cache sizes (conservative memory footprint):
 *   autocomplete : 500 entries, 5 min TTL
 *   details      : 1000 entries, 60 min TTL
 *   reverse      : 1000 entries, 60 min TTL
 */

const express = require('express');
const {
  validateTextInput,
  validatePlaceId,
  validateLatitude,
  validateLongitude,
} = require('../../shared/validation/validate');

const router = express.Router();

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = process.env.OSM_USER_AGENT || 'SafeNightHome/1.0 (geocode-service)';

// ─── Simple TTL cache ────────────────────────────────────────────────────────

function makeTTLCache(maxSize, ttlMs) {
  const store = new Map();

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > ttlMs) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key, value) {
    // Evict oldest if at capacity
    if (store.size >= maxSize) {
      store.delete(store.keys().next().value);
    }
    store.set(key, { value, ts: Date.now() });
  }

  return { get, set };
}

const autocompleteCache = makeTTLCache(500, 5 * 60 * 1000);   // 5 min
const detailsCache      = makeTTLCache(1000, 60 * 60 * 1000); // 60 min
const reverseCache      = makeTTLCache(1000, 60 * 60 * 1000); // 60 min

// ─── Nominatim rate limiter (≥ 300 ms between calls) ────────────────────────

let lastNominatimCall = 0;
const nominatimThrottle = async () => {
  const elapsed = Date.now() - lastNominatimCall;
  if (elapsed < 300) {
    await new Promise((r) => setTimeout(r, 300 - elapsed));
  }
  lastNominatimCall = Date.now();
};

// API call counters (diagnostic only)
const calls = { autocomplete: 0, details: 0, reverse: 0 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detect whether the input looks like a UK street address
 * (starts with a house number, e.g. "431 Eggbuckland Road").
 */
function looksLikeAddress(input) {
  return /^\d+[a-z]?\s+\S/i.test(input.trim());
}

/**
 * Build a human-friendly primary label from a Nominatim address object.
 * Prioritises: house_number + road  →  amenity/shop/tourism name → display_name[0]
 */
function buildMainText(r) {
  const addr = r.address || {};

  // Named place (amenity, shop, pub, university, etc.)
  const placeName =
    addr.amenity || addr.shop || addr.tourism || addr.leisure ||
    addr.office || addr.building || addr.university ||
    addr.college || addr.school || addr.hospital || addr.hotel;

  // House-number address
  if (addr.house_number && addr.road) {
    const base = `${addr.house_number} ${addr.road}`;
    return placeName ? `${placeName}, ${base}` : base;
  }

  // Named place without a specific number
  if (placeName) return placeName;

  // Road only
  if (addr.road) return addr.road;

  // Fall back to name field or first part of display_name
  return r.name || r.display_name.split(',')[0];
}

/**
 * Build a short secondary label: neighbourhood / suburb / town / city + postcode.
 */
function buildSecondaryText(r) {
  const addr = r.address || {};
  const parts = [
    addr.neighbourhood || addr.suburb || addr.quarter,
    addr.town || addr.village || addr.city || addr.county,
    addr.postcode,
  ].filter(Boolean);
  return parts.join(', ') || r.display_name.split(',').slice(1, 4).join(',').trim();
}

/**
 * Deduplicate Nominatim results by osm_id, then sort: results that contain
 * the query text in their name/road rank higher than generic address hits.
 */
function dedupeAndRank(results, input) {
  const seen = new Set();
  const unique = [];
  for (const r of results) {
    const key = `${r.osm_type}-${r.osm_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }
  const lc = input.toLowerCase();
  unique.sort((a, b) => {
    const aScore = (a.display_name.toLowerCase().includes(lc) ? 1 : 0) + parseFloat(a.importance || 0);
    const bScore = (b.display_name.toLowerCase().includes(lc) ? 1 : 0) + parseFloat(b.importance || 0);
    return bScore - aScore;
  });
  return unique;
}

/**
 * Fire a single Nominatim search and return the raw JSON array.
 * Applies the shared rate limiter before each call.
 */
async function nominatimSearch(params) {
  await nominatimThrottle();
  calls.autocomplete++;
  const url = `${NOMINATIM_BASE}/search?${new URLSearchParams(params).toString()}`;
  console.log(`[geocode/autocomplete] 🌐 Nominatim call #${calls.autocomplete} → ${url.replace(NOMINATIM_BASE, '')}`);
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  return response.json();
}

// ─── GET /api/geocode/autocomplete ────────────────────────────────────────────
// Query: input, lat?, lng?, radius?
router.get('/autocomplete', async (req, res) => {
  try {
    const inputResult = validateTextInput(req.query.input);
    if (!inputResult.valid) return res.status(400).json({ error: inputResult.error });

    const input = inputResult.value;

    // Location bias viewbox
    let viewbox = null;
    if (req.query.lat && req.query.lng) {
      const latR = validateLatitude(req.query.lat);
      const lngR = validateLongitude(req.query.lng);
      if (!latR.valid) return res.status(400).json({ error: latR.error });
      if (!lngR.valid) return res.status(400).json({ error: lngR.error });
      const offset = 0.5; // ~50 km
      viewbox = `${lngR.value - offset},${latR.value + offset},${lngR.value + offset},${latR.value - offset}`;
    }

    const cacheKey = `${input}|${viewbox ?? ''}`;
    const cached = autocompleteCache.get(cacheKey);
    if (cached) {
      console.log(`[geocode/autocomplete] 💾 Cache hit → "${input.substring(0, 30)}"`);
      return res.json(cached);
    }

    // ── Build query list ────────────────────────────────────────────────────
    // We always run a free-text search. For address-style queries we ALSO run
    // a structured search (housenumber + street) which finds door numbers
    // that plain free-text often misses.

    const baseParams = {
      format: 'json',
      addressdetails: '1',
      limit: '8',
      countrycodes: 'gb',       // UK-focused; remove if you need global
      'accept-language': 'en',
    };
    if (viewbox) {
      baseParams.viewbox = viewbox;
      baseParams.bounded = '0'; // prefer but don't restrict to viewbox
    }

    const searches = [
      // 1. Free-text search — finds named places ("Plymouth University"),
      //    roads, postcodes, and partial addresses
      nominatimSearch({ ...baseParams, q: input }),
    ];

    if (looksLikeAddress(input)) {
      // 2. Structured address search — split "431 Eggbuckland Road" into
      //    housenumber=431  street=Eggbuckland Road  for precise door-level hits
      const spaceIdx = input.search(/\s/);
      const houseNumber = input.substring(0, spaceIdx).trim();
      const street = input.substring(spaceIdx + 1).trim();
      searches.push(
        nominatimSearch({ ...baseParams, housenumber: houseNumber, street, limit: '5' })
      );
    }

    // Run all queries in parallel (rate limiter serialises them internally)
    const rawArrays = await Promise.all(searches);
    const merged = dedupeAndRank(rawArrays.flat(), input).slice(0, 8);

    const predictions = merged.map((r) => ({
      place_id: `osm-${r.osm_type}-${r.osm_id}`,
      description: r.display_name,
      structured_formatting: {
        main_text: buildMainText(r),
        secondary_text: buildSecondaryText(r),
      },
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
    }));

    const payload = {
      status: predictions.length > 0 ? 'OK' : 'ZERO_RESULTS',
      predictions,
    };

    autocompleteCache.set(cacheKey, payload);
    console.log(`[geocode/autocomplete] 📦 ${predictions.length} results (cached)`);
    res.json(payload);
  } catch (err) {
    console.error('[geocode/autocomplete] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/geocode/details ─────────────────────────────────────────────────
// Query: place_id (format: osm-<type>-<id>)
router.get('/details', async (req, res) => {
  try {
    const placeIdResult = validatePlaceId(req.query.place_id);
    if (!placeIdResult.valid) return res.status(400).json({ error: placeIdResult.error });

    const placeId = placeIdResult.value;
    const cached = detailsCache.get(placeId);
    if (cached) {
      console.log(`[geocode/details] 💾 Cache hit → "${placeId}"`);
      return res.json(cached);
    }

    const osmMatch = placeId.match(/^osm-(node|way|relation)-(\d+)$/);
    let url;
    if (osmMatch) {
      const [, osmType, osmId] = osmMatch;
      const typeChar = osmType === 'node' ? 'N' : osmType === 'way' ? 'W' : 'R';
      url = `${NOMINATIM_BASE}/lookup?format=json&osm_ids=${typeChar}${osmId}&addressdetails=1`;
    } else {
      url = `${NOMINATIM_BASE}/search?format=json&q=${encodeURIComponent(placeId)}&limit=1&addressdetails=1`;
    }

    await nominatimThrottle();
    calls.details++;
    console.log(`[geocode/details] 🌐 Nominatim call #${calls.details} → "${placeId}"`);

    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    const data = await response.json();
    const result = Array.isArray(data) ? data[0] : data;

    if (!result || !result.lat || !result.lon) {
      return res.json({ status: 'NOT_FOUND', result: null });
    }

    const payload = {
      status: 'OK',
      result: {
        place_id: placeId,
        name: result.name || result.display_name?.split(',')[0] || '',
        geometry: {
          location: {
            lat: parseFloat(result.lat),
            lng: parseFloat(result.lon),
          },
        },
      },
    };

    detailsCache.set(placeId, payload);
    console.log(`[geocode/details] 📦 Found "${payload.result.name}" (cached)`);
    res.json(payload);
  } catch (err) {
    console.error('[geocode/details] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/geocode/reverse ─────────────────────────────────────────────────
// Query: lat, lng
// Converts a map pin (lat/lng) into a human-readable address.
router.get('/reverse', async (req, res) => {
  try {
    const latResult = validateLatitude(req.query.lat);
    const lngResult = validateLongitude(req.query.lng);
    if (!latResult.valid) return res.status(400).json({ error: latResult.error });
    if (!lngResult.valid) return res.status(400).json({ error: lngResult.error });

    const lat = latResult.value;
    const lng = lngResult.value;

    // Round to ~11 m precision to improve cache hit ratio
    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = reverseCache.get(cacheKey);
    if (cached) {
      console.log(`[geocode/reverse] 💾 Cache hit → (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
      return res.json(cached);
    }

    const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;

    await nominatimThrottle();
    calls.reverse++;
    console.log(`[geocode/reverse] 🌐 Nominatim call #${calls.reverse} → (${lat.toFixed(4)}, ${lng.toFixed(4)})`);

    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    const data = await response.json();

    if (!data || data.error || !data.lat || !data.lon) {
      return res.json({ status: 'NOT_FOUND', result: null });
    }

    const payload = {
      status: 'OK',
      result: {
        place_id: `osm-${data.osm_type}-${data.osm_id}`,
        name: data.display_name,
        geometry: {
          location: {
            lat: parseFloat(data.lat),
            lng: parseFloat(data.lon),
          },
        },
      },
    };

    reverseCache.set(cacheKey, payload);
    console.log(`[geocode/reverse] 📦 "${data.display_name?.substring(0, 40)}" (cached)`);
    res.json(payload);
  } catch (err) {
    console.error('[geocode/reverse] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/geocode/stats ───────────────────────────────────────────────────
router.get('/stats', (_req, res) => {
  res.json({
    nominatimCalls: calls,
    cacheSize: {
      autocomplete: autocompleteCache._size?.() ?? '—',
      details: detailsCache._size?.() ?? '—',
      reverse: reverseCache._size?.() ?? '—',
    },
  });
});

module.exports = router;
