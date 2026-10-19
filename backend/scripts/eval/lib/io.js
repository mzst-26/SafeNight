/**
 * io.js — Streaming readers for the published OSM JSONL files (multi-GB; never loaded whole).
 */

const fs = require('fs');
const readline = require('readline');

const BBOX_TAIL = /"bbox":\{"minLon":(-?[\d.]+(?:e-?\d+)?),"minLat":(-?[\d.]+(?:e-?\d+)?),"maxLon":(-?[\d.]+(?:e-?\d+)?),"maxLat":(-?[\d.]+(?:e-?\d+)?)\}\}\s*$/;
const PROGRESS_EVERY = 1000000;

/**
 * Read the way bbox from the end of a uk-roads.jsonl line without parsing the whole line.
 * @param {string} line
 * @returns {{minLon: number, minLat: number, maxLon: number, maxLat: number}|null}
 */
function parseTrailingBbox(line) {
  const tail = line.length > 400 ? line.slice(-400) : line;
  const m = BBOX_TAIL.exec(tail);
  if (!m) return null;
  return { minLon: Number(m[1]), minLat: Number(m[2]), maxLon: Number(m[3]), maxLat: Number(m[4]) };
}

/** Does a [minLon..maxLat] box overlap bbox {south, west, north, east} grown by margin degrees? */
function overlaps(box, bbox, margin = 0) {
  return box.maxLon >= bbox.west - margin
    && box.minLon <= bbox.east + margin
    && box.maxLat >= bbox.south - margin
    && box.minLat <= bbox.north + margin;
}

/** Call fn(line) for every line of a file. Resolves with the number of lines read. */
function forEachLine(file, fn, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(file, { highWaterMark: 1 << 20 });
    input.on('error', reject);
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    let count = 0;
    rl.on('line', (line) => {
      count += 1;
      fn(line);
      if (count % PROGRESS_EVERY === 0) onProgress(count);
    });
    rl.on('close', () => resolve(count));
    rl.on('error', reject);
  });
}

/**
 * Stream the ways whose bbox overlaps the study area (grown by margin). Calls onWay(way) with the parsed way.
 * @returns {Promise<{lines: number, ways: number}>}
 */
async function streamWays(file, { bbox, margin = 0, onWay, onProgress }) {
  let ways = 0;
  const lines = await forEachLine(file, (line) => {
    if (!line.startsWith('{"type":"way"')) return;
    const box = parseTrailingBbox(line);
    if (box && !overlaps(box, bbox, margin)) return;
    const way = JSON.parse(line);
    ways += 1;
    onWay(way);
  }, onProgress);
  return { lines, ways };
}

/**
 * Stream street-lamp nodes within the study area (grown by margin). Calls onLamp({lat, lng}).
 * @returns {Promise<{lines: number, lamps: number}>}
 */
async function streamLamps(file, { bbox, margin = 0, onLamp, onProgress }) {
  let lamps = 0;
  const lines = await forEachLine(file, (line) => {
    if (!line.includes('"street_lamp"')) return;
    const node = JSON.parse(line);
    if (node.tags?.highway !== 'street_lamp') return;
    if (node.lat < bbox.south - margin || node.lat > bbox.north + margin) return;
    if (node.lon < bbox.west - margin || node.lon > bbox.east + margin) return;
    lamps += 1;
    onLamp({ lat: node.lat, lng: node.lon });
  }, onProgress);
  return { lines, lamps };
}

module.exports = { parseTrailingBbox, overlaps, forEachLine, streamWays, streamLamps };
