/**
 * Characterization of the v1 scoring path (SAFETY_MODEL=v1).
 * Values were captured from the pre-v2 code on a fixed synthetic network. The v1 path
 * must keep returning these numbers after the v2 model is added behind the flag.
 */

const path = require('path');
const { buildGraph, findKSafestRoutes, routeSafetyBreakdown } = require(path.resolve(__dirname, '../../../../src/safety/services/safetyGraph'));

const round9 = (x) => (typeof x === 'number' ? Math.round(x * 1e9) / 1e9 : x);
const roundDeep = (value) => JSON.parse(JSON.stringify(value, (k, v) => (typeof v === 'number' ? round9(v) : v)));

const LAT0 = 51.5, LNG0 = -0.1, DLAT = 0.0009, DLNG = 0.0014;
const nid = (r, c) => 1000 + r * 10 + c;
function network() {
  const elements = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    elements.push({ type: 'node', id: nid(r, c), lat: LAT0 + r * DLAT, lon: LNG0 + c * DLNG });
  }
  elements.push({ type: 'node', id: 2001, lat: LAT0 + 1.2 * DLAT, lon: LNG0 + 1.0 * DLNG });
  const rowHw = ['residential', 'primary', 'footway', 'service'];
  for (let r = 0; r < 4; r++) elements.push({ type: 'way', id: 100 + r, nodes: [0, 1, 2, 3].map(c => nid(r, c)), tags: { highway: rowHw[r], name: `Row ${r}` } });
  const colTags = [
    { highway: 'residential', lit: 'yes', sidewalk: 'both' },
    { highway: 'residential' },
    { highway: 'path', surface: 'gravel' },
    { highway: 'secondary', maxspeed: '40 mph' },
  ];
  for (let c = 0; c < 4; c++) elements.push({ type: 'way', id: 200 + c, nodes: [0, 1, 2, 3].map(r => nid(r, c)), tags: colTags[c] });
  elements.push({ type: 'way', id: 300, nodes: [nid(1, 1), 2001], tags: { highway: 'footway' } });
  elements.push({ type: 'way', id: 400, nodes: [nid(0, 0), nid(3, 3)], tags: { highway: 'motorway' } });
  return { elements };
}
function lights() {
  const elements = [];
  let id = 5000;
  for (const [lat, lng] of [[0, 0.2], [0, 1.1], [1, 0.4], [2, 2.6], [3, 1.2]]) {
    elements.push({ type: 'node', id: id++, lat: LAT0 + lat * DLAT + 0.00003, lon: LNG0 + lng * DLNG, tags: { highway: 'street_lamp' } });
  }
  elements.push({ type: 'way', id: 7000, tags: { lit: 'yes' }, nodes: [0, 1, 2, 3].map(c => nid(0, c)) });
  return { elements };
}
function cctv() {
  return { elements: [{ type: 'node', id: 8000, lat: LAT0 + 2 * DLAT + 0.00002, lon: LNG0 + 1.5 * DLNG }, { type: 'node', id: 8001, lat: LAT0 + 0.5 * DLAT, lon: LNG0 + 3 * DLNG }] };
}
function transit() {
  return { elements: [{ type: 'node', id: 9000, lat: LAT0 + 1 * DLAT, lon: LNG0 + 2.2 * DLNG }] };
}
const bbox = { south: LAT0 - 0.002, north: LAT0 + 0.004, west: LNG0 - 0.002, east: LNG0 + 0.005 };
const crimes = [
  { lat: LAT0 + 2 * DLAT, lng: LNG0 + 1 * DLNG, category: 'robbery', severity: 1.0, month: '2026-09' },
  { lat: LAT0 + 2.1 * DLAT, lng: LNG0 + 1.1 * DLNG, category: 'shoplifting', severity: 0.2, month: '2026-09' },
  { lat: LAT0 + 0.5 * DLAT, lng: LNG0 + 2 * DLNG, category: 'violent-crime', severity: 1.0, month: '2026-09' },
];

const EXPECTED = {
  "edgeCount": 25,
  "edges": [
    [
      0,
      96.908657,
      0.217,
      0.05,
      1,
      0,
      0,
      0.45,
      false
    ],
    [
      1,
      96.908657,
      0.355955886,
      0,
      0.820254028,
      0,
      0,
      0.55,
      false
    ],
    [
      2,
      96.908657,
      0.399162859,
      0,
      0.889376633,
      0.4,
      0,
      0.55,
      false
    ],
    [
      3,
      96.906743,
      0.572819356,
      0.200677425,
      1,
      0,
      0,
      0.765,
      false
    ],
    [
      4,
      96.906743,
      0.499185228,
      0,
      0.843341947,
      0,
      0,
      0.865,
      false
    ],
    [
      5,
      96.906743,
      0.538985155,
      0,
      0.896977976,
      0.4,
      0,
      0.865,
      false
    ],
    [
      6,
      96.90483,
      0.263160149,
      0,
      0.797318861,
      0,
      0,
      0.275,
      false
    ],
    [
      7,
      96.90483,
      0.310768324,
      0,
      0.836446926,
      0.4,
      0,
      0.375,
      false
    ],
    [
      8,
      96.90483,
      0.44681654,
      0.512266159,
      1,
      0,
      0,
      0.375,
      false
    ],
    [
      9,
      96.902916,
      0.338101941,
      0,
      0.928645186,
      0,
      0,
      0.38,
      false
    ],
    [
      10,
      96.902916,
      0.350973942,
      0,
      0.987154282,
      0,
      0,
      0.38,
      false
    ],
    [
      11,
      96.902916,
      0.3538,
      0,
      1,
      0,
      0,
      0.38,
      false
    ],
    [
      12,
      100.075434,
      0.626,
      0.9,
      1,
      0,
      0,
      0.6,
      false
    ],
    [
      13,
      100.075434,
      0.626,
      0.9,
      1,
      0,
      0,
      0.6,
      false
    ],
    [
      14,
      100.075434,
      0.626,
      0.9,
      1,
      0,
      0,
      0.6,
      false
    ],
    [
      15,
      100.075434,
      0.601930256,
      0.825721025,
      1,
      0,
      0,
      0.55,
      false
    ],
    [
      16,
      100.075434,
      0.391297549,
      0,
      0.853625223,
      0.4,
      0,
      0.55,
      false
    ],
    [
      17,
      100.075434,
      0.370582167,
      0,
      0.809464395,
      0.4,
      0,
      0.45,
      false
    ],
    [
      18,
      100.075434,
      0.356375598,
      0.699999988,
      0.696934551,
      0,
      0,
      0.305,
      false
    ],
    [
      19,
      100.075434,
      0.258052007,
      0,
      0.918190941,
      0.4,
      0,
      0.305,
      false
    ],
    [
      20,
      100.075434,
      0.26505,
      0,
      1,
      0.4,
      0,
      0.205,
      false
    ],
    [
      21,
      100.075434,
      0.705949997,
      0.699999988,
      1,
      0.4,
      0,
      0.795,
      false
    ],
    [
      22,
      100.075434,
      0.50295,
      0,
      1,
      0,
      0,
      0.795,
      false
    ],
    [
      23,
      100.075434,
      0.49195,
      0,
      1,
      0,
      0,
      0.695,
      false
    ],
    [
      24,
      20.015087,
      0.206139897,
      0,
      0.94268135,
      0,
      0,
      0.375,
      true
    ]
  ],
  "weights": {
    "roadType": 0.23,
    "lighting": 0.25,
    "crimeRate": 0.22,
    "cctv": 0.07,
    "openPlaces": 0.12,
    "gpsTraffic": 0.11
  },
  "routes": [
    {
      "edges": [
        12,
        3,
        4,
        5,
        22,
        23
      ],
      "totalDist": 590.946532,
      "avgSafety": 0.53867486
    },
    {
      "edges": [
        12,
        13,
        14,
        9,
        10,
        11
      ],
      "totalDist": 590.935049,
      "avgSafety": 0.489054388
    },
    {
      "edges": [
        12,
        3,
        16,
        7,
        8,
        23
      ],
      "totalDist": 590.942705,
      "avgSafety": 0.473755394
    },
    {
      "edges": [
        0,
        1,
        2,
        21,
        22,
        23
      ],
      "totalDist": 590.952273,
      "avgSafety": 0.447447342
    },
    {
      "edges": [
        12,
        13,
        6,
        17,
        10,
        11
      ],
      "totalDist": 590.936963,
      "avgSafety": 0.433509443
    }
  ],
  "breakdown": [
    {
      "roadType": 0.8399239972507953,
      "lighting": 0.18532114215873732,
      "crime": 0.9574161971387316,
      "cctv": 0.0655942547185342,
      "openPlaces": 0,
      "traffic": 0.7630808495691845,
      "overall": 0.5386748595607959,
      "roadTypes": {
        "residential": 17,
        "primary": 49,
        "secondary": 34
      },
      "mainRoadRatio": 0.8306523034625564,
      "riskVector": {
        "mean": 2.811336440835983,
        "p95": 0.6260000000000001,
        "max": 0.6260000000000001,
        "uncertainty": 0
      }
    },
    {
      "roadType": 0.4508052961497576,
      "lighting": 0.4572476653478183,
      "crime": 0.9861925991852951,
      "cctv": 0,
      "openPlaces": 0,
      "traffic": 0.49177165152946667,
      "overall": 0.48905438794040507,
      "roadTypes": {
        "residential": 51,
        "service": 49
      },
      "mainRoadRatio": 0,
      "riskVector": {
        "mean": 2.3860172122123373,
        "p95": 0.6260000000000001,
        "max": 0.6260000000000001,
        "uncertainty": 0
      }
    },
    {
      "roadType": 0.5510743619764017,
      "lighting": 0.2693255199071327,
      "crime": 0.9483916090965506,
      "cctv": 0.13333290153737132,
      "openPlaces": 0,
      "traffic": 0.5608859438218003,
      "overall": 0.47375539416061074,
      "roadTypes": {
        "residential": 34,
        "primary": 16,
        "footway": 33,
        "secondary": 17
      },
      "mainRoadRatio": 0.33333549231314336,
      "riskVector": {
        "mean": 2.463010336339257,
        "p95": 0.6260000000000001,
        "max": 0.6260000000000001,
        "uncertainty": 0
      }
    },
    {
      "roadType": 0.6778133538664233,
      "lighting": 0.1267415979940974,
      "crime": 0.9523831212648576,
      "cctv": 0.13333333333351163,
      "openPlaces": 0,
      "traffic": 0.641136014373252,
      "overall": 0.4769650524804739,
      "roadTypes": {
        "residential": 49,
        "secondary": 51
      },
      "mainRoadRatio": 0.5080381539040663,
      "riskVector": {
        "mean": 2.5314074208321418,
        "p95": 0.7059499970197678,
        "max": 0.7059499970197678,
        "uncertainty": 0
      }
    },
    {
      "roadType": 0.426207373567636,
      "lighting": 0.30483078968853733,
      "crime": 0.9323895700365481,
      "cctv": 0.06774017548580683,
      "openPlaces": 0,
      "traffic": 0.4491502931121014,
      "overall": 0.43350944327706886,
      "roadTypes": {
        "residential": 51,
        "footway": 16,
        "service": 33
      },
      "mainRoadRatio": 0,
      "riskVector": {
        "mean": 2.1803182018906297,
        "p95": 0.6260000000000001,
        "max": 0.6260000000000001,
        "uncertainty": 0
      }
    }
  ]
};

describe('safetyGraph v1 characterization (SAFETY_MODEL=v1)', () => {
  const previous = process.env.SAFETY_MODEL;
  beforeEach(() => { process.env.SAFETY_MODEL = 'v1'; });
  afterEach(() => { if (previous === undefined) delete process.env.SAFETY_MODEL; else process.env.SAFETY_MODEL = previous; });

  test('buildGraph edge scores match the captured v1 output', async () => {
    const cache = new Map([[0, { lit_status: 'unlit', confidence: 0.9 }]]);
    const graph = await buildGraph(network(), lights(), cctv(), null, transit(), crimes, bbox, { hour: 23, level: 'extra', lightsCacheByEdgeIdx: cache });
    const actual = {
      edgeCount: graph.edges.length,
      edges: graph.edges.map(e => [e.idx, +e.distance.toFixed(6), +e.safetyScore.toFixed(9), +e.lightScore.toFixed(9), +e.crimeScore.toFixed(9), +e.cctvScore.toFixed(9), +e.placeScore.toFixed(9), +e.trafficScore.toFixed(9), e.isDeadEnd]),
      weights: graph.weights,
    };
    expect(roundDeep(actual)).toEqual(roundDeep({ edgeCount: EXPECTED.edgeCount, edges: EXPECTED.edges, weights: EXPECTED.weights }));
  });

  test('findKSafestRoutes and routeSafetyBreakdown match the captured v1 output', async () => {
    const cache = new Map([[0, { lit_status: 'unlit', confidence: 0.9 }]]);
    const graph = await buildGraph(network(), lights(), cctv(), null, transit(), crimes, bbox, { hour: 23, level: 'extra', lightsCacheByEdgeIdx: cache });
    const routes = findKSafestRoutes(graph.osmNodes, graph.edges, graph.adjacency, nid(0, 0), nid(3, 3), 1500, 5, { allowHazards: false, edgeConfidences: [] });
    const actual = {
      routes: routes.map(r => ({ edges: r.edges, totalDist: +r.totalDist.toFixed(6), avgSafety: +r.avgSafety.toFixed(9) })),
      breakdown: routes.map(r => routeSafetyBreakdown(graph.edges, r.edges, graph.weights, [])),
    };
    expect(roundDeep(actual)).toEqual(roundDeep({ routes: EXPECTED.routes, breakdown: EXPECTED.breakdown }));
  });
});
