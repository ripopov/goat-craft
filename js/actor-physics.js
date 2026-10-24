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

  function intersectsBlock(position, body, bx, by, bz, size) {
    return position.x + body.radius > bx * size + EPSILON && position.x - body.radius < (bx + 1) * size - EPSILON &&
      position.z + body.radius > bz * size + EPSILON && position.z - body.radius < (bz + 1) * size - EPSILON &&
      position.y + body.height > by * size + EPSILON && position.y + body.skin < (by + 1) * size - EPSILON;
  }

  M.actorPhysics = { clear: clear, support: support, moveVertical: moveVertical,
    moveHorizontal: moveHorizontal, recover: recover, intersectsBlock: intersectsBlock };
})(window.Meadow = window.Meadow || {});
