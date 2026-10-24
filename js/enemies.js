(function (M) {
  'use strict';

  const MAX_ENEMIES = 50, WATCHDOG_SECONDS = 20;
  const SIZE = 2;
  const TYPES = {
    zombie: { name: 'Zombie', unlock: 1, hp: 2, speed: 1.65, reward: 1, bite: 3, damage: 1, chew: 10, radius: 0.34, height: 2.8 },
    spider: { name: 'Spider', unlock: 3, hp: 2, speed: 2.7, reward: 2, bite: 3.5, damage: 1, chew: 12, radius: 0.42, height: 1.15 },
    skeleton: { name: 'Skeleton', unlock: 5, hp: 3, speed: 1.9, reward: 2, bite: 2.6, damage: 1, chew: 10, radius: 0.34, height: 2.8 },
    brute: { name: 'Stone brute', unlock: 8, hp: 7, speed: 1.15, reward: 4, bite: 3.5, damage: 2, chew: 7, radius: 0.44, height: 2.8 }
  };
  function waveSize(level) { return Math.min(MAX_ENEMIES, 1 + level * 3); }
  // Deterministic slots introduce a readable mix and bound the durable units.
  function typeForWave(level, slot) {
    if (level >= 8 && slot % 6 === 5) return 'brute';
    if (level >= 5 && slot % 4 === 2) return 'skeleton';
    if (level >= 3 && slot % 3 === 1) return 'spider';
    return 'zombie';
  }
  const physics = M.actorPhysics, BODY = { radius: 0.34, height: 2.8, skin: 0.002 };
  const { clamp, turnToward, damp } = M.utils;
  const zombies = [], fallen = [];
  let scene, world, tree, navigation, mesh, outlineMesh;
  let elapsed = 0, wave = 0, nextWave = 10, pending = 0, spawnTimer = 0, coins = 0, waveSpawned = 0;
  let rebuildTimer = 0, plannerTimer = 0, nextId = 0, hudKey = '';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const matrix = new THREE.Matrix4(), rootMatrix = new THREE.Matrix4();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion(), rotation = new THREE.Euler();
  const color = new THREE.Color();

  // One instanced draw for the whole horde, with articulated cuboid limbs,
  // layered face pixels, torn clothing and varied moss-green skin.
  const parts = [];
  function part(x, y, z, sx, sy, sz, tint, limb) {
    parts.push({ x: x, y: y, z: z, sx: sx, sy: sy, sz: sz, tint: tint, limb: limb || 0 });
  }
  part(0, 1.55, 0, 0.84, 1.0, 0.44, 0x386e78);
  part(0, 1.98, 0.02, 0.42, 0.16, 0.46, 0x528e69);
  part(-0.3, 1.28, 0.24, 0.22, 0.27, 0.035, 0x29505b);
  part(0.2, 1.56, 0.24, 0.16, 0.22, 0.035, 0x5e9270);
  part(0.27, 1.14, 0.02, 0.21, 0.14, 0.48, 0x609575);
  part(0, 2.42, 0.015, 0.88, 0.78, 0.73, 0x6d9a65);
  part(-0.27, 2.68, 0.39, 0.28, 0.12, 0.04, 0x43644c);
  part(0.26, 2.7, 0.39, 0.2, 0.1, 0.04, 0x52754d);
  part(-0.21, 2.46, 0.4, 0.22, 0.16, 0.06, 0x24362c);
  part(0.21, 2.46, 0.4, 0.22, 0.16, 0.06, 0x24362c);
  part(-0.19, 2.47, 0.44, 0.075, 0.07, 0.035, 0xdccf89);
  part(0.23, 2.47, 0.44, 0.075, 0.07, 0.035, 0xdccf89);
  part(0.02, 2.3, 0.43, 0.16, 0.18, 0.18, 0x52794f);
  part(0, 2.16, 0.4, 0.36, 0.11, 0.05, 0x2f4430);
  part(-0.08, 2.18, 0.44, 0.08, 0.055, 0.025, 0xc5bf96);
  part(-0.44, 2.4, 0.01, 0.08, 0.23, 0.22, 0x557f54);
  part(0.44, 2.4, 0.01, 0.08, 0.23, 0.22, 0x557f54);
  parts.forEach(function (p, i) {
    if (i >= 5) { p.limb = i === 13 || i === 14 ? 6 : 5; p.y -= 2.04; }
  });
  // Limb coordinates are relative to hip / shoulder pivots.
  [-1, 1].forEach(function (side, i) {
    const leg = i + 1, arm = i + 3;
    part(side * 0.23, -0.42, 0, 0.35, 0.92, 0.39, 0x494762, leg);
    part(side * 0.23, -0.88, 0.055, 0.37, 0.18, 0.5, 0x323b3c, leg);
    part(side * 0.23, -0.55, 0.205, 0.13, 0.2, 0.025, 0x64617c, leg);
    part(side * 0.59, -0.2, 0, 0.31, 0.42, 0.39, 0x386e78, arm);
    part(side * 0.59, -0.65, 0, 0.28, 0.53, 0.34, 0x6d9a65, arm);
    part(side * 0.59, -0.91, 0.01, 0.32, 0.16, 0.38, 0x52794f, arm);
  });

  const models = { zombie: parts, skeleton: [], spider: [], brute: [] };
  function modelPart(type, x, y, z, sx, sy, sz, tint, limb) {
    models[type].push({ x: x, y: y, z: z, sx: sx, sy: sy, sz: sz, tint: tint, limb: limb || 0 });
  }
  // Bone ribs and a hollow skull; thin limbs read clearly against the grass.
  modelPart('skeleton', 0, 1.56, 0, 0.18, 1, 0.22, 0xb7b69c);
  [1.3, 1.53, 1.76, 1.94].forEach(function (y) { modelPart('skeleton', 0, y, 0, 0.72, 0.1, 0.38, 0xd7d4b7); });
  modelPart('skeleton', 0, 1.05, 0, 0.65, 0.16, 0.38, 0xc9c6a8);
  modelPart('skeleton', 0, 0.4, 0, 0.76, 0.68, 0.64, 0xe0dcc3, 5);
  [-1, 1].forEach(function (side, i) {
    modelPart('skeleton', side * 0.19, 0.43, 0.33, 0.2, 0.18, 0.04, 0x303e38, 5);
    modelPart('skeleton', side * 0.19, 0.43, 0.36, 0.07, 0.08, 0.03, 0xefa454, 5);
    modelPart('skeleton', side * 0.21, -0.46, 0, 0.19, 0.95, 0.2, 0xc5c4ab, i + 1);
    modelPart('skeleton', side * 0.21, -0.9, 0.06, 0.25, 0.16, 0.39, 0x959b8a, i + 1);
    modelPart('skeleton', side * 0.52, -0.44, 0, 0.17, 0.95, 0.18, 0xd1cdb3, i + 3);
  });
  modelPart('skeleton', 0, 0.16, 0.33, 0.35, 0.13, 0.08, 0x606c5a, 6);
  // A low, eight-legged crawler with amber eyes, distinct from the walkers.
  modelPart('spider', 0, 0.63, -0.28, 0.78, 0.63, 0.95, 0x493855);
  modelPart('spider', 0, 0.5, 0.43, 0.68, 0.44, 0.48, 0x65516b);
  [-1, 1].forEach(function (side) {
    modelPart('spider', side * 0.18, 0.59, 0.69, 0.14, 0.13, 0.08, 0xffb45c);
    for (let i = 0; i < 4; i++) {
      modelPart('spider', side * 0.57, 0.48, -0.65 + i * 0.36, 0.62, 0.12, 0.14, 0x705574, 7 + i);
      modelPart('spider', side * 0.85, 0.22, -0.65 + i * 0.36, 0.12, 0.48, 0.14, 0x493855, 7 + i);
    }
  });
  // A squat stone shell and heavy fists signal high durability and wall damage.
  parts.forEach(function (p, i) {
    models.brute.push(Object.assign({}, p, { sx: p.sx * (p.limb === 0 ? 1.25 : 1.05),
      tint: i === 10 || i === 11 ? 0xf4bd5e : i === 8 || i === 9 ? 0x253a2e : p.limb === 0 ? 0x69766b : p.limb >= 5 ? 0x89917d : 0x58685d }));
  });
  modelPart('brute', -0.48, 2.02, 0, 0.5, 0.42, 0.7, 0x8d9885);
  modelPart('brute', 0.48, 2.02, 0, 0.5, 0.42, 0.7, 0x8d9885);
  const maxParts = Math.max.apply(null, Object.keys(models).map(function (key) { return models[key].length; }));

  function render(time) {
    if (!mesh) return;
    let index = 0;
    zombies.concat(fallen).forEach(function (zombie) {
      const p = zombie.position;
      const dying = zombie.death !== undefined;
      const death = dying ? clamp(zombie.death / 0.65, 0, 1) : 0;
      const motion = reducedMotion ? 0.25 : 1;
      const recoil = Math.sin(clamp(zombie.flash / 0.2, 0, 1) * Math.PI) * 0.22 * motion;
      const bob = Math.abs(Math.sin(zombie.phase)) * 0.045 * zombie.stride * motion;
      const collapse = zombie.exploded ? 0 : death;
      rotation.set(-recoil - collapse * 1.45, zombie.yaw, Math.sin(zombie.phase) * 0.04 * zombie.stride * motion + collapse * 0.22);
      quaternion.setFromEuler(rotation);
      position.set(p.x, p.y + bob - collapse * 0.35, p.z);
      const shrink = dying ? 1 - Math.pow(clamp((death - 0.65) / 0.35, 0, 1), 2) : 1;
      scale.setScalar(Math.max(0.001, shrink));
      rootMatrix.compose(position, quaternion, scale);
      const gait = Math.sin(zombie.phase) * 0.55 * zombie.stride;
      const bite = Math.sin(time * 8 + zombie.id) * zombie.eatBlend * motion;
      models[zombie.type].forEach(function (p, partIndex) {
        const leg = p.limb === 1 || p.limb === 2;
        const arm = p.limb === 3 || p.limb === 4;
        const head = p.limb === 5 || p.limb === 6;
        const spiderLeg = p.limb >= 7;
        const angle = leg ? (p.limb === 1 ? gait : -gait) * motion + (zombie.grounded ? 0 : 0.3) :
          arm ? -1.12 + gait * 0.13 * motion + bite * 0.16 + Math.sin(time * 1.7 + zombie.id + p.limb) * 0.035 * motion :
          head ? 0.05 + Math.sin(time * 1.3 + zombie.id) * 0.035 * motion + bite * 0.09 + (p.limb === 6 ? (0.12 + bite * 0.15) * zombie.eatBlend : 0) : 0;
        const limb = p.limb > 0 && !spiderLeg;
        const pivot = leg ? 1 : arm ? 1.96 : 2.04;
        const y = limb ? p.y * Math.cos(angle) - p.z * Math.sin(angle) + pivot : p.y;
        const z = limb ? p.y * Math.sin(angle) + p.z * Math.cos(angle) : p.z;
        position.set(p.x, y + (spiderLeg ? Math.sin(zombie.phase + p.limb * 1.7 + Math.sign(p.x)) * 0.09 * zombie.stride * motion : 0), z); scale.set(p.sx, p.sy, p.sz);
        if (zombie.exploded) {
          const burst = death * (2 - death);
          const angle = partIndex * 2.39996 + zombie.id;
          position.x += Math.sin(angle) * burst * (1.5 + partIndex % 3 * 0.4);
          position.z += Math.cos(angle) * burst * (1.5 + partIndex % 3 * 0.4);
          position.y += burst * (1 + partIndex % 4 * 0.35) - death * death * 1.8;
          scale.multiplyScalar(1 - death * 0.75);
        }
        rotation.set(angle, head ? Math.sin(time * 0.8 + zombie.id) * 0.045 * motion : 0, 0); quaternion.setFromEuler(rotation);
        matrix.compose(position, quaternion, scale).premultiply(rootMatrix);
        mesh.setMatrixAt(index, matrix);
        color.setHex(p.tint).multiplyScalar(zombie.tint);
        if (zombie.exploded) color.lerp(blastColor, (1 - death) * 0.85);
        if (zombie.flash > 0 && !reducedMotion) color.lerp(hitColor, 0.65);
        mesh.setColorAt(index++, color);
      });
    });
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  const hitColor = new THREE.Color(0xffd2a1), blastColor = new THREE.Color(0xffc56e);

  function updateHud() {
    const state = getState();
    const key = [state.health, state.coins, state.count, state.wave, state.nextWave, state.pending, state.phase, state.defeated].join('/');
    if (key === hudKey) return;
    hudKey = key;
    if (M.ui && M.ui.setDefense) M.ui.setDefense(state);
  }
  function getState() {
    return { health: tree ? tree.health : 100, maxHealth: 100, coins: coins, count: zombies.length,
      wave: wave, pending: pending, phase: nextWave === Infinity ? 'combat' : wave ? 'intermission' : 'prepare',
      nextWave: Number.isFinite(nextWave) ? Math.ceil(Math.max(0, nextWave - elapsed)) : 0, defeated: !!tree && tree.health <= 0 };
  }
  function spawnAt(node, type) {
    if (!mesh || zombies.length >= MAX_ENEMIES || tree.health <= 0 || !node) return null;
    type = TYPES[type] ? type : 'zombie';
    const def = TYPES[type], start = navigation.nodeAt(node.x, node.y, node.z);
    const zombie = { type: type, body: { radius: def.radius, height: def.height, skin: 0.002 }, id: nextId++, position: new THREE.Vector3(node.x, node.y, node.z), yaw: 0, hp: def.hp, maxHp: def.hp,
      tint: 0.88 + Math.random() * 0.24, phase: Math.random() * 6.28, mode: 'walk', moving: false,
      bite: 0, blockBite: 0, blockKey: '', path: null, target: null, revision: navigation.revision, flash: 0,
      jump: null, vy: 0, grounded: true, retry: 0, stuck: 0, stride: 0, eatBlend: 0,
      voiceTimer: 1 + (nextId * 1.71) % 5, chewTimer: 0,
      progressAt: elapsed, progressRevision: navigation.revision, progressPath: null,
      bestTreeDistance: Math.hypot(node.x - tree.position.x, node.z - tree.position.z),
      bestRouteDistance: start && Number.isFinite(start.distance) ? start.distance * SIZE + Math.hypot(node.x - start.x, node.z - start.z) : Infinity };
    zombies.push(zombie);
    return zombie;
  }
  function spawn() {
    const candidates = navigation.nodes.filter(function (node) {
      const d = Math.hypot(node.x - tree.position.x, node.z - tree.position.z);
      return d >= 54 && d <= 72 && world.waterDepthAt(node.x, node.z) < 0.9 &&
        !zombies.some(function (z) { return z.position.distanceToSquared(node) < 2.25; });
    });
    // Canopies can be isolated high above the ground. Prefer proven routes so
    // a last enemy on a treetop cannot lock a clear-to-advance wave forever.
    const reachable = candidates.filter(function (node) { return Number.isFinite(node.distance); });
    if (reachable.length) return !!spawnAt(reachable[Math.floor(Math.random() * reachable.length)], typeForWave(wave, waveSpawned));
    // A sealed defense must still receive enemies that can chew a real breach.
    for (let attempt = 0; candidates.length && attempt < 6; attempt++) {
      const index = Math.floor(Math.random() * candidates.length), node = candidates.splice(index, 1)[0];
      const path = navigation.breach(node);
      if (!path.length) continue;
      const enemy = spawnAt(node, typeForWave(wave, waveSpawned));
      if (enemy) { enemy.path = path; return true; }
    }
    return false;
  }
  function lineClear(a, b) {
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(distance / 0.3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const y = a.y + (b.y - a.y) * t + 1.4;
      if (world.navigationBlockedAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, y, y + 0.15)) return false;
    }
    return true;
  }
  function canHit(enemy, origin, yaw, stomp, range) {
    const p = enemy.position, dx = p.x - origin.x, dz = p.z - origin.z, distance = Math.hypot(dx, dz);
    if (distance > range || Math.abs(p.y - origin.y) > 2.8) return false;
    if (!stomp && distance > .1 && (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / distance < .25) return false;
    return lineClear(origin, p);
  }
  const outlineMatrix = new THREE.Matrix4(), outlineScale = new THREE.Vector3(1.065, 1.065, 1.065);
  function highlight(predicate) {
    if (!outlineMesh) return;
    let source = 0, count = 0;
    zombies.forEach(function (enemy) {
      const length = models[enemy.type].length;
      if (predicate(enemy)) for (let i = 0; i < length; i++) {
        mesh.getMatrixAt(source + i, outlineMatrix); outlineMatrix.scale(outlineScale);
        outlineMesh.setMatrixAt(count++, outlineMatrix);
      }
      source += length;
    });
    outlineMesh.count = count; outlineMesh.instanceMatrix.needsUpdate = true;
  }
  function attack(origin, yaw, stomp, profile) {
    if (!tree || tree.health <= 0) return false;
    profile = profile || {};
    const range = profile.range === undefined ? (stomp ? 3.1 : 2.8) : profile.range;
    const damage = profile.damage === undefined ? (stomp ? 2 : 1) : profile.damage;
    const limit = profile.maxTargets === undefined ? Infinity : profile.maxTargets;
    let hit = false, hits = 0;
    const targets = zombies.slice().sort(function (a, b) { return a.position.distanceToSquared(origin) - b.position.distanceToSquared(origin); });
    for (let j = 0; j < targets.length && hits < limit; j++) {
      const zombie = targets[j], p = zombie.position;
      const i = zombies.indexOf(zombie);
      if (!canHit(zombie, origin, yaw, stomp, range)) continue;
      hit = true; hits++; zombie.hp -= damage; zombie.flash = 0.2;
      zombie.bite = 0; zombie.blockBite = 0;
      if (M.audio && M.audio.zombie) M.audio.zombie(zombie.hp <= 0 ? 'death' : 'hurt', p);
      if (zombie.hp <= 0) {
        removeEnemy(zombie, i, false);
      }
    }
    if (hit) { updateHud(); render(elapsed); }
    return hit;
  }
  function removeEnemy(enemy, index, exploded) {
    enemy.hp = 0; enemy.exploded = exploded;
    if (!reducedMotion) {
      enemy.death = 0; fallen.push(enemy);
      if (fallen.length > 12) fallen.shift();
    }
    zombies.splice(index, 1);
    if (M.items && M.items.dropCoins) M.items.dropCoins(enemy.position, TYPES[enemy.type].reward);
    if (exploded && M.audio && M.audio.enemyBurst) M.audio.enemyBurst(enemy.position);
  }
  function watchdog(enemy) {
    const p = enemy.position;
    const direct = Math.hypot(p.x - tree.position.x, p.z - tree.position.z);
    const node = navigation.nodeAt(p.x, p.y, p.z);
    let route = node && Number.isFinite(node.distance) ? node.distance * SIZE + Math.hypot(p.x - node.x, p.z - node.z) : Infinity;
    const path = enemy.path && enemy.path.length ? enemy.path : null;
    if (path) {
      const first = path[0];
      route = Math.min(route, path.length * SIZE + Math.hypot(p.x - first.x, p.z - first.z));
    }
    if (enemy.progressRevision !== navigation.revision || enemy.progressPath !== path) {
      // New construction can force a longer route. Rebase its distance, but
      // leave the deadline alone until the enemy actually advances.
      enemy.bestRouteDistance = route;
      enemy.progressRevision = navigation.revision;
      enemy.progressPath = path;
    }
    // Measure real advance, not animation, tiny jitter, taking damage or replans.
    // Route distance also recognizes a valid detour away from the tree.
    if (direct < enemy.bestTreeDistance - 0.5 || route < enemy.bestRouteDistance - 0.5) {
      enemy.progressAt = elapsed;
      enemy.bestTreeDistance = Math.min(enemy.bestTreeDistance, direct);
      enemy.bestRouteDistance = Math.min(enemy.bestRouteDistance, route);
    }
    return elapsed - enemy.progressAt + 0.000001 >= WATCHDOG_SECONDS;
  }
  function chooseTarget(zombie) {
    const p = zombie.position;
    const node = navigation.nodeAt(p.x, p.y, p.z);
    if (!node) return null;
    if (Number.isFinite(node.distance)) {
      zombie.path = null;
      if (Math.hypot(p.x - node.x, p.z - node.z) > 0.08) return node;
      return node.next;
    }
    if (!zombie.path && plannerTimer <= 0 && zombie.retry <= 0) {
      zombie.path = navigation.breach(node);
      zombie.retry = 2; plannerTimer = 0.12;
    }
    if (zombie.path && !zombie.path.length) zombie.path = null;
    return zombie.path && zombie.path[0];
  }
  function chew(zombie, target, dt) {
    const blocks = target.blocks || [];
    const block = blocks.find(function (b) { return world.blockInfoAt(b.bx, b.by, b.bz); });
    if (!block) return false;
    const p = zombie.position;
    // Only chew from the neighboring cell. Walking up to its edge keeps the
    // bite in reach while leaving the body outside the obstructing block.
    const d = Math.hypot(target.x - p.x, target.z - p.z);
    if (d > 2.15) return false;
    const key = block.bx + ',' + block.by + ',' + block.bz;
    if (zombie.blockKey !== key) { zombie.blockKey = key; zombie.blockBite = 0; }
    zombie.mode = 'block'; zombie.moving = false;
    zombie.yaw = turnToward(zombie.yaw, Math.atan2(target.x - p.x, target.z - p.z), dt * 5);
    zombie.blockBite += dt;
    if (zombie.blockBite + 0.000001 >= TYPES[zombie.type].chew) {
      if (world.breakBlockAt(block.bx, block.by, block.bz, { persistentDrop: true })) zombie.progressAt = elapsed;
      zombie.blockBite = 0; zombie.path = null; zombie.target = null;
    }
    return true;
  }
  function walk(zombie, target, dt) {
    const p = zombie.position, dx = target.x - p.x, dz = target.z - p.z;
    const d = Math.hypot(dx, dz);
    zombie.yaw = turnToward(zombie.yaw, Math.atan2(dx, dz), dt * 5);
    if (d < 0.055) {
      p.x = target.x; p.z = target.z;
      if (zombie.grounded) { zombie.target = null; if (zombie.path && zombie.path[0] === target) zombie.path.shift(); }
      zombie.moving = false; return;
    }
    if (target.y - p.y > SIZE + 0.05 && zombie.grounded) { zombie.target = null; zombie.path = null; return; }
    if (target.y > p.y + 0.1 && zombie.grounded && !zombie.jump) {
      // A real ballistic jump clears exactly one block; a two-block wall is
      // rejected by navigation before the jump is attempted.
      zombie.vy = 10.6; zombie.grounded = false; zombie.jump = target;
    }
    const step = Math.min(d, TYPES[zombie.type].speed * (zombie.towerSlowTime > 0 ? zombie.towerSlow : 1) * dt);
    const x = p.x + dx / d * step, z = p.z + dz / d * step;
    zombie.moving = physics.moveHorizontal(world, p, zombie.body, x - p.x, z - p.z);
    if (zombie.moving) zombie.phase += dt * (zombie.type === 'spider' ? 10 : 5);
    zombie.stuck = zombie.moving ? 0 : zombie.stuck + dt;
    if (zombie.stuck > 2 && zombie.grounded) {
      zombie.target = null; zombie.path = null; zombie.retry = 0; zombie.stuck = 0;
    }
  }
  function updatePhysics(zombie, dt) {
    const p = zombie.position;
    if (physics.recover(world, p, zombie.body)) { zombie.vy = 0; zombie.target = null; zombie.path = null; }
    const previousY = p.y;
    zombie.vy = Math.max(-38, zombie.vy - 20 * dt);
    const nextY = p.y + zombie.vy * dt;
    const floor = physics.support(world, p, Math.max(previousY, nextY) + 0.002, zombie.body);
    const landing = zombie.vy <= 0 && nextY <= floor;
    const clear = physics.moveVertical(world, p, zombie.body, landing ? floor : nextY);
    if (!clear) zombie.vy = 0;
    if ((landing && clear) || (!clear && nextY < previousY)) {
      zombie.vy = 0; zombie.grounded = true; zombie.jump = null;
    } else zombie.grounded = false;
  }
  function update(dt) {
    if (!mesh) return;
    elapsed += dt;
    for (let i = fallen.length - 1; i >= 0; i--) {
      fallen[i].death += dt;
      if (fallen[i].death >= 0.65) fallen.splice(i, 1);
    }
    plannerTimer -= dt; rebuildTimer -= dt;
    if (tree.health <= 0) { updateHud(); render(elapsed); return; }
    if (world.revision !== navigation.revision && rebuildTimer <= 0) {
      navigation.rebuild(); rebuildTimer = 0.75;
      zombies.forEach(function (zombie) {
        const p = zombie.position, node = navigation.nodeAt(p.x, p.y, p.z);
        // Preserve an ongoing bite across unrelated construction edits.
        // Switch back to walking as soon as an open route becomes available.
        if ((zombie.path && node && Number.isFinite(node.distance)) ||
            (zombie.grounded && zombie.target && !(zombie.target.blocks && zombie.target.blocks.length) && !navigation.canWalk(p, zombie.target))) {
          zombie.path = null; zombie.target = null; zombie.retry = 0;
        }
      });
    }
    if (elapsed >= nextWave) {
      wave++; pending = waveSize(wave); waveSpawned = 0; nextWave = Infinity;
      spawnTimer = 0;
      if (M.audio && M.audio.cue) M.audio.cue('wave');
      if (M.ui) M.ui.showBubble('Wave ' + wave + (wave === 3 ? ' — spiders incoming!' : wave === 5 ? ' — skeletons incoming!' : wave === 8 ? ' — stone brutes incoming!' : ' — protect the Hearth!'));
    }
    spawnTimer -= dt;
    if (pending > 0 && spawnTimer <= 0 && zombies.length < MAX_ENEMIES) {
      if (spawn()) { pending--; waveSpawned++; }
      spawnTimer = Math.max(0.7, 3.2 - wave * 0.22);
    }
    zombies.forEach(function (zombie) {
      zombie.flash = Math.max(0, zombie.flash - dt); zombie.retry -= dt;
      updatePhysics(zombie, dt);
      if (zombie.grounded && navigation.contact(zombie.position.x, zombie.position.y, zombie.position.z)) {
        zombie.mode = 'tree'; zombie.moving = false; zombie.blockBite = 0;
        zombie.yaw = turnToward(zombie.yaw, Math.atan2(tree.position.x - zombie.position.x, tree.position.z - zombie.position.z), dt * 5);
        zombie.bite += dt;
        while (zombie.bite + 0.000001 >= TYPES[zombie.type].bite && tree.health > 0) {
          tree.damage(TYPES[zombie.type].damage); zombie.progressAt = elapsed; zombie.bite = Math.max(0, zombie.bite - TYPES[zombie.type].bite);
        }
        return;
      }
      zombie.bite = 0; zombie.mode = 'walk'; zombie.moving = false;
      if (!zombie.target) zombie.target = chooseTarget(zombie);
      const target = zombie.target;
      if (!target) { zombie.blockBite = 0; return; }
      if (chew(zombie, target, dt)) return;
      zombie.blockBite = 0; zombie.blockKey = '';
      // Live collision checks stop walkers immediately after a player edit,
      // even while the shared field waits for its next bounded rebuild.
      walk(zombie, target, dt);
    });
    for (let i = zombies.length - 1; i >= 0; i--) {
      if (watchdog(zombies[i])) removeEnemy(zombies[i], i, true);
    }
    zombies.forEach(function (zombie) {
      zombie.stride = damp(zombie.stride, zombie.moving ? 1 : 0, 8, dt);
      const eating = zombie.mode === 'tree' || zombie.mode === 'block';
      zombie.eatBlend = damp(zombie.eatBlend, eating ? 1 : 0, 10, dt);
      const footBeat = Math.floor(zombie.phase / Math.PI);
      if (zombie.moving && zombie.grounded && zombie.footBeat !== undefined && zombie.footBeat !== footBeat && M.audio && M.audio.actorStep) M.audio.actorStep('zombie', zombie.position);
      zombie.footBeat = footBeat;
      zombie.voiceTimer -= dt; zombie.chewTimer -= dt;
      if (zombie.voiceTimer <= 0) {
        if (M.audio && M.audio.zombie) M.audio.zombie(zombie.type === 'spider' || zombie.type === 'skeleton' ? 'bite' : 'groan', zombie.position);
        zombie.voiceTimer = 7.5 + Math.sin(elapsed + zombie.id) * 3.5;
      }
      if (eating && zombie.chewTimer <= 0) {
        if (M.audio && M.audio.zombie) M.audio.zombie('bite', zombie.position);
        zombie.chewTimer = 1.05 + Math.sin(zombie.id) * 0.25;
      }
    });
    if (wave > 0 && pending === 0 && zombies.length === 0 && nextWave === Infinity) {
      const bonus = Math.min(24, 4 + wave * 2);
      coins += bonus; nextWave = elapsed + 12;
      if (M.ui) M.ui.showBubble('Wave cleared! +' + bonus + ' coins · Q to upgrade');
    }
    updateHud(); render(elapsed);
  }
  function init(options) {
    if (mesh) return;
    scene = options.scene; world = options.world; tree = options.tree;
    // The shared field must clear the widest species as well as the walkers.
    navigation = M.zombieNavigation.create(world, tree, { bodyRadius: 0.44 });
    navigation.rebuild();
    mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.std(0xffffff, 0.94), (MAX_ENEMIES + 12) * maxParts);
    mesh.name = 'Enemy horde'; mesh.count = 0; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.castShadow = true; mesh.receiveShadow = true;
    // Allocate instance colors before the first empty draw compiles its shader.
    mesh.setColorAt(0, new THREE.Color(0xffffff));
    scene.add(mesh);
    outlineMesh = new THREE.InstancedMesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0xf5b17c, side: THREE.BackSide,
      transparent: true, opacity: .65, depthWrite: false }), MAX_ENEMIES * maxParts);
    outlineMesh.name = 'Enemies in attack range'; outlineMesh.count = 0; outlineMesh.frustumCulled = false;
    outlineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(outlineMesh);
    updateHud();
  }
  function damageEnemy(enemy, amount) {
    const index = zombies.indexOf(enemy);
    if (index < 0 || !Number.isFinite(amount) || amount <= 0 || tree.health <= 0) return false;
    enemy.hp -= amount; enemy.flash = .15;
    const killed = enemy.hp <= 0;
    if (killed) removeEnemy(enemy, index, false);
    updateHud();
    return killed;
  }
  M.enemies = { init: init, update: update, attack: attack, damageEnemy: damageEnemy, canHit: canHit, highlight: highlight, getState: getState, maxEnemies: MAX_ENEMIES,
    watchdogSeconds: WATCHDOG_SECONDS, types: TYPES, waveSize: waveSize, typeForWave: typeForWave,
    addCoins: function (amount) { if (!Number.isInteger(amount) || amount <= 0) return false; coins += amount; updateHud(); return true; },
    spendCoins: function (amount) {
      if (!Number.isInteger(amount) || amount < 0 || amount > coins) return false;
      coins -= amount; updateHud(); return true;
    },
    body: BODY, get zombies() { return zombies; }, get navigation() { return navigation; }, spawnAt: spawnAt };
})(window.Meadow = window.Meadow || {});
