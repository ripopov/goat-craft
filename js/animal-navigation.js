(function (M) {
  'use strict';

  // A small visibility graph around the Hearth's buttress roots. All edges
  // sweep the actual upright body; turning the visual rig cannot change a route.
  // Graphs are shared by body size and rebuilt only after a world edit.
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
    function waypoint(position, goal, body, state) {
      const dx = goal.x - position.x, dz = goal.z - position.z, length2 = dx * dx + dz * dz;
      const t = length2 ? M.utils.clamp(((tree.x - position.x) * dx + (tree.z - position.z) * dz) / length2, 0, 1) : 0;
      if (Math.hypot(position.x + dx * t - tree.x, position.z + dz * t - tree.z) > 8) { state.path = null; return goal; }
      const changed = !state.goal || Math.hypot(goal.x - state.goal.x, goal.z - state.goal.z) > 1 ||
        state.revision !== world.revision || Math.abs((state.y || 0) - position.y) > .3;
      if (changed || state.retry <= 0) {
        state.goal = { x: goal.x, y: position.y, z: goal.z }; state.revision = world.revision; state.y = position.y;
        state.retry = .75;
        // Keep a committed route until its waypoints are passed. Replanning
        // every frame flips between equally short sides of a rounded trunk.
        if (changed || !state.path) state.path = clear(position, state.goal, body) ? [] : plan(position, state.goal, body);
      }
      while (state.path && state.path.length && Math.hypot(state.path[0].x - position.x, state.path[0].z - position.z) < .3) state.path.shift();
      return state.path && state.path.length ? state.path[0] : goal;
    }
    return { waypoint: waypoint, clear: clear };
  }
  M.animalNavigation = { create: create };
})(window.Meadow = window.Meadow || {});
