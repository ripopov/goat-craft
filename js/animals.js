(function (M) {
  'use strict';

  const { clamp, rand, damp, turnToward, hoofPose, actionPose } = M.utils;
  const BLOCK = 2;
  const physics = M.actorPhysics;
  const recovery = M.animalRecovery;
  const GRAVITY = 24;
  const BODY_CLEARANCE = 0.06;
  const MAX_GRASS_BITS = 48;

  // Builders quarry shallow patches and carry turf between their horns.
  const CARRY_LIMIT = 34;
  const JUMP_SPEED = 12.8;
  const JUMP_COOLDOWN = 0.52;
  const AIR_CONTROL = 2.15;
  const ESCAPE_TIMEOUT = 22;
  const PIT_CHECK_INTERVAL = 0.55;

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
      bodyRadius: 0.42,
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
      bodyRadius: 0.52,
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
      bodyRadius: 0.42,
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

  // Horn styling anchors per species (head-local offsets). The tip is where
  // the elemental glow sphere lands, the band wraps the horn base; these let
  // Long horns training charge NPC horns exactly like the player goat's.
  const HORN_STYLE_ANCHORS = {
    sheep: function (sign) { return { tip: new THREE.Vector3(sign * 0.15, 0.03, -0.14), band: new THREE.Vector3(sign * 0.14, 0.17, 0) }; },
    cow: function (sign) { return { tip: new THREE.Vector3(sign * 0.34, 0.44, -0.1), band: new THREE.Vector3(sign * 0.17, 0.24, 0) }; },
    stag: function (sign) { return { tip: new THREE.Vector3(sign * 0.3, 0.66, -0.29), band: new THREE.Vector3(sign * 0.14, 0.26, -0.03) }; }
  };
  // Leg-size ratios against the player goat, so style bands and wheel rims fit
  // each species, and horn-size ratios for tip spheres and base bands.
  const STYLE_SCALES = {
    sheep: { leg: 0.85, horn: 0.6 },
    cow: { leg: 1.0, horn: 0.75 },
    stag: { leg: 0.9, horn: 0.65 }
  };
  function addHorn(head, mats, speciesName, sign) {
    const mesh = new THREE.Mesh(hornGeometry(speciesName, sign), mats.horn);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    head.add(mesh);
    const anchors = HORN_STYLE_ANCHORS[speciesName](sign);
    return { mesh: mesh, tip: anchors.tip, band: anchors.band };
  }

  function addStagAntlers(head, mats) {
    const horns = [];
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
      const tineC = taperTube([
        [sign * 0.2, 0.39, -0.1],
        [sign * 0.13, 0.49, -0.19],
        [sign * 0.14, 0.59, -0.25]
      ], 0.014, 0.004, 10, 5);

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
      const c = new THREE.Mesh(tineC, mats.horn);
      c.castShadow = true;
      group.add(c);
      head.add(group);
      const anchors = HORN_STYLE_ANCHORS.stag(sign);
      horns.push({ mesh: beam, tip: anchors.tip, band: anchors.band });
      horns.push({ mesh: a }); // tines tint with the beam; only the beam gets tips
      horns.push({ mesh: b });
      horns.push({ mesh: c });
    }
    return horns;
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

      const lid = ellipsoid(mats.face, 0.079 * size, 0.025 * size, 0.035 * size);
      lid.position.set(0, 0.083 * size, 0.026 * size);
      lid.rotation.z = -sign * 0.1;
      eye.add(lid);

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

      const ankle = new THREE.Group();
      ankle.position.y = -(lowerTotal + 0.055);
      knee.add(ankle);
      [-1, 1].forEach(function (side) {
        const hoof = new THREE.Mesh(hoofGeo, mats.hoof);
        hoof.scale.set(0.52, 1, 1.08);
        hoof.position.set(side * dimensions.lowerR * 0.63, 0, 0.018);
        hoof.rotation.z = side * 0.035;
        shadowed(hoof);
        ankle.add(hoof);
      });
      const fetlock = ellipsoid(speciesName === 'sheep' ? mats.woolShade : mats.face,
        dimensions.lowerR * 1.2, 0.095, dimensions.lowerR * 1.18);
      fetlock.position.y = -lowerTotal + 0.055;
      knee.add(fetlock);

      legs.push({ hip: hip, knee: knee, ankle: ankle, front: front, offset: offset });
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
      eyes: [],
      horns: []
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
        [0, 1.59, -0.36, 0.24, 0.18, 0.25], [0, 1.64, -0.05, 0.26, 0.18, 0.27],
        [0, 1.59, 0.25, 0.24, 0.17, 0.24], [-0.29, 1.5, -0.4, 0.19, 0.19, 0.22],
        [0.3, 1.5, -0.38, 0.19, 0.18, 0.23], [-0.34, 1.48, -0.09, 0.17, 0.2, 0.24],
        [0.34, 1.47, -0.06, 0.18, 0.19, 0.25], [-0.29, 1.45, 0.24, 0.18, 0.18, 0.21],
        [0.29, 1.45, 0.27, 0.18, 0.17, 0.2], [-0.23, 1.15, -0.24, 0.16, 0.18, 0.24],
        [0.24, 1.16, -0.2, 0.16, 0.17, 0.25], [0, 1.43, -0.57, 0.24, 0.2, 0.18]
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
      const dewlap = ellipsoid(mats.face, 0.14, 0.27, 0.1);
      dewlap.position.set(0, 0.05, 0.18);
      dewlap.rotation.x = -0.18;
      neckPivot.add(dewlap);
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
      parts.horns.push(addHorn(headPivot, mats, speciesName, -1));
      parts.horns.push(addHorn(headPivot, mats, speciesName, 1));
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
      parts.horns.push(addHorn(headPivot, mats, speciesName, -1));
      parts.horns.push(addHorn(headPivot, mats, speciesName, 1));
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
      parts.horns = addStagAntlers(headPivot, mats);
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

  function bodyOf(animal) {
    const def = animal.def;
    if (!def.body) def.body = { radius: def.bodyRadius * def.scale,
      height: def.bodyHeight * def.scale, skin: 0.002 };
    return def.body;
  }

  function canStandAt(animal, x, z, feetY) {
    return physics.clear(worldRef, x, feetY, z, bodyOf(animal));
  }

  function verticallyOverlaps(animal, position, height) {
    const p = animal.group.position;
    return p.y + bodyOf(animal).height > position.y + 0.01 && p.y < position.y + height - 0.01;
  }

  function actorSpotClear(animal, x, z, padding) {
    const pad = padding || 0;
    if (goatRef && goatRef.group) {
      const g = goatRef.group.position;
      if (verticallyOverlaps(animal, g, 1.9) && Math.hypot(x - g.x, z - g.z) < 1.0 + pad) return false;
    }
    for (let i = 0; i < animals.length; i++) {
      const other = animals[i];
      if (other === animal) continue;
      const p = other.group.position;
      if (verticallyOverlaps(animal, p, bodyOf(other).height) && Math.hypot(x - p.x, z - p.z) < (animal.def.scale + other.def.scale) * 0.82 + pad) return false;
    }
    return true;
  }

  function moveStep(animal, nx, nz, yaw) {
    const p = animal.group.position;
    const s = animal.state;
    const loose = s.mode === 'climbBuild';

    if (!canStandAt(animal, nx, nz, p.y, yaw, loose)) return false;
    if (s.grounded && s.mode !== 'descend') {
      const floor = physics.support(worldRef, { x: nx, y: p.y, z: nz }, p.y + BODY_CLEARANCE, bodyOf(animal));
      if (p.y - floor > BLOCK + 0.25) return false;
    }

    // Avoid stepping down into water, while allowing dry bridges over it.
    function wetAt(x, z) {
      if (!worldRef.waterAt) return worldRef.isWaterColumn(Math.floor(x / BLOCK), Math.floor(z / BLOCK));
      const floor = physics.support(worldRef, { x: x, y: p.y, z: z }, p.y + BODY_CLEARANCE, bodyOf(animal));
      return !!worldRef.waterAt(x, Math.min(p.y, floor) + 0.1, z);
    }
    if (wetAt(nx, nz) && !wetAt(p.x, p.z)) return false;

    if (goatRef && goatRef.group) {
      const g = goatRef.group.position;
      const oldD = Math.hypot(p.x - g.x, p.z - g.z);
      const newD = Math.hypot(nx - g.x, nz - g.z);
      if (verticallyOverlaps(animal, g, 1.9) && newD < bodyOf(animal).radius + 0.42 && newD <= oldD + 0.00001) return false;
    }
    for (let i = 0; i < animals.length; i++) {
      const other = animals[i];
      if (other === animal) continue;
      const o = other.group.position;
      const min = bodyOf(animal).radius + bodyOf(other).radius;
      const oldD = Math.hypot(p.x - o.x, p.z - o.z);
      const newD = Math.hypot(nx - o.x, nz - o.z);
      if (verticallyOverlaps(animal, o, bodyOf(other).height) && newD < min && newD <= oldD + 0.00001) return false;
    }
    return true;
  }

  function jumpSurfaceAt(animal, nx, nz, yaw) {
    const s = animal.state;
    const p = animal.group.position;
    if (!s.grounded || s.jumpCooldown > 0) return null;

    const ledge = recovery.findLedge(worldRef, p, bodyOf(animal), nx - p.x, nz - p.z,
      function (x, z, top) { return canStandAt(animal, x, z, top); });
    return ledge ? ledge.top : null;
  }

  function startJump(animal, reason) {
    const s = animal.state;
    const p = animal.group.position;
    if (!s.grounded || s.jumpCooldown > 0) return false;
    s.vy = JUMP_SPEED;
    s.grounded = false;
    s.jumpCooldown = JUMP_COOLDOWN;
    s.tuck = 0;
    s.jumpReason = reason || 'hop';
    if (reason === 'ledge' || reason === 'stuck-ledge') s.recoveryJumps = (s.recoveryJumps || 0) + 1;
    if (audioRef && audioRef.actorJump) audioRef.actorJump(p, false);
    return true;
  }

  function moveAnimal(animal, dx, dz, yaw) {
    const s = animal.state;
    const p = animal.group.position;
    if (s.detourTarget && s.detourTime > 0) {
      const tx = s.detourTarget.x - p.x;
      const tz = s.detourTarget.z - p.z;
      const distance = Math.hypot(tx, tz);
      if (distance < 0.2) {
        s.detourTarget = null;
        s.detourTime = 0;
      } else {
        const amount = Math.hypot(dx, dz);
        dx = tx / distance * amount;
        dz = tz / distance * amount;
        yaw = Math.atan2(tx, tz);
      }
    }
    let moved = false;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.12));
    for (let i = 0; i < steps; i++) moved = moveAnimalStep(animal, dx / steps, dz / steps, yaw) || moved;
    return moved;
  }

  function moveAnimalStep(animal, dx, dz, yaw) {
    const p = animal.group.position;
    const x = p.x;
    const z = p.z;
    const s = animal.state;

    let moved = physics.moveHorizontal(worldRef, p, bodyOf(animal), dx, dz, function (nx, nz) {
      return moveStep(animal, nx, nz, yaw);
    });
    if (moved) return true;

    const len = Math.hypot(dx, dz);
    if (len > 0.0001) {
      // A blocked step is a request to hop, not an invitation to stand there
      // and grind against the block forever. The footprint stops the body
      // before its centre reaches the lip, so probe further ahead to find the
      // actual ledge.
      const probe = 1.35 + animal.def.scale * 0.45;
      const px = x + (dx / len) * probe;
      const pz = z + (dz / len) * probe;
      if ((s.recoveryJumps || 0) < 2 && s.grounded && jumpSurfaceAt(animal, px, pz, yaw)) {
        startJump(animal, 'ledge');
      }

      // If both cardinal axes are blocked, try to slide around the corner.
      // This is what keeps a long quarry walk from wedging on a rock or a
      // one-block cliff.
      if (!moved) {
        const sideAngles = [0.7, -0.7, 1.25, -1.25, 1.75, -1.75];
        for (let i = 0; i < sideAngles.length; i++) {
          const ca = Math.cos(sideAngles[i]);
          const sa = Math.sin(sideAngles[i]);
          const sx = dx * ca - dz * sa;
          const sz = dx * sa + dz * ca;
          if (moveStep(animal, x + sx, z + sz, yaw)) {
            p.x = x + sx;
            p.z = z + sz;
            moved = true;
            break;
          }
        }
      }
    }
    return moved;
  }

  function angleDelta(a, b) {
    return ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  }

  function nearestGround(x, z) {
    return worldRef.surfaceHeight(x, z);
  }

  // ------------------------------------------------------------------------
  // Wall projects
  // ------------------------------------------------------------------------
  const WALL_LENGTH = 10;
  const WALL_HEIGHT = 2;
  const WALL_TREE_DISTANCE = 10 * BLOCK;

  function cellCenter(bx, bz) {
    const bs = sizeOf();
    return { x: (bx + 0.5) * bs, z: (bz + 0.5) * bs };
  }

  function inSiteFootprint(project, bx, bz, margin) {
    const m = margin || 0;
    return bx >= project.site.bx - WALL_LENGTH / 2 - m &&
      bx < project.site.bx + WALL_LENGTH / 2 + m &&
      Math.abs(bz - project.site.bz) <= m;
  }

  function entityBlocksCell(animal, x, z, radius) {
    const r = radius || 1.4;
    if (goatRef && goatRef.group) {
      const g = goatRef.group.position;
      if (Math.hypot(x - g.x, z - g.z) < r + 1.0) return true;
    }
    for (let i = 0; i < animals.length; i++) {
      const other = animals[i];
      if (other === animal) continue;
      const q = other.group.position;
      if (Math.hypot(x - q.x, z - q.z) < r) return true;
    }
    return false;
  }

  function validSiteAt(animal, bx, bz) {
    const bs = sizeOf();
    const c = cellCenter(bx, bz);
    const groundY = worldRef.surfaceHeight(c.x, c.z);
    if (groundY < 0.01) return null;
    if (Math.abs(groundY - animal.group.position.y) > 0.1) return null;
    const baseBy = Math.round(groundY / bs);
    const tree = M.hearthTree && M.hearthTree.position;

    for (let dx = -WALL_LENGTH / 2; dx < WALL_LENGTH / 2; dx++) {
      // dz spans the wall row plus the two flanking rows builders stand on
      // while placing wall blocks. A site whose flanks tumble into a gully
      // looks fine on the wall line itself yet strands the builder on an
      // unreachable lip, so the whole five-row strip must be flat.
      for (let dz = -2; dz <= 2; dz++) {
        const px = (bx + dx + 0.5) * bs;
        const pz = (bz + dz + 0.5) * bs;
        if (tree && Math.hypot(px - tree.x, pz - tree.z) < WALL_TREE_DISTANCE) return null;
        if (worldRef.isPondArea(bx + dx, bz + dz)) return null;
        if (worldRef.isProtectedArea && worldRef.isProtectedArea(bx + dx, bz + dz)) return null;
        if (worldRef.isWaterColumn(bx + dx, bz + dz)) return null;
        if (Math.abs(worldRef.surfaceHeight(px, pz) - groundY) > 0.01) return null;
        if (!worldRef.canPlaceBlock(bx + dx, baseBy, bz + dz)) return null;
        for (let k = 0; k < WALL_HEIGHT + 1; k++) {
          if (worldRef.blockInfoAt(bx + dx, baseBy + k, bz + dz)) return null;
        }
        if (entityBlocksCell(animal, px, pz, 1.25)) return null;
      }
    }

    if (goatRef && goatRef.group) {
      const g = goatRef.group.position;
      if (Math.hypot(c.x - g.x, c.z - g.z) < 5.2) return null;
    }

    for (let i = 0; i < animals.length; i++) {
      const other = animals[i];
      if (other === animal || !other.state.project) continue;
      const os = other.state.project.site;
      if (Math.hypot(c.x - os.centerX, c.z - os.centerZ) < WALL_LENGTH * bs + 2) return null;
    }

    return {
      bx: bx,
      bz: bz,
      centerX: c.x,
      centerZ: c.z,
      groundY: groundY,
      baseBy: baseBy
    };
  }

  function chooseBuildSite(animal) {
    const bs = sizeOf();
    const p = animal.group.position;
    const anchorBX = Math.floor(p.x / bs);
    const anchorBZ = Math.floor(p.z / bs);

    for (let attempt = 0; attempt < 176; attempt++) {
      const angle = rand(0, Math.PI * 2);
      const distance = attempt < 96 ? rand(10, 20) : rand(20, 34);
      const bx = anchorBX + Math.round(Math.sin(angle) * distance / bs);
      const bz = anchorBZ + Math.round(Math.cos(angle) * distance / bs);
      const site = validSiteAt(animal, bx, bz);
      if (site) return site;
    }
    return null;
  }

  function makeBuildProject(animal, site) {
    const bs = sizeOf();
    const plan = [];
    for (let layer = 0; layer < WALL_HEIGHT; layer++) {
      for (let dx = -WALL_LENGTH / 2; dx < WALL_LENGTH / 2; dx++) {
        const bx = site.bx + dx;
        const bz = site.bz;
        const c = cellCenter(bx, bz);
        plan.push({
          phase: 'wall',
          bx: bx,
          bz: bz,
          by: site.baseBy + layer,
          x: c.x,
          z: c.z,
          top: (site.baseBy + layer + 1) * bs
        });
      }
    }

    return {
      site: site,
      plan: plan,
      stepCount: 0,
      steps: [],
      stuck: 0,
      invalid: 0,
      completed: false
    };
  }

  function nextBuildTarget(project) {
    if (!project) return null;
    for (let i = 0; i < project.plan.length; i++) {
      const target = project.plan[i];
      if (!worldRef.blockInfoAt(target.bx, target.by, target.bz)) return target;
    }
    return null;
  }

  function commitBuildTarget(project, target) {
    if (!project || !target) return;
    project.steps.push({
      bx: target.bx,
      bz: target.bz,
      x: target.x,
      z: target.z,
      by: target.by,
      top: target.top,
      phase: target.phase
    });
    project.stepCount = project.steps.length;
    project.stuck = 0;
  }

  function hasBuildTarget(project) {
    return !!nextBuildTarget(project);
  }

  // ------------------------------------------------------------------------
  // Quarrying
  // ------------------------------------------------------------------------
  // Quarries are shallow, deliberate patches rather than one endless hole. An
  // animal peels the top course across the patch, then the course below it,
  // and finally moves on to a fresh patch.
  // A quarry pass is intentionally local and shallow: shave the top turf
  // course around the animal, one block at a time. This keeps NPCs on the
  // surface instead of digging themselves into ever-deeper pits.
  function findSurfaceQuarryTarget(animal, project) {
    const p = animal.group.position;
    const player = goatRef.group.position;
    const bs = sizeOf();
    const levelY = project.site.groundY;
    if (Math.abs(p.y - levelY) > 0.35) return null;
    const bx0 = Math.floor(p.x / bs);
    const bz0 = Math.floor(p.z / bs);
    const r = Math.ceil(14.0 / bs);
    let best = null;
    let bestScore = Infinity;

    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const bx = bx0 + dx;
        const bz = bz0 + dz;
        const c = cellCenter(bx, bz);
        const dist = Math.hypot(c.x - p.x, c.z - p.z);
        if (dist < 1.65 || dist > 14.0) continue;
        // Guard the two flank rows the builder stands on while placing wall
        // blocks, so quarrying never carves pits under its own footing. The
        // wall row itself (dz 0) may be quarried freely: the finished wall
        // fills those cells again, and the survivors stay level.
        const flank = Math.abs(bz - project.site.bz);
        if (flank >= 1 && flank <= 2) continue;
        let nearSite = false;
        for (let i = 0; i < animals.length; i++) {
          const other = animals[i];
          if (other === animal || !other.state.project) continue;
          if (inSiteFootprint(other.state.project, bx, bz, 0)) {
            nearSite = true;
            break;
          }
        }
        if (nearSite) continue;
        if (worldRef.isPondArea(bx, bz) || worldRef.isWaterColumn(bx, bz)) continue;
        const info = worldRef.topSoilInfo(bx, bz);
        if (!info) continue;
        if (Math.abs(info.top - levelY) > 0.35 &&
            Math.abs(info.top - (levelY - BLOCK)) > 0.35) continue;
        if (!worldRef.canPlaceBlock(info.bx, info.by + 1, info.bz)) continue;
        if (Math.hypot(c.x - player.x, c.z - player.z) < 3.2) continue;
        let nearAnimal = false;
        for (let i = 0; i < animals.length; i++) {
          if (animals[i] === animal) continue;
          const op = animals[i].group.position;
          if (Math.hypot(c.x - op.x, c.z - op.z) < 1.7) {
            nearAnimal = true;
            break;
          }
        }
        if (nearAnimal) continue;

        const score = dist;
        if (score < bestScore) {
          bestScore = score;
          best = {
            type: 'terrain',
            bx: info.bx,
            by: info.by,
            bz: info.bz,
            kind: info.kind,
            x: c.x,
            y: info.top,
            z: c.z,
            approach: null
          };
        }
      }
    }
    return best;
  }

  function startQuarry(animal) {
    const s = animal.state;
    const project = s.project;
    if (!project || s.carryCount >= CARRY_LIMIT || !hasBuildTarget(project)) return false;

    const target = findSurfaceQuarryTarget(animal, project);
    if (!target) return false;

    s.action = {
      kind: 'break',
      target: target,
      approach: null,
      time: 0,
      duration: 0.62,
      hit: false,
      quarry: true
    };
    s.batchGoal = s.batchGoal || CARRY_LIMIT;
    s.gathering = true;
    s.quarryMisses = 0;
    beginAction(animal);
    return true;
  }

  function startCoinRun(animal) {
    const s = animal.state;
    if (!M.items || !M.items.nearestCoin || s.coinCooldown > 0) return false;
    const coin = M.items.nearestCoin(animal.group.position, 18);
    if (!coin) { s.coinCooldown = 2; return false; }
    s.coinTarget = coin; s.coinTime = 8; s.coinCooldown = 10;
    s.target.copy(coin.position); s.mode = 'walk'; s.wait = 0;
    return true;
  }

  function startTowerJob(animal) {
    const s = animal.state, p = animal.group.position;
    const def = M.towers && M.towers.builderDefinition(animal);
    // Establish a wall before mixing in a tower, preserving that wall project
    // across the detour. An unaffordable tower never blocks ordinary wall work.
    const wallWork = s.walls.length || s.project && s.project.stepCount >= 4;
    if (!def || !wallWork || s.towerTimer > 0 || s.coins < def.cost.coins) return false;
    const bx0 = Math.floor(p.x / BLOCK), bz0 = Math.floor(p.z / BLOCK);
    let target = null, score = Infinity;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const bx = bx0 + dx, bz = bz0 + dz, c = cellCenter(bx, bz);
      const distance = Math.hypot(c.x - p.x, c.z - p.z);
      if (distance < 2.4 || distance > 8 || distance >= score || entityBlocksCell(animal, c.x, c.z, 1.5)) continue;
      if (animals.some(other => [other.state.project, ...other.state.walls].some(project => project && inSiteFootprint(project, bx, bz, 1)))) continue;
      if (s.towerStone < def.cost.stone) {
        const info = worldRef.topSoilInfo(bx, bz);
        if (!info || !['grass', 'dirt', 'stone'].includes(info.kind) || worldRef.isPlacedBlock(bx, info.by, bz) ||
            worldRef.blockInfoAt(bx, info.by + 1, bz) ||
            info.top > p.y + .2 || info.top < p.y - BLOCK * 2 - .2 || worldRef.isWaterColumn(bx, bz)) continue;
        if (info.kind !== 'stone' && s.carryCount >= CARRY_LIMIT) continue;
        target = { type: 'terrain', bx, by: info.by, bz, x: c.x, z: c.z, y: info.top };
      } else {
        const by = Math.round(worldRef.landingHeight(c.x, c.z, p.y + .1) / BLOCK);
        if (Math.abs(by * BLOCK - p.y) > .2 || Math.hypot(c.x, c.z) < WALL_TREE_DISTANCE ||
            !M.towers.site(def.id, bx, by, bz).valid) continue;
        if (M.towers.list.some(tower => Math.hypot(tower.position.x - c.x, tower.position.z - c.z) < 6)) continue;
        target = { bx, by, bz, x: c.x, z: c.z, top: (by + def.height) * BLOCK };
      }
      score = distance;
    }
    if (!target) { s.towerTimer = 8; return false; }
    if (s.towerStone < def.cost.stone) {
      s.action = { kind: 'break', target, time: 0, duration: .72, hit: false, towerQuarry: true };
      beginAction(animal);
    } else {
      const approach = findApproach(animal, target.x, target.z, 2.5, { levelY: p.y, maxRise: BLOCK + .45 });
      if (!approach) { s.towerTimer = 8; return false; }
      s.action = { kind: 'place', target, approach, time: 0, duration: 1.2, hit: false, towerBuild: true };
      s.mode = 'seekPlace'; s.seekTime = 9; s.stuck = 0;
    }
    return true;
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
      if (worldRef.isWaterColumn(Math.floor(x / BLOCK), Math.floor(z / BLOCK))) continue;
      if (worldRef.isPondArea(Math.floor(x / BLOCK), Math.floor(z / BLOCK))) continue;
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

  function findApproach(animal, tx, tz, preferredDistance, options) {
    const opts = options || {};
    const p = animal.group.position;
    const base = Math.atan2(p.x - tx, p.z - tz);
    const offsets = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, Math.PI];
    const distances = [preferredDistance || 2.35, 2.8, 3.3];
    const maxRise = opts.maxRise || 3.2;
    let best = null;
    let bestScore = Infinity;

    for (let d = 0; d < distances.length; d++) {
      for (let o = 0; o < offsets.length; o++) {
        const angle = base + offsets[o];
        const distance = distances[d];
        const x = tx + Math.sin(angle) * distance;
        const z = tz + Math.cos(angle) * distance;
        if (worldRef.isWaterColumn(Math.floor(x / BLOCK), Math.floor(z / BLOCK))) continue;
        const y = nearestGround(x, z);
        if (Math.abs(y - p.y) > maxRise) continue;
        if (opts.levelY !== undefined && Math.abs(y - opts.levelY) > 0.45) continue;
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

  function targetUnsafeForPlacement(animal, x, z) {
    const p = animal.group.position;
    if (Math.hypot(x - p.x, z - p.z) < 1.15) return true;
    if (goatRef && goatRef.group) {
      const g = goatRef.group.position;
      if (Math.hypot(x - g.x, z - g.z) < 1.75) return true;
    }
    for (let i = 0; i < animals.length; i++) {
      if (animals[i] === animal) continue;
      const op = animals[i].group.position;
      if (Math.hypot(x - op.x, z - op.z) < 1.25) return true;
    }
    return false;
  }

  function abandonProject(animal, reason) {
    const s = animal.state;
    s.lastAbandon = reason || 'unknown';
    s.project = null;
    s.gathering = false;
    s.batchGoal = 0;
    s.action = null;
    s.pendingClimb = null;
    s.buildTimer = rand(10, 18);
    s.mode = 'idle';
    s.wait = rand(0.8, 1.8);
    s.stuck = 0;
  }

  function startBuild(animal) {
    const s = animal.state;
    const p = animal.group.position;
    const project = s.project;
    if (!project || s.carryCount <= 0 || !s.carry) return false;

    const target = nextBuildTarget(project);
    if (!target) {
      project.completed = true;
      return false;
    }

    if (targetUnsafeForPlacement(animal, target.x, target.z)) {
      if (Math.hypot(target.x - p.x, target.z - p.z) < 1.15) {
        const approach = findApproach(animal, target.x, target.z, 2.35, {
          levelY: project.site.groundY,
          maxRise: BLOCK + 0.45
        });
        if (approach) {
          s.action = { kind: 'place', target: target, approach: approach,
            time: 0, duration: 0.68, hit: false, build: true };
          s.mode = 'seekPlace';
          s.seekTime = 9;
          s.stuck = 0;
          s.gathering = false;
          return true;
        }
      }
      s.wait = rand(0.5, 1.0);
      return false;
    }

    if (!worldRef.canPlaceBlock(target.bx, target.by, target.bz)) {
      const existing = worldRef.blockInfoAt(target.bx, target.by, target.bz);
      if (existing) {
        project.invalid = 0;
        return false;
      }
      project.invalid++;
      if (project.invalid > 5) abandonProject(animal, 'invalid-target');
      return false;
    }

    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const reach = Math.hypot(dx, dz);
    const levelOk = p.y >= target.top - BLOCK * 2 - 0.4 && p.y <= target.top + 0.4;
    if (!levelOk || reach > 3.7) {
      const approach = findApproach(animal, target.x, target.z, 2.35, {
        levelY: project.site.groundY,
        maxRise: BLOCK + 0.45
      });
      if (!approach) {
        project.invalid++;
        if (project.invalid > 5) abandonProject(animal, 'no-approach');
        return false;
      }
      s.action = {
        kind: 'place',
        target: target,
        approach: approach,
        time: 0,
        duration: 0.68,
        hit: false,
        build: true
      };
      s.mode = 'seekPlace';
      s.seekTime = 9;
      s.stuck = 0;
      s.gathering = false;
      return true;
    }

    s.action = {
      kind: 'place',
      target: target,
      approach: null,
      time: 0,
      duration: 0.62,
      hit: false,
      build: true
    };
    s.gathering = false;
    beginAction(animal);
    return true;
  }

  function startClimb(animal, target) {
    const s = animal.state;
    if (!target) return false;
    const bs = sizeOf();
    s.pendingClimb = {
      bx: target.bx,
      bz: target.bz,
      x: target.x,
      z: target.z,
      top: target.top || (target.by + 1) * bs
    };
    s.action = null;
    s.mode = 'climbBuild';
    s.seekTime = 5.0;
    s.stuck = 0;
    s.speed = 0;
    s.climbTries = 0;
    return true;
  }

  function finishClimb(animal) {
    const s = animal.state;
    s.pendingClimb = null;
    s.speed = 0;
    s.stuck = 0;
    s.mode = s.escape ? 'escape' : 'idle';
    s.wait = 0.12;
    if (s.escape) {
      s.escape.stage = 'choose';
      s.escape.climbed = true;
      s.escape.dug = false;
    }
  }

  function updateClimb(animal, dt) {
    const s = animal.state;
    const p = animal.group.position;
    const c = s.pendingClimb;
    if (!c) {
      finishClimb(animal);
      return;
    }
    s.seekTime -= dt;
    const dx = c.x - p.x;
    const dz = c.z - p.z;
    const dist = Math.hypot(dx, dz);

    if (s.grounded && Math.abs(p.y - c.top) < 0.12 && dist < 1.28) {
      if (dist > 0.18 && canStandAt(animal, c.x, c.z, c.top, s.yaw, true)) {
        p.x = c.x;
        p.z = c.z;
      }
      finishClimb(animal);
      return;
    }

    // Reliable hop onto the next stair block. The same jump animation plays,
    // but the landing is constrained to the actual step instead of depending
    // on a pixel-perfect horizontal drift.
    if (!s.grounded && p.y >= c.top - 0.08 &&
        s.vy <= 1.8 && dist < 3.2 &&
        canStandAt(animal, c.x, c.z, c.top, s.yaw, true)) {
      p.x = c.x;
      p.z = c.z;
      p.y = c.top;
      s.vy = 0;
      s.grounded = true;
      s.landPulse = 1;
      finishClimb(animal);
      return;
    }

    const yaw = Math.atan2(dx, dz);
    s.yaw = turnToward(s.yaw, yaw, dt * 6);
    if (s.grounded && c.top > p.y + 0.25 && dist < 3.2 &&
        canStandAt(animal, c.x, c.z, c.top, s.yaw, true)) {
      startJump(animal, 'climb');
    }
    const speed = defWalkSpeed(animal) * (s.grounded ? 1.2 : AIR_CONTROL);
    s.speed = damp(s.speed, speed, 7, dt);
    const moved = moveAnimal(
      animal,
      Math.sin(yaw) * s.speed * dt,
      Math.cos(yaw) * s.speed * dt,
      s.yaw
    );
    if (moved) {
      s.walkPhase += s.speed * dt * 4.3;
      s.stuck = 0;
    } else if (s.grounded) {
      s.stuck += dt;
      if (s.stuck > 0.45) {
        startJump(animal, 'climb');
        s.stuck = 0;
      }
    }

    // Once the body has cleared the new block, allow a little extra forward
    // air control so a two-metre hop reliably carries it over the lip and
    // onto the stair instead of landing back on the block below.
    if (!s.grounded && p.y > c.top + 0.03 && dist > 0.45) {
      const pull = Math.max(1.7, defWalkSpeed(animal) * 2.0) * dt;
      const amount = Math.min(dist, pull);
      const nx = p.x + (dx / dist) * amount;
      const nz = p.z + (dz / dist) * amount;
      if (moveStep(animal, nx, nz, s.yaw)) {
        p.x = nx;
        p.z = nz;
        s.stuck = 0;
      }
    }

    if (s.seekTime <= 0) {
      s.climbTries = (s.climbTries || 0) + 1;
      if (s.climbTries < 4) {
        s.seekTime = 2.2;
        return;
      }
      // Last-resort mount after several failed hops. It is deliberately
      // conservative: only when the destination is a real, standable top.
      if (canStandAt(animal, c.x, c.z, c.top, s.yaw, true)) {
        p.x = c.x;
        p.z = c.z;
        p.y = c.top;
        s.vy = 0;
        s.grounded = true;
        s.landPulse = 1;
        finishClimb(animal);
      } else {
        s.pendingClimb = null;
        s.mode = s.escape ? 'escape' : 'idle';
        s.wait = 0.35;
        s.speed = 0;
      }
    }
  }

  function startDescend(animal) {
    const s = animal.state;
    const p = animal.group.position;
    const project = s.project;
    if (!project) return false;
    let angle = Math.atan2(p.x - project.site.centerX, p.z - project.site.centerZ);
    if (!Number.isFinite(angle) || (Math.abs(p.x - project.site.centerX) < 0.01 &&
      Math.abs(p.z - project.site.centerZ) < 0.01)) {
      angle = rand(0, Math.PI * 2);
    }
    const distance = rand(7.0, 9.5);
    s.descendTarget = {
      x: project.site.centerX + Math.sin(angle) * distance,
      z: project.site.centerZ + Math.cos(angle) * distance
    };
    s.mode = 'descend';
    s.seekTime = 11;
    s.stuck = 0;
    s.speed = 0;
    if (!s.descendTime) s.descendTime = 0;
    s.action = null;
    s.pendingClimb = null;
    s.gathering = false;
    return true;
  }

  function updateDescend(animal, dt) {
    const s = animal.state;
    const p = animal.group.position;
    const project = s.project;
    const groundY = project ? project.site.groundY : nearestGround(p.x, p.z);
    if (s.grounded && p.y <= groundY + 0.22) {
      s.mode = 'idle';
      s.wait = rand(0.3, 0.8);
      s.speed = 0;
      s.descendTarget = null;
      s.descendTime = 0;
      return;
    }

    s.descendTime = (s.descendTime || 0) + dt;
    if (s.descendTime > 6.5) {
      // Relocation is the final fallback after physical recovery and repeated
      // descent attempts have failed.
      s.descendTime = 0;
      rescueAnimal(animal);
      return;
    }

    s.seekTime -= dt;
    if (!s.descendTarget) {
      if (!startDescend(animal)) {
        s.mode = 'idle';
        s.wait = 0.5;
      }
      return;
    }

    const dx = s.descendTarget.x - p.x;
    const dz = s.descendTarget.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.55 && s.grounded && p.y <= groundY + 0.22) {
      s.mode = 'idle';
      s.wait = rand(0.3, 0.8);
      s.speed = 0;
      s.descendTarget = null;
      return;
    }

    const yaw = Math.atan2(dx, dz);
    s.yaw = turnToward(s.yaw, yaw, dt * 4.5);
    const speed = defWalkSpeed(animal) * (s.grounded ? 1.15 : AIR_CONTROL);
    s.speed = damp(s.speed, speed, 5, dt);
    const moved = moveAnimal(
      animal,
      Math.sin(yaw) * s.speed * dt,
      Math.cos(yaw) * s.speed * dt,
      s.yaw
    );
    if (moved) {
      s.walkPhase += s.speed * dt * 4.2;
      s.stuck = 0;
    } else if (s.grounded) {
      s.stuck += dt;
      if (s.stuck > 0.4) {
        startJump(animal, 'descend');
        s.stuck = 0;
      }
    }

    if (s.seekTime <= 0) {
      if (s.grounded && p.y <= groundY + 0.22) {
        s.mode = 'idle';
        s.wait = 0.4;
      } else {
        startDescend(animal);
      }
    }
  }

  function setCarried(animal, kind, count) {
    const s = animal.state;
    if (s.carriedMesh) {
      if (s.carriedMesh.parent) s.carriedMesh.parent.remove(s.carriedMesh);
      s.carriedMesh = null;
    }

    const n = Math.max(0, Math.floor(count || 0));
    s.carry = n > 0 ? kind : null;
    s.carryCount = n;
    s.carryPop = n > 0 ? 1 : 0;
    if (n <= 0 || !kind || !worldRef.makeBlockMesh) return;

    const carry = animal.def.carry;
    const group = new THREE.Group();
    const shown = Math.min(3, n);
    for (let i = 0; i < shown; i++) {
      const mesh = worldRef.makeBlockMesh(kind);
      mesh.scale.setScalar(carry.scale);
      const offset = i - (shown - 1) / 2;
      mesh.position.set(offset * 0.055, offset * carry.scale * 1.08, -Math.abs(offset) * 0.025);
      mesh.rotation.y = carry.rot + i * 0.24;
      mesh.rotation.z = 0.03;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    group.userData.count = n;
    animal.parts.carryAnchor.add(group);
    s.carriedMesh = group;
  }

  function addCarry(animal, kind, amount) {
    const s = animal.state;
    const cap = CARRY_LIMIT + (s.escape ? 1 : 0);
    if (s.carryCount >= cap) return false;
    const next = Math.min(cap, s.carryCount + (amount || 1));
    setCarried(animal, kind, next);
    return true;
  }

  function consumeCarry(animal) {
    const s = animal.state;
    if (s.carryCount <= 0 || !s.carry) return false;
    setCarried(animal, s.carry, s.carryCount - 1);
    return true;
  }

  function beginAction(animal) {
    const s = animal.state;
    const action = s.action;
    s.mode = action.kind === 'break' ? 'break' : 'place';
    s.action.time = 0;
    s.action.hit = false;
    s.action.result = null;
    s.speed = 0;
    s.yaw = Math.atan2(action.target.x - animal.group.position.x, action.target.z - animal.group.position.z);
    animal.group.rotation.y = s.yaw;
  }

  function finishSeek(animal, failed) {
    const s = animal.state;
    const wasBuild = !!(s.action && s.action.build);
    s.action = null;
    s.speed = 0;
    s.stuck = 0;
    if (s.escape) {
      s.mode = 'escape';
      s.wait = 0.2;
      return;
    }
    s.mode = 'idle';
    s.wait = failed ? 0.45 : 0.2;
    if (failed) {
      s.seekFailures = (s.seekFailures || 0) + 1;
      // A wall builder that cannot reach its place target will otherwise
      // retry the same impossible approach forever. Give the wall up after a
      // few failed runs so a fresh, reachable site gets chosen instead.
      if (wasBuild && s.project && s.seekFailures >= 4) {
        s.seekFailures = 0;
        abandonProject(animal, 'approach-stuck');
      }
    }
  }

  function applyAction(animal) {
    const s = animal.state;
    const action = s.action;
    if (!action) return;
    const p = animal.group.position;

    if (action.kind === 'break') {
      const target = action.target;
      const kind = worldRef.breakBlockAt(target.bx, target.by, target.bz, {
        drop: false,
        protectPlaced: !action.escape
      });
      if (kind) {
        // A recovery dig can pack a cannon. Its one intact item stays on the
        // ground; builders must not turn a second copy into wall material.
        if (action.towerQuarry && kind === 'stone') s.towerStone++;
        else if (!(M.towers && M.towers.itemDefinition(kind))) addCarry(animal, kind, 1);
        if (action.escape && s.escape) {
          s.escape.opened = { bx: target.bx, by: target.by, bz: target.bz };
          s.escape.dug = true;
        }
        s.happy = Math.max(s.happy || 0, 0.45);
        action.result = 'broke';
      } else {
        action.result = 'failed';
      }
    } else if (action.kind === 'place') {
      const target = action.target;
      if (action.towerBuild) {
        const tower = M.towers && M.towers.placeBuilder(animal, target.bx, target.by, target.bz);
        action.result = tower ? 'placed' : 'failed';
        if (tower) { s.towersBuilt++; s.happy = 1; }
        s.towerTimer = tower ? 60 : 10;
      } else if (s.carryCount <= 0 || !s.carry) {
        action.result = 'failed';
      } else if (targetUnsafeForPlacement(animal, target.x, target.z)) {
        action.result = 'failed';
      } else if (!worldRef.canPlaceBlock(target.bx, target.by, target.bz)) {
        action.result = 'failed';
      } else if (worldRef.placeBlock(s.carry, target.bx, target.by, target.bz)) {
        const bodyH = animal.def.bodyHeight * animal.def.scale;
        if (worldRef.blockedAt(p.x, p.z, p.y + 0.03, p.y + bodyH)) {
          // Safety net: never let a placement swallow the builder's own body.
          worldRef.breakBlockAt(target.bx, target.by, target.bz, {
            drop: false,
            protectPlaced: false
          });
          action.result = 'failed';
        } else {
          action.result = 'placed';
          if (action.build && s.project) commitBuildTarget(s.project, target);
          consumeCarry(animal);
          s.happy = Math.max(s.happy || 0, 0.6);
        }
      } else {
        action.result = 'failed';
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
    const distanceToApproach = approach
      ? Math.hypot(approach.x - p.x, approach.z - p.z)
      : Infinity;

    const levelOk = !action.build ||
      (p.y >= target.top - BLOCK * 2 - 0.4 && p.y <= target.top + 0.4);
    if ((approach ? distanceToApproach < 0.7 : distanceToTarget < 3.7) && levelOk) {
      const desiredYaw = Math.atan2(target.x - p.x, target.z - p.z);
      s.yaw = turnToward(s.yaw, desiredYaw, dt * 9);
      s.speed = damp(s.speed, 0, 8, dt);
      if (Math.abs(angleDelta(s.yaw, desiredYaw)) < 0.25 || s.seekTime < 1.3) {
        beginAction(animal);
      }
    } else {
      const dx = approach.x - p.x;
      const dz = approach.z - p.z;
      const desiredYaw = Math.atan2(dx, dz);
      s.yaw = turnToward(s.yaw, desiredYaw, dt * 4.8);
      const speed = defWalkSpeed(animal) * (s.grounded ? 1.25 : AIR_CONTROL);
      s.speed = damp(s.speed, speed, 5, dt);
      const moved = moveAnimal(
        animal,
        Math.sin(desiredYaw) * s.speed * dt,
        Math.cos(desiredYaw) * s.speed * dt,
        s.yaw
      );
      if (moved) {
        s.walkPhase += s.speed * dt * 4.2;
        s.stuck = 0;
      } else if (s.grounded) {
        s.stuck += dt;
      }
    }

    if (s.seekTime <= 0 || s.stuck > 1.8) finishSeek(animal, true);
  }

  function updateAction(animal, dt) {
    const s = animal.state;
    const action = s.action;
    if (!action) {
      s.mode = 'idle';
      s.wait = 1;
      return;
    }

    action.time += dt * (M.upgrades ? M.upgrades.stats(animal).craft : 1);
    if (!action.hit && action.time >= 0.22) applyAction(animal);
    if (action.time < action.duration) return;

    const result = action.result;
    const wasBuild = !!action.build;
    const wasEscape = !!action.escape;
    const escapePlace = !!action.escapePlace;
    const target = action.target;
    s.action = null;
    s.speed = 0;

    if (wasEscape && escapePlace && result === 'placed') {
      startEscapeClimb(animal, target);
      return;
    }
    if (s.escape) {
      s.mode = 'escape';
      s.wait = 0.18;
      s.escape.stage = 'choose';
      return;
    }

    s.mode = 'idle';
    s.wait = result === 'placed' || result === 'broke' ? 0.2 : 0.55;
    if (result === 'failed' && wasBuild && s.project) {
      s.project.invalid++;
      if (s.project.invalid > 5) abandonProject(animal, 'place-failed');
    }
  }

  function updateGravity(animal, dt) {
    const s = animal.state, p = animal.group.position, body = bodyOf(animal);
    let groundY = physics.support(worldRef, p, p.y + BODY_CLEARANCE, body);
    if (s.grounded) {
      if (p.y > groundY + 0.02) { s.grounded = false; s.vy = 0; }
      else { p.y = groundY; s.vy = 0; }
    }
    if (!s.grounded) {
      const previous = p.y;
      s.vy = Math.max(-38, s.vy - GRAVITY * dt);
      const next = p.y + s.vy * dt;
      groundY = physics.support(worldRef, p, Math.max(previous, next) + 0.001, body);
      const landing = s.vy <= 0 && next <= groundY;
      const clear = physics.moveVertical(worldRef, p, body, landing ? groundY : next);
      if (!clear) s.vy = 0;
      if ((landing && clear) || (!clear && next < previous)) {
        s.vy = 0; s.grounded = true; s.tuck = 0; s.landPulse = 1;
        if (audioRef && audioRef.actorJump) audioRef.actorJump(p, true);
      }
    }
    s.landPulse = Math.max(0, (s.landPulse || 0) - dt * 4);
    if (p.y < -6) rescueAnimal(animal);
  }

  function escapeDirection(animal) {
    const p = animal.group.position;
    let best = { x: 0, z: 1, score: -Infinity };
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * Math.PI * 2;
      const sx = Math.sin(angle);
      const sz = Math.cos(angle);
      let score = 0;
      for (let d = 1; d <= 3; d++) {
        score += worldRef.surfaceHeight(p.x + sx * d * 1.2, p.z + sz * d * 1.2) / d;
      }
      if (score > best.score) best = { x: sx, z: sz, score: score };
    }
    return best;
  }

  function pitStatus(animal) {
    const p = animal.group.position;
    const s = animal.state;
    if (!s.grounded) return { trapped: false, depth: 0, walls: 0, direction: escapeDirection(animal) };

    let maxGround = worldRef.surfaceHeight(p.x, p.z);
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * Math.PI * 2;
      for (let d = 1.5; d <= 3.4; d += 0.9) {
        const h = worldRef.surfaceHeight(p.x + Math.sin(angle) * d, p.z + Math.cos(angle) * d);
        if (h > maxGround) maxGround = h;
      }
    }

    const bodyH = animal.def.bodyHeight * animal.def.scale;
    let walls = 0;
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * Math.PI * 2;
      let blocked = false;
      for (let d = 1.35; d <= 2.55; d += 1.2) {
        if (worldRef.blockedAt(
          p.x + Math.sin(angle) * d,
          p.z + Math.cos(angle) * d,
          p.y + 0.35,
          p.y + bodyH * 0.72
        )) {
          blocked = true;
          break;
        }
      }
      if (blocked) walls++;
    }

    const depth = maxGround - p.y;
    // A random two-metre ledge at the edge of a plateau is not a pit: every
    // animal can simply hop back up. Only genuine depressions and enclosed
    // holes trigger the dig-out routine.
    const trapped =
      (depth > 2.2 && walls >= 4) ||
      (depth > 3.2 && walls >= 2) ||
      (depth > 1.2 && walls >= 7);
    return {
      trapped: trapped,
      depth: depth,
      walls: walls,
      rim: maxGround,
      direction: escapeDirection(animal)
    };
  }

  function shouldEscape(animal) {
    const s = animal.state;
    if (!s.grounded || s.escape || s.action) return false;
    if (s.mode === 'climbBuild' || s.mode === 'descend') return false;
    return pitStatus(animal).trapped;
  }

  function findEscapePlace(animal) {
    const p = animal.group.position;
    const bs = sizeOf();
    const bx0 = Math.floor(p.x / bs);
    const bz0 = Math.floor(p.z / bs);
    const feetBy = Math.round(p.y / bs);
    const dir = escapeDirection(animal);
    const bodyH = animal.def.bodyHeight * animal.def.scale;
    let best = null;
    let bestScore = Infinity;

    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const bx = bx0 + dx;
        const bz = bz0 + dz;
        const cx = (bx + 0.5) * bs;
        const cz = (bz + 0.5) * bs;
        const dist = Math.hypot(cx - p.x, cz - p.z);
        if (dist < 1.2 || dist > 3.1) continue;
        if (!worldRef.canPlaceBlock(bx, feetBy, bz)) continue;
        if (worldRef.blockedAt(cx, cz, p.y + BLOCK + 0.08, p.y + BLOCK + bodyH + 0.1)) continue;
        if (targetUnsafeForPlacement(animal, cx, cz)) continue;
        const dot = ((cx - p.x) / dist) * dir.x + ((cz - p.z) / dist) * dir.z;
        const score = dist - dot * 0.9;
        if (score < bestScore) {
          bestScore = score;
          best = {
            phase: 'escape',
            bx: bx,
            bz: bz,
            by: feetBy,
            x: cx,
            z: cz,
            top: p.y + BLOCK
          };
        }
      }
    }
    return best;
  }

  function findEscapeWall(animal, status) {
    const p = animal.group.position;
    const bs = sizeOf();
    const bx0 = Math.floor(p.x / bs);
    const bz0 = Math.floor(p.z / bs);
    const feetBy = Math.round(p.y / bs);
    const dir = status.direction;
    let best = null;
    let bestScore = Infinity;

    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const bx = bx0 + dx;
        const bz = bz0 + dz;
        const cx = (bx + 0.5) * bs;
        const cz = (bz + 0.5) * bs;
        const dist = Math.hypot(cx - p.x, cz - p.z);
        if (dist < 1.2 || dist > 3.1) continue;

        for (let layer = 0; layer < 2; layer++) {
          const by = feetBy + layer;
          const info = worldRef.blockInfoAt(bx, by, bz);
          if (!info || info.type === 'placed') continue;
          if (info.type === 'prop') continue;
          const below = worldRef.blockInfoAt(bx, by - 1, bz);
          const isStepWall = layer === 1 && !!below;
          const dot = ((cx - p.x) / dist) * dir.x + ((cz - p.z) / dist) * dir.z;
          let score = dist - dot * 1.4 + (isStepWall ? 0 : 2.2) + layer * 0.4;
          if (score < bestScore) {
            bestScore = score;
            best = {
              type: info.type,
              bx: bx,
              by: by,
              bz: bz,
              kind: info.kind,
              x: cx,
              y: (by + 1) * bs,
              z: cz,
              isStepWall: isStepWall
            };
          }
        }
      }
    }
    return best;
  }

  function startEscapeClimb(animal, step) {
    const s = animal.state;
    s.pendingClimb = {
      bx: step.bx,
      bz: step.bz,
      x: step.x,
      z: step.z,
      top: step.top
    };
    s.mode = 'climbBuild';
    s.seekTime = 4.5;
    s.stuck = 0;
    s.speed = 0;
    s.escape.stage = 'climb';
    s.escape.attempts++;
  }

  function advanceEscape(animal) {
    const s = animal.state;
    const p = animal.group.position;
    if (!s.escape) return;
    if (s.escape.time > ESCAPE_TIMEOUT || s.escape.attempts > 16) {
      rescueAnimal(animal);
      return;
    }
    if (!s.grounded) return;

    const rim = s.escape.rim !== undefined ? s.escape.rim : p.y;
    if (p.y >= rim - 0.25) {
      endEscape(animal);
      return;
    }

    const preferred = s.escape.preferred;
    if (s.escape.opened && !pitStatus(animal).trapped && preferred &&
        !recovery.blockedAhead(worldRef, p, bodyOf(animal), preferred.x, preferred.z)) {
      endEscape(animal);
      return;
    }
    const wall = recovery.findDig(worldRef, p, bodyOf(animal), preferred);
    if (wall) {
      s.escape.stage = 'dig';
      s.action = {
        kind: 'break', target: wall, approach: null,
        time: 0, duration: 0.58, hit: false, escape: true
      };
      s.mode = 'seekBreak';
      s.seekTime = 2.5;
      s.escape.attempts++;
      beginAction(animal);
      return;
    }

    const step = recovery.findStep(worldRef, p, bodyOf(animal), function (x, z, top) {
      return canStandAt(animal, x, z, top) && actorSpotClear(animal, x, z, 0.1);
    }, preferred);
    if (step) {
      startEscapeClimb(animal, step);
      return;
    }

    if (s.carryCount > 0) {
      const place = recovery.findPlacement(worldRef, p, bodyOf(animal),
        function (bx, by, bz, x, z) {
          return worldRef.canPlaceBlock(bx, by, bz) && !targetUnsafeForPlacement(animal, x, z);
        }, preferred);
      if (place) {
        s.escape.stage = 'build';
        s.action = {
          kind: 'place', target: place, approach: null,
          time: 0, duration: 0.58, hit: false, escape: true, escapePlace: true
        };
        s.mode = 'seekPlace';
        s.seekTime = 2.5;
        s.escape.attempts++;
        beginAction(animal);
        return;
      }
    }

    if (s.grounded) startJump(animal, 'escape');
  }

  function startEscape(animal, preferred) {
    const s = animal.state;
    const p = animal.group.position;
    s.escape = {
      time: 0,
      attempts: 0,
      stage: 'choose',
      preferred: preferred || null,
      resumeMode: s.mode,
      opened: null,
      dug: false,
      noWall: false
    };
    s.mode = 'escape';
    s.action = null;
    s.pendingClimb = null;
    s.detourTarget = null;
    s.detourTime = 0;
    s.gathering = false;
    s.speed = 0;
    s.stuck = 0;
    s.wait = 0;
    s.escapeCooldown = 1.2;
    const status = pitStatus(animal);
    const solid = preferred && recovery.blockedAhead(worldRef, p, bodyOf(animal), preferred.x, preferred.z);
    s.escape.rim = Math.max(status.rim || p.y, p.y + (solid || status.walls >= 5 ? BLOCK : 0));
  }

  function endEscape(animal) {
    const s = animal.state;
    const resumeMode = s.escape && s.escape.resumeMode;
    s.escape = null;
    s.pendingClimb = null;
    s.mode = resumeMode === 'walk' || (resumeMode === 'hunt' && s.huntTarget) ? resumeMode : 'idle';
    s.wait = 0.25;
    s.speed = 0;
    s.gathering = false;
    s.escapeCooldown = 2.0;
    s.pitTimer = 0.8;
    if (s.retired && !s.project) setCarried(animal, null, 0);
  }

  function updateEscape(animal, dt) {
    const s = animal.state;
    if (!s.escape) {
      s.mode = 'idle';
      s.wait = 0.3;
      return;
    }
    s.escape.time += dt;
    if (s.wait > 0) {
      s.wait -= dt;
      return;
    }
    if (!s.grounded || s.action) return;
    advanceEscape(animal);
  }

  function rescueAnimal(animal) {
    const s = animal.state;
    const p = animal.group.position;
    let spot = null;
    for (let radius = 3.0; radius <= 12 && !spot; radius += 1.5) {
      for (let i = 0; i < 16; i++) {
        const angle = i / 16 * Math.PI * 2;
        const x = p.x + Math.sin(angle) * radius;
        const z = p.z + Math.cos(angle) * radius;
        const y = worldRef.surfaceHeight(x, z);
        if (y < 0.1) continue;
        if (!canStandAt(animal, x, z, y, s.yaw)) continue;
        if (goatRef && goatRef.group) {
          const g = goatRef.group.position;
          if (Math.hypot(x - g.x, z - g.z) < 2.2) continue;
        }
        spot = { x: x, y: y, z: z };
        break;
      }
    }
    if (!spot) {
      spot = findSpawnNear(p.x, p.z, 3.0, 12.0, animal);
    }

    if (spot) {
      p.x = spot.x;
      p.y = spot.y;
      p.z = spot.z;
      s.grounded = true;
      s.vy = 0;
      s.landPulse = 1;
      s.mode = 'idle';
      s.wait = rand(0.5, 1.2);
      s.speed = 0;
      s.action = null;
      s.pendingClimb = null;
      s.escape = null;
      s.descendTarget = null;
      s.descendTime = 0;
      s.gathering = false;
      s.buriedTime = 0;
      s.detourTarget = null;
      s.detourTime = 0;
      s.detourCount = 0;
      s.recovery.rescues++;
      recovery.reset(s.recovery);
    }
  }

  // After a long wheel spin the hip angle is some large multiple of two pi;
  // fold it back into the nearest turn before easing back into the walk gait,
  // so the legs wind down instead of unwinding a full rotation backwards.
  function foldAngle(a) { return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; }

  function updateVisual(animal, dt, t) {
    const s = animal.state;
    const parts = animal.parts;
    const def = animal.def;
    const moving = s.speed > 0.08;
    s.stride = damp(s.stride || 0, moving ? clamp(s.speed / def.walkSpeed, 0, 1.2) : 0, 10, dt);
    const stride = s.stride;
    const footBeat = Math.floor(s.walkPhase / Math.PI);
    if (moving && s.grounded && s.footBeat !== undefined && s.footBeat !== footBeat && audioRef && audioRef.actorStep) audioRef.actorStep(animal.species, animal.group.position);
    s.footBeat = footBeat;
    const turn = angleDelta(s.visualYaw === undefined ? s.yaw : s.visualYaw, s.yaw);
    s.visualYaw = s.yaw;
    parts.rig.rotation.z = damp(parts.rig.rotation.z, M.config.reducedMotion ? 0 : -clamp(turn / Math.max(dt, 0.001), -3, 3) * stride * 0.035, 8, dt);
    const squash = M.config.reducedMotion ? 0 : (s.landPulse || 0);
    parts.rig.scale.set(1 + squash * 0.025, 1 - squash * 0.055, 1 + squash * 0.025);
    const grazing = s.mode === 'graze' ? 1 : 0;
    s.grazePose = damp(s.grazePose || 0, grazing, 4.2, dt);

    if (s.carry && s.mode === 'graze') {
      // An animal with a block between its horns does not put its face in
      // the grass; it keeps browsing with its head up.
      s.grazePose = damp(s.grazePose, 0, 8, dt);
    }

    s.tuck = damp(s.tuck || 0, s.grounded ? 0 : 1, 11, dt);
    const tuck = s.tuck;
    // Fleet hooves and Long horns train the herd with the same visible
    // transformations as the player goat: glowing bands up the legs, wheel
    // rims at tier 3, and charging elemental horns that pulse.
    const speedLevel = M.upgrades && M.upgrades.level ? M.upgrades.level(animal, 'move') : 0;
    const hornLevel = M.upgrades && M.upgrades.level ? M.upgrades.level(animal, 'reach') : 0;
    const cadenceLevel = M.upgrades && M.upgrades.level ? M.upgrades.level(animal, 'cadence') : 0;
    const powerLevel = M.upgrades && M.upgrades.level ? M.upgrades.level(animal, 'power') : 0;
    if (animal.speedFx) animal.speedFx.apply(speedLevel, animal.speedCtx);
    if (animal.neckFx) animal.neckFx.apply(cadenceLevel, animal.neckCtx);
    if (animal.powerFx) animal.powerFx.apply(powerLevel, animal.powerCtx);
    if (animal.hornFx) {
      animal.hornFx.apply(hornLevel, animal.hornCtx);
      animal.hornFx.pulse(t);
    }
    const bob = moving ? Math.abs(Math.sin(s.walkPhase)) * 0.024 * stride : 0;
    // Faster tiers bounce with each stride instead of just moving quicker.
    const hop = moving && s.grounded && speedLevel < 3 ? Math.abs(Math.sin(s.walkPhase * 2)) * 0.012 * speedLevel * stride : 0;
    parts.rig.position.y = parts.rigBaseY + bob + hop - (s.landPulse || 0) * 0.045 - tuck * 0.025;
    const weightShift = M.config.reducedMotion ? 0 : Math.sin(s.walkPhase) * 0.014 * stride;
    parts.rig.position.x = damp(parts.rig.position.x, weightShift, 10, dt);
    parts.rig.rotation.x = damp(parts.rig.rotation.x,
      (s.landPulse || 0) * -0.05 + (moving ? Math.sin(s.walkPhase * 2) * 0.012 * stride : 0) - tuck * 0.14,
      9, dt);
    if (parts.chest.userData.restScale === undefined) parts.chest.userData.restScale = parts.chest.scale.x;
    const breath = 1 + Math.sin(t * 1.4 + animal.seed) * (moving ? 0.003 : 0.012);
    parts.chest.scale.x = parts.chest.userData.restScale * breath;

    const walkLift = moving ? Math.sin(s.walkPhase * 2) * 0.04 * stride : 0;
    const neckAttack = animal.neckFx ? animal.neckFx.animate(s.strikeTime, 0.16, 0.45, M.config.reducedMotion) : null;
    const actionLunge = (s.mode === 'break' || s.mode === 'place') && s.action
      ? actionPose(s.action.time, 0.22, s.action.duration)
      : neckAttack ? neckAttack.lunge : s.strikeTime >= 0 ? actionPose(s.strikeTime, 0.16, 0.45) : 0;
    parts.rig.position.z = actionLunge * 0.13;
    const terrainGrab = s.action && s.action.kind === 'break' && s.action.target.type === 'terrain'
      ? actionLunge
      : 0;

    const grazePose = s.grazePose;
    const headSway = s.mode === 'graze' ? Math.sin(t * 2.1 + animal.seed) * 0.12 * grazePose : 0;
    let neckTarget = def.neckBase + grazePose * (def.grazeNeck - def.neckBase);
    let headTarget = def.headBase + grazePose * (def.grazeHead - def.headBase);
    // Faster tiers tuck the head and lift the tail, as on the player goat.
    neckTarget -= speedLevel * 0.01;
    headTarget -= speedLevel * 0.015;
    neckTarget += actionLunge * def.lungeNeck + terrainGrab * 0.1;
    headTarget += actionLunge * 0.25 + terrainGrab * 0.45;

    parts.neckPivot.position.y = damp(parts.neckPivot.position.y,
      parts.neckBaseY - grazePose * def.grazeDrop, 5.5, dt);
    parts.neckPivot.position.z = damp(parts.neckPivot.position.z,
      parts.neckBaseZ + grazePose * 0.1, 5.5, dt);
    const neckResponse = cadenceLevel > 0 ? 22 + cadenceLevel * 6 : 8;
    parts.neckPivot.rotation.x = damp(parts.neckPivot.rotation.x, neckTarget, neckResponse, dt);
    parts.neckPivot.rotation.y = damp(parts.neckPivot.rotation.y, neckAttack ? neckAttack.yaw : 0, neckResponse, dt);
    parts.neckPivot.rotation.z = damp(parts.neckPivot.rotation.z, neckAttack ? neckAttack.roll : 0, neckResponse, dt);

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

    // Legs. Trained tiers take crisper, deeper strides; tier 3 spins the legs
    // as cartwheels. Wheel hips rotate continuously from their current angle so
    // entering and leaving the spin is seamless, then fold back into gait damp.
    for (let i = 0; i < parts.legs.length; i++) {
      const leg = parts.legs[i];
      const phase = s.walkPhase + leg.offset;
      const gait = hoofPose(phase, stride, s.mode === 'hunt' ? 0.6 : 0);
      const gaitShape = animal.species === 'cow' ? 0.84 : animal.species === 'stag' ? 1.08 : 0.94;
      const wheel = speedLevel >= 3 && moving && s.grounded && tuck < 0.01;
      let hipTarget;
      let kneeTarget;
      if (tuck > 0.01) {
        hipTarget = (leg.front ? -0.52 : 0.45) * tuck;
        kneeTarget = 0.72 * tuck;
      } else if (wheel) {
        const rawPhase = s.walkPhase * 0.7 + leg.offset;
        if (leg.wheelBase === undefined) leg.wheelBase = leg.hip.rotation.x - rawPhase;
        hipTarget = leg.wheelBase + rawPhase;
        kneeTarget = 0.04;
      } else {
        if (leg.wheelBase !== undefined) {
          leg.hip.rotation.x = foldAngle(leg.hip.rotation.x);
          leg.wheelBase = undefined;
        }
        const energy = 1 + speedLevel * 0.05;
        const kneeEnergy = 1 + speedLevel * 0.07;
        hipTarget = gait.hip * gaitShape * energy;
        kneeTarget = gait.knee * (animal.species === 'stag' ? 1.12 : 1) * kneeEnergy;
      }
      if (actionLunge > 0 && tuck < 0.4 && !wheel) {
        hipTarget += (leg.front ? -0.18 : 0.12) * actionLunge;
        kneeTarget += (leg.front ? 0.12 : 0.03) * actionLunge;
      }
      if (wheel) {
        leg.hip.rotation.x = hipTarget; // continuous rotation, no damping lag
      } else {
        leg.hip.rotation.x = damp(leg.hip.rotation.x, hipTarget, 20, dt);
      }
      leg.knee.rotation.x = damp(leg.knee.rotation.x, kneeTarget, 20, dt);
      const ankleTarget = wheel ? 0 : -kneeTarget * 0.55 + Math.max(0, Math.sin(phase)) * 0.13 * stride + tuck * 0.2;
      leg.ankle.rotation.x = damp(leg.ankle.rotation.x, ankleTarget, 22, dt);
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
      parts.tailPivot.rotation.x = (parts.tailPivot.userData.baseX || parts.tailPivot.rotation.x) - speedLevel * 0.05;
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
      s.carriedMesh.scale.setScalar(1 + pop * 0.1);
      s.carryPop = Math.max(0, pop - dt * 4);
    } else {
      s.carryPop = Math.max(0, (s.carryPop || 0) - dt * 4);
    }

    if (parts.bell) {
      parts.bell.rotation.z = Math.sin(t * 2.2 + animal.seed) * 0.12 + (moving ? Math.sin(s.walkPhase) * 0.1 : 0);
    }
  }

  function nearestZombie(animal) {
    if (!M.enemies || !M.enemies.zombies) return null;
    const p = animal.group.position;
    let best = null;
    let bestDistance = Infinity;
    for (let i = 0; i < M.enemies.zombies.length; i++) {
      const zombie = M.enemies.zombies[i];
      if (zombie.hp <= 0) continue;
      const q = zombie.position;
      const distance = Math.hypot(q.x - p.x, q.z - p.z) + Math.abs(q.y - p.y) * 2;
      if (distance < bestDistance) {
        best = zombie;
        bestDistance = distance;
      }
    }
    return best;
  }

  function updateHunt(animal, dt) {
    const s = animal.state;
    const p = animal.group.position;
    const upgrades = M.upgrades ? M.upgrades.stats(animal) : { rate: 1, reach: 0, damage: 0 };
    const reachTier = M.upgrades && M.upgrades.level ? M.upgrades.level(animal, 'reach') : 0;
    // Long horns trains hunters exactly like the player: tier 1 throws an
    // auto-aimed electric bolt, tier 2 a chaining arc, tier 3 a fireball with
    // a 3-block blast. Untrained hunters keep their melee headbutt.
    const spellRange = reachTier >= 1 && M.upgrades && M.upgrades.spellRanges
      ? M.upgrades.spellRanges()[reachTier] : 0;
    const zombie = s.huntTarget;
    if (!zombie || zombie.hp <= 0 || M.enemies.zombies.indexOf(zombie) < 0) {
      s.huntTarget = null;
      s.strikeTime = -1;
      s.mode = 'idle';
      s.wait = 0.15;
      s.speed = 0;
      return;
    }

    const q = zombie.position;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const distance = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    s.yaw = turnToward(s.yaw, yaw, dt * 7);
    s.attackCooldown = Math.max(0, (s.attackCooldown || 0) - dt * upgrades.rate);
    if (s.strikeTime >= 0) {
      const before = s.strikeTime;
      s.strikeTime += dt * upgrades.rate;
      const strikeReach = spellRange || 8.4 + upgrades.reach;
      if (before < 0.16 && s.strikeTime >= 0.16 && distance <= strikeReach + 0.6 && Math.abs(q.y - p.y) <= 2.8) {
        const dealt = spellRange
          ? (M.goat && M.goat.castSpellAt(p, reachTier, 1 + upgrades.damage, undefined,
            M.upgrades && M.upgrades.level ? M.upgrades.level(animal, 'power') : 0))
          : M.enemies.attack(p, s.yaw, false, { range: strikeReach, damage: 1 + upgrades.damage, maxTargets: 1 });
        if (dealt) s.happy = 1;
      }
      if (s.strikeTime >= 0.45) s.strikeTime = -1;
    }

    const combatRange = spellRange || 7.35 + upgrades.reach;
    if (distance <= combatRange && Math.abs(q.y - p.y) <= 2.8) {
      s.speed = damp(s.speed, 0, 10, dt);
      s.stuck = 0;
      // Spells aim themselves, so a trained hunter fires at any enemy in range;
      // melee still waits until the target sits in front of the animal.
      if (s.attackCooldown <= 0 && (spellRange || Math.abs(angleDelta(s.yaw, yaw)) < 0.35)) {
        s.strikeTime = 0;
        s.attackCooldown = 0.75;
      }
      return;
    }

    const speed = defWalkSpeed(animal) * 1.65 * (s.grounded ? 1 : AIR_CONTROL);
    s.speed = damp(s.speed, speed, 6, dt);
    const moved = distance > 0.001 && moveAnimal(
      animal,
      dx / distance * s.speed * dt,
      dz / distance * s.speed * dt,
      s.yaw
    );
    if (moved) {
      s.walkPhase += s.speed * dt * 4.6;
      s.stuck = 0;
    } else if (s.grounded) {
      s.stuck += dt;
    }
  }

  function recoveryMotion(animal) {
    const s = animal.state;
    const p = animal.group.position;
    let target = null;
    if (s.mode === 'walk') target = s.target;
    else if (s.mode === 'hunt' && s.huntTarget) target = s.huntTarget.position;
    else if ((s.mode === 'seekBreak' || s.mode === 'seekPlace') && s.action) target = s.action.approach;
    else if (s.mode === 'climbBuild') target = s.pendingClimb;
    else if (s.mode === 'descend') target = s.descendTarget;
    if (!target) return null;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    if (Math.hypot(dx, dz) < 0.25) return null;
    return { x: dx, z: dz, target: target };
  }

  function updateRecovery(animal, dt) {
    const s = animal.state;
    const p = animal.group.position;
    const motion = recoveryMotion(animal);
    if (s.detourTime > 0) {
      s.detourTime -= dt;
      if (s.detourTime <= 0) s.detourTarget = null;
    }
    const modeChanged = s.recovery.mode !== s.mode;
    const stage = recovery.update(s.recovery, p, s.mode, !!motion, dt, motion && motion.target);
    if (modeChanged) {
      s.detourCount = 0;
      s.recoveryJumps = 0;
    }
    if (!motion) return;

    const solid = recovery.blockedAhead(worldRef, p, bodyOf(animal), motion.x, motion.z);
    s.recovery.solid = solid;
    s.recovery.detourCount = s.detourCount || 0;
    if ((s.detourCount || 0) >= 2 && solid) {
      startEscape(animal, motion);
      recovery.reset(s.recovery);
      return;
    }
    if (stage === 'clear') return;
    if (stage === 'jump' && (s.recoveryJumps || 0) < 2 && s.grounded && s.jumpCooldown <= 0) {
      const ledge = recovery.findLedge(worldRef, p, bodyOf(animal), motion.x, motion.z,
        function (x, z, top) { return canStandAt(animal, x, z, top) && actorSpotClear(animal, x, z, 0.1); });
      if (ledge) {
        startJump(animal, 'stuck-ledge');
        return;
      }
    }

    if ((stage === 'detour' || stage === 'escape') && !s.detourTarget && (s.detourCount || 0) < 2) {
      const detour = recovery.findDetour(p, motion.x, motion.z, function (x, z) {
        if (worldRef.isWaterColumn(Math.floor(x / BLOCK), Math.floor(z / BLOCK))) return false;
        return canStandAt(animal, x, z, p.y) && actorSpotClear(animal, x, z, 0.2);
      });
      if (detour) {
        s.detourTarget = detour;
        s.detourTime = 0.85;
        s.detourCount = (s.detourCount || 0) + 1;
        recovery.reset(s.recovery);
        return;
      }
    }

    const detoursFailed = (s.detourCount || 0) >= 2;
    if ((stage === 'escape' || detoursFailed) && (solid || pitStatus(animal).trapped)) {
      startEscape(animal, motion);
      recovery.reset(s.recovery);
    }
  }

  function updateAnimal(animal, dt, t) {
    const s = animal.state;
    const p = animal.group.position;
    if (physics.recover(worldRef, p, bodyOf(animal))) { s.vy = 0; s.grounded = false; }
    const player = goatRef.group.position;
    const playerDistance = Math.hypot(p.x - player.x, p.z - player.z);
    if (s.mode !== 'hunt') s.strikeTime = -1;
    s.voiceTimer -= dt;
    if (s.voiceTimer <= 0) {
      if (audioRef && audioRef.animal) audioRef.animal(animal.species, p);
      s.voiceTimer = 19 + Math.sin(t + animal.seed) * 7;
    }

    s.jumpCooldown = Math.max(0, (s.jumpCooldown || 0) - dt);
    s.escapeCooldown = Math.max(0, (s.escapeCooldown || 0) - dt);
    s.pitTimer = (s.pitTimer || 0) - dt;
    const workRate = M.upgrades ? M.upgrades.stats(animal).craft : 1;
    const trainedBuilder = !s.retired && M.towers && M.towers.builderDefinition(animal);
    s.towerTimer = Math.max(0, s.towerTimer - dt * workRate);
    s.coinCooldown = Math.max(0, s.coinCooldown - dt);
    if (trainedBuilder && s.coins < trainedBuilder.cost.coins && M.items && M.items.takeCoins) s.coins += M.items.takeCoins(p);
    if (s.coinTarget) {
      s.coinTime -= dt;
      if (s.mode !== 'walk' || s.coinTime <= 0 || !M.items.drops.includes(s.coinTarget)) {
        s.coinTarget = null;
        if (s.mode === 'walk') { s.mode = 'idle'; s.wait = .2; s.speed = 0; }
      } else s.target.copy(s.coinTarget.position);
    }
    s.buildTimer = Math.max(0, (s.buildTimer || 0) - dt * workRate);
    s.actionTimer = Math.max(0, (s.actionTimer || 0) - dt * workRate);

    if (playerDistance > 92 && !s.action) {
      relocate(animal);
    }

    if (s.retired && !s.project && s.escape) {
      rescueAnimal(animal);
    }

    if (s.pitTimer <= 0 && s.escapeCooldown <= 0 && s.mode !== 'escape' &&
        s.mode !== 'climbBuild' && s.mode !== 'descend' && s.grounded) {
      s.pitTimer = PIT_CHECK_INTERVAL;
      if (shouldEscape(animal)) {
        if (s.retired) rescueAnimal(animal);
        else startEscape(animal);
      }
    }

    if (animal.role === 'hunter' && (s.mode === 'idle' || s.mode === 'walk' || s.mode === 'graze')) {
      const zombie = nearestZombie(animal);
      if (zombie) {
        s.huntTarget = zombie;
        s.mode = 'hunt';
        s.stuck = 0;
      }
    }

    updateRecovery(animal, dt);

    if (s.mode === 'idle') {
      s.speed = damp(s.speed, 0, 5, dt);
      s.wait -= dt * workRate;
      if (s.wait <= 0) {
        if (trainedBuilder && s.coins < trainedBuilder.cost.coins && !s.pendingClimb && startCoinRun(animal)) {
          // The wall project stays intact while this short collection trip runs.
        } else if (trainedBuilder && !s.pendingClimb && startTowerJob(animal)) {
          // Quarrying and tower assembly use the same timed actions as walls.
        } else if (s.pendingClimb) {
          startClimb(animal, s.pendingClimb);
        } else if (s.project) {
          const project = s.project;
          const site = project.site;
          const onStructure = p.y > site.groundY + 0.3 &&
            Math.hypot(p.x - site.centerX, p.z - site.centerZ) < WALL_LENGTH;
          const hasTarget = hasBuildTarget(project);
          const atSite = Math.hypot(p.x - site.centerX, p.z - site.centerZ) < 1.35 &&
            Math.abs(p.y - site.groundY) < 0.35;

          if (!hasTarget) {
            if (p.y > site.groundY + 0.25) {
              startDescend(animal);
            } else {
              project.completed = true;
              if (s.walls.indexOf(project) < 0) s.walls.push(project);
              s.project = null;
              s.gathering = false;
              s.batchGoal = 0;
              s.happy = 1;
              s.buildTimer = rand(6, 10);
              s.wait = rand(1.0, 2.0);
            }
          } else if (s.gathering && s.carryCount < s.batchGoal && !onStructure) {
            if (!atSite && project.stepCount === 0) {
              s.target.set(site.centerX, site.groundY, site.centerZ);
              s.mode = 'walk';
              s.wait = 0;
            } else if (!startQuarry(animal)) {
              s.quarryMisses = (s.quarryMisses || 0) + 1;
              if (s.quarryMisses < 4) {
                s.wait = rand(0.25, 0.6);
              } else if (s.carryCount > 0) {
                s.quarryMisses = 0;
                s.gathering = false;
                s.batchGoal = s.carryCount;
                s.wait = 0.1;
              } else {
                abandonProject(animal, 'quarry-exhausted');
              }
            }
          } else if (s.carryCount > 0) {
            if (!startBuild(animal)) {
              if (onStructure) {
                startDescend(animal);
              } else {
                s.wait = rand(0.5, 1.1);
              }
            }
          } else if (onStructure) {
            startDescend(animal);
          } else {
            s.gathering = true;
            s.batchGoal = project.plan.reduce(function (count, target) {
              return count + (worldRef.blockInfoAt(target.bx, target.by, target.bz) ? 0 : 1);
            }, 0);
            s.wait = 0.1;
          }
        } else if (animal.role === 'builder' && s.buildTimer <= 0) {
          for (let i = 0; i < s.walls.length; i++) {
            if (hasBuildTarget(s.walls[i])) {
              s.project = s.walls[i];
              break;
            }
          }
          if (!s.project) {
            const site = chooseBuildSite(animal);
            if (site) s.project = makeBuildProject(animal, site);
          }
          if (s.project) {
            s.batchGoal = s.project.plan.reduce(function (count, target) {
              return count + (worldRef.blockInfoAt(target.bx, target.by, target.bz) ? 0 : 1);
            }, 0);
            s.gathering = s.carryCount < s.batchGoal;
            s.quarryMisses = 0;
            s.wait = 0.12;
            s.happy = 1;
          } else {
            s.buildTimer = rand(5, 10);
            if (!chooseWander(animal) && !startGraze(animal)) s.wait = rand(1.5, 3.0);
          }
        } else if (animal.role === 'builder' && s.carryCount > 0 && s.buildTimer <= 0.5) {
          s.buildTimer = 0;
          s.wait = 0.05;
        } else if (!s.carry && Math.random() < 0.38) {
          if (!startGraze(animal) && !chooseWander(animal)) s.wait = rand(1.2, 2.5);
        } else if (!chooseWander(animal)) {
          s.wait = rand(1.2, 2.5);
        }
      }
    } else if (s.mode === 'hunt') {
      updateHunt(animal, dt);
    } else if (s.mode === 'walk') {
      const dx = s.target.x - p.x;
      const dz = s.target.z - p.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.32) {
        s.mode = 'idle';
        s.wait = rand(1.0, 2.6);
        s.speed = 0;
      } else {
        const yaw = Math.atan2(dx, dz);
        s.yaw = turnToward(s.yaw, yaw, dt * 4.0);
        const targetSpeed = defWalkSpeed(animal) * (s.grounded ? 1 : AIR_CONTROL);
        s.speed = damp(s.speed, targetSpeed, 4, dt);
        const moved = moveAnimal(animal, dx / distance * s.speed * dt, dz / distance * s.speed * dt, s.yaw);
        if (moved) {
          s.walkPhase += s.speed * dt * 4.6;
          s.stuck = 0;
        } else if (s.grounded) {
          s.stuck += dt;
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
        s.wait = rand(1.0, 2.4);
      }
    } else if (s.mode === 'seekBreak' || s.mode === 'seekPlace') {
      updateSeek(animal, dt);
    } else if (s.mode === 'break' || s.mode === 'place') {
      updateAction(animal, dt);
    } else if (s.mode === 'climbBuild') {
      updateClimb(animal, dt);
    } else if (s.mode === 'descend') {
      updateDescend(animal, dt);
    } else if (s.mode === 'escape') {
      updateEscape(animal, dt);
    }

    animal.group.rotation.y = s.yaw;
    updateGravity(animal, dt);

    if (!canStandAt(animal, p.x, p.z, p.y)) {
      if (physics.recover(worldRef, p, bodyOf(animal))) { s.vy = 0; s.grounded = false; }
      s.buriedTime = canStandAt(animal, p.x, p.z, p.y) ? 0 : (s.buriedTime || 0) + dt;
      if (s.buriedTime > 0.7) rescueAnimal(animal);
    } else s.buriedTime = 0;

    updateVisual(animal, dt, t);
  }

  function defWalkSpeed(animal) {
    const terrain = M.enemies && M.enemies.movementScale ? M.enemies.movementScale(animal.group.position) : 1;
    return animal.def.walkSpeed * (M.upgrades ? M.upgrades.stats(animal).move : 1) * terrain;
  }

  function findSpawnNear(cx, cz, minRadius, maxRadius, ignore) {
    for (let i = 0; i < 64; i++) {
      const angle = rand(0, Math.PI * 2);
      const radius = rand(minRadius, maxRadius);
      const x = cx + Math.sin(angle) * radius;
      const z = cz + Math.cos(angle) * radius;
      const y = nearestGround(x, z);
      if (y < 0.01) continue;
      if (worldRef.isWaterColumn(Math.floor(x / BLOCK), Math.floor(z / BLOCK))) continue;
      if (worldRef.isPondArea(Math.floor(x / BLOCK), Math.floor(z / BLOCK))) continue;
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
      if (worldRef.isWaterColumn(Math.floor(x / BLOCK), Math.floor(z / BLOCK))) continue;
      if (worldRef.isPondArea(Math.floor(x / BLOCK), Math.floor(z / BLOCK))) continue;
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
    animal.state.project = null;
    animal.state.pendingClimb = null;
    animal.state.descendTarget = null;
    animal.state.escape = null;
    animal.state.gathering = false;
    animal.state.batchGoal = 0;
    animal.state.buildTimer = rand(4, 10);
    animal.state.pitTimer = 0.5;
  }

  function createAnimal(speciesName, spawn, options) {
    const def = SPECIES[speciesName];
    const parts = buildModel(speciesName, options && options.variant);
    const animal = {
      species: speciesName,
      def: def,
      name: options && options.name,
      role: options && options.role,
      parts: parts,
      group: parts.group,
      seed: rand(0, Math.PI * 2),
      speedFx: M.styleFx ? M.styleFx.makeSpeedStyle(THREE) : null,
      hornFx: M.styleFx ? M.styleFx.makeHornStyle(THREE) : null,
      neckFx: M.styleFx ? M.styleFx.makeNeckStyle(THREE) : null,
      powerFx: M.styleFx ? M.styleFx.makePowerStyle(THREE) : null,
      speedCtx: null,
      hornCtx: null,
      state: null
    };
    const styleScale = STYLE_SCALES[animal.species] || { leg: 0.9, horn: 0.6 };
    animal.speedCtx = { legs: parts.legs, tailPivot: parts.tailPivot, scale: styleScale.leg };
    animal.hornCtx = { horns: parts.horns, defaultMat: parts.mats.horn, scale: styleScale.horn };
    animal.neckCtx = { neck: parts.neck, headPivot: parts.headPivot };
    if (animal.role === 'hunter') {
      parts.beard = new THREE.Group();
      parts.beard.position.set(0, -0.2, 0.3);
      parts.beard.rotation.x = -0.22;
      parts.headPivot.add(parts.beard);
    }
    animal.powerCtx = { horns: parts.horns, beard: parts.beard, beardMat: parts.mats.face, scale: 0.85 };

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
      recovery: recovery.create(),
      detourTarget: null,
      detourTime: 0,
      detourCount: 0,
      recoveryJumps: 0,
      seekTime: 0,
      action: null,
      actionTimer: options && Number.isFinite(options.actionTimer) ? options.actionTimer : rand(9, 18),
      buildTimer: options && Number.isFinite(options.actionTimer) ? options.actionTimer : rand(3, 9),
      attackCooldown: 0,
      strikeTime: -1,
      voiceTimer: 5 + animal.seed * 1.7,
      huntTarget: null,
      project: null,
      walls: [],
      gathering: false,
      batchGoal: 0,
      carry: null,
      carryCount: 0,
      coins: 0,
      towerStone: 0,
      towersBuilt: 0,
      towerTimer: 20,
      coinTarget: null,
      coinTime: 0,
      coinCooldown: 0,
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
      blink: 0,
      pendingClimb: null,
      descendTime: 0,
      descendTarget: null,
      escape: null,
      escapeCooldown: 0,
      pitTimer: rand(0.2, 0.7),
      jumpCooldown: 0,
      tuck: 0,
      jumpReason: null,
      climbTries: 0,
      buriedTime: 0,
      wedgeTime: 0,
      seekFailures: 0,
      quarryMisses: 0,
      lastAbandon: null,
      retired: false
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
      { species: 'sheep', name: 'Mallow', role: 'builder', dx: -3.0, dz: 2.0, actionTimer: 0.8 },
      { species: 'cow', name: 'Clover', role: 'builder', dx: 2.6, dz: -3.0, actionTimer: 3.0 },
      { species: 'stag', name: 'Bramble', role: 'hunter', dx: -3.8, dz: -1.2, actionTimer: 5.5 },
      {
        species: 'sheep',
        name: 'Poppy',
        role: 'hunter',
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
          !worldRef.isWaterColumn(Math.floor(preferred.x / BLOCK), Math.floor(preferred.z / BLOCK)) &&
          !worldRef.isPondArea(Math.floor(preferred.x / BLOCK), Math.floor(preferred.z / BLOCK)) &&
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

  function intersectsBlock(bx, by, bz) {
    return animals.some(function (animal) {
      return physics.intersectsBlock(animal.group.position, bodyOf(animal), bx, by, bz, sizeOf());
    });
  }

  M.animals = {
    intersectsBlock: intersectsBlock,
    bodyOf: bodyOf,
    init: init,
    update: update,
    list: animals,
    species: SPECIES
  };
})(window.Meadow = window.Meadow || {});
