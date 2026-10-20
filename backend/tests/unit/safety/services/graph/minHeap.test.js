const path = require('path');
const { MinHeap } = require(path.resolve(__dirname, '../../../../../src/safety/services/graph/minHeap'));

describe('graph/minHeap', () => {
  test('pop on an empty heap is null and size is 0', () => {
    const heap = new MinHeap();
    expect(heap.size).toBe(0);
    expect(heap.pop()).toBeNull();
  });

  test('pops items in ascending priority order', () => {
    const heap = new MinHeap();
    [5, 1, 4, 2, 3, 0, 9, 7].forEach((p) => heap.push(`id${p}`, p));
    const out = [];
    while (heap.size > 0) out.push(heap.pop().priority);
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 7, 9]);
  });

  test('keeps the id with its priority, and allows duplicate ids', () => {
    const heap = new MinHeap();
    heap.push('a', 3);
    heap.push('a', 1);
    expect(heap.pop()).toEqual({ id: 'a', priority: 1 });
    expect(heap.pop()).toEqual({ id: 'a', priority: 3 });
  });

  test('sorts 500 pseudo-random priorities correctly', () => {
    const heap = new MinHeap();
    let seed = 7;
    const values = [];
    for (let i = 0; i < 500; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      values.push(seed % 1000);
      heap.push(i, values[i]);
    }
    const out = [];
    while (heap.size > 0) out.push(heap.pop().priority);
    expect(out).toEqual([...values].sort((a, b) => a - b));
  });
});
