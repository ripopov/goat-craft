(function (M) {
  'use strict';

  const WATCHDOG_SECONDS = 30, WATCHDOG_BLAST_RADIUS = 4, SIZE = 2;
  const rules = M.enemyRules;
  const { types: TYPES, maxEnemies: MAX_ENEMIES, waveSize, wavePlan, waveDifficulty, typeForWave, deliveryForWave } = rules;
  const { radius: EMERGENCE_RADIUS, inner: EMERGENCE_BAND_INNER, favor: EMERGENCE_BAND_FAVOR, retries: EMERGENCE_RETRIES } = rules.wormEmergence;
  const physics = M.actorPhysics, BODY = { radius: 0.34, height: 2.8, skin: 0.002 };
  const { clamp, turnToward, damp } = M.utils;
  const zombies = [], fallen = [];
  let scene, world, tree, navigation, mesh, outlineMesh;
  let elapsed = 0, wave = 0, nextWave = rules.firstWaveDelay, pending = 0, spawnTimer = 0, coins = 0, waveSpawned = 0;
  let plan = wavePlan(1), spawnLanes = [];
  let rebuildTimer = 0, plannerTimer = 0, nextId = 0, hudKey = '';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const matrix = new THREE.Matrix4(), rootMatrix = new THREE.Matrix4();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion(), rotation = new THREE.Euler();
  const color = new THREE.Color(), hitColor = new THREE.Color(0xffd2a1), blastColor = new THREE.Color(0xffc56e);

  const { models, maxParts, maxJoints } = M.enemyModels.create(TYPES);
  const jointMatrices = [rootMatrix];
  for (let i = 1; i <= maxJoints; i++) jointMatrices.push(new THREE.Matrix4());
  let renderDeferred = false;

  function poseJoints(enemy, model, time, motion, recoil) {
    const gait = Math.sin(enemy.phase) * enemy.stride * motion;
    const chew = (0.5 + 0.5 * Math.sin(time * 9 + enemy.id)) * enemy.eatBlend * motion;
    const bruteWalk = enemy.type === 'brute' ? 0.65 : 1;
    model.joints.forEach(function (j) {
      j.rx = j.ry = j.rz = 0;
      if (j.kind === 'leg') {
        j.rx = j.side * gait * (enemy.type === 'skeleton' ? 0.72 : 0.55) * bruteWalk + (enemy.grounded ? 0 : 0.28);
        if (enemy.type === 'brute') j.rz = j.side * Math.abs(gait) * 0.08;
      } else if (j.kind === 'knee') {
        j.rx = Math.max(0, -j.side * gait) * 0.75 + (enemy.grounded ? 0 : 0.35);
      } else if (j.kind === 'arm') {
        const eating = enemy.eatBlend * (enemy.type === 'zombie' ? 1.1 : 0.85);
        j.rx = (enemy.type === 'zombie' ? -1.12 : enemy.type === 'brute' ? -0.2 : -0.08) - eating -
          j.side * gait * (enemy.type === 'skeleton' ? 0.55 : 0.12) + recoil * 1.8;
        if (enemy.mode === 'chant') j.rx = -1.5 - enemy.charge * .1;
        j.rz = j.side * (enemy.type === 'brute' ? 0.12 : 0.04) + Math.sin(time * 1.7 + enemy.id + j.side) * 0.025 * motion;
      } else if (j.kind === 'elbow') {
        j.rx = -0.12 - chew * 0.5 - enemy.eatBlend * 0.25 + Math.max(0, j.side * gait) * 0.2;
      } else if (j.kind === 'head') {
        j.rx = 0.04 + Math.sin(time * 1.3 + enemy.id) * 0.025 * motion - chew * 0.12 - recoil * 1.2;
        j.ry = Math.sin(time * 0.8 + enemy.id) * 0.05 * motion;
        j.rz = enemy.type === 'zombie' ? -0.06 : Math.sin(enemy.phase) * 0.025 * enemy.stride * motion;
      } else if (j.kind === 'jaw') {
        j.rx = 0.03 + chew * (enemy.type === 'brute' ? 0.18 : 0.38);
      } else if (j.kind === 'spiderLeg') {
        const phase = enemy.phase + j.index * Math.PI * 0.5 + (j.side < 0 ? Math.PI : 0);
        const lift = Math.max(0, Math.sin(phase)) * enemy.stride * motion;
        j.ry = j.side * (-0.42 + j.index * 0.27) + Math.cos(phase) * 0.18 * enemy.stride * motion;
        j.rz = j.side * (0.34 + lift * 0.2);
      } else if (j.kind === 'spiderKnee') {
        const lift = Math.max(0, Math.sin(enemy.phase + j.index * Math.PI * 0.5 + (j.side < 0 ? Math.PI : 0))) * enemy.stride * motion;
        j.rz = -j.side * (1.02 + lift * 0.32);
      } else if (j.kind === 'fang') {
        j.rx = -0.1 - chew * 0.5;
        j.rz = j.side * chew * 0.15;
      } else if (j.kind === 'prismShield') {
        j.ry = j.side * (enemy.prismPhase === 'exposed' ? 1.2 : enemy.prismPhase === 'brace' ? 0 : .15);
      } else if (j.kind === 'wormSegment') {
        j.ry = Math.sin(enemy.phase * 1.4 - j.index * .8) * .13 * motion;
        j.rx = Math.sin(enemy.phase - j.index * .7) * .045 * motion;
      } else if (j.kind === 'quadruped') {
        j.rx = Math.sin(enemy.phase + j.index * Math.PI + j.side) * enemy.stride * .45 * motion;
      } else if (j.kind === 'body') {
        j.rx = Math.sin(enemy.phase * 0.5) * 0.04 * enemy.stride * motion;
        j.ry = Math.sin(time * 1.8 + enemy.id) * 0.025 * motion;
      }
      const swim = enemy.swimBlend * motion, paddle = enemy.swimPhase + j.side * Math.PI + j.index * .7;
      if (swim > .001) {
        if (j.kind === 'arm') { j.rx += (-1.2 + Math.sin(paddle) * .85 - j.rx) * swim; j.rz += j.side * .35 * swim; }
        else if (j.kind === 'elbow') j.rx += (-.5 + Math.cos(paddle) * .35 - j.rx) * swim;
        else if (j.kind === 'leg' || j.kind === 'quadruped') j.rx += (.3 + Math.sin(paddle) * .65 - j.rx) * swim;
        else if (j.kind === 'knee') j.rx += (.55 + Math.cos(paddle) * .3 - j.rx) * swim;
        else if (j.kind === 'spiderLeg') { j.rz += j.side * .25 * Math.sin(paddle) * swim; j.ry += Math.cos(paddle) * .35 * swim; }
        else if (j.kind === 'spiderKnee') j.rz += j.side * .25 * Math.cos(paddle) * swim;
        else if (j.kind === 'wormSegment') j.ry += Math.sin(paddle - j.index) * .2 * swim;
      }
      position.set(j.x, j.y, j.z); rotation.set(j.rx, j.ry, j.rz); quaternion.setFromEuler(rotation);
      matrix.compose(position, quaternion, scale.set(1, 1, 1));
      if (j.parent) matrix.premultiply(jointMatrices[j.parent]); else matrix.premultiply(rootMatrix);
      jointMatrices[j.id].copy(matrix);
    });
  }

  function render(time) {
    if (!mesh || renderDeferred) return;
    let index = 0;
    for (let list = 0; list < 2; list++) {
      const actors = list ? fallen : zombies;
      for (let n = 0; n < actors.length; n++) {
        const enemy = actors[n], p = enemy.position, model = models[enemy.type];
        const dying = enemy.death !== undefined, death = dying ? clamp(enemy.death / 0.65, 0, 1) : 0;
        const motion = reducedMotion || M.config.reducedMotion ? 0 : 1;
        const recoil = Math.sin(clamp(enemy.flash / 0.2, 0, 1) * Math.PI) * 0.22 * motion;
        const bob = Math.abs(Math.sin(enemy.phase)) * (enemy.type === 'brute' ? 0.075 : enemy.type === 'spider' ? 0.025 : 0.045) * enemy.stride * motion;
        const collapse = enemy.exploded ? 0 : death;
        const roll = Math.sin(enemy.phase) * (enemy.type === 'brute' ? 0.075 : 0.04) * enemy.stride * motion;
        const swim = enemy.swimBlend * motion;
        rotation.set(-.18 * swim - recoil - (enemy.type === 'spider' ? 0 : collapse * 1.45), enemy.yaw,
          roll + Math.sin(enemy.swimPhase) * .045 * swim + collapse * (enemy.type === 'spider' ? 2.7 : 0.22));
        quaternion.setFromEuler(rotation);
        position.set(p.x, p.y + bob - collapse * (enemy.type === 'spider' ? -0.18 : 0.35), p.z);
        const shrink = dying ? 1 - Math.pow(clamp((death - 0.65) / 0.35, 0, 1), 2) : 1;
        scale.setScalar(Math.max(0.001, shrink) * (enemy.type === 'boss' ? 1.3 : 1)); rootMatrix.compose(position, quaternion, scale);
        poseJoints(enemy, model, time, motion, recoil);
        for (let partIndex = 0, count = model.parts.length + (enemy.airborne ? models.parachute.parts.length : 0); partIndex < count; partIndex++) {
          const part = partIndex < model.parts.length ? model.parts[partIndex] : models.parachute.parts[partIndex - model.parts.length];
          if (enemy.exploded) {
            position.set(part.x, part.y, part.z); scale.set(part.sx, part.sy, part.sz);
            const burst = death * (2 - death), angle = partIndex * 2.39996 + enemy.id;
            position.x += Math.sin(angle) * burst * (1.5 + partIndex % 3 * 0.4);
            position.z += Math.cos(angle) * burst * (1.5 + partIndex % 3 * 0.4);
            position.y += burst * (1 + partIndex % 4 * 0.35) - death * death * 1.8;
            scale.multiplyScalar(1 - death * 0.75);
            rotation.set(part.rx, part.ry, part.rz); quaternion.setFromEuler(rotation);
            matrix.compose(position, quaternion, scale).premultiply(part.joint ? jointMatrices[part.joint] : rootMatrix);
          } else matrix.multiplyMatrices(part.joint ? jointMatrices[part.joint] : rootMatrix, part.matrix);
          mesh.setMatrixAt(index, matrix);
          color.copy(part.color).multiplyScalar(enemy.tint);
          if (part.glow) color.multiplyScalar(1 + Math.sin(time * 3 + enemy.id) * 0.1 * motion);
          if (enemy.exploded) color.lerp(blastColor, (1 - death) * 0.85);
          if (enemy.flash > 0 && !reducedMotion) color.lerp(hitColor, 0.65);
          mesh.setColorAt(index++, color);
        }
      }
    }
    mesh.count = index;
    mesh.instanceMatrix.updateRange.count = index * 16;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.updateRange.count = index * 3;
      mesh.instanceColor.needsUpdate = true;
    }
  }

  const signals = [], mudPools = [];
  const signalRing = new THREE.TorusGeometry(1, .035, 4, 32);
  const signalDisk = new THREE.CylinderGeometry(1, 1, .018, 24);
  const signalCube = new THREE.BoxGeometry(1, 1, 1), signalMaterials = new Map();
  let digBudget = 32;
  function sound(type, event, point) { if (M.audio && M.audio.enemy) M.audio.enemy(type, event, point); }
  function signalMaterial(tint, opacity) {
    const key = tint + '/' + opacity;
    if (!signalMaterials.has(key)) signalMaterials.set(key, new THREE.MeshBasicMaterial({ color: tint,
      transparent: opacity < 1, opacity, depthWrite: false, toneMapped: false }));
    return signalMaterials.get(key);
  }
  function signal(kind, point, radius, ttl, owner) {
    if (!scene || signals.length >= 64) return null;
    const group = new THREE.Group(), tint = kind === 'mud' ? 0xdcb276 : kind === 'air' ? 0xe1b8ff : kind === 'root' ? 0xb0d66c : kind === 'shield' ? 0xa6e9ff : 0xffc67c;
    group.name = 'Enemy ' + kind + ' signal'; group.position.copy(point); group.position.y += .05;
    const rimMaterial = signalMaterial(tint, .9), bits = signalMaterial(tint, 1);
    // Blasts fade independently; never fade the cached materials used by
    // landing warnings and underground tremor markers.
    const bitMaterial = kind === 'burst' ? bits.clone() : bits;
    if (kind === 'burst') bitMaterial.transparent = true;
    const rim = new THREE.Mesh(signalRing, kind === 'burst' ? rimMaterial.clone() : rimMaterial); rim.rotation.x = Math.PI / 2;
    rim.scale.setScalar(radius); group.add(rim);
    if (kind === 'mud') {
      const disk = new THREE.Mesh(signalDisk, signalMaterial(0x5b4835, .65)); disk.scale.set(radius, 1, radius); group.add(disk);
    }
    for (let i = 0; i < (kind === 'root' ? 6 : 4); i++) {
      const angle = i * Math.PI / (kind === 'root' ? 3 : 2);
      const bit = new THREE.Mesh(signalCube, bitMaterial);
      bit.position.set(Math.cos(angle) * radius * .75, kind === 'root' ? .45 : .05, Math.sin(angle) * radius * .75);
      bit.scale.set(kind === 'root' ? .1 : .14, kind === 'root' ? .9 : .1, .14); bit.rotation.y = angle;
      group.add(bit);
    }
    scene.add(group);
    const fx = { group, kind, ttl, age: 0, owner, radius }; signals.push(fx); return fx;
  }
  function advanceSignals(dt) {
    for (let i = signals.length - 1; i >= 0; i--) {
      const fx = signals[i]; fx.age += dt;
      let done = fx.age >= fx.ttl || fx.owner && fx.owner.hp <= 0;
      if (fx.owner && (fx.kind === 'burrow' || fx.kind === 'air')) {
        const e = fx.owner;
        done = done || !(e.airborne || e.burrowed || e.mode === 'emerge');
        fx.group.position.set(e.position.x, (e.airborne ? e.landingY : e.surfaceY) + .05, e.position.z);
      }
      if (!reducedMotion && !M.config.reducedMotion && fx.kind !== 'mud') fx.group.rotation.y += dt * .6;
      if (fx.kind === 'burst') {
        const t = clamp(fx.age / fx.ttl, 0, 1), motion = !reducedMotion && !M.config.reducedMotion;
        fx.group.scale.setScalar(motion ? .25 + t * 1.25 : 1);
        fx.group.children.forEach((part, index) => {
          part.material.opacity = 1 - t;
          if (motion && index) part.position.y = .1 + Math.sin(t * Math.PI) * 1.5;
        });
      }
      if (done) {
        scene.remove(fx.group); signals.splice(i, 1);
        if (fx.kind === 'burst') new Set(fx.group.children.map(part => part.material)).forEach(material => material.dispose());
      }
    }
    for (let i = mudPools.length - 1; i >= 0; i--) {
      mudPools[i].life -= dt;
      if (mudPools[i].life <= 0) mudPools.splice(i, 1);
    }
  }
  function movementScale(point) {
    return mudPools.some(pool => Math.abs(point.y - pool.point.y) < 1.2 &&
      Math.hypot(point.x - pool.point.x, point.z - pool.point.z) <= pool.radius) ? .65 : 1;
  }
  function surfaceAt(x, z, fallback) {
    return world.surfaceHeight ? world.surfaceHeight(x, z) : fallback;
  }
  function tunnelRoofAt(x, z, fallback) {
    return world.terrainHeight ? world.terrainHeight(x, z) : surfaceAt(x, z, fallback);
  }
  function burrowHeightAt(x, z, fallback) {
    let y = Math.floor((tunnelRoofAt(x, z, fallback) - 4) / SIZE) * SIZE;
    // Graded paving can sit below the original terrain roof. Dig beneath its
    // lowest overlapping foundation, including when straddling a block seam.
    for (let bx = Math.floor((x - .42) / SIZE); bx <= Math.floor((x + .42) / SIZE); bx++) {
      for (let bz = Math.floor((z - .42) / SIZE); bz <= Math.floor((z + .42) / SIZE); bz++) {
        const road = M.hellGates.roadHeightAt(bx, bz);
        if (road) y = Math.min(y, Math.floor((road - SIZE - TYPES.worm.height - .01) / SIZE) * SIZE);
      }
    }
    return y;
  }
  function emergenceExit(enemy) {
    const from = enemy.shaft, height = enemy.emergence.y;
    let best = null, score = Infinity;
    for (const node of navigation.nodes) {
      const distance = Math.hypot(node.x - from.x, node.z - from.z);
      if (distance < 1.6 || distance > 8 || Math.abs(node.y - height) > .1 ||
          Math.hypot(node.x - tree.position.x, node.z - tree.position.z) > EMERGENCE_RADIUS ||
          world.waterDepthAt(node.x, node.z) >= .9 ||
          world.isProtectedArea && world.isProtectedArea(node.bx, node.bz) ||
          !physics.clear(world, node.x, height, node.z, enemy.body) ||
          Math.abs(physics.support(world, node, height + .1, enemy.body) - height) > .1 ||
          !navigation.canWalk({ x: from.x, y: height, z: from.z }, node)) continue;
      // Prefer a nearby exit; the 8-unit ring is the robust fallback for
      // pond edges, cliffs and player-built walls around the shaft.
      const value = distance + (distance > 4.2 ? 6 : 0) + (Number.isFinite(node.distance) ? node.distance * .1 : 5);
      if (value < score) { best = new THREE.Vector3(node.x, height, node.z); score = value; }
    }
    return best;
  }
  function emergencePoint(enemy, avoid) {
    const heading = Math.atan2(enemy.position.x - tree.position.x, enemy.position.z - tree.position.z);
    let best = null, score = Infinity;
    for (const node of navigation.nodes) {
      const distance = Math.hypot(node.x - tree.position.x, node.z - tree.position.z);
      if (distance < EMERGENCE_BAND_INNER || distance > EMERGENCE_RADIUS ||
          world.isProtectedArea && world.isProtectedArea(node.bx, node.bz) ||
          world.waterDepthAt(node.x, node.z) >= .9) continue;
      const roof = Math.floor(surfaceAt(node.x, node.z, node.y) / SIZE) - 1;
      if (node.road || world.blockInfoAt(node.bx, roof, node.bz)?.unbreakable ||
          world.blockInfoAt(node.bx, Math.floor(node.y / SIZE) - 1, node.bz)?.unbreakable) continue;
      if (avoid && Math.hypot(node.x - avoid.x, node.z - avoid.z) < 12) continue;
      const value = angleDistance(angleTo(node), heading) * 20 + Math.abs(distance - EMERGENCE_BAND_FAVOR);
      if (value < score) { best = node; score = value; }
    }
    if (best) return new THREE.Vector3(best.x, surfaceAt(best.x, best.z, best.y), best.z);
    // Fallback on a fresh compass point outside the protected foundation; never
    // aim through the tree's own reserved soil.
    const radius = .5 * (EMERGENCE_BAND_INNER + EMERGENCE_RADIUS);
    const angle = heading + (avoid ? .7 : 0);
    const x = tree.position.x + Math.sin(angle) * radius, z = tree.position.z + Math.cos(angle) * radius;
    return new THREE.Vector3(x, surfaceAt(x, z, enemy.position.y), z);
  }
  function releaseSpoil(enemy, point) {
    if (!enemy.spoil || !M.items || !M.items.dropBlock) return;
    for (const kind of enemy.spoil) M.items.dropBlock(kind, point.x, point.y + .6, point.z, { persistent: true });
    enemy.spoil.length = 0;
  }
  function settleShaft(enemy) {
    if (world.placeBlock) {
      const shaft = enemy.shaft, by = Math.floor(enemy.emergence.y / SIZE) - 2;
      for (let bx = Math.floor((shaft.x - .42) / SIZE); bx <= Math.floor((shaft.x + .42) / SIZE); bx++)
        for (let bz = Math.floor((shaft.z - .42) / SIZE); bz <= Math.floor((shaft.z + .42) / SIZE); bz++) {
          if (!enemy.spoil.length || world.blockInfoAt(bx, by, bz) || !world.blockInfoAt(bx, by - 1, bz)) continue;
          if (world.placeBlock(enemy.spoil[0], bx, by, bz)) enemy.spoil.shift();
        }
    }
    releaseSpoil(enemy, enemy.position);
  }
  function excavate(point, height, enemy) {
    const r = .42, minY = Math.floor((point.y + .01) / SIZE), maxY = Math.floor((point.y + height - .01) / SIZE);
    for (let bx = Math.floor((point.x - r) / SIZE); bx <= Math.floor((point.x + r) / SIZE); bx++)
      for (let bz = Math.floor((point.z - r) / SIZE); bz <= Math.floor((point.z + r) / SIZE); bz++) {
        if (world.isProtectedArea && world.isProtectedArea(bx, bz)) return false;
        for (let by = minY; by <= maxY; by++) {
          const block = world.blockInfoAt(bx, by, bz);
          if (!block) continue;
          if (by < 0) continue; // synthetic flat test worlds have an immutable bed.
          if (digBudget <= 0) return false;
          digBudget--;
          const retain = enemy && enemy.spoil.length < 4 && ['grass', 'dirt', 'stone'].includes(block.kind);
          const kind = world.breakBlockAt(bx, by, bz, { persistentDrop: true, drop: !retain });
          if (!kind) return false;
          if (retain) enemy.spoil.push(kind);
        }
      }
    return true;
  }
  function specialMovement(enemy, dt) {
    const p = enemy.position;
    if (enemy.airborne) {
      enemy.mode = 'air'; enemy.moving = false;
      const water = world.waterInfoAtBlock && world.waterInfoAtBlock(Math.floor(p.x / SIZE), Math.floor(p.z / SIZE));
      const floor = Math.max(world.landingHeight(p.x, p.z, p.y + .01), water && water.depth > 1.3 ? water.level - physics.swimDepth(enemy.body) : 0);
      const next = Math.max(floor, p.y - 3.8 * dt);
      if (p.y > floor + .01) physics.moveVertical(world, p, enemy.body, next);
      if (p.y <= floor + .02 || next <= floor) {
        p.y = floor; enemy.landingY = floor; enemy.airborne = false; enemy.grounded = true;
        enemy.recoverTime = .9; enemy.mode = 'recover'; enemy.target = null;
        signal('land', p, 1.15, .45); sound('parachute', 'land', p);
      }
      return true;
    }
    if (enemy.recoverTime > 0) { enemy.recoverTime -= dt; enemy.moving = false; enemy.mode = 'recover'; return true; }
    if (enemy.type !== 'worm' || !enemy.burrowed && enemy.mode !== 'emerge') return false;
    const goal = enemy.emergence;
    enemy.surfaceY = tunnelRoofAt(p.x, p.z, enemy.surfaceY);
    if (enemy.mode !== 'emerge') {
      enemy.mode = 'burrow';
      const dx = goal.x - p.x, dz = goal.z - p.z, distance = Math.hypot(dx, dz);
      if (distance > .15) {
        const step = Math.min(distance, 2.1 * enemy.speedScale * dt);
        const next = new THREE.Vector3(p.x + dx / distance * step, 0, p.z + dz / distance * step);
        next.y = burrowHeightAt(next.x, next.z, enemy.surfaceY);
        if (excavate(next, enemy.body.height, enemy)) { p.copy(next); enemy.moving = true; enemy.phase += dt * 7; }
        enemy.yaw = Math.atan2(dx, dz);
      } else { enemy.mode = 'emerge'; enemy.emergeTime = 0; enemy.shaft = p.clone(); sound('worm', 'warn', goal); }
    } else {
      enemy.emergeTime += dt; enemy.moving = false;
      // The surface opens only inside the emergence band (eighteen two-unit voxels).
      if (enemy.emergeTime >= 1.4 && excavate(new THREE.Vector3(enemy.shaft.x, goal.y - 4, enemy.shaft.z), 4 + enemy.body.height, enemy)) {
        if (!enemy.emergeExit) enemy.emergeExit = emergenceExit(enemy);
        if (!enemy.emergeExit) {
          // Robust digging: never soft-lock underground. Fill the abandoned
          // shaft, head for a fresh surfacing point and keep tunneling.
          settleShaft(enemy);
          const fresh = emergencePoint(enemy, enemy.emergence);
          const distinct = fresh && (Math.abs(fresh.x - goal.x) > .01 || Math.abs(fresh.z - goal.z) > .01);
          if (distinct && (enemy.emergeRetries || 0) < EMERGENCE_RETRIES) {
            enemy.emergeRetries = (enemy.emergeRetries || 0) + 1;
            enemy.emergence = fresh;
            enemy.surfaceY = tunnelRoofAt(p.x, p.z, enemy.surfaceY);
            enemy.mode = 'burrow'; enemy.emergeTime = 0; enemy.emergeExit = null;
            return true;
          }
          // After bounded retries the watchdog's explosion still clears the
          // Worm, so a sealed map can never lock a wave underground forever.
          enemy.emergeRetries = (enemy.emergeRetries || 0) + 1;
          enemy.emergeTime = 0;
          return true;
        }
        enemy.burrowed = false;
        const k = clamp((enemy.emergeTime - 1.4) / .8, 0, 1);
        const rise = clamp(k * 2, 0, 1), lurch = clamp(k * 2 - 1, 0, 1);
        const lift = rise * rise * (3 - 2 * rise), shift = lurch * lurch * (3 - 2 * lurch);
        p.x = enemy.shaft.x + (enemy.emergeExit.x - enemy.shaft.x) * shift;
        p.z = enemy.shaft.z + (enemy.emergeExit.z - enemy.shaft.z) * shift;
        p.y = goal.y - 4 + 4 * lift + Math.sin(shift * Math.PI) * .6;
        if (k >= 1) {
          p.y = goal.y; enemy.mode = 'walk'; enemy.grounded = true; enemy.target = null;
          enemy.recoverTime = .7; settleShaft(enemy); sound('worm', 'emerge', p);
        }
      }
    }
    return true;
  }
  function tacticalAbility(enemy, dt) {
    const p = enemy.position;
    enemy.abilityTimer -= dt;
    if (enemy.type === 'prismback') {
      enemy.prismTimer -= dt;
      if (enemy.prismTimer <= 0) {
        const phase = enemy.prismPhase;
        enemy.prismPhase = phase === 'march' ? 'brace' : phase === 'brace' ? 'rush' : phase === 'rush' ? 'exposed' : 'march';
        enemy.prismTimer = { march: 6, brace: 1.1, rush: 1.5, exposed: 1.8 }[enemy.prismPhase];
        if (enemy.prismPhase === 'brace') { signal('shield', p, 1.3, 1.1); sound('prismback', 'warn', p); }
      }
      if (enemy.prismPhase === 'brace') { enemy.mode = 'brace'; enemy.moving = false; return true; }
    }
    if (enemy.type === 'binder') {
      if (enemy.snareTarget) {
        const tower = enemy.snareTarget;
        if (!M.towers || !M.towers.list.includes(tower) || tower.position.distanceTo(p) > 9) { enemy.snareTarget = null; return false; }
        enemy.mode = 'chant'; enemy.moving = false; enemy.charge += dt;
        enemy.yaw = Math.atan2(tower.position.x - p.x, tower.position.z - p.z);
        if (enemy.charge >= 1.25) {
          tower.snareTime = 3; tower.snareOwner = enemy; enemy.snareTarget = null;
          enemy.abilityTimer = 7; enemy.casts++;
          signal('root', tower.position, 1.2, 3, enemy); sound('binder', 'cast', p);
        }
        return true;
      }
      if (enemy.abilityTimer <= 0 && enemy.casts < 4 && M.towers) {
        const tower = M.towers.list.filter(t => !(t.snareTime > 0) && t.position.distanceTo(p) < 8 &&
          M.towers.lineClear(p.clone().add(new THREE.Vector3(0, 1.2, 0)), t.position.clone().add(new THREE.Vector3(0, t.def.height * SIZE, 0)), t))
          .sort((a, b) => a.position.distanceToSquared(p) - b.position.distanceToSquared(p))[0];
        if (tower) { enemy.snareTarget = tower; enemy.charge = 0; signal('root', p, 1, 1.25, enemy); sound('binder', 'warn', p); }
      }
    }
    if (enemy.type === 'sower' && Math.hypot(p.x - tree.position.x, p.z - tree.position.z) < 24 && enemy.casts < 3) {
      if (enemy.abilityTimer <= 0) {
        if (!enemy.charge) { signal('sow', p, 2.4, .9, enemy); sound('sower', 'warn', p); }
        enemy.charge += dt; enemy.mode = 'sow'; enemy.moving = false;
        if (enemy.charge >= .9) {
          if (mudPools.length < 12 && world.waterDepthAt(p.x, p.z) < .3) {
            const point = p.clone(); mudPools.push({ point, radius: 2.4, life: 5 }); signal('mud', point, 2.4, 5);
            sound('sower', 'cast', p);
          }
          enemy.charge = 0; enemy.abilityTimer = 7; enemy.casts++;
        }
        return true;
      }
    }
    return false;
  }
  function isTargetable(enemy, origin) {
    // Soil occlusion, range and actual projectile collision protect a buried
    // Worm. Once a player opens a tunnel it is an ordinary, damageable model.
    return enemy.hp > 0;
  }

  function updateHud() {
    const state = getState();
    const key = [state.health, state.coins, state.count, state.wave, state.nextWave, state.pending, state.phase, state.defeated, state.approaches, state.nextSquad].join('/');
    if (key === hudKey) return;
    hudKey = key;
    if (M.ui && M.ui.setDefense) M.ui.setDefense(state);
  }
  function getState() {
    return { health: tree ? tree.health : 100, maxHealth: 100, coins: coins, count: zombies.length,
      wave: wave, pending: pending, phase: nextWave === Infinity ? 'combat' : wave ? 'intermission' : 'prepare',
      maxEnemies: MAX_ENEMIES, approaches: spawnLanes.map(function (lane) { return lane.label; }).join(' / '),
      spawnLanes: spawnLanes.map(function (lane) { return { x: lane.x, z: lane.z, label: lane.label }; }),
      nextSquad: pending > 0 && waveSpawned % plan.squadSize === 0 ? Math.ceil(Math.max(0, spawnTimer)) : 0,
      nextWave: Number.isFinite(nextWave) ? Math.ceil(Math.max(0, nextWave - elapsed - 1e-7)) : 0, defeated: !!tree && tree.health <= 0 };
  }
  function angleTo(node) { return Math.atan2(node.x - tree.position.x, node.z - tree.position.z); }
  function angleDistance(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }
  function chooseSpawnLanes(pool, level) {
    const lanes = [];
    for (let i = 0; i < plan.lanes && pool.length; i++) {
      // The opening comes from the goat's side of the meadow. Later waves
      // rotate the front and alternate squads between widely separated flanks.
      const angle = (level - 1) * 2.3999632297 + i * Math.PI * 2 / plan.lanes;
      let anchor = pool[0];
      pool.forEach(function (node) {
        if (angleDistance(angleTo(node), angle) < angleDistance(angleTo(anchor), angle)) anchor = node;
      });
      const heading = angleTo(anchor);
      if (lanes.some(function (lane) { return angleDistance(lane.angle, heading) < 0.6; })) continue;
      const labels = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];
      const label = labels[(Math.round(heading / (Math.PI / 4)) + 8) % 8];
      lanes.push({ x: anchor.x, z: anchor.z, angle: heading, label: label, gate: anchor });
    }
    return lanes;
  }
  function prepareSpawns(level) {
    plan = wavePlan(level);
    spawnLanes = chooseSpawnLanes(M.hellGates.gates, level);
  }
  function beginWave(level) {
    wave = level === undefined ? wave + 1 : level;
    pending = waveSize(wave); waveSpawned = 0; nextWave = Infinity;
    prepareSpawns(wave);
    spawnTimer = 0;
    if (M.audio && M.audio.cue) M.audio.cue('wave');
    const intro = rules.introduction(wave);
    if (M.ui) M.ui.showBubble('Wave ' + wave + ' — ' + intro);
    updateHud();
  }
  function startNextWave() {
    if (!mesh || !tree || tree.health <= 0) return false;
    beginWave();
    return true;
  }
  // Developer shortcut: jump to an exact wave level, forwards or backwards.
  // Living enemies stay in the world; only queued spawns are replaced.
  function startWave(level) {
    if (!mesh || !tree || tree.health <= 0 || !Number.isSafeInteger(level) || level < 1) return false;
    beginWave(level);
    return true;
  }
  function spawnAt(node, type, options) {
    if (!mesh || zombies.length >= MAX_ENEMIES || tree.health <= 0 || !node) return null;
    type = TYPES[type] ? type : 'zombie';
    const def = TYPES[type];
    // Difficulty is locked in at spawn so each enemy keeps its wave's stats.
    // A Boss multiplies the regular enemy health by twenty, so the 7th-wave
    // warboss is exactly twenty times as durable as a same-wave zombie.
    const difficulty = waveDifficulty(wave);
    const hp = rules.healthForWave(type, wave);
    const zombie = { type: type, body: { radius: def.radius, height: def.height, skin: 0.002 }, id: nextId++, position: new THREE.Vector3(node.x, node.y, node.z), yaw: 0, hp: hp, maxHp: hp, speedScale: difficulty.speed,
      tint: 0.88 + Math.random() * 0.24, phase: Math.random() * 6.28, mode: 'walk', moving: false,
      bite: 0, blockBite: 0, blockKey: '', path: null, target: null, revision: navigation.revision, flash: 0,
      swimming: false, swimBlend: 0, swimPhase: 0, shoreJump: 0, shoreTarget: null,
      jump: null, vy: 0, grounded: true, retry: 0, stuck: 0, stride: 0, eatBlend: 0,
      voiceTimer: 1 + (nextId * 1.71) % 5, chewTimer: 0,
      abilityTimer: 4, charge: 0, casts: 0, prismPhase: 'march', prismTimer: 6, recoverTime: 0,
      progressAt: elapsed,
      bestTreeDistance: Math.hypot(node.x - tree.position.x, node.z - tree.position.z) };
    zombies.push(zombie);
    if (type === 'worm' && !(options && (options.surface || options.airborne))) {
      zombie.spoil = [];
      zombie.surfaceY = tunnelRoofAt(node.x, node.z, node.y); zombie.emergence = emergencePoint(zombie);
      zombie.burrowed = true; zombie.mode = 'burrow'; zombie.position.y = burrowHeightAt(node.x, node.z, zombie.surfaceY);
      signal('burrow', new THREE.Vector3(node.x, zombie.surfaceY, node.z), .9, 40, zombie);
      sound('worm', 'dig', new THREE.Vector3(node.x, zombie.surfaceY, node.z));
    }
    if (options && options.airborne) {
      zombie.airborne = true; zombie.landingY = node.y; zombie.position.y += 16;
      zombie.grounded = false; zombie.mode = 'air';
      signal('air', new THREE.Vector3(node.x, node.y, node.z), 1.2, 12, zombie); sound('parachute', 'open', zombie.position);
    }
    return zombie;
  }
  function spawn() {
    const type = typeForWave(wave, waveSpawned);
    if (deliveryForWave(wave, waveSpawned, type) === 'parachute') {
      const body = { radius: TYPES[type].radius, height: TYPES[type].height, skin: .002 };
      const targets = navigation.nodes.filter(node => {
        const d = Math.hypot(node.x - tree.position.x, node.z - tree.position.z);
        return d >= 18 && d <= 26 && world.waterDepthAt(node.x, node.z) < .3 &&
          physics.clear(world, node.x, node.y, node.z, body) &&
          !zombies.some(enemy => Math.hypot(enemy.position.x - node.x, enemy.position.z - node.z) < 2);
      });
      const reachable = targets.filter(node => Number.isFinite(node.distance)), pool = reachable.length ? reachable : targets;
      return pool.length ? !!spawnAt(pool[Math.floor(Math.random() * pool.length)], type, { airborne: true }) : false;
    }
    const lane = spawnLanes[Math.floor(waveSpawned / plan.squadSize) % spawnLanes.length];
    if (!lane) return false;
    const gate = lane.gate;
    if (type === 'worm') {
      // Burrowers share the announced gate, but appear beneath its immutable
      // plinth. Surface walls cannot block delivery into the covered tunnel.
      const y = burrowHeightAt(gate.x, gate.z, gate.y);
      if (zombies.some(e => Math.hypot(e.position.x - gate.x, e.position.y - y, e.position.z - gate.z) < .9)) return false;
      const enemy = spawnAt(gate, type);
      if (enemy) enemy.gateId = gate.id;
      return !!enemy;
    }
    const node = navigation.nodeAt(gate.x, gate.y, gate.z);
    if (!node || world.waterDepthAt(node.x, node.z) >= .9 || zombies.some(enemy => enemy.position.distanceToSquared(node) < .81)) return false;
    const path = Number.isFinite(node.distance) ? null : navigation.breach(node);
    if (path && !path.length) return false;
    const enemy = spawnAt(node, type);
    if (!enemy) return false;
    enemy.gateId = gate.id;
    if (path) enemy.path = path;
    return true;
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
    if (!isTargetable(enemy, origin)) return false;
    const p = enemy.position, dx = p.x - origin.x, dz = p.z - origin.z, distance = Math.hypot(dx, dz);
    if (distance > range || Math.abs(p.y - origin.y) > 2.8) return false;
    if (!stomp && distance > .1 && (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / distance < .25) return false;
    return lineClear(origin, p);
  }
  // Elemental strikes pick the nearest enemy anywhere around the goat, no
  // aiming cone; walls still block the bolt, exactly like melee attacks.
  function canHitSpell(enemy, origin, range) {
    if (!isTargetable(enemy, origin)) return false;
    const p = enemy.position;
    if (Math.hypot(p.x - origin.x, p.z - origin.z) > range || Math.abs(p.y - origin.y) > 2.8) return false;
    return lineClear(origin, p);
  }
  function spellTargets(origin, range, maxTargets) {
    if (maxTargets <= 0) return [];
    const list = [];
    zombies.slice().sort(function (a, b) {
      return a.position.distanceToSquared(origin) - b.position.distanceToSquared(origin);
    }).forEach(function (zombie) {
      if (list.length >= maxTargets) return;
      if (canHitSpell(zombie, origin, range)) list.push(zombie);
    });
    return list;
  }
  function spellHit(enemy, damage, origin, area) {
    const index = zombies.indexOf(enemy);
    if (index < 0 || tree.health <= 0) return false;
    enemy.bite = 0; enemy.blockBite = 0;
    const killed = damageEnemy(enemy, damage, { origin: origin, area: area });
    if (!['boss', 'worm', 'binder', 'prismback', 'sower'].includes(enemy.type) && M.audio && M.audio.zombie) M.audio.zombie(killed ? 'death' : 'hurt', enemy.position);
    updateHud(); render(elapsed);
    return killed;
  }
  // Fireball blast: everything in the radius splats, corners count a little.
  function spellBlast(point, radius, damage) {
    if (tree.health <= 0) return [];
    const hits = [];
    zombies.slice().forEach(function (zombie) {
      const p = zombie.position, distance = Math.hypot(p.x - point.x, p.z - point.z);
      if (distance > radius || Math.abs(p.y - point.y) > 2.5) return;
      if (distance > 1.5 && !lineClear(point, p)) return;
      hits.push(zombie);
    });
    hits.forEach(function (zombie) { spellHit(zombie, damage, point, true); });
    return hits;
  }
  const outlineMatrix = new THREE.Matrix4(), outlineScale = new THREE.Vector3(1.065, 1.065, 1.065);
  function highlight(predicate) {
    if (!outlineMesh) return;
    let source = 0, count = 0;
    zombies.forEach(function (enemy) {
      const length = models[enemy.type].parts.length + (enemy.airborne ? models.parachute.parts.length : 0);
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
      hit = true; hits++;
      zombie.bite = 0; zombie.blockBite = 0;
      damageEnemy(zombie, damage, { origin: origin, area: stomp });
      if (!['boss', 'worm', 'binder', 'prismback', 'sower'].includes(zombie.type) && M.audio && M.audio.zombie) M.audio.zombie(zombie.hp <= 0 ? 'death' : 'hurt', p);
    }
    if (hit) { updateHud(); render(elapsed); }
    return hit;
  }
  function removeEnemy(enemy, index, exploded) {
    enemy.hp = 0; enemy.exploded = exploded;
    releaseSpoil(enemy, enemy.position);
    if (!reducedMotion) {
      enemy.death = 0; fallen.push(enemy);
      if (fallen.length > 12) fallen.shift();
    }
    zombies.splice(index, 1);
    if (M.towers) M.towers.list.forEach(tower => { if (tower.snareOwner === enemy) { tower.snareOwner = null; tower.snareTime = 0; } });
    if (M.items && M.items.dropCoins) M.items.dropCoins(enemy.position, TYPES[enemy.type].reward);
    if (exploded) {
      const center = enemy.position.clone(); center.y += enemy.body.height * .5;
      const r = WATCHDOG_BLAST_RADIUS;
      // Use the world's normal destruction path: permanent paving, portals
      // and the Hearth foundation retain the same protection as when mined.
      for (let bx = Math.floor((center.x - r) / SIZE); bx <= Math.floor((center.x + r) / SIZE); bx++) {
        for (let bz = Math.floor((center.z - r) / SIZE); bz <= Math.floor((center.z + r) / SIZE); bz++) {
          for (let by = Math.max(0, Math.floor((center.y - r) / SIZE)); by <= Math.floor((center.y + r) / SIZE); by++) {
            if (Math.hypot(bx * SIZE + 1 - center.x, by * SIZE + 1 - center.y, bz * SIZE + 1 - center.z) > r) continue;
            const info = world.blockInfoAt(bx, by, bz);
            if (info && !info.unbreakable) world.breakBlockAt(bx, by, bz, { persistentDrop: true });
          }
        }
      }
      signal('burst', enemy.position, r, .6);
      if (M.audio && M.audio.enemyBurst) M.audio.enemyBurst(enemy.position);
    }
  }
  function watchdog(enemy) {
    const p = enemy.position;
    const direct = Math.hypot(p.x - tree.position.x, p.z - tree.position.z);
    // Only a new closest approach counts. Circling, chewing, casting, tree
    // bites and navigation rebuilds cannot keep a stranded enemy alive.
    if (direct < enemy.bestTreeDistance - 0.5) {
      enemy.progressAt = elapsed;
      enemy.bestTreeDistance = direct;
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
      if (zombie.grounded || zombie.swimming) { zombie.target = null; if (zombie.path && zombie.path[0] === target) zombie.path.shift(); }
      zombie.moving = false; return;
    }
    if (target.y - p.y > SIZE + 0.05 && zombie.grounded) { zombie.target = null; zombie.path = null; return; }
    if (target.y > p.y + 0.1 && zombie.grounded && !zombie.jump) {
      // A real ballistic jump clears exactly one block; a two-block wall is
      // rejected by navigation before the jump is attempted.
      zombie.vy = 10.6; zombie.grounded = false; zombie.jump = target;
    }
    if (zombie.swimming) {
      const exit = physics.shoreExit(world, p, zombie.body, dx, dz, zombie.waterLevel, 20);
      if (exit && exit.distance <= 1) physics.launchShore(zombie, exit);
    }
    const rush = zombie.type === 'prismback' ? zombie.prismPhase === 'rush' ? 2 : zombie.prismPhase === 'exposed' ? .65 : 1 : 1;
    const step = Math.min(d, TYPES[zombie.type].speed * zombie.speedScale * (zombie.swimming ? .8 : 1) * rush * (zombie.towerSlowTime > 0 ? zombie.towerSlow : 1) * dt);
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
    physics.updateSwimming(world, p, zombie.body, zombie, dt);
    if (zombie.swimming) { physics.float(world, p, zombie.body, zombie, dt); return; }
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
    M.hellGates.update(elapsed);
    digBudget = 32; advanceSignals(dt);
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
    if (elapsed >= nextWave) beginWave();
    spawnTimer -= dt;
    if (pending > 0 && spawnTimer <= 0 && zombies.length < MAX_ENEMIES) {
      if (spawn()) {
        pending--; waveSpawned++;
        spawnTimer = waveSpawned % plan.squadSize === 0 ? plan.squadInterval : plan.memberInterval;
      } else spawnTimer = 0.5; // Retry without consuming a member or skipping a flank.
    }
    zombies.forEach(function (zombie) {
      zombie.flash = Math.max(0, zombie.flash - dt); zombie.retry -= dt;
      if (specialMovement(zombie, dt)) return;
      updatePhysics(zombie, dt);
      if ((zombie.grounded || zombie.swimming) && navigation.contact(zombie.position.x, zombie.position.y, zombie.position.z)) {
        zombie.mode = 'tree'; zombie.moving = false; zombie.blockBite = 0;
        zombie.yaw = turnToward(zombie.yaw, Math.atan2(tree.position.x - zombie.position.x, tree.position.z - zombie.position.z), dt * 5);
        zombie.bite += dt;
        while (zombie.bite + 0.000001 >= TYPES[zombie.type].bite && tree.health > 0) {
          tree.damage(TYPES[zombie.type].damage); zombie.bite = Math.max(0, zombie.bite - TYPES[zombie.type].bite);
        }
        return;
      }
      zombie.bite = 0; zombie.mode = zombie.swimming ? 'swim' : 'walk'; zombie.moving = false;
      if (!zombie.swimming && tacticalAbility(zombie, dt)) return;
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
      zombie.swimBlend = damp(zombie.swimBlend, zombie.swimming ? 1 : 0, 7, dt);
      if (zombie.swimming) zombie.swimPhase += dt * 5;
      zombie.stride = damp(zombie.stride, zombie.moving ? 1 : 0, 8, dt);
      const eating = zombie.mode === 'tree' || zombie.mode === 'block';
      zombie.eatBlend = damp(zombie.eatBlend, eating ? 1 : 0, 10, dt);
      const footBeat = Math.floor(zombie.phase / Math.PI);
      if (zombie.moving && zombie.grounded && zombie.footBeat !== undefined && zombie.footBeat !== footBeat) {
        if (['boss', 'worm', 'binder', 'prismback', 'sower'].includes(zombie.type)) sound(zombie.type, 'step', zombie.position);
        else if (M.audio && M.audio.actorStep) M.audio.actorStep('zombie', zombie.position);
      }
      zombie.footBeat = footBeat;
      zombie.voiceTimer -= dt; zombie.chewTimer -= dt;
      if (zombie.voiceTimer <= 0) {
        if (['boss', 'worm', 'binder', 'prismback', 'sower'].includes(zombie.type)) sound(zombie.type, 'idle', zombie.position);
        else if (M.audio && M.audio.zombie) M.audio.zombie(zombie.type === 'spider' || zombie.type === 'skeleton' ? 'bite' : 'groan', zombie.position);
        zombie.voiceTimer = 7.5 + Math.sin(elapsed + zombie.id) * 3.5;
      }
      if (eating && zombie.chewTimer <= 0) {
        if (['boss', 'worm', 'binder', 'prismback', 'sower'].includes(zombie.type)) sound(zombie.type, 'bite', zombie.position);
        else if (M.audio && M.audio.zombie) M.audio.zombie('bite', zombie.position);
        zombie.chewTimer = 1.05 + Math.sin(zombie.id) * 0.25;
      }
    });
    if (wave > 0 && pending === 0 && zombies.length === 0 && nextWave === Infinity) {
      const bonus = rules.clearBonus(wave);
      const rest = rules.restAfter(wave);
      coins += bonus; nextWave = elapsed + rest;
      prepareSpawns(wave + 1);
      if (M.audio && M.audio.cue) M.audio.cue('clear');
      if (M.ui) M.ui.showBubble('Wave cleared! +' + bonus + ' coins · ' + (rest === 60 ? 'One minute to regroup · ' : '') + 'Q to upgrade');
    }
    updateHud(); render(elapsed);
  }
  function init(options) {
    if (mesh) return;
    scene = options.scene; world = options.world; tree = options.tree;
    // The shared field must clear the widest species as well as the walkers.
    M.hellGates.init(scene, world, tree);
    navigation = M.zombieNavigation.create(world, tree, { bodyRadius: 0.44, gates: M.hellGates.gates, roads: M.hellGates.roads });
    navigation.rebuild();
    prepareSpawns(1);
    mesh = new THREE.InstancedMesh(M.enemyModels.geometry(), M.std(0xffffff, 0.94), (MAX_ENEMIES + 12) * maxParts);
    mesh.name = 'Enemy horde'; mesh.count = 0; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.castShadow = true; mesh.receiveShadow = true;
    // Allocate instance colors before the first empty draw compiles its shader.
    mesh.setColorAt(0, new THREE.Color(0xffffff));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
    outlineMesh = new THREE.InstancedMesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0xf5b17c, side: THREE.BackSide,
      transparent: true, opacity: .65, depthWrite: false }), MAX_ENEMIES * maxParts);
    outlineMesh.name = 'Enemies in attack range'; outlineMesh.count = 0; outlineMesh.frustumCulled = false;
    outlineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(outlineMesh);
    updateHud();
  }
  function damageEnemy(enemy, amount, profile) {
    const index = zombies.indexOf(enemy);
    if (index < 0 || !Number.isFinite(amount) || amount <= 0 || tree.health <= 0) return false;
    profile = profile || {};
    if (!isTargetable(enemy, profile.origin)) return false;
    if (enemy.type === 'prismback' && enemy.prismPhase !== 'exposed' && profile.origin && !profile.area) {
      const dx = profile.origin.x - enemy.position.x, dz = profile.origin.z - enemy.position.z, distance = Math.hypot(dx, dz);
      if (distance > .01 && (dx * Math.sin(enemy.yaw) + dz * Math.cos(enemy.yaw)) / distance > .4) {
        amount *= .45; signal('shield', enemy.position, .8, .24); sound('prismback', 'block', enemy.position);
      }
    }
    enemy.hp -= amount; enemy.flash = .15;
    const killed = enemy.hp <= 0;
    if (['boss', 'worm', 'binder', 'prismback', 'sower'].includes(enemy.type)) sound(enemy.type, killed ? 'death' : 'hurt', enemy.position);
    if (killed) removeEnemy(enemy, index, false);
    updateHud();
    return killed;
  }
  M.enemies = { init: init, update: update,
    beginFrame: function () { renderDeferred = true; },
    syncRender: function () { renderDeferred = false; render(elapsed); },
    attack: attack, damageEnemy: damageEnemy, canHit: canHit, highlight: highlight, getState: getState, maxEnemies: MAX_ENEMIES,
    spellTargets: spellTargets, spellHit: spellHit, spellBlast: spellBlast,
    isTargetable: isTargetable, movementScale: movementScale, deliveryForWave: deliveryForWave,
    get mudPools() { return mudPools; }, get signals() { return signals; }, emergenceRadius: EMERGENCE_RADIUS,
    watchdogSeconds: WATCHDOG_SECONDS, types: TYPES, waveSize: waveSize, wavePlan: wavePlan, waveDifficulty: waveDifficulty, typeForWave: typeForWave,
    startNextWave: startNextWave,
    startWave: startWave,
    addCoins: function (amount) { if (!Number.isInteger(amount) || amount <= 0) return false; coins += amount; updateHud(); return true; },
    spendCoins: function (amount) {
      if (!Number.isInteger(amount) || amount < 0 || amount > coins) return false;
      coins -= amount; updateHud(); return true;
    },
    body: BODY, get zombies() { return zombies; }, get navigation() { return navigation; }, spawnAt: spawnAt };
})(window.Meadow = window.Meadow || {});
