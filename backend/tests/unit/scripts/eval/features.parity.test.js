/**
 * Parity: the eval replica of buildGraphV2's lighting inputs must match what buildGraph produces
 * for every segment of a synthetic area. If safetyGraph changes its lighting inputs, this fails.
 */
const { buildGraph, WALKABLE_HIGHWAYS } = require('../../../../src/safety/services/safetyGraph');
const {
  segmentsOf,
  addAreaKm,
  areaKeyOf,
  buildLampIndex,
  buildLitIndex,
  buildRoadIndexFromRecords,
  lightingFeatures,
  estimateLighting,
} = require('../../../../scripts/eval/lib/features');

const { BBOX, synthetic } = require('./support/synthetic');

describe('replica parity with buildGraph (v2)', () => {
  beforeAll(() => {
    delete process.env.SAFETY_MODEL;
  });

  test('per-segment lampCount30m, area density and pLit match the graph edges', async () => {
    const { roadElements, lightElements } = synthetic(11);
    const roadData = { elements: roadElements };
    const lightData = { elements: lightElements };
    const graph = await buildGraph(
      roadData, lightData, { elements: [] }, { elements: [] }, { elements: [] }, [], BBOX,
      { now: new Date('2026-10-20T23:00:00Z') },
    );
    const edgeByPair = new Map(graph.edges.map((e) => [`${e.from}-${e.to}`, e]));

    // Replica inputs, computed the same way for every walkable segment.
    const ways = roadElements.filter((e) => e.type === 'way' && WALKABLE_HIGHWAYS.has(e.tags.highway));
    const segsByWay = ways.map((way) => ({ way, segs: segmentsOf(way.coords) }));
    const area = new Map();
    for (const { segs } of segsByWay) addAreaKm(area, segs);
    const lamps = lightElements
      .filter((e) => e.type === 'node' && e.tags?.highway === 'street_lamp')
      .map((e) => ({ lat: e.lat, lng: e.lon }));
    const lampIndex = buildLampIndex(lamps);
    const litPositions = [];
    for (const e of lightElements) {
      if (e.type !== 'way' || e.tags.lit !== 'yes') continue;
      const roadWay = roadElements.find((r) => r.type === 'way' && r.id === e.id);
      for (const [lng, lat] of roadWay.coords) litPositions.push({ lat, lng });
    }
    const litIndex = buildLitIndex(litPositions);
    const roadIndex = buildRoadIndexFromRecords(
      segsByWay.map(({ way, segs }) => ({ highway: way.tags.highway, segments: segs })),
    );

    let compared = 0;
    let lampBranch = 0;
    let absenceBranch = 0;
    let neighbourBranch = 0;
    const footwayNear = { true: 0, false: 0 };
    for (const { way, segs } of segsByWay) {
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const pair = `${way.nodes[i]}-${way.nodes[i + 1]}`;
        const edge = edgeByPair.get(pair);
        if (!edge) continue; // segment below the 0.5 m floor on both sides
        const features = lightingFeatures({
          anchor: seg,
          lampIndex,
          litIndex,
          roadIndex,
          areaWayKm: area.get(areaKeyOf(seg.midLat, seg.midLng)),
        });
        const est = estimateLighting(way.tags, features);
        expect(edge.pLit).toBeCloseTo(est.pLit, 12);
        expect(edge.lightScore).toBeCloseTo(est.effective, 12);
        compared++;
        if (est.source === 'lamp') lampBranch++;
        if (est.source === 'absence') absenceBranch++;
        if (est.source === 'neighbour-lit') neighbourBranch++;
        if (way.tags.highway === 'footway') footwayNear[String(features.nearRoad)]++;
      }
    }
    expect(compared).toBeGreaterThan(100);
    // The synthetic area must exercise the branches this test is about.
    expect(lampBranch).toBeGreaterThan(0);
    expect(absenceBranch).toBeGreaterThan(0);
    expect(neighbourBranch).toBeGreaterThan(0);
    expect(footwayNear.true).toBeGreaterThan(0);
    expect(footwayNear.false).toBeGreaterThan(0);
  });
});
