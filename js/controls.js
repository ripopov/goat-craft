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
  let viewPolar = polar;
  let distance = 7.6;
  const camTarget = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const pointers = new Map();
  let drag = null;
  let pinch = null;

  // Pointer Lock gives a conventional third-person mouse-look: no button held,
  // no dragging. Browsers require a real user gesture to capture the pointer,
  // so the visible "Mouse look" button (or F) is the entry point and Esc exits.
  const LOOK_YAW = 0.003;
  const LOOK_PITCH = 0.0022;
  // polar is measured from the vertical: 0 is overhead, PI/2 is level, and
  // values beyond PI/2 point the view upward. Keep enough room to see the sky.
  const POLAR_MIN = 0.24;
  const POLAR_MAX = 2.95;
  const supportsPointerLock = !M.config.coarsePointer &&
    typeof canvas.requestPointerLock === 'function' &&
    typeof document.exitPointerLock === 'function';
  let lookActive = false;
  let lookClick = null;
  let lookButton = null;
  let defaultHint = '';

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
    if (elapsed > 3.0 && !drag && !lookActive && !reduceMotion && !steering) azimuth += dt * 0.1;

    const waterTop = world.waterLevelAt ? world.waterLevelAt(goat.position.x, goat.position.z) : 0;
    desired.set(
      goat.position.x,
      Math.max(goat.position.y + 1.25, waterTop > 0 ? waterTop + 0.25 : 0),
      goat.position.z
    );
    const followY = state.grounded ? 2.4 : 12.0;
    const followXZ = 3.8 + state.runBlend * 4.2;
    camTarget.x = damp(camTarget.x, desired.x, followXZ, dt);
    camTarget.y = damp(camTarget.y, desired.y, followY, dt);
    camTarget.z = damp(camTarget.z, desired.z, followXZ, dt);

    // Smooth the pitch itself. Position damping alone is not enough while
    // looking up, because the camera stops at the ground/level point and only
    // its orientation keeps changing from raw mouse deltas.
    viewPolar = damp(viewPolar, polar, 14, dt);
    const phi = Math.min(viewPolar + Math.sin(t * 0.17) * 0.014, POLAR_MAX);

    // Never let the boom swing below the target. Upward look is handled by
    // tilting the view while the camera stays at its level position, which is
    // much calmer than dragging the camera under the goat and snapping it back
    // above the terrain every time the ground height changes.
    const positionPhi = Math.min(phi, Math.PI / 2);
    const sinPhi = Math.sin(positionPhi);
    const px = camTarget.x + distance * sinPhi * Math.sin(azimuth);
    const py = camTarget.y + distance * Math.cos(positionPhi);
    const pz = camTarget.z + distance * sinPhi * Math.cos(azimuth);

    cameraRef.position.x = damp(cameraRef.position.x, px, 14, dt);
    cameraRef.position.y = damp(cameraRef.position.y, py, 14, dt);
    cameraRef.position.z = damp(cameraRef.position.z, pz, 14, dt);

    // When the orbit camera drifts over a pond, keep it above the waterline
    // instead of dropping to the flooded floor and ending up inside the goat.
    const surface = Math.max(
      world.surfaceHeight(cameraRef.position.x, cameraRef.position.z),
      world.waterLevelAt ? world.waterLevelAt(cameraRef.position.x, cameraRef.position.z) : 0
    );
    const floor = surface + 1.1;
    if (cameraRef.position.y < floor) cameraRef.position.y = floor;

    if (phi > Math.PI / 2) {
      // Keep the camera at the level orbit position, but aim along the virtual
      // orbit direction that continues below the target. The virtual point is
      // only used for direction; the camera itself never goes underground or
      // swings close to the goat. The result is a smooth sky view.
      const vx = camTarget.x + distance * Math.sin(phi) * Math.sin(azimuth);
      const vy = camTarget.y + distance * Math.cos(phi);
      const vz = camTarget.z + distance * Math.sin(phi) * Math.cos(azimuth);
      const lx = camTarget.x - vx;
      const ly = camTarget.y - vy;
      const lz = camTarget.z - vz;
      const len = Math.hypot(lx, ly, lz) || 1;
      cameraRef.lookAt(
        cameraRef.position.x + lx / len,
        cameraRef.position.y + ly / len,
        cameraRef.position.z + lz / len
      );
    } else {
      cameraRef.lookAt(camTarget);
    }
  }


  // --------------------------------------------------------------- input
  function pinchDistance() {
    const pts = Array.from(pointers.values());
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (lookActive) {
      lookClick = { button: e.button, time: performance.now(), moved: 0 };
      lastInteraction = performance.now();
      return;
    }
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
    if (lookActive || !pointers.has(e.pointerId)) return;
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
      // polar is measured from the vertical, so larger values lower the
      // camera. Dragging down should look down: decrease polar to raise it.
      polar = clamp(polar - dy * 0.004, POLAR_MIN, POLAR_MAX);
    }
  });

  function releasePointer(e) {
    const isClickUp = e.type === 'pointerup';
    if (lookActive) {
      if (isClickUp && lookClick && lookClick.button === e.button &&
          performance.now() - lookClick.time < 550 && lookClick.moved < 9) {
        if (e.button === 0 && M.controls.onHeadbutt) M.controls.onHeadbutt();
        else if (e.button === 2 && M.controls.onStomp) M.controls.onStomp();
      }
      lookClick = null;
      return;
    }
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);

    if (pointers.size === 1) {
      const entry = pointers.entries().next().value;
      drag = { id: entry[0], x: entry[1].x, y: entry[1].y, moved: 99, time: performance.now(), button: -1 };
      pinch = null;
    } else if (pointers.size === 0) {
      if (isClickUp && drag && drag.id === e.pointerId && drag.moved < 9 && performance.now() - drag.time < 550) {
        if (drag.button === 0 && M.controls.onTap) M.controls.onTap(e.clientX, e.clientY);
        else if (drag.button === 2 && M.controls.onStomp) M.controls.onStomp();
      }
      drag = null;
      pinch = null;
      canvas.classList.remove('dragging');
    }
  }

  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    distance = clamp(distance * (1 + e.deltaY * 0.0012), 4, 11);
    lastInteraction = performance.now();
  }, { passive: false });

  // Pointer Lock reports relative movement rather than client coordinates.
  // Feed it into the same azimuth/polar orbit used by the touch fallback.
  document.addEventListener('mousemove', function (e) {
    if (!lookActive) return;
    const rawX = e.movementX || 0;
    const rawY = e.movementY || 0;
    if (rawX === 0 && rawY === 0) return;
    const dx = clamp(rawX, -260, 260);
    const dy = clamp(rawY, -260, 260);
    azimuth -= dx * LOOK_YAW;
    // Standard mouse-look pitch: move the mouse up to look up, down to look
    // down. Small polar values place the orbit camera high and look downward.
    polar = clamp(polar - dy * LOOK_PITCH, POLAR_MIN, POLAR_MAX);
    if (lookClick) lookClick.moved += Math.abs(rawX) + Math.abs(rawY);
    lastInteraction = performance.now();
  });

  function setLookButton(active) {
    if (!lookButton) return;
    lookButton.classList.toggle('on', active);
    lookButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    lookButton.setAttribute('aria-label', active ? 'Release mouse capture' : 'Capture mouse for free look');
    lookButton.title = active ? 'Press Esc to release the mouse' : 'Capture the pointer for mouse look (Esc releases)';
    const label = lookButton.querySelector('.label');
    if (label) label.textContent = active ? 'Mouse captured' : 'Mouse look';
  }

  function setLookHint(active) {
    if (M.config.coarsePointer) return;
    const hint = document.getElementById('hint');
    if (!hint) return;
    hint.innerHTML = active
      ? '<b>mouse</b> look &nbsp;·&nbsp; <b>Esc</b> release &nbsp;·&nbsp; <b>click</b> headbutt / place &nbsp;·&nbsp; <b>right click</b> stomp &nbsp;·&nbsp; <b>1–0</b> items &nbsp;·&nbsp; <b>scroll</b> zoom'
      : defaultHint;
  }

  function setLookUi(active) {
    document.body.classList.toggle('look-active', active);
    setLookButton(active);
    setLookHint(active);
  }

  function requestLook() {
    if (!supportsPointerLock || lookActive) return false;
    try {
      const pending = canvas.requestPointerLock();
      if (pending && typeof pending.catch === 'function') pending.catch(function () {});
    } catch (err) {
      return false;
    }
    return true;
  }

  function releaseLook() {
    if (document.pointerLockElement === canvas && typeof document.exitPointerLock === 'function') {
      try { document.exitPointerLock(); } catch (err) { /* ignore */ }
    }
  }

  document.addEventListener('pointerlockchange', function () {
    const active = document.pointerLockElement === canvas;
    lookActive = active;
    lookClick = null;
    if (active) {
      drag = null;
      pinch = null;
      pointers.clear();
      canvas.classList.remove('dragging');
    }
    setLookUi(active);
    lastInteraction = performance.now();
  });

  document.addEventListener('pointerlockerror', function () {
    lookActive = false;
    lookClick = null;
    setLookUi(false);
  });

  function digitKey(e) {
    const code = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
    if (code) return +code[1];
    if (/^[0-9]$/.test(e.key || '')) return +e.key;
    return -1;
  }

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

    // Chrome usually releases pointer lock itself on Escape, but handling it
    // explicitly keeps the state in sync (and makes the test harness reliable).
    if (e.key === 'Escape' && lookActive) {
      e.preventDefault();
      releaseLook();
      return;
    }

    if (e.key === 'Shift') {
      held.shift = true;
      return;
    }

    const digit = digitKey(e);
    if (digit >= 0) {
      e.preventDefault();
      if (!e.repeat && M.controls.onSelectSlot) {
        M.controls.onSelectSlot(digit === 0 ? 9 : digit - 1);
      }
      return;
    }

    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat && M.controls.onJump) M.controls.onJump();
      return;
    }

    if (e.code === 'KeyF' || e.key.toLowerCase() === 'f') {
      if (!supportsPointerLock) return;
      e.preventDefault();
      if (e.repeat) return;
      if (lookActive) releaseLook();
      else requestLook();
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
    viewPolar = polar;
    camTarget.set(position.x, position.y + 1.25, position.z);
    cameraRef.position.set(position.x + 4.4, position.y + 4.2, position.z + 5.2);
    cameraRef.lookAt(camTarget);
  }

  function init(camera) {
    cameraRef = camera;

    const hint = document.getElementById('hint');
    if (hint) defaultHint = hint.innerHTML;

    lookButton = document.getElementById('look');
    if (!supportsPointerLock) {
      if (lookButton) lookButton.hidden = true;
      if (hint && !M.config.coarsePointer) {
        hint.innerHTML = hint.innerHTML.replace(' &nbsp;·&nbsp; <b>F</b> mouse look', '');
      }
      return;
    }
    if (lookButton) {
      lookButton.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        lookButton.blur();
        if (lookActive) releaseLook();
        else requestLook();
      });
    }
  }

  M.controls = {
    init: init,
    update: updateCamera,
    requestLook: requestLook,
    releaseLook: releaseLook,
    get lookActive() { return lookActive; },
    getMovement: getMovement,
    noteActivity: noteActivity,
    snapTo: snapTo,
    onJump: null,
    onHeadbutt: null,
    onStomp: null,
    onTap: null,
    onSelectSlot: null,
    get running() { return held.shift; }
  };
})(window.Meadow = window.Meadow || {});
