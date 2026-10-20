/**
 * Binary min-heap keyed by numeric priority, used by both A* searches.
 */
class MinHeap {
  constructor() {
    this.data = [];
    this.size = 0;
  }

  /** Adds an item. Duplicates of an id are allowed (lazy deletion by the caller). */
  push(id, priority) {
    this.data[this.size] = { id, priority };
    this.size++;
    this._bubbleUp(this.size - 1);
  }

  /** Removes and returns the lowest-priority item as { id, priority }, or null when empty. */
  pop() {
    if (this.size === 0) return null;
    const min = this.data[0];
    this.size--;
    if (this.size > 0) {
      this.data[0] = this.data[this.size];
      this._sinkDown(0);
    }
    return min;
  }

  _bubbleUp(i) {
    const data = this.data;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (data[i].priority >= data[parent].priority) break;
      const tmp = data[i]; data[i] = data[parent]; data[parent] = tmp;
      i = parent;
    }
  }

  _sinkDown(i) {
    const data = this.data;
    const n = this.size;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && data[left].priority < data[smallest].priority) smallest = left;
      if (right < n && data[right].priority < data[smallest].priority) smallest = right;
      if (smallest === i) break;
      const tmp = data[i]; data[i] = data[smallest]; data[smallest] = tmp;
      i = smallest;
    }
  }
}

module.exports = { MinHeap };
