const { classifyFeatures } = require('../../../../src/safety/services/osmIngestionClient');

describe('classifyFeatures road vertices', () => {
  test('emits node elements with coordinates for every vertex of a road way', () => {
    const way = {
      type: 'way',
      id: 1,
      nodes: [10, 11],
      coords: [[-0.1, 51.0], [-0.09, 51.01]],
      tags: { highway: 'residential' },
      bbox: { minLon: -0.1, minLat: 51.0, maxLon: -0.09, maxLat: 51.01 },
    };

    const { roads } = classifyFeatures([way], []);

    const nodeEls = roads.elements.filter((el) => el.type === 'node');
    expect(nodeEls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'node', id: 10, lat: 51.0, lon: -0.1 }),
        expect.objectContaining({ type: 'node', id: 11, lat: 51.01, lon: -0.09 }),
      ]),
    );
    expect(roads.elements.filter((el) => el.type === 'way')).toHaveLength(1);
  });

  test('does not duplicate a vertex that is shared by two ways', () => {
    const ways = [
      { type: 'way', id: 1, nodes: [10, 11], coords: [[-0.1, 51.0], [-0.09, 51.01]], tags: { highway: 'residential' } },
      { type: 'way', id: 2, nodes: [11, 12], coords: [[-0.09, 51.01], [-0.08, 51.02]], tags: { highway: 'footway' } },
    ];

    const { roads } = classifyFeatures(ways, []);

    const ids = roads.elements.filter((el) => el.type === 'node').map((el) => el.id);
    expect(ids.sort()).toEqual([10, 11, 12]);
  });

  test('skips coordinates when they do not line up with the node list', () => {
    const way = { type: 'way', id: 1, nodes: [10, 11, 12], coords: [[-0.1, 51.0]], tags: { highway: 'residential' } };

    const { roads } = classifyFeatures([way], []);

    expect(roads.elements.filter((el) => el.type === 'node')).toHaveLength(0);
  });
});
