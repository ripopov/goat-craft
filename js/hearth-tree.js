(function (M) {
  'use strict';

  // A hand-shaped landmark, built on a half-metre voxel lattice. Only exposed
  // faces are uploaded: thousands of small voxels become two static meshes.
  const VOXEL = 0.5;
  const X = M.config.startingArea.x;
  const Z = M.config.startingArea.z;
  const YAW = 0.32;
  const COS = Math.cos(YAW);
  const SIN = Math.sin(YAW);
  const cells = new Map();
  const columns = new Map();
  const palette = [
    0x463025, 0x563a29, 0x62432e, 0x735036, 0x815d3d, 0x956e48,
    0x254c35, 0x315d39, 0x3d7040, 0x4f8245, 0x64944b, 0x7ca752,
    0x9ab65e, 0xb6c76e, 0xcbd383, 0x647348, 0x8b8c72, 0xaaa58a,
    0x31251f, 0xff9c36, 0xffc35b, 0xffe6a2
  ].map(function (hex) { return new THREE.Color(hex); });
  let group = null;
  let health = 100;
  let damageFlash = 0;
  let baseY = 0;
  let heartMaterial = null;
  let light = null;
  let motes = null;
  const moteSeeds = [];
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const local = { x: 0, z: 0 };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function noise(x, y, z) {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function key(x, y, z) { return x + ',' + y + ',' + z; }

  function put(x, y, z, color, kind) {
    cells.set(key(x, y, z), { x: x, y: y, z: z, color: color, kind: kind || 'wood' });
  }

  function toLocal(x, z) {
    const dx = x - X;
    const dz = z - Z;
    local.x = COS * dx - SIN * dz;
    local.z = SIN * dx + COS * dz;
    return local;
  }

  function groundAt(x, z) {
    return M.world.surfaceHeight(X + COS * x + SIN * z, Z - SIN * x + COS * z) - baseY;
  }

  // Swept, tapered branches remain axis-aligned voxels, including the forks.
  function limb(a, b, ra, rb) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const steps = Math.ceil(length / 0.23);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = a[0] + (b[0] - a[0]) * t;
      const cy = a[1] + (b[1] - a[1]) * t;
      const cz = a[2] + (b[2] - a[2]) * t;
      const r = ra + (rb - ra) * t;
      for (let x = Math.floor((cx - r) / VOXEL); x <= Math.ceil((cx + r) / VOXEL); x++) {
        for (let y = Math.floor((cy - r) / VOXEL); y <= Math.ceil((cy + r) / VOXEL); y++) {
          for (let z = Math.floor((cz - r) / VOXEL); z <= Math.ceil((cz + r) / VOXEL); z++) {
            const d = Math.hypot((x + 0.5) * VOXEL - cx, (y + 0.5) * VOXEL - cy, (z + 0.5) * VOXEL - cz);
            if (d > r) continue;
            // Long vertical grain with occasional lighter bark scars.
            const grain = noise(x, Math.floor(y / 5), z);
            const shade = Math.min(5, Math.floor(grain * 5) + (noise(x, y, z) > 0.9 ? 1 : 0));
            put(x, y, z, shade);
          }
        }
      }
    }
  }

  function crown(cx, cy, cz, rx, ry, rz, golden) {
    for (let x = Math.floor((cx - rx - 0.5) / VOXEL); x <= Math.ceil((cx + rx + 0.5) / VOXEL); x++) {
      for (let y = Math.floor((cy - ry - 0.5) / VOXEL); y <= Math.ceil((cy + ry + 0.5) / VOXEL); y++) {
        for (let z = Math.floor((cz - rz - 0.5) / VOXEL); z <= Math.ceil((cz + rz + 0.5) / VOXEL); z++) {
          const dx = ((x + 0.5) * VOXEL - cx) / rx;
          const dy = ((y + 0.5) * VOXEL - cy) / ry;
          const dz = ((z + 0.5) * VOXEL - cz) / rz;
          const n = noise(Math.floor(x / 2), Math.floor(y / 2), Math.floor(z / 2));
          if (dx * dx + dy * dy + dz * dz > 0.9 + n * 0.23) continue;
          if (cells.has(key(x, y, z))) continue;
          if (noise(x, y, z) > 0.985) continue;
          // Dark underside, fresh lime tips, small gold patches on the crown.
          const shade = Math.max(0, Math.min(7, Math.floor((dy + 1) * 1.7 + n * 2 + golden)));
          put(x, y, z, 6 + shade, 'leaves');
        }
      }
    }
  }

  function shapeTree() {
    limb([0, -2.5, 0], [0.2, 4.5, -0.15], 2.15, 1.5);
    limb([0.2, 4.5, -0.15], [-0.65, 8.3, -0.5], 1.5, 1.1);
    limb([-0.65, 8.3, -0.5], [0.2, 13.5, -1], 1.1, 0.45);
    const branches = [
      [[0, 5.5, 0], [-3.7, 8.9, 0.4], [-7, 10.4, 0.9]],
      [[0, 6.1, 0], [3.4, 8.2, 0.7], [6.3, 11, 1.2]],
      [[-0.3, 7.8, -0.3], [-2.5, 10.4, -3.5], [-4.2, 12.2, -5]],
      [[-0.4, 8, -0.4], [3, 10.7, -3.2], [4.4, 13, -4.1]],
      [[-0.5, 8.2, 0], [-1.4, 10.5, 3.4], [-1.8, 12.4, 5.3]]
    ];
    branches.forEach(function (b) {
      limb(b[0], b[1], 0.95, 0.58);
      limb(b[1], b[2], 0.58, 0.18);
    });

    // Buttress roots follow the actual bank, rather than floating over steps.
    for (let i = 0; i < 9; i++) {
      const angle = i * Math.PI * 2 / 9 + 0.15;
      const reach = 5.3 + noise(i, 2, 1) * 1.5;
      const ex = Math.cos(angle) * reach;
      const ez = Math.sin(angle) * reach;
      limb([Math.cos(angle), 1.4, Math.sin(angle)], [ex * 0.57, groundAt(ex * 0.57, ez * 0.57) + 0.15, ez * 0.57], 0.9, 0.6);
      limb([ex * 0.57, groundAt(ex * 0.57, ez * 0.57) + 0.15, ez * 0.57], [ex, groundAt(ex, ez) - 0.22, ez], 0.6, 0.18);
    }

    // Open the hollow toward spawn; the heart is recessed inside its arch.
    cells.forEach(function (v, k) {
      const x = (v.x + 0.5) * VOXEL;
      const y = (v.y + 0.5) * VOXEL;
      const z = (v.z + 0.5) * VOXEL;
      const width = y > 4.25 ? 0.55 : 1.05;
      if (Math.abs(x) < width && y > 1.5 && y < 4.9 && z > 0.25) cells.delete(k);
      else if (z > 0 && z < 0.65 && Math.abs(x) < 1.1 && y > 1.5 && y < 4.9) v.color = 18;
    });

    // Moss grows on upward-facing roots and the damp side of the trunk.
    cells.forEach(function (v) {
      if (v.kind !== 'wood') return;
      const y = (v.y + 1) * VOXEL;
      if (y < 2.25 && !cells.has(key(v.x, v.y + 1, v.z)) && noise(v.x, 5, v.z) > 0.33) v.color = 8 + Math.floor(noise(v.x, 7, v.z) * 3);
    });

    // Separate overlapping lobes give the oak an asymmetric, spreading crown.
    [
      [-6.4, 11.7, 0.7, 3.9, 2.6, 3.5, 0],
      [5.8, 12.3, 1.2, 3.8, 2.8, 3.7, 0],
      [-3.9, 13.6, -4.3, 4.1, 2.8, 3.3, 0.3],
      [3.5, 14.3, -3.6, 4, 2.9, 3.7, 0.5],
      [-1.4, 13.7, 4.3, 4.4, 2.7, 3.3, 0.2],
      [-1, 16, -0.3, 4.4, 3, 4.1, 1]
    ].forEach(function (c) { crown.apply(null, c); });

    // The same voxel columns drive rendering and collision, even after chunks
    // stream away. The half-metre roots can be walked and jumped onto.
    cells.forEach(function (v) {
      const k = v.x + ',' + v.z;
      if (!columns.has(k)) columns.set(k, []);
      columns.get(k).push(v.y);
    });
    columns.forEach(function (ys) { ys.sort(function (a, b) { return b - a; }); });
  }

  const faces = [
    { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.84 },
    { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.73 },
    { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1 },
    { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.56 },
    { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.92 },
    { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.77 }
  ];

  function buildMesh(kind, material) {
    const p = [], n = [], c = [], uv = [], indices = [];
    cells.forEach(function (v) {
      if (v.kind !== kind) return;
      faces.forEach(function (face) {
        if (cells.has(key(v.x + face.d[0], v.y + face.d[1], v.z + face.d[2]))) return;
        // The flat, protected foundation covers everything at or below the
        // tree's origin. In particular, buried root caps at y = 0 would share
        // the lawn's exact plane and flicker against its grass. Keep these
        // voxels for collision, but don't upload their covered faces.
        if (face.c.every(function (corner) { return v.y + corner[1] <= 0; })) return;
        const offset = p.length / 3;
        face.c.forEach(function (corner, i) {
          p.push((v.x + corner[0]) * VOXEL, (v.y + corner[1]) * VOXEL, (v.z + corner[2]) * VOXEL);
          n.push(face.d[0], face.d[1], face.d[2]);
          uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
          // Small contact shadows where adjacent voxel steps meet this face.
          let occlusion = 0;
          for (let axis = 0; axis < 3; axis++) {
            if (face.d[axis]) continue;
            const adjacent = [v.x + face.d[0], v.y + face.d[1], v.z + face.d[2]];
            adjacent[axis] += corner[axis] ? 1 : -1;
            if (cells.has(key(adjacent[0], adjacent[1], adjacent[2]))) occlusion++;
          }
          const shade = face.shade * (1 - occlusion * 0.13);
          const color = palette[v.color];
          c.push(color.r * shade, color.g * shade, color.b * shade);
        });
        indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
      });
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Hearth Tree ' + kind;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  function surfaceTexture(leaves) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const grain = noise(x, leaves ? y : Math.floor(y / 9), 11);
        const fine = noise(x, y, 12);
        const value = leaves ? 222 + Math.floor(grain * 33) :
          (grain < 0.14 ? 177 : 224) + Math.floor(fine * 30);
        ctx.fillStyle = 'rgb(' + value + ',' + value + ',' + value + ')';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestMipmapLinearFilter;
    texture.encoding = THREE.sRGBEncoding;
    return texture;
  }

  // Small details share an instanced unit cube; no per-voxel scene objects.
  function details() {
    const blocks = [];
    function box(x, y, z, sx, sy, sz, color, glow) {
      blocks.push({ x: x, y: y, z: z, sx: sx, sy: sy, sz: sz, color: color, glow: !!glow });
    }

    const heart = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
    heart.forEach(function (row, y) {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '0') continue;
        box((x - 3) * 0.27, 4.12 - y * 0.27, 0.97, 0.27, 0.27, 0.34, y < 2 && x < 4 ? 21 : 20, true);
      }
    });
    // Thin golden sap seams climb the trunk out of the heart hollow.
    [[-1.25, 2.5, 1.45], [-1.5, 2.9, 1.25], [-1.5, 3.35, 1.25],
      [0.75, 5, 1.25], [0.5, 5.4, 1.25], [0.5, 5.85, 1.25], [0.25, 6.3, 1.25]
    ].forEach(function (p) { box(p[0], p[1], p[2], 0.1, 0.44, 0.12, 19, true); });

    // Two warm lanterns under the low boughs, with stepped copper roofs.
    [[-4.2, 7.3, 1.5], [4, 7, 1.5]].forEach(function (p) {
      const x = p[0], y = p[1], z = p[2];
      box(x, y + 0.52, z, 0.065, 1.1, 0.065, 2);
      box(x, y - 0.22, z, 0.42, 0.56, 0.42, 21, true);
      box(x, y + 0.14, z, 0.7, 0.14, 0.7, 4);
      box(x, y + 0.28, z, 0.42, 0.14, 0.42, 5);
      box(x, y - 0.56, z, 0.64, 0.13, 0.64, 3);
      for (const dx of [-0.25, 0.25]) {
        for (const dz of [-0.25, 0.25]) box(x + dx, y - 0.22, z + dz, 0.07, 0.6, 0.07, 2);
      }
    });

    // Little shelf fungi give the roots a sense of age and scale.
    [[-2, 0.9, 0.4], [1.7, 1.1, -0.9], [-1.8, 0.45, 1.2]].forEach(function (p) {
      box(p[0], p[1], p[2], 0.7, 0.13, 0.45, 17);
      box(p[0], p[1] + 0.1, p[2], 0.5, 0.09, 0.35, 5);
    });

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    [false, true].forEach(function (glow) {
      const subset = blocks.filter(function (b) { return b.glow === glow; });
      const material = glow ? heartMaterial : M.std(0xffffff, 0.86);
      const mesh = new THREE.InstancedMesh(geometry, material, subset.length);
      mesh.name = glow ? 'Hearth Tree amber heart and lanterns' : 'Hearth Tree fine details';
      subset.forEach(function (b, i) {
        position.set(b.x, b.y, b.z);
        scale.set(b.sx, b.sy, b.sz);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, palette[b.color]);
      });
      mesh.castShadow = !glow;
      mesh.receiveShadow = !glow;
      group.add(mesh);
    });

    motes = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffd88a, toneMapped: false }), M.config.coarsePointer ? 18 : 32);
    motes.name = 'Hearth Tree drifting embers';
    motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instances move outside their initial unit-cube bounds.
    motes.frustumCulled = false;
    for (let i = 0; i < motes.count; i++) moteSeeds.push({ angle: noise(i, 8, 1) * Math.PI * 2, radius: 2 + noise(i, 9, 2) * 5, phase: noise(i, 3, 8), size: 0.035 + noise(i, 5, 2) * 0.045 });
    group.add(motes);
  }

  function init(scene) {
    if (group) return;
    baseY = M.world.surfaceHeight(X, Z);
    group = new THREE.Group();
    group.name = 'Hearth Tree';
    group.position.set(X, baseY, Z);
    group.rotation.y = YAW;
    shapeTree();
    buildMesh('wood', M.std(0xffffff, 0.96, { vertexColors: true, map: surfaceTexture(false) }));
    buildMesh('leaves', M.std(0xffffff, 0.9, { vertexColors: true, map: surfaceTexture(true) }));
    heartMaterial = M.std(0xffffff, 0.45, { emissive: 0xff8b26, emissiveIntensity: 0.9 });
    // Preserve the individual golden voxels inside the emissive heart.
    heartMaterial.onBeforeCompile = function (shader) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance *= vColor;\n#endif');
    };
    heartMaterial.customProgramCacheKey = function () { return 'hearth-amber-voxels'; };
    details();
    light = new THREE.PointLight(0xffb34e, 2.8, 13, 2);
    light.position.set(0, 3.2, 2.1);
    group.add(light);
    scene.add(group);
    M.hearthTree.group = group;
    update(0, 0);
  }

  function update(dt, time) {
    if (!group) return;
    damageFlash = Math.max(0, damageFlash - dt);
    const vitality = 0.18 + 0.82 * health / 100;
    const t = reducedMotion ? 0 : time;
    const pulse = Math.sin(t * 1.35) * 0.09 + Math.sin(t * 0.57) * 0.04;
    heartMaterial.emissiveIntensity = (0.9 + pulse) * vitality + damageFlash;
    light.intensity = (2.8 + pulse * 1.5) * vitality;
    moteSeeds.forEach(function (seed, i) {
      const phase = (seed.phase + t * 0.035) % 1;
      const angle = seed.angle + t * 0.07;
      position.set(Math.cos(angle) * seed.radius, 1 + phase * 8, Math.sin(angle) * seed.radius);
      const size = seed.size * Math.sin(phase * Math.PI);
      scale.setScalar(size);
      matrix.compose(position, rotation, scale);
      motes.setMatrixAt(i, matrix);
    });
    motes.instanceMatrix.needsUpdate = true;
  }

  function columnAt(x, z) {
    if (!group || Math.abs(x - X) > 15 || Math.abs(z - Z) > 15) return null;
    const p = toLocal(x, z);
    return columns.get(Math.floor(p.x / VOXEL) + ',' + Math.floor(p.z / VOXEL));
  }

  function blockedAt(x, z, minY, maxY) {
    const ys = columnAt(x, z);
    if (!ys) return false;
    return ys.some(function (y) { return baseY + y * VOXEL < maxY - 0.001 && baseY + (y + 1) * VOXEL > minY + 0.001; });
  }

  function supportHeight(x, z, maxY) {
    const ys = columnAt(x, z);
    if (!ys) return 0;
    for (let i = 0; i < ys.length; i++) {
      const top = baseY + (ys[i] + 1) * VOXEL;
      if (top <= maxY + 0.001) return top;
    }
    return 0;
  }

  function boxColumns(x, z, radius, visit) {
    if (!group || Math.abs(x - X) > 15 + radius || Math.abs(z - Z) > 15 + radius) return false;
    const p = toLocal(x, z), lx = p.x, lz = p.z;
    const reach = radius * (COS + SIN), half = VOXEL / 2, epsilon = 0.00001;
    for (let vx = Math.floor((lx - reach) / VOXEL); vx <= Math.floor((lx + reach) / VOXEL); vx++) {
      for (let vz = Math.floor((lz - reach) / VOXEL); vz <= Math.floor((lz + reach) / VOXEL); vz++) {
        const ys = columns.get(vx + ',' + vz);
        if (!ys) continue;
        const cx = (vx + 0.5) * VOXEL, cz = (vz + 0.5) * VOXEL;
        const dx = X + COS * cx + SIN * cz - x, dz = Z - SIN * cx + COS * cz - z;
        // Separating axes of the world-aligned actor and rotated tree voxel.
        if (Math.abs(dx) >= radius + half * (COS + SIN) - epsilon ||
            Math.abs(dz) >= radius + half * (COS + SIN) - epsilon ||
            Math.abs(COS * dx - SIN * dz) >= half + reach - epsilon ||
            Math.abs(SIN * dx + COS * dz) >= half + reach - epsilon) continue;
        if (visit(ys)) return true;
      }
    }
    return false;
  }

  function intersectsBox(x, z, radius, minY, maxY) {
    return boxColumns(x, z, radius, function (ys) {
      return ys.some(function (y) { return baseY + y * VOXEL < maxY - 0.00001 && baseY + (y + 1) * VOXEL > minY + 0.00001; });
    });
  }

  function boxSupportHeight(x, z, radius, maxY) {
    let floor = 0;
    boxColumns(x, z, radius, function (ys) {
      for (let i = 0; i < ys.length; i++) {
        const top = baseY + (ys[i] + 1) * VOXEL;
        if (top <= maxY + 0.00001) { floor = Math.max(floor, top); break; }
      }
      return false;
    });
    return floor;
  }

  // Conservative block/voxel overlap for placement. Checking every voxel
  // centre plus its rotated AABB avoids building through thin diagonal roots.
  function intersectsBlock(bx, by, bz) {
    if (!group) return false;
    const bs = M.world.blockSize;
    const wx = (bx + 0.5) * bs, wz = (bz + 0.5) * bs;
    if (Math.abs(wx - X) > 16 || Math.abs(wz - Z) > 16) return false;
    const p = toLocal(wx, wz);
    const reach = (bs * 0.5 + VOXEL * 0.5) * (COS + SIN);
    const minY = Math.floor((by * bs - baseY) / VOXEL);
    const maxY = Math.ceil(((by + 1) * bs - baseY) / VOXEL) - 1;
    for (let x = Math.floor((p.x - reach) / VOXEL); x <= Math.floor((p.x + reach) / VOXEL); x++) {
      for (let z = Math.floor((p.z - reach) / VOXEL); z <= Math.floor((p.z + reach) / VOXEL); z++) {
        const ys = columns.get(x + ',' + z);
        if (ys && ys.some(function (y) { return y >= minY && y <= maxY; })) return true;
      }
    }
    return false;
  }

  M.hearthTree = {
    init: init, update: update, blockedAt: blockedAt, supportHeight: supportHeight,
    intersectsBox: intersectsBox, boxSupportHeight: boxSupportHeight,
    intersectsBlock: intersectsBlock,
    isReserved: function (x, z, margin) { return Math.hypot(x - X, z - Z) < 7.5 + (margin || 0); },
    damage: function (amount) {
      if (!Number.isFinite(amount) || amount <= 0) return;
      if (health > 0 && M.audio && M.audio.cue) M.audio.cue(health <= amount ? 'defeat' : 'damage');
      health = Math.max(0, health - amount); damageFlash = reducedMotion ? 0 : 0.35;
    },
    get health() { return health; }, maxHealth: 100,
    position: { x: X, z: Z }, group: null
  };
})(window.Meadow = window.Meadow || {});
