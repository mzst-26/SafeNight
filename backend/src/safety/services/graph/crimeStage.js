/**
 * Crime factor: crime rows to recency-weighted counts, 500 m cells with road exposure, an area prior, and the
 * per-edge empirical-Bayes risk. An outage leaves the factor unknown, never safe.
 */
const {
  crimeRisk, weightedCrimePools, footfallAdjustedCount, guardianBonus,
} = require('../../scoring/crimeRisk');
const { GRAPH, CRIME_STATUS } = require('../../scoring/config');

/** Calendar month index (year * 12 + zero-based month) of a 'YYYY-MM' string, or null if malformed. */
function monthIndexOf(month) {
  const match = typeof month === 'string' ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month) : null;
  return match ? Number(match[1]) * 12 + (Number(match[2]) - 1) : null;
}

/** Largest non-null value, or -Infinity. A loop, not Math.max(...values): spread overflows the stack past ~125k rows. */
function newestIndex(indexes) {
  let newest = -Infinity;
  for (const value of indexes) {
    if (value !== null && value > newest) newest = value;
  }
  return newest;
}

/**
 * Adapter from crimeClient rows ({category, month: 'YYYY-MM'}) to the {category, monthsAgo}
 * input of weightedCrimeCount. Recency is measured back from the NEWEST month present in the
 * rows, not from today: the Police API publishes a couple of months late, so anchoring on the
 * clock would discount every crime in the latest release. A missing or malformed month counts
 * as the newest month (full weight), so bad rows never read as zero harm.
 * @param {Array<{category: string, month?: string}>} crimes
 * @returns {Array<{category: string, monthsAgo: number}>}
 */
function crimesToWeightedCounts(crimes) {
  const indexes = crimes.map((crime) => monthIndexOf(crime.month));
  const newest = newestIndex(indexes);
  return crimes.map((crime, i) => ({
    category: crime.category,
    monthsAgo: indexes[i] === null ? 0 : newest - indexes[i],
  }));
}

/** Returns a function mapping (lat, lng) to a ~500 m crime cell key, anchored at the bbox. */
function crimeCellKeyFn(bbox) {
  const midLatRad = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
  const latDeg = GRAPH.CRIME_CELL_M / GRAPH.METRES_PER_DEG_LAT;
  const lngDeg = GRAPH.CRIME_CELL_M / (GRAPH.METRES_PER_DEG_LAT * Math.cos(midLatRad));
  return (lat, lng) => `${Math.floor((lat - bbox.south) / latDeg)},${Math.floor((lng - bbox.west) / lngDeg)}`;
}

/** Crime rows with finite coordinates inside the bbox. */
function crimesInBbox(crimes, bbox, tick) {
  const inBbox = [];
  for (const crime of crimes || []) {
    tick();
    if (!crime || !Number.isFinite(crime.lat) || !Number.isFinite(crime.lng)) continue;
    if (crime.lat < bbox.south || crime.lat > bbox.north || crime.lng < bbox.west || crime.lng > bbox.east) continue;
    inBbox.push(crime);
  }
  return inBbox;
}

/**
 * Groups crimes into cells, with severity-weighted counts and the road length (km) of each cell, and derives
 * the area prior rate (weighted crimes per km, floored).
 * @param {Array<object>} crimes crimeClient rows with lat, lng, category, month.
 * @param {{south: number, north: number, west: number, east: number}} bbox
 * @param {Array<{dist: number, midLat: number, midLng: number}>} segments
 * @param {number} totalWayKm Total mapped walkable road length in km.
 * @param {() => void} tick
 * @returns {{cells: Map<string, object>, cellKeyOf: Function, priorRate: number}}
 */
function buildCrimeModel(crimes, bbox, segments, totalWayKm, tick) {
  const cellKeyOf = crimeCellKeyFn(bbox);
  const cells = new Map();
  const cellAt = (key) => {
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        crimes: [], violent: 0, nonViolent: 0, weightedCount: 0, exposureKm: 0,
      };
      cells.set(key, cell);
    }
    return cell;
  };
  const inBbox = crimesInBbox(crimes, bbox, tick);
  const weightedRows = crimesToWeightedCounts(inBbox);
  inBbox.forEach((crime, i) => cellAt(cellKeyOf(crime.lat, crime.lng)).crimes.push(weightedRows[i]));
  let totalWeighted = 0;
  for (const cell of cells.values()) {
    // Pedestrian-relevance weights, split into the violent pool (never discounted) and the rest (discounted by
    // presence per edge in crimeFactorAt). weightedCount is their undiscounted sum.
    const pools = weightedCrimePools(cell.crimes);
    cell.violent = pools.violent;
    cell.nonViolent = pools.nonViolent;
    cell.weightedCount = pools.violent + pools.nonViolent;
    totalWeighted += cell.weightedCount;
  }
  for (const p of segments) cellAt(cellKeyOf(p.midLat, p.midLng)).exposureKm += p.dist / 1000;
  const priorRate = Math.max(GRAPH.CRIME_PRIOR_FLOOR, totalWayKm > 0 ? totalWeighted / totalWayKm : 0);
  return { cells, cellKeyOf, priorRate };
}

/**
 * Crime factor for one edge: empirical-Bayes cell risk, or unknown during an outage.
 * @param {{cells: Map, cellKeyOf: Function, priorRate: number}} model
 * @param {number} midLat
 * @param {number} midLng
 * @param {'ok'|'unavailable'} crimeStatus
 * @param {{presence?: number, cctvCount?: number, openVenues?: number}} [context] presence at the build hour
 *   divides the non-violent pool by (1 + 2P)^0.5; cameras and open venues within 80 m give the capped guardian bonus.
 *   Omitted: no discount, no bonus.
 * @returns {{safety: number|null, n: number}}
 */
function crimeFactorAt(model, midLat, midLng, crimeStatus, { presence = 0, cctvCount = 0, openVenues = 0 } = {}) {
  if (crimeStatus !== CRIME_STATUS.OK) return { safety: null, n: 0 };
  const cell = model.cells.get(model.cellKeyOf(midLat, midLng));
  const crime = crimeRisk({
    weightedCount: footfallAdjustedCount({ violent: cell.violent, nonViolent: cell.nonViolent }, presence),
    exposureKm: cell.exposureKm,
    priorRate: model.priorRate,
    status: CRIME_STATUS.OK,
    guardian: guardianBonus({ cctvCount, openVenues }),
  });
  return { safety: 1 - crime.risk, n: crime.n };
}

module.exports = {
  monthIndexOf,
  newestIndex,
  crimesToWeightedCounts,
  crimeCellKeyFn,
  crimesInBbox,
  buildCrimeModel,
  crimeFactorAt,
};
