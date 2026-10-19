/**
 * cli.js — Argument parsing and bbox presets shared by the eval scripts.
 */

const path = require('path');
const os = require('os');

const BBOX_PRESETS = Object.freeze({
  plymouth: Object.freeze({ south: 50.30, west: -4.25, north: 50.46, east: -4.00 }),
  bristol: Object.freeze({ south: 51.40, west: -2.70, north: 51.52, east: -2.50 }),
});

const DEFAULT_DATA_DIRS = [
  process.env.SAFENIGHT_PUBLISHED_DIR,
  path.join(os.homedir(), 'Github', 'SafeNight', 'backend', 'data', 'published'),
].filter(Boolean);

/**
 * Parse a bbox from a preset name or "south,west,north,east".
 * @param {string} value
 * @returns {{south: number, west: number, north: number, east: number, name: string}}
 */
function parseBbox(value) {
  if (BBOX_PRESETS[value]) return { ...BBOX_PRESETS[value], name: value };
  const parts = String(value).split(',').map((v) => Number(v.trim()));
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
    throw new Error(`bbox must be a preset (${Object.keys(BBOX_PRESETS).join(', ')}) or south,west,north,east`);
  }
  const [south, west, north, east] = parts;
  if (south >= north || west >= east) throw new Error('bbox needs south < north and west < east');
  const name = `${south.toFixed(2)}_${west.toFixed(2)}_${north.toFixed(2)}_${east.toFixed(2)}`;
  return { south, west, north, east, name };
}

/**
 * Turn --key=value and --flag arguments into an object. Unknown positional args are rejected.
 * @param {string[]} argv
 * @returns {Record<string, string|true>}
 */
function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    const m = /^--([a-zA-Z][\w-]*)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`unexpected argument: ${arg}`);
    flags[m[1]] = m[2] === undefined ? true : m[2];
  }
  return flags;
}

function intFlag(flags, name, fallback) {
  if (flags[name] === undefined) return fallback;
  const v = Number(flags[name]);
  if (!Number.isInteger(v) || v < 0) throw new Error(`--${name} must be a non-negative integer`);
  return v;
}

function numberFlag(flags, name, fallback) {
  if (flags[name] === undefined) return fallback;
  const v = Number(flags[name]);
  if (!Number.isFinite(v)) throw new Error(`--${name} must be a number`);
  return v;
}

module.exports = { BBOX_PRESETS, DEFAULT_DATA_DIRS, parseBbox, parseArgs, intFlag, numberFlag };
