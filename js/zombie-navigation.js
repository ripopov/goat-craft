(function (M) {
  'use strict';

  // A shared reverse flow field makes fifty walkers inexpensive. A bounded
  // weighted search is used only for disconnected walkers, to plan a breach.
  function create(world, tree, options) {
    const size = world.blockSize;
    const radius = (options && options.radius) || 28;
    const cx = Math.floor(tree.position.x / size), cz = Math.floor(tree.position.z / size);
    // Only extend the shared field along broad forest approaches. Sampling a
    // larger square everywhere would multiply startup and rebuild costs.
    const corridors = (options && options.gates || []).map(gate => ({ x: gate.x / size - .5, z: gate.z / size - .5 }));
    const roadArea = new Set();
    (options && options.roads || []).forEach(road => road.path.forEach(c => {
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) roadArea.add((c.bx + x) + ',' + (c.bz + z));
    }));
    const limit = Math.max(radius, ...corridors.map(gate => Math.ceil(Math.max(Math.abs(gate.x - cx), Math.abs(gate.z - cz))) + 4));
    const height = 2.8, bodyRadius = (options && options.bodyRadius) || 0.34;
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const samples = [[0, 0], [-bodyRadius, -bodyRadius], [bodyRadius, -bodyRadius], [-bodyRadius, bodyRadius], [bodyRadius, bodyRadius]];
    let columns = new Map(), nodes = [], revision = -1;

    function key(bx, bz) { return bx + ',' + bz; }
    function inside(bx, bz) {
      if (Math.abs(bx - cx) <= radius && Math.abs(bz - cz) <= radius) return true;
      if (roadArea.has(key(bx, bz))) return true;
      return corridors.some(gate => {
        const dx = gate.x - cx, dz = gate.z - cz, length = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((bx - cx) * dx + (bz - cz) * dz) / length));
        return Math.hypot(bx - cx - t * dx, bz - cz - t * dz) <= 4;
      });
    }
    function clear(x, y, z, includeTree, excavated) {
      if (world.bodyBlockedAt) return !world.bodyBlockedAt(x, z, y + 0.002, y + height, bodyRadius, includeTree, excavated);
      return samples.every(function (s) {
        const px = x + s[0], pz = z + s[1];
        if (!excavated) return !world.navigationBlockedAt(px, pz, y + 0.025, y + height, includeTree);
        if (tree.blockedAt(px, pz, y + 0.025, y + height)) return false;
        const bx = Math.floor(px / size), bz = Math.floor(pz / size);
        for (let by = Math.floor((y + 0.025) / size); by <= Math.floor((y + height - 0.001) / size); by++) {
          if (world.blockInfoAt(bx, by, bz) && !excavated.has(bx + ',' + by + ',' + bz)) return false;
        }
        return true;
      });
    }
    function contact(x, y, z) {
      if (Math.hypot(x - tree.position.x, z - tree.position.z) > 9) return false;
      for (let i = 0; i < 12; i++) {
        const dx = Math.sin(i * Math.PI / 6), dz = Math.cos(i * Math.PI / 6);
        // A wall between the mouth and the wood prevents eating the tree.
        if (tree.blockedAt(x + dx * 1.25, z + dz * 1.25, y + 0.4, y + 2.5) &&
            !world.navigationBlockedAt(x + dx * 0.65, z + dz * 0.65, y + 0.4, y + 2.5, false) &&
            !world.navigationBlockedAt(x + dx * 1.25, z + dz * 1.25, y + 0.4, y + 2.5, false)) return true;
      }
      return false;
    }
    function canWalk(a, b, excavated) {
      const shoreRise = a.swim && !b.swim && b.y >= a.waterLevel - .1 && b.y <= a.waterLevel + size + .01;
      if ((!shoreRise && b.y - a.y > size + 0.01) || a.y - b.y > size * 3 + 0.01) return false;
      const y = Math.max(a.y, b.y) + (shoreRise ? .6 : 0);
      for (let i = 0; i <= 4; i++) {
        const k = i / 4;
        if (!clear(a.x + (b.x - a.x) * k, y, a.z + (b.z - a.z) * k, true, excavated)) return false;
      }
      return true;
    }
    function makeColumn(bx, bz) {
      const x = (bx + 0.5) * size, z = (bz + 0.5) * size, column = [];
      const water = world.waterInfoAtBlock && world.waterInfoAtBlock(bx, bz);
      const swimming = water && water.depth > 1.3;
      const surface = swimming ? water.level - 1.3 : null;
      const floors = world.navigationSurfaces(bx, bz).filter(y => !swimming || y < water.top - .1 || y >= water.level);
      if (swimming) floors.push(surface);
      floors.forEach(function (y) {
        if (!clear(x, y, z)) return;
        column.push({ bx: bx, bz: bz, x: x, y: y, z: z, incoming: [], edges: [], next: null, distance: Infinity,
          swim: swimming && y === surface, waterLevel: swimming ? water.level : 0,
          road: !!(M.hellGates && M.hellGates.isRoad(bx, bz, y)), goal: contact(x, y, z) });
      });
      return column;
    }
    function link(a) {
      directions.forEach(function (d) {
        const column = columns.get(key(a.bx + d[0], a.bz + d[1])) || [];
        column.forEach(function (b) {
          if (canWalk(a, b)) { a.edges.push(b); b.incoming.push(a); }
        });
      });
    }
    function unlink(a) {
      a.edges.forEach(function (b) { const i = b.incoming.indexOf(a); if (i >= 0) b.incoming.splice(i, 1); });
      a.edges = [];
    }
    function rebuild() {
      const changes = revision < 0 || !world.navigationChangesSince ? null : world.navigationChangesSince(revision);
      if (changes && !changes.length) { revision = world.revision; return; }
      if (changes) {
        // Re-sample edited columns and reconnect their immediate neighbors.
        // A one-block edit must not stall rendering to rebuild the arena.
        const dirty = new Map(), affected = new Set();
        changes.forEach(function (change) {
          if (!inside(change.bx, change.bz)) return;
          dirty.set(key(change.bx, change.bz), change);
          affected.add(key(change.bx, change.bz));
          directions.forEach(function (d) { affected.add(key(change.bx + d[0], change.bz + d[1])); });
        });
        if (!dirty.size) { revision = world.revision; return; }
        dirty.forEach(function (change, id) {
          (columns.get(id) || []).forEach(function (a) {
            unlink(a);
            a.incoming.slice().forEach(function (b) { const i = b.edges.indexOf(a); if (i >= 0) b.edges.splice(i, 1); });
          });
          columns.set(id, makeColumn(change.bx, change.bz));
        });
        const reconnect = [];
        affected.forEach(function (id) { (columns.get(id) || []).forEach(function (a) { unlink(a); reconnect.push(a); }); });
        reconnect.forEach(function (a) { a.goal = contact(a.x, a.y, a.z); link(a); });
        nodes = []; columns.forEach(function (column) { nodes.push.apply(nodes, column); });
      } else {
        columns = new Map(); nodes = [];
        for (let bz = cz - limit; bz <= cz + limit; bz++) {
          for (let bx = cx - limit; bx <= cx + limit; bx++) {
            if (!inside(bx, bz)) continue;
            const column = makeColumn(bx, bz);
            columns.set(key(bx, bz), column); nodes.push.apply(nodes, column);
          }
        }
        nodes.forEach(link);
      }
      // Integer-cost buckets keep the shared field cheap while favoring the
      // winding roads. Open forest remains available when walls block paving.
      const queue = [[]];
      nodes.forEach(function (node) {
        node.next = null; node.distance = node.goal ? 0 : Infinity;
        if (node.goal) queue[0].push(node);
      });
      for (let distance = 0; distance < queue.length; distance++) {
        (queue[distance] || []).forEach(function (b) {
          if (b.distance !== distance) return;
          b.incoming.forEach(function (a) {
            const cost = distance + (roadArea.size && !a.road ? 3 : 1);
            if (a.distance <= cost) return;
            a.distance = cost; a.next = b;
            if (!queue[cost]) queue[cost] = [];
            queue[cost].push(a);
          });
        });
      }
      revision = world.revision;
    }
    function nodeAt(x, y, z) {
      const column = columns.get(key(Math.floor(x / size), Math.floor(z / size))) || [];
      const water = column.find(node => node.swim && y >= node.y - 1.5 && y < node.waterLevel + .1);
      if (water) return water;
      return column.find(function (node) { return Math.abs(node.y - y) < 0.6; }) || null;
    }
    function blocksFor(bx, bz, y) {
      const x = (bx + 0.5) * size, z = (bz + 0.5) * size;
      if (tree.blockedAt(x, z, y + 0.025, y + height)) return null;
      const blocks = [];
      for (let by = Math.floor((y + 0.025) / size); by <= Math.floor((y + height - 0.001) / size); by++) {
        const info = world.blockInfoAt(bx, by, bz);
        if (!info) continue;
        if (info.unbreakable) return null;
        if (info.type === 'terrain' && world.isProtectedArea(bx, bz)) return null;
        blocks.push(info);
      }
      return blocks;
    }
    function breach(start) {
      // Search virtual tunnels as well as exposed surfaces. Excavating costs
      // much more than walking, so a breach favors thin walls and short cuts.
      const open = [], best = new Map();
      function push(node, parent, cost, blocks) {
        const id = key(node.bx, node.bz) + ',' + node.y;
        if ((best.has(id) ? best.get(id) : Infinity) <= cost) return;
        best.set(id, cost);
        open.push(Object.assign({}, node, { parent: parent, cost: cost, blocks: blocks || [],
          score: cost + Math.hypot(node.bx - cx, node.bz - cz) }));
      }
      push(start, null, 0);
      let found = null;
      for (let visited = 0; open.length && visited < 5000; visited++) {
        let index = 0;
        for (let i = 1; i < open.length; i++) if (open[i].score < open[index].score) index = i;
        const a = open.splice(index, 1)[0];
        const real = nodeAt(a.x, a.y, a.z);
        if ((real && Number.isFinite(real.distance)) || contact(a.x, a.y, a.z)) { found = a; break; }
        directions.forEach(function (d) {
          const bx = a.bx + d[0], bz = a.bz + d[1];
          if (!inside(bx, bz)) return;
          const column = columns.get(key(bx, bz)) || [];
          const excavated = a.blocks.length ? new Set(a.blocks.map(function (block) { return block.bx + ',' + block.by + ',' + block.bz; })) : null;
          column.forEach(function (b) {
            if (canWalk(a, b, excavated)) push(b, a, a.cost + 1);
          });
          const y = Math.ceil((a.y - 0.01) / size) * size;
          if (y - a.y > size + 0.01 || !world.blockInfoAt(bx, Math.round(y / size) - 1, bz)) return;
          const blocks = blocksFor(bx, bz, y);
          if (!blocks || !blocks.length) return;
          const target = { bx: bx, bz: bz, x: (bx + 0.5) * size, y: y, z: (bz + 0.5) * size };
          const cleared = new Set(excavated || []);
          blocks.forEach(function (block) { cleared.add(block.bx + ',' + block.by + ',' + block.bz); });
          if (canWalk(a, target, cleared)) push(target, a, a.cost + 1 + blocks.length * 20, blocks);
        });
      }
      if (!found) return [];
      const path = [];
      for (let node = found; node.parent; node = node.parent) path.push(node);
      return path.reverse();
    }
    return { rebuild: rebuild, nodeAt: nodeAt, canWalk: canWalk, clear: clear, contact: contact, breach: breach,
      get revision() { return revision; }, get nodes() { return nodes; }, bodyHeight: height, radius: bodyRadius };
  }
  M.zombieNavigation = { create: create };
})(window.Meadow = window.Meadow || {});
