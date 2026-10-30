(function (M) {
  'use strict';

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

  function create(TYPES) {
    const position = new THREE.Vector3(), scale = new THREE.Vector3();
    const rotation = new THREE.Euler(), quaternion = new THREE.Quaternion();
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

    // Salt-green raiders: striped shirts, crimson scarves and iron cutlasses.
    const raider = walkerJoints('raider', .23, .53, 2.04);
    part('raider', 0, 1.52, 0, .85, .94, .48, 0x243f51);
    [1.25, 1.48, 1.71].forEach(y => part('raider', 0, y, .25, .85, .09, .04, 0xc8c5a5));
    part('raider', 0, 1.94, .04, .8, .17, .55, 0x9c3e3e);
    part('raider', .29, 1.75, .3, .18, .4, .08, 0xb24b44);
    part('raider', 0, 1.06, .01, .86, .14, .5, 0x3e2d26);
    part('raider', 0, 1.06, .29, .17, .15, .06, 0xd2a65c);
    part('raider', 0, .39, 0, .76, .72, .68, 0x7a9b86, raider.head);
    part('raider', 0, .75, 0, .84, .15, .73, 0x9c3e3e, raider.head);
    part('raider', -.22, .43, .36, .24, .19, .06, 0x1d2c32, raider.head);
    part('raider', .22, .44, .37, .12, .1, .05, 0xffd283, raider.head, true);
    part('raider', 0, .14, .35, .47, .12, .08, 0x354e49, raider.head);
    raider.legs.forEach(joints => {
      part('raider', 0, -.24, 0, .34, .5, .38, 0x313e4b, joints[0]);
      part('raider', 0, -.25, 0, .32, .48, .35, 0x263540, joints[1]);
      part('raider', 0, -.5, .09, .39, .22, .53, 0x352c29, joints[1]);
    });
    raider.arms.forEach((joints, i) => {
      part('raider', 0, -.23, 0, .32, .47, .39, 0x243f51, joints[0]);
      part('raider', 0, -.25, 0, .27, .48, .32, 0x7a9b86, joints[1]);
      part('raider', 0, -.53, .02, .33, .18, .36, 0x668675, joints[1]);
      if (i) {
        part('raider', 0, -.65, .06, .13, .32, .14, 0x49322b, joints[1]);
        part('raider', 0, -.77, .06, .4, .1, .17, 0xd5b56f, joints[1]);
        part('raider', 0, -1.12, .06, .14, .65, .09, 0xc0d5d6, joints[1]);
      }
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

    // The wave-7 Boss reuses the brute's hulking articulation, recoated in char
    // with a molten chest core and eyes that burn red. Joint ids are copied so
    // poseJoints poses the clone independently of the original stone brute.
    models.brute.joints.forEach(function (joint) {
      models.boss.joints.push({ id: joint.id, kind: joint.kind, parent: joint.parent, x: joint.x, y: joint.y, z: joint.z,
        side: joint.side, index: joint.index, rx: 0, ry: 0, rz: 0 });
    });
    models.brute.parts.forEach(function (part) {
      models.boss.parts.push({ x: part.x, y: part.y, z: part.z, sx: part.sx, sy: part.sy, sz: part.sz,
        tint: part.glow ? 0xff2517 : 0x241d16, joint: part.joint, glow: part.glow, rx: part.rx, ry: part.ry, rz: part.rz });
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

    // Cinderwing: a flying kiln-moth with stained ember panels and forked tails.
    const kiln = joint('cinderwing', 'flightBody', 0, 0, .65, 0);
    part('cinderwing', 0, 0, 0, .62, .7, 1.05, 0x302b40, kiln);
    part('cinderwing', 0, -.12, .2, .4, .42, .64, 0xfba35d, kiln, true);
    part('cinderwing', 0, .25, -.1, .46, .18, .85, 0x68536b, kiln);
    for (const side of [-1, 1]) {
      part('cinderwing', side * .3, -.08, .18, .12, .58, .72, 0x48374a, kiln).rz = side * .18;
      part('cinderwing', side * .18, .16, .57, .14, .12, .08, 0xffebad, kiln, true);
      part('cinderwing', side * .21, .48, .45, .09, .5, .1, 0xc48a65, kiln).rz = -side * .35;
      part('cinderwing', side * .3, .69, .45, .14, .12, .13, 0xffc678, kiln, true);
      const wing = joint('cinderwing', 'flightWing', kiln, side * .3, .15, .05, side);
      part('cinderwing', side * .55, 0, 0, 1.15, .12, 1.05, 0x8c535f, wing).ry = side * .18;
      part('cinderwing', side * .55, .075, .3, 1.2, .09, .12, 0xdca06d, wing).ry = side * .18;
      part('cinderwing', side * .56, .07, -.05, .4, .07, .55, 0xffb969, wing, true);
      const tip = joint('cinderwing', 'flightTip', wing, side * 1.05, 0, -.13, side);
      part('cinderwing', side * .36, 0, -.12, .78, .1, .72, 0x47364f, tip).ry = -side * .3;
      part('cinderwing', side * .35, .06, -.11, .51, .06, .38, 0xba7364, tip).ry = -side * .3;
      const tail = joint('cinderwing', 'flightTail', kiln, side * .2, -.12, -.48, side);
      part('cinderwing', 0, -.08, -.37, .14, .14, .85, 0x9b6867, tail);
      part('cinderwing', 0, -.08, -.82, .23, .16, .26, 0xffbd72, tail, true);
      part('cinderwing', side * .2, -.44, .32, .09, .33, .12, 0xcca17e, kiln).rx = -.4;
    }

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
    return { models: models, maxParts: maxParts, maxJoints: maxJoints };
  }
  M.enemyModels = { create: create, geometry: beveledVoxelGeometry };
})(window.Meadow = window.Meadow || {});
