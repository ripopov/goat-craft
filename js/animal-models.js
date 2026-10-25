(function (M) {
  'use strict';

  const { rand } = M.utils;
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

  M.animalModels = { species: SPECIES, create: buildModel, styleScales: STYLE_SCALES };
})(window.Meadow = window.Meadow || {});
