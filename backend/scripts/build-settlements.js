#!/usr/bin/env node
/**
 * Builds the shipped UK settlement gazetteer (spec section 12) from a local OSM extract.
 *
 * Usage:
 *   node scripts/build-settlements.js [--input=<pbf>] [--output=<json>] [--generated-at=<ISO-8601>]
 *
 * Defaults: input backend/data/gb-latest.osm.pbf, output src/safety/data/settlements.json.
 * Deterministic and offline: it only runs osmium on the local PBF. Without --generated-at the
 * output carries no timestamp, so re-running on the same input gives byte-identical output.
 *
 * Pipeline:
 *   1. osmium tags-filter  n/place=city,town,village,suburb  -> temp .osm.pbf
 *   2. osmium export -f geojsonseq                           -> temp .geojsonseq (streamed line by line)
 *   3. keep rules, sanitising rules, rounding, sorting       -> settlements.json
 *   The temp directory is removed in all cases.
 *
 * Keep rules:
 *   - a name is required; population must parse as a plain positive integer (see parsePopulation)
 *   - every city and town with population, above a minimum floor (city/town: 100 people)
 *   - villages and suburbs only from 5,000 people
 * Sanitising rules (implausible values are dropped, not clamped, so they cannot set a class):
 *   - town > 300,000, village > 60,000, suburb > 150,000, city > 10,000,000
 *
 * Output entries: {name, place, lat, lng, population}; coordinates rounded to 5 dp.
 * Entries are sorted by place class (city, town, village, suburb), then population descending,
 * then name, lat and lng.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFile } = require('child_process');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const DEFAULT_INPUT = path.join(BACKEND_ROOT, 'data', 'gb-latest.osm.pbf');
const DEFAULT_OUTPUT = path.join(BACKEND_ROOT, 'src', 'safety', 'data', 'settlements.json');

const PLACE_TAG_FILTER = 'n/place=city,town,village,suburb';
const PLACE_ORDER = ['city', 'town', 'village', 'suburb'];
const MIN_POPULATION = { city: 100, town: 100, village: 5000, suburb: 5000 };
const MAX_POPULATION = { city: 10000000, town: 300000, village: 60000, suburb: 150000 };

const GENERATED_FROM = 'OpenStreetMap (ODbL)';
const ATTRIBUTION = '© OpenStreetMap contributors';

// Plain integers with optional thousands separators and an optional leading tilde.
// Anything else ("approx 9,000", "1.5", "1.2 million") is rejected rather than guessed.
const POPULATION_RE = /^~?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*$/;

function parsePopulation(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const m = POPULATION_RE.exec(String(raw));
  if (!m) return null;
  const value = parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

function normaliseName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  return name.length > 0 ? name : null;
}

function featureToEntry(feature) {
  if (!feature || !feature.geometry || feature.geometry.type !== 'Point') return null;
  const props = feature.properties || {};
  const place = props.place;
  if (!PLACE_ORDER.includes(place)) return null;
  const name = normaliseName(props.name);
  if (!name) return null;
  const population = parsePopulation(props.population);
  if (population === null) return null;
  const [lng, lat] = feature.geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { name, place, lat: round5(lat), lng: round5(lng), population };
}

function keepSettlement(entry) {
  const { place, population } = entry;
  if (population < MIN_POPULATION[place]) return false;
  if (population > MAX_POPULATION[place]) return false;
  return true;
}

function compareEntries(a, b) {
  return (
    PLACE_ORDER.indexOf(a.place) - PLACE_ORDER.indexOf(b.place) ||
    b.population - a.population ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
    a.lat - b.lat ||
    a.lng - b.lng
  );
}

/** Streams a geojsonseq file (RFC 8142: optional leading record separator) and yields kept entries. */
async function* readEntries(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.replace(/^\x1e/, '').trim();
    if (!trimmed) continue;
    const entry = featureToEntry(JSON.parse(trimmed));
    if (entry && keepSettlement(entry)) yield entry;
  }
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args[0]} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

function validateGeneratedAt(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new TypeError('generatedAt must be an ISO-8601 date string');
  }
  return value;
}

async function buildSettlements({
  inputPath = DEFAULT_INPUT,
  outputPath = DEFAULT_OUTPUT,
  generatedAt,
  exec = runCommand,
} = {}) {
  const stamp = validateGeneratedAt(generatedAt);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settlements-'));
  try {
    const pbf = path.join(workDir, 'places.osm.pbf');
    const geojson = path.join(workDir, 'places.geojsonseq');
    await exec('osmium', ['tags-filter', inputPath, PLACE_TAG_FILTER, '-o', pbf, '--overwrite']);
    await exec('osmium', ['export', pbf, '-f', 'geojsonseq', '-o', geojson, '--overwrite']);

    const settlements = [];
    for await (const entry of readEntries(geojson)) settlements.push(entry);
    settlements.sort(compareEntries);

    const header = { generatedFrom: GENERATED_FROM, attribution: ATTRIBUTION };
    if (stamp !== undefined) header.generatedAt = stamp;
    const doc = { ...header, count: settlements.length, settlements };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(doc)}\n`);
    return { count: settlements.length, outputPath };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const opts = { inputPath: DEFAULT_INPUT, outputPath: DEFAULT_OUTPUT, generatedAt: undefined };
  for (const arg of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (!m) throw new Error(`Unknown argument: ${arg}`);
    if (m[1] === 'input') opts.inputPath = m[2];
    else if (m[1] === 'output') opts.outputPath = m[2];
    else if (m[1] === 'generated-at') opts.generatedAt = m[2];
    else throw new Error(`Unknown option: --${m[1]}`);
  }
  return opts;
}

module.exports = {
  parsePopulation,
  featureToEntry,
  keepSettlement,
  buildSettlements,
  parseArgs,
};

if (require.main === module) {
  buildSettlements(parseArgs(process.argv.slice(2)))
    .then(({ count, outputPath }) => {
      console.log(`Wrote ${count} settlements to ${outputPath}`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}
