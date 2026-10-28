(function (M) {
  'use strict';

  const JUMP_DELAY = 0.35;
  const DETOUR_DELAY = 1.1;
  const ESCAPE_DELAY = 2.2;
  const PROGRESS_DISTANCE = 0.08;

  function create() {
    return {
      mode: '',
      x: 0,
      y: 0,
      z: 0,
      goalX: 0,
      goalZ: 0,
      goalDistance: 0,
      initialized: false,
      stagnant: 0,
      stage: 'clear',
      reason: '',
      rescues: 0
    };
  }

  function reset(recovery) {
    recovery.initialized = false;
    recovery.stagnant = 0;
    recovery.stage = 'clear';
    recovery.reason = '';
  }

  function update(recovery, position, mode, intendsMove, dt, goal) {
    if (recovery.mode !== mode || !intendsMove) {
      recovery.mode = mode;
      reset(recovery);
      if (!intendsMove) return recovery.stage;
    }

    const goalDistance = goal ? Math.hypot(goal.x - position.x, goal.z - position.z) : 0;
    if (goal && recovery.initialized && Math.hypot(goal.x - recovery.goalX, goal.z - recovery.goalZ) > 1) {
      reset(recovery);
    }
    if (!recovery.initialized) {
      recovery.x = position.x;
      recovery.y = position.y;
      recovery.z = position.z;
      if (goal) {
        recovery.goalX = goal.x;
        recovery.goalZ = goal.z;
        recovery.goalDistance = goalDistance;
      }
      recovery.initialized = true;
      return recovery.stage;
    }

    const progress = Math.hypot(position.x - recovery.x, position.y - recovery.y, position.z - recovery.z);
    const forward = goal ? recovery.goalDistance - goalDistance : progress;
    if (progress >= PROGRESS_DISTANCE && forward >= PROGRESS_DISTANCE) {
      reset(recovery);
      recovery.mode = mode;
      return recovery.stage;
    }

    recovery.stagnant += dt;
    recovery.reason = mode + '-no-progress';
    recovery.stage = recovery.stagnant >= ESCAPE_DELAY ? 'escape' :
      recovery.stagnant >= DETOUR_DELAY ? 'detour' :
        recovery.stagnant >= JUMP_DELAY ? 'jump' : 'clear';
    return recovery.stage;
  }

  // This longer watchdog survives waypoint/job changes and airborne bobbing.
  // The short monitor above still handles local jumps and detours promptly.
  function trackTravel(state, position, grounded, intendsMove, dt) {
    const anchor = state.travelAnchor;
    if (!anchor || Math.hypot(position.x - anchor.x, position.z - anchor.z) >= 2 ||
        (grounded && position.y > anchor.y + 1)) {
      state.travelAnchor = { x: position.x, y: position.y, z: position.z };
      state.travelTime = 0;
    }
    if (intendsMove) state.travelTime += dt;
    return state.travelTime >= 6;
  }

  function direction(dx, dz) {
    const length = Math.hypot(dx, dz);
    if (length < 0.0001) return { x: 0, z: 1 };
    return { x: dx / length, z: dz / length };
  }

  function findLedge(world, position, body, dx, dz, canStand) {
    const size = world.blockSize || 2;
    const dir = direction(dx, dz);
    const probe = body.radius + size * 0.85;
    const x = position.x + dir.x * probe;
    const z = position.z + dir.z * probe;
    const physics = M.actorPhysics;
    const top = physics ? physics.support(world, { x, z }, position.y + size + .1, body) : world.supportHeight(x, z, position.y + size + .1);
    const rise = top - position.y;
    if (rise <= 0.12 || rise > size + 0.12 || !canStand(x, z, top)) return null;
    if (M.hearthTree && M.hearthTree.boxSupportHeight &&
        M.hearthTree.boxSupportHeight(x, z, body.radius, top + .01) > position.y + .1) return null;
    if (world.blockedAt(position.x, position.z, position.y + body.height - 0.08, top + body.height + 0.05)) return null;
    if (physics) {
      for (let y = position.y; y <= top + .05; y += .2) if (!physics.clear(world, position.x, y, position.z, body)) return null;
      for (let k = 0; k <= 1.001; k += .1) if (!physics.clear(world,
        position.x + (x - position.x) * k, top + .05, position.z + (z - position.z) * k, body)) return null;
    }
    return { x: x, z: z, top: top };
  }

  function findDetour(position, dx, dz, canStand) {
    const dir = direction(dx, dz);
    const angles = [0.6, -0.6, 1.0, -1.0, 1.45, -1.45, 1.9, -1.9, 2.4, -2.4];
    // Sweep out to five-plus units: a hearth tree trunk or a wide rock needs
    // a sideways step far enough to actually clear it, not just a nudge.
    for (let distance = 1.5; distance <= 5.41; distance += 1.3) {
      for (let i = 0; i < angles.length; i++) {
        const cos = Math.cos(angles[i]);
        const sin = Math.sin(angles[i]);
        const sx = dir.x * cos - dir.z * sin;
        const sz = dir.x * sin + dir.z * cos;
        const x = position.x + sx * distance;
        const z = position.z + sz * distance;
        if (canStand(x, z, position.y)) return { x: x, z: z, yaw: Math.atan2(sx, sz) };
      }
    }
    return null;
  }

  function blockedAhead(world, position, body, dx, dz) {
    const dir = direction(dx, dz);
    // Probe a fan of points along the travel direction instead of a single
    // sample at the body radius: a curved trunk or a tall rock can slip past
    // the old one-point probe, leaving the escape gate convinced the way is
    // clear while the animal grinds against the obstacle forever.
    for (let distance = body.radius + 0.35; distance <= body.radius + 4.4; distance += 0.65) {
      if (world.blockedAt(
        position.x + dir.x * distance,
        position.z + dir.z * distance,
        position.y + 0.12,
        position.y + body.height - 0.08
      )) return true;
    }
    return false;
  }

  function escapeDirection(world, position, preferred) {
    let best = { x: 0, z: 1, score: -Infinity };
    const wanted = preferred ? direction(preferred.x, preferred.z) : null;
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * Math.PI * 2;
      const x = Math.sin(angle);
      const z = Math.cos(angle);
      let score = wanted ? (x * wanted.x + z * wanted.z) * 4 : 0;
      for (let d = 1; d <= 3; d++) {
        score += world.surfaceHeight(position.x + x * d * 1.2, position.z + z * d * 1.2) / d;
      }
      if (score > best.score) best = { x: x, z: z, score: score };
    }
    return best;
  }

  function findDig(world, position, body, preferred) {
    const size = world.blockSize || 2;
    const bx0 = Math.floor(position.x / size);
    const bz0 = Math.floor(position.z / size);
    const feetBy = Math.round(position.y / size);
    const dir = escapeDirection(world, position, preferred);
    const layers = Math.max(1, Math.ceil((body.height + 0.1) / size));
    let best = null;
    let bestScore = Infinity;

    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const bx = bx0 + dx;
        const bz = bz0 + dz;
        const x = (bx + 0.5) * size;
        const z = (bz + 0.5) * size;
        const distance = Math.hypot(x - position.x, z - position.z);
        if (distance < 1.0 || distance > 3.2) continue;
        if (!world.blockedAt(x, z, position.y + 0.08, position.y + body.height + 0.08)) continue;
        const alignment = ((x - position.x) * dir.x + (z - position.z) * dir.z) / distance;
        if (alignment < 0.15) continue;

        for (let layer = 0; layer < layers; layer++) {
          const by = feetBy + layer;
          const info = world.blockInfoAt(bx, by, bz);
          if (!info || info.unbreakable) continue;
          const score = distance - alignment * 2.2 + layer * 0.35;
          if (score < bestScore) {
            bestScore = score;
            best = { type: info.type, bx: bx, by: by, bz: bz, kind: info.kind,
              x: x, y: (by + 1) * size, z: z };
          }
        }
      }
    }
    return best;
  }

  function findStep(world, position, body, canStand, preferred) {
    const size = world.blockSize || 2;
    const bx0 = Math.floor(position.x / size);
    const bz0 = Math.floor(position.z / size);
    const dir = escapeDirection(world, position, preferred);
    let best = null;
    let bestScore = Infinity;

    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const bx = bx0 + dx;
        const bz = bz0 + dz;
        const x = (bx + 0.5) * size;
        const z = (bz + 0.5) * size;
        const distance = Math.hypot(x - position.x, z - position.z);
        if (distance < 1.15 || distance > 3.2) continue;
        const top = world.landingHeight(x, z, position.y + size * 2 + 0.08);
        if (Math.abs(top - (position.y + size)) > 0.12 || !canStand(x, z, top)) continue;
        const alignment = ((x - position.x) * dir.x + (z - position.z) * dir.z) / distance;
        const score = distance - alignment * 1.1;
        if (score < bestScore) {
          bestScore = score;
          best = { bx: bx, bz: bz, x: x, z: z, top: top };
        }
      }
    }
    return best;
  }

  function findPlacement(world, position, body, canPlace, preferred) {
    const size = world.blockSize || 2;
    const bx0 = Math.floor(position.x / size);
    const bz0 = Math.floor(position.z / size);
    const feetBy = Math.round(position.y / size);
    const dir = escapeDirection(world, position, preferred);
    let best = null;
    let bestScore = Infinity;

    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const bx = bx0 + dx;
        const bz = bz0 + dz;
        const x = (bx + 0.5) * size;
        const z = (bz + 0.5) * size;
        const distance = Math.hypot(x - position.x, z - position.z);
        if (distance < 1.2 || distance > 3.1 || !canPlace(bx, feetBy, bz, x, z)) continue;
        if (world.blockedAt(x, z, position.y + size + 0.08, position.y + size + body.height + 0.1)) continue;
        const alignment = ((x - position.x) * dir.x + (z - position.z) * dir.z) / distance;
        const score = distance - alignment * 0.9;
        if (score < bestScore) {
          bestScore = score;
          best = { phase: 'escape', bx: bx, by: feetBy, bz: bz,
            x: x, z: z, top: position.y + size };
        }
      }
    }
    return best;
  }

  M.animalRecovery = {
    create: create,
    reset: reset,
    update: update,
    trackTravel: trackTravel,
    findLedge: findLedge,
    findDetour: findDetour,
    blockedAhead: blockedAhead,
    escapeDirection: escapeDirection,
    findDig: findDig,
    findStep: findStep,
    findPlacement: findPlacement,
    delays: { jump: JUMP_DELAY, detour: DETOUR_DELAY, escape: ESCAPE_DELAY }
  };
})(window.Meadow = window.Meadow || {});
