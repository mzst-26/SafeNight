const fs = require('fs');
const path = require('path');
const {
  settlementClassAt,
  SETTLEMENT_CLASS_ORDER,
  settlementRadiusKm,
  classForPopulation,
} = require('../../../../src/safety/scoring/settlements');

const DATA_PATH = path.join(__dirname, '../../../../src/safety/data/settlements.json');

// Fixture helpers: a local frame around (50, -4). 1 km north = 1/111.2 deg lat, 1 km east = 1/(111.2*cos50) deg lng.
const ORIGIN = { lat: 50, lng: -4 };
function at(dxKm, dyKm = 0) {
  return {
    lat: ORIGIN.lat + dyKm / 111.2,
    lng: ORIGIN.lng + dxKm / (111.2 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
  };
}
function place(name, place, pop, dxKm = 0, dyKm = 0) {
  const p = at(dxKm, dyKm);
  return { name, place, lat: p.lat, lng: p.lng, population: pop };
}

describe('SETTLEMENT_CLASS_ORDER', () => {
  test('lists the classes from largest to smallest, rural last', () => {
    expect(SETTLEMENT_CLASS_ORDER).toEqual(['metropolis', 'city', 'largeTown', 'town', 'village', 'rural']);
    expect(Object.isFrozen(SETTLEMENT_CLASS_ORDER)).toBe(true);
  });
});

describe('classForPopulation (thresholds)', () => {
  test.each([
    [1000000, 'metropolis'],
    [999999, 'city'],
    [100000, 'city'],
    [99999, 'largeTown'],
    [30000, 'largeTown'],
    [29999, 'town'],
    [5000, 'town'],
    [4999, 'village'],
    [1, 'village'],
  ])('population %i is %s', (population, cls) => {
    expect(classForPopulation(population)).toBe(cls);
  });
});

describe('settlementRadiusKm', () => {
  test('is 0.6 * sqrt(population / 1000), clamped to [0.8, 12] km', () => {
    expect(settlementRadiusKm(4000)).toBeCloseTo(1.2, 9);
    expect(settlementRadiusKm(264695)).toBeCloseTo(0.6 * Math.sqrt(264.695), 9);
    expect(settlementRadiusKm(5)).toBe(0.8);
    expect(settlementRadiusKm(8908083)).toBe(12);
  });
});

describe('settlementClassAt (fixture gazetteer)', () => {
  test('returns rural with null name and distance when no settlement covers the point', () => {
    expect(settlementClassAt(ORIGIN.lat, ORIGIN.lng, [])).toEqual({
      class: 'rural', population: 0, name: null, distanceKm: null,
    });
  });

  test('classifies a point inside a town radius by that town population', () => {
    const src = [place('Fixtown', 'town', 40000)];
    const r = settlementClassAt(...Object.values(at(1)), src);
    expect(r.class).toBe('largeTown');
    expect(r.name).toBe('Fixtown');
    expect(r.population).toBe(40000);
    expect(r.distanceKm).toBeCloseTo(1, 1);
  });

  test('a point beyond the settlement radius is rural', () => {
    // 40k radius is 0.6*sqrt(40) = 3.79 km; 6 km away is outside it.
    const src = [place('Fixtown', 'town', 40000)];
    const p = at(6);
    expect(settlementClassAt(p.lat, p.lng, src).class).toBe('rural');
  });

  test('when two cities or towns cover a point, the largest population wins even if it is further', () => {
    const src = [place('Small', 'town', 40000, 0.2, 0), place('Big', 'city', 150000, 0.5, 0)];
    const p = at(0.2);
    const r = settlementClassAt(p.lat, p.lng, src);
    expect(r.name).toBe('Big');
    expect(r.class).toBe('city');
  });

  test('a tie in population is broken by distance', () => {
    const src = [place('Far', 'town', 40000, 2, 0), place('Near', 'town', 40000, 0, 0)];
    const p = at(0.1);
    expect(settlementClassAt(p.lat, p.lng, src).name).toBe('Near');
  });

  test('a suburb never sets the class while a city or town covers the point', () => {
    const src = [place('Hometown', 'town', 50000), place('Suburbia', 'suburb', 98000, 0.1, 0)];
    const p = at(0.2);
    const r = settlementClassAt(p.lat, p.lng, src);
    expect(r.name).toBe('Hometown');
    expect(r.class).toBe('largeTown');
  });

  test('a suburb sets the class when no city or town covers the point', () => {
    const src = [place('Suburbia', 'suburb', 98000)];
    const r = settlementClassAt(ORIGIN.lat, ORIGIN.lng, src);
    expect(r.name).toBe('Suburbia');
    expect(r.class).toBe('largeTown');
  });

  test('a village with fewer than 5000 people classifies as village', () => {
    const src = [place('Hamlety', 'village', 4000)];
    const inside = at(1.0);
    const outside = at(1.5); // village radius is 1.2 km
    expect(settlementClassAt(inside.lat, inside.lng, src).class).toBe('village');
    expect(settlementClassAt(outside.lat, outside.lng, src).class).toBe('rural');
  });

  test('a population of 1,000,000 or more is metropolis', () => {
    const src = [place('Megaville', 'city', 1200000)];
    expect(settlementClassAt(ORIGIN.lat, ORIGIN.lng, src).class).toBe('metropolis');
  });

  test('loads the source once per array, caching the index', () => {
    const load = jest.fn(() => [place('Fixtown', 'town', 40000)]);
    settlementClassAt(ORIGIN.lat, ORIGIN.lng, load);
    settlementClassAt(ORIGIN.lat, ORIGIN.lng, load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['latitude missing', [undefined, 0]],
    ['latitude a string', ['50', -4]],
    ['latitude above 90', [91, 0]],
    ['longitude NaN', [50, NaN]],
    ['longitude below -180', [50, -181]],
  ])('throws TypeError for %s', (_label, [lat, lng]) => {
    expect(() => settlementClassAt(lat, lng, [])).toThrow(TypeError);
  });

  test('throws TypeError for a source that is neither an array nor a function', () => {
    expect(() => settlementClassAt(50, -4, 42)).toThrow(TypeError);
  });

  test('throws TypeError for a malformed settlement record', () => {
    const bad = [{ name: 'X', place: 'town', lat: 'north', lng: -4, population: 10 }];
    expect(() => settlementClassAt(50, -4, bad)).toThrow(TypeError);
  });
});

describe('settlementClassAt (shipped gazetteer)', () => {
  const samples = [
    ['Plymouth Armada Way area', 50.3712, -4.1430, ['city']],
    ['Eggbuckland (inherits Plymouth, not a village)', 50.4010, -4.1170, ['city']],
    ['Central Park, Plymouth', 50.3880, -4.1530, ['city']],
    ['Exeter centre', 50.7236, -3.5275, ['city']],
    ['London Soho', 51.5136, -0.1365, ['metropolis']],
    ['Brixton (London, not the Streatham suburb)', 51.4600, -0.1150, ['metropolis']],
    ['Yelverton (report what comes back)', 50.4944, -4.0850, ['village', 'rural']],
    ['North Sea', 54.5, 2.0, ['rural']],
  ];

  test.each(samples)('%s', (_label, lat, lng, allowed) => {
    expect(allowed).toContain(settlementClassAt(lat, lng).class);
  });

  test('Brixton and Soho resolve to London', () => {
    expect(settlementClassAt(51.4600, -0.1150).name).toBe('London');
    expect(settlementClassAt(51.5136, -0.1365).name).toBe('London');
  });

  test('Plymouth resolves to Plymouth with its OSM population', () => {
    const r = settlementClassAt(50.3712, -4.1430);
    expect(r.name).toBe('Plymouth');
    expect(r.population).toBe(264695);
  });

  test('the North Sea point is rural with null name and distance', () => {
    expect(settlementClassAt(54.5, 2.0)).toEqual({ class: 'rural', population: 0, name: null, distanceKm: null });
  });

  test('the shipped file has a header and a count that matches its settlements', () => {
    const doc = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    expect(doc.generatedFrom).toBe('OpenStreetMap (ODbL)');
    expect(doc.attribution).toBe('© OpenStreetMap contributors');
    expect(doc.count).toBe(doc.settlements.length);
    expect(doc.settlements.length).toBeGreaterThan(900);
  });

  test('the shipped file is at most ~150 KB', () => {
    expect(fs.statSync(DATA_PATH).size).toBeLessThanOrEqual(150 * 1024);
  });
});
