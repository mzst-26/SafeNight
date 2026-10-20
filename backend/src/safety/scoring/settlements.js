/**
 * Settlement class of a point (spec section 12).
 *
 * Rule:
 *   1. A settlement covers a point when the great-circle distance is at most its radius of influence,
 *      radiusKm = clamp(0.6 * sqrt(population / 1000), 0.8, 12) (thresholds in config.SETTLEMENT).
 *   2. Cities and towns are considered first. Among the covering ones the largest population wins
 *      (a tie goes to the nearer one).
 *   3. Only if no city or town covers the point are villages and suburbs considered, by the same rule.
 *      A suburb therefore never sets the class of a point inside a city or town.
 *   4. The class follows from the population of the chosen settlement:
 *      metropolis >= 1,000,000; city >= 100,000; largeTown >= 30,000; town >= 5,000; otherwise village.
 *      A village or suburb entry is classed the same way, so a 5,000+ village reads as 'town'.
 *   5. 'rural' when nothing covers the point.
 *
 * The index is a coarse lat/lng grid (0.1 degree cells, about 11 km by 7 km at UK latitudes), built
 * once per source and cached. The lookup window is the maximum radius, so every covering settlement is found.
 */

const path = require('path');
const config = require('./config');

const SETTLEMENT_CLASS_ORDER = Object.freeze(['metropolis', 'city', 'largeTown', 'town', 'village', 'rural']);
const CITY_TIER = Object.freeze(['city', 'town']);
const LOCAL_TIER = Object.freeze(['village', 'suburb']);
const GRID_CELL_DEG = 0.1;
const EARTH_RADIUS_KM = 6371.0088;
const DEFAULT_DATA_PATH = path.join(__dirname, '..', 'data', 'settlements.json');

const indexCache = new WeakMap();
let defaultIndex = null;

function classForPopulation(population) {
  const t = config.SETTLEMENT.CLASS_MIN_POPULATION;
  if (population >= t.metropolis) return 'metropolis';
  if (population >= t.city) return 'city';
  if (population >= t.largeTown) return 'largeTown';
  if (population >= t.town) return 'town';
  return 'village';
}

function settlementRadiusKm(population) {
  const r = config.SETTLEMENT.RADIUS_KM;
  const raw = r.PER_SQRT_THOUSAND * Math.sqrt(population / 1000);
  return Math.min(r.MAX, Math.max(r.MIN, raw));
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function cellKey(i, j) {
  return `${i}:${j}`;
}

function loadDefaultSettlements() {
  // Read once, on first use: the shipped gazetteer is about 90 KB.
  // eslint-disable-next-line global-require
  return require(DEFAULT_DATA_PATH).settlements;
}

function validateRecord(rec) {
  if (
    !rec || typeof rec !== 'object'
    || typeof rec.name !== 'string'
    || !Number.isFinite(rec.lat) || rec.lat < -90 || rec.lat > 90
    || !Number.isFinite(rec.lng) || rec.lng < -180 || rec.lng > 180
    || !Number.isFinite(rec.population) || rec.population <= 0
    || !CITY_TIER.concat(LOCAL_TIER).includes(rec.place)
  ) {
    throw new TypeError(`Invalid settlement record: ${JSON.stringify(rec)}`);
  }
}

function buildIndex(records) {
  const cells = new Map();
  for (const rec of records) {
    validateRecord(rec);
    const entry = {
      name: rec.name,
      place: rec.place,
      lat: rec.lat,
      lng: rec.lng,
      population: rec.population,
      radiusKm: settlementRadiusKm(rec.population),
      tier: CITY_TIER.includes(rec.place) ? 0 : 1,
    };
    const key = cellKey(Math.floor(rec.lat / GRID_CELL_DEG), Math.floor(rec.lng / GRID_CELL_DEG));
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(entry);
  }
  return cells;
}

function indexFor(source) {
  if (source === undefined) {
    if (!defaultIndex) defaultIndex = buildIndex(loadDefaultSettlements());
    return defaultIndex;
  }
  if (typeof source !== 'function' && !Array.isArray(source)) {
    throw new TypeError('settlement source must be an array of settlements or a function returning one');
  }
  if (!indexCache.has(source)) {
    const records = typeof source === 'function' ? source() : source;
    if (!Array.isArray(records)) throw new TypeError('settlement source loader must return an array');
    indexCache.set(source, buildIndex(records));
  }
  return indexCache.get(source);
}

function candidatesNear(index, lat, lng) {
  const maxKm = config.SETTLEMENT.RADIUS_KM.MAX;
  const dLat = maxKm / 111.32;
  const dLng = maxKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const i0 = Math.floor((lat - dLat) / GRID_CELL_DEG);
  const i1 = Math.floor((lat + dLat) / GRID_CELL_DEG);
  const j0 = Math.floor((lng - dLng) / GRID_CELL_DEG);
  const j1 = Math.floor((lng + dLng) / GRID_CELL_DEG);
  const out = [];
  for (let i = i0; i <= i1; i += 1) {
    for (let j = j0; j <= j1; j += 1) {
      const bucket = index.get(cellKey(i, j));
      if (bucket) out.push(...bucket);
    }
  }
  return out;
}

function coveringBest(candidates, lat, lng, tier) {
  let best = null;
  for (const c of candidates) {
    if (c.tier !== tier) continue;
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d > c.radiusKm) continue;
    if (
      !best
      || c.population > best.population
      || (c.population === best.population && d < best.distanceKm)
    ) {
      best = { ...c, distanceKm: d };
    }
  }
  return best;
}

/**
 * Settlement class at a point.
 * @param {number} lat  WGS84 latitude, -90..90
 * @param {number} lng  WGS84 longitude, -180..180
 * @param {Array|Function} [source] settlement records, or a zero-argument function returning them.
 *   Defaults to the shipped gazetteer (src/safety/data/settlements.json). The index is cached per source.
 * @returns {{class: string, population: number, name: string|null, distanceKm: number|null}}
 *   'rural' results carry population 0 and null name and distance.
 */
function settlementClassAt(lat, lng, source) {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new TypeError('lat must be a finite number between -90 and 90');
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new TypeError('lng must be a finite number between -180 and 180');
  }
  const index = indexFor(source);
  const candidates = candidatesNear(index, lat, lng);
  const chosen = coveringBest(candidates, lat, lng, 0) || coveringBest(candidates, lat, lng, 1);
  if (!chosen) {
    return { class: 'rural', population: 0, name: null, distanceKm: null };
  }
  return {
    class: classForPopulation(chosen.population),
    population: chosen.population,
    name: chosen.name,
    distanceKm: chosen.distanceKm,
  };
}

module.exports = {
  settlementClassAt,
  SETTLEMENT_CLASS_ORDER,
  settlementRadiusKm,
  classForPopulation,
};
