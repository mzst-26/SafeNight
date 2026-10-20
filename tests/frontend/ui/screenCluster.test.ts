import { SCREEN_CLUSTER_JS } from '@/src/components/maps/inline/screenCluster';
import { RL_CRIME_MERGE_PX, RL_TOUCH_TARGET_PX } from '@/src/components/maps/mapConstants';

/*
 * The screen-space helpers are plain-JS strings interpolated into both map templates.
 * They are evaluated here exactly like the templates do (a plain script), so this pins
 * the Leaflet and the MapLibre renderer together.
 *
 * Tests project with an identity-like function: lat is the y pixel and lng the x pixel,
 * which keeps the geometry readable.
 */

type Cluster = { lat: number; lng: number; count: number; maxSeverity: number };
type Merged = Cluster;
type Pt = { x: number; y: number };
type Placed = { x: number; y: number; dy: number };
type Project = (lat: number, lng: number) => Pt;

type Api = {
  mergeScreenClusters: (clusters: unknown, project: Project, minPx: number) => Merged[];
  separatePills: (points: unknown, minPx: number, obstacles?: unknown) => Placed[];
  separatePillsGreedy: (points: unknown, minPx: number, obstacles?: unknown) => Placed[];
};

const api: Api = new Function(`${SCREEN_CLUSTER_JS}\nreturn { mergeScreenClusters: mergeScreenClusters, separatePills: separatePills, separatePillsGreedy: separatePillsGreedy };`)();

const project: Project = (lat, lng) => ({ x: lng, y: lat });
const c = (x: number, count: number, maxSeverity = 0.5, y = 0): Cluster => ({ lat: y, lng: x, count, maxSeverity });
const merge = (clusters: Cluster[], minPx = RL_CRIME_MERGE_PX) => api.mergeScreenClusters(clusters, project, minPx);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

describe('RL_CRIME_MERGE_PX', () => {
  it('is the 44px touch target size', () => {
    expect(RL_CRIME_MERGE_PX).toBe(44);
    expect(RL_CRIME_MERGE_PX).toBe(RL_TOUCH_TARGET_PX);
  });
});

describe('mergeScreenClusters', () => {
  it('returns an empty list for zero clusters or a non-list', () => {
    expect(merge([])).toEqual([]);
    expect(api.mergeScreenClusters(null, project, 44)).toEqual([]);
    expect(api.mergeScreenClusters(undefined, project, 44)).toEqual([]);
  });

  it('keeps clusters that are far apart exactly as they are, in the input order', () => {
    const input = [c(0, 3, 0.2), c(100, 7, 0.9), c(300, 1, 0.1)];
    expect(merge(input)).toEqual(input);
  });

  it('does not merge clusters exactly minPx apart (only closer ones merge)', () => {
    expect(merge([c(0, 3), c(44, 2)])).toHaveLength(2);
    expect(merge([c(0, 3), c(43.9, 2)])).toHaveLength(1);
  });

  it('merges a close pair: counts summed, severity max, position the count-weighted mean', () => {
    const out = merge([c(0, 5, 0.3), c(30, 2, 0.9)]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(7);
    expect(out[0].maxSeverity).toBe(0.9);
    expect(out[0].lat).toBeCloseTo(0, 10);
    expect(out[0].lng).toBeCloseTo((0 * 5 + 30 * 2) / 7, 10);
  });

  it('merges the highest count first: a chain A-B-C where B is biggest collapses into one', () => {
    const out = merge([c(0, 2), c(40, 6), c(80, 2)]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(10);
  });

  it('merges a chain greedily from the biggest cluster and leaves the far end alone', () => {
    // A (5) absorbs B (3, 40px away). C is 80px from A and 65px from the merged centre, so it stays.
    const out = merge([c(0, 5), c(40, 3), c(80, 2)]);
    expect(out.map((m) => m.count)).toEqual([8, 2]);
    expect(out[0].lng).toBeCloseTo((0 * 5 + 40 * 3) / 8, 10);
    expect(out[1].lng).toBe(80);
  });

  it('keeps merging until every remaining pair is at least minPx apart', () => {
    // The first merge moves the centre of A towards B, which brings C inside minPx.
    const out = merge([c(0, 10), c(43, 1), c(45, 1)]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(12);
    const spread = merge([c(0, 4), c(30, 3), c(60, 2), c(90, 5), c(200, 1), c(210, 1)]);
    for (let i = 0; i < spread.length; i++) {
      for (let j = i + 1; j < spread.length; j++) {
        expect(dist(project(spread[i].lat, spread[i].lng), project(spread[j].lat, spread[j].lng))).toBeGreaterThanOrEqual(44);
      }
    }
    expect(spread.reduce((sum, m) => sum + m.count, 0)).toBe(16);
  });

  it('measures in screen pixels, so the same clusters merge or split by zoom', () => {
    const near = [c(0, 4), c(10, 4)];
    const zoomedOut = (lat: number, lng: number): Pt => ({ x: lng, y: lat });
    const zoomedIn = (lat: number, lng: number): Pt => ({ x: lng * 8, y: lat * 8 });
    expect(api.mergeScreenClusters(near, zoomedOut, 44)).toHaveLength(1);
    expect(api.mergeScreenClusters(near, zoomedIn, 44)).toHaveLength(2);
  });

  it('is deterministic: the same input gives the same output, the input is not mutated, input order does not matter for the result', () => {
    const input = [c(0, 4, 0.1), c(20, 4, 0.8), c(45, 4, 0.4), c(300, 2, 0.3), c(310, 2, 0.6)];
    const snapshot = JSON.parse(JSON.stringify(input));
    const first = merge(input);
    expect(merge(input)).toEqual(first);
    expect(input).toEqual(snapshot);

    const key = (m: Merged) => `${m.lng.toFixed(6)}:${m.count}:${m.maxSeverity}`;
    const reversed = merge([...input].reverse());
    expect(reversed.map(key).sort()).toEqual(first.map(key).sort());
  });

  it('only ever reduces the number of clusters and conserves the total count', () => {
    const input = Array.from({ length: 12 }, (_, i) => c(i * 9, i + 1, 0.5, (i % 3) * 7));
    const out = merge(input);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.reduce((s, m) => s + m.count, 0)).toBe(input.reduce((s, m) => s + m.count, 0));
  });

  it('sums into counts above 99 without capping (the badge label caps at 99+)', () => {
    const out = merge([c(0, 80), c(10, 70)]);
    expect(out[0].count).toBe(150);
  });

  it('floors fractional counts and skips invalid clusters', () => {
    const out = merge([c(0, 2.9), c(500, 0), c(600, Number.NaN), { lat: Number.NaN, lng: 0, count: 3, maxSeverity: 1 }]);
    expect(out).toEqual([c(0, 2)]);
  });

  it('leaves a cluster that cannot be projected where it is, never merged', () => {
    const throwing: Project = (lat, lng) => {
      if (lng === 5) throw new Error('not on screen');
      return { x: lng, y: lat };
    };
    const out = api.mergeScreenClusters([c(0, 3), c(5, 2), c(10, 1)], throwing, 44);
    expect(out.map((m) => m.count)).toEqual([4, 2]);
    expect(out.find((m) => m.count === 2)!.lng).toBe(5);
  });

  it('clamps huge counts so merged sums stay finite instead of dropping the badge', () => {
    const out = merge([c(0, Number.MAX_VALUE), c(10, Number.MAX_VALUE), c(20, Infinity)]);
    expect(out).toHaveLength(1);
    expect(Number.isFinite(out[0].count)).toBe(true);
    expect(out[0].count).toBeGreaterThan(99);
    expect(Number.isFinite(out[0].lat) && Number.isFinite(out[0].lng)).toBe(true);
  });

  it('does nothing when minPx is not a positive number', () => {
    const input = [c(0, 1), c(1, 1)];
    expect(merge(input, 0)).toEqual(input);
    expect(merge(input, Number.NaN)).toEqual(input);
  });
});

describe('separatePills', () => {
  const place = (points: Pt[], minPx = RL_TOUCH_TARGET_PX) => api.separatePills(points, minPx);
  const overlaps = (a: Pt, b: Pt, gap = RL_TOUCH_TARGET_PX) => Math.abs(a.x - b.x) < gap && Math.abs(a.y - b.y) < gap;

  it('returns an empty list for zero pills or a non-list', () => {
    expect(place([])).toEqual([]);
    expect(api.separatePills(null, 44)).toEqual([]);
  });

  it('leaves pills whose hit areas do not overlap where they are', () => {
    const out = place([{ x: 100, y: 100 }, { x: 144, y: 100 }, { x: 100, y: 144 }]);
    expect(out.map((p) => p.dy)).toEqual([0, 0, 0]);
    expect(out.map((p) => [p.x, p.y])).toEqual([[100, 100], [144, 100], [100, 144]]);
  });

  it('displaces the later pill vertically, never the earlier one, so their centres are 44px apart', () => {
    const out = place([{ x: 100, y: 100 }, { x: 100, y: 100 }]);
    expect(out[0]).toEqual({ x: 100, y: 100, dy: 0 });
    expect(out[1].x).toBe(100);
    expect(out[1].y - 100).toBeGreaterThanOrEqual(44);
    expect(out[1].dy).toBe(44);
  });

  it('moves a later pill away from the earlier one (up when it sits above)', () => {
    const out = place([{ x: 100, y: 100 }, { x: 110, y: 90 }]);
    expect(out[1].dy).toBeLessThan(0);
    expect(100 - out[1].y).toBeGreaterThanOrEqual(44);
  });

  it('separates side-by-side pills whose hit squares overlap, by moving only vertically', () => {
    const out = place([{ x: 100, y: 100 }, { x: 130, y: 100 }]);
    expect(out[1].x).toBe(130);
    expect(Math.abs(out[1].y - 100)).toBeGreaterThanOrEqual(44);
  });

  it('never overlaps hit areas for a stack of three and never moves a pill more than 44px', () => {
    const start = [{ x: 50, y: 50 }, { x: 55, y: 52 }, { x: 52, y: 48 }];
    const out = place(start);
    for (let i = 0; i < out.length; i++) {
      expect(Math.abs(out[i].dy)).toBeLessThanOrEqual(44);
      expect(out[i].y - start[i].y).toBe(out[i].dy);
      for (let j = i + 1; j < out.length; j++) expect(overlaps(out[i], out[j])).toBe(false);
    }
  });

  it('respects the displacement cap when a spot cannot be cleared (four pills on one point)', () => {
    const out = place(Array.from({ length: 4 }, () => ({ x: 0, y: 0 })));
    out.forEach((p) => expect(Math.abs(p.dy)).toBeLessThanOrEqual(44));
    expect(out[0].dy).toBe(0);
  });

  it('is deterministic and does not mutate its input', () => {
    const input = [{ x: 10, y: 10 }, { x: 12, y: 14 }, { x: 11, y: 12 }];
    const snapshot = JSON.parse(JSON.stringify(input));
    expect(place(input)).toEqual(place(input));
    expect(input).toEqual(snapshot);
  });

  it('keeps a pill with an unusable position untouched', () => {
    const out = place([{ x: Number.NaN, y: 0 }, { x: 0, y: 0 }]);
    expect(out[0].dy).toBe(0);
    expect(out[1].dy).toBe(0);
  });
});

describe('separatePills with obstacles and exhaustive search', () => {
  const G = RL_TOUCH_TARGET_PX;
  const overlapPair = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < G && Math.abs(a.y - b.y) < G;
  const overlapCircle = (a: Pt, o: { x: number; y: number; r: number }) => {
    const dx = Math.max(Math.abs(a.x - o.x) - G / 2, 0);
    const dy = Math.max(Math.abs(a.y - o.y) - G / 2, 0);
    return dx * dx + dy * dy < o.r * o.r;
  };
  const overlaps = (pts: Pt[], obs: { x: number; y: number; r: number }[] = []) => {
    let n = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) if (overlapPair(pts[i], pts[j])) n++;
      obs.forEach((o) => {
        if (overlapCircle(pts[i], o)) n++;
      });
    }
    return n;
  };

  it('moves a pill off a crime badge it covers (3.6px away), within the 44px cap', () => {
    const badge = { x: 100, y: 96.4, r: 16 };
    const out = api.separatePills([{ x: 100, y: 100 }], G, [badge]);
    expect(Math.abs(out[0].dy)).toBeLessThanOrEqual(44);
    expect(overlapCircle(out[0], badge)).toBe(false);
  });

  it('leaves a pill alone when no badge touches its hit area', () => {
    const out = api.separatePills([{ x: 100, y: 100 }], G, [{ x: 100, y: 200, r: 16 }]);
    expect(out[0].dy).toBe(0);
  });

  it('solves the greedy counterexample (0, -40, -40) with no overlapping touch squares', () => {
    const input = [{ x: 0, y: 0 }, { x: 0, y: -40 }, { x: 0, y: -40 }];
    expect(overlaps(api.separatePillsGreedy(input, G))).toBeGreaterThan(0);
    const out = api.separatePills(input, G);
    expect(overlaps(out)).toBe(0);
    out.forEach((p, i) => expect(Math.abs(p.y - input[i].y)).toBeLessThanOrEqual(44));
  });

  it('displaces the prioritised (selected) pill least', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 0, priority: true }];
    const out = api.separatePills(pts, G);
    expect(out[1].dy).toBe(0);
    expect(Math.abs(out[0].dy)).toBe(44);
  });

  it('counts pill-badge overlaps together with pill-pill overlaps', () => {
    const obs = [{ x: 0, y: 30, r: 16 }];
    const input = [{ x: 0, y: 0 }, { x: 0, y: 10 }];
    const out = api.separatePills(input, G, obs);
    expect(overlaps(out, obs)).toBeLessThanOrEqual(overlaps(api.separatePillsGreedy(input, G, obs), obs));
  });

  it('never has more overlaps than the greedy result and never moves more than 44px (random 3-pill sets)', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let n = 0; n < 300; n++) {
      const pts = Array.from({ length: 3 }, () => ({ x: Math.round(rnd() * 60), y: Math.round(rnd() * 120) }));
      const obs = rnd() < 0.5 ? [{ x: Math.round(rnd() * 60), y: Math.round(rnd() * 120), r: 16 }] : [];
      const out = api.separatePills(pts, G, obs);
      const greedy = api.separatePillsGreedy(pts, G, obs);
      expect(overlaps(out, obs)).toBeLessThanOrEqual(overlaps(greedy, obs));
      out.forEach((p) => expect(Math.abs(p.dy)).toBeLessThanOrEqual(44));
    }
  });

  it('falls back to the greedy pass beyond four pills and survives an infinite gap', () => {
    const five = Array.from({ length: 5 }, () => ({ x: 0, y: 0 }));
    const out = api.separatePills(five, G);
    expect(out).toHaveLength(5);
    out.forEach((p) => expect(Math.abs(p.dy)).toBeLessThanOrEqual(44));
    expect(api.separatePills(five, Infinity).map((p) => p.dy)).toEqual([0, 0, 0, 0, 0]);
  });
});
