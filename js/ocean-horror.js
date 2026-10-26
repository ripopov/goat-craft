(function (M) {
  'use strict';

  const { clamp } = M.utils;
  const DEATH_AT = 6.4, RESTART_DELAY = 5;
  let scene, camera, world, goat, overlay, warning, title, subtitle, eyebrow;
  let active = false, dead = false, time = 0, deathTime = 0, restarted = false;
  let monster, tentacles, wings, foam, spray, light, fill;
  let seaLevel = 0, yaw = 0;
  const origin = new THREE.Vector3(), startCamera = new THREE.Vector3();
  const target = new THREE.Vector3(), view = new THREE.Vector3();
  const point = new THREE.Vector3(), next = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  const smooth = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };

  // All geometry is local and procedural, including articulated voxel limbs.
  // Build once on encounter; there is no boss mesh cost during normal play.
  function buildMonster() {
    monster = new THREE.Group(); monster.name = 'Cthulhu';
    const box = new THREE.BoxGeometry(1, 1, 1);
    const skin = M.std(0x244f45, 0.82), ridge = M.std(0x377467, 0.72);
    const dark = M.std(0x102d30, 0.95), web = M.std(0x163d3b, 0.88, { side: THREE.DoubleSide });
    const eye = new THREE.MeshBasicMaterial({ color: 0xb6ffae });
    function block(parent, material, x, y, z, sx, sy, sz, tilt = 0) {
      const mesh = new THREE.Mesh(box, material);
      mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.rotation.z = tilt;
      parent.add(mesh); return mesh;
    }
    block(monster, skin, 0, 6, 0, 9, 13, 6);
    block(monster, ridge, 0, 10, 2.8, 6, 5, 1.1);
    block(monster, skin, 0, 16.3, 0.4, 8.4, 8, 7.4);
    block(monster, ridge, 0, 20.4, -0.5, 5.6, 1.3, 5);
    for (const side of [-1, 1]) {
      block(monster, skin, side * 6.6, 8, 0, 4, 9, 4, side * 0.23);
      block(monster, dark, side * 7.6, 3.4, 1.3, 3.6, 3, 4);
      for (let i = 0; i < 3; i++) block(monster, ridge, side * (6.3 + i * 1.1), 1.6, 2, 0.65, 2.8, 0.8, side * 0.12);
      block(monster, dark, side * 2.25, 17.3, 4.15, 2.9, 1.8, 0.45);
      block(monster, eye, side * 2.25, 17.3, 4.42, 1.9, 0.55, 0.16, side * 0.14);
      block(monster, ridge, side * 2.2, 18.2, 4, 3.5, 0.85, 1, -side * 0.13);
    }
    // Broad, ribbed bat wings keep the silhouette recognizable at sea level.
    wings = [];
    for (const side of [-1, 1]) {
      const wing = new THREE.Group(); wing.position.set(side * 3.8, 11, -2.1);
      const vertices = [0, 0, 0, side * 7, 11, -3, side * 17, 3, -1,
        0, 0, 0, side * 17, 3, -1, side * 11, -1, 0,
        0, 0, 0, side * 11, -1, 0, side * 8, -6, 1];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
      wing.add(new THREE.Mesh(geometry, web));
      [[side * 7, 11, -3], [side * 17, 3, -1], [side * 11, -1, 0], [side * 8, -6, 1]].forEach(function (end) {
        const rib = block(wing, ridge, end[0] / 2, end[1] / 2, end[2] / 2, 0.65, Math.hypot(...end), 0.65);
        direction.set(...end).normalize(); rib.quaternion.setFromUnitVectors(up, direction);
      });
      monster.add(wing); wings.push({ group: wing, side: side });
    }
    tentacles = [];
    for (let i = 0; i < 8; i++) {
      const grabber = i >= 6, segments = [];
      for (let j = 0; j < 12; j++) segments.push(block(monster, j % 3 ? skin : ridge, 0, 0, 0, 1, 1, 1));
      tentacles.push({ segments: segments, index: i, grabber: grabber });
    }
    scene.add(monster);
    foam = new THREE.Group(); foam.name = 'Cthulhu ocean shockwaves';
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64), new THREE.MeshBasicMaterial({
        color: 0xb5ebe2, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide
      }));
      ring.rotation.x = -Math.PI / 2; foam.add(ring);
    }
    scene.add(foam);
    spray = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xa0d5d1, transparent: true, opacity: 0.65 }), 64);
    spray.name = 'Cthulhu sea spray'; spray.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    spray.frustumCulled = false; scene.add(spray);
    light = new THREE.PointLight(0x8df4c2, 4, 80, 2); scene.add(light);
    fill = new THREE.HemisphereLight(0x92c8ce, 0x102226, 1.25); scene.add(fill);
  }

  function localPoint(out, x, y, z) {
    return out.set(origin.x + x * Math.cos(yaw) + z * Math.sin(yaw), seaLevel + y,
      origin.z - x * Math.sin(yaw) + z * Math.cos(yaw));
  }

  function setCaption(top, heading, detail) {
    if (eyebrow) eyebrow.textContent = top;
    if (title) title.textContent = heading;
    if (subtitle) subtitle.textContent = detail;
  }

  function sound(stage) { if (M.audio && M.audio.oceanHorror) M.audio.oceanHorror(stage); }

  function begin(water) {
    // Leave alternate camera modes before taking ownership of the camera.
    if (M.strategy && M.strategy.active) M.strategy.setActive(false);
    if (M.upgradeMenu && M.upgradeMenu.isOpen) M.upgradeMenu.close();
    if (M.devConsole && M.devConsole.isOpen) M.devConsole.close();
    active = true; time = 0;
    origin.copy(goat.group.position); seaLevel = water.level;
    const home = M.config.startingArea;
    yaw = Math.atan2(home.x - origin.x, home.z - origin.z);
    startCamera.copy(camera.position);
    goat.group.visible = true;
    Object.assign(goat.state, { speed: 0, vy: 0, aerialStomp: false, mining: -1, headbutt: -1, stomp: -1 });
    M.controls.stopSteering(); M.controls.suspendLook();
    buildMonster(); monster.rotation.y = yaw;
    localPoint(monster.position, 0, -26, -25);
    localPoint(foam.position, 0, 0.09, -25);
    localPoint(light.position, 0, 12, -10);
    if (warning) warning.hidden = true;
    if (overlay) overlay.hidden = false;
    document.body.classList.add('ocean-cinematic');
    setCaption('BEYOND THE SHORE', 'Something stirs below', 'You have entered the deep.');
    sound('rise');
  }

  function check() {
    if (active || !goat || !goat.group) return active;
    const p = goat.group.position, home = M.config.startingArea, limit = M.config.ocean;
    const extent = Math.max(Math.abs(p.x - home.x), Math.abs(p.z - home.z));
    const water = world.waterAt(p.x, p.y + 0.1, p.z);
    const swimming = goat.state.swimming && water && water.type === 'sea';
    if (warning) warning.hidden = !(swimming && extent >= limit.boundary);
    if (swimming && extent > limit.dangerBoundary) begin(water);
    return active;
  }

  function restart() {
    if (restarted) return;
    restarted = true; window.location.reload();
  }

  function kill() {
    dead = true; goat.state.dead = true; deathTime = performance.now();
    goat.group.visible = false;
    if (overlay) overlay.classList.add('ocean-dead');
    setCaption('TAKEN BY THE DEEP', 'Cthulhu claimed you', 'A new game begins in 5 seconds');
    sound('death');
    // Wall time: throttled/background tabs cannot stretch the five-second wait.
    window.setTimeout(restart, RESTART_DELAY * 1000);
  }

  function animateTentacles() {
    const reach = smooth(3.6, 5.1, time), pull = smooth(5.1, DEATH_AT, time);
    for (const limb of tentacles) {
      const i = limb.index, side = i % 2 ? 1 : -1;
      function sample(out, u) {
        if (limb.grabber) {
          // These two arms meet at the goat, coil, lift it, then drag it under.
          const endZ = 8 + reach * 17 - pull * 8;
          const endY = 2 - reach * 2.3 + Math.sin(pull * Math.PI) * 9 - pull * 13;
          const coil = Math.sin(u * Math.PI * 3 + time * 2) * reach * 0.8 * u;
          return out.set(side * (7 * (1 - u) + (1 - reach) * 4 * u) + coil,
            6 * (1 - u) + endY * u + Math.sin(u * Math.PI) * 4,
            2 + (endZ - 2) * u);
        }
        return out.set((i - 2.5) * 1.05 + Math.sin(u * 5 + time * 1.5 + i) * u * 1.8,
          14.7 - u * (7.5 + i % 3) + Math.sin(u * 5 + time * 2 + i) * u * 0.7,
          4.4 + Math.sin(u * 2.7) * 2.3 + Math.cos(time * 1.3 + i) * u);
      }
      for (let j = 0; j < limb.segments.length; j++) {
        const u = j / limb.segments.length, v = (j + 1) / limb.segments.length;
        sample(point, u); sample(next, v);
        const mesh = limb.segments[j], thickness = (limb.grabber ? 1.8 : 1.2) * (1 - u * 0.8);
        mesh.position.copy(point).add(next).multiplyScalar(0.5);
        direction.subVectors(next, point);
        mesh.scale.set(thickness, direction.length() + 0.18, thickness);
        mesh.quaternion.setFromUnitVectors(up, direction.normalize());
      }
    }
  }

  function update(dt) {
    if (!active) return;
    const previous = time; time += dt;
    if (previous < 2.6 && time >= 2.6) {
      setCaption('THE SLEEPER WAKES', 'CTHULHU', 'There is no shore beyond this point.'); sound('roar');
    }
    if (previous < 5.1 && time >= 5.1) {
      setCaption('THE DEEP HAS YOU', 'No escape', ''); sound('grab');
    }
    const rise = smooth(0.3, 3.6, time), pull = smooth(5.1, DEATH_AT, time);
    localPoint(monster.position, 0, -26 * (1 - rise), -25);
    wings.forEach(function (wing) { wing.group.rotation.y = wing.side * (0.22 + Math.sin(time * 1.1) * 0.1); });
    animateTentacles();
    foam.children.forEach(function (ring, i) {
      const age = ((time * 0.36 + i / 4) % 1);
      ring.scale.setScalar(5 + age * 30); ring.material.opacity = (1 - age) * 0.45 * rise;
    });
    for (let i = 0; i < spray.count; i++) {
      const phase = (time * 0.52 + i * 0.618) % 1, angle = i * 2.39996;
      localPoint(dummy.position, Math.sin(angle) * (6 + phase * 12),
        Math.sin(phase * Math.PI) * (4 + i % 7) * rise, -25 + Math.cos(angle) * (6 + phase * 12));
      dummy.rotation.set(phase * 5, angle, phase * 3);
      dummy.scale.setScalar((0.12 + i % 3 * 0.09) * Math.sin(phase * Math.PI) * rise);
      dummy.updateMatrix(); spray.setMatrixAt(i, dummy.matrix);
    }
    spray.instanceMatrix.needsUpdate = true;
    if (!dead) {
      goat.group.visible = true;
      const surfaceY = (origin.y - seaLevel) * (1 - smooth(0, 1.4, time)) - 1.3 * smooth(0, 1.4, time);
      localPoint(goat.group.position, 0, surfaceY + Math.sin(pull * Math.PI) * 9 - pull * 13, -pull * 8);
      goat.group.rotation.set(-pull * 1.1, yaw + Math.PI, Math.sin(time * 9) * pull * 0.14);
    }
    // Hold a wide, low three-quarter shot so both the creature and victim read.
    const approach = smooth(0, 1.9, time);
    localPoint(target, 0, 2 + rise * 7 - pull * 2, -13);
    localPoint(view, 16 - rise * 3, 5 + rise * 4, 18 - rise * 4);
    // Portrait screens need a wider establishing shot for the wing span.
    view.sub(target).multiplyScalar(Math.max(1, 1.15 / camera.aspect)).add(target);
    view.lerpVectors(startCamera, view, approach);
    const shake = M.config.reducedMotion ? 0 : Math.sin(time * 31) * 0.12 * rise * (1 - pull);
    view.x += shake; view.y += shake * 0.4; camera.position.copy(view);
    camera.lookAt(target); camera.fov = camera.aspect < 1 ? 60 : 49; camera.updateProjectionMatrix();
    if (scene.fog) {
      scene.fog.color.setHex(0x173b43); scene.fog.near = 40; scene.fog.far = 155;
    }
    if (overlay) overlay.style.setProperty('--ocean-fade', smooth(5.7, 7.1, time).toFixed(3));
    if (!dead && time >= DEATH_AT) kill();
    if (dead) {
      const remaining = Math.max(0, RESTART_DELAY - (performance.now() - deathTime) / 1000);
      const countdown = 'A new game begins in ' + Math.ceil(remaining) + ' second' + (Math.ceil(remaining) === 1 ? '' : 's');
      if (subtitle && subtitle.textContent !== countdown) subtitle.textContent = countdown;
      if (remaining <= 0) restart();
    }
  }

  function init(options) {
    scene = options.scene; camera = options.camera; world = options.world; goat = options.goat;
    overlay = document.getElementById('ocean-cinematic'); warning = document.getElementById('ocean-warning');
    title = document.getElementById('ocean-title'); subtitle = document.getElementById('ocean-subtitle'); eyebrow = document.getElementById('ocean-eyebrow');
  }

  // Registered before controls/menus: no click, held key or pause menu can
  // interrupt the scene, mutate the world, or hide the restart countdown.
  for (const name of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'mousedown', 'click', 'wheel']) {
    window.addEventListener(name, function (event) {
      if (!active) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true, passive: false });
  }

  M.oceanHorror = { init: init, check: check, update: update,
    get active() { return active; }, get dead() { return dead; } };
})(window.Meadow = window.Meadow || {});
