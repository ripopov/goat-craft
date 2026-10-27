(function (M) {
  'use strict';

  // Shared locomotion planner for every NPC role and upright body size.
  // Direct sweeps, a cached landmark graph, and bounded terrain search all
  // return the same waypoint interface; excavation stays with the caller.
  const RINGS = [7.8, 10.5], SPOKES = 24;
  function create(world, tree) {
    let revision = -1;
    const graphs = new Map();
    const physics = M.actorPhysics;
    function clear(a, b, body) {
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .25));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        if (!physics.clear(world, x, a.y, z, body)) return false;
        const floor = physics.support(world, { x: x, z: z }, a.y + .06, body);
        if (a.y - floor > 2.25 || (world.waterAt && world.waterAt(x, floor + .1, z))) return false;
      }
      return true;
    }
    function graph(body, y) {
      if (revision !== world.revision) { graphs.clear(); revision = world.revision; }
      const key = [body.radius, body.height, y].join('/');
      if (graphs.has(key)) return graphs.get(key);
      const nodes = RINGS.flatMap(function (radius) {
        return Array.from({ length: SPOKES }, function (_, i) {
          const angle = i * Math.PI * 2 / SPOKES;
          return { x: tree.x + Math.sin(angle) * radius, y: y, z: tree.z + Math.cos(angle) * radius, edges: [] };
        });
      });
      nodes.forEach(function (node, i) {
        const ring = Math.floor(i / SPOKES), spoke = i % SPOKES;
        const neighbors = [ring * SPOKES + (spoke + 1) % SPOKES];
        if (ring === 0) neighbors.push(SPOKES + spoke, SPOKES + (spoke + 1) % SPOKES, SPOKES + (spoke + SPOKES - 1) % SPOKES);
        neighbors.forEach(function (j) {
          if (!clear(node, nodes[j], body)) return;
          const cost = Math.hypot(node.x - nodes[j].x, node.z - nodes[j].z);
          node.edges.push({ to: j, cost: cost }); nodes[j].edges.push({ to: i, cost: cost });
        });
      });
      // Do not accumulate an unbounded cache of temporary airborne heights.
      if (graphs.size >= 8) graphs.clear();
      graphs.set(key, nodes);
      return nodes;
    }
    function plan(position, goal, body) {
      const nodes = graph(body, position.y), costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set();
      nodes.forEach(function (node, i) {
        if (clear(position, node, body)) costs[i] = Math.hypot(position.x - node.x, position.z - node.z);
      });
      let best = -1, total = Infinity;
      for (let step = 0; step < nodes.length; step++) {
        let next = -1;
        for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (next < 0 || costs[i] < costs[next])) next = i;
        if (next < 0 || costs[next] >= total || !Number.isFinite(costs[next])) break;
        visited.add(next);
        const node = nodes[next];
        if (clear(node, goal, body)) {
          const candidate = costs[next] + Math.hypot(goal.x - node.x, goal.z - node.z);
          if (candidate < total) { best = next; total = candidate; }
        }
        node.edges.forEach(function (edge) {
          const cost = costs[next] + edge.cost;
          if (cost < costs[edge.to]) { costs[edge.to] = cost; previous[edge.to] = next; }
        });
      }
      if (best < 0) return null;
      const path = [goal];
      for (let i = best; i >= 0; i = previous[i]) path.unshift(nodes[i]);
      return path;
    }
    function stepClear(a, b, body) {
      const size = world.blockSize || 2;
      if (!Number.isFinite(b.y) || b.y < 0 || b.y - a.y > size + .01 || a.y - b.y > size + .25) return false;
      const rise = b.y > a.y + .1;
      // A root is not a staircase. Ordinary travel stays around the Hearth;
      // explicit construction climbs keep their own movement controller.
      if (rise && M.hearthTree && M.hearthTree.boxSupportHeight &&
          M.hearthTree.boxSupportHeight(b.x, b.z, body.radius, b.y + .01) > a.y + .1) return false;
      const high = Math.max(a.y, b.y) + (rise ? .05 : 0);
      if (rise) for (let y = a.y; y <= high; y += .2) {
        if (!physics.clear(world, a.x, y, a.z, body)) return false;
      }
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .25));
      for (let i = 0; i <= steps; i++) {
        const k = i / steps, x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
        if (!physics.clear(world, x, high, z, body)) return false;
        const floor = physics.support(world, { x, z }, high + .01, body);
        if (!Number.isFinite(floor) || high - floor > size + .25 ||
            (world.waterAt && world.waterAt(x, floor + .1, z))) return false;
      }
      return true;
    }
    function detour(position, goal, body) {
      const size = world.blockSize || 2;
      const open = [{ x: position.x, y: position.y, z: position.z, cost: 0, score: 0, parent: null }];
      const seen = new Map();
      // A local search handles ordinary buildings and concave walls. Long
      // enclosures still use the existing excavation/escape controller.
      const margin = size * 5;
      for (let count = 0; open.length && count < 240; count++) {
        let index = 0;
        for (let i = 1; i < open.length; i++) if (open[i].score < open[index].score) index = i;
        const a = open.splice(index, 1)[0];
        if (Math.hypot(goal.x - a.x, goal.z - a.z) <= size * 1.5 && stepClear(a, goal, body)) {
          const result = [goal];
          for (let n = a; n.parent; n = n.parent) result.unshift(n);
          return result;
        }
        for (const [dx, dz] of [[size, 0], [-size, 0], [0, size], [0, -size]]) {
          const x = a.x + dx, z = a.z + dz;
          if (x < Math.min(position.x, goal.x) - margin || x > Math.max(position.x, goal.x) + margin ||
              z < Math.min(position.z, goal.z) - margin || z > Math.max(position.z, goal.z) + margin) continue;
          const y = physics.support(world, { x, z }, a.y + size + .01, body);
          const b = { x, y, z, parent: a, cost: a.cost + size + Math.abs(y - a.y) * .5 };
          const id = [x, y, z].join('/');
          if (b.cost >= (seen.get(id) ?? Infinity) || !stepClear(a, b, body)) continue;
          seen.set(id, b.cost);
          b.score = b.cost + Math.hypot(goal.x - x, goal.z - z);
          open.push(b);
        }
      }
      return null;
    }
    function waypoint(position, goal, body, state) {
      const displaced = state.last && Math.hypot(position.x - state.last.x, position.z - state.last.z) > 4;
      state.last = { x: position.x, z: position.z };
      const changed = displaced || !state.goal || Math.hypot(goal.x - state.goal.x, goal.z - state.goal.z) > 1 ||
        state.revision !== world.revision || Math.abs((state.y || 0) - position.y) > .3;
      if (changed || state.retry <= 0) {
        const size = world.blockSize || 2;
        state.goal = { x: goal.x, y: position.y, z: goal.z }; state.revision = world.revision; state.y = position.y;
        state.retry = .75;
        if (changed || !state.path) {
          const floor = physics.support(world, goal, position.y + size + .01, body);
          const surface = world.surfaceHeight ? world.surfaceHeight(goal.x, goal.z) : floor;
          // A higher destination can require pit recovery; it is not an
          // invalid goal merely because this search starts below its floor.
          state.invalid = surface <= position.y + size + .01 &&
            (!Number.isFinite(floor) || !physics.clear(world, goal.x, floor, goal.z, body));
          state.goal.y = floor;
          if (state.invalid) state.path = null;
          else if (clear(position, state.goal, body) && Math.abs(floor - position.y) < .1) state.path = [];
          else {
            const dx = goal.x - position.x, dz = goal.z - position.z, length2 = dx * dx + dz * dz;
            const t = length2 ? M.utils.clamp(((tree.x - position.x) * dx + (tree.z - position.z) * dz) / length2, 0, 1) : 0;
            const nearTree = Math.hypot(position.x + dx * t - tree.x, position.z + dz * t - tree.z) <= 8;
            state.path = (nearTree && plan(position, state.goal, body)) || detour(position, state.goal, body);
          }
        }
      }
      while (state.path && state.path.length && Math.hypot(state.path[0].x - position.x, state.path[0].z - position.z) < .3 &&
          Math.abs(state.path[0].y - position.y) < .3) {
        state.path.shift(); state.progress = (state.progress || 0) + 1;
      }
      if (state.invalid) return null;
      return state.path && state.path.length ? state.path[0] : state.goal;
    }
    return { waypoint: waypoint, clear: clear, stepClear: stepClear };
  }
  M.animalNavigation = { create: create };
})(window.Meadow = window.Meadow || {});
