/**
 * collect.js — One streaming pass over the roads and lamps files, keeping only what the evaluation needs.
 */

const { streamWays, streamLamps } = require('./io');
const { buildWayRecord, isLabelled, createTally, tallyRecord, summariseTally } = require('./records');
const { addAreaKm, buildRoadIndexFromRecords, ROAD_HIGHWAYS } = require('./features');
const { mulberry32, shuffleInPlace } = require('./spatial');

const SCORE_MARGIN_DEG = 0.0015; // ~150 m, grown around the bbox for lamps and area lengths
const LAMP_MARGIN_DEG = 0.001; // ~110 m, enough for the 30 m lamp radius and the 0.003 deg area cells

function insideBbox(bbox, lat, lng) {
  return lat >= bbox.south && lat <= bbox.north && lng >= bbox.west && lng <= bbox.east;
}

/**
 * @param {object} input
 * @param {string} input.roadsFile
 * @param {string} input.lampsFile
 * @param {{south, west, north, east}} input.bbox
 * @param {number} [input.sample=0] - cap on scored labelled ways (0 = all); seeded
 * @param {number} [input.seed=1]
 * @param {(msg: string) => void} [input.log]
 * @returns {Promise<{records, lamps, areaKm, roadIndex, tally, scoredIds, scoreable, stats}>}
 */
async function collectStudyArea({ roadsFile, lampsFile, bbox, sample = 0, seed = 1, log = () => {} }) {
  const records = [];
  const roadRecords = []; // trunk..service ways, segments kept for the road-proximity index
  const areaKm = new Map();
  const tally = createTally();
  const insideIds = new Set();
  const seenWayIds = new Set();
  let duplicateWayIds = 0;
  let geometryless = 0;

  log(`[roads] streaming ${roadsFile}`);
  const roads = await streamWays(roadsFile, {
    bbox,
    margin: SCORE_MARGIN_DEG,
    onProgress: (n) => log(`[roads] ${n.toLocaleString('en-GB')} lines`),
    onWay: (way) => {
      const rec = buildWayRecord(way);
      if (seenWayIds.has(rec.id)) duplicateWayIds += 1;
      seenWayIds.add(rec.id);
      if (rec.walkable && rec.anchor === null) geometryless += 1;
      if (!rec.walkable && rec.litVertices === null) return;
      const inside = rec.anchor !== null && insideBbox(bbox, rec.anchor.midLat, rec.anchor.midLng);
      if (rec.walkable) addAreaKm(areaKm, rec.segments);
      if (inside) {
        tallyRecord(tally, rec);
        if (isLabelled(rec)) insideIds.add(rec.id);
      }
      if (ROAD_HIGHWAYS.has(rec.highway) && rec.segments.length > 0) roadRecords.push({ highway: rec.highway, segments: rec.segments });
      rec.segments = null; // only the anchor and the lit vertices are needed from here on
      if (isLabelled(rec) || rec.litVertices !== null) records.push(rec);
    },
  });
  log(`[roads] done: ${roads.lines.toLocaleString('en-GB')} lines, ${roads.ways.toLocaleString('en-GB')} ways in margin, ${records.length} kept`);

  log(`[lamps] streaming ${lampsFile}`);
  const lamps = [];
  const lampStats = await streamLamps(lampsFile, {
    bbox,
    margin: LAMP_MARGIN_DEG,
    onProgress: (n) => log(`[lamps] ${n.toLocaleString('en-GB')} lines`),
    onLamp: (lamp) => lamps.push(lamp),
  });
  log(`[lamps] done: ${lamps.length} street lamps in bbox (+margin)`);

  const roadIndex = buildRoadIndexFromRecords(roadRecords);
  roadRecords.length = 0;

  let scoredIds = [...insideIds].sort((a, b) => a - b);
  if (sample > 0 && scoredIds.length > sample) {
    shuffleInPlace(scoredIds, mulberry32(seed));
    scoredIds = scoredIds.slice(0, sample).sort((a, b) => a - b);
  }
  const scoredSet = new Set(scoredIds);
  // Ids can repeat in the extract (a stub without geometry next to the full way); only the anchored copy scores.
  const scoreable = (rec) => rec.anchor !== null && scoredSet.has(rec.id);

  return {
    records,
    lamps,
    areaKm,
    roadIndex,
    tally: summariseTally(tally),
    scoredIds,
    scoreable,
    stats: {
      roadLines: roads.lines,
      roadWays: roads.ways,
      duplicateWayIds,
      walkableWaysWithoutGeometry: geometryless,
      lampLines: lampStats.lines,
      lamps: lamps.length,
    },
  };
}

module.exports = { collectStudyArea, insideBbox };
