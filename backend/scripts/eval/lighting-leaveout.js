#!/usr/bin/env node
/**
 * lighting-leaveout.js — Does inferLighting predict lighting where the lit tag is hidden?
 *
 * Usage: node scripts/eval/lighting-leaveout.js [--bbox=plymouth|bristol|s,w,n,e] [--k=5] [--seed=1]
 *        [--block-m=1000] [--sample=N] [--data=<dir with uk-roads.jsonl and uk-nodes.jsonl>] [--out=<file>] [--json]
 *
 * Writes results/lighting-leaveout-<bbox>.json. Prints a table to stdout (and the JSON too with --json).
 */

const fs = require('fs');
const path = require('path');
const { parseArgs, parseBbox, DEFAULT_DATA_DIRS, intFlag, numberFlag } = require('./lib/cli');
const { collectStudyArea } = require('./lib/collect');
const { runLeaveOut } = require('./lib/leaveout');
const { formatLeaveOut } = require('./lib/report');

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const bbox = parseBbox(flags.bbox || 'plymouth');
  const dataDir = flags.data || DEFAULT_DATA_DIRS.find((d) => fs.existsSync(path.join(d, 'uk-roads.jsonl')));
  if (!dataDir) throw new Error('published OSM data not found; pass --data=<dir>');
  const k = intFlag(flags, 'k', 5);
  const seed = intFlag(flags, 'seed', 1);
  const sample = intFlag(flags, 'sample', 0);
  const blockM = numberFlag(flags, 'block-m', 1000);
  const log = (msg) => process.stderr.write(`${msg}\n`);
  const started = Date.now();

  const lampsFile = path.join(dataDir, 'uk-nodes.jsonl');
  const area = await collectStudyArea({
    roadsFile: path.join(dataDir, 'uk-roads.jsonl'),
    lampsFile,
    bbox,
    sample,
    seed,
    log,
  });
  if (area.scoredIds.length === 0) throw new Error(`no labelled ways (lit=yes/no, walkable) in bbox ${bbox.name}`);

  log(`[eval] ${area.scoredIds.length} labelled ways, ${k} folds`);
  const result = runLeaveOut({
    records: area.records,
    lamps: area.lamps,
    areaKm: area.areaKm,
    roadIndex: area.roadIndex,
    bbox,
    k,
    seed,
    blockM,
    scoreable: area.scoreable,
  });

  const output = {
    generatedAt: new Date().toISOString(),
    bbox,
    dataDir,
    sampleCap: sample,
    stats: area.stats,
    tagPresence: area.tally,
    result,
    runtimeSec: Math.round((Date.now() - started) / 1000),
  };
  const outFile = flags.out || path.join(__dirname, 'results', `lighting-leaveout-${bbox.name}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`);

  process.stdout.write(`${formatLeaveOut(output)}\n\nresults written to ${outFile} (${output.runtimeSec}s)\n`);
  if (flags.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`lighting-leaveout failed: ${err.message}\n`);
  process.exitCode = 1;
});
