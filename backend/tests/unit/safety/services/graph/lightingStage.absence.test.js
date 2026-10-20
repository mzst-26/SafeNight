const path = require('path');
const lighting = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/lightingStage'));
const { buildSpatialGrid } = require(path.resolve(__dirname, '../../../../../src/safety/services/geo'));

const LAT = 51.5;
const LNG = -0.1;

// An isolated footpath: a path-class way with no road beside it, no lamp at or near it, and no lit neighbour.
const isolatedPath = { highway: 'path', tags: { highway: 'path' }, midLat: LAT, midLng: LNG };

/** Lighting for the isolated path when its surrounding area holds `lamps` lamps over `wayKm` of mapped road. */
function lightingWithArea(lamps, wayKm) {
  const context = {
    areaStats: new Map([[lighting.areaCellKey(LAT, LNG), { lamps, wayKm }]]),
    roadIndex: () => { throw new Error('a path does not use the road index'); },
  };
  const sources = { lampGrid: buildSpatialGrid([]), litGrid: buildSpatialGrid([]) };
  return lighting.lightingAt(isolatedPath, sources, context, null);
}

describe('graph/lightingStage area lamp density drives the absence rule', () => {
  test('3 lamps over 2 km is 1.5 lamps per km, below the 2 per km threshold, so no absence penalty', () => {
    expect(lightingWithArea(3, 2).lighting.source).toBe('prior');
  });

  test('9 lamps over 2 km is 4.5 lamps per km, above the threshold, so the absence penalty applies', () => {
    expect(lightingWithArea(9, 2).lighting.source).toBe('absence');
  });

  test('3 lamps over 1 km is 3 lamps per km, so the absence penalty applies', () => {
    expect(lightingWithArea(3, 1).lighting.source).toBe('absence');
  });
});
