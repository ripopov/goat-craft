(function (M) {
  'use strict';

  const { clamp, turnToward } = M.utils;
  const BLOCK = 2;
  const FISH_NEAR = 58;
  const MAX_PONDS = 6;
  const SYNC_INTERVAL = 0.9;

  // Three little species with different silhouettes and colours. Counts and
  // sizes are seeded by the pond, so a pond always has the same shoal while
  // the world can generate new ponds as the player wanders.
  const SPECIES = [
    { id: 'gold', body: 0xf0a238, belly: 0xffdc80, fin: 0xe85f2f, scale: 1.0 },
    { id: 'silver', body: 0xd0dedb, belly: 0xfbfdf5, fin: 0x8faeb1, scale: 0.92 },
    { id: 'blue', body: 0x3f8db4, belly: 0xc7e8dc, fin: 0x2f6f91, scale: 0.98 }
  ];

  let sceneRef = null;
  let worldRef = null;
  let syncTimer = 0;
  const active = new Map();
  const mats = Object.create(null);
  let bodyGeo = null;
  let tailGeo = null;
  let dorsalGeo = null;
  let pectoralGeo = null;
  let eyeGeo = null;
  let pupilGeo = null;
  let lilyGeo = null;
  let lilyFlowerGeo = null;
  let rippleGeo = null;
  let lilyMat = null;
  let lilyFlowerMat = null;
  let eyeMat = null;
  let pupilMat = null;

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function materialsFor(species) {
    if (mats[species.id]) return mats[species.id];
    const set = {
      body: M.std(species.body, 0.62),
      belly: M.std(species.belly, 0.72),
      fin: M.std(species.fin, 0.68, { side: THREE.DoubleSide })
    };
    mats[species.id] = set;
    return set;
  }

  // A vertical fan of triangles for the tail, and a smaller triangular dorsal
  // fin. Both are deliberately low-poly so the fish match the meadow's cubes.
  function makeFan(points) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geo.setIndex(points.length === 9 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    return geo;
  }

  function ensureGeometry() {
    if (bodyGeo) return;
    bodyGeo = new THREE.SphereGeometry(1, 8, 6);
    tailGeo = makeFan([
      0, 0, 0,
      0, 0.17, -0.22,
      0, -0.17, -0.22
    ]);
    dorsalGeo = makeFan([
      0, 0, 0,
      0, 0.15, -0.16,
      0, 0.01, -0.24
    ]);
    pectoralGeo = makeFan([
      0, 0, 0,
      0.16, -0.02, -0.02,
      0.05, -0.11, -0.10
    ]);
    eyeGeo = new THREE.SphereGeometry(0.033, 7, 5);
    pupilGeo = new THREE.SphereGeometry(0.018, 6, 4);
    lilyGeo = new THREE.CircleGeometry(1, 9);
    lilyFlowerGeo = new THREE.ConeGeometry(0.055, 0.1, 5);
    rippleGeo = new THREE.RingGeometry(0.16, 0.22, 16);
    lilyMat = M.std(0x4e8a3d, 0.84, { side: THREE.DoubleSide });
    lilyFlowerMat = M.std(0xe7b4bd, 0.72);
    eyeMat = M.std(0xf1edda, 0.4);
    pupilMat = M.std(0x181512, 0.3);
  }

  function makeFishModel(species, size) {
    ensureGeometry();
    const set = materialsFor(species);
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, set.body);
    body.scale.set(0.17, 0.20, 0.34);
    group.add(body);

    const belly = new THREE.Mesh(bodyGeo, set.belly);
    belly.scale.set(0.115, 0.105, 0.245);
    belly.position.set(0, -0.075, 0.02);
    group.add(belly);

    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, 0, -0.29);
    const tail = new THREE.Mesh(tailGeo, set.fin);
    tailPivot.add(tail);
    group.add(tailPivot);

    const dorsal = new THREE.Mesh(dorsalGeo, set.fin);
    dorsal.position.set(0, 0.16, -0.02);
    group.add(dorsal);

    const pectorals = [];
    [-1, 1].forEach(function (side) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.15, -0.025, 0.05);
      const fin = new THREE.Mesh(pectoralGeo, set.fin);
      fin.scale.x = side;
      pivot.add(fin);
      group.add(pivot);
      pectorals.push(pivot);
    });

    [-1, 1].forEach(function (side) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.145, 0.055, 0.18);
      group.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(side * 0.164, 0.058, 0.19);
      pupil.scale.set(0.8, 0.9, 0.5);
      group.add(pupil);
    });

    group.scale.setScalar(size);
    return {
      group: group,
      body: body,
      tail: tailPivot,
      dorsal: dorsal,
      pectorals: pectorals,
      phase: 0,
      size: size
    };
  }

  function placeLilies(group, plan, rnd) {
    const waterRadius = plan.waterRadius;
    const count = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const angle = rnd() * Math.PI * 2;
      const radius = waterRadius * (0.18 + rnd() * 0.50);
      const pad = new THREE.Mesh(lilyGeo, lilyMat);
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = rnd() * Math.PI;
      const scale = 0.22 + rnd() * 0.18;
      pad.scale.set(scale, scale, scale);
      pad.position.set(
        Math.cos(angle) * radius,
        plan.waterLevel + 0.055,
        Math.sin(angle) * radius
      );
      group.add(pad);

      if (rnd() < 0.45) {
        const flower = new THREE.Mesh(lilyFlowerGeo, lilyFlowerMat);
        flower.position.set(pad.position.x + 0.04, plan.waterLevel + 0.12, pad.position.z - 0.02);
        flower.rotation.z = 0.18;
        group.add(flower);
      }
    }
  }

  function createPond(plan) {
    const group = new THREE.Group();
    group.position.set(plan.x, 0, plan.z);
    const rnd = mulberry32(plan.seed ^ 0xf15a2f0d);
    const count = 5 + Math.floor(rnd() * 5);
    const fish = [];
    const floorY = plan.floorBlock * BLOCK;
    const depth = Math.max(0.5, plan.waterLevel - floorY);
    const swimLow = floorY + 0.36;
    const swimHigh = plan.waterLevel - 0.32;
    const swimRoom = Math.max(0.1, swimHigh - swimLow);
    const limit = plan.r * BLOCK;

    placeLilies(group, plan, rnd);

    for (let i = 0; i < count; i++) {
      // Every shoal has at least a gold, silver and blue fish; the rest
      // are seeded so a pond keeps its own mix of species.
      const speciesIndex = i === 0 ? 0 : i === 1 ? 1 : i === 2 ? 2 : Math.floor(rnd() * SPECIES.length);
      const species = SPECIES[speciesIndex];
      const size = (0.92 + rnd() * 0.48) * species.scale;
      const model = makeFishModel(species, size);
      const radius = limit * (0.24 + rnd() * 0.18);
      const f = {
        model: model,
        group: model.group,
        species: species.id,
        size: size,
        rx: radius * (0.78 + rnd() * 0.34),
        rz: radius * (0.78 + rnd() * 0.34),
        angle: rnd() * Math.PI * 2,
        dir: rnd() < 0.5 ? -1 : 1,
        speed: 0.22 + rnd() * 0.18,
        phase: rnd() * Math.PI * 2,
        baseY: swimLow + rnd() * swimRoom,
        yPhase: rnd() * Math.PI * 2,
        rippleTimer: 1.5 + rnd() * 5,
        x: 0,
        z: 0,
        yaw: 0
      };
      const p = fishPosition(f, f.angle);
      f.x = p.x;
      f.z = p.z;
      f.group.position.set(f.x, f.baseY, f.z);
      f.yaw = Math.atan2(-Math.sin(f.angle) * f.rx * f.dir, Math.cos(f.angle) * f.rz * f.dir);
      f.group.rotation.y = f.yaw;
      group.add(f.group);
      fish.push(f);
    }

    sceneRef.add(group);
    return {
      plan: plan,
      group: group,
      fish: fish,
      ripples: []
    };
  }

  function fishPosition(f, angle) {
    return {
      x: Math.cos(angle) * f.rx + Math.cos(angle * 2 + f.phase) * 0.32,
      z: Math.sin(angle) * f.rz + Math.sin(angle * 2 + f.phase) * 0.26
    };
  }

  function spawnRipple(entry, x, z) {
    ensureGeometry();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xd8f5ee,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(rippleGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, entry.plan.waterLevel + 0.07, z);
    mesh.userData.life = 1.05;
    mesh.userData.maxLife = 1.05;
    entry.group.add(mesh);
    entry.ripples.push(mesh);
  }

  function updateRipples(entry, dt) {
    for (let i = entry.ripples.length - 1; i >= 0; i--) {
      const ripple = entry.ripples[i];
      ripple.userData.life -= dt;
      const k = clamp(ripple.userData.life / ripple.userData.maxLife, 0, 1);
      ripple.scale.setScalar(1 + (1 - k) * 4.5);
      ripple.material.opacity = k * 0.32;
      if (ripple.userData.life <= 0) {
        entry.group.remove(ripple);
        ripple.material.dispose();
        entry.ripples.splice(i, 1);
      }
    }
  }

  function updateFish(f, dt, t, entry) {
    const model = f.model;
    const prevX = f.x;
    const prevZ = f.z;
    f.angle += f.dir * f.speed * dt;
    const p = fishPosition(f, f.angle);
    f.x = p.x;
    f.z = p.z;

    const previousYaw = f.yaw;
    const dx = f.x - prevX;
    const dz = f.z - prevZ;
    if (dx * dx + dz * dz > 0.000001) {
      const wanted = Math.atan2(dx, dz);
      f.yaw = turnToward(f.yaw, wanted, dt * 3.8);
    }

    const bob = Math.sin(t * 1.7 + f.yPhase) * 0.045;
    f.group.position.set(f.x, f.baseY + bob, f.z);
    f.group.rotation.y = f.yaw;
    const turn = Math.atan2(Math.sin(f.yaw - previousYaw), Math.cos(f.yaw - previousYaw));
    const bank = M.config.reducedMotion ? 0 : clamp(turn / Math.max(dt, 0.001) * -0.12, -0.22, 0.22);
    f.group.rotation.z = M.utils.damp(f.group.rotation.z, bank + Math.sin(t * 1.2 + f.yPhase) * 0.035, 5, dt);
    f.group.rotation.x = Math.sin(t * 1.5 + f.yPhase) * 0.025;

    // Tail cadence follows swimming speed and integrates continuously.
    model.phase += dt * (3.6 + Math.hypot(dx, dz) / Math.max(dt, 0.001) * 2.2);
    const beat = Math.sin(model.phase + f.phase);
    model.tail.rotation.y = beat * 0.48;
    model.dorsal.rotation.z = Math.sin(t * 3.1 + f.phase) * 0.08;
    for (let i = 0; i < model.pectorals.length; i++) {
      model.pectorals[i].rotation.z = Math.sin(t * 4.6 + f.phase + i * Math.PI) * 0.25;
    }
    model.body.scale.y = 0.20 * (1 + Math.sin(t * 2.1 + f.phase) * 0.025);

    f.rippleTimer -= dt;
    if (f.rippleTimer <= 0) {
      f.rippleTimer = 2.5 + Math.random() * 5.5;
      spawnRipple(entry, f.x, f.z);
    }
  }

  function syncPonds(player) {
    const near = worldRef.pondsNear(player.x, player.z, FISH_NEAR)
      .filter(function (plan) { return plan.distance <= FISH_NEAR; })
      .slice(0, MAX_PONDS);
    const wanted = new Set();
    for (let i = 0; i < near.length; i++) {
      const plan = near[i];
      wanted.add(plan.id);
      if (!active.has(plan.id)) active.set(plan.id, createPond(plan));
    }

    active.forEach(function (entry, id) {
      if (!wanted.has(id)) {
        sceneRef.remove(entry.group);
        entry.ripples.forEach(function (ripple) { ripple.material.dispose(); });
        active.delete(id);
      }
    });
  }

  function init(deps) {
    sceneRef = deps.scene;
    worldRef = deps.world;
    ensureGeometry();
    syncTimer = 0;
  }

  function update(dt, t, player) {
    if (!sceneRef || !worldRef) return;
    syncTimer -= dt;
    if (syncTimer <= 0) {
      syncTimer = SYNC_INTERVAL;
      syncPonds(player);
    }

    active.forEach(function (entry) {
      updateRipples(entry, dt);
      for (let i = 0; i < entry.fish.length; i++) {
        updateFish(entry.fish[i], dt, t, entry);
      }
    });
  }

  function list() {
    const out = [];
    active.forEach(function (entry, pondId) {
      const plan = entry.plan;
      for (let i = 0; i < entry.fish.length; i++) {
        const f = entry.fish[i];
        out.push({
          pond: pondId,
          species: f.species,
          size: f.size,
          x: plan.x + f.x,
          y: f.group.position.y,
          z: plan.z + f.z,
          waterLevel: plan.waterLevel,
          floorY: plan.floorBlock * BLOCK,
          waterRadius: plan.waterRadius,
          pondRadius: plan.r * BLOCK,
          distanceToCenter: Math.hypot(f.x, f.z)
        });
      }
    });
    return out;
  }

  function ponds() {
    return Array.from(active.values()).map(function (entry) {
      return {
        id: entry.plan.id,
        x: entry.plan.x,
        z: entry.plan.z,
        waterLevel: entry.plan.waterLevel,
        fish: entry.fish.length,
        ripples: entry.ripples.length
      };
    });
  }

  M.fish = {
    init: init,
    update: update,
    list: list,
    ponds: ponds
  };
})(window.Meadow = window.Meadow || {});
