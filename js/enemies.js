(function (M) {
  'use strict';

  const MAX_ENEMIES = 200, WATCHDOG_SECONDS = 20;
  const SIZE = 2;
  const TYPES = {
    zombie: { name: 'Zombie', unlock: 1, hp: 2, speed: 1.65, reward: 1, bite: 3, damage: 1, chew: 10, radius: 0.34, height: 2.8 },
    spider: { name: 'Spider', unlock: 3, hp: 2, speed: 2.7, reward: 2, bite: 3.5, damage: 1, chew: 12, radius: 0.42, height: 1.15 },
    skeleton: { name: 'Skeleton', unlock: 5, hp: 3, speed: 1.9, reward: 2, bite: 2.6, damage: 1, chew: 10, radius: 0.34, height: 2.8 },
    brute: { name: 'Stone brute', unlock: 8, hp: 7, speed: 1.15, reward: 4, bite: 3.5, damage: 2, chew: 7, radius: 0.44, height: 2.8 },
    worm: { name: 'Burrow Worm', unlock: 10, hp: 4, speed: 1.6, reward: 4, bite: 3.6, damage: 1, chew: 9, radius: .4, height: 1.4 },
    binder: { name: 'Briar Binder', unlock: 7, hp: 3, speed: 1.35, reward: 3, bite: 3.8, damage: 1, chew: 11, radius: .4, height: 2.8 },
    prismback: { name: 'Prismback', unlock: 12, hp: 4, speed: 1.25, reward: 4, bite: 3.8, damage: 1, chew: 9, radius: .44, height: 1.8 },
    sower: { name: 'Mire Sower', unlock: 15, hp: 3, speed: 1.5, reward: 3, bite: 3.5, damage: 1, chew: 11, radius: .42, height: 2 }
  };
  function waveSize(level) { return Math.min(MAX_ENEMIES, 2 + level * 4); }
  // Pressure comes from coordinated arrivals before it comes from stat growth.
  // Short squad gaps leave recovery time without feeding hunters single targets.
  function wavePlan(level) {
    const radius = 36 + Math.min(8, Math.max(0, level - 3));
    // Separate larger squads and new fronts from species introductions (3/5/8).
    return { size: waveSize(level), squadSize: level < 4 ? 3 : level < 9 ? 4 : 5,
      memberInterval: Math.max(0.3, 0.6 - (level - 1) * 0.02),
      squadInterval: Math.max(2.4, 4.2 - (level - 1) * 0.15),
      lanes: level === 1 ? 1 : level < 6 ? 2 : 3, minRadius: radius, maxRadius: radius + 8 };
  }
  // Higher waves toughen enemies: health climbs toward 5x and speed toward 3x
  // of their level-1 values, easing in quickly at first and capping slowly.
  function waveDifficulty(wave) {
    const health = 1 - Math.exp(-Math.max(0, wave - 3) / 30);
    const speed = 1 - Math.exp(-Math.max(0, wave - 1) / 45);
    return { hp: 1 + 4 * health, speed: 1 + 2 * speed };
  }
  // Deterministic slots introduce a readable mix and bound the durable units.
  function typeForWave(level, slot) {
    if (level >= 10 && slot % 12 === 9) return 'worm';
    if (level >= 15 && slot % 20 === 17) return 'sower';
    if (level >= 12 && slot % 20 === 13) return 'prismback';
    if (level >= 7 && slot % 20 === 7) return 'binder';
    if (level >= 8 && slot % 6 === 5) return 'brute';
    if (level >= 5 && slot % 4 === 2) return 'skeleton';
    if (level >= 3 && slot % 3 === 1) return 'spider';
    return 'zombie';
  }
  function deliveryForWave(level, slot, type) {
    return level >= 5 && (type === 'zombie' || type === 'skeleton') &&
      (level === 5 ? slot === 3 : slot % 10 === 3) ? 'parachute' : 'ground';
  }
  const physics = M.actorPhysics, BODY = { radius: 0.34, height: 2.8, skin: 0.002 };
  const { clamp, turnToward, damp } = M.utils;
  const zombies = [], fallen = [];
  let scene, world, tree, navigation, mesh, outlineMesh;
  let elapsed = 0, wave = 0, nextWave = 10, pending = 0, spawnTimer = 0, coins = 0, waveSpawned = 0;
  let plan = wavePlan(1), spawnLanes = [], burrowLanes = [];
  let rebuildTimer = 0, plannerTimer = 0, nextId = 0, hudKey = '';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const matrix = new THREE.Matrix4(), rootMatrix = new THREE.Matrix4();
  const position = new THREE.Vector3(), scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion(), rotation = new THREE.Euler();
  const color = new THREE.Color(), hitColor = new THREE.Color(0xffd2a1), blastColor = new THREE.Color(0xffc56e);

  function beveledVoxelGeometry() {
    const vertices = [], normals = [], uvs = [], inner = 0.435;
    function vertex(point, normal, u, v) {
      vertices.push(point[0], point[1], point[2]); normals.push(normal[0], normal[1], normal[2]); uvs.push(u, v);
    }
    function face(points, normal, triangle) {
      const a = points[0], b = points[1], c = points[2];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const reverse = (uy * vz - uz * vy) * normal[0] + (uz * vx - ux * vz) * normal[1] + (ux * vy - uy * vx) * normal[2] < 0;
      const order = triangle ? [0, 1, 2] : [0, 1, 2, 0, 2, 3];
      if (reverse) order.reverse();
      order.forEach(function (i) { vertex(points[i], normal, i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0); });
    }
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const a = (axis + 1) % 3, b = (axis + 2) % 3, normal = [0, 0, 0]; normal[axis] = sign;
      face([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (uv) {
        const point = [0, 0, 0]; point[axis] = sign * 0.5; point[a] = uv[0] * inner; point[b] = uv[1] * inner; return point;
      }), normal);
    }
    [[0, 1], [0, 2], [1, 2]].forEach(function (axes) {
      const a = axes[0], b = axes[1], free = 3 - a - b;
      for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
        const points = [[sa * 0.5, sb * inner], [sa * inner, sb * 0.5]].map(function (pair) {
          const point = [0, 0, 0]; point[a] = pair[0]; point[b] = pair[1]; point[free] = -inner; return point;
        });
        points.push([points[1][0], points[1][1], points[1][2]], [points[0][0], points[0][1], points[0][2]]);
        points[2][free] = points[3][free] = inner;
        const normal = [0, 0, 0]; normal[a] = sa * Math.SQRT1_2; normal[b] = sb * Math.SQRT1_2;
        face(points, normal);
      }
    });
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
      face([[x * 0.5, y * inner, z * inner], [x * inner, y * 0.5, z * inner], [x * inner, y * inner, z * 0.5]],
        [x / Math.sqrt(3), y / Math.sqrt(3), z / Math.sqrt(3)], true);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeBoundingSphere();
    return geometry;
  }

  const models = {};
  Object.keys(TYPES).concat('parachute').forEach(function (type) { models[type] = { parts: [], joints: [] }; });
  function joint(type, kind, parent, x, y, z, side, index) {
    const model = models[type], id = model.joints.length + 1;
    model.joints.push({ id: id, kind: kind, parent: parent || 0, x: x, y: y, z: z, side: side || 0, index: index || 0, rx: 0, ry: 0, rz: 0 });
    return id;
  }
  function part(type, x, y, z, sx, sy, sz, tint, parent, glow) {
    const p = { x: x, y: y, z: z, sx: sx, sy: sy, sz: sz, tint: tint, joint: parent || 0, glow: !!glow, rx: 0, ry: 0, rz: 0 };
    models[type].parts.push(p); return p;
  }
  function walkerJoints(type, hips, shoulders, headY) {
    const result = { legs: [], arms: [] };
    [-1, 1].forEach(function (side) {
      const leg = joint(type, 'leg', 0, side * hips, 1.02, 0, side);
      result.legs.push([leg, joint(type, 'knee', leg, 0, -0.46, 0, side)]);
      const arm = joint(type, 'arm', 0, side * shoulders, 1.94, 0, side);
      result.arms.push([arm, joint(type, 'elbow', arm, 0, -0.45, 0, side)]);
    });
    result.head = joint(type, 'head', 0, 0, headY, 0);
    result.jaw = joint(type, 'jaw', result.head, 0, 0.12, 0.2);
    return result;
  }

  const zombie = walkerJoints('zombie', 0.23, 0.58, 2.04);
  part('zombie', 0, 1.52, 0, 0.88, 0.94, 0.48, 0x356c73);
  part('zombie', 0, 1.94, 0.02, 0.5, 0.16, 0.5, 0x63906a);
  part('zombie', 0, 1.08, 0, 0.78, 0.16, 0.43, 0x323e49);
  [-0.31, -0.08, 0.17, 0.34].forEach(function (x, i) { part('zombie', x, 0.94 + i % 2 * 0.07, 0.01, 0.18, 0.25 - i % 2 * 0.08, 0.43, 0x315f67); });
  part('zombie', -0.25, 1.58, 0.255, 0.25, 0.3, 0.045, 0x538363);
  part('zombie', 0.28, 1.35, 0.255, 0.2, 0.16, 0.045, 0x223f48);
  part('zombie', 0.19, 1.73, 0.26, 0.12, 0.24, 0.04, 0x63906a);
  part('zombie', -0.3, 1.35, -0.25, 0.2, 0.22, 0.04, 0x284f59);
  part('zombie', 0, 0.38, 0, 0.86, 0.76, 0.72, 0x6d9863, zombie.head);
  part('zombie', 0, 0.75, -0.02, 0.88, 0.12, 0.72, 0x344d3b, zombie.head);
  part('zombie', 0, 0.43, -0.36, 0.82, 0.55, 0.08, 0x3b5840, zombie.head);
  [-1, 1].forEach(function (side) {
    part('zombie', side * 0.21, 0.44, 0.375, 0.23, 0.16, 0.055, 0x20352c, zombie.head);
    part('zombie', side * 0.22, 0.45, 0.41, 0.075, 0.065, 0.025, 0xd5ce83, zombie.head);
    part('zombie', side * 0.25, 0.59, 0.38, 0.3, 0.1, 0.055, side < 0 ? 0x3c583f : 0x4c6745, zombie.head).rz = side * 0.1;
    part('zombie', side * 0.44, 0.35, 0, 0.09, 0.24, 0.22, 0x527c50, zombie.head);
    part('zombie', side * 0.25, 0.19, 0.38, 0.19, 0.13, 0.045, 0x5d8857, zombie.head);
  });
  part('zombie', 0.03, 0.28, 0.42, 0.17, 0.2, 0.17, 0x4f774b, zombie.head);
  part('zombie', 0, -0.04, 0.16, 0.4, 0.16, 0.12, 0x293b2e, zombie.jaw);
  part('zombie', 0, -0.11, 0.12, 0.42, 0.1, 0.22, 0x567c4e, zombie.jaw);
  [-0.12, 0, 0.12].forEach(function (x, i) { part('zombie', x, 0.01, 0.23, 0.065, 0.07 + i % 2 * 0.025, 0.035, 0xc3bd91, zombie.jaw); });
  zombie.legs.forEach(function (joints, i) {
    const side = i ? 1 : -1, leg = joints[0], knee = joints[1];
    part('zombie', 0, -0.24, 0, 0.36, 0.49, 0.4, 0x49455e, leg);
    part('zombie', side * 0.04, -0.42, 0.21, 0.18, 0.17, 0.04, 0x668064, leg);
    part('zombie', 0, -0.25, 0, 0.33, 0.5, 0.36, 0x3e4054, knee);
    part('zombie', 0, -0.52, 0.08, 0.39, 0.2, 0.54, 0x2c3538, knee);
    part('zombie', 0, -0.48, 0.35, 0.34, 0.09, 0.12, 0x202a2e, knee);
  });
  zombie.arms.forEach(function (joints, i) {
    const side = i ? 1 : -1, arm = joints[0], elbow = joints[1];
    part('zombie', 0, -0.21, 0, 0.34, 0.43, 0.41, 0x376c72, arm);
    part('zombie', side * 0.03, -0.43, 0, 0.35, 0.13, 0.39, 0x2d565d, arm);
    part('zombie', 0, -0.24, 0, 0.28, 0.49, 0.32, 0x699361, elbow);
    part('zombie', 0, -0.52, 0.02, 0.34, 0.19, 0.38, 0x52794d, elbow);
    part('zombie', side * 0.11, -0.65, 0.06, 0.09, 0.18, 0.12, 0x466c45, elbow);
    part('zombie', -side * 0.06, -0.65, 0.12, 0.08, 0.17, 0.1, 0x5b8352, elbow);
  });

  const skeleton = walkerJoints('skeleton', 0.21, 0.52, 2.04);
  part('skeleton', 0, 1.5, -0.03, 0.16, 0.98, 0.18, 0xaaa991);
  part('skeleton', 0, 1.55, 0.18, 0.13, 0.75, 0.12, 0xc9c6aa);
  [1.28, 1.49, 1.7, 1.89].forEach(function (y, i) {
    [-1, 1].forEach(function (side) {
      part('skeleton', side * (0.25 + i * 0.015), y, 0.04, 0.43, 0.09, 0.35, 0xd5d1b4).rz = side * (0.08 + i * 0.02);
      part('skeleton', side * 0.4, y - 0.05, 0.17, 0.1, 0.18, 0.1, 0xbebba0);
    });
  });
  part('skeleton', 0, 1.01, -0.02, 0.22, 0.28, 0.25, 0xb4b298);
  [-1, 1].forEach(function (side) {
    part('skeleton', side * 0.23, 1.0, 0, 0.35, 0.22, 0.34, 0xc8c4a7).rz = side * 0.2;
    part('skeleton', side * 0.27, 1.91, 0, 0.47, 0.12, 0.18, 0xd8d3b5);
  });
  part('skeleton', 0, 0.43, -0.02, 0.74, 0.57, 0.64, 0xdad6bd, skeleton.head);
  part('skeleton', 0, 0.7, -0.02, 0.78, 0.16, 0.66, 0xe3dfc7, skeleton.head);
  [-1, 1].forEach(function (side) {
    part('skeleton', side * 0.2, 0.46, 0.325, 0.22, 0.19, 0.055, 0x29352f, skeleton.head);
    part('skeleton', side * 0.2, 0.46, 0.36, 0.065, 0.075, 0.025, 0xe9a154, skeleton.head, true);
    part('skeleton', side * 0.3, 0.25, 0.31, 0.19, 0.12, 0.14, 0xc5c1a5, skeleton.head);
    part('skeleton', side * 0.37, 0.44, 0, 0.09, 0.31, 0.43, 0xb9b69c, skeleton.head);
  });
  part('skeleton', 0, 0.29, 0.34, 0.1, 0.14, 0.055, 0x4b5144, skeleton.head);
  part('skeleton', 0, 0.11, 0.28, 0.52, 0.1, 0.14, 0xc9c5a9, skeleton.head);
  part('skeleton', 0, -0.04, 0.1, 0.57, 0.14, 0.43, 0xbab79d, skeleton.jaw);
  [-0.2, -0.1, 0, 0.1, 0.2].forEach(function (x) {
    part('skeleton', x, 0.07, 0.34, 0.065, 0.1, 0.065, 0xe6e1c6, skeleton.head);
    part('skeleton', x, 0.04, 0.31, 0.065, 0.08, 0.065, 0xd8d3b8, skeleton.jaw);
  });
  skeleton.legs.forEach(function (joints) {
    const leg = joints[0], knee = joints[1];
    part('skeleton', 0, -0.24, 0, 0.18, 0.47, 0.19, 0xc7c3a8, leg);
    part('skeleton', 0, 0, 0, 0.24, 0.2, 0.24, 0xd7d2b6, knee);
    part('skeleton', -0.055, -0.24, 0, 0.085, 0.47, 0.11, 0xcac6ab, knee);
    part('skeleton', 0.055, -0.24, 0, 0.085, 0.47, 0.11, 0xb5b398, knee);
    part('skeleton', 0, -0.5, 0.1, 0.28, 0.15, 0.43, 0xaaa991, knee);
  });
  skeleton.arms.forEach(function (joints) {
    const arm = joints[0], elbow = joints[1];
    part('skeleton', 0, -0.22, 0, 0.16, 0.44, 0.17, 0xd0ccb0, arm);
    part('skeleton', 0, 0, 0, 0.22, 0.2, 0.22, 0xbdb99e, elbow);
    part('skeleton', -0.05, -0.23, 0, 0.075, 0.45, 0.09, 0xd4d0b4, elbow);
    part('skeleton', 0.05, -0.23, 0, 0.075, 0.45, 0.09, 0xbab79d, elbow);
    part('skeleton', 0, -0.49, 0.02, 0.25, 0.15, 0.22, 0xc9c5aa, elbow);
    [-0.08, 0, 0.08].forEach(function (x) { part('skeleton', x, -0.6, 0.04, 0.055, 0.17, 0.07, 0xd8d3b7, elbow); });
  });

  const spiderHead = joint('spider', 'head', 0, 0, 0.52, 0.52);
  const spiderAbdomen = joint('spider', 'body', 0, 0, 0.65, -0.18);
  part('spider', 0, 0, -0.2, 0.88, 0.65, 1.02, 0x44334f, spiderAbdomen);
  part('spider', 0, 0.3, -0.24, 0.64, 0.12, 0.75, 0x67516d, spiderAbdomen);
  [-0.28, 0, 0.28].forEach(function (z) { part('spider', 0, 0.32, z - 0.2, 0.72, 0.055, 0.1, 0x352b42, spiderAbdomen); });
  part('spider', 0, 0.5, 0.2, 0.76, 0.46, 0.65, 0x5c4964);
  part('spider', 0, 0.7, 0.17, 0.48, 0.12, 0.48, 0x756078);
  part('spider', 0, 0, 0.1, 0.62, 0.4, 0.42, 0x514057, spiderHead);
  [-0.22, -0.075, 0.075, 0.22].forEach(function (x, i) {
    part('spider', x, 0.08, 0.325, 0.105, 0.11, 0.055, i === 0 || i === 3 ? 0xffc06a : 0xe68b4e, spiderHead, true);
    part('spider', x * 0.72, -0.065, 0.33, 0.075, 0.075, 0.05, 0xffa655, spiderHead, true);
  });
  [-1, 1].forEach(function (side) {
    const fang = joint('spider', 'fang', spiderHead, side * 0.19, -0.13, 0.27, side);
    part('spider', 0, -0.12, 0.04, 0.13, 0.28, 0.14, 0xd8c6a4, fang).rx = -0.22;
    part('spider', 0, -0.27, 0.09, 0.075, 0.14, 0.08, 0xeee0bd, fang).rx = -0.35;
    for (let i = 0; i < 4; i++) {
      const hip = joint('spider', 'spiderLeg', 0, side * 0.34, 0.55, -0.48 + i * 0.29, side, i);
      const knee = joint('spider', 'spiderKnee', hip, side * 0.65, 0, 0, side, i);
      part('spider', side * 0.32, 0, 0, 0.68, 0.14, 0.16, 0x745a79, hip);
      part('spider', 0, 0, 0, 0.19, 0.18, 0.2, 0x372d44, knee);
      part('spider', side * 0.1, -0.34, 0, 0.14, 0.73, 0.14, 0x4b3a56, knee).rz = -side * 0.24;
      part('spider', side * 0.19, -0.69, 0.035, 0.23, 0.1, 0.28, 0x302839, knee);
    }
  });

  const brute = walkerJoints('brute', 0.31, 0.72, 2.06);
  part('brute', 0, 1.48, 0, 1.24, 1.06, 0.72, 0x59675f);
  part('brute', 0, 1.83, 0.16, 1.13, 0.48, 0.65, 0x788276);
  part('brute', 0, 1.04, 0, 1.03, 0.24, 0.63, 0x424f49);
  part('brute', -0.49, 1.52, 0.39, 0.25, 0.66, 0.13, 0x899083);
  part('brute', 0.49, 1.52, 0.39, 0.25, 0.66, 0.13, 0x6f7b70);
  part('brute', 0, 1.52, 0.405, 0.38, 0.47, 0.12, 0x2d3b36);
  part('brute', 0, 1.52, 0.48, 0.25, 0.34, 0.09, 0xf0ad47, 0, true);
  part('brute', 0, 1.52, 0.535, 0.11, 0.19, 0.035, 0xffd477, 0, true);
  part('brute', -0.22, 1.77, 0.5, 0.055, 0.36, 0.035, 0x303c37).rz = -0.55;
  part('brute', 0.28, 1.25, 0.43, 0.05, 0.31, 0.04, 0x35423c).rz = 0.65;
  part('brute', -0.7, 2.03, -0.02, 0.68, 0.61, 0.88, 0x899184);
  part('brute', -0.78, 2.34, -0.04, 0.48, 0.16, 0.64, 0xa0a392);
  part('brute', 0.67, 1.99, 0, 0.46, 0.39, 0.66, 0x6b796f);
  part('brute', -0.78, 2.06, 0.44, 0.06, 0.35, 0.035, 0x404b44).rz = 0.45;
  part('brute', 0, 0.36, -0.02, 0.82, 0.65, 0.69, 0x69756a, brute.head);
  part('brute', 0, 0.65, -0.03, 0.85, 0.15, 0.71, 0x889080, brute.head);
  part('brute', 0, 0.48, 0.34, 0.83, 0.18, 0.13, 0x3f4d46, brute.head);
  [-1, 1].forEach(function (side) {
    part('brute', side * 0.21, 0.39, 0.36, 0.18, 0.12, 0.07, 0x232f2b, brute.head);
    part('brute', side * 0.21, 0.4, 0.405, 0.09, 0.065, 0.035, 0xf3b34f, brute.head, true);
    part('brute', side * 0.37, 0.18, 0.21, 0.2, 0.3, 0.3, 0x778174, brute.head);
  });
  part('brute', 0, 0.18, 0.39, 0.24, 0.22, 0.22, 0x525f56, brute.head);
  part('brute', 0, -0.04, 0.12, 0.61, 0.2, 0.48, 0x4c5951, brute.jaw);
  part('brute', -0.13, 0.57, 0.37, 0.045, 0.3, 0.035, 0x333f39, brute.head).rz = -0.45;
  brute.legs.forEach(function (joints, i) {
    const leg = joints[0], knee = joints[1];
    part('brute', 0, -0.23, 0, 0.46, 0.48, 0.51, 0x515f56, leg);
    part('brute', i ? 0.08 : -0.08, -0.22, 0.27, 0.34, 0.37, 0.12, 0x778176, leg);
    part('brute', 0, -0.02, 0.08, 0.47, 0.25, 0.48, 0x38463f, knee);
    part('brute', 0, -0.27, 0, 0.4, 0.5, 0.43, 0x5b6960, knee);
    part('brute', 0, -0.54, 0.12, 0.52, 0.22, 0.7, 0x3d4b44, knee);
    part('brute', 0, -0.55, 0.46, 0.46, 0.12, 0.15, 0x6d786d, knee);
  });
  brute.arms.forEach(function (joints, i) {
    const arm = joints[0], elbow = joints[1], heavy = i === 0;
    part('brute', 0, -0.24, 0, heavy ? 0.57 : 0.45, 0.5, heavy ? 0.62 : 0.49, 0x66736a, arm);
    part('brute', 0, -0.03, 0, heavy ? 0.52 : 0.4, 0.25, heavy ? 0.54 : 0.44, 0x899183, elbow);
    part('brute', 0, -0.29, 0.02, heavy ? 0.59 : 0.45, 0.56, heavy ? 0.61 : 0.48, 0x536159, elbow);
    part('brute', 0, -0.61, 0.1, heavy ? 0.66 : 0.52, 0.3, heavy ? 0.68 : 0.54, 0x788276, elbow);
    [-0.18, 0, 0.18].forEach(function (x) { part('brute', x, -0.69, 0.39, 0.14, 0.16, 0.18, 0x929789, elbow); });
    part('brute', heavy ? -0.23 : 0.15, -0.25, 0.34, 0.05, 0.32, 0.035, 0x303e37, elbow).rz = heavy ? -0.4 : 0.5;
  });

  // Original silhouettes: articulated tunnel segments, a lantern stump,
  // a faceted shield animal, and a walking seed amphora. All share one draw.
  let wormParent = 0;
  for (let i = 0; i < 6; i++) {
    const segment = joint('worm', 'wormSegment', wormParent, 0, i ? 0 : .62, i ? -.4 : .65, 0, i);
    const width = .66 - i * .065;
    part('worm', 0, 0, 0, width, .65 - i * .055, .5, i % 2 ? 0x765344 : 0xa67d53, segment);
    part('worm', 0, .29 - i * .025, 0, width * .85, .09, .35, 0xc4a16c, segment);
    part('worm', 0, .05, .23, width * .9, .08, .06, 0x473a37, segment);
    if (!i) {
      for (const side of [-1, 1]) {
        part('worm', side * .2, .13, .29, .12, .12, .07, 0xffcc75, segment, true);
        part('worm', side * .24, -.12, .36, .1, .27, .12, 0xe9d2a1, segment).rx = -.4;
      }
      part('worm', 0, -.08, .3, .31, .14, .11, 0x36282f, segment);
    }
    wormParent = segment;
  }
  const binder = walkerJoints('binder', .23, .53, 1.95);
  part('binder', 0, 1.35, 0, .85, 1.05, .65, 0x66503b);
  for (const x of [-.3, 0, .3]) part('binder', x, 1.4, .35, .1, .85, .1, 0xa18a4d).rz = x * .25;
  part('binder', 0, 1.6, .42, .36, .4, .14, 0x303d32);
  part('binder', 0, 1.6, .51, .19, .24, .05, 0xffcb67, 0, true);
  part('binder', 0, .28, 0, .8, .58, .65, 0x7b6944, binder.head);
  for (const side of [-1, 1]) {
    part('binder', side * .19, .28, .35, .13, .09, .06, 0xffe29a, binder.head, true);
    part('binder', side * .3, .6, 0, .13, .55, .12, 0x685139, binder.head).rz = -side * .4;
    part('binder', side * .45, .76, .02, .45, .26, .46, 0x577453, binder.head);
    part('binder', side * .22, .9, -.05, .46, .2, .5, 0x7e935e, binder.head);
  }
  binder.legs.forEach((j, i) => {
    part('binder', 0, -.25, 0, .25, .5, .3, 0x5b503b, j[0]);
    part('binder', 0, -.3, .06, .3, .6, .4, 0x52634b, j[1]).rz = i ? -.12 : .12;
  });
  binder.arms.forEach((j, i) => {
    part('binder', 0, -.22, 0, .25, .47, .27, 0x74613f, j[0]);
    part('binder', 0, -.28, .02, .18, .6, .2, 0x536b46, j[1]);
    for (let finger = 0; finger < 3; finger++) part('binder', (finger - 1) * .11, -.58, .12, .065, .27, .08, 0x91a260, j[1]).rx = -.3;
  });
  const prismBody = joint('prismback', 'body', 0, 0, .85, -.18);
  part('prismback', 0, 0, 0, .92, .7, 1.4, 0x394e61, prismBody);
  for (let row = 0; row < 3; row++) for (const side of [-1, 1]) {
    const plate = part('prismback', side * .3, .35, -.58 + row * .42, .55, .32, .52, row % 2 ? 0x8dbdca : 0x517f96, prismBody);
    plate.rz = side * .3;
  }
  part('prismback', 0, .75, .66, .62, .45, .44, 0x4b6172);
  for (const side of [-1, 1]) {
    part('prismback', side * .21, .85, .9, .12, .09, .06, 0xc9f6ff, 0, true);
    const hinge = joint('prismback', 'prismShield', 0, side * .45, 1.02, .66, side);
    part('prismback', -side * .21, .04, .04, .52, .85, .2, 0x97d1dd, hinge).rz = side * .23;
    part('prismback', -side * .09, -.06, .16, .14, .58, .06, 0xc4f5f3, hinge, true);
    for (let i = 0; i < 2; i++) {
      const leg = joint('prismback', 'quadruped', 0, side * .4, .63, -.58 + i * .96, side, i);
      part('prismback', 0, -.26, .03, .29, .59, .36, 0x586574, leg);
      part('prismback', 0, -.54, .12, .35, .14, .42, 0x303d4c, leg);
    }
  }
  part('prismback', 0, .84, -.95, .4, .37, .12, 0xffbb69, 0, true);
  part('sower', 0, .56, .12, .87, .74, 1.07, 0x687756);
  part('sower', 0, 1.15, -.18, .77, .9, .8, 0x986743);
  part('sower', 0, 1.65, -.18, .52, .21, .55, 0x604934);
  part('sower', 0, 1.79, -.18, .36, .13, .38, 0xc2a064);
  for (const side of [-1, 1]) {
    part('sower', side * .25, .77, .69, .16, .12, .08, 0xffde88, 0, true);
    part('sower', side * .34, 1.27, -.16, .12, .8, .55, 0xd4ad60).rz = side * .15;
    for (let i = 0; i < 2; i++) {
      const foot = joint('sower', 'quadruped', 0, side * .4, .35, -.35 + i * .7, side, i);
      part('sower', side * .06, -.2, .05, .32, .28, .43, 0x404c3e, foot);
    }
  }
  part('sower', 0, .4, .7, .38, .12, .13, 0x3c392e);
  for (let i = 0; i < 3; i++) part('sower', (i - 1) * .2, 1.36, -.63, .11, .11, .08, 0xffcf6c, 0, true);

  // Voxel cloth panels and four suspension cords ride in the horde batch.
  for (let x = -2; x <= 2; x++) for (let z = -1; z <= 1; z++) {
    const panel = part('parachute', x * .53, 5.15 - x * x * .11 - z * z * .15, z * .65,
      .57, .27, .72, (x + z) % 2 ? 0xc88b63 : 0xf1dbad);
    panel.rz = -x * .32;
  }
  for (const side of [-1, 1]) for (const front of [-1, 1]) {
    const cord = part('parachute', side * .65, 3.58, front * .35, .035, 2.32, .035, 0xb9ae99);
    cord.rz = -side * .28; cord.rx = front * .14;
  }

  const maxParts = Math.max.apply(null, Object.keys(models).map(function (key) { return models[key].parts.length; })) + models.parachute.parts.length;
  const maxJoints = Math.max.apply(null, Object.keys(models).map(function (key) { return models[key].joints.length; }));
  // Voxel offsets and palette colors are immutable. Compose/convert them once,
  // rather than repeating Euler and sRGB work for every part of 200 actors.
  Object.keys(models).forEach(function (type) {
    models[type].parts.forEach(function (part) {
      position.set(part.x, part.y, part.z); scale.set(part.sx, part.sy, part.sz);
      rotation.set(part.rx, part.ry, part.rz); quaternion.setFromEuler(rotation);
      part.matrix = new THREE.Matrix4().compose(position, quaternion, scale);
      part.color = new THREE.Color(part.tint);
    });
  });
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
        scale.setScalar(Math.max(0.001, shrink)); rootMatrix.compose(position, quaternion, scale);
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
    const rim = new THREE.Mesh(signalRing, signalMaterial(tint, .9)); rim.rotation.x = Math.PI / 2;
    rim.scale.setScalar(radius); group.add(rim);
    if (kind === 'mud') {
      const disk = new THREE.Mesh(signalDisk, signalMaterial(0x5b4835, .65)); disk.scale.set(radius, 1, radius); group.add(disk);
    }
    for (let i = 0; i < (kind === 'root' ? 6 : 4); i++) {
      const angle = i * Math.PI / (kind === 'root' ? 3 : 2);
      const bit = new THREE.Mesh(signalCube, signalMaterial(tint, 1));
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
      if (done) { scene.remove(fx.group); signals.splice(i, 1); }
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
  function emergenceExit(enemy) {
    const from = enemy.shaft, height = enemy.emergence.y;
    let best = null, score = Infinity;
    for (const node of navigation.nodes) {
      const distance = Math.hypot(node.x - from.x, node.z - from.z);
      if (distance < 1.6 || distance > 4.2 || Math.abs(node.y - height) > .1 ||
          Math.hypot(node.x - tree.position.x, node.z - tree.position.z) > 9.8 ||
          !physics.clear(world, node.x, height, node.z, enemy.body) ||
          Math.abs(physics.support(world, node, height + .1, enemy.body) - height) > .1 ||
          !navigation.canWalk({ x: from.x, y: height, z: from.z }, node)) continue;
      const value = distance + (Number.isFinite(node.distance) ? node.distance * .1 : 5);
      if (value < score) { best = new THREE.Vector3(node.x, height, node.z); score = value; }
    }
    return best;
  }
  function emergencePoint(enemy) {
    const heading = Math.atan2(enemy.position.x - tree.position.x, enemy.position.z - tree.position.z);
    let best = null, score = Infinity;
    for (const node of navigation.nodes) {
      const distance = Math.hypot(node.x - tree.position.x, node.z - tree.position.z);
      if (distance < 7 || distance > 9.8 || world.isProtectedArea && world.isProtectedArea(node.bx, node.bz)) continue;
      const value = angleDistance(angleTo(node), heading) * 20 + Math.abs(distance - 9);
      if (value < score) { best = node; score = value; }
    }
    return best ? new THREE.Vector3(best.x, surfaceAt(best.x, best.z, best.y), best.z) :
      new THREE.Vector3(tree.position.x + Math.sin(heading) * 8, surfaceAt(tree.position.x, tree.position.z, enemy.position.y), tree.position.z + Math.cos(heading) * 8);
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
        enemy.recoverTime = .9; enemy.mode = 'recover'; enemy.target = null; enemy.progressAt = elapsed;
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
        next.y = Math.floor((tunnelRoofAt(next.x, next.z, enemy.surfaceY) - 4) / SIZE) * SIZE;
        if (excavate(next, enemy.body.height, enemy)) { p.copy(next); enemy.moving = true; enemy.phase += dt * 7; }
        enemy.yaw = Math.atan2(dx, dz);
      } else { enemy.mode = 'emerge'; enemy.emergeTime = 0; enemy.shaft = p.clone(); sound('worm', 'warn', goal); }
    } else {
      enemy.emergeTime += dt; enemy.moving = false;
      // The surface opens only inside five full voxels (10 world units).
      if (enemy.emergeTime >= 1.4 && excavate(new THREE.Vector3(enemy.shaft.x, goal.y - 4, enemy.shaft.z), 4 + enemy.body.height, enemy)) {
        if (!enemy.emergeExit) enemy.emergeExit = emergenceExit(enemy);
        if (!enemy.emergeExit) return true;
        enemy.burrowed = false;
        const k = clamp((enemy.emergeTime - 1.4) / .8, 0, 1);
        const rise = clamp(k * 2, 0, 1), lurch = clamp(k * 2 - 1, 0, 1);
        const lift = rise * rise * (3 - 2 * rise), shift = lurch * lurch * (3 - 2 * lurch);
        p.x = enemy.shaft.x + (enemy.emergeExit.x - enemy.shaft.x) * shift;
        p.z = enemy.shaft.z + (enemy.emergeExit.z - enemy.shaft.z) * shift;
        p.y = goal.y - 4 + 4 * lift + Math.sin(shift * Math.PI) * .6;
        if (k >= 1) {
          p.y = goal.y; enemy.mode = 'walk'; enemy.grounded = true; enemy.target = null;
          enemy.recoverTime = .7; enemy.progressAt = elapsed; settleShaft(enemy); sound('worm', 'emerge', p);
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
          enemy.abilityTimer = 7; enemy.casts++; enemy.progressAt = elapsed;
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
      nextWave: Number.isFinite(nextWave) ? Math.ceil(Math.max(0, nextWave - elapsed)) : 0, defeated: !!tree && tree.health <= 0 };
  }
  function angleTo(node) { return Math.atan2(node.x - tree.position.x, node.z - tree.position.z); }
  function angleDistance(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }
  function ringNodes() {
    return navigation.nodes.filter(function (node) {
      const d = Math.hypot(node.x - tree.position.x, node.z - tree.position.z);
      return d >= plan.minRadius && d <= plan.maxRadius && world.waterDepthAt(node.x, node.z) < 0.9;
    });
  }
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
    // Burrowers retain their original ring and approach selection.
    const candidates = ringNodes(), reachable = candidates.filter(node => Number.isFinite(node.distance));
    burrowLanes = chooseSpawnLanes(reachable.length ? reachable : candidates, level);
    spawnLanes = chooseSpawnLanes(M.hellGates.gates, level);
  }
  function beginWave(level) {
    wave = level === undefined ? wave + 1 : level;
    pending = waveSize(wave); waveSpawned = 0; nextWave = Infinity;
    prepareSpawns(wave);
    spawnTimer = 0;
    if (M.audio && M.audio.cue) M.audio.cue('wave');
    const introductions = { 3: 'Spiders incoming!', 5: 'Skeletons and parachutes — watch the lavender landing rings.',
      7: 'Briar Binders — interrupt their glowing tower-snare chant.', 8: 'Stone brutes incoming!',
      10: 'Burrow Worms — guard the inner five blocks.', 12: 'Prismbacks — flank them or use stomps and splash.',
      15: 'Mire Sowers — avoid amber puddles or jump clear.' };
    if (M.ui) M.ui.showBubble('Wave ' + wave + ' — ' + (introductions[wave] || 'protect the Hearth!'));
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
    const def = TYPES[type], start = navigation.nodeAt(node.x, node.y, node.z);
    // Difficulty is locked in at spawn so each enemy keeps its wave's stats.
    const difficulty = waveDifficulty(wave), hp = Math.max(1, Math.round(def.hp * difficulty.hp));
    const zombie = { type: type, body: { radius: def.radius, height: def.height, skin: 0.002 }, id: nextId++, position: new THREE.Vector3(node.x, node.y, node.z), yaw: 0, hp: hp, maxHp: hp, speedScale: difficulty.speed,
      tint: 0.88 + Math.random() * 0.24, phase: Math.random() * 6.28, mode: 'walk', moving: false,
      bite: 0, blockBite: 0, blockKey: '', path: null, target: null, revision: navigation.revision, flash: 0,
      swimming: false, swimBlend: 0, swimPhase: 0, shoreJump: 0, shoreTarget: null,
      jump: null, vy: 0, grounded: true, retry: 0, stuck: 0, stride: 0, eatBlend: 0,
      voiceTimer: 1 + (nextId * 1.71) % 5, chewTimer: 0,
      abilityTimer: 4, charge: 0, casts: 0, prismPhase: 'march', prismTimer: 6, recoverTime: 0,
      progressAt: elapsed, progressRevision: navigation.revision, progressPath: null,
      bestTreeDistance: Math.hypot(node.x - tree.position.x, node.z - tree.position.z),
      bestRouteDistance: start && Number.isFinite(start.distance) ? start.distance * SIZE + Math.hypot(node.x - start.x, node.z - start.z) : Infinity };
    zombies.push(zombie);
    if (type === 'worm' && !(options && options.surface)) {
      zombie.spoil = [];
      zombie.surfaceY = tunnelRoofAt(node.x, node.z, node.y); zombie.emergence = emergencePoint(zombie);
      zombie.burrowed = true; zombie.mode = 'burrow'; zombie.position.y = Math.floor((zombie.surfaceY - 4) / SIZE) * SIZE;
      signal('burrow', new THREE.Vector3(node.x, zombie.surfaceY, node.z), .9, 40, zombie);
      sound('worm', 'dig', new THREE.Vector3(node.x, zombie.surfaceY, node.z));
    }
    if (options && options.airborne && (type === 'zombie' || type === 'skeleton')) {
      zombie.airborne = true; zombie.landingY = node.y; zombie.position.y += 16;
      zombie.grounded = false; zombie.mode = 'air';
      signal('air', new THREE.Vector3(node.x, node.y, node.z), 1.2, 12, zombie); sound('parachute', 'open', zombie.position);
    }
    return zombie;
  }
  function spawn() {
    const type = typeForWave(wave, waveSpawned);
    if (deliveryForWave(wave, waveSpawned, type) === 'parachute') {
      const targets = navigation.nodes.filter(node => {
        const d = Math.hypot(node.x - tree.position.x, node.z - tree.position.z);
        return d >= 18 && d <= 26 && world.waterDepthAt(node.x, node.z) < .3 &&
          !zombies.some(enemy => Math.hypot(enemy.position.x - node.x, enemy.position.z - node.z) < 2);
      });
      const reachable = targets.filter(node => Number.isFinite(node.distance)), pool = reachable.length ? reachable : targets;
      return pool.length ? !!spawnAt(pool[Math.floor(Math.random() * pool.length)], type, { airborne: true }) : false;
    }
    if (type !== 'worm') {
      const lane = spawnLanes[Math.floor(waveSpawned / plan.squadSize) % spawnLanes.length];
      if (!lane) return false;
      const gate = lane.gate, node = navigation.nodeAt(gate.x, gate.y, gate.z);
      if (!node || world.waterDepthAt(node.x, node.z) >= .9 || zombies.some(enemy => enemy.position.distanceToSquared(node) < .81)) return false;
      const path = Number.isFinite(node.distance) ? null : navigation.breach(node);
      if (path && !path.length) return false;
      const enemy = spawnAt(node, type);
      if (!enemy) return false;
      enemy.gateId = gate.id;
      if (path) enemy.path = path;
      return true;
    }
    const candidates = ringNodes().filter(function (node) {
      if (type === 'worm' && M.goat && M.goat.group &&
          Math.hypot(node.x - M.goat.group.position.x, node.z - M.goat.group.position.z) < 16) return false;
      return !zombies.some(function (z) { return z.position.distanceToSquared(node) < 2.25; });
    });
    if (!candidates.length) return false;
    // Canopies can be isolated high above the ground. Prefer proven routes so
    // a last enemy on a treetop cannot lock a clear-to-advance wave forever.
    const reachable = candidates.filter(function (node) { return Number.isFinite(node.distance); });
    const pool = reachable.length ? reachable : candidates;
    const lane = burrowLanes[Math.floor(waveSpawned / plan.squadSize) % burrowLanes.length];
    const heading = lane ? lane.angle : (wave - 1) * 2.3999632297;
    let closest = Math.PI;
    pool.forEach(function (node) { closest = Math.min(closest, angleDistance(angleTo(node), heading)); });
    const local = pool.filter(function (node) { return angleDistance(angleTo(node), heading) <= closest + 0.16; });
    // Favor comparable route lengths so squad members reach the battle together.
    if (reachable.length) {
      const shortest = Math.min.apply(null, local.map(function (node) { return node.distance; }));
      const group = local.filter(function (node) { return node.distance <= shortest + 4; });
      return !!spawnAt(group[Math.floor(Math.random() * group.length)], typeForWave(wave, waveSpawned));
    }
    // A sealed defense must still receive enemies that can chew a real breach.
    for (let attempt = 0; local.length && attempt < 6; attempt++) {
      const index = Math.floor(Math.random() * local.length), node = local.splice(index, 1)[0];
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
    if (!['worm', 'binder', 'prismback', 'sower'].includes(enemy.type) && M.audio && M.audio.zombie) M.audio.zombie(killed ? 'death' : 'hurt', enemy.position);
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
      if (!['worm', 'binder', 'prismback', 'sower'].includes(zombie.type) && M.audio && M.audio.zombie) M.audio.zombie(zombie.hp <= 0 ? 'death' : 'hurt', p);
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
          tree.damage(TYPES[zombie.type].damage); zombie.progressAt = elapsed; zombie.bite = Math.max(0, zombie.bite - TYPES[zombie.type].bite);
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
        if (['worm', 'binder', 'prismback', 'sower'].includes(zombie.type)) sound(zombie.type, 'step', zombie.position);
        else if (M.audio && M.audio.actorStep) M.audio.actorStep('zombie', zombie.position);
      }
      zombie.footBeat = footBeat;
      zombie.voiceTimer -= dt; zombie.chewTimer -= dt;
      if (zombie.voiceTimer <= 0) {
        if (['worm', 'binder', 'prismback', 'sower'].includes(zombie.type)) sound(zombie.type, 'idle', zombie.position);
        else if (M.audio && M.audio.zombie) M.audio.zombie(zombie.type === 'spider' || zombie.type === 'skeleton' ? 'bite' : 'groan', zombie.position);
        zombie.voiceTimer = 7.5 + Math.sin(elapsed + zombie.id) * 3.5;
      }
      if (eating && zombie.chewTimer <= 0) {
        if (['worm', 'binder', 'prismback', 'sower'].includes(zombie.type)) sound(zombie.type, 'bite', zombie.position);
        else if (M.audio && M.audio.zombie) M.audio.zombie('bite', zombie.position);
        zombie.chewTimer = 1.05 + Math.sin(zombie.id) * 0.25;
      }
    });
    if (wave > 0 && pending === 0 && zombies.length === 0 && nextWave === Infinity) {
      const bonus = Math.min(24, 4 + wave * 2);
      coins += bonus; nextWave = elapsed + 10;
      prepareSpawns(wave + 1);
      if (M.audio && M.audio.cue) M.audio.cue('clear');
      if (M.ui) M.ui.showBubble('Wave cleared! +' + bonus + ' coins · Q to upgrade');
    }
    updateHud(); render(elapsed);
  }
  function init(options) {
    if (mesh) return;
    scene = options.scene; world = options.world; tree = options.tree;
    // The shared field must clear the widest species as well as the walkers.
    M.hellGates.init(scene, world, tree);
    navigation = M.zombieNavigation.create(world, tree, { bodyRadius: 0.44, gates: M.hellGates.gates });
    navigation.rebuild();
    prepareSpawns(1);
    mesh = new THREE.InstancedMesh(beveledVoxelGeometry(), M.std(0xffffff, 0.94), (MAX_ENEMIES + 12) * maxParts);
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
    if (['worm', 'binder', 'prismback', 'sower'].includes(enemy.type)) sound(enemy.type, killed ? 'death' : 'hurt', enemy.position);
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
    get mudPools() { return mudPools; }, get signals() { return signals; }, emergenceRadius: 5 * SIZE,
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
