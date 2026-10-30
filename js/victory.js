(function (M) {
  'use strict';
  let scene, camera, tree, overlay, replay, active = false, time = 0;
  let motes, rings, beacon, fill, burst, elderLight, replayShown = false;
  const start = new THREE.Vector3(), look = new THREE.Vector3(), destination = new THREE.Vector3(), elder = new THREE.Vector3(), deathCamera = new THREE.Vector3();
  const dummy = new THREE.Object3D(), seeds = [];
  const smooth = t => { t = M.utils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  function build() {
    const group = new THREE.Group(); group.name = 'Hearth victory celebration'; group.position.copy(tree.group.position); scene.add(group);
    motes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffe6a0, toneMapped: false }), 120);
    motes.frustumCulled = false; motes.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(motes);
    for (let i = 0; i < motes.count; i++) seeds.push({ angle: i * 2.399963, radius: 5 + (i % 17) * .65, phase: i * .618 % 1 });
    rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(.98, 1, 80), new THREE.MeshBasicMaterial({
        color: 0xffd880, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = .3 + i * .08; group.add(ring); rings.push(ring);
    }
    beacon = new THREE.PointLight(0xffcf77, 0, 65, 2); beacon.position.set(0, 11, 0); group.add(beacon);
    const remains = M.enemies.finalBoss;
    elder.copy(remains.position); elder.y += 6;
    const outward = new THREE.Vector3().subVectors(remains.position, tree.group.position); outward.y = 0; outward.normalize();
    deathCamera.copy(remains.position).addScaledVector(outward, 31);
    deathCamera.x += outward.z * 15; deathCamera.z -= outward.x * 15; deathCamera.y += 20;
    burst = new THREE.InstancedMesh(motes.geometry, new THREE.MeshBasicMaterial({ color: 0xa8ffe1, transparent: true, opacity: 1, toneMapped: false }), 64);
    burst.name = 'Cthulhu farewell embers'; burst.frustumCulled = false; burst.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(burst);
    elderLight = new THREE.PointLight(0x8affcf, 0, 45, 2); elderLight.position.copy(elder); scene.add(elderLight);
    fill = new THREE.HemisphereLight(0xffe5b2, 0x567b50, .65); scene.add(fill);
  }

  function check() {
    if (active || !M.enemies.finalBossDefeated || tree.health <= 0 || M.oceanHorror?.active) return false;
    if (M.strategy?.active) M.strategy.setActive(false);
    if (M.upgradeMenu?.isOpen) M.upgradeMenu.close(true);
    if (M.inventoryMenu && M.inventoryMenu.isOpen) M.inventoryMenu.close(true);
    if (M.devConsole?.isOpen) M.devConsole.close();
    M.enemies.finishVictory(); M.controls.stopSteering(); M.controls.suspendLook();
    Object.assign(M.goat.state, { manualHold: 1000, speed: 0, headbutt: -1, stomp: -1 });
    active = true; start.copy(camera.position); camera.getWorldDirection(look); look.multiplyScalar(25).add(start);
    if (overlay) overlay.hidden = false;
    document.body.classList.add('victorious');
    if (M.audio?.cue) M.audio.cue('victory');
    build(); return true;
  }

  function update(dt) {
    if (!active) return;
    time += dt;
    const reduced = M.config.reducedMotion, k = reduced ? 1 : smooth((time - 4) / 5);
    const angle = reduced ? .45 : .45 + Math.sin(Math.min(time, 14) * .065) * .3;
    const distance = camera.aspect < 1 ? 57 : 39;
    destination.set(tree.group.position.x + Math.sin(angle) * distance, tree.group.position.y + 24,
      tree.group.position.z + Math.cos(angle) * distance);
    if (reduced) camera.position.copy(destination);
    else {
      const arrival = smooth(time / 2.5);
      camera.position.lerpVectors(start, deathCamera, arrival).lerp(destination, k);
    }
    const target = new THREE.Vector3().copy(tree.group.position).add(new THREE.Vector3(0, 9, 0));
    if (!reduced) target.lerpVectors(look, elder, smooth(time / 2)).lerp(new THREE.Vector3().copy(tree.group.position).add(new THREE.Vector3(0, 9, 0)), k);
    camera.lookAt(target); camera.fov = 46; camera.updateProjectionMatrix();
    const strength = smooth((time - 3) / 3);
    const farewell = 1 - smooth((time - 3) / 3);
    elderLight.intensity = farewell * 3;
    burst.material.opacity = farewell;
    for (let i = 0; i < burst.count; i++) {
      const angle = i * 2.399963, flight = reduced ? .4 : Math.min(time / 6, 1);
      const radius = 1 + flight * (4 + i % 11);
      dummy.position.set(elder.x + Math.sin(angle) * radius, elder.y + flight * (8 + i % 13), elder.z + Math.cos(angle) * radius);
      dummy.rotation.set(reduced ? 0 : time + angle, angle, 0); dummy.scale.setScalar(.11 + i % 3 * .045);
      dummy.updateMatrix(); burst.setMatrixAt(i, dummy.matrix);
    }
    burst.instanceMatrix.needsUpdate = true;
    beacon.intensity = strength * (reduced ? 3 : 3.6 + Math.sin(time * 2) * .5);
    for (let i = 0; i < motes.count; i++) {
      const seed = seeds[i], phase = (seed.phase + (reduced ? .2 : time * .08)) % 1;
      const angle = seed.angle + (reduced ? 0 : time * .12);
      dummy.position.set(Math.cos(angle) * seed.radius * (1 - phase * .3), 2 + phase * 25, Math.sin(angle) * seed.radius * (1 - phase * .3));
      dummy.rotation.set(phase * 4, angle, phase); dummy.scale.setScalar(.12 * Math.sin(phase * Math.PI) * strength);
      dummy.updateMatrix(); motes.setMatrixAt(i, dummy.matrix);
    }
    motes.instanceMatrix.needsUpdate = true;
    rings.forEach((ring, i) => {
      const phase = reduced ? .5 : (time * .14 + i / 3) % 1;
      ring.scale.setScalar(4 + phase * 32); ring.material.opacity = strength * Math.sin(phase * Math.PI) * .42;
    });
    if (overlay) overlay.style.setProperty('--victory-reveal', smooth((time - 6) / 2));
    if (time >= 10 && !replayShown) {
      replayShown = true;
      if (replay) { replay.hidden = false; replay.focus(); }
    }
  }

  // Installed before gameplay listeners. The completed run cannot resume combat
  // through keyboard shortcuts; the replay button remains keyboard accessible.
  if (window.addEventListener) ['keydown', 'keyup', 'pointerdown', 'pointerup', 'wheel', 'contextmenu'].forEach(type => {
    window.addEventListener(type, event => {
      if (!active || event.key === 'Tab') return;
      if (event.target?.id === 'victory-replay' &&
          (type === 'pointerdown' || type === 'pointerup' || event.key === 'Enter' || event.key === ' ')) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true, passive: false });
  });
  M.victory = { check, update, get active() { return active; }, init: function (options) {
    scene = options.scene; camera = options.camera; tree = options.tree;
    overlay = document.getElementById('victory'); replay = document.getElementById('victory-replay');
    if (replay) replay.addEventListener('click', () => window.location.reload());
  } };
})(window.Meadow = window.Meadow || {});
