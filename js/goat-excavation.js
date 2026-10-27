(function (M) {
  'use strict';

  // Plan an ascending tunnel through natural blocks. Every edge preserves
  // its landing and is checked with the same upright body used by movement.
  function create(world, body) {
    const size = world.blockSize, physics = M.actorPhysics;
    const terrain = (x, z) => world.terrainHeight ? world.terrainHeight(x, z) : world.surfaceHeight(x, z);
    const key = b => [b.bx, b.by, b.bz].join(',');
    let route = null, cooldown = 0, remaining = Infinity, age = 0;
    function reset() { route = null; cooldown = 0; remaining = Infinity; age = 0; }
    function natural(block) {
      if (!block || block.unbreakable || block.placed ||
          (block.type !== 'terrain' && block.type !== 'prop') ||
          (world.isProtectedArea && world.isProtectedArea(block.bx, block.bz))) return false;
      const above = world.blockInfoAt(block.bx, block.by + 1, block.bz);
      if (above && (above.placed || above.unbreakable)) return false;
      return !(M.towers && (M.towers.atCell(block.bx, block.by, block.bz) ||
        M.towers.atCell(block.bx, block.by + 1, block.bz)));
    }
    function dry(p) {
      const water = physics.waterInfo(world, p);
      return !water || water.level <= p.y + .1;
    }
    function transition(a, b, previouslyRemoved) {
      const removed = new Set(previouslyRemoved), blocks = new Map();
      const support = world.blockInfoAt(Math.floor(b.x / size), Math.round(b.y / size) - 1, Math.floor(b.z / size));
      if (!support || removed.has(key(support)) || !dry(b)) return null;
      function clearAt(x, y, z) {
        for (let bx = Math.floor((x - body.radius + .00001) / size); bx <= Math.floor((x + body.radius - .00001) / size); bx++) {
          for (let bz = Math.floor((z - body.radius + .00001) / size); bz <= Math.floor((z + body.radius - .00001) / size); bz++) {
            for (let by = Math.floor((y + .002) / size); by <= Math.floor((y + body.height - .00001) / size); by++) {
              const block = world.blockInfoAt(bx, by, bz);
              if (!block || removed.has(key(block))) continue;
              if (!natural(block) || (by + 1) * size <= a.y + .01) return false;
              removed.add(key(block)); blocks.set(key(block), block);
            }
          }
        }
        return physics.clear(world, x, y, z, body, true, removed);
      }
      const high = Math.max(a.y, b.y) + .05;
      for (let y = a.y; y < high; y += .2) if (!clearAt(a.x, y, a.z)) return null;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .2));
      for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        if (!clearAt(a.x + (b.x - a.x) * k, high, a.z + (b.z - a.z) * k)) return null;
      }
      if (removed.has(key(support))) return null;
      return { removed, blocks: Array.from(blocks.values()) };
    }
    function plan(p) {
      if (!world.blockInfoAt || p.y >= terrain(p.x, p.z) - .1) return null;
      const start = { x: p.x, y: p.y, z: p.z, cost: 0, score: 0, removed: new Set(), parent: null };
      const open = [start], seen = new Map();
      let best = null;
      for (let count = 0; open.length && count < 260; count++) {
        let index = 0;
        for (let i = 1; i < open.length; i++) if (open[i].score < open[index].score) index = i;
        const a = open.splice(index, 1)[0];
        if (a.y > p.y + .1 && (!best || a.y > best.y)) best = a;
        if (a.parent && a.y >= terrain(a.x, a.z) - .1) { best = a; break; }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (const rise of [size, 0]) {
            const b = { x: (Math.floor(a.x / size) + dx + .5) * size,
              y: Math.round(a.y / size) * size + rise,
              z: (Math.floor(a.z / size) + dz + .5) * size, parent: a };
            if (b.y - a.y > size + .05 || Math.hypot(b.x - p.x, b.z - p.z) > 40) continue;
            const id = [b.x, b.y, b.z].join('/');
            // Excavation is substantially more expensive than walking.
            const edge = transition(a, b, a.removed);
            if (!edge) continue;
            b.cost = a.cost + size + edge.blocks.length * 3;
            if (b.cost >= (seen.get(id) ?? Infinity)) continue;
            seen.set(id, b.cost); b.removed = edge.removed;
            b.score = b.cost + Math.max(0, terrain(b.x, b.z) - b.y) * 6 +
              Math.hypot(b.x - M.config.startingArea.x, b.z - M.config.startingArea.z) * .03;
            open.push(b);
          }
        }
      }
      if (!best) return null;
      const path = [];
      for (let n = best; n.parent; n = n.parent) path.unshift({ x: n.x, y: n.y, z: n.z });
      return path;
    }
    function visible(p, block) {
      const x = (block.bx + .5) * size, y = (block.by + .5) * size, z = (block.bz + .5) * size;
      const length = Math.hypot(x - p.x, y - p.y - 1.75, z - p.z);
      if (length > 5.5) return false;
      for (let d = 0; d < length; d += .15) {
        const k = d / length, px = p.x + (x - p.x) * k, py = p.y + 1.75 + (y - p.y - 1.75) * k, pz = p.z + (z - p.z) * k;
        const bx = Math.floor(px / size), by = Math.floor(py / size), bz = Math.floor(pz / size);
        if (bx === block.bx && by === block.by && bz === block.bz) return true;
        if (world.blockInfoAt(bx, by, bz) || (M.hearthTree && M.hearthTree.blockedAt(px, pz, py, py + .01))) return false;
      }
      return true;
    }
    function begin(p) { route = plan(p); age = 0; remaining = Infinity; return !!route; }
    function update(dt, p, state) {
      if (!route) return null;
      cooldown = Math.max(0, cooldown - dt); age += dt;
      let progress = false;
      while (route.length && Math.hypot(p.x - route[0].x, p.z - route[0].z) < .18 && Math.abs(p.y - route[0].y) < .15) {
        route.shift(); age = 0; remaining = Infinity; progress = true;
      }
      if (!route.length || age > 8) { reset(); return null; }
      const waypoint = route[0];
      if (!state.grounded) return { mode: 'escape', waypoint, enemy: null, progress };
      // Recheck against the actual world before each cut/jump, including edits
      // made by builders or the player while the escape is in progress.
      const edge = transition(p, waypoint);
      if (!edge) { reset(); return null; }
      if (edge.blocks.length < remaining) {
        progress ||= Number.isFinite(remaining);
        age = 0; remaining = edge.blocks.length;
      }
      if (!edge.blocks.length) return { mode: 'escape', waypoint, enemy: null, progress };
      const block = edge.blocks.find(b => visible(p, b));
      if (!block) { reset(); return null; }
      const dig = cooldown <= 0 ? block : null;
      if (dig) cooldown = .4;
      return { mode: 'escape', waypoint: null, enemy: null, dig, progress };
    }
    return { begin, update, reset, natural, visible, get active() { return !!route; } };
  }
  M.goatExcavation = { create };
})(window.Meadow = window.Meadow || {});
