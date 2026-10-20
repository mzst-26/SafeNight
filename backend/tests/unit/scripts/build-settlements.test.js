const fs = require('fs');
const os = require('os');
const path = require('path');
const build = require('../../../scripts/build-settlements');

const RS = '\x1e';

function feature({ name, place, lng, lat, population, extra = {} }) {
  const properties = { name, place, ...extra };
  if (population !== undefined) properties.population = population;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties,
  };
}

function seq(features, { withRecordSeparator = false } = {}) {
  return features
    .map((f) => (withRecordSeparator ? RS : '') + JSON.stringify(f))
    .join('\n') + '\n';
}

describe('parsePopulation', () => {
  test('accepts plain integers and comma thousands separators', () => {
    expect(build.parsePopulation('264695')).toBe(264695);
    expect(build.parsePopulation('264,695')).toBe(264695);
    expect(build.parsePopulation(' 9,000 ')).toBe(9000);
  });

  test('accepts a leading tilde, as OSM uses it for estimates', () => {
    expect(build.parsePopulation('~9000')).toBe(9000);
  });

  test('rejects values that are not a plain positive integer', () => {
    expect(build.parsePopulation('approx 9,000')).toBeNull();
    expect(build.parsePopulation('1.5')).toBeNull();
    expect(build.parsePopulation('1.2 million')).toBeNull();
    expect(build.parsePopulation('9,00')).toBeNull();
    expect(build.parsePopulation('0')).toBeNull();
    expect(build.parsePopulation('-5')).toBeNull();
    expect(build.parsePopulation('')).toBeNull();
    expect(build.parsePopulation(undefined)).toBeNull();
  });
});

describe('featureToEntry', () => {
  test('maps a place point to {name, place, lat, lng, population} with 5 dp coordinates', () => {
    const entry = build.featureToEntry(
      feature({ name: 'Plymouth', place: 'city', lng: -4.1423456789, lat: 50.37141234, population: '264695' }),
    );
    expect(entry).toEqual({
      name: 'Plymouth',
      place: 'city',
      lat: 50.37141,
      lng: -4.14235,
      population: 264695,
    });
  });

  test('drops features without a usable name', () => {
    expect(build.featureToEntry(feature({ name: '  ', place: 'town', lng: 0, lat: 50, population: '9000' }))).toBeNull();
    expect(build.featureToEntry(feature({ place: 'town', lng: 0, lat: 50, population: '9000' }))).toBeNull();
  });

  test('drops non-point geometries and place classes outside the four kept', () => {
    const line = { ...feature({ name: 'X', place: 'town', lng: 0, lat: 50, population: '9000' }), geometry: { type: 'LineString', coordinates: [[0, 50], [1, 51]] } };
    expect(build.featureToEntry(line)).toBeNull();
    expect(build.featureToEntry(feature({ name: 'Hamlet', place: 'hamlet', lng: 0, lat: 50, population: '900' }))).toBeNull();
  });

  test('trims and collapses whitespace in names', () => {
    const entry = build.featureToEntry(feature({ name: '  Stoke   Damerel ', place: 'suburb', lng: -4.1, lat: 50.4, population: '60000' }));
    expect(entry.name).toBe('Stoke Damerel');
  });
});

describe('keepSettlement (inclusion and sanitising rules)', () => {
  const base = { name: 'Test', lat: 50, lng: -4 };

  test('keeps every city and town that has a population above the floor', () => {
    expect(build.keepSettlement({ ...base, place: 'city', population: 3500 })).toBe(true);
    expect(build.keepSettlement({ ...base, place: 'town', population: 1751 })).toBe(true);
    expect(build.keepSettlement({ ...base, place: 'town', population: 660 })).toBe(true);
  });

  test('keeps villages and suburbs only from 5000 people', () => {
    expect(build.keepSettlement({ ...base, place: 'village', population: 4999 })).toBe(false);
    expect(build.keepSettlement({ ...base, place: 'village', population: 5000 })).toBe(true);
    expect(build.keepSettlement({ ...base, place: 'suburb', population: 4999 })).toBe(false);
    expect(build.keepSettlement({ ...base, place: 'suburb', population: 58055 })).toBe(true);
  });

  test('drops implausible populations: town above 300k, village above 60k, city above 10M, town below 100', () => {
    expect(build.keepSettlement({ ...base, place: 'town', population: 1500000 })).toBe(false);
    expect(build.keepSettlement({ ...base, place: 'town', population: 285000 })).toBe(true);
    expect(build.keepSettlement({ ...base, place: 'village', population: 61000 })).toBe(false);
    expect(build.keepSettlement({ ...base, place: 'city', population: 10000001 })).toBe(false);
    expect(build.keepSettlement({ ...base, place: 'city', population: 8908083 })).toBe(true);
    expect(build.keepSettlement({ ...base, place: 'town', population: 15 })).toBe(false);
  });
});

describe('buildSettlements', () => {
  const FIXTURE = seq([
    feature({ name: 'Zeta', place: 'town', lng: -3.5, lat: 50.7, population: '40,000' }),
    feature({ name: 'Plymouth', place: 'city', lng: -4.1423456789, lat: 50.37141234, population: '264695' }),
    feature({ name: 'Alpha', place: 'town', lng: -3.6, lat: 50.8, population: '40000' }),
    feature({ name: 'Nowhere', place: 'village', lng: -3.0, lat: 50.0 }),
    feature({ name: 'Big Village', place: 'village', lng: -3.1, lat: 50.1, population: '6000' }),
    feature({ name: 'Stub', place: 'suburb', lng: -3.2, lat: 50.2, population: '~9000' }),
    feature({ name: 'Wrong', place: 'town', lng: -3.3, lat: 50.3, population: '1500000' }),
    feature({ name: 'Approx', place: 'town', lng: -3.4, lat: 50.4, population: 'approx 9,000' }),
  ]);

  let work;
  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'settlements-test-'));
  });
  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  // Fake osmium: records the calls and writes the fixture where the export step points.
  function fakeExec(fixture) {
    const calls = [];
    const exec = async (cmd, args) => {
      calls.push([cmd, ...args]);
      const out = args[args.indexOf('-o') + 1];
      if (args[0] === 'export') fs.writeFileSync(out, fixture);
      else fs.writeFileSync(out, 'pbf');
    };
    return { exec, calls };
  }

  test('runs osmium tags-filter for the four place classes, then exports geojsonseq to a temp file', async () => {
    const { exec, calls } = fakeExec(FIXTURE);
    const out = path.join(work, 'settlements.json');
    await build.buildSettlements({ inputPath: '/data/gb.osm.pbf', outputPath: out, exec });

    const [filter, exp] = calls;
    expect(filter[0]).toBe('osmium');
    expect(filter.slice(1, 3)).toEqual(['tags-filter', '/data/gb.osm.pbf']);
    expect(filter).toContain('n/place=city,town,village,suburb');
    expect(exp.slice(1, 3)).toEqual(['export', expect.any(String)]);
    expect(exp).toEqual(expect.arrayContaining(['-f', 'geojsonseq']));
    const tmpFile = exp[exp.indexOf('-o') + 1];
    expect(tmpFile.startsWith(os.tmpdir())).toBe(true);
  });

  test('removes its temporary directory, even when osmium fails', async () => {
    let seen;
    const exec = async (cmd, args) => {
      seen = path.dirname(args[args.indexOf('-o') + 1]);
      throw new Error('osmium exploded');
    };
    await expect(build.buildSettlements({ inputPath: '/x.pbf', outputPath: path.join(work, 'o.json'), exec }))
      .rejects.toThrow('osmium exploded');
    expect(fs.existsSync(seen)).toBe(false);
  });

  test('writes the header and the kept settlements, sorted deterministically', async () => {
    const { exec } = fakeExec(FIXTURE);
    const out = path.join(work, 'settlements.json');
    const result = await build.buildSettlements({ inputPath: '/x.pbf', outputPath: out, exec });
    const doc = JSON.parse(fs.readFileSync(out, 'utf8'));

    expect(doc.generatedFrom).toBe('OpenStreetMap (ODbL)');
    expect(doc.attribution).toBe('© OpenStreetMap contributors');
    expect(doc).not.toHaveProperty('generatedAt');
    expect(doc.count).toBe(doc.settlements.length);
    expect(result.count).toBe(doc.settlements.length);
    expect(doc.settlements.map((s) => s.name)).toEqual(['Plymouth', 'Alpha', 'Zeta', 'Big Village', 'Stub']);
    expect(doc.settlements[0]).toEqual({
      name: 'Plymouth', place: 'city', lat: 50.37141, lng: -4.14235, population: 264695,
    });
  });

  test('writes generatedAt only when one is passed, and rejects a non-ISO value', async () => {
    const { exec } = fakeExec(FIXTURE);
    const out = path.join(work, 'settlements.json');
    await build.buildSettlements({ inputPath: '/x.pbf', outputPath: out, exec, generatedAt: '2026-10-20T00:00:00.000Z' });
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).generatedAt).toBe('2026-10-20T00:00:00.000Z');

    await expect(build.buildSettlements({ inputPath: '/x.pbf', outputPath: out, exec, generatedAt: 'yesterday' }))
      .rejects.toThrow(TypeError);
  });

  test('is byte-identical across runs and independent of input line order and record separators', async () => {
    const out1 = path.join(work, 'a.json');
    const out2 = path.join(work, 'b.json');
    const lines = FIXTURE.trim().split('\n');
    const reversed = lines.reverse().map((l) => RS + l).join('\n') + '\n';
    await build.buildSettlements({ inputPath: '/x.pbf', outputPath: out1, exec: fakeExec(FIXTURE).exec });
    await build.buildSettlements({ inputPath: '/x.pbf', outputPath: out2, exec: fakeExec(reversed).exec });
    expect(fs.readFileSync(out2, 'utf8')).toBe(fs.readFileSync(out1, 'utf8'));
  });

  test('ends the file with a newline and keeps it under 150 KB for a realistic count', async () => {
    const { exec } = fakeExec(FIXTURE);
    const out = path.join(work, 'settlements.json');
    await build.buildSettlements({ inputPath: '/x.pbf', outputPath: out, exec });
    const text = fs.readFileSync(out, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(Buffer.byteLength(text)).toBeLessThan(150 * 1024);
  });
});

describe('parseArgs', () => {
  test('defaults to the repo data paths and no generatedAt', () => {
    const opts = build.parseArgs([]);
    expect(opts.inputPath).toMatch(/backend[\\/]data[\\/]gb-latest\.osm\.pbf$/);
    expect(opts.outputPath).toMatch(/src[\\/]safety[\\/]data[\\/]settlements\.json$/);
    expect(opts.generatedAt).toBeUndefined();
  });

  test('accepts --generated-at, --input and --output', () => {
    const opts = build.parseArgs(['--generated-at=2026-10-20T00:00:00Z', '--input=/a.pbf', '--output=/b.json']);
    expect(opts).toMatchObject({ generatedAt: '2026-10-20T00:00:00Z', inputPath: '/a.pbf', outputPath: '/b.json' });
  });
});
