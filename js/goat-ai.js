(function (M) {
  'use strict';

  // Strategic pilot: decisions at 4 Hz, ordinary movement/combat every tick.
  // Normal routes use real physics; persistent entrapment has an explicit rescue.
  function create(world, body) {
    const physics = M.actorPhysics, size = world.blockSize;
    const home = M.config.startingArea;
    const excavation = M.goatExcavation ? M.goatExcavation.create(world, body) : null;
    let digRetry = 0;
    let target = null, path = [], timer = 0, revision = -1, clock = 0;
    let last = null, stuck = 0, shore = null, shoreTimer = 0;
    let recoveryTime = 0, progressPoint = null, progressTime = 0;
    let rescued = 0, mission = null, missionBest = Infinity, missionAge = 0;
    const failures = new Map();
    const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    function safe(x, y, z) {
      const floor = physics.support(world, { x, z }, y + .06, body);
      if (!Number.isFinite(floor) || floor < 0) return false;
      const water = physics.waterInfo(world, { x, y: floor, z });
      return y - floor <= size + .05 &&
        !(water && water.level > floor + .1) && physics.clear(world, x, y, z, body);
    }
    function landing(x, y, z) {
      const floor = physics.support(world, { x, z }, y + .06, body);
      if (!Number.isFinite(floor) || floor < 0 || !safe(x, floor, z)) return false;
      // There is no fall damage. A large descent is safe if it ends on dry,
      // solid ground and the entire upright body can fall down this column.
      for (let h = y; h > floor; h -= .25) if (!physics.clear(world, x, h, z, body)) return false;
      return true;
    }
    function edge(a, b) {
      if (!Number.isFinite(b.y) || b.y < 0 || b.y - a.y > size + .05) return false;
      const rise = b.y > a.y + .1, y = Math.max(a.y, b.y) + (rise ? .05 : 0);
      if (rise) for (let h = a.y; h <= y; h += .2) if (!physics.clear(world, a.x, h, a.z, body)) return false;
      const steps = Math.ceil(distance(a, b) / .2);
      for (let i = 0; i <= steps; i++) {
        const k = steps ? i / steps : 0, x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k;
        if (!physics.clear(world, x, y, z, body)) return false;
        if (!rise && !(a.y - b.y > .1 ? landing(x, y, z) : safe(x, y, z))) return false;
      }
      return true;
    }
    function reached(p, goal) {
      if (goal.kind === 'defend') return M.enemies.canHit(goal.ref, p, 0, true, goal.range);
      if (goal.kind === 'collect') {
        return distance(p, goal.position) < .8 && Math.abs(p.y + .9 - goal.position.y) < 1.6 &&
          (!M.items.nearestCoin || M.items.nearestCoin(p, .8) === goal.ref);
      }
      return distance(p, goal.position) < .8 && Math.abs(p.y - goal.position.y) < .2;
    }
    function routeTo(node) {
      const result = [];
      for (let n = node; n.parent; n = n.parent) result.unshift(n);
      return result;
    }
    function plan(start, goal) {
      if (reached(start, goal)) return [];
      // Search on demand, with a strict expansion budget. Keys include height
      // so bridges and tunnels do not alias each other.
      const open = [{ x: start.x, y: start.y, z: start.z, g: 0, f: 0, parent: null }];
      const costs = new Map();
      const key = p => [Math.round(p.x / size), Math.round(p.z / size), Math.round(p.y * 10)].join('/');
      costs.set(key(start), 0);
      const remaining = p => Math.max(0, distance(p, goal.position) - (goal.range || 0)) +
        Math.abs(p.y - (goal.position.y ?? world.surfaceHeight(goal.position.x, goal.position.z))) * .5;
      let partial = null, closest = remaining(start);
      for (let count = 0; open.length && count < 700; count++) {
        let best = 0;
        for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
        const a = open.splice(best, 1)[0];
        if (a.g > costs.get(key(a))) continue;
        if (remaining(a) < closest - size) { partial = a; closest = remaining(a); }
        let finish = null;
        if (goal.kind !== 'defend' && distance(a, goal.position) < size * 1.5) {
          const x = goal.position.x, z = goal.position.z;
          const y = physics.support(world, { x, z }, a.y + size + .01, body);
          const end = { x, y, z };
          if (reached(end, goal) && safe(x, y, z) && edge(a, end)) finish = end;
        }
        if (reached(a, goal) || finish) {
          const result = finish ? [finish] : [];
          for (let n = a; n.parent; n = n.parent) result.unshift(n);
          return result;
        }
        for (const [dx, dz] of [[size, 0], [-size, 0], [0, size], [0, -size]]) {
          const x = a.x + dx, z = a.z + dz;
          const y = physics.support(world, { x, z }, a.y + size + .01, body);
          const b = { x, y, z, parent: a, g: a.g + size + Math.abs(y - a.y) };
          if (!safe(x, y, z) || !edge(a, b)) continue;
          const id = key(b);
          if (b.g >= (costs.get(id) ?? Infinity)) continue;
          costs.set(id, b.g);
          b.f = b.g + Math.max(0, distance(b, goal.position) - (goal.range || 0));
          open.push(b);
        }
      }
      // A long return trip can exceed one search budget. Follow a useful
      // prefix and continue from its end instead of abandoning the whole trip.
      return open.length && partial ? routeTo(partial) : null;
    }
    function candidates(p, range) {
      const enemies = M.enemies;
      const threats = (enemies ? enemies.zombies : []).filter(e => e.hp > 0 &&
        enemies.isTargetable(e, p) && distance(e.position, home) <= 45);
      const score = e => (e.mode === 'tree' ? -100 : 0) + distance(e.position, home) +
        distance(e.position, p) * .25 - (target && target.ref === e ? 3 : 0);
      threats.sort((a, b) => score(a) - score(b));
      // Any reachable threat takes precedence over loot, including a new
      // attacker while a coin route is already committed.
      const result = threats.map(e => ({ kind: 'defend', ref: e, position: e.position, range }));
      if (!threats.length) {
        const coins = (M.items ? M.items.drops : []).filter(d => d.userData.drop.kind === 'coin');
        coins.sort((a, b) => distance(a.position, p) - distance(b.position, p));
        coins.forEach(c => result.push({ kind: 'collect', ref: c, position: c.position }));
      }
      const angle = Math.atan2(p.x - home.x, p.z - home.z);
      for (let i = 0; i < 8; i++) {
        const turn = angle + i * Math.PI / 4;
        const x = home.x + Math.sin(turn) * 10, z = home.z + Math.cos(turn) * 10;
        const y = world.surfaceHeight(x, z);
        if (safe(x, y, z)) result.push({ kind: 'guard', ref: 'home' + i, position: { x, z, y } });
      }
      return result;
    }
    function escapeWater(p, state, dt) {
      shoreTimer -= dt;
      if (shoreTimer <= 0) {
        shoreTimer = 2;
        shore = physics.shoreRoute(world, p, body, state.waterLevel, 26);
      }
      while (shore && shore.length > 1 && distance(p, shore[0]) < .25) shore.shift();
      return { mode: 'return', waypoint: shore && shore[0], enemy: null };
    }
    function clearRoute() { target = null; path = []; timer = 0; last = null; stuck = 0; failures.clear(); shore = null; shoreTimer = 0; }
    function reset() {
      clearRoute(); recoveryTime = 0; progressPoint = null; progressTime = 0;
      mission = null; missionBest = Infinity; missionAge = 0;
      if (excavation) excavation.reset();
      digRetry = 0;
    }
    function rescue() {
      // Last resort for sealed pits, enclosed buildings, or disconnected
      // islands. Never mine the player's structures or create a new trap.
      for (const radius of [12, 16, 20, 24, 32]) for (let i = 0; i < 24; i++) {
        const angle = i * Math.PI / 12;
        const x = home.x + Math.sin(angle) * radius, z = home.z + Math.cos(angle) * radius;
        const y = physics.support(world, { x, z }, world.surfaceHeight(x, z) + .06, body);
        if (!safe(x, y, z)) continue;
        // Require space to leave the rescue point, not just room to stand.
        if (![[size, 0], [-size, 0], [0, size], [0, -size]].some(([dx, dz]) => {
          const next = { x: x + dx, z: z + dz };
          next.y = physics.support(world, next, y + size + .01, body);
          return safe(next.x, next.y, next.z) && edge({ x, y, z }, next);
        })) continue;
        reset(); rescued++;
        return { mode: 'return', waypoint: null, enemy: null, rescue: { x, y, z } };
      }
      // If the entire Hearth area is sealed, remain safe and retry later.
      recoveryTime = 8; missionAge = 0;
      return { mode: 'return', waypoint: null, enemy: null };
    }
    function recovery(dt, p, settled) {
      if (settled) {
        recoveryTime = 0; progressPoint = null; progressTime = 0;
        mission = null; missionBest = Infinity; missionAge = 0;
        return false;
      }
      const goal = target ? target.position : home;
      const id = target && target.kind !== 'guard' ? target.ref : 'return';
      const remaining = distance(p, goal) + Math.abs(p.y - (goal.y ?? world.surfaceHeight(goal.x, goal.z)));
      if (id !== mission || remaining < missionBest - .5) {
        mission = id; missionBest = remaining; missionAge = 0;
      } else missionAge += dt;
      recoveryTime += dt; progressTime += dt;
      if (!progressPoint) progressPoint = { x: p.x, y: p.y, z: p.z };
      // Measure displacement across a time window, not one frame: crawling
      // through mire at 144 Hz must not be mistaken for being motionless.
      if (progressTime >= 1) {
        if (Math.hypot(p.x - progressPoint.x, p.y - progressPoint.y, p.z - progressPoint.z) >= .35) recoveryTime = 0;
        progressPoint = { x: p.x, y: p.y, z: p.z }; progressTime = 0;
      }
      // Moving back and forth is not useful progress either. Allow generous
      // time for detours, then recover even if the goat is still animating.
      return recoveryTime >= 10 || missionAge >= 30;
    }
    function update(dt, p, state, range) {
      clock += dt; timer -= dt; digRetry -= dt;
      if (M.hearthTree && M.hearthTree.health <= 0) return { mode: 'guard', waypoint: null, enemy: null };
      if (excavation && excavation.active) {
        const command = excavation.update(dt, p, state);
        if (command) {
          // Only completed cuts or real movement count as progress. Repeated
          // failed mining attempts cannot postpone recovery indefinitely.
          if (command.progress) { recoveryTime = 0; missionAge = 0; }
          if (recovery(dt, p, false)) return rescue();
          return command;
        }
        clearRoute();
      }
      const settled = target && !path.length && reached(p, target);
      if (recovery(dt, p, settled)) return rescue();
      if (state.shoreJump > 0 && state.shoreTarget) return { mode: 'return', waypoint: state.shoreTarget, enemy: null };
      if (state.swimming) return escapeWater(p, state, dt);
      if (revision !== world.revision) { revision = world.revision; clearRoute(); }
      for (const [ref, until] of failures) if (until <= clock) failures.delete(ref);
      if (path.length && state.grounded) {
        if (!last || Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) >= .1) {
          last = { x: p.x, y: p.y, z: p.z }; stuck = 0;
        } else stuck += dt;
      } else { last = null; stuck = 0; }
      if (stuck > 1.5) { if (target) failures.set(target.ref, clock + 3); target = null; path = []; timer = 0; stuck = 0; }
      if (timer <= 0 && state.grounded) {
        timer = .25;
        let attempts = 0, chosen = false;
        for (const goal of candidates(p, range)) {
          if (failures.has(goal.ref)) continue;
          if (target && goal.ref === target.ref && path.length && distance(goal.position, target.planned) < 2) { chosen = true; break; }
          if (++attempts > 3) break;
          const route = plan(p, goal);
          if (route) { target = goal; target.planned = { ...goal.position }; path = route; chosen = true; break; }
          failures.set(goal.ref, clock + 3);
        }
        if (!chosen) { target = null; path = []; }
      }
      if (target && reached(p, target)) path = [];
      while (path.length && distance(p, path[0]) < .18 && Math.abs(p.y - path[0].y) < .15) path.shift();
      if (path.length && state.grounded && distance(p, path[0]) < .18 && p.y > path[0].y + .15) {
        // A branch/roof intercepted a descent. Replan from that real landing.
        path = []; target = null; timer = 0;
      }
      if (!path.length && (!target || !reached(p, target)) && state.grounded && !state.swimming &&
          excavation && digRetry <= 0) {
        digRetry = 2;
        if (excavation.begin(p)) {
          target = null; path = [];
          const command = excavation.update(dt, p, state);
          if (command) return command;
        }
      }
      return { mode: target ? target.kind : 'guard', waypoint: path[0] || null,
        enemy: target && target.kind === 'defend' ? target.ref : null };
    }
    function accept(x, y, z) {
      return safe(x, y, z) || (!!path.length && path[0].y < y - .1 && landing(x, y, z));
    }
    return { update, reset, safe, edge, accept,
      canDig: (p, b) => excavation && excavation.natural(world.blockInfoAt(b.bx, b.by, b.bz)) && excavation.visible(p, b),
      get rescues() { return rescued; } };
  }
  M.goatAI = { create };
})(window.Meadow = window.Meadow || {});
