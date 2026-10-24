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
  ['zombie', 'skeleton', 'spider', 'brute'].forEach(function (type) { models[type] = { parts: [], joints: [] }; });
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

  const maxParts = Math.max.apply(null, Object.keys(models).map(function (key) { return models[key].parts.length; }));
  const maxJoints = Math.max.apply(null, Object.keys(models).map(function (key) { return models[key].joints.length; }));
  const jointMatrices = [rootMatrix];
  for (let i = 1; i <= maxJoints; i++) jointMatrices.push(new THREE.Matrix4());

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
      } else if (j.kind === 'body') {
        j.rx = Math.sin(enemy.phase * 0.5) * 0.04 * enemy.stride * motion;
        j.ry = Math.sin(time * 1.8 + enemy.id) * 0.025 * motion;
      }
      position.set(j.x, j.y, j.z); rotation.set(j.rx, j.ry, j.rz); quaternion.setFromEuler(rotation);
      matrix.compose(position, quaternion, scale.set(1, 1, 1));
      if (j.parent) matrix.premultiply(jointMatrices[j.parent]); else matrix.premultiply(rootMatrix);
      jointMatrices[j.id].copy(matrix);
    });
  }

  function render(time) {
    if (!mesh) return;
    let index = 0;
    for (let list = 0; list < 2; list++) {
      const actors = list ? fallen : zombies;
      for (let n = 0; n < actors.length; n++) {
        const enemy = actors[n], p = enemy.position, model = models[enemy.type];
        const dying = enemy.death !== undefined, death = dying ? clamp(enemy.death / 0.65, 0, 1) : 0;
        const motion = reducedMotion ? 0 : 1;
        const recoil = Math.sin(clamp(enemy.flash / 0.2, 0, 1) * Math.PI) * 0.22 * motion;
        const bob = Math.abs(Math.sin(enemy.phase)) * (enemy.type === 'brute' ? 0.075 : enemy.type === 'spider' ? 0.025 : 0.045) * enemy.stride * motion;
        const collapse = enemy.exploded ? 0 : death;
        const roll = Math.sin(enemy.phase) * (enemy.type === 'brute' ? 0.075 : 0.04) * enemy.stride * motion;
        rotation.set(-recoil - (enemy.type === 'spider' ? 0 : collapse * 1.45), enemy.yaw,
          roll + collapse * (enemy.type === 'spider' ? 2.7 : 0.22));
        quaternion.setFromEuler(rotation);
        position.set(p.x, p.y + bob - collapse * (enemy.type === 'spider' ? -0.18 : 0.35), p.z);
        const shrink = dying ? 1 - Math.pow(clamp((death - 0.65) / 0.35, 0, 1), 2) : 1;
        scale.setScalar(Math.max(0.001, shrink)); rootMatrix.compose(position, quaternion, scale);
        poseJoints(enemy, model, time, motion, recoil);
        for (let partIndex = 0; partIndex < model.parts.length; partIndex++) {
          const part = model.parts[partIndex];
          position.set(part.x, part.y, part.z); scale.set(part.sx, part.sy, part.sz);
          if (enemy.exploded) {
            const burst = death * (2 - death), angle = partIndex * 2.39996 + enemy.id;
            position.x += Math.sin(angle) * burst * (1.5 + partIndex % 3 * 0.4);
            position.z += Math.cos(angle) * burst * (1.5 + partIndex % 3 * 0.4);
            position.y += burst * (1 + partIndex % 4 * 0.35) - death * death * 1.8;
            scale.multiplyScalar(1 - death * 0.75);
          }
          rotation.set(part.rx, part.ry, part.rz); quaternion.setFromEuler(rotation);
          matrix.compose(position, quaternion, scale).premultiply(part.joint ? jointMatrices[part.joint] : rootMatrix);
          mesh.setMatrixAt(index, matrix);
          color.setHex(part.tint).multiplyScalar(enemy.tint);
          if (part.glow) color.multiplyScalar(1 + Math.sin(time * 3 + enemy.id) * 0.1 * motion);
          if (enemy.exploded) color.lerp(blastColor, (1 - death) * 0.85);
          if (enemy.flash > 0 && !reducedMotion) color.lerp(hitColor, 0.65);
          mesh.setColorAt(index++, color);
        }
      }
    }
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

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
  function beginWave(level) {
    wave = level === undefined ? wave + 1 : level;
    pending = waveSize(wave); waveSpawned = 0; nextWave = Infinity;
    spawnTimer = 0;
    if (M.audio && M.audio.cue) M.audio.cue('wave');
    if (M.ui) M.ui.showBubble('Wave ' + wave + (wave === 3 ? ' — spiders incoming!' : wave === 5 ? ' — skeletons incoming!' : wave === 8 ? ' — stone brutes incoming!' : ' — protect the Hearth!'));
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
      const length = models[enemy.type].parts.length;
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
    if (elapsed >= nextWave) beginWave();
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
    mesh = new THREE.InstancedMesh(beveledVoxelGeometry(), M.std(0xffffff, 0.94), (MAX_ENEMIES + 12) * maxParts);
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
    startNextWave: startNextWave,
    startWave: startWave,
    addCoins: function (amount) { if (!Number.isInteger(amount) || amount <= 0) return false; coins += amount; updateHud(); return true; },
    spendCoins: function (amount) {
      if (!Number.isInteger(amount) || amount < 0 || amount > coins) return false;
      coins -= amount; updateHud(); return true;
    },
    body: BODY, get zombies() { return zombies; }, get navigation() { return navigation; }, spawnAt: spawnAt };
})(window.Meadow = window.Meadow || {});
