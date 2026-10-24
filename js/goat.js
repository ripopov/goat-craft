(function (M) {
  'use strict';

  const { clamp, rand, damp, turnToward, hoofPose, actionPose } = M.utils;
  const std = M.std;

  let sceneRef = null;
  let cameraRef = null;
  let controlsRef = null;
  let worldRef = null;
  let audioRef = null;
  let uiRef = null;
  let state = null;
  let goatYaw = 0.15;

  // ------------------------------------------------------------------- goat
  function makeCoatTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#efe2c9';
    ctx.fillRect(0, 0, 512, 512);

    // fine fur grain
    for (let i = 0; i < 4200; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const light = Math.random() > 0.5;
      ctx.strokeStyle = light ? 'rgba(255, 249, 232, 0.18)' : 'rgba(160, 135, 100, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rand(-1.5, 1.5), y + rand(2.5, 6));
      ctx.stroke();
    }

    // soft saddle marking across the back (top of the sphere UV)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-10, -10);
    ctx.lineTo(522, -10);
    ctx.lineTo(522, 110);
    for (let x = 522; x >= -10; x -= 14) {
      const y = 116 + Math.sin(x * 0.024) * 18 + Math.sin(x * 0.009 + 2.1) * 14 + (Math.random() - 0.5) * 5;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.clip();

    const grad = ctx.createLinearGradient(0, 0, 0, 190);
    grad.addColorStop(0, '#c8a578');
    grad.addColorStop(0.62, '#c4a173');
    grad.addColorStop(1, 'rgba(196, 161, 115, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 200);

    // a couple of irregular freckles near the edge of the marking
    for (let i = 0; i < 10; i++) {
      const x = rand(0, 512);
      const y = rand(120, 175);
      const r = rand(8, 26);
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
      g2.addColorStop(0, 'rgba(190, 155, 108, 0.55)');
      g2.addColorStop(1, 'rgba(190, 155, 108, 0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 8;
    return tex;
  }

  const coatTex = makeCoatTexture();

  const fur = std(0xeddfc4, 0.96);
  const bodyFur = std(0xffffff, 0.96, { map: coatTex });
  const earFur = std(0xd3b183, 0.95);
  const beardMat = std(0xd8bd92, 0.95);
  const furLight = std(0xf8eeda, 0.96);
  const sock = std(0xc39a67, 0.92);
  const hoofMat = std(0x48382e, 0.62);
  const hornMat = std(0xd9c7a3, 0.55);
  const noseMat = std(0xcd8e8d, 0.62);
  const eyeMat = std(0xe8c078, 0.35);
  const pupilMat = std(0x231b15, 0.3);
  const innerEarMat = std(0xe2ad9d, 0.9);
  const collarMat = std(0x9a5a3c, 0.72);
  const bellMat = new THREE.MeshStandardMaterial({
    color: 0xe3b65a, roughness: 0.34, metalness: 0.25, flatShading: true
  });

  function ellipsoid(mat, rx, ry, rz, wSeg, hSeg) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, wSeg || 16, hSeg || 12), mat);
    mesh.scale.set(rx, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function makeHorn(sign) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.03 * sign, 0.14, -0.05),
      new THREE.Vector3(0.055 * sign, 0.25, -0.15),
      new THREE.Vector3(0.045 * sign, 0.29, -0.26),
      new THREE.Vector3(0.0, 0.26, -0.37)
    ]);
    const segs = 20;
    const radial = 7;
    const frames = curve.computeFrenetFrames(segs, false);
    const positions = [];
    const indices = [];

    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = curve.getPointAt(t);
      const n = frames.normals[i];
      const b = frames.binormals[i];
      const growthRing = 1 + Math.sin(t * Math.PI * 28) * 0.075 * (1 - t);
      const radius = THREE.MathUtils.lerp(0.062, 0.009, Math.pow(t, 0.72)) * growthRing;
      for (let j = 0; j < radial; j++) {
        const a = (j / radial) * Math.PI * 2;
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
      for (let j = 0; j < radial; j++) {
        const a = i * radial + j;
        const b = i * radial + (j + 1) % radial;
        const c = (i + 1) * radial + (j + 1) % radial;
        const d = (i + 1) * radial + j;
        indices.push(a, b, d, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, hornMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  const goat = new THREE.Group();
  const rig = new THREE.Group();
  goat.add(rig);

  const torso = ellipsoid(bodyFur, 0.4, 0.42, 0.68, 24, 16);
  torso.position.set(0, 1.3, -0.05);
  rig.add(torso);

  const chest = ellipsoid(bodyFur, 0.37, 0.4, 0.4, 20, 14);
  chest.position.set(0, 1.34, 0.38);
  rig.add(chest);

  const rump = ellipsoid(bodyFur, 0.38, 0.41, 0.4, 20, 14);
  rump.position.set(0, 1.32, -0.45);
  rig.add(rump);

  const brisket = ellipsoid(fur, 0.25, 0.28, 0.25, 16, 12);
  brisket.position.set(0, 1.08, 0.52);
  rig.add(brisket);
  [-0.42, -0.17, 0.08].forEach(function (z, i) {
    const tuft = ellipsoid(i === 1 ? earFur : fur, 0.12, 0.075, 0.19, 10, 7);
    tuft.position.set(0, 1.7 - Math.abs(z) * 0.08, z);
    tuft.rotation.x = -0.18;
    rig.add(tuft);
  });

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 1.53, 0.5);
  neckPivot.rotation.x = 0.42;
  rig.add(neckPivot);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.26, 0.58, 12, 1), fur);
  neck.position.y = 0.25;
  neck.castShadow = true;
  neck.receiveShadow = true;
  neckPivot.add(neck);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.232, 0.028, 6, 18), collarMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.19;
  collar.castShadow = true;
  neckPivot.add(collar);

  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), bellMat);
  bell.position.set(0, 0.11, 0.225);
  bell.castShadow = true;
  neckPivot.add(bell);

  // head
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.55, 0.01);
  headPivot.rotation.x = -0.18;
  headPivot.scale.setScalar(0.96);
  neckPivot.add(headPivot);

  const skull = ellipsoid(furLight, 0.265, 0.25, 0.3, 18, 14);
  skull.position.set(0, 0.03, 0.05);
  headPivot.add(skull);

  const muzzle = ellipsoid(furLight, 0.15, 0.145, 0.24, 16, 12);
  muzzle.position.set(0, -0.09, 0.32);
  headPivot.add(muzzle);

  const nose = ellipsoid(noseMat, 0.115, 0.082, 0.06, 12, 9);
  nose.position.set(0, -0.035, 0.5);
  headPivot.add(nose);

  [-1, 1].forEach(function (sign) {
    const nostril = ellipsoid(pupilMat, 0.017, 0.014, 0.012, 6, 5);
    nostril.position.set(sign * 0.042, -0.045, 0.556);
    headPivot.add(nostril);
  });

  const eyes = [], eyeParts = [];
  // Unlit catchlights stay crisp at night; the iris retains its dark pupil.
  const eyeShineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  [-1, 1].forEach(function (sign) {
    const eye = new THREE.Group();
    eye.name = sign < 0 ? 'goat-eye-left' : 'goat-eye-right';
    eye.position.set(sign * 0.2, 0.065, 0.18);
    eye.rotation.y = sign * 0.62;
    headPivot.add(eye);

    const ball = ellipsoid(eyeMat, 0.082, 0.098, 0.056, 12, 10);
    ball.name = 'eye-iris';
    ball.castShadow = false;
    eye.add(ball);

    const pupil = ellipsoid(pupilMat, 0.053, 0.022, 0.016, 10, 7);
    pupil.name = 'eye-pupil';
    pupil.position.set(0, 0.003, 0.049);
    pupil.castShadow = false;
    eye.add(pupil);

    const glint = ellipsoid(furLight, 0.013, 0.013, 0.009, 6, 5);
    glint.name = 'eye-catchlight';
    glint.position.set(0.019, 0.03, 0.056);
    glint.castShadow = false;
    eye.add(glint);

    const extraShine = [];
    for (let i = 0; i < 2; i++) {
      const shine = ellipsoid(eyeShineMat, 0.007 - i * 0.002, 0.007 - i * 0.002, 0.005, 6, 5);
      shine.position.set(i === 0 ? -0.022 : 0.032, i === 0 ? -0.021 : -0.01, 0.061);
      shine.castShadow = shine.receiveShadow = false;
      shine.visible = false;
      eye.add(shine);
      extraShine.push(shine);
    }
    const star = new THREE.Group();
    star.name = 'eye-star-shine';
    star.position.set(0.019, 0.03, 0.067);
    for (let i = 0; i < 2; i++) {
      const ray = new THREE.Mesh(new THREE.BoxGeometry(0.043, 0.005, 0.003), eyeShineMat);
      ray.rotation.z = i * Math.PI / 2;
      star.add(ray);
    }
    star.visible = false;
    eye.add(star);

    const brow = ellipsoid(earFur, 0.09, 0.025, 0.035, 10, 6);
    brow.position.set(0, 0.095, 0.027);
    brow.rotation.z = -sign * 0.12;
    eye.add(brow);
    const cheek = ellipsoid(fur, 0.065, 0.075, 0.055, 10, 7);
    cheek.position.set(-sign * 0.025, -0.09, -0.01);
    eye.add(cheek);

    eyes.push(eye);
    eyeParts.push({ iris: ball, pupil: pupil, glint: glint, extraShine: extraShine, star: star });
  });

  // ears
  const ears = [];
  [-1, 1].forEach(function (sign) {
    const pivot = new THREE.Group();
    pivot.position.set(sign * 0.215, 0.14, 0.05);
    const baseZ = -sign * 0.8;
    pivot.rotation.z = baseZ;
    pivot.rotation.x = 0.08;

    const ear = ellipsoid(earFur, 0.175, 0.046, 0.095, 10, 8);
    ear.position.set(sign * 0.13, -0.01, 0);
    pivot.add(ear);

    const inner = ellipsoid(innerEarMat, 0.105, 0.016, 0.055, 8, 6);
    inner.position.set(sign * 0.135, 0.038, 0.0);
    pivot.add(inner);

    headPivot.add(pivot);
    ears.push({ pivot: pivot, baseZ: baseZ, side: sign });
  });

  const mouth = ellipsoid(hoofMat, 0.05, 0.008, 0.012, 8, 5);
  mouth.position.set(0, -0.155, 0.532);
  headPivot.add(mouth);

  // horns
  const horns = [];
  [-1, 1].forEach(function (sign) {
    const horn = makeHorn(sign);
    horn.position.set(sign * 0.095, 0.225, 0.0);
    headPivot.add(horn);
    horns.push(horn);
  });

  // beard
  const beard = new THREE.Group();
  beard.position.set(0, -0.24, 0.33);
  beard.rotation.x = -0.22;
  headPivot.add(beard);

  const beardCone = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.26, 7), beardMat);
  beardCone.rotation.z = Math.PI;
  beardCone.position.y = -0.1;
  beardCone.castShadow = true;
  beard.add(beardCone);

  const beardWisp = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.19, 6), beardMat);
  beardWisp.rotation.z = Math.PI + 0.2;
  beardWisp.position.set(0.045, -0.09, -0.01);
  beardWisp.castShadow = true;
  beard.add(beardWisp);

  // tail
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 1.5, -0.8);
  tailPivot.rotation.x = -0.55;
  rig.add(tailPivot);

  const tail = ellipsoid(fur, 0.058, 0.16, 0.058, 9, 8);
  tail.position.y = 0.16;
  tailPivot.add(tail);

  const tailTuft = ellipsoid(earFur, 0.085, 0.1, 0.085, 9, 8);
  tailTuft.position.y = 0.32;
  tailPivot.add(tailTuft);

  // legs
  const legs = [];
  function makeLeg(x, z, front, offset, runOffset) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.98, z);
    rig.add(hip);

    if (!front) {
      const thigh = ellipsoid(bodyFur, 0.15, 0.23, 0.19, 12, 10);
      thigh.position.set(0, -0.1, 0);
      hip.add(thigh);
    } else {
      // Fill the small gap where the round top of the front leg met the
      // underside of the chest. The tapered shoulder grows into the body and
      // narrows into the leg instead of ending in a floating ball joint.
      const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.085, 0.34, 8, 1), fur);
      shoulder.position.y = 0.1;
      shoulder.castShadow = true;
      shoulder.receiveShadow = true;
      hip.add(shoulder);
    }

    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.3, 4, 8), fur);
    upper.position.y = -0.22;
    upper.castShadow = true;
    upper.receiveShadow = true;
    hip.add(upper);

    const knee = new THREE.Group();
    knee.position.y = -0.45;
    hip.add(knee);

    const kneeCap = ellipsoid(sock, 0.074, 0.074, 0.074, 8, 6);
    kneeCap.position.y = 0;
    knee.add(kneeCap);

    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.26, 4, 8), sock);
    lower.position.y = -0.19;
    lower.castShadow = true;
    lower.receiveShadow = true;
    knee.add(lower);

    const fetlock = ellipsoid(furLight, 0.075, 0.105, 0.08, 10, 7);
    fetlock.position.set(0, -0.35, -0.015);
    knee.add(fetlock);
    const ankle = new THREE.Group();
    ankle.position.y = -0.465;
    knee.add(ankle);
    [-1, 1].forEach(function (side) {
      const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.043, 0.13, 7), hoofMat);
      hoof.position.set(side * 0.041, 0, 0.012);
      hoof.rotation.z = side * 0.045;
      hoof.castShadow = true;
      hoof.receiveShadow = true;
      ankle.add(hoof);
    });

    legs.push({ hip: hip, knee: knee, ankle: ankle, front: front, offset: offset, runOffset: runOffset });
  }
  makeLeg(-0.23, 0.42, true, 0, Math.PI);
  makeLeg(0.23, 0.42, true, Math.PI, Math.PI * 1.5);
  makeLeg(-0.25, -0.45, false, Math.PI, 0);
  makeLeg(0.25, -0.45, false, 0, Math.PI * 0.5);
  const stompLeg = legs[1];

  // ----------------------------------------------------------------- speed style
  // Fleet hooves training visibly refits the player's goat (and, through
  // M.styleFx, the whole herd): tiers stack glowing energy bands up each leg
  // and tint the tail light; tier 3 adds spinning wheel rims and swaps the
  // gait for a cartoon wheel spin.
  const speedFx = M.styleFx.makeSpeedStyle(THREE);
  const hornFx = M.styleFx.makeHornStyle(THREE);
  const neckFx = M.styleFx.makeNeckStyle(THREE);
  const HORN_TIP = new THREE.Vector3(0, 0.26, -0.37); // far end of makeHorn's curve
  const GOAT_HORN_BAND = new THREE.Vector3(0, 0.07, -0.03);
  function applySpeedStyle(level) {
    speedFx.apply(level, { legs: legs, tailPivot: tailPivot });
  }
  function applyHornStyle(level) {
    const ctx = { horns: [], defaultMat: hornMat, scale: 1 };
    for (let i = 0; i < horns.length; i++) ctx.horns.push({ mesh: horns[i], tip: HORN_TIP, band: GOAT_HORN_BAND });
    hornFx.apply(level, ctx);
  }
  function applyNeckStyle(level) {
    neckFx.apply(level, { neck: neck, headPivot: headPivot });
    // Quick strikes changes the goat's gaze alongside its neck: teal, gold,
    // then violet, with increasingly glossy irises and more catchlights.
    const tier = neckFx.level, style = M.styleFx.neckStyle[tier];
    eyeMat.color.setHex(style ? style.color : 0xe8c078);
    eyeMat.emissive.setHex(style ? style.color : 0x000000);
    eyeMat.emissiveIntensity = tier * tier * 0.1;
    eyeMat.roughness = tier ? 0.28 - tier * 0.06 : 0.35;
    for (let i = 0; i < eyeParts.length; i++) {
      const eye = eyeParts[i];
      eye.iris.scale.set(0.082 * (1 + tier * 0.035), 0.098 * (1 + tier * 0.025), 0.056);
      eye.pupil.scale.set(0.053 * (1 - tier * 0.07), 0.022 * (1 - tier * 0.06), 0.016);
      eye.glint.material = tier ? eyeShineMat : furLight;
      eye.glint.scale.set(0.013 * (1 + tier * 0.18), 0.013 * (1 + tier * 0.18), 0.009);
      eye.extraShine[0].visible = tier >= 2;
      eye.extraShine[1].visible = tier >= 3;
      eye.star.visible = tier >= 3;
    }
  }

  // Damping toward a gait pose normally keeps hips in a small arc. After a long
  // wheel spin the hip angle is some large multiple of two pi; fold it back into
  // the nearest turn before easing into the walk, so the legs wind down instead
  // of unwinding a full rotation backwards.
  function foldAngle(a) { return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; }

  // ------------------------------------------------------------------ spells
  // Elemental strikes from Long horns. Effects live here so the goat owns its
  // own bolts, sparks and fireball; damage is dealt through M.enemies so loot,
  // HUD and death handling stay in one place.
  const boltMaterial = new THREE.LineBasicMaterial({ color: 0x8ce8ff, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flashGeometry = new THREE.SphereGeometry(1, 12, 10);
  const fireballGeometry = new THREE.SphereGeometry(0.24, 12, 10);
  const fireballMaterial = new THREE.MeshStandardMaterial({ color: 0xff9a3c, emissive: 0xff5c1a, emissiveIntensity: 1.5 });
  const spellFx = [];
  const sparks = [];
  const fireballs = [];

  function spellBolt(from, to) {
    if (M.config.reducedMotion || spellFx.length >= 40) return;
    const group = new THREE.Group();
    const delta = new THREE.Vector3().copy(to).sub(from);
    const side = new THREE.Vector3(-delta.z, 0, delta.x).normalize();
    const points = [];
    for (let i = 0; i <= 12; i++) {
      const k = i / 12, offset = i === 0 || i === 12 ? 0 : rand(-0.5, 0.5) * 0.55;
      points.push(new THREE.Vector3().copy(from).addScaledVector(delta, k).addScaledVector(side, offset).add(new THREE.Vector3(0, offset * 0.5, 0)));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, boltMaterial);
    group.add(line);
    group.userData.disposeGeometry = geometry;
    group.userData.sharedMaterial = true; // boltMaterial is shared with every bolt
    sceneRef.add(group);
    spellFx.push({ object: group, ttl: 0.18, life: 0, onAge: function (k) { line.visible = k < 0.8; } });
  }
  function sparkBurst(point, colors, count, speed, life, size) {
    if (M.config.reducedMotion) return;
    for (let j = 0; j < count; j++) {
      let spark = null;
      for (let i = 0; i < sparks.length; i++) {
        if (!sparks[i].mesh.visible) { spark = sparks[i]; break; }
      }
      if (!spark) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6),
          new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
        sceneRef.add(mesh);
        spark = { mesh: mesh, v: new THREE.Vector3() };
        sparks.push(spark);
      }
      const angle = rand(0, Math.PI * 2);
      const reach = speed * (0.4 + Math.random() * 0.6);
      spark.mesh.material.color.setHex(colors[Math.floor(Math.random() * colors.length)]);
      spark.mesh.material.opacity = 1;
      spark.mesh.visible = true;
      spark.mesh.position.copy(point);
      spark.size = size * (0.7 + Math.random() * 0.6);
      spark.maxLife = life * (0.7 + Math.random() * 0.6);
      spark.life = spark.maxLife;
      spark.v.set(Math.cos(angle) * reach, speed * (0.25 + Math.random() * 0.75), Math.sin(angle) * reach);
    }
  }
  function spellFlash(point, color, size, ttl) {
    if (M.config.reducedMotion) return;
    const material = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(flashGeometry, material);
    mesh.position.copy(point);
    mesh.scale.setScalar(size * 0.2);
    sceneRef.add(mesh);
    spellFx.push({ object: mesh, ttl: ttl, life: 0,
      onAge: function (k) { mesh.scale.setScalar(size * (0.2 + k * 1.15)); mesh.material.opacity = 0.55 * (1 - k); } });
  }
  // The fireball flies to the spot the target stood when it was aimed at;
  // walls burst it early, and the blast still lands around the impact point.
  function spawnFireball(from, to, dmg) {
    const fireball = { from: from.clone(), to: to.clone(), k: 0, dmg: dmg, mesh: null };
    if (!M.config.reducedMotion) {
      const mesh = new THREE.Mesh(fireballGeometry, fireballMaterial);
      mesh.position.copy(from);
      sceneRef.add(mesh);
      fireball.mesh = mesh;
    }
    fireballs.push(fireball);
    return fireball;
  }
  function explodeFireball(fireball, point) {
    if (fireball.mesh && fireball.mesh.parent) sceneRef.remove(fireball.mesh);
    const index = fireballs.indexOf(fireball);
    if (index >= 0) fireballs.splice(index, 1);
    if (M.enemies && M.enemies.spellBlast) M.enemies.spellBlast(point, 3, fireball.dmg);
    if (audioRef && audioRef.towerImpact) audioRef.towerImpact(point, 'mortar');
    if (!M.config.reducedMotion) {
      spellFlash(point, 0xffc06a, 1.7, 0.24);
      sparkBurst(point, [0xffb35c, 0xff6a22, 0xffedba], 18, 4.5, 0.62, 0.34);
    }
  }
  function muzzlePos() {
    return new THREE.Vector3(
      goat.position.x + Math.sin(state.yaw) * 0.85,
      goat.position.y + 1.85,
      goat.position.z + Math.cos(state.yaw) * 0.85
    );
  }
  // Returns true when an elemental strike fired. Falls back to melee when the
  // aimed spell finds no enemies (which lets mining and placing still work).
  function castSpell(reachLevel) {
    if (!M.upgrades || !M.upgrades.stats) return false;
    const stats = M.upgrades.stats();
    return castSpellAt(goat.position, reachLevel, 1 + stats.damage, muzzlePos());
  }
  // Elemental strikes for any caster, player or trained hunter. Damage flows
  // through M.enemies; the visuals (bolts, sparks, fireball) live here. The
  // spell ranges match M.upgrades' SPELL_RANGES: bolt 9, chain 12, fireball 30.
  function castSpellAt(from, tier, dmg, fxFrom) {
    if (!M.enemies || !M.enemies.spellTargets || !M.enemies.spellHit) return false;
    if (!(tier >= 1)) return false;
    const ranges = M.upgrades && M.upgrades.spellRanges ? M.upgrades.spellRanges() : [0, 9, 12, 30];
    const range = ranges[tier] || 0;
    if (!range) return false;
    const origin = new THREE.Vector3().copy(from);
    const muzzle = fxFrom || new THREE.Vector3(origin.x, origin.y + 1.15, origin.z);
    if (tier >= 3) {
      const targets = M.enemies.spellTargets(origin, range, 1);
      if (!targets.length) return false;
      const aim = new THREE.Vector3().copy(targets[0].position); aim.y += 0.8;
      spawnFireball(muzzle, aim, dmg);
      if (audioRef && audioRef.towerShot) audioRef.towerShot(origin.clone(), 'shell');
      return true;
    }
    const targets = M.enemies.spellTargets(origin, range, tier <= 1 ? 1 : 3);
    if (!targets.length) return false;
    let chainFrom = muzzle;
    for (let i = 0; i < targets.length; i++) {
      const enemy = targets[i];
      if (!M.enemies.zombies.includes(enemy)) continue;
      const to = new THREE.Vector3().copy(enemy.position); to.y += 0.8;
      spellBolt(chainFrom, to);
      M.enemies.spellHit(enemy, dmg);
      chainFrom = to;
    }
    if (audioRef && audioRef.towerShot) audioRef.towerShot(origin.clone(), 'bolt');
    return true;
  }
  // Returns the nearest enemy the goat could actually hit within range; this
  // is the trigger for automatic attacks and works for melee and spells alike.
  function autoTarget(range) {
    if (!M.enemies || !M.enemies.spellTargets || !range) return null;
    const targets = M.enemies.spellTargets(goat.position, range, 1);
    return targets.length ? targets[0] : null;
  }
  // Player-held action: clicks and E only interact with blocks now. Carrying a
  // selected block places it; otherwise mine the aimed voxel (or the block
  // dead ahead), exactly like the old headbutt fallback but without the lunge.
  function mine() {
    const carrying = M.items && M.items.hasSelectedBlock && M.items.hasSelectedBlock();
    if (carrying) {
      if (M.items.placeSelectedBlock()) recoverOverlap();
      return;
    }
    if (M.targeting) {
      const hit = M.targeting.aim(cameraRef, goat.position);
      if (hit) {
        worldRef.breakBlockAt(hit.bx, hit.by, hit.bz);
        return;
      }
    }
    if (worldRef && worldRef.breakBlockInFront) worldRef.breakBlockInFront(headPivot);
  }
  function updateSpellFx(dt, t) {
    for (let i = spellFx.length - 1; i >= 0; i--) {
      const fx = spellFx[i];
      fx.life += dt;
      const k = clamp(fx.life / fx.ttl, 0, 1);
      if (fx.onAge) fx.onAge(k);
      if (fx.life >= fx.ttl) {
        if (fx.object.userData.disposeGeometry) fx.object.userData.disposeGeometry.dispose();
        if (!fx.object.userData.sharedMaterial) {
          fx.object.traverse(function (o) {
            if (!o.material) return;
            const list = Array.isArray(o.material) ? o.material : [o.material];
            for (let j = 0; j < list.length; j++) list[j].dispose();
          });
        }
        if (fx.object.parent) fx.object.parent.remove(fx.object);
        spellFx.splice(i, 1);
      }
    }
    for (let i = 0; i < sparks.length; i++) {
      const spark = sparks[i];
      if (!spark.mesh.visible) continue;
      spark.life -= dt;
      if (spark.life <= 0) { spark.mesh.visible = false; continue; }
      const k = clamp(spark.life / spark.maxLife, 0, 1);
      spark.mesh.position.addScaledVector(spark.v, dt);
      spark.v.y -= 5.5 * dt;
      spark.mesh.scale.setScalar(spark.size * (0.35 + k * 0.65));
      spark.mesh.material.opacity = k;
    }
    for (let i = fireballs.length - 1; i >= 0; i--) {
      const fb = fireballs[i];
      const distance = Math.max(0.001, fb.to.distanceTo(fb.from));
      fb.k = clamp(fb.k + dt * 16 / distance, 0, 1);
      const p = new THREE.Vector3().lerpVectors(fb.from, fb.to, fb.k);
      if (fb.mesh) fb.mesh.position.copy(p);
      const hitWall = worldRef && worldRef.blockedAt && worldRef.blockedAt(p.x, p.z, p.y - 0.6, p.y + 0.6);
      if (hitWall || fb.k >= 1) { explodeFireball(fb, p); continue; }
      if (!M.config.reducedMotion && Math.random() < 0.7)
        sparkBurst(p, [0xffcf7a, 0xff7a2a], 1, 1.2, 0.24, 0.15);
    }
  }

  const GRAVITY = 26;
  // All attack ranges are tripled (2.8 headbutt, 3.1 stomp). The player never
  // aims a lunge anymore: attacks fire themselves at whatever is in reach.
  const MELEE_RANGE = 8.4, STOMP_RANGE = 9.3;
  const JUMP_SPEED = 12.2;
  const MAX_JUMPS = 3;
  const STEP_CLEARANCE = 0.06;
  const BODY_HEIGHT = 1.9;

  const physics = M.actorPhysics;
  const BODY = { radius: 0.42, height: BODY_HEIGHT, skin: 0.002 };
  const STOMP_LIFT_END = 0.24;
  const STOMP_IMPACT = 0.36;
  const STOMP_END = 0.54;

  let blinkTimer = rand(1.6, 3.2);
  let blink = 0;

  function canStandAt(x, z, feetY) {
    return physics.clear(worldRef, x, feetY, z, BODY);
  }

  function floorAt(maxY) {
    return physics.support(worldRef, goat.position, maxY, BODY);
  }

  function moveVertical(targetY) {
    return physics.moveVertical(worldRef, goat.position, BODY, targetY);
  }

  function face(yaw) {
    state.yaw = yaw;
  }

  function recoverOverlap() {
    if (physics.recover(worldRef, goat.position, BODY)) { state.vy = 0; state.grounded = false; }
  }

  function moveGoat(dx, dz) {
    const p = goat.position;
    const moved = physics.moveHorizontal(worldRef, p, BODY, dx, dz);
    if (!moved && state.swimming && state.shoreJump <= 0 && p.y > state.waterLevel - 1.65 &&
        canStandAt(p.x + dx, p.z + dz, p.y + worldRef.blockSize + 0.1)) {
      state.shoreJump = 0.45; state.vy = JUMP_SPEED * 0.92;
      state.grounded = false; state.swimming = false;
    }
    return moved;
  }

  function intersectsBlock(bx, by, bz) {
    return !!state && physics.intersectsBlock(goat.position, BODY, bx, by, bz, worldRef.blockSize);
  }

  function pickTarget() {
    const p = new THREE.Vector3();
    const toCamera = Math.atan2(cameraRef.position.x - goat.position.x, cameraRef.position.z - goat.position.z);
    const a = toCamera + rand(-1.35, 1.35) + (Math.random() < 0.22 ? Math.PI : 0);
    const d = rand(1.8, 4.5);
    p.set(goat.position.x + Math.sin(a) * d, 0, goat.position.z + Math.cos(a) * d);
    return p;
  }


  function updateGoat(dt, t) {
    const s = state;
    const upgrades = M.upgrades ? M.upgrades.stats() : { move: 1, rate: 1, reach: 0, damage: 0 };
    const speedLevel = M.upgrades && M.upgrades.player && typeof M.upgrades.level === 'function' ? M.upgrades.level(M.upgrades.player, 'move') : 0;
    const wheel = speedLevel >= 3;
    const reachLevel = M.upgrades && M.upgrades.player && typeof M.upgrades.level === 'function' ? M.upgrades.level(M.upgrades.player, 'reach') : 0;
    const previousYaw = s.yaw;
    s.landPulse = damp(s.landPulse || 0, 0, 13, dt);
    recoverOverlap();

    const input = controlsRef.getMovement(cameraRef);
    const steering = input.lengthSq() > 0;
    if (controlsRef.firstPerson) {
      // Face the view even when strafing or backing up, and never wander
      // autonomously while the player is looking through the goat's eyes.
      face(controlsRef.getFacingYaw());
      s.manualHold = 3;
    }
    let moving = false;
    s.shoreJump = Math.max(0, s.shoreJump - dt);
    const water = worldRef.waterInfoAtBlock(
      Math.floor(goat.position.x / worldRef.blockSize),
      Math.floor(goat.position.z / worldRef.blockSize), goat.position.y + 0.1
    );
    s.waterLevel = water ? water.level : 0;
    s.inWater = !!water && goat.position.y < water.level - 0.08;
    s.swimming = s.shoreJump <= 0 && !!water && water.depth > 1.2 &&
      goat.position.y < water.level - (s.swimming ? 0.55 : 0.9);
    s.submerged = s.swimming && goat.position.y + 1.95 < s.waterLevel;
    if (s.swimming) {
      s.grounded = false;
      s.jumps = 0;
      s.manualHold = 3;
      s.mode = 'manual';
    }

    if (steering) {
      // Player steering overrides the autonomous wanderer.
      const running = controlsRef.running;
      s.manualHold = 3.0;
      s.mode = 'manual';
      if (!controlsRef.firstPerson && s.headbutt < 0) face(turnToward(s.yaw, Math.atan2(input.x, input.y), dt * 7));
      s.speed = damp(s.speed, (s.swimming ? (running ? 4.6 : 3.1) : (running ? 9.6 : 4.8)) * upgrades.move, s.swimming ? 3.5 : 5, dt);

      const mx = input.x * s.speed * dt;
      const mz = input.y * s.speed * dt;
      if (moveGoat(mx, mz, s.yaw)) {
        s.walkPhase += s.speed * dt * (running ? 2.4 : 4.6);
        if (running) s.runPhase += s.speed * dt * 2.4;
        moving = true;
      }
    } else if (s.manualHold > 0) {
      // Just after steering, stand and let the player watch for a moment.
      s.manualHold = Math.max(0, s.manualHold - dt);
      s.mode = 'idle';
      s.speed = damp(s.speed, 0, 5, dt);
      s.wait = Math.max(s.wait, 2.0);
    } else if (s.mode === 'walk') {
      const dx = s.target.x - goat.position.x;
      const dz = s.target.z - goat.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.18) {
        s.mode = 'idle';
        s.wait = rand(2.5, 6.0);
      } else {
        face(turnToward(s.yaw, Math.atan2(dx, dz), dt * 4.5));
        s.speed = damp(s.speed, clamp(1.6 + dist * 1.3, 1.6, 3.4), 3.0, dt);

        const mx = dx / dist * s.speed * dt;
        const mz = dz / dist * s.speed * dt;
        if (moveGoat(mx, mz, s.yaw)) {
          s.walkPhase += s.speed * dt * 4.6;
          moving = true;
        } else {
          // The goat will not scramble up ledges on its own.
          s.mode = 'idle';
          s.wait = rand(1.2, 2.8);
          s.speed = 0;
        }
      }
    } else {
      s.speed = damp(s.speed, 0, 5, dt);
      s.wait -= dt;
      if (s.wait <= 0) {
        s.target.copy(pickTarget());
        s.mode = 'walk';
      }
    }

    goat.rotation.y = s.yaw;

    s.runBlend = damp(s.runBlend, (!s.swimming && controlsRef.running && steering && moving) ? 1 : 0, 10, dt);
    s.swimBlend = damp(s.swimBlend, s.swimming ? 1 : 0, 7, dt);
    s.swimPhase += dt * (s.swimming ? 4.4 + s.speed * 1.3 : 2);
    const swim = s.swimBlend;
    const run = s.runBlend;

    // ---- vertical physics: gravity, jumps, and block tops ----
    let groundY = floorAt(goat.position.y + STEP_CLEARANCE);

    if (s.swimming) {
      // Drag dissipates entry momentum; a gentle buoyancy spring holds the
      // chest at the surface without bobbing in and out of the swim state.
      const surfaceFeet = s.waterLevel - 1.3;
      const vertical = controlsRef.swimVertical;
      const pitch = steering && controlsRef.getSwimPitch ? controlsRef.getSwimPitch(cameraRef) : 0;
      let wanted = goat.position.y < surfaceFeet - 0.45 ? 0.65 : (surfaceFeet - goat.position.y) * 4;
      if (Math.abs(pitch) > 0.15) wanted = pitch * 3.1;
      if (vertical !== 0) wanted = vertical > 0 ? 3.6 : -2.8;
      s.vy = damp(clamp(s.vy, -4.5, 4), wanted, 6, dt);
      const prevY = goat.position.y;
      const nextY = Math.max(groundY, Math.min(surfaceFeet + 0.08, prevY + s.vy * dt));
      if ((s.vy < 0 && nextY <= groundY) || (s.vy > 0 && nextY >= surfaceFeet + 0.08)) s.vy = 0;
      if (!moveVertical(nextY)) s.vy = 0;
    } else {
      if (s.grounded) {
        if (goat.position.y > groundY + 0.02) {
          // The ground fell away underneath us.
          s.grounded = false;
          s.vy = 0;
        } else {
          goat.position.y = groundY;
          s.vy = 0;
        }
      }

      if (!s.grounded) {
        const prevY = goat.position.y;
        s.vy = Math.max(-38, s.vy - GRAVITY * dt);
        const nextY = prevY + s.vy * dt;
        groundY = floorAt(Math.max(prevY, nextY) + 0.001);
        const landing = s.vy <= 0 && nextY <= groundY;
        const impact = clamp(Math.abs(s.vy) / 10, 0.3, 1.2);
        const clear = moveVertical(landing ? groundY : nextY);
        if (!clear) s.vy = 0;
        if ((landing && clear) || (!clear && nextY < prevY)) {
          s.vy = 0; s.grounded = true; s.jumps = 0;
          s.footTimer = Math.max(s.footTimer, 0.14);
          s.landPulse = impact;
          if (!s.inWater) audioRef.land(impact);
        }
      }
    }

    // ---- headbutt timing and impact ----
    s.headbuttCooldown = Math.max(0, s.headbuttCooldown - dt * upgrades.rate);
    let buttPose = 0;
    let headbuttPending = false;
    if (s.headbutt >= 0) {
      s.headbutt += dt * upgrades.rate;
      buttPose = actionPose(s.headbutt, 0.12, 0.34);
      if (!s.headbuttHit && s.headbutt >= 0.12) headbuttPending = true;
      if (s.headbutt > 0.34) s.headbutt = -1;
    }

    // ---- hoof stomp timing ----
    s.stompCooldown = Math.max(0, s.stompCooldown - dt * upgrades.rate);
    let stompLift = 0;
    let stompPending = false;
    if (s.stomp >= 0) {
      s.stomp += dt * upgrades.rate;
      if (s.stomp < STOMP_LIFT_END) {
        const v = clamp(s.stomp / STOMP_LIFT_END, 0, 1);
        stompLift = v * v * (3 - 2 * v);
      } else if (s.stomp < STOMP_IMPACT) {
        const v = clamp((s.stomp - STOMP_LIFT_END) / (STOMP_IMPACT - STOMP_LIFT_END), 0, 1);
        stompLift = 1 - v * v * (3 - 2 * v);
      }
      if (!s.stompHit && s.stomp >= STOMP_IMPACT) stompPending = true;
      if (s.stomp > STOMP_END) s.stomp = -1;
    }

    // ---- automatic attacks ----
    // The goat fights by itself (Vampire Survivors / Megabonk style) whenever
    // an enemy is in reach, but it never steers the player: bolts and fireballs
    // auto-aim at the nearest enemy, and melee stomps strike around your own
    // facing, which stays fully mouse-controlled. Holding a block to place
    // keeps the goat out of a fight.
    const holdsBlock = M.items && M.items.hasSelectedBlock && M.items.hasSelectedBlock();
    if (!holdsBlock && !(M.strategy && M.strategy.active)) {
      const headbuttRange = reachLevel >= 1 ? upgrades.reach : MELEE_RANGE;
      if (s.headbutt < 0 && s.headbuttCooldown <= 0) {
        const target = autoTarget(headbuttRange);
        const projectile = reachLevel >= 1; // elemental strikes aim themselves
        // Melee headbutts only swing at enemies inside the facing arc; the
        // player decides direction by looking, never by the goat turning.
        const aimed = target && (projectile || M.enemies.canHit(target, goat.position, s.yaw, false, headbuttRange));
        if (aimed) startHeadbutt();
      }
      if (s.stomp < 0 && s.stompCooldown <= 0 && s.grounded) {
        // The stomp pounds everything in range all around; it needs no aim.
        if (autoTarget(STOMP_RANGE)) startStomp();
      }
    }

    // Headbutts take priority when both automatic attacks overlap. Stomps
    // use their own impact clock once the headbutt animation finishes.
    const neckAttack = s.headbutt >= 0
      ? neckFx.animate(s.headbutt, 0.12, 0.34, M.config.reducedMotion)
      : neckFx.animate(s.stomp, STOMP_IMPACT, STOMP_END, M.config.reducedMotion);
    if (neckFx.level > 0) buttPose = neckAttack.lunge;

    s.tuck = damp(s.tuck, s.grounded || s.swimming ? 0 : 1, 12, dt);
    const jumpK = s.tuck;
    s.stride = damp(s.stride || 0, moving ? clamp(s.speed / 0.6, 0, 1) : 0, 12, dt);
    const stride = s.stride;

    const wheelSpin = wheel && jumpK <= 0.01 && stride > 0.06 && swim < 0.5;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      let hipTarget;
      let kneeTarget;
      if (jumpK > 0.01) {
        hipTarget = (leg.front ? -0.55 : 0.5) * jumpK;
        kneeTarget = 0.75 * jumpK;
      } else if (wheelSpin) {
        // Third tier: legs cartwheel end over end like spinning wheel spokes.
        // Diagonal pairs stay opposite, as in a gallop, and knees lock straight.
        // The wheel starts at the leg's current angle so switching gaits is seamless.
        const rawPhase = s.walkPhase * 0.7 + leg.offset;
        if (leg.wheelBase === undefined) leg.wheelBase = leg.hip.rotation.x - rawPhase;
        hipTarget = leg.wheelBase + rawPhase;
        kneeTarget = 0.02;
      } else {
        if (leg.wheelBase !== undefined) {
          leg.hip.rotation.x = foldAngle(leg.hip.rotation.x);
          leg.wheelBase = undefined;
        }
        // Trained tiers take crisper, deeper strides rather than a plain speed-up.
        const amp = 1 + speedLevel * 0.06;
        const kneeAmp = 1 + speedLevel * 0.08;
        const phW = s.walkPhase + leg.offset;
        const phR = s.runPhase + leg.runOffset;
        const walk = hoofPose(phW, stride, 0);
        const gallop = hoofPose(phR, stride, 1);
        hipTarget = (walk.hip + (gallop.hip - walk.hip) * run) * amp;
        kneeTarget = (walk.knee + (gallop.knee - walk.knee) * run) * kneeAmp;
      }
      // Alternating diagonal dog-paddle: a long power stroke, folded knee
      // recovery, and slightly splayed hooves. Phase never resets on entry.
      const paddle = s.swimPhase + leg.offset + (leg.front ? 0 : 0.45);
      const hipSwim = (leg.front ? -0.3 : 0.2) + Math.sin(paddle) * (0.42 + s.speed * 0.045);
      const kneeSwim = 0.55 + Math.max(0, -Math.cos(paddle)) * 0.7;
      hipTarget += (hipSwim - hipTarget) * swim;
      kneeTarget += (kneeSwim - kneeTarget) * swim;
      leg.hip.rotation.z = damp(leg.hip.rotation.z, Math.sign(leg.hip.position.x) * swim * 0.12, 8, dt);
      if (leg === stompLeg) {
        hipTarget -= 0.72 * stompLift;
        kneeTarget += 1.35 * stompLift;
      }
      if (wheelSpin) {
        leg.hip.rotation.x = hipTarget; // continuous rotation, no damping lag
      } else {
        leg.hip.rotation.x = damp(leg.hip.rotation.x, hipTarget, 22, dt);
      }
      leg.knee.rotation.x = damp(leg.knee.rotation.x, kneeTarget, 22, dt);
      const recovery = Math.max(0, Math.sin(s.walkPhase + leg.offset));
      const ankleTarget = wheelSpin ? 0 : -kneeTarget * 0.58 + recovery * 0.16 * stride * (1 - swim) + jumpK * 0.22;
      leg.ankle.rotation.x = damp(leg.ankle.rotation.x, ankleTarget, 24, dt);
    }

    const walkBob = moving && s.grounded ? Math.abs(Math.sin(s.walkPhase)) * 0.03 * stride : 0;
    const runBob = moving && s.grounded ? Math.max(0, Math.sin(s.runPhase)) * 0.1 * stride : 0;
    // Faster tiers bounce with each stride instead of just moving quicker.
    const hopBob = !wheel && moving && s.grounded ? Math.abs(Math.sin(s.walkPhase * 2)) * 0.014 * speedLevel * stride : 0;
    const bob = walkBob * (1 - run) + runBob * run;
    rig.position.y = damp(rig.position.y, bob * (1 - swim) + hopBob * (1 - swim) - s.landPulse * 0.08 + Math.sin(s.swimPhase * 2) * 0.018 * swim, 15, dt);
    rig.position.z = damp(rig.position.z, buttPose * 0.18 + run * 0.035, 16, dt);
    const weightShift = M.config.reducedMotion ? 0 : Math.sin(s.walkPhase) * 0.018 * stride * (1 - run);
    rig.position.x = damp(rig.position.x, weightShift + Math.sign(stompLeg.hip.position.x) * stompLift * 0.025, 12, dt);
    const squash = M.config.reducedMotion ? 0 : s.landPulse;
    rig.scale.set(1 + squash * 0.025, 1 - squash * 0.055, 1 + squash * 0.025);
    const yawDelta = Math.atan2(Math.sin(s.yaw - previousYaw), Math.cos(s.yaw - previousYaw));
    s.turnLean = damp(s.turnLean || 0, clamp(yawDelta / Math.max(dt, 0.001), -3, 3) * s.speed * 0.008, 8, dt);

    const breath = 1 + Math.sin(t * 1.55) * (moving ? 0.004 : 0.011);
    chest.scale.set(0.37 * breath, 0.4 * breath, 0.4 * breath);
    const stompTilt = -0.05 * stompLift;
    const swimPitch = clamp(-s.vy * 0.075, -0.26, 0.26) - 0.08;
    rig.rotation.x = damp(rig.rotation.x, ((jumpK > 0 ? -0.16 * jumpK : 0) + Math.sin(s.runPhase + 0.7) * 0.05 * run) * (1 - swim) + swimPitch * swim + buttPose * 0.08, 6, dt);
    const landRoll = (moving ? Math.sin(s.walkPhase) * 0.018 * (1 - run) : 0) + Math.sin(s.runPhase) * 0.03 * run;
    rig.rotation.z = damp(rig.rotation.z, landRoll * (1 - swim) + Math.sin(s.swimPhase) * 0.035 * swim + stompTilt - (M.config.reducedMotion ? 0 : s.turnLean), 8, dt);

    let lookYaw = moving ? Math.sin(t * 0.9) * 0.04 : Math.sin(t * 0.55) * 0.12;
    if (s.headbutt >= 0 || s.stomp >= 0) lookYaw = 0;
    if (!moving && s.grounded && s.headbutt < 0 && s.stomp < 0) {
      const camLocal = goat.worldToLocal(cameraRef.position.clone());
      lookYaw = clamp(Math.atan2(camLocal.x, camLocal.z), -0.6, 0.6) * 0.9;
    }
    headPivot.rotation.y = damp(headPivot.rotation.y, lookYaw, 3.0, dt);

    const walkHeadBob = moving ? Math.sin(s.walkPhase * 2) * 0.05 : Math.sin(t * 1.25) * 0.022;
    const runHeadBob = moving ? Math.sin(s.runPhase * 2) * 0.05 : 0;
    const headBob = (walkHeadBob * (1 - run) + runHeadBob * run) * (1 - swim) + Math.sin(s.swimPhase * 2 + 0.4) * 0.018 * swim;
    const headLift = jumpK > 0 ? -0.15 * jumpK : 0;
    headPivot.rotation.x = damp(headPivot.rotation.x, -0.18 + headBob + headLift + buttPose * 0.34 + run * 0.08 - (s.headbutt >= 0 ? (s.aimPitch || 0) * .65 : 0) - speedLevel * 0.03, 10, dt);
    const neckResponse = neckFx.level > 0 ? 22 + neckFx.level * 6 : 8;
    neckPivot.rotation.x = damp(neckPivot.rotation.x, 0.42 + buttPose * 0.55 + run * 0.08 - swim * 0.16 - speedLevel * 0.04, neckResponse, dt);
    neckPivot.rotation.y = damp(neckPivot.rotation.y, neckAttack.yaw, neckResponse, dt);
    neckPivot.rotation.z = damp(neckPivot.rotation.z, neckAttack.roll, neckResponse, dt);

    // Automatic lunges only fight; mining and placing live on the click action.
    if (headbuttPending) {
      s.headbuttHit = true;
      const carrying = M.items && M.items.hasSelectedBlock && M.items.hasSelectedBlock();
      if (carrying) {
        if (M.items.placeSelectedBlock()) {
          recoverOverlap();
        }
      } else if (reachLevel >= 1 && castSpell(reachLevel)) {
        // Long horns channel an elemental strike instead of a melee lunge.
      } else if (M.enemies && M.enemies.attack(goat.position, s.yaw, false, { range: MELEE_RANGE, damage: 1 + upgrades.damage, maxTargets: 3 })) {
        audioRef.thud();
      }
    }

    if (stompPending) {
      s.stompHit = true;
      const hit = s.grounded && M.enemies && M.enemies.attack(goat.position, s.yaw, true, { range: STOMP_RANGE, damage: 2 + upgrades.damage, maxTargets: 8 });
      // Stomps are automatic too, so they never chew the ground they miss.
      audioRef.stomp(hit);
    }

    // Soft footfalls while moving, and a quiet breath while resting.
    if (moving && s.grounded && !s.inWater) {
      s.footTimer -= dt;
      if (s.footTimer <= 0) {
        audioRef.step(s.runBlend > 0.5, s.speed);
        s.footTimer = 0.3 - s.runBlend * 0.11;
      }
    } else {
      s.footTimer = Math.min(s.footTimer, 0.08);
    }

    if (!moving && s.grounded && !s.submerged && s.headbutt < 0 && s.stomp < 0) {
      s.breathTimer -= dt;
      if (s.breathTimer <= 0) {
        audioRef.breath();
        s.breathTimer = rand(6, 11);
      }
    } else {
      s.breathTimer = Math.min(s.breathTimer, 2.5);
    }

    s.earTimer -= dt;
    if (s.earTimer <= 0) {
      s.earTimer = rand(2.4, 6);
      s.earTwitch = 1;
    }
    s.earTwitch = Math.max(0, s.earTwitch - dt * 5);
    const twitch = s.earTwitch > 0 ? Math.sin((1 - s.earTwitch) * Math.PI) * 0.24 : 0;

    for (let i = 0; i < ears.length; i++) {
      const ear = ears[i];
      const bounce = Math.sin(s.walkPhase * 2 + ear.side) * 0.1 * stride;
      ear.pivot.rotation.z = ear.baseZ + ear.side * (bounce + twitch);
      ear.pivot.rotation.x = 0.08 + Math.sin(t * 1.1 + ear.side) * 0.035 + run * 0.12;
      ear.pivot.rotation.y = -ear.side * (0.55 * run + 0.28 * speedLevel);
    }

    s.happy = Math.max(0, s.happy - dt * 0.75);
    tailPivot.rotation.z = Math.sin(t * (3.2 + s.happy * 6.5)) * (0.22 + s.happy * 0.3 + run * 0.14);
    tailPivot.rotation.x = -0.55 - run * 0.25 - speedLevel * 0.12 + Math.sin(t * 1.6) * 0.05 + wheel * Math.sin(s.walkPhase) * 0.15;

    blinkTimer -= dt;
    if (blinkTimer <= 0) {
      blinkTimer = rand(2.2, 5.4);
      blink = 1;
    }
    blink = Math.max(0, blink - dt * 8);
    const lid = 1 - 0.9 * blink;
    for (let i = 0; i < eyes.length; i++) eyes[i].scale.y = lid;

    bell.rotation.z = Math.sin(t * 2.5) * 0.12 + s.speed * Math.sin(s.walkPhase) * 0.1;
    bell.rotation.x = Math.sin(t * 2.1 + 1) * 0.1;

    // Horns glow and pulse at the speed of their elemental charge.
    hornFx.pulse(t);

    // Advance bolts, sparks and fireballs, and their collisions.
    updateSpellFx(dt, t);
  }

  function jump() {
    if (state.swimming) {
      controlsRef.noteActivity();
      return;
    }
    if (!state.grounded && state.jumps >= MAX_JUMPS) return;
    if (state.grounded) state.jumps = 0;
    state.jumps++;
    state.vy = JUMP_SPEED;
    state.grounded = false;
    controlsRef.noteActivity();
    audioRef.unlock();
    audioRef.jump();
  }

  function startHeadbutt() {
    if (state.headbuttCooldown > 0) return;
    if (cameraRef) {
      const direction = new THREE.Vector3(); cameraRef.getWorldDirection(direction);
      state.yaw = Math.atan2(direction.x, direction.z);
      state.aimPitch = Math.asin(clamp(direction.y, -1, 1));
      state.manualHold = Math.max(state.manualHold, 3);
    }
    state.headbutt = 0;
    state.headbuttHit = false;
    state.headbuttCooldown = 0.55;
    state.happy = Math.max(state.happy, 0.4);
    controlsRef.noteActivity();
    audioRef.unlock();
    audioRef.whoosh();
  }

  function startStomp() {
    if (!state.grounded || state.stompCooldown > 0) return;
    state.stomp = 0;
    state.stompHit = false;
    state.stompCooldown = 0.7;
    controlsRef.noteActivity();
    audioRef.unlock();
  }

  function greet() {
    jump();
    state.happy = 1;
    audioRef.bleat();
    uiRef.showBubble(Math.random() < 0.7 ? 'maa!' : 'mehh!');
  }
  function init(deps) {
    sceneRef = deps.scene;
    cameraRef = deps.camera;
    controlsRef = deps.controls;
    worldRef = deps.world;
    audioRef = deps.audio;
    uiRef = deps.ui;

    sceneRef.add(goat);
    const spawn = M.config.startingArea.spawn;
    goat.position.set(spawn.x, worldRef.surfaceHeight(spawn.x, spawn.z), spawn.z);
    goat.rotation.y = goatYaw;

    state = {
      mode: 'idle',
      wait: 3.2,
      target: new THREE.Vector3(goat.position.x - 2.0, 0, goat.position.z + 0.8),
      yaw: goatYaw,
      speed: 0,
      walkPhase: 0,
      runPhase: 0,
      runBlend: 0,
      inWater: false,
      swimming: false,
      submerged: false,
      waterLevel: 0,
      swimBlend: 0,
      swimPhase: 0,
      shoreJump: 0,
      vy: 0,
      grounded: true,
      jumps: 0,
      tuck: 0,
      happy: 0,
      earTimer: 2.2,
      earTwitch: 0,
      manualHold: 0,
      footTimer: 0.08,
      breathTimer: rand(6, 10),
      headbutt: -1,
      headbuttHit: false,
      headbuttCooldown: 0,
      stomp: -1,
      stompHit: false,
      stompCooldown: 0
    };

    M.goat.group = goat;
    M.goat.headPivot = headPivot;
    M.goat.state = state;
  }

  M.goat = {
    init: init,
    update: updateGoat,
    jump: jump,
    mine: mine,
    startHeadbutt: startHeadbutt,
    startStomp: startStomp,
    greet: greet,
    applySpeedStyle: applySpeedStyle,
    applyHornStyle: applyHornStyle,
    applyNeckStyle: applyNeckStyle,
    get speedStyle() { return speedFx.level; },
    get hornStyle() { return hornFx.level; },
    get neckStyle() { return neckFx.level; },
    castSpellAt: castSpellAt,
    advanceSpellFx: updateSpellFx,
    intersectsBlock: intersectsBlock,
    body: BODY,
    get aimCamera() { return cameraRef; },
    group: null,
    headPivot: null,
    state: null
  };
})(window.Meadow = window.Meadow || {});
