const path = require('path');

const MODULE = path.resolve(__dirname, '../../../../../src/safety/services/graph/openingHours');
const hours = require(MODULE);

function loadWithParse() {
  const previous = process.env.SAFE_ROUTES_PARSE_PLACE_OPENING_HOURS;
  process.env.SAFE_ROUTES_PARSE_PLACE_OPENING_HOURS = '1';
  let mod;
  try {
    jest.isolateModules(() => { mod = require(MODULE); });
  } finally {
    if (previous === undefined) delete process.env.SAFE_ROUTES_PARSE_PLACE_OPENING_HOURS;
    else process.env.SAFE_ROUTES_PARSE_PLACE_OPENING_HOURS = previous;
  }
  return mod;
}

const NOON = new Date('2026-10-19T11:00:00Z'); // 12:00 London
const EIGHT_PM = new Date('2026-10-19T19:00:00Z');

describe('graph/openingHours heuristicOpen', () => {
  test.each([
    ['hospital', 3, true],
    ['pharmacy', 23, true],
    ['pub', 9, false],
    ['pub', 10, true],
    ['pub', 24, false],
    ['convenience', 5, false],
    ['convenience', 6, true],
    ['supermarket', 22, true],
    ['supermarket', 23, false],
    ['bank', 6, false],
    ['bank', 7, true],
    ['bank', 20, false],
  ])('%s at %i:00 open=%s', (type, hour, open) => {
    const tags = ['convenience', 'supermarket'].includes(type) ? { shop: type } : { amenity: type };
    expect(hours.heuristicOpen(tags, hour)).toBe(open);
  });

  test('type matching ignores case, and no tags falls to the daytime default', () => {
    expect(hours.heuristicOpen({ amenity: 'HOSPITAL' }, 3)).toBe(true);
    expect(hours.heuristicOpen({}, 12)).toBe(true);
    expect(hours.heuristicOpen(undefined, 21)).toBe(false);
  });
});

describe('graph/openingHours stripPublicHolidayClauses', () => {
  test('drops a PH rule and a PH suffix, keeps the rest', () => {
    expect(hours.stripPublicHolidayClauses('Mo-Su 09:00-17:00; PH off')).toBe('Mo-Su 09:00-17:00');
    expect(hours.stripPublicHolidayClauses('Mo-Su 09:00-17:00, PH off')).toBe('Mo-Su 09:00-17:00');
    expect(hours.stripPublicHolidayClauses('PH off')).toBe('');
    expect(hours.stripPublicHolidayClauses('Mo-Fr 08:00-12:00; Sa 09:00-10:00')).toBe('Mo-Fr 08:00-12:00; Sa 09:00-10:00');
  });
});

describe('graph/openingHours parseOpenState', () => {
  test('returns the parsed state, or null for nothing to parse and for garbage', () => {
    expect(hours.parseOpenState('Mo-Su 09:00-17:00', NOON)).toBe(true);
    expect(hours.parseOpenState('Mo-Su 09:00-17:00', EIGHT_PM)).toBe(false);
    expect(hours.parseOpenState('PH off', NOON)).toBeNull();
    expect(hours.parseOpenState('this is not opening hours', NOON)).toBeNull();
  });
});

describe('graph/openingHours isPlaceOpen', () => {
  test('with parsing off (default) the opening_hours tag is ignored and the heuristic decides', () => {
    expect(hours.isPlaceOpen({ amenity: 'cafe', opening_hours: 'Mo-Su 09:00-17:00' }, 20, EIGHT_PM)).toBe(true);
  });

  test('with parsing on, a parsed rule overrides the heuristic', () => {
    const parsed = loadWithParse();
    expect(parsed.isPlaceOpen({ amenity: 'cafe', opening_hours: 'Mo-Su 09:00-17:00' }, 20, EIGHT_PM)).toBe(false);
    expect(parsed.isPlaceOpen({ amenity: 'cafe', opening_hours: 'Mo-Su 09:00-17:00' }, 12, NOON)).toBe(true);
  });

  test('with parsing on, unparseable or empty rules fall back to the heuristic', () => {
    const parsed = loadWithParse();
    expect(parsed.isPlaceOpen({ amenity: 'pub', opening_hours: 'PH off' }, 12, NOON)).toBe(true);
    expect(parsed.isPlaceOpen({ amenity: 'pub', opening_hours: 'nonsense' }, 12, NOON)).toBe(true);
    expect(parsed.isPlaceOpen({ amenity: 'pub' }, 5, NOON)).toBe(false);
    expect(parsed.isPlaceOpen(undefined, 12, NOON)).toBe(true);
  });
});
