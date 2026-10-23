(function (M) {
  'use strict';

  const { clamp, damp } = M.utils;

  const canvas = document.getElementById('scene');
  let cameraRef = null;
  let lastInteraction = performance.now();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const held = { w: false, a: false, s: false, d: false, shift: false };
  const moveVec = new THREE.Vector2();
  const camDir = new THREE.Vector3();

  let azimuth = 0.72;
  let polar = 1.4;
  let distance = 6.4;
  const camTarget = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const pointers = new Map();
  let drag = null;
  let pinch = null;

  function noteActivity() {
    lastInteraction = performance.now();
  }

  function getMovement(camera) {
    const x = (held.d ? 1 : 0) - (held.a ? 1 : 0);
    const z = (held.w ? 1 : 0) - (held.s ? 1 : 0);
    if (x === 0 && z === 0) {
      moveVec.set(0, 0);
      return moveVec;
    }

    camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() < 0.01) camDir.set(0, 0, -1);
    camDir.normalize();

    // camera-relative: forward is into the screen, right is screen-right
    moveVec.set(camDir.x * z - camDir.z * x, camDir.z * z + camDir.x * x).normalize();
    return moveVec;
  }

  // --------------------------------------------------------------- camera
  function updateCamera(dt, t, goat, state, world) {
    if (held.w || held.a || held.s || held.d) lastInteraction = performance.now();
    const elapsed = (performance.now() - lastInteraction) / 1000;
    const steering = held.w || held.a || held.s || held.d;
    if (elapsed > 3.0 && !drag && !reduceMotion && !steering) azimuth += dt * 0.1;

    desired.set(goat.position.x, goat.position.y + 1.25, goat.position.z);
    const followY = state.grounded ? 2.4 : 12.0;
    const followXZ = 3.8 + state.runBlend * 4.2;
    camTarget.x = damp(camTarget.x, desired.x, followXZ, dt);
    camTarget.y = damp(camTarget.y, desired.y, followY, dt);
    camTarget.z = damp(camTarget.z, desired.z, followXZ, dt);

    const phi = polar + Math.sin(t * 0.17) * 0.014;
    const sinPhi = Math.sin(phi);
    const px = camTarget.x + distance * sinPhi * Math.sin(azimuth);
    const py = camTarget.y + distance * Math.cos(phi);
    const pz = camTarget.z + distance * sinPhi * Math.cos(azimuth);

    cameraRef.position.x = damp(cameraRef.position.x, px, 14, dt);
    cameraRef.position.y = damp(cameraRef.position.y, py, 14, dt);
    cameraRef.position.z = damp(cameraRef.position.z, pz, 14, dt);

    const floor = world.surfaceHeight(cameraRef.position.x, cameraRef.position.z) + 1.1;
    if (cameraRef.position.y < floor) cameraRef.position.y = floor;

    cameraRef.lookAt(camTarget);
  }


  // --------------------------------------------------------------- input
  function pinchDistance() {
    const pts = Array.from(pointers.values());
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  canvas.addEventListener('pointerdown', function (e) {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInteraction = performance.now();

    if (pointers.size === 1) {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, time: performance.now(), button: e.button };
      pinch = null;
      canvas.classList.add('dragging');
    } else {
      drag = null;
      if (pointers.size === 2) {
        pinch = { dist: pinchDistance(), radius: distance };
      }
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInteraction = performance.now();

    if (pointers.size === 2 && pinch) {
      const d = pinchDistance();
      if (d > 0) distance = clamp(pinch.radius * (pinch.dist / d), 4, 11);
    } else if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      azimuth -= dx * 0.006;
      polar = clamp(polar + dy * 0.004, 0.32, 1.45);
    }
  });

  function releasePointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);

    if (pointers.size === 1) {
      const entry = pointers.entries().next().value;
      drag = { id: entry[0], x: entry[1].x, y: entry[1].y, moved: 99, time: performance.now(), button: -1 };
      pinch = null;
    } else if (pointers.size === 0) {
      if (drag && drag.id === e.pointerId && drag.button === 0 && drag.moved < 9 && performance.now() - drag.time < 550) {
        if (M.controls.onTap) M.controls.onTap(e.clientX, e.clientY);
      }
      drag = null;
      pinch = null;
      canvas.classList.remove('dragging');
    }
  }

  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    distance = clamp(distance * (1 + e.deltaY * 0.0012), 4, 11);
    lastInteraction = performance.now();
  }, { passive: false });

  function moveKey(e) {
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': return 'w';
      case 'KeyA': case 'ArrowLeft': return 'a';
      case 'KeyS': case 'ArrowDown': return 's';
      case 'KeyD': case 'ArrowRight': return 'd';
    }
    switch (e.key.toLowerCase()) {
      case 'w': case 'arrowup': return 'w';
      case 'a': case 'arrowleft': return 'a';
      case 's': case 'arrowdown': return 's';
      case 'd': case 'arrowright': return 'd';
      default: return null;
    }
  }

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Shift') {
      held.shift = true;
      return;
    }

    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat && M.controls.onJump) M.controls.onJump();
      return;
    }

    if (e.code === 'KeyE' || e.key.toLowerCase() === 'e') {
      e.preventDefault();
      if (!e.repeat && M.controls.onHeadbutt) M.controls.onHeadbutt();
      return;
    }

    const k = moveKey(e);
    if (!k) return;
    if (e.code.indexOf('Arrow') === 0) e.preventDefault();
    if (!held[k]) {
      held[k] = true;
      lastInteraction = performance.now();
    }
  });

  window.addEventListener('keyup', function (e) {
    if (e.key === 'Shift') {
      held.shift = false;
      return;
    }
    const k = moveKey(e);
    if (!k) return;
    if (e.code.indexOf('Arrow') === 0) e.preventDefault();
    held[k] = false;
    lastInteraction = performance.now();
  });

  function stopSteering() {
    held.w = held.a = held.s = held.d = false;
    held.shift = false;
  }

  window.addEventListener('blur', stopSteering);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopSteering();
  });

  function snapTo(position) {
    camTarget.set(position.x, position.y + 1.25, position.z);
    cameraRef.position.set(position.x + 4.4, position.y + 4.2, position.z + 5.2);
    cameraRef.lookAt(camTarget);
  }

  function init(camera) {
    cameraRef = camera;
  }

  M.controls = {
    init: init,
    update: updateCamera,
    getMovement: getMovement,
    noteActivity: noteActivity,
    snapTo: snapTo,
    onJump: null,
    onHeadbutt: null,
    onTap: null,
    get running() { return held.shift; }
  };
})(window.Meadow = window.Meadow || {});
