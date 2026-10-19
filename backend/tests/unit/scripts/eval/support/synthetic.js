/**
 * Seeded synthetic study area shared by the eval tests. Not a test file (no .test.js suffix).
 */
const { mulberry32 } = require('../../../../../scripts/eval/lib/spatial');

const BBOX = { south: 50.40, north: 50.42, west: -4.12, east: -4.10 };
const HIGHWAYS = ['residential', 'footway', 'primary', 'service', 'path', 'tertiary', 'unclassified'];
const LIT_VALUES = ['yes', 'no', undefined, 'limited'];

function synthetic(seed) {
  const rng = mulberry32(seed);
  const between = (a, b) => a + (b - a) * rng();
  const roadElements = [];
  const lightElements = [];
  let nodeId = 1;
  let wayId = 1000;

  for (let w = 0; w < 120; w++) {
    // Half the ways sit in a dense sub-region, so the area-density branch is exercised.
    const dense = rng() < 0.5;
    const lat0 = dense ? between(50.405, 50.41) : between(BBOX.south, BBOX.north);
    const lng0 = dense ? between(-4.115, -4.11) : between(BBOX.west, BBOX.east);
    const bearing = rng() * Math.PI * 2;
    const vertexCount = 2 + Math.floor(rng() * 4);
    const nodes = [];
    const coords = [];
    for (let v = 0; v < vertexCount; v++) {
      const step = 0.0009 * v; // about 100 m per vertex
      const lat = lat0 + step * Math.cos(bearing) * 0.9;
      const lng = lng0 + step * Math.sin(bearing) * 0.9;
      const id = nodeId++;
      nodes.push(id);
      coords.push([lng, lat]);
      roadElements.push({ type: 'node', id, lat, lon: lng });
    }
    const tags = { highway: HIGHWAYS[Math.floor(rng() * HIGHWAYS.length)], name: `w${w}` };
    const lit = LIT_VALUES[Math.floor(rng() * LIT_VALUES.length)];
    if (lit !== undefined) tags.lit = lit;
    if (rng() < 0.3) tags.maxspeed = '30 mph';
    const way = { type: 'way', id: wayId++, nodes, tags, coords };
    roadElements.push(way);
    if (tags.lit === 'yes') lightElements.push({ type: 'way', id: way.id, nodes, tags: { lit: 'yes' } });
  }

  for (let l = 0; l < 220; l++) {
    const dense = rng() < 0.6;
    const lat = dense ? between(50.405, 50.41) : between(BBOX.south, BBOX.north);
    const lon = dense ? between(-4.115, -4.11) : between(BBOX.west, BBOX.east);
    lightElements.push({ type: 'node', id: 900000 + l, lat, lon, tags: { highway: 'street_lamp' } });
  }
  return { roadElements, lightElements };
}

module.exports = { BBOX, synthetic, HIGHWAYS, LIT_VALUES };
