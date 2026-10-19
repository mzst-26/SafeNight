#!/usr/bin/env node
/**
 * lamp-thinning.js — Monotonicity check: removing street lamps must not raise effectiveLit.
 *
 * Usage: node scripts/eval/lamp-thinning.js [--bbox=plymouth|bristol|s,w,n,e] [--fraction=0.5] [--seed=1]
 *        [--sample=N] [--data=<dir>] [--out=<file>] [--json]
 *
 * Sample: lit=yes ways in the bbox. Reported twice: with the lit tag visible (explicit tags win, so the
 * estimate cannot move) and with the tag hidden (lamps drive the estimate, the informative case).
 */

const fs = require('fs');
const path = require('path');
const { parseArgs, parseBbox, DEFAULT_DATA_DIRS, intFlag, numberFlag } = require('./lib/cli');
const { collectStudyArea } = require('./lib/collect');
const { thinLampsAndCompare } = require('./lib/thinning');
const { mulberry32, shuffleInPlace } = require('./lib/spatial');
const { formatThinning } = require('./lib/report');

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const bbox = parseBbox(flags.bbox || 'plymouth');
  const dataDir = flags.data || DEFAULT_DATA_DIRS.find((d) => fs.existsSync(path.join(d, 'uk-roads.jsonl')));
  if (!dataDir) throw new Error('published OSM data not found; pass --data=<dir>');
  const fraction = numberFlag(flags, 'fraction', 0.5);
  if (fraction <= 0 || fraction >= 1) throw new Error('--fraction must be between 0 and 1');
  const seed = intFlag(flags, 'seed', 1);
  const sample = intFlag(flags, 'sample', 2000);
  const log = (msg) => process.stderr.write(`${msg}\n`);
  const started = Date.now();

  const area = await collectStudyArea({
    roadsFile: path.join(dataDir, 'uk-roads.jsonl'),
    lampsFile: path.join(dataDir, 'uk-nodes.jsonl'),
    bbox,
    sample: 0,
    seed,
    log,
  });
  const sampleWays = area.records.filter((r) => r.lit === 'yes' && area.scoreable(r));
  if (sampleWays.length === 0) throw new Error(`no lit=yes walkable ways in bbox ${bbox.name}`);
  const sampled = sampleWays.length > sample
    ? shuffleInPlace([...sampleWays], mulberry32(seed)).slice(0, sample)
    : sampleWays;
  log(`[thinning] ${sampled.length} lit=yes ways, ${area.lamps.length} lamps, removing ${fraction * 100}%`);

  const common = { sample: sampled, lamps: area.lamps, records: area.records, areaKm: area.areaKm, roadIndex: area.roadIndex, fraction, seed };
  const tagVisible = thinLampsAndCompare({ ...common, hideTag: false }).summary;
  const tagHidden = thinLampsAndCompare({ ...common, hideTag: true }).summary;

  const output = {
    generatedAt: new Date().toISOString(),
    bbox,
    dataDir,
    fraction,
    seed,
    stats: area.stats,
    summaries: { tagVisible, tagHidden },
    runtimeSec: Math.round((Date.now() - started) / 1000),
  };
  const outFile = flags.out || path.join(__dirname, 'results', `lamp-thinning-${bbox.name}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`);

  process.stdout.write([
    `lamp thinning, bbox ${bbox.name}, remove ${fraction * 100}% of lamps (seed ${seed})`,
    '',
    formatThinning('tag visible (explicit tag wins, expected no change):', tagVisible),
    '',
    formatThinning('tag hidden (lamps drive the estimate):', tagHidden),
    '',
    `results written to ${outFile} (${output.runtimeSec}s)`,
  ].join('\n') + '\n');
  if (flags.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`lamp-thinning failed: ${err.message}\n`);
  process.exitCode = 1;
});
