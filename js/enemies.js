(function (M) {
  'use strict';

  const MAX_ENEMIES = 50, TREE_BITE_SECONDS = 3, BLOCK_BITE_SECONDS = 10;
  const SPEED = 1.65, SIZE = 2;
  const physics = M.actorPhysics, BODY = { radius: 0.34, height: 2.8, skin: 0.002 };
  const { clamp, turnToward } = M.utils;
  const zombies = [];
  let scene, world, tree, navigation, mesh;
  let elapsed = 0, wave = 0, nextWave = 10, pending = 0, spawnTimer = 0, coins = 0;
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

  function render(time) {
    if (!mesh) return;
    let index = 0;
    zombies.forEach(function (zombie) {
      const p = zombie.position;
      rotation.set(0, zombie.yaw, 0); quaternion.setFromEuler(rotation);
      position.set(p.x, p.y, p.z); scale.set(1, 1, 1);
      rootMatrix.compose(position, quaternion, scale);
      const gait = zombie.moving ? Math.sin(zombie.phase) * 0.55 : 0;
      const eating = zombie.mode === 'tree' || zombie.mode === 'block';
      parts.forEach(function (p) {
        const angle = p.limb <= 2 ? (p.limb === 1 ? gait : -gait) :
          -1.12 + (eating && !reducedMotion ? Math.sin(time * 6 + zombie.id) * 0.16 : gait * 0.13);
        const limb = p.limb > 0;
        const y = limb ? p.y * Math.cos(angle) - p.z * Math.sin(angle) + (p.limb <= 2 ? 1 : 1.96) : p.y;
        const z = limb ? p.y * Math.sin(angle) + p.z * Math.cos(angle) : p.z;
        position.set(p.x, y, z); scale.set(p.sx, p.sy, p.sz);
        rotation.set(limb ? angle : 0, 0, 0); quaternion.setFromEuler(rotation);
        matrix.compose(position, quaternion, scale).premultiply(rootMatrix);
        mesh.setMatrixAt(index, matrix);
        color.setHex(p.tint).multiplyScalar(zombie.tint);
        if (zombie.flash > 0 && !reducedMotion) color.lerp(hitColor, 0.65);
        mesh.setColorAt(index++, color);
      });
    });
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  const hitColor = new THREE.Color(0xffd2a1);

  function updateHud() {
    const state = getState();
    const key = [state.health, state.coins, state.count, state.wave, Math.ceil(Math.max(0, nextWave - elapsed)), state.defeated].join('/');
    if (key === hudKey) return;
    hudKey = key;
    if (M.ui && M.ui.setDefense) M.ui.setDefense(state);
  }
  function getState() {
    return { health: tree ? tree.health : 100, maxHealth: 100, coins: coins, count: zombies.length,
      wave: wave, nextWave: Math.ceil(Math.max(0, nextWave - elapsed)), defeated: !!tree && tree.health <= 0 };
  }
  function spawnAt(node) {
    if (!mesh || zombies.length >= MAX_ENEMIES || tree.health <= 0 || !node) return null;
    const zombie = { id: nextId++, position: new THREE.Vector3(node.x, node.y, node.z), yaw: 0, hp: 2,
      tint: 0.88 + Math.random() * 0.24, phase: Math.random() * 6.28, mode: 'walk', moving: false,
      bite: 0, blockBite: 0, blockKey: '', path: null, target: null, revision: navigation.revision, flash: 0,
      jump: null, vy: 0, grounded: true, retry: 0, stuck: 0 };
    zombies.push(zombie);
    return zombie;
  }
  function spawn() {
    const candidates = navigation.nodes.filter(function (node) {
      const d = Math.hypot(node.x - tree.position.x, node.z - tree.position.z);
      return d >= 36 && d <= 48 && world.waterDepthAt(node.x, node.z) < 0.9 &&
        !zombies.some(function (z) { return z.position.distanceToSquared(node) < 2.25; });
    });
    if (!candidates.length) return false;
    return !!spawnAt(candidates[Math.floor(Math.random() * candidates.length)]);
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
  function attack(origin, yaw, stomp) {
    if (!tree || tree.health <= 0) return false;
    let hit = false;
    for (let i = zombies.length - 1; i >= 0; i--) {
      const zombie = zombies[i], p = zombie.position;
      const dx = p.x - origin.x, dz = p.z - origin.z, d = Math.hypot(dx, dz);
      if (d > (stomp ? 3.1 : 2.8) || Math.abs(p.y - origin.y) > 2.8) continue;
      if (!stomp && d > 0.1 && (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d < 0.25) continue;
      if (!lineClear(origin, p)) continue;
      hit = true; zombie.hp -= stomp ? 2 : 1; zombie.flash = 0.2;
      zombie.bite = 0; zombie.blockBite = 0;
      if (zombie.hp <= 0) {
        zombies.splice(i, 1); coins++;
        if (M.audio && M.audio.pickup) M.audio.pickup();
      }
    }
    if (hit) { updateHud(); render(elapsed); }
    return hit;
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
    if (zombie.blockBite + 0.000001 >= BLOCK_BITE_SECONDS) {
      world.breakBlockAt(block.bx, block.by, block.bz, { persistentDrop: true });
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
    const step = Math.min(d, SPEED * dt);
    const x = p.x + dx / d * step, z = p.z + dz / d * step;
    zombie.moving = physics.moveHorizontal(world, p, BODY, x - p.x, z - p.z);
    if (zombie.moving) zombie.phase += dt * 5;
    zombie.stuck = zombie.moving ? 0 : zombie.stuck + dt;
    if (zombie.stuck > 2 && zombie.grounded) {
      zombie.target = null; zombie.path = null; zombie.retry = 0; zombie.stuck = 0;
    }
  }
  function updatePhysics(zombie, dt) {
    const p = zombie.position;
    if (physics.recover(world, p, BODY)) { zombie.vy = 0; zombie.target = null; zombie.path = null; }
    const previousY = p.y;
    zombie.vy = Math.max(-38, zombie.vy - 20 * dt);
    const nextY = p.y + zombie.vy * dt;
    const floor = physics.support(world, p, Math.max(previousY, nextY) + 0.002, BODY);
    const landing = zombie.vy <= 0 && nextY <= floor;
    const clear = physics.moveVertical(world, p, BODY, landing ? floor : nextY);
    if (!clear) zombie.vy = 0;
    if ((landing && clear) || (!clear && nextY < previousY)) {
      zombie.vy = 0; zombie.grounded = true; zombie.jump = null;
    } else zombie.grounded = false;
  }
  function update(dt) {
    if (!mesh) return;
    elapsed += dt;
    plannerTimer -= dt; rebuildTimer -= dt;
    if (tree.health <= 0) { updateHud(); return; }
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
      wave++; pending = Math.min(100, pending + 1 + wave * 3); nextWave += 35;
      if (M.ui) M.ui.showBubble('Wave ' + wave + ' — protect the Hearth!');
    }
    spawnTimer -= dt;
    if (pending > 0 && spawnTimer <= 0 && zombies.length < MAX_ENEMIES) {
      if (spawn()) pending--;
      spawnTimer = Math.max(0.7, 3.2 - wave * 0.22);
    }
    zombies.forEach(function (zombie) {
      zombie.flash = Math.max(0, zombie.flash - dt); zombie.retry -= dt;
      updatePhysics(zombie, dt);
      if (zombie.grounded && navigation.contact(zombie.position.x, zombie.position.y, zombie.position.z)) {
        zombie.mode = 'tree'; zombie.moving = false; zombie.blockBite = 0;
        zombie.yaw = turnToward(zombie.yaw, Math.atan2(tree.position.x - zombie.position.x, tree.position.z - zombie.position.z), dt * 5);
        zombie.bite += dt;
        while (zombie.bite + 0.000001 >= TREE_BITE_SECONDS && tree.health > 0) {
          tree.damage(1); zombie.bite = Math.max(0, zombie.bite - TREE_BITE_SECONDS);
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
    updateHud(); render(elapsed);
  }
  function init(options) {
    if (mesh) return;
    scene = options.scene; world = options.world; tree = options.tree;
    navigation = M.zombieNavigation.create(world, tree);
    navigation.rebuild();
    mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.std(0xffffff, 0.94), MAX_ENEMIES * parts.length);
    mesh.name = 'Zombie horde'; mesh.count = 0; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh); updateHud();
  }
  M.enemies = { init: init, update: update, attack: attack, getState: getState, maxEnemies: MAX_ENEMIES,
    body: BODY, get zombies() { return zombies; }, get navigation() { return navigation; }, spawnAt: spawnAt };
})(window.Meadow = window.Meadow || {});
