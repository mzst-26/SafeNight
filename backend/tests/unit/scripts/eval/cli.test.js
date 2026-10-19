const { parseBbox, parseArgs, intFlag } = require('../../../../scripts/eval/lib/cli');
const { parseTrailingBbox, overlaps } = require('../../../../scripts/eval/lib/io');
const { formatLeaveOut, fmt, table } = require('../../../../scripts/eval/lib/report');

describe('parseBbox', () => {
  test('resolves presets and explicit south,west,north,east', () => {
    expect(parseBbox('plymouth')).toMatchObject({ south: 50.30, west: -4.25, north: 50.46, east: -4.00, name: 'plymouth' });
    const custom = parseBbox('51.4,-2.7,51.52,-2.5');
    expect(custom).toMatchObject({ south: 51.4, north: 51.52, west: -2.7, east: -2.5 });
    expect(custom.name).toBe('51.40_-2.70_51.52_-2.50');
  });

  test('rejects malformed or inverted boxes', () => {
    expect(() => parseBbox('nowhere')).toThrow(/bbox must be/);
    expect(() => parseBbox('1,2,3')).toThrow(/bbox must be/);
    expect(() => parseBbox('52,-1,51,0')).toThrow(/south < north/);
  });
});

describe('parseArgs / intFlag', () => {
  test('reads --key=value and bare --flag', () => {
    const flags = parseArgs(['--bbox=plymouth', '--json', '--k=5']);
    expect(flags).toEqual({ bbox: 'plymouth', json: true, k: '5' });
    expect(intFlag(flags, 'k', 3)).toBe(5);
    expect(intFlag(flags, 'missing', 3)).toBe(3);
  });

  test('rejects positional arguments and non-integer values', () => {
    expect(() => parseArgs(['plymouth'])).toThrow(/unexpected argument/);
    expect(() => intFlag({ k: 'five' }, 'k', 1)).toThrow(/non-negative integer/);
  });
});

describe('bbox overlap helpers', () => {
  const bbox = { south: 50.3, west: -4.25, north: 50.46, east: -4.0 };
  test('parseTrailingBbox reads the way bbox from the end of a JSONL line', () => {
    const line = '{"type":"way","id":1,"nodes":[],"tags":{"highway":"footway"},"bbox":{"minLon":-4.1,"minLat":50.4,"maxLon":-4.09,"maxLat":50.41}}';
    expect(parseTrailingBbox(line)).toEqual({ minLon: -4.1, minLat: 50.4, maxLon: -4.09, maxLat: 50.41 });
  });

  test('overlaps is true for a box that only touches the margin', () => {
    expect(overlaps({ minLon: -4.3, minLat: 50.4, maxLon: -4.26, maxLat: 50.41 }, bbox, 0)).toBe(false);
    expect(overlaps({ minLon: -4.3, minLat: 50.4, maxLon: -4.26, maxLat: 50.41 }, bbox, 0.05)).toBe(true);
  });
});

describe('report formatting', () => {
  test('fmt renders missing values as a dash and numbers to 4 places', () => {
    expect(fmt(null)).toBe('-');
    expect(fmt(0.123456)).toBe('0.1235');
  });

  test('table pads columns so every row has the same width', () => {
    const out = table(['a', 'bb'], [['x', 1], ['yyy', 22]]).split('\n');
    expect(new Set(out.map((l) => l.length)).size).toBe(1);
  });

  test('formatLeaveOut names every model row and the tag-presence line', () => {
    const cal = [{ lo: 0.5, hi: 0.6, n: 2, meanPred: 0.55, observed: 0.5 }];
    const metrics = { n: 2, positiveRate: 0.5, meanPrediction: 0.5, brier: 0.25, logLoss: 0.69, ece: 0.05, auc: 0.5, accuracy: 0.5, calibration: cal };
    const mode = { effective: metrics, pLit: metrics, bySource: { prior: { n: 2, positiveRate: 0.5, meanEffective: 0.5, brier: 0.25 } } };
    const output = {
      bbox: { name: 'test', south: 0, west: 0, north: 1, east: 1 },
      stats: { lamps: 0, roadLines: 0 },
      tagPresence: { walkableWays: 4, withLitTag: 2, litTagShare: 0.5, labelledWays: 2, labelledShare: 0.5, litValueCounts: { yes: 1, no: 1 } },
      result: {
        n: 2, k: 5, seed: 1, blockM: 1000, blocks: 2, positiveRate: 0.5,
        modes: { hidden: mode, visible: mode },
        baselines: { global: metrics, roadClass: metrics, v1Rule: metrics },
      },
    };
    const text = formatLeaveOut(output);
    expect(text).toMatch(/Brier/);
    expect(text).toMatch(/baseline: old v1 rule/);
    expect(text).toMatch(/with any lit tag: 2/);
    expect(text).toMatch(/By source/);
  });
});
