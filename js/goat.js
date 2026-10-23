(function (M) {
  'use strict';

  const { clamp, rand, damp, turnToward } = M.utils;
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
      const radius = THREE.MathUtils.lerp(0.062, 0.009, Math.pow(t, 0.72));
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

  const eyes = [];
  [-1, 1].forEach(function (sign) {
    const eye = new THREE.Group();
    eye.position.set(sign * 0.2, 0.065, 0.18);
    eye.rotation.y = sign * 0.62;
    headPivot.add(eye);

    const ball = ellipsoid(eyeMat, 0.082, 0.098, 0.056, 12, 10);
    ball.castShadow = false;
    eye.add(ball);

    const pupil = ellipsoid(pupilMat, 0.053, 0.022, 0.016, 10, 7);
    pupil.position.set(0, 0.003, 0.049);
    pupil.castShadow = false;
    eye.add(pupil);

    const glint = ellipsoid(furLight, 0.013, 0.013, 0.009, 6, 5);
    glint.position.set(0.019, 0.03, 0.056);
    glint.castShadow = false;
    eye.add(glint);

    eyes.push(eye);
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
  [-1, 1].forEach(function (sign) {
    const horn = makeHorn(sign);
    horn.position.set(sign * 0.095, 0.225, 0.0);
    headPivot.add(horn);
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

    const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.13, 8), hoofMat);
    hoof.position.y = -0.465;
    hoof.castShadow = true;
    hoof.receiveShadow = true;
    knee.add(hoof);

    legs.push({ hip: hip, knee: knee, front: front, offset: offset, runOffset: runOffset });
  }
  makeLeg(-0.23, 0.42, true, 0, Math.PI);
  makeLeg(0.23, 0.42, true, Math.PI, Math.PI * 1.5);
  makeLeg(-0.25, -0.45, false, Math.PI, 0);
  makeLeg(0.25, -0.45, false, 0, Math.PI * 0.5);
  const stompLeg = legs[1];
  const GRAVITY = 26;
  const JUMP_SPEED = 12.2;
  const MAX_JUMPS = 3;
  const STEP_CLEARANCE = 0.06;
  const BODY_HEIGHT = 1.9;

  // Collision probes in goat-local space: [side, forward]. Checking only the
  // centre let the muzzle and chest sink into a block before the goat stopped,
  // so the footprint reaches out to the nose and around the shoulders.
  const FOOTPRINT = [
    [0, 1.25],
    [0.2, 1.0],
    [-0.2, 1.0],
    [0.38, 0.55],
    [-0.38, 0.55],
    [0.46, 0],
    [-0.46, 0]
  ];
  const STOMP_LIFT_END = 0.24;
  const STOMP_IMPACT = 0.36;
  const STOMP_END = 0.54;

  let blinkTimer = rand(1.6, 3.2);
  let blink = 0;

  function canStandAt(x, z, feetY, yaw) {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const bottom = feetY + STEP_CLEARANCE;
    const top = feetY + BODY_HEIGHT;

    for (let i = 0; i < FOOTPRINT.length; i++) {
      const side = FOOTPRINT[i][0];
      const ahead = FOOTPRINT[i][1];
      const px = x + sin * ahead + cos * side;
      const pz = z + cos * ahead - sin * side;
      if (worldRef.blockedAt(px, pz, bottom, top)) return false;
    }
    return true;
  }

  function moveGoat(dx, dz, yaw) {
    const feetY = goat.position.y;
    const x = goat.position.x;
    const z = goat.position.z;

    if (canStandAt(x + dx, z + dz, feetY, yaw)) {
      goat.position.x = x + dx;
      goat.position.z = z + dz;
      return true;
    }

    // slide along the blocking edge
    let moved = false;
    if (dx !== 0 && canStandAt(x + dx, z, feetY, yaw)) {
      goat.position.x = x + dx;
      moved = true;
    }
    if (dz !== 0 && canStandAt(goat.position.x, z + dz, feetY, yaw)) {
      goat.position.z = z + dz;
      moved = true;
    }
    return moved;
  }

  // A freshly placed block can overlap the muzzle. Back the goat out until
  // its real collision footprint is clear again.
  function makeRoomAfterPlacement() {
    const s = state;
    const x0 = goat.position.x;
    const z0 = goat.position.z;
    if (canStandAt(x0, z0, goat.position.y, s.yaw)) return;

    const backX = -Math.sin(s.yaw);
    const backZ = -Math.cos(s.yaw);
    for (let i = 1; i <= 28; i++) {
      const x = x0 + backX * 0.08 * i;
      const z = z0 + backZ * 0.08 * i;
      if (canStandAt(x, z, goat.position.y, s.yaw)) {
        goat.position.x = x;
        goat.position.z = z;
        return;
      }
    }
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

    const input = controlsRef.getMovement(cameraRef);
    const steering = input.lengthSq() > 0;
    let moving = false;

    if (steering) {
      // Player steering overrides the autonomous wanderer.
      const running = controlsRef.running;
      s.manualHold = 3.0;
      s.mode = 'manual';
      s.yaw = turnToward(s.yaw, Math.atan2(input.x, input.y), dt * 7);
      s.speed = damp(s.speed, running ? 9.6 : 4.8, 5, dt);

      const mx = Math.sin(s.yaw) * s.speed * dt;
      const mz = Math.cos(s.yaw) * s.speed * dt;
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
        s.yaw = turnToward(s.yaw, Math.atan2(dx, dz), dt * 4.5);
        s.speed = damp(s.speed, clamp(1.6 + dist * 1.3, 1.6, 3.4), 3.0, dt);

        const mx = Math.sin(s.yaw) * s.speed * dt;
        const mz = Math.cos(s.yaw) * s.speed * dt;
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

    s.runBlend = damp(s.runBlend, (controlsRef.running && steering && moving) ? 1 : 0, 10, dt);
    const run = s.runBlend;

    // ---- vertical physics: gravity, jumps, and block tops ----
    let groundY = worldRef.supportHeight(
      goat.position.x,
      goat.position.z,
      goat.position.y + STEP_CLEARANCE
    );

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
      s.vy -= GRAVITY * dt;
      goat.position.y += s.vy * dt;
      groundY = worldRef.supportHeight(
        goat.position.x,
        goat.position.z,
        Math.max(prevY, goat.position.y)
      );

      if (s.vy <= 0 && goat.position.y <= groundY) {
        const impact = clamp(Math.abs(s.vy) / 10, 0.3, 1.2);
        goat.position.y = groundY;
        s.vy = 0;
        s.grounded = true;
        s.jumps = 0;
        s.footTimer = Math.max(s.footTimer, 0.14);
        audioRef.land(impact);
      }
    }

    // ---- headbutt timing and impact ----
    s.headbuttCooldown = Math.max(0, s.headbuttCooldown - dt);
    let buttPose = 0;
    let headbuttPending = false;
    if (s.headbutt >= 0) {
      s.headbutt += dt;
      buttPose = Math.sin(clamp(s.headbutt / 0.34, 0, 1) * Math.PI);
      if (!s.headbuttHit && s.headbutt >= 0.12) headbuttPending = true;
      if (s.headbutt > 0.34) s.headbutt = -1;
    }

    // ---- hoof stomp timing ----
    s.stompCooldown = Math.max(0, s.stompCooldown - dt);
    let stompLift = 0;
    let stompPending = false;
    if (s.stomp >= 0) {
      s.stomp += dt;
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

    s.tuck = damp(s.tuck, s.grounded ? 0 : 1, 12, dt);
    const jumpK = s.tuck;
    const stride = moving ? clamp(s.speed / 0.6, 0, 1) : 0;

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      let hipTarget;
      let kneeTarget;
      if (jumpK > 0.01) {
        hipTarget = (leg.front ? -0.55 : 0.5) * jumpK;
        kneeTarget = 0.75 * jumpK;
      } else {
        const phW = s.walkPhase + leg.offset;
        const phR = s.runPhase + leg.runOffset;
        const hipWalk = Math.sin(phW) * 0.6 * stride;
        const kneeWalk = Math.max(0, -Math.cos(phW)) * 0.85 * stride + 0.04;
        const hipRun = Math.sin(phR) * 0.95 * stride;
        const kneeRun = Math.max(0, -Math.cos(phR)) * 1.15 * stride + 0.04;
        hipTarget = hipWalk + (hipRun - hipWalk) * run;
        kneeTarget = kneeWalk + (kneeRun - kneeWalk) * run;
      }
      if (leg === stompLeg) {
        hipTarget -= 0.72 * stompLift;
        kneeTarget += 1.35 * stompLift;
      }
      leg.hip.rotation.x = damp(leg.hip.rotation.x, hipTarget, 22, dt);
      leg.knee.rotation.x = damp(leg.knee.rotation.x, kneeTarget, 22, dt);
    }

    const walkBob = moving && s.grounded ? Math.abs(Math.sin(s.walkPhase)) * 0.03 * stride : 0;
    const runBob = moving && s.grounded ? Math.max(0, Math.sin(s.runPhase)) * 0.1 * stride : 0;
    const bob = walkBob * (1 - run) + runBob * run;
    rig.position.y = damp(rig.position.y, bob, 30, dt);
    rig.position.z = buttPose * 0.18;

    const breath = 1 + Math.sin(t * 1.55) * (moving ? 0.004 : 0.011);
    chest.scale.set(0.37 * breath, 0.4 * breath, 0.4 * breath);
    const stompTilt = -0.05 * stompLift;
    rig.rotation.x = damp(rig.rotation.x, (jumpK > 0 ? -0.16 * jumpK : 0) + buttPose * 0.08 + Math.sin(s.runPhase + 0.7) * 0.05 * run, 9, dt);
    rig.rotation.z = (moving ? Math.sin(s.walkPhase) * 0.018 * (1 - run) : 0) + Math.sin(s.runPhase) * 0.03 * run + stompTilt;

    let lookYaw = moving ? Math.sin(t * 0.9) * 0.04 : Math.sin(t * 0.55) * 0.12;
    if (s.headbutt >= 0 || s.stomp >= 0) lookYaw = 0;
    if (!moving && s.grounded && s.headbutt < 0 && s.stomp < 0) {
      const camLocal = goat.worldToLocal(cameraRef.position.clone());
      lookYaw = clamp(Math.atan2(camLocal.x, camLocal.z), -0.6, 0.6) * 0.9;
    }
    headPivot.rotation.y = damp(headPivot.rotation.y, lookYaw, 3.0, dt);

    const walkHeadBob = moving ? Math.sin(s.walkPhase * 2) * 0.05 : Math.sin(t * 1.25) * 0.022;
    const runHeadBob = moving ? Math.sin(s.runPhase * 2) * 0.05 : 0;
    const headBob = walkHeadBob * (1 - run) + runHeadBob * run;
    const headLift = jumpK > 0 ? -0.15 * jumpK : 0;
    headPivot.rotation.x = damp(headPivot.rotation.x, -0.18 + headBob + headLift + buttPose * 0.34 + run * 0.08, 10, dt);
    neckPivot.rotation.x = 0.42 + buttPose * 0.55 + run * 0.08;

    // With a block on the horns, the same lunge places it instead of smashing.
    if (headbuttPending) {
      s.headbuttHit = true;
      const carrying = M.items && M.items.hasSelectedBlock && M.items.hasSelectedBlock();
      if (carrying) {
        if (M.items.placeSelectedBlock()) {
          makeRoomAfterPlacement();
          audioRef.thud();
        }
      } else if (worldRef.breakBlockInFront(headPivot)) {
        audioRef.thud();
      }
    }

    if (stompPending) {
      s.stompHit = true;
      const broke = s.grounded && worldRef.breakBlockBelow(goat.position.x, goat.position.z, goat.position.y);
      audioRef.stomp(broke);
      if (broke) s.footTimer = Math.max(s.footTimer, 0.3);
    }

    // Soft footfalls while moving, and a quiet breath while resting.
    if (moving && s.grounded) {
      s.footTimer -= dt;
      if (s.footTimer <= 0) {
        audioRef.step(s.runBlend > 0.5, s.speed);
        s.footTimer = 0.3 - s.runBlend * 0.11;
      }
    } else {
      s.footTimer = Math.min(s.footTimer, 0.08);
    }

    if (!moving && s.grounded && s.headbutt < 0 && s.stomp < 0) {
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
      ear.pivot.rotation.y = -ear.side * 0.55 * run;
    }

    s.happy = Math.max(0, s.happy - dt * 0.75);
    tailPivot.rotation.z = Math.sin(t * (3.2 + s.happy * 6.5)) * (0.22 + s.happy * 0.3 + run * 0.14);
    tailPivot.rotation.x = -0.55 - run * 0.25 + Math.sin(t * 1.6) * 0.05;

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
  }

  function jump() {
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
    goat.position.set(0.9, worldRef.surfaceHeight(0.9, 0.7), 0.7);
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
    startHeadbutt: startHeadbutt,
    startStomp: startStomp,
    greet: greet,
    group: null,
    headPivot: null,
    state: null
  };
})(window.Meadow = window.Meadow || {});
