(function (M) {
  'use strict';

  // A stable, upright body box does not change size when the model turns.
  // Visual noses, horns, tails and gait poses never steer or lock movement.
  const EPSILON = 0.00001;
  function clear(world, x, y, z, body, includeTree, excavated) {
    if (world.bodyBlockedAt) return !world.bodyBlockedAt(x, z, y + body.skin, y + body.height,
      body.radius, includeTree, excavated);
    const query = world.blockedAt || world.navigationBlockedAt;
    const radius = body.radius - EPSILON;
    const steps = Math.max(1, Math.ceil(radius * 2 / 0.2));
    for (let ix = 0; ix <= steps; ix++) {
      for (let iz = 0; iz <= steps; iz++) {
        if (query.call(world, x - radius + radius * 2 * ix / steps,
          z - radius + radius * 2 * iz / steps, y + body.skin, y + body.height, includeTree)) return false;
      }
    }
    return true;
  }

  function support(world, position, maxY, body) {
    if (world.bodySupportHeight) return world.bodySupportHeight(position.x, position.z, maxY, body.radius);
    const query = world.landingHeight || world.supportHeight;
    const radius = body.radius - EPSILON;
    let floor = query.call(world, position.x, position.z, maxY);
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      floor = Math.max(floor, query.call(world, position.x + ix * radius, position.z + iz * radius, maxY));
    }
    return floor;
  }

  function moveVertical(world, position, body, target) {
    const start = position.y;
    const steps = Math.max(1, Math.ceil(Math.abs(target - start) / 0.12));
    for (let i = 1; i <= steps; i++) {
      const y = start + (target - start) * i / steps;
      if (!clear(world, position.x, y, position.z, body)) {
        let safe = position.y, blocked = y;
        for (let j = 0; j < 12; j++) {
          const mid = (safe + blocked) / 2;
          if (clear(world, position.x, mid, position.z, body)) safe = mid;
          else blocked = mid;
        }
        position.y = safe;
        return false;
      }
      position.y = y;
    }
    return true;
  }

  function moveHorizontal(world, position, body, dx, dz, accept) {
    const startX = position.x, startZ = position.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.12));
    dx /= steps; dz /= steps;
    function available(x, z) { return clear(world, x, position.y, z, body) && (!accept || accept(x, z)); }
    function axis(amount, isX) {
      if (Math.abs(amount) < EPSILON) return;
      const x = position.x, z = position.z;
      if (available(x + (isX ? amount : 0), z + (isX ? 0 : amount))) {
        if (isX) position.x += amount; else position.z += amount;
        return;
      }
      // Reach the contact plane, then preserve the tangential component.
      // Rejecting a whole step left a visible gap and snagged block seams.
      let low = 0, high = 1;
      for (let i = 0; i < 12; i++) {
        const mid = (low + high) / 2;
        if (available(x + (isX ? amount * mid : 0), z + (isX ? 0 : amount * mid))) low = mid;
        else high = mid;
      }
      if (isX) position.x += amount * low; else position.z += amount * low;
    }
    for (let i = 0; i < steps; i++) {
      // Resolve each axis even when the diagonal endpoint is clear: a direct
      // endpoint check can cut through the tip of a block between endpoints.
      if (Math.abs(dx) >= Math.abs(dz)) { axis(dx, true); axis(dz, false); }
      else { axis(dz, false); axis(dx, true); }
    }
    return Math.hypot(position.x - startX, position.z - startZ) > EPSILON;
  }

  function recover(world, position, body) {
    if (clear(world, position.x, position.y, position.z, body)) return false;
    const x = position.x, y = position.y, z = position.z;
    // First repair tiny grounding errors without sending an actor sideways.
    const floor = support(world, position, y + 0.1, body);
    if (floor >= y && floor - y <= 0.1 && clear(world, x, floor, z, body)) { position.y = floor; return true; }
    for (let r = 0.025; r <= 2.5; r += r < 0.2 ? 0.025 : 0.1) {
      for (let i = 0; i < 16; i++) {
        const nx = x + Math.sin(i * Math.PI / 8) * r, nz = z + Math.cos(i * Math.PI / 8) * r;
        if (clear(world, nx, y, nz, body)) { position.x = nx; position.z = nz; return true; }
      }
    }
    for (let ny = y + 0.1; ny <= y + 4.1; ny += 0.1) {
      if (clear(world, x, ny, z, body)) { position.y = ny; return true; }
    }
    return false;
  }

  function swimDepth(body) { return Math.min(1.3, body.height * 0.65); }

  function waterInfo(world, position) {
    if (!world.waterInfoAtBlock) return null;
    const size = world.blockSize || 2;
    return world.waterInfoAtBlock(Math.floor(position.x / size), Math.floor(position.z / size), position.y + .1);
  }

  function updateSwimming(world, position, body, state, dt) {
    state.shoreJump = Math.max(0, (state.shoreJump || 0) - dt);
    const water = waterInfo(world, position), draft = swimDepth(body);
    state.waterLevel = water ? water.level : 0;
    state.swimming = state.shoreJump <= 0 && !!water && water.depth > Math.min(1.2, draft) &&
      position.y < water.level - draft * (state.swimming ? .4 : .65);
    if (state.swimming) state.grounded = false;
    return water;
  }

  function float(world, position, body, state, dt) {
    const target = state.waterLevel - swimDepth(body);
    const wanted = Math.max(-3, Math.min(3, (target - position.y) * 4));
    state.vy += (wanted - Math.max(-4.5, Math.min(4, state.vy))) * (1 - Math.exp(-6 * dt));
    state.vy = Math.max(-4.5, Math.min(4, state.vy));
    const floor = support(world, position, position.y + .002, body);
    const next = Math.max(floor, Math.min(target + .08, position.y + state.vy * dt));
    if (!moveVertical(world, position, body, next) || next <= floor || next >= target + .08) state.vy = 0;
    state.grounded = false;
  }

  function shoreExit(world, position, body, dx, dz, waterLevel, gravity) {
    const length = Math.hypot(dx, dz), size = world.blockSize || 2;
    if (length < .00001 || position.y < waterLevel - swimDepth(body) - .55) return null;
    dx /= length; dz /= length;
    // Probe beyond the body into the actual next block, rather than testing
    // the tiny movement delta at the near face of the bank.
    for (let distance = body.radius + .2; distance <= size + body.radius + .4; distance += .2) {
      const x = position.x + dx * distance, z = position.z + dz * distance;
      const point = { x: x, y: position.y, z: z };
      const top = support(world, point, waterLevel + size + .05, body);
      if (top < waterLevel - .1 || top > waterLevel + size + .01 || top <= position.y + .1 ||
          !clear(world, x, top, z, body)) continue;
      const water = waterInfo(world, { x: x, y: top, z: z });
      if (water && water.level > top + .1) continue;
      const apex = top + .6;
      let open = true;
      for (let y = position.y; y <= apex; y += .2) if (!clear(world, position.x, y, position.z, body)) { open = false; break; }
      for (let i = 1; open && i <= 5; i++) if (!clear(world,
          position.x + dx * distance * i / 5, apex, position.z + dz * distance * i / 5, body)) open = false;
      if (!open) continue;
      const speed = Math.sqrt(2 * gravity * (apex - position.y));
      return { x: x, y: top, z: z, distance: distance, speed: speed, duration: speed * 2 / gravity + .15 };
    }
    return null;
  }

  // Bounded water search shared by autonomous actors. Each edge is swept at
  // the body's floating height; the final jump uses the real shore validator.
  function shoreRoute(world, position, body, waterLevel, gravity) {
    const size = world.blockSize || 2, y = waterLevel - swimDepth(body);
    const start = { x: position.x, y, z: position.z, parent: null };
    const queue = [start], seen = new Set(['0,0']);
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let index = 0; index < queue.length && index < 160; index++) {
      const a = queue[index];
      for (const [dx, dz] of directions) {
        const exit = shoreExit(world, a, body, dx, dz, waterLevel, gravity);
        if (exit) {
          const path = [exit];
          for (let node = a; node.parent; node = node.parent) path.unshift({ x: node.x, y, z: node.z });
          return path;
        }
        const b = { x: a.x + dx * size, y, z: a.z + dz * size, parent: a };
        if (Math.hypot(b.x - start.x, b.z - start.z) > 24) continue;
        const key = Math.round((b.x - start.x) / size) + ',' + Math.round((b.z - start.z) / size);
        if (seen.has(key)) continue;
        seen.add(key);
        let open = true;
        for (let d = .25; d <= size; d += .25) {
          const x = a.x + dx * d, z = a.z + dz * d;
          if (!clear(world, x, y, z, body) || !waterInfo(world, { x, y, z })) { open = false; break; }
        }
        if (open) queue.push(b);
      }
    }
    return null;
  }

  function launchShore(state, exit) {
    if (!exit) return false;
    state.shoreJump = exit.duration; state.shoreTarget = exit;
    state.vy = exit.speed; state.grounded = false; state.swimming = false;
    return true;
  }

  function intersectsBlock(position, body, bx, by, bz, size) {
    return position.x + body.radius > bx * size + EPSILON && position.x - body.radius < (bx + 1) * size - EPSILON &&
      position.z + body.radius > bz * size + EPSILON && position.z - body.radius < (bz + 1) * size - EPSILON &&
      position.y + body.height > by * size + EPSILON && position.y + body.skin < (by + 1) * size - EPSILON;
  }

  M.actorPhysics = { clear: clear, support: support, moveVertical: moveVertical,
    moveHorizontal: moveHorizontal, recover: recover, intersectsBlock: intersectsBlock,
    swimDepth: swimDepth, waterInfo: waterInfo, updateSwimming: updateSwimming, float: float,
    shoreExit: shoreExit, shoreRoute: shoreRoute, launchShore: launchShore };
})(window.Meadow = window.Meadow || {});
