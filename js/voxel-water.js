(function (M) {
  'use strict';

  // Natural water is an implicit, renewable source. Only flowing cells are
  // stored. Local edits wake a bounded work queue; settled water costs nothing.
  function create(options) {
    const cells = new Map(), columns = new Map(), queued = new Set();
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let queue = [], head = 0, clock = 0;
    function key(x, y, z) { return x + ',' + y + ',' + z; }
    function active(x, y, z) { return y >= 0 && (!options.active || options.active(x, z)); }
    function get(x, y, z) {
      if (y < 0 || options.blocked(x, y, z)) return null;
      return options.source(x, y, z) || cells.get(key(x, y, z)) || null;
    }
    function enqueue(x, y, z) {
      if (!active(x, y, z)) return;
      const id = key(x, y, z);
      if (queued.has(id)) return;
      queued.add(id); queue.push([x, y, z, id]);
    }
    function wake(x, y, z) {
      enqueue(x, y, z); enqueue(x, y - 1, z); enqueue(x, y + 1, z);
      for (let i = 0; i < 4; i++) enqueue(x + directions[i][0], y, z + directions[i][1]);
    }
    function solve(x, y, z, id) {
      const previous = cells.get(id);
      let next = null;
      if (!options.blocked(x, y, z) && !options.source(x, y, z)) {
        if (get(x, y + 1, z)) next = { fill: 1, falling: !options.blocked(x, y - 1, z) };
        else {
          let fill = 0;
          for (let i = 0; i < 4; i++) {
            const nx = x + directions[i][0], nz = z + directions[i][1];
            const neighbour = get(nx, y, nz);
            if (!neighbour) continue;
            const below = get(nx, y - 1, nz);
            // Fall first. A supported column can spread seven cells across
            // level ground; it renews its reach after descending a ledge.
            if (neighbour.falling || (!options.blocked(nx, y - 1, nz) &&
                (!below || below.fill < 0.999 || below.falling))) continue;
            fill = Math.max(fill, neighbour.fill - 0.125);
          }
          if (fill > 0.001) next = { fill: fill, falling: false };
        }
      }
      if ((!next && !previous) || (next && previous && next.fill === previous.fill && next.falling === previous.falling)) return;
      const columnId = x + ',' + z;
      if (next) {
        cells.set(id, next);
        if (!columns.has(columnId)) columns.set(columnId, new Set());
        columns.get(columnId).add(y);
      } else {
        cells.delete(id);
        const column = columns.get(columnId);
        if (column) { column.delete(y); if (!column.size) columns.delete(columnId); }
      }
      if (options.changed) options.changed(x, y, z);
      wake(x, y, z);
      // Filling/draining the cell below changes its neighbours' ability to
      // spread. They must be revisited even if their own fill did not change.
      for (let i = 0; i < 4; i++) enqueue(x + directions[i][0], y + 1, z + directions[i][1]);
    }
    function tick(budget) {
      const end = Math.min(queue.length, head + (budget || 1024));
      let processed = 0;
      while (head < end) {
        const cell = queue[head++]; queued.delete(cell[3]);
        if (active(cell[0], cell[1], cell[2])) solve(cell[0], cell[1], cell[2], cell[3]);
        processed++;
      }
      if (head === queue.length) { queue = []; head = 0; }
      else if (head > 4096) { queue = queue.slice(head); head = 0; }
      return processed;
    }
    function update(dt) {
      clock += dt;
      if (clock < 0.12) return;
      clock %= 0.12;
      tick(1024);
    }
    function forgetColumn(x, z) {
      const columnId = x + ',' + z, column = columns.get(columnId);
      if (!column) return;
      column.forEach(function (y) { cells.delete(key(x, y, z)); });
      columns.delete(columnId);
      // Streaming regenerates flowing water from sources and saved block
      // edits on return, keeping exploration memory bounded.
      if (options.changed) options.changed(x, 0, z);
    }
    return { get: get, wake: wake, enqueue: enqueue, tick: tick, update: update,
      forgetColumn: forgetColumn,
      heights: function (x, z) { return columns.get(x + ',' + z); },
      get pending() { return queue.length - head; }, get size() { return cells.size; } };
  }
  M.voxelWater = { create: create };
})(window.Meadow = window.Meadow || {});
