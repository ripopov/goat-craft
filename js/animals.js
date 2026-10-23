(function (M) {
  'use strict';

  const { clamp, rand, damp, turnToward } = M.utils;
  const BLOCK = 2;
  const GRAVITY = 24;
  const BODY_CLEARANCE = 0.06;
  const MAX_GRASS_BITS = 48;

  // ------------------------------------------------------------------------
  // Species
  // ------------------------------------------------------------------------
  // Every NPC has a pair of horns (or antlers) and a small carry anchor
  // between them, so a picked-up block can ride exactly like the player's.
  const SPECIES = {
    sheep: {
      label: 'sheep',
      scale: 0.9,
      bodyHeight: 1.52,
      walkSpeed: 1.05,
      footprint: [[0, 1.12], [0.2, 0.9], [-0.2, 0.9], [0.38, 0.5], [-0.38, 0.5], [0.46, 0], [-0.46, 0]],
      neckBase: 0.36,
      headBase: -0.12,
      grazeNeck: 1.12,
      grazeHead: 0.66,
      grazeDrop: 0.22,
      lungeNeck: 0.58,
      carry: { y: 0.5, z: -0.01, scale: 0.2, rot: 0.58 },
      wool: 0xeee7d4,
      woolDark: 0xd8ceb7,
      face: 0x403a33,
      ear: 0xd1c5ae,
      innerEar: 0xdca9a1,
      horn: 0xcab68c,
      leg: 0x433d35,
      hoof: 0x2e2924,
      muzzle: 0x4d4640,
      nose: 0x2a2420,
      sclera: 0xe7d39b,
      pupil: 0x241d16,
      tail: 'puff'
    },
    cow: {
      label: 'cow',
      scale: 1.06,
      bodyHeight: 1.95,
      walkSpeed: 0.9,
      footprint: [[0, 1.2], [0.24, 0.98], [-0.24, 0.98], [0.43, 0.56], [-0.43, 0.56], [0.52, 0], [-0.52, 0]],
      neckBase: 0.3,
      headBase: -0.18,
      grazeNeck: 1.18,
      grazeHead: 0.72,
      grazeDrop: 0.28,
      lungeNeck: 0.6,
      carry: { y: 0.55, z: -0.03, scale: 0.22, rot: 0.58 },
      hide: 'cow',
      face: 0xf0e4cf,
      ear: 0x9a6848,
      innerEar: 0xd9a19a,
      horn: 0xddd0b8,
      leg: 0xe7dcc7,
      hoof: 0x3d342c,
      muzzle: 0xd99b99,
      nose: 0x8d5d5b,
      sclera: 0xead8a5,
      pupil: 0x241b14,
      tail: 'long'
    },
    stag: {
      label: 'stag',
      scale: 1.0,
      bodyHeight: 1.92,
      walkSpeed: 1.16,
      footprint: [[0, 1.14], [0.2, 0.92], [-0.2, 0.92], [0.38, 0.5], [-0.38, 0.5], [0.46, 0], [-0.46, 0]],
      neckBase: 0.27,
      headBase: -0.14,
      grazeNeck: 1.2,
      grazeHead: 0.72,
      grazeDrop: 0.24,
      lungeNeck: 0.6,
      carry: { y: 0.6, z: -0.05, scale: 0.2, rot: 0.55 },
      hide: 'stag',
      face: 0xb8875b,
      ear: 0xb8875b,
      innerEar: 0xe0b0a2,
      horn: 0xd8c5a2,
      leg: 0xa97850,
      hoof: 0x3c3026,
      muzzle: 0xc69b72,
      nose: 0x3a2b22,
      sclera: 0xe2ca95,
      pupil: 0x211a13,
      tail: 'deer'
    }
  };

  // ------------------------------------------------------------------------
  // Small scene helpers
  // ------------------------------------------------------------------------
  const SPHERE = new THREE.SphereGeometry(1, 16, 12);
  let cowHideTex = null;
  let stagHideTex = null;
  const hornGeoCache = Object.create(null);

  function shadowed(mesh, casts) {
    mesh.castShadow = casts !== false;
    mesh.receiveShadow = true;
    return mesh;
  }

  function ellipsoid(mat, rx, ry, rz) {
    const mesh = new THREE.Mesh(SPHERE, mat);
    mesh.scale.set(rx, ry, rz);
    return shadowed(mesh);
  }

  function makeHideTexture(kind) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');

    if (kind === 'cow') {
      ctx.fillStyle = '#e8dcc5';
      ctx.fillRect(0, 0, 256, 256);
      const blobs = [
        [42, 66, 38, 30, -0.3],
        [194, 45, 46, 34, 0.4],
        [218, 150, 42, 36, -0.5],
        [92, 214, 54, 31, 0.25],
        [25, 158, 24, 28, 0.1],
        [150, 96, 31, 23, 0.7]
      ];
      ctx.fillStyle = 'rgba(103, 64, 39, 0.92)';
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        ctx.save();
        ctx.translate(b[0], b[1]);
        ctx.rotate(b[4]);
        ctx.beginPath();
        ctx.ellipse(0, 0, b[2], b[3], 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(255, 250, 235, 0.18)';
      for (let i = 0; i < 80; i++) ctx.fillRect((Math.random() * 256) | 0, (Math.random() * 256) | 0, 1, 1);
    } else {
      ctx.fillStyle = '#b78758';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = 'rgba(235, 218, 184, 0.48)';
      for (let i = 0; i < 48; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const r = rand(2, 6);
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * rand(0.55, 1.1), Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(84, 53, 33, 0.18)';
      for (let i = 0; i < 120; i++) ctx.fillRect((Math.random() * 256) | 0, (Math.random() * 256) | 0, 1, 1);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
  }

  function makeMaterials(speciesName, variant) {
    const def = SPECIES[speciesName];
    const mats = {};
    const v = variant || {};

    if (speciesName === 'sheep') {
      const wool = v.wool || def.wool;
      const face = v.face || def.face;
      mats.wool = M.std(wool, 0.97);
      mats.woolShade = M.std(v.woolDark || def.woolDark, 0.98);
      mats.face = M.std(face, 0.94);
      mats.ear = M.std(v.ear || def.ear, 0.95);
      mats.muzzle = M.std(v.muzzle || def.muzzle, 0.93);
      mats.nose = M.std(def.nose, 0.62);
    } else {
      if (!cowHideTex) cowHideTex = makeHideTexture('cow');
      if (!stagHideTex) stagHideTex = makeHideTexture('stag');
      mats.hide = M.std(0xffffff, 0.94, { map: speciesName === 'cow' ? cowHideTex : stagHideTex });
      mats.face = M.std(def.face, 0.93);
      mats.ear = M.std(def.ear, 0.94);
      mats.muzzle = M.std(def.muzzle, 0.84);
      mats.nose = M.std(def.nose, 0.62);
    }

    mats.innerEar = M.std(def.innerEar, 0.92);
    mats.horn = M.std(def.horn, 0.66);
    mats.leg = M.std(def.leg, 0.94);
    mats.hoof = M.std(def.hoof, 0.7);
    mats.sclera = M.std(def.sclera, 0.4);
    mats.pupil = M.std(def.pupil, 0.28);
    mats.glint = M.std(0xfff4d2, 0.35);
    mats.collar = M.std(0x8b553c, 0.8);
    mats.bell = M.std(0xd7a94d, 0.38, { metalness: 0.3 });
    return mats;
  }

  // Tapered tube used for curled horns and antlers. Catmull-Rom keeps the
  // silhouettes organic while still matching the low-poly meadow.
  function taperTube(points, startRadius, endRadius, segments, radial) {
    const curve = new THREE.CatmullRomCurve3(points.map(function (p) {
      return new THREE.Vector3(p[0], p[1], p[2]);
    }));
    const segs = segments || 18;
    const around = radial || 6;
    const frames = curve.computeFrenetFrames(segs, false);
    const positions = [];
    const indices = [];

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = curve.getPointAt(t);
      const n = frames.normals[i];
      const b = frames.binormals[i];
      const radius = THREE.MathUtils.lerp(startRadius, endRadius, Math.pow(t, 0.76));
      for (let j = 0; j < around; j++) {
        const a = (j / around) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        positions.push(
          p.x + (n.x * ca + b.x * sa) * radius,
          p.y + (n.y * ca + b.y * sa) * radius,
          p.z + (n.z * ca + b.z * sa) * radius
        );
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < around; j++) {
        const a = i * around + j;
        const b = i * around + (j + 1) % around;
        const c = (i + 1) * around + (j + 1) % around;
        const d = (i + 1) * around + j;
        indices.push(a, b, d, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function hornGeometry(speciesName, sign) {
    const key = speciesName + ':' + sign;
    if (hornGeoCache[key]) return hornGeoCache[key];

    let points;
    let start = 0.045;
    let end = 0.009;
    if (speciesName === 'sheep') {
      points = [
        [sign * 0.14, 0.16, 0.02],
        [sign * 0.23, 0.23, -0.03],
        [sign * 0.29, 0.19, -0.15],
        [sign * 0.27, 0.08, -0.24],
        [sign * 0.19, 0.0, -0.22],
        [sign * 0.14, 0.02, -0.1]
      ];
    } else if (speciesName === 'cow') {
      points = [
        [sign * 0.14, 0.17, 0.0],
        [sign * 0.22, 0.24, -0.01],
        [sign * 0.29, 0.33, -0.04],
        [sign * 0.33, 0.42, -0.09]
      ];
      start = 0.038;
      end = 0.012;
    } else {
      points = [
        [sign * 0.11, 0.18, 0.02],
        [sign * 0.2, 0.32, -0.05],
        [sign * 0.27, 0.48, -0.16],
        [sign * 0.29, 0.62, -0.28]
      ];
      start = 0.027;
      end = 0.009;
    }

    const geo = taperTube(points, start, end, 18, 6);
    hornGeoCache[key] = geo;
    return geo;
  }

  function addHorn(head, mats, speciesName, sign) {
    const mesh = new THREE.Mesh(hornGeometry(speciesName, sign), mats.horn);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    head.add(mesh);
  }

  function addStagAntlers(head, mats) {
    for (let sign = -1; sign <= 1; sign += 2) {
      const main = taperTube([
        [sign * 0.1, 0.18, 0.02],
        [sign * 0.17, 0.33, -0.05],
        [sign * 0.24, 0.49, -0.15],
        [sign * 0.29, 0.65, -0.28]
      ], 0.031, 0.008, 17, 5);
      const tineA = taperTube([
        [sign * 0.17, 0.33, -0.05],
        [sign * 0.22, 0.42, 0.04],
        [sign * 0.24, 0.53, 0.1]
      ], 0.018, 0.005, 10, 5);
      const tineB = taperTube([
        [sign * 0.24, 0.49, -0.15],
        [sign * 0.35, 0.55, -0.17],
        [sign * 0.39, 0.64, -0.22]
      ], 0.016, 0.005, 10, 5);

      const group = new THREE.Group();
      const beam = new THREE.Mesh(main, mats.horn);
      beam.castShadow = true;
      beam.receiveShadow = true;
      group.add(beam);
      const a = new THREE.Mesh(tineA, mats.horn);
      a.castShadow = true;
      group.add(a);
      const b = new THREE.Mesh(tineB, mats.horn);
      b.castShadow = true;
      group.add(b);
      head.add(group);
    }
  }

  function addEyes(head, mats, opts) {
    const eyes = [];
    const x = opts.x;
    const y = opts.y;
    const z = opts.z;
    const size = opts.size || 1;
    [-1, 1].forEach(function (sign) {
      const eye = new THREE.Group();
      eye.position.set(sign * x, y, z);
      eye.rotation.y = sign * 0.62;

      const ball = ellipsoid(mats.sclera, 0.072 * size, 0.088 * size, 0.05 * size);
      ball.castShadow = false;
      ball.receiveShadow = false;
      eye.add(ball);

      const pupil = ellipsoid(mats.pupil, 0.046 * size, 0.02 * size, 0.014 * size);
      pupil.position.set(0, 0.002, 0.044 * size);
      pupil.castShadow = false;
      pupil.receiveShadow = false;
      eye.add(pupil);

      const glint = ellipsoid(mats.glint, 0.012 * size, 0.012 * size, 0.008 * size);
      glint.position.set(0.017 * size, 0.028 * size, 0.049 * size);
      glint.castShadow = false;
      glint.receiveShadow = false;
      eye.add(glint);

      head.add(eye);
      eyes.push(eye);
    });
    return eyes;
  }

  function addEars(head, mats, def, opts) {
    const ears = [];
    [-1, 1].forEach(function (sign) {
      const pivot = new THREE.Group();
      pivot.position.set(sign * opts.x, opts.y, opts.z);
      const baseZ = -sign * opts.droop;
      pivot.rotation.z = baseZ;
      pivot.rotation.x = opts.tilt || 0.08;

      const ear = ellipsoid(mats.ear, opts.rx, opts.ry, opts.rz);
      ear.position.set(sign * opts.reach, -0.005, 0);
      pivot.add(ear);

      const inner = ellipsoid(mats.innerEar, opts.rx * 0.58, opts.ry * 0.32, opts.rz * 0.55);
      inner.position.set(sign * opts.reach, opts.ry * 0.55, 0.003);
      pivot.add(inner);

      head.add(pivot);
      ears.push({ pivot: pivot, baseZ: baseZ, side: sign });
    });
    return ears;
  }

  function addLegs(rig, mats, def, speciesName) {
    const dimensions = speciesName === 'cow'
      ? { hipY: 1.0, x: 0.27, frontZ: 0.43, backZ: -0.45, upperR: 0.086, lowerR: 0.072, upperLen: 0.27, lowerLen: 0.27 }
      : speciesName === 'stag'
        ? { hipY: 0.98, x: 0.24, frontZ: 0.42, backZ: -0.44, upperR: 0.057, lowerR: 0.046, upperLen: 0.32, lowerLen: 0.31 }
        : { hipY: 0.91, x: 0.24, frontZ: 0.4, backZ: -0.42, upperR: 0.074, lowerR: 0.062, upperLen: 0.25, lowerLen: 0.25 };

    const upperGeo = new THREE.CapsuleGeometry(dimensions.upperR, dimensions.upperLen, 4, 8);
    const lowerGeo = new THREE.CapsuleGeometry(dimensions.lowerR, dimensions.lowerLen, 4, 8);
    const hoofGeo = new THREE.CylinderGeometry(dimensions.lowerR * 1.15, dimensions.lowerR * 1.35, 0.15, 7);
    const upperTotal = dimensions.upperLen + dimensions.upperR * 2;
    const lowerTotal = dimensions.lowerLen + dimensions.lowerR * 2;
    const legs = [];

    function makeLeg(x, z, front, offset) {
      const hip = new THREE.Group();
      hip.position.set(x, dimensions.hipY, z);
      rig.add(hip);

      // The upper capsule alone ended just below the curved belly, leaving a
      // visible air gap at the top of every leg. This tapered thigh reaches up
      // into the torso and narrows into the top of the capsule, so the leg
      // grows out of the body instead of hanging below it.
      const hipGeo = new THREE.CylinderGeometry(
        dimensions.upperR * 2.15,
        dimensions.upperR * 1.02,
        0.35,
        8,
        1,
        false
      );
      const hipMass = new THREE.Mesh(hipGeo, mats.leg);
      hipMass.position.y = 0.105;
      hipMass.castShadow = true;
      hipMass.receiveShadow = true;
      hip.add(hipMass);

      const upper = new THREE.Mesh(upperGeo, mats.leg);
      upper.position.y = -upperTotal * 0.5;
      shadowed(upper);
      hip.add(upper);

      const knee = new THREE.Group();
      knee.position.y = -upperTotal;
      hip.add(knee);

      const lower = new THREE.Mesh(lowerGeo, mats.leg);
      lower.position.y = -lowerTotal * 0.5 + 0.02;
      shadowed(lower);
      knee.add(lower);

      const hoof = new THREE.Mesh(hoofGeo, mats.hoof);
      hoof.position.y = -(lowerTotal + 0.055);
      shadowed(hoof);
      knee.add(hoof);

      legs.push({ hip: hip, knee: knee, front: front, offset: offset });
    }

    makeLeg(-dimensions.x, dimensions.frontZ, true, 0);
    makeLeg(dimensions.x, dimensions.frontZ, true, Math.PI);
    makeLeg(-dimensions.x, dimensions.backZ, false, Math.PI);
    makeLeg(dimensions.x, dimensions.backZ, false, 0);
    return legs;
  }

  function addTail(rig, mats, def, speciesName) {
    const pivot = new THREE.Group();
    const tailKind = def.tail;
    if (tailKind === 'long') {
      pivot.position.set(0, 1.53, -0.88);
      pivot.rotation.x = -0.32;
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.7, 6), mats.leg);
      rope.position.y = -0.3;
      shadowed(rope);
      pivot.add(rope);
      const tuft = ellipsoid(mats.ear, 0.075, 0.15, 0.075);
      tuft.position.y = -0.7;
      pivot.add(tuft);
      const tuftLight = ellipsoid(mats.face, 0.05, 0.1, 0.05);
      tuftLight.position.set(0, -0.73, 0.02);
      pivot.add(tuftLight);
    } else if (tailKind === 'deer') {
      pivot.position.set(0, 1.46, -0.81);
      pivot.rotation.x = -0.55;
      const tail = ellipsoid(mats.face, 0.09, 0.16, 0.06);
      tail.position.y = 0.08;
      pivot.add(tail);
      const underside = ellipsoid(mats.innerEar, 0.06, 0.11, 0.035);
      underside.position.set(0, 0.07, -0.045);
      pivot.add(underside);
    } else {
      pivot.position.set(0, 1.47, -0.82);
      pivot.rotation.x = -0.62;
      const puff = ellipsoid(mats.wool, 0.14, 0.2, 0.12);
      puff.position.y = 0.1;
      pivot.add(puff);
      const puff2 = ellipsoid(mats.woolShade, 0.09, 0.13, 0.08);
      puff2.position.set(0.03, 0.2, -0.02);
      pivot.add(puff2);
    }
    pivot.userData.baseX = pivot.rotation.x;
    rig.add(pivot);
    return pivot;
  }

  function buildModel(speciesName, variant) {
    const def = SPECIES[speciesName];
    const mats = makeMaterials(speciesName, variant);
    const group = new THREE.Group();
    const rig = new THREE.Group();
    group.add(rig);

    const parts = {
      group: group,
      rig: rig,
      mats: mats,
      legs: [],
      ears: [],
      eyes: []
    };

    // ---- body ----
    if (speciesName === 'sheep') {
      const torso = ellipsoid(mats.wool, 0.42, 0.39, 0.63);
      torso.position.set(0, 1.26, -0.05);
      rig.add(torso);
      const chest = ellipsoid(mats.wool, 0.35, 0.36, 0.34);
      chest.position.set(0, 1.31, 0.39);
      rig.add(chest);
      const rump = ellipsoid(mats.wool, 0.37, 0.38, 0.34);
      rump.position.set(0, 1.27, -0.48);
      rig.add(rump);

      const puffs = [
        [0, 1.57, -0.08, 0.27, 0.2, 0.31],
        [-0.3, 1.48, -0.2, 0.2, 0.18, 0.3],
        [0.31, 1.48, -0.12, 0.19, 0.18, 0.29],
        [0, 1.51, 0.28, 0.25, 0.18, 0.23],
        [0.02, 1.46, -0.48, 0.25, 0.18, 0.23]
      ];
      for (let i = 0; i < puffs.length; i++) {
        const p = puffs[i];
        const puff = ellipsoid(i === 3 ? mats.woolShade : mats.wool, p[3], p[4], p[5]);
        puff.position.set(p[0], p[1], p[2]);
        rig.add(puff);
      }

      parts.torso = torso;
      parts.chest = chest;
    } else if (speciesName === 'cow') {
      const torso = ellipsoid(mats.hide, 0.46, 0.42, 0.68);
      torso.position.set(0, 1.35, -0.05);
      rig.add(torso);
      const chest = ellipsoid(mats.hide, 0.4, 0.39, 0.38);
      chest.position.set(0, 1.39, 0.42);
      rig.add(chest);
      const rump = ellipsoid(mats.hide, 0.42, 0.41, 0.38);
      rump.position.set(0, 1.33, -0.49);
      rig.add(rump);

      const belly = ellipsoid(mats.face, 0.32, 0.16, 0.48);
      belly.position.set(0, 1.1, -0.02);
      rig.add(belly);
      parts.torso = torso;
      parts.chest = chest;
    } else {
      const torso = ellipsoid(mats.hide, 0.38, 0.4, 0.64);
      torso.position.set(0, 1.31, -0.05);
      rig.add(torso);
      const chest = ellipsoid(mats.hide, 0.33, 0.35, 0.38);
      chest.position.set(0, 1.36, 0.43);
      rig.add(chest);
      const rump = ellipsoid(mats.hide, 0.35, 0.37, 0.36);
      rump.position.set(0, 1.3, -0.47);
      rig.add(rump);

      const belly = ellipsoid(mats.face, 0.25, 0.12, 0.44);
      belly.position.set(0, 1.08, 0.02);
      rig.add(belly);
      parts.torso = torso;
      parts.chest = chest;
    }

    // ---- neck and head ----
    const neckPivot = new THREE.Group();
    const neckY = speciesName === 'stag' ? 1.58 : speciesName === 'cow' ? 1.53 : 1.46;
    const neckZ = speciesName === 'stag' ? 0.47 : 0.46;
    const neckLen = speciesName === 'stag' ? 0.56 : speciesName === 'cow' ? 0.47 : 0.43;
    neckPivot.position.set(0, neckY, neckZ);
    neckPivot.rotation.x = def.neckBase;
    rig.add(neckPivot);

    const neckMat = speciesName === 'sheep' ? mats.wool : mats.hide;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(
      speciesName === 'stag' ? 0.14 : 0.18,
      speciesName === 'stag' ? 0.19 : 0.24,
      neckLen,
      9,
      1
    ), neckMat);
    neck.position.y = neckLen * 0.5;
    shadowed(neck);
    neckPivot.add(neck);

    if (speciesName === 'cow') {
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.025, 5, 14), mats.collar);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = neckLen * 0.25;
      shadowed(collar);
      neckPivot.add(collar);
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.06, 9, 7), mats.bell);
      bell.position.set(0, neckLen * 0.13, 0.215);
      shadowed(bell);
      neckPivot.add(bell);
      parts.bell = bell;
    }

    const headPivot = new THREE.Group();
    headPivot.position.set(0, neckLen, 0.02);
    headPivot.rotation.x = def.headBase;
    neckPivot.add(headPivot);
    parts.neckPivot = neckPivot;
    parts.neckBaseY = neckY;
    parts.neckBaseZ = neckZ;
    parts.neck = neck;
    parts.headPivot = headPivot;

    if (speciesName === 'sheep') {
      const skull = ellipsoid(mats.face, 0.2, 0.22, 0.27);
      skull.position.set(0, 0.035, 0.06);
      headPivot.add(skull);
      const muzzle = ellipsoid(mats.muzzle, 0.14, 0.105, 0.23);
      muzzle.position.set(0, -0.085, 0.31);
      headPivot.add(muzzle);
      const nose = ellipsoid(mats.nose, 0.1, 0.07, 0.06);
      nose.position.set(0, -0.03, 0.51);
      headPivot.add(nose);
      const mouth = ellipsoid(mats.nose, 0.06, 0.012, 0.018);
      mouth.position.set(0, -0.155, 0.5);
      mouth.userData.baseScaleY = mouth.scale.y;
      headPivot.add(mouth);
      parts.mouth = mouth;

      const poll = ellipsoid(mats.wool, 0.15, 0.12, 0.12);
      poll.position.set(0, 0.21, 0.02);
      headPivot.add(poll);
      parts.ears = addEars(headPivot, mats, def, { x: 0.195, y: 0.14, z: 0.04, droop: 0.92, reach: 0.12, rx: 0.16, ry: 0.04, rz: 0.085 });
      parts.eyes = addEyes(headPivot, mats, { x: 0.17, y: 0.06, z: 0.18, size: 0.95 });
      addHorn(headPivot, mats, speciesName, -1);
      addHorn(headPivot, mats, speciesName, 1);
    } else if (speciesName === 'cow') {
      const skull = ellipsoid(mats.face, 0.23, 0.22, 0.29);
      skull.position.set(0, 0.035, 0.07);
      headPivot.add(skull);
      const blaze = ellipsoid(mats.ear, 0.105, 0.14, 0.18);
      blaze.position.set(0, 0.14, 0.12);
      blaze.scale.z *= 0.55;
      headPivot.add(blaze);
      const muzzle = ellipsoid(mats.muzzle, 0.16, 0.13, 0.24);
      muzzle.position.set(0, -0.075, 0.34);
      headPivot.add(muzzle);
      const nose = ellipsoid(mats.nose, 0.115, 0.075, 0.06);
      nose.position.set(0, -0.02, 0.55);
      headPivot.add(nose);
      [-1, 1].forEach(function (sign) {
        const nostril = ellipsoid(mats.nose, 0.018, 0.012, 0.01);
        nostril.position.set(sign * 0.045, -0.045, 0.59);
        headPivot.add(nostril);
      });
      const mouth = ellipsoid(mats.nose, 0.07, 0.014, 0.02);
      mouth.position.set(0, -0.16, 0.53);
      mouth.userData.baseScaleY = mouth.scale.y;
      headPivot.add(mouth);
      parts.mouth = mouth;

      parts.ears = addEars(headPivot, mats, def, { x: 0.215, y: 0.13, z: 0.02, droop: 0.68, reach: 0.13, rx: 0.17, ry: 0.05, rz: 0.09 });
      parts.eyes = addEyes(headPivot, mats, { x: 0.185, y: 0.055, z: 0.2, size: 1.02 });
      addHorn(headPivot, mats, speciesName, -1);
      addHorn(headPivot, mats, speciesName, 1);
    } else {
      const skull = ellipsoid(mats.face, 0.175, 0.21, 0.3);
      skull.position.set(0, 0.035, 0.08);
      headPivot.add(skull);
      const muzzle = ellipsoid(mats.muzzle, 0.11, 0.09, 0.26);
      muzzle.position.set(0, -0.08, 0.34);
      headPivot.add(muzzle);
      const nose = ellipsoid(mats.nose, 0.085, 0.06, 0.055);
      nose.position.set(0, -0.025, 0.57);
      headPivot.add(nose);
      const mouth = ellipsoid(mats.nose, 0.055, 0.012, 0.018);
      mouth.position.set(0, -0.16, 0.54);
      mouth.userData.baseScaleY = mouth.scale.y;
      headPivot.add(mouth);
      parts.mouth = mouth;

      parts.ears = addEars(headPivot, mats, def, { x: 0.16, y: 0.16, z: 0.04, droop: 0.46, reach: 0.11, rx: 0.14, ry: 0.045, rz: 0.08 });
      parts.eyes = addEyes(headPivot, mats, { x: 0.15, y: 0.065, z: 0.21, size: 0.9 });
      addStagAntlers(headPivot, mats);
    }

    const carryAnchor = new THREE.Group();
    carryAnchor.position.set(0, def.carry.y, def.carry.z);
    headPivot.add(carryAnchor);
    parts.carryAnchor = carryAnchor;

    parts.legs = addLegs(rig, mats, def, speciesName);
    parts.tailPivot = addTail(rig, mats, def, speciesName);

    // Put the hooves exactly on y=0 after the primitive assembly. Measure in
    // local space before the species scale is applied to the whole group.
    rig.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rig);
    if (Number.isFinite(box.min.y)) rig.position.y -= box.min.y;
    parts.rigBaseY = rig.position.y;
    group.scale.setScalar(def.scale);

    return parts;
  }

  // ------------------------------------------------------------------------
  // Grass nibbles
  // ------------------------------------------------------------------------
  const grassBits = [];
  const bitGeo = new THREE.BoxGeometry(0.075, 0.075, 0.13);
  const bitMats = [
    M.std(0x6f9f47, 0.95),
    M.std(0x86b257, 0.95),
    M.std(0x5d8d3b, 0.95)
  ];

  function spawnGrassBits(animal) {
    const head = animal.parts.headPivot;
    head.updateWorldMatrix(true, false);
    const mouth = new THREE.Vector3(0, -0.08, 0.44);
    head.localToWorld(mouth);

    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(bitGeo, bitMats[(Math.random() * bitMats.length) | 0]);
      mesh.position.set(mouth.x + rand(-0.12, 0.12), mouth.y + rand(-0.04, 0.1), mouth.z + rand(-0.12, 0.12));
      mesh.scale.setScalar(rand(0.65, 1.25));
      mesh.rotation.set(rand(0, 2), rand(0, 2), rand(0, 2));
      mesh.userData.life = rand(0.45, 0.8);
      mesh.userData.vel = new THREE.Vector3(rand(-0.9, 0.9), rand(1.1, 2.8), rand(-0.9, 0.9));
      mesh.userData.spin = rand(-8, 8);
      sceneRef.add(mesh);
      grassBits.push(mesh);
    }

    while (grassBits.length > MAX_GRASS_BITS) {
      sceneRef.remove(grassBits.shift());
    }
  }

  function updateGrassBits(dt) {
    for (let i = grassBits.length - 1; i >= 0; i--) {
      const mesh = grassBits[i];
      mesh.userData.vel.y -= 16 * dt;
      mesh.position.addScaledVector(mesh.userData.vel, dt);
      mesh.rotation.x += mesh.userData.spin * dt;
      mesh.rotation.y += mesh.userData.spin * 0.6 * dt;
      mesh.userData.life -= dt;
      if (mesh.userData.life <= 0) {
        sceneRef.remove(mesh);
        grassBits.splice(i, 1);
      } else {
        mesh.scale.multiplyScalar(1 - dt * 0.4);
      }
    }
  }

  // ------------------------------------------------------------------------
  // NPCs
  // ------------------------------------------------------------------------
  const animals = [];
  let sceneRef = null;
  let worldRef = null;
  let audioRef = null;
  let goatRef = null;

  function sizeOf() {
    return (worldRef && worldRef.blockSize) || BLOCK;
  }

  function canStandAt(animal, x, z, feetY, yaw) {
    const def = animal.def;
    const scale = def.scale;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const bottom = feetY + BODY_CLEARANCE;
    const top = feetY + def.bodyHeight * scale;

    for (let i = 0; i < def.footprint.length; i++) {
      const probe = def.footprint[i];
      const px = x + sin * probe[1] * scale + cos * probe[0] * scale;
      const pz = z + cos * probe[1] * scale - sin * probe[0] * scale;
      if (worldRef.blockedAt(px, pz, bottom, top)) return false;
    }
    return true;
  }

  function actorSpotClear(animal, x, z, padding) {
    const pad = padding || 0;
    if (goatRef && goatRef.group) {
      const g = goatRef.group.position;
      if (Math.hypot(x - g.x, z - g.z) < 1.0 + pad) return false;
    }
    for (let i = 0; i < animals.length; i++) {
      const other = animals[i];
      if (other === animal) continue;
      const p = other.group.position;
      if (Math.hypot(x - p.x, z - p.z) < (animal.def.scale + other.def.scale) * 0.82 + pad) return false;
    }
    return true;
  }

  function moveStep(animal, nx, nz, yaw) {
    const p = animal.group.position;
    const s = animal.state;
    let feetY = p.y;
    let can = canStandAt(animal, nx, nz, feetY, yaw);

    // Small animals are nimble enough to hop up a single block. This lets a
    // sheep that wandered down a bank return to the herd instead of pacing
    // against a two-metre lip forever.
    if (!can && s.grounded) {
      const raised = worldRef.supportHeight(nx, nz, feetY + BLOCK + 0.1);
      const rise = raised - feetY;
      if (rise > 0.12 && rise <= BLOCK + 0.1 && canStandAt(animal, nx, nz, raised, yaw)) {
        feetY = raised;
        can = true;
      }
    }
    if (!can) return false;

    if (goatRef && goatRef.group) {
      const g = goatRef.group.position;
      const oldD = Math.hypot(p.x - g.x, p.z - g.z);
      const newD = Math.hypot(nx - g.x, nz - g.z);
      if (newD < 1.0 && newD <= oldD + 0.001) return false;
    }
    for (let i = 0; i < animals.length; i++) {
      const other = animals[i];
      if (other === animal) continue;
      const o = other.group.position;
      const min = (animal.def.scale + other.def.scale) * 0.78;
      const oldD = Math.hypot(p.x - o.x, p.z - o.z);
      const newD = Math.hypot(nx - o.x, nz - o.z);
      if (newD < min && newD <= oldD + 0.001) return false;
    }
    if (feetY !== p.y) {
      p.y = feetY;
      s.vy = 0;
      s.grounded = true;
      s.landPulse = 1;
    }
    return true;
  }

  function moveAnimal(animal, dx, dz, yaw) {
    const p = animal.group.position;
    const x = p.x;
    const z = p.z;

    if (moveStep(animal, x + dx, z + dz, yaw)) {
      p.x = x + dx;
      p.z = z + dz;
      return true;
    }

    let moved = false;
    if (dx !== 0 && moveStep(animal, x + dx, z, yaw)) {
      p.x = x + dx;
      moved = true;
    }
    if (dz !== 0 && moveStep(animal, p.x, z + dz, yaw)) {
      p.z = z + dz;
      moved = true;
    }
    return moved;
  }

  function angleDelta(a, b) {
    return ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  }

  function nearestGround(x, z) {
    return worldRef.surfaceHeight(x, z);
  }

  function chooseWander(animal) {
    const s = animal.state;
    const p = animal.group.position;
    const player = goatRef.group.position;
    const playerDist = Math.hypot(p.x - player.x, p.z - player.z);
    let cx = p.x;
    let cz = p.z;

    // If the herd has been left far behind, lean the next stroll toward the
    // player. Relocation below is only a last resort.
    if (playerDist > 15) {
      const pull = playerDist > 30 ? 0.68 : 0.42;
      cx += (player.x - p.x) * pull;
      cz += (player.z - p.z) * pull;
    }

    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = rand(0, Math.PI * 2);
      const distance = rand(2.6, 9.5);
      const x = cx + Math.sin(angle) * distance;
      const z = cz + Math.cos(angle) * distance;
      const y = nearestGround(x, z);

      if (Math.hypot(x - player.x, z - player.z) < 2.2) continue;
      if (Math.abs(y - p.y) > 2.4) continue;
      if (!canStandAt(animal, x, z, y, angle)) continue;
      if (!actorSpotClear(animal, x, z, 0.35)) continue;

      s.target.set(x, y, z);
      s.mode = 'walk';
      s.stuck = 0;
      return true;
    }

    s.mode = 'idle';
    s.wait = rand(1.2, 3);
    return false;
  }

  function startGraze(animal) {
    const s = animal.state;
    if (s.carry || !s.grounded) return false;
    s.mode = 'graze';
    s.grazeTime = rand(3.0, 6.0);
    s.bitTime = rand(0.15, 0.45);
    s.speed = 0;
    return true;
  }

  function findApproach(animal, tx, tz, preferredDistance) {
    const p = animal.group.position;
    const base = Math.atan2(p.x - tx, p.z - tz);
    const offsets = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, Math.PI];
    const distances = [preferredDistance || 2.35, 2.8, 3.3];
    let best = null;
    let bestScore = Infinity;

    for (let d = 0; d < distances.length; d++) {
      for (let o = 0; o < offsets.length; o++) {
        const angle = base + offsets[o];
        const distance = distances[d];
        const x = tx + Math.sin(angle) * distance;
        const z = tz + Math.cos(angle) * distance;
        const y = nearestGround(x, z);
        if (Math.abs(y - p.y) > 2.6) continue;
        const yaw = Math.atan2(tx - x, tz - z);
        if (!canStandAt(animal, x, z, y, yaw)) continue;
        if (!actorSpotClear(animal, x, z, 0.4)) continue;

        const score = Math.hypot(x - p.x, z - p.z) + Math.abs(offsets[o]) * 0.3 + d * 0.18;
        if (score < bestScore) {
          bestScore = score;
          best = { x: x, z: z, y: y, yaw: yaw };
        }
      }
    }
    return best;
  }

  function startBreak(animal) {
    const s = animal.state;
    if (!s.grounded) return false;
    const p = animal.group.position;
    const player = goatRef.group.position;
    const target = worldRef.findBreakableNear(p.x, p.z, p.y, 11, {
      allowTerrain: true,
      protectPlaced: true,
      avoid: { x: player.x, z: player.z, radius: 4.0 }
    });
    if (!target) {
      s.actionTimer = rand(7, 14);
      return false;
    }

    const approach = findApproach(animal, target.x, target.z, 2.35);
    if (!approach) {
      s.actionTimer = rand(6, 12);
      return false;
    }

    s.action = {
      kind: 'break',
      target: target,
      approach: approach,
      time: 0,
      duration: 0.7,
      hit: false
    };
    s.mode = 'seekBreak';
    s.seekTime = 8;
    s.stuck = 0;
    return true;
  }

  function findPlaceCell(animal) {
    const s = animal.state;
    const p = animal.group.position;
    const bs = sizeOf();
    const player = goatRef.group.position;
    const base = s.yaw;

    for (let attempt = 0; attempt < 20; attempt++) {
      const angle = base + rand(-2.1, 2.1);
      const distance = rand(2.7, 5.2);
      const x = p.x + Math.sin(angle) * distance;
      const z = p.z + Math.cos(angle) * distance;
      const top = worldRef.landingHeight(x, z, p.y + 2.35);
      if (top < p.y - 1.2 || top > p.y + 2.1) continue;

      const bx = Math.floor(x / bs);
      const bz = Math.floor(z / bs);
      const by = Math.floor((top + 0.001) / bs);
      const cx = (bx + 0.5) * bs;
      const cz = (bz + 0.5) * bs;

      if (Math.hypot(cx - p.x, cz - p.z) < 2.5) continue;
      if (Math.hypot(cx - player.x, cz - player.z) < 2.5) continue;

      let blocked = false;
      for (let i = 0; i < animals.length; i++) {
        const other = animals[i];
        if (other === animal) continue;
        const op = other.group.position;
        if (Math.hypot(cx - op.x, cz - op.z) < 1.8) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      if (worldRef.canPlaceBlock && !worldRef.canPlaceBlock(bx, by, bz)) continue;
      const approach = findApproach(animal, cx, cz, 2.35);
      if (!approach) continue;

      return {
        type: 'place',
        bx: bx,
        by: by,
        bz: bz,
        x: cx,
        z: cz,
        approach: approach,
        kind: s.carry
      };
    }
    return null;
  }

  function startPlace(animal) {
    const s = animal.state;
    if (!s.carry || !s.grounded) return false;
    const target = findPlaceCell(animal);
    if (!target) {
      s.actionTimer = rand(7, 13);
      return false;
    }

    s.action = {
      kind: 'place',
      target: target,
      approach: target.approach,
      time: 0,
      duration: 0.68,
      hit: false
    };
    s.mode = 'seekPlace';
    s.seekTime = 8;
    s.stuck = 0;
    return true;
  }

  function setCarried(animal, kind) {
    const s = animal.state;
    if (s.carriedMesh) {
      if (s.carriedMesh.parent) s.carriedMesh.parent.remove(s.carriedMesh);
      s.carriedMesh = null;
    }
    s.carry = kind || null;
    s.carryPop = kind ? 1 : 0;

    if (!kind || !worldRef.makeBlockMesh) return;
    const mesh = worldRef.makeBlockMesh(kind);
    const carry = animal.def.carry;
    mesh.scale.setScalar(carry.scale);
    mesh.position.set(0, 0, 0);
    mesh.rotation.y = carry.rot;
    mesh.rotation.z = 0.03;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    animal.parts.carryAnchor.add(mesh);
    s.carriedMesh = mesh;
  }

  function beginAction(animal) {
    const s = animal.state;
    const action = s.action;
    s.mode = action.kind === 'break' ? 'break' : 'place';
    s.action.time = 0;
    s.action.hit = false;
    s.speed = 0;
    s.yaw = Math.atan2(action.target.x - animal.group.position.x, action.target.z - animal.group.position.z);
    animal.group.rotation.y = s.yaw;
  }

  function finishSeek(animal, failed) {
    const s = animal.state;
    s.action = null;
    s.mode = 'idle';
    s.wait = rand(0.8, 2.0);
    s.actionTimer = failed ? rand(5, 10) : rand(9, 15);
    s.stuck = 0;
  }

  function applyAction(animal) {
    const s = animal.state;
    const action = s.action;
    if (!action) return;
    const distToPlayer = Math.hypot(
      animal.group.position.x - goatRef.group.position.x,
      animal.group.position.z - goatRef.group.position.z
    );

    if (action.kind === 'break') {
      const target = action.target;
      const kind = worldRef.breakBlockAt(target.bx, target.by, target.bz, {
        drop: false,
        protectPlaced: true
      });
      if (kind) {
        setCarried(animal, kind);
        s.actionTimer = rand(7, 13);
        s.happy = 1;
        if (audioRef && audioRef.thud && distToPlayer < 22) audioRef.thud();
      } else {
        s.actionTimer = rand(6, 12);
      }
    } else if (action.kind === 'place') {
      const target = action.target;
      const bs = sizeOf();
      const cx = (target.bx + 0.5) * bs;
      const cz = (target.bz + 0.5) * bs;
      const player = goatRef.group.position;
      let unsafe = Math.hypot(cx - player.x, cz - player.z) < 1.7;
      if (!unsafe) {
        for (let i = 0; i < animals.length; i++) {
          const other = animals[i];
          if (other === animal) continue;
          const op = other.group.position;
          if (Math.hypot(cx - op.x, cz - op.z) < 1.2) {
            unsafe = true;
            break;
          }
        }
      }
      if (!unsafe && worldRef.placeBlock(s.carry, target.bx, target.by, target.bz)) {
        setCarried(animal, null);
        s.actionTimer = rand(18, 30);
        s.happy = 1;
        if (audioRef && audioRef.thud && distToPlayer < 22) audioRef.thud();
      } else {
        s.actionTimer = rand(3, 6);
      }
    }
    action.hit = true;
  }

  function updateSeek(animal, dt) {
    const s = animal.state;
    const action = s.action;
    if (!action) {
      s.mode = 'idle';
      s.wait = 1;
      return;
    }

    const p = animal.group.position;
    const target = action.target;
    const approach = action.approach;
    s.seekTime -= dt;

    const distanceToTarget = Math.hypot(target.x - p.x, target.z - p.z);
    const distanceToApproach = Math.hypot(approach.x - p.x, approach.z - p.z);

    if (distanceToApproach < 0.38 || distanceToTarget < 3.2) {
      const desiredYaw = Math.atan2(target.x - p.x, target.z - p.z);
      s.yaw = turnToward(s.yaw, desiredYaw, dt * 9);
      s.speed = damp(s.speed, 0, 8, dt);
      if (Math.abs(angleDelta(s.yaw, desiredYaw)) < 0.2 || s.seekTime < 1.2) {
        beginAction(animal);
      }
    } else {
      const dx = approach.x - p.x;
      const dz = approach.z - p.z;
      const desiredYaw = Math.atan2(dx, dz);
      s.yaw = turnToward(s.yaw, desiredYaw, dt * 4.8);
      const speed = animal.def.walkSpeed * 1.25;
      s.speed = damp(s.speed, speed, 5, dt);
      const moved = moveAnimal(animal, Math.sin(s.yaw) * s.speed * dt, Math.cos(s.yaw) * s.speed * dt, s.yaw);
      if (moved) {
        s.walkPhase += s.speed * dt * 4.2;
        s.stuck = 0;
      } else {
        s.stuck += dt;
      }
    }

    if (s.seekTime <= 0 || s.stuck > 1.1) finishSeek(animal, true);
  }

  function updateAction(animal, dt) {
    const s = animal.state;
    const action = s.action;
    if (!action) {
      s.mode = 'idle';
      s.wait = 1;
      return;
    }

    action.time += dt;
    if (!action.hit && action.time >= 0.22) applyAction(animal);
    if (action.time >= action.duration) {
      s.action = null;
      s.mode = 'idle';
      s.wait = rand(1.2, 3.0);
      s.speed = 0;
    }
  }

  function updateGravity(animal, dt) {
    const s = animal.state;
    const p = animal.group.position;
    let groundY = worldRef.supportHeight(p.x, p.z, p.y + BODY_CLEARANCE);

    if (s.grounded) {
      if (p.y > groundY + 0.02) {
        s.grounded = false;
        s.vy = 0;
      } else {
        p.y = groundY;
        s.vy = 0;
      }
    }

    if (!s.grounded) {
      const prevY = p.y;
      s.vy -= GRAVITY * dt;
      p.y += s.vy * dt;
      groundY = worldRef.supportHeight(p.x, p.z, Math.max(prevY, p.y));
      if (s.vy <= 0 && p.y <= groundY) {
        p.y = groundY;
        s.vy = 0;
        s.grounded = true;
        s.landPulse = 1;
      }
    }
    s.landPulse = Math.max(0, (s.landPulse || 0) - dt * 4);
  }

  function updateVisual(animal, dt, t) {
    const s = animal.state;
    const parts = animal.parts;
    const def = animal.def;
    const moving = s.speed > 0.08;
    const stride = moving ? clamp(s.speed / def.walkSpeed, 0, 1.2) : 0;
    const grazing = s.mode === 'graze' ? 1 : 0;
    s.grazePose = damp(s.grazePose || 0, grazing, 4.2, dt);

    if (s.carry && s.mode === 'graze') {
      // An animal with a block between its horns does not put its face in
      // the grass; it keeps browsing with its head up.
      s.grazePose = damp(s.grazePose, 0, 8, dt);
    }

    const bob = moving ? Math.abs(Math.sin(s.walkPhase)) * 0.024 * stride : 0;
    parts.rig.position.y = parts.rigBaseY + bob - (s.landPulse || 0) * 0.045;
    parts.rig.rotation.x = damp(parts.rig.rotation.x,
      (s.landPulse || 0) * -0.05 + (moving ? Math.sin(s.walkPhase * 2) * 0.012 * stride : 0),
      9, dt);

    const walkLift = moving ? Math.sin(s.walkPhase * 2) * 0.04 * stride : 0;
    const actionLunge = (s.mode === 'break' || s.mode === 'place') && s.action
      ? Math.sin(clamp(s.action.time / s.action.duration, 0, 1) * Math.PI)
      : 0;
    const terrainGrab = s.action && s.action.kind === 'break' && s.action.target.type === 'terrain'
      ? actionLunge
      : 0;

    const grazePose = s.grazePose;
    const headSway = s.mode === 'graze' ? Math.sin(t * 2.1 + animal.seed) * 0.12 * grazePose : 0;
    let neckTarget = def.neckBase + grazePose * (def.grazeNeck - def.neckBase);
    let headTarget = def.headBase + grazePose * (def.grazeHead - def.headBase);
    neckTarget += actionLunge * def.lungeNeck + terrainGrab * 0.1;
    headTarget += actionLunge * 0.25 + terrainGrab * 0.45;

    parts.neckPivot.position.y = damp(parts.neckPivot.position.y,
      parts.neckBaseY - grazePose * def.grazeDrop, 5.5, dt);
    parts.neckPivot.position.z = damp(parts.neckPivot.position.z,
      parts.neckBaseZ + grazePose * 0.1, 5.5, dt);
    parts.neckPivot.rotation.x = damp(parts.neckPivot.rotation.x, neckTarget, 8, dt);

    let headYaw = moving ? Math.sin(t * 0.9 + animal.seed) * 0.04 : Math.sin(t * 0.5 + animal.seed) * 0.1;
    headYaw += headSway;
    if (s.mode === 'graze' || s.mode === 'break' || s.mode === 'place' || s.mode === 'seekBreak' || s.mode === 'seekPlace') {
      headYaw = headSway;
    } else if (!moving && goatRef && goatRef.group) {
      const g = goatRef.group.position;
      const p = animal.group.position;
      const toPlayer = Math.atan2(g.x - p.x, g.z - p.z);
      headYaw = clamp(angleDelta(s.yaw, toPlayer), -0.65, 0.65) * 0.85;
    }
    parts.headPivot.rotation.y = damp(parts.headPivot.rotation.y, headYaw, 4.0, dt);
    parts.headPivot.rotation.x = damp(parts.headPivot.rotation.x,
      headTarget + walkLift + Math.sin(t * (s.mode === 'graze' ? 5.2 : 1.3) + animal.seed) * (grazing ? 0.025 : 0.012),
      9, dt);

    // Chewing mouth.
    if (parts.mouth) {
      const chew = s.mode === 'graze' ? (0.5 + 0.5 * Math.sin(t * 15 + animal.seed)) : 0;
      parts.mouth.scale.y = (parts.mouth.userData.baseScaleY || 0.012) * (0.8 + chew * 0.8);
      parts.mouth.rotation.x = chew * 0.18;
    }

    // Legs.
    for (let i = 0; i < parts.legs.length; i++) {
      const leg = parts.legs[i];
      const phase = s.walkPhase + leg.offset;
      let hipTarget = Math.sin(phase) * 0.58 * stride;
      let kneeTarget = Math.max(0, -Math.cos(phase)) * 0.8 * stride + 0.035;
      if (actionLunge > 0) {
        hipTarget += (leg.front ? -0.18 : 0.12) * actionLunge;
        kneeTarget += (leg.front ? 0.12 : 0.03) * actionLunge;
      }
      leg.hip.rotation.x = damp(leg.hip.rotation.x, hipTarget, 20, dt);
      leg.knee.rotation.x = damp(leg.knee.rotation.x, kneeTarget, 20, dt);
    }

    // Ears and tail.
    s.earTimer -= dt;
    if (s.earTimer <= 0) {
      s.earTimer = rand(2.5, 6);
      s.earTwitch = 1;
    }
    s.earTwitch = Math.max(0, s.earTwitch - dt * 4);
    const twitch = s.earTwitch > 0 ? Math.sin((1 - s.earTwitch) * Math.PI) * 0.18 : 0;
    for (let i = 0; i < parts.ears.length; i++) {
      const ear = parts.ears[i];
      ear.pivot.rotation.z = ear.baseZ + ear.side * (Math.sin(t * 1.1 + animal.seed + ear.side) * 0.025 + twitch);
      ear.pivot.rotation.x = 0.08 + Math.sin(t * 1.2 + ear.side) * 0.03;
    }

    if (parts.tailPivot) {
      const tailSwing = Math.sin(t * (2.2 + s.happy * 3.2) + animal.seed) * (0.16 + (s.happy || 0) * 0.18);
      parts.tailPivot.rotation.z = tailSwing;
      parts.tailPivot.rotation.x = (parts.tailPivot.userData.baseX || parts.tailPivot.rotation.x);
    }
    s.happy = Math.max(0, (s.happy || 0) - dt * 0.5);

    // Blinking.
    s.blinkTimer -= dt;
    if (s.blinkTimer <= 0) {
      s.blinkTimer = rand(2.4, 5.8);
      s.blink = 1;
    }
    s.blink = Math.max(0, (s.blink || 0) - dt * 7);
    for (let i = 0; i < parts.eyes.length; i++) {
      parts.eyes[i].scale.y = 1 - s.blink * 0.88;
    }

    if (s.carriedMesh) {
      const pop = s.carryPop || 0;
      const scale = def.carry.scale * (1 + pop * 0.16);
      s.carriedMesh.scale.setScalar(scale);
      s.carryPop = Math.max(0, pop - dt * 4);
    }

    if (parts.bell) {
      parts.bell.rotation.z = Math.sin(t * 2.2 + animal.seed) * 0.12 + (moving ? Math.sin(s.walkPhase) * 0.1 : 0);
    }
  }

  function updateAnimal(animal, dt, t) {
    const s = animal.state;
    const p = animal.group.position;
    const player = goatRef.group.position;
    const playerDistance = Math.hypot(p.x - player.x, p.z - player.z);

    if (playerDistance > 92 && s.mode !== 'break' && s.mode !== 'place') {
      relocate(animal);
    }

    if (playerDistance < 52) s.actionTimer -= dt;

    // A carrying animal can pause its stroll to set the block down once the
    // carry timer is up; otherwise it would keep walking until its next idle.
    if (s.carry && s.grounded && s.actionTimer <= 0 && s.mode === 'walk') startPlace(animal);

    if (s.mode === 'idle') {
      s.speed = damp(s.speed, 0, 5, dt);
      s.wait -= dt;
      if (s.wait <= 0) {
        if (s.carry && s.actionTimer <= 0) {
          if (!startPlace(animal)) {
            if (!chooseWander(animal)) s.wait = rand(1.5, 3.5);
          }
        } else if (!s.carry && s.actionTimer <= 0) {
          if (!startBreak(animal)) {
            if (!chooseWander(animal) && !startGraze(animal)) s.wait = rand(1.5, 3.5);
          }
        } else if (!s.carry && Math.random() < 0.34) {
          if (!startGraze(animal)) chooseWander(animal);
        } else {
          chooseWander(animal);
        }
      }
    } else if (s.mode === 'walk') {
      const dx = s.target.x - p.x;
      const dz = s.target.z - p.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.32) {
        s.mode = 'idle';
        s.wait = rand(1.3, 4.2);
        s.speed = 0;
      } else {
        const yaw = Math.atan2(dx, dz);
        s.yaw = turnToward(s.yaw, yaw, dt * 4.0);
        s.speed = damp(s.speed, defWalkSpeed(animal), 4, dt);
        const moved = moveAnimal(animal, Math.sin(s.yaw) * s.speed * dt, Math.cos(s.yaw) * s.speed * dt, s.yaw);
        if (moved) {
          s.walkPhase += s.speed * dt * 4.6;
          s.stuck = 0;
        } else {
          s.stuck += dt;
          if (s.stuck > 0.8) {
            s.mode = 'idle';
            s.wait = rand(1.0, 2.5);
            s.speed = 0;
            s.stuck = 0;
          }
        }
      }
    } else if (s.mode === 'graze') {
      s.speed = damp(s.speed, 0, 5, dt);
      s.grazeTime -= dt;
      s.bitTime -= dt;
      if (s.bitTime <= 0 && s.grazePose > 0.65) {
        s.bitTime = rand(0.22, 0.48);
        if (Math.random() < 0.8) spawnGrassBits(animal);
      }
      if (s.grazeTime <= 0) {
        s.mode = 'idle';
        s.wait = rand(1.2, 3.0);
      }
    } else if (s.mode === 'seekBreak' || s.mode === 'seekPlace') {
      updateSeek(animal, dt);
    } else if (s.mode === 'break' || s.mode === 'place') {
      updateAction(animal, dt);
    }

    animal.group.rotation.y = s.yaw;
    updateGravity(animal, dt);
    updateVisual(animal, dt, t);
  }

  function defWalkSpeed(animal) {
    return animal.def.walkSpeed;
  }

  function findSpawnNear(cx, cz, minRadius, maxRadius, ignore) {
    for (let i = 0; i < 64; i++) {
      const angle = rand(0, Math.PI * 2);
      const radius = rand(minRadius, maxRadius);
      const x = cx + Math.sin(angle) * radius;
      const z = cz + Math.cos(angle) * radius;
      const y = nearestGround(x, z);
      if (y < 0.01) continue;
      const yaw = rand(0, Math.PI * 2);
      if (!canStandAt(ignore || animals[0], x, z, y, yaw)) continue;
      if (goatRef && Math.hypot(x - goatRef.group.position.x, z - goatRef.group.position.z) < 4.0) continue;
      let crowded = false;
      for (let j = 0; j < animals.length; j++) {
        if (animals[j] === ignore) continue;
        const q = animals[j].group.position;
        if (Math.hypot(x - q.x, z - q.z) < 2.0) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;
      return { x: x, y: y, z: z, yaw: yaw };
    }
    return null;
  }

  // Initial animals should stay on the same little plateau as the player and
  // near their intended preview position; a fully random fallback could put
  // one behind the camera or hidden below a bank.
  function findSpawnNearPreferred(px, pz, animal, radius) {
    const gy = goatRef.group.position.y;
    for (let i = 0; i < 48; i++) {
      const angle = rand(0, Math.PI * 2);
      const distance = i === 0 ? 0 : rand(0.8, radius);
      const x = px + Math.sin(angle) * distance;
      const z = pz + Math.cos(angle) * distance;
      const y = nearestGround(x, z);
      if (Math.abs(y - gy) > 1.4) continue;
      if (Math.hypot(x - goatRef.group.position.x, z - goatRef.group.position.z) < 2.6) continue;
      if (!canStandAt(animal, x, z, y, Math.atan2(goatRef.group.position.x - x, goatRef.group.position.z - z))) continue;
      if (!actorSpotClearForSpawn(x, z)) continue;
      return {
        x: x,
        y: y,
        z: z,
        yaw: Math.atan2(goatRef.group.position.x - x, goatRef.group.position.z - z)
      };
    }
    return null;
  }

  function relocate(animal) {
    const p = goatRef.group.position;
    const spot = findSpawnNear(p.x, p.z, 26, 46, animal);
    if (!spot) return;
    animal.group.position.set(spot.x, spot.y, spot.z);
    animal.state.yaw = spot.yaw;
    animal.group.rotation.y = spot.yaw;
    animal.state.mode = 'idle';
    animal.state.wait = rand(1, 3);
    animal.state.grounded = true;
    animal.state.vy = 0;
    animal.state.speed = 0;
    animal.state.action = null;
    animal.state.seekTime = 0;
  }

  function createAnimal(speciesName, spawn, options) {
    const def = SPECIES[speciesName];
    const parts = buildModel(speciesName, options && options.variant);
    const animal = {
      species: speciesName,
      def: def,
      name: options && options.name,
      parts: parts,
      group: parts.group,
      seed: rand(0, Math.PI * 2),
      state: null
    };

    animal.state = {
      mode: 'idle',
      wait: rand(1.2, 3.5),
      target: new THREE.Vector3(spawn.x, spawn.y, spawn.z),
      yaw: spawn.yaw,
      speed: 0,
      walkPhase: rand(0, Math.PI * 2),
      grounded: true,
      vy: 0,
      stuck: 0,
      seekTime: 0,
      action: null,
      actionTimer: options && Number.isFinite(options.actionTimer) ? options.actionTimer : rand(9, 18),
      carry: null,
      carriedMesh: null,
      carryPop: 0,
      grazePose: 0,
      grazeTime: 0,
      bitTime: 0,
      landPulse: 0,
      happy: 0,
      earTimer: rand(1.5, 5),
      earTwitch: 0,
      blinkTimer: rand(1.5, 4),
      blink: 0
    };

    animal.group.position.set(spawn.x, spawn.y, spawn.z);
    animal.group.rotation.y = spawn.yaw;
    animal.group.scale.setScalar(def.scale);
    sceneRef.add(animal.group);
    animals.push(animal);
    return animal;
  }

  function init(deps) {
    sceneRef = deps.scene;
    worldRef = deps.world;
    audioRef = deps.audio;
    goatRef = deps.goat;

    const gx = goatRef.group.position.x;
    const gz = goatRef.group.position.z;

    const roster = [
      { species: 'sheep', name: 'Mallow', dx: -3.0, dz: 2.0, actionTimer: 0.8 },
      { species: 'cow', name: 'Clover', dx: 2.6, dz: -3.0, actionTimer: 12.0 },
      { species: 'stag', name: 'Bramble', dx: -3.8, dz: -1.2, actionTimer: 18.0 },
      {
        species: 'sheep',
        name: 'Poppy',
        dx: 1.6,
        dz: -5.6,
        actionTimer: 8.0,
        variant: { wool: 0x736e64, woolDark: 0x5b574f, face: 0x2b2824, ear: 0x4d4944, muzzle: 0x3b3733 }
      }
    ];

    // Create one temporary animal object so spawn clearance can use the real
    // collision footprint before the first rig is added.
    const probe = {
      def: SPECIES.sheep,
      group: new THREE.Group()
    };

    for (let i = 0; i < roster.length; i++) {
      const entry = roster[i];
      const preferred = {
        x: gx + entry.dx,
        y: nearestGround(gx + entry.dx, gz + entry.dz),
        z: gz + entry.dz,
        yaw: Math.atan2(gx - (gx + entry.dx), gz - (gz + entry.dz))
      };
      probe.def = SPECIES[entry.species];
      let spawn = null;
      if (canStandAt(probe, preferred.x, preferred.z, preferred.y, preferred.yaw) &&
          actorSpotClearForSpawn(preferred.x, preferred.z) &&
          Math.abs(preferred.y - goatRef.group.position.y) < 1.4) {
        spawn = preferred;
      } else {
        spawn = findSpawnNearPreferred(preferred.x, preferred.z, probe, 3.4);
      }
      if (!spawn) {
        spawn = findSpawnNear(gx, gz, 5.5, 11, probe);
      }
      if (!spawn) {
        spawn = {
          x: gx + entry.dx,
          y: nearestGround(gx + entry.dx, gz + entry.dz),
          z: gz + entry.dz,
          yaw: preferred.yaw
        };
      }
      createAnimal(entry.species, spawn, entry);
    }

    M.animals.list = animals;
  }

  function actorSpotClearForSpawn(x, z) {
    if (goatRef && Math.hypot(x - goatRef.group.position.x, z - goatRef.group.position.z) < 2.6) return false;
    for (let i = 0; i < animals.length; i++) {
      const p = animals[i].group.position;
      if (Math.hypot(x - p.x, z - p.z) < 2.2) return false;
    }
    return true;
  }

  function update(dt, t) {
    if (!goatRef || !goatRef.group) return;
    for (let i = 0; i < animals.length; i++) {
      updateAnimal(animals[i], dt, t);
    }
    updateGrassBits(dt);
  }

  M.animals = {
    init: init,
    update: update,
    list: animals,
    species: SPECIES
  };
})(window.Meadow = window.Meadow || {});
