(function (M) {
  'use strict';

  const { clamp, damp } = M.utils;
  const particles = [];
  const waterFog = new THREE.Color(0x17677f);
  let sceneRef = null;
  let overlay = null;
  let status = null;
  let wet = false;
  let wakeTimer = 0;
  let soundTimer = 0;
  let immersion = 0;

  function init(scene) {
    sceneRef = scene;
    overlay = document.getElementById('water-overlay');
    status = document.getElementById('water-status');
    const ring = new THREE.RingGeometry(0.25, 0.29, 24);
    const bubble = new THREE.SphereGeometry(0.045, 6, 4);
    // A fixed pool keeps swimming allocation-free, even during long voyages.
    for (let i = 0; i < 48; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xc5edf3, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(i < 24 ? ring : bubble, material);
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      particles.push({ mesh: mesh, ring: i < 24, life: 0, duration: 1, level: 0 });
    }
  }

  function emit(isRing, x, y, z, level) {
    const p = particles.find(function (p) { return p.ring === isRing && p.life <= 0; });
    if (!p) return;
    p.duration = isRing ? 1.2 : 1.6;
    p.life = p.duration;
    p.level = level;
    p.mesh.visible = true;
    p.mesh.position.set(x, y, z);
    p.mesh.rotation.set(isRing ? -Math.PI / 2 : 0, 0, 0);
    p.mesh.scale.setScalar(1);
  }

  // Called after the day/night update, so underwater fog never overwrites the
  // stored daylight palette and always restores correctly when resurfacing.
  function update(dt, t, goat, state, camera, world) {
    const position = goat.position;
    const water = world.waterInfoAtBlock(Math.floor(position.x / world.blockSize), Math.floor(position.z / world.blockSize));
    const inWater = !!water && position.y < water.level - 0.1;
    const speed = state.speed;
    wakeTimer -= dt;
    soundTimer -= dt;
    if (inWater && !wet) {
      M.audio.splash(0.8);
      for (let i = 0; i < 7; i++) {
        const angle = i / 7 * Math.PI * 2;
        emit(false, position.x + Math.sin(angle) * 0.4, Math.min(water.level - 0.2, position.y + 1), position.z + Math.cos(angle) * 0.4, water.level);
      }
      emit(true, position.x, water.level + 0.065, position.z, water.level);
    }
    wet = inWater;
    if (inWater && wakeTimer <= 0 && (speed > 0.3 || Math.abs(state.vy) > 0.3)) {
      wakeTimer = state.submerged ? 0.18 : 0.23;
      if (position.y + 1.7 > water.level) {
        const sideX = Math.cos(state.yaw) * 0.34;
        const sideZ = -Math.sin(state.yaw) * 0.34;
        emit(true, position.x + sideX, water.level + 0.065, position.z + sideZ, water.level);
        emit(true, position.x - sideX, water.level + 0.065, position.z - sideZ, water.level);
        if (soundTimer <= 0 && speed > 0.5) {
          M.audio.splash(0.17);
          soundTimer = 0.65;
        }
      } else {
        emit(false, position.x + Math.sin(state.yaw) * 0.7, position.y + 1.6, position.z + Math.cos(state.yaw) * 0.7, water.level);
      }
    }
    particles.forEach(function (p) {
      if (p.life <= 0) return;
      p.life -= dt;
      const age = 1 - clamp(p.life / p.duration, 0, 1);
      p.mesh.material.opacity = (1 - age) * (p.ring ? 0.3 : 0.48);
      p.mesh.scale.setScalar(p.ring ? 1 + age * 4 : 0.6 + age * 0.7);
      if (!p.ring) {
        p.mesh.position.y += dt * 0.85;
        p.mesh.position.x += Math.sin(t * 3 + p.mesh.position.z) * dt * 0.08;
      }
      if (p.life <= 0 || (!p.ring && p.mesh.position.y >= p.level - 0.05)) {
        p.life = 0;
        p.mesh.visible = false;
      }
    });

    const cameraWater = world.waterAt(camera.position.x, camera.position.y, camera.position.z);
    const depth = cameraWater ? cameraWater.level - camera.position.y : 0;
    immersion = damp(immersion, clamp(depth / 0.35, 0, 1), 9, dt);
    if (sceneRef.fog && immersion > 0.001) {
      sceneRef.fog.color.lerp(waterFog, immersion * 0.94);
      sceneRef.fog.near += (0.8 - sceneRef.fog.near) * immersion;
      sceneRef.fog.far += (25 - sceneRef.fog.far) * immersion;
    }
    if (overlay) overlay.style.opacity = (immersion * 0.32).toFixed(3);
    if (status) {
      status.hidden = !state.swimming;
      const label = state.submerged ? 'Diving' : 'Swimming';
      const text = label + ' · Space to rise · Ctrl to dive';
      if (status.textContent !== text) status.textContent = text;
    }
  }

  M.water = { init: init, update: update };
})(window.Meadow = window.Meadow || {});
