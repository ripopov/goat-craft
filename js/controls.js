(function (M) {
  'use strict';

  const { clamp, damp } = M.utils;

  const canvas = document.getElementById('scene');
  let cameraRef = null;
  let lastInteraction = performance.now();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const held = { w: false, a: false, s: false, d: false, shift: false, space: false, ctrl: false };
  const moveVec = new THREE.Vector2();
  const camDir = new THREE.Vector3();

  // Frame the entire Hearth Tree across the starting meadow.
  const home = M.config.startingArea;
  let azimuth = Math.atan2(home.spawn.x - home.x, home.spawn.z - home.z);
  let polar = 1.74;
  let viewPolar = polar;
  let distance = 7.6;
  let firstPerson = false;
  let snapCamera = false;
  let orbitFov = 42;
  const EYE_HEIGHT = 1.75;
  const camTarget = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const pointers = new Map();
  let drag = null;
  let pinch = null;

  // Pointer Lock gives mouse-look in either camera mode: no button held,
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
  // Keep the player's preference separate from temporary menu/focus releases.
  let lookWanted = false;
  let lookSuspended = false;
  let lookPending = false;
  let lookReleasePending = false;
  let pageFocused = true;
  let lookClick = null;
  let lookButton = null;
  let defaultHint = '';

  function noteActivity() {
    lastInteraction = performance.now();
  }

  function getMovement(camera) {
    if (M.strategy && M.strategy.active) { moveVec.set(0, 0); return moveVec; }
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

  function getSwimPitch(camera) {
    camera.getWorldDirection(camDir);
    // Looking up/down steers forward swimming, while strafing stays level.
    return camDir.y * ((held.w ? 1 : 0) - (held.s ? 1 : 0));
  }

  // --------------------------------------------------------------- camera
  function updateCamera(dt, t, goat, state, world) {
    if (M.strategy && M.strategy.active) { goat.visible = true; return; }
    if (held.w || held.a || held.s || held.d || held.space || held.ctrl) lastInteraction = performance.now();
    const elapsed = (performance.now() - lastInteraction) / 1000;
    const steering = held.w || held.a || held.s || held.d;
    if (!firstPerson && elapsed > 3.0 && !drag && !lookActive && !reduceMotion && !steering) azimuth += dt * 0.1;

    goat.visible = !firstPerson;
    viewPolar = damp(viewPolar, polar, 14, dt);
    if (firstPerson) {
      // Attach directly to the player so walking, jumps and dives never leave
      // the viewpoint trailing behind. Keep rig animation out of the camera.
      cameraRef.position.set(goat.position.x, goat.position.y + EYE_HEIGHT, goat.position.z);
      cameraRef.lookAt(
        cameraRef.position.x - Math.sin(viewPolar) * Math.sin(azimuth),
        cameraRef.position.y - Math.cos(viewPolar),
        cameraRef.position.z - Math.sin(viewPolar) * Math.cos(azimuth)
      );
      camTarget.set(goat.position.x, goat.position.y + 1.25, goat.position.z);
      return;
    }

    // Follow the swimmer down, rather than pinning the camera above water.
    // Mouse look, drag and zoom all keep their normal meaning underwater.
    desired.set(goat.position.x, goat.position.y + 1.25, goat.position.z);
    const followY = state.grounded ? 2.4 : 12.0;
    const followXZ = 3.8 + state.runBlend * 4.2;
    camTarget.x = damp(camTarget.x, desired.x, followXZ, dt);
    camTarget.y = damp(camTarget.y, desired.y, followY, dt);
    camTarget.z = damp(camTarget.z, desired.z, followXZ, dt);

    // Smooth the pitch itself. Position damping alone is not enough while
    // looking up, because the camera stops at the ground/level point and only
    // its orientation keeps changing from raw mouse deltas.
    const phi = Math.min(viewPolar + Math.sin(t * 0.17) * 0.014, POLAR_MAX);

    // Never let the boom swing below the target. Upward look is handled by
    // tilting the view while the camera stays at its level position, which is
    // much calmer than dragging the camera under the goat and snapping it back
    // above the terrain every time the ground height changes.
    const positionPhi = Math.min(phi, Math.PI / 2);
    const sinPhi = Math.sin(positionPhi);
    let px = camTarget.x + distance * sinPhi * Math.sin(azimuth);
    let py = camTarget.y + distance * Math.cos(positionPhi);
    let pz = camTarget.z + distance * sinPhi * Math.cos(azimuth);

    // Retract the camera boom before a bank, ceiling or placed block. Water
    // itself is not an obstruction. The short sweep also works while diving.
    let obstructed = false;
    const samples = Math.ceil(distance / 0.25);
    for (let i = 1; i <= samples; i++) {
      const k = i / samples;
      const x = camTarget.x + (px - camTarget.x) * k;
      const y = camTarget.y + (py - camTarget.y) * k;
      const z = camTarget.z + (pz - camTarget.z) * k;
      if (world.blockedAt(x, z, y - 0.2, y + 0.2)) {
        const safe = Math.max(0.08, (i - 1) / samples);
        px = camTarget.x + (px - camTarget.x) * safe;
        py = camTarget.y + (py - camTarget.y) * safe;
        pz = camTarget.z + (pz - camTarget.z) * safe;
        obstructed = true;
        break;
      }
    }
    cameraRef.position.x = obstructed || snapCamera ? px : damp(cameraRef.position.x, px, 14, dt);
    cameraRef.position.y = obstructed || snapCamera ? py : damp(cameraRef.position.y, py, 14, dt);
    cameraRef.position.z = obstructed || snapCamera ? pz : damp(cameraRef.position.z, pz, 14, dt);
    snapCamera = false;
    const floor = (world.landingHeight
      ? world.landingHeight(cameraRef.position.x, cameraRef.position.z, cameraRef.position.y)
      : world.surfaceHeight(cameraRef.position.x, cameraRef.position.z)) + 0.3;
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
      if (!firstPerson && d > 0) distance = clamp(pinch.radius * (pinch.dist / d), 4, 11);
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
    if (!firstPerson) distance = clamp(distance * (1 + e.deltaY * 0.0012), 4, 11);
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
      ? '<b>mouse</b> look &nbsp;·&nbsp; <b>Esc</b> release &nbsp;·&nbsp; <b>P</b> camera &nbsp;·&nbsp; <b>space</b> rise / jump &nbsp;·&nbsp; <b>ctrl</b> dive &nbsp;·&nbsp; <b>click</b> headbutt / place &nbsp;·&nbsp; <b>right click</b> stomp &nbsp;·&nbsp; <b>1–0</b> items &nbsp;·&nbsp; <b>scroll</b> zoom'
      : defaultHint;
  }

  function setLookUi(active) {
    document.body.classList.toggle('look-active', active);
    setLookButton(active);
    setLookHint(active);
  }

  function canResumeLook() {
    return pageFocused && !document.hidden &&
      (typeof document.hasFocus !== 'function' || document.hasFocus()) &&
      !(M.upgradeMenu && M.upgradeMenu.isOpen) && !(M.strategy && M.strategy.active);
  }

  function restoreLook() {
    if (!supportsPointerLock || !lookWanted || lookSuspended || lookActive ||
        lookPending || lookReleasePending || !canResumeLook()) return false;
    lookPending = true;
    try {
      const pending = canvas.requestPointerLock();
      if (pending && typeof pending.catch === 'function') pending.catch(function () { lookPending = false; });
    } catch (err) {
      lookPending = false;
      return false;
    }
    return true;
  }

  function requestLook() {
    if (!supportsPointerLock) return false;
    lookWanted = true;
    return restoreLook();
  }

  function exitLook() {
    if (document.pointerLockElement === canvas && typeof document.exitPointerLock === 'function') {
      lookReleasePending = true;
      try { document.exitPointerLock(); } catch (err) { lookReleasePending = false; }
    }
  }

  function releaseLook() {
    lookWanted = false;
    exitLook();
  }

  function suspendLook() {
    lookSuspended = true;
    exitLook();
  }

  function resumeLook() {
    lookSuspended = false;
    restoreLook();
  }

  document.addEventListener('pointerlockchange', function () {
    const active = document.pointerLockElement === canvas;
    // Browsers may consume Esc without delivering a key event. An unrequested
    // unlock in the focused game is the browser's explicit unlock gesture.
    if (!active && lookActive && !lookReleasePending && !lookSuspended && canResumeLook()) lookWanted = false;
    lookReleasePending = false;
    lookPending = false;
    lookActive = active;
    lookClick = null;
    if (active) {
      drag = null;
      pinch = null;
      pointers.clear();
      canvas.classList.remove('dragging');
      // A request may finish after a menu opens or the player presses F/Esc.
      if (!lookWanted || lookSuspended || !canResumeLook()) exitLook();
    }
    setLookUi(lookActive);
    lastInteraction = performance.now();
    if (!active) restoreLook();
  });

  document.addEventListener('pointerlockerror', function () {
    lookPending = false;
    lookActive = document.pointerLockElement === canvas;
    lookClick = null;
    setLookUi(lookActive);
  });

  // Focus restoration can lack the activation a browser requires. Retry on
  // the next interaction as well, without repeatedly requesting every frame.
  window.addEventListener('focus', function () { pageFocused = true; restoreLook(); });
  window.addEventListener('keyup', restoreLook);
  document.addEventListener('click', restoreLook);
  // Handle F before the strategic view consumes its gameplay keys. It also
  // lets the player opt out while capture is temporarily suspended.
  window.addEventListener('keydown', function (e) {
    if (M.devConsole && M.devConsole.isOpen) return;
    if (e.metaKey || e.altKey || e.ctrlKey || !(e.code === 'KeyF' || e.key.toLowerCase() === 'f') || !supportsPointerLock) return;
    e.preventDefault();
    if (e.repeat) return;
    if (lookWanted) releaseLook();
    else requestLook();
  }, true);

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
    if (e.metaKey || e.altKey) return;
    if (M.devConsole && M.devConsole.isOpen) return;
    if (!e.ctrlKey && (e.code === 'KeyQ' || e.key.toLowerCase() === 'q')) {
      e.preventDefault();
      if (!e.repeat && M.upgradeMenu) M.upgradeMenu.toggle();
      return;
    }
    if (M.upgradeMenu && M.upgradeMenu.isOpen) {
      if (e.key === 'Escape') { e.preventDefault(); M.upgradeMenu.close(); }
      return;
    }
    if (M.strategy && M.strategy.active) return;
    if (e.key === 'Control') {
      held.ctrl = true;
      noteActivity();
      return;
    }
    // Ctrl is a gameplay key: do not discard Ctrl+WASD / Space while diving.
    // Leave unrelated browser shortcuts alone.
    if (e.ctrlKey && !moveKey(e) && e.code !== 'Space' && e.key !== ' ' && e.key !== 'Shift' && e.key !== 'Escape') return;

    // Chrome usually releases pointer lock itself on Escape, but handling it
    // explicitly keeps the state in sync (and makes the test harness reliable).
    if (e.key === 'Escape' && lookWanted) {
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
      held.space = true;
      noteActivity();
      if (!e.repeat && M.controls.onJump) M.controls.onJump();
      return;
    }

    if (e.code === 'KeyP' || e.key.toLowerCase() === 'p') {
      e.preventDefault();
      if (e.repeat) return;
      firstPerson = !firstPerson;
      snapCamera = true;
      if (cameraRef) {
        cameraRef.fov = firstPerson ? 70 : orbitFov;
        cameraRef.updateProjectionMatrix();
      }
      noteActivity();
      return;
    }

    if (e.code === 'KeyE' || e.key.toLowerCase() === 'e') {
      e.preventDefault();
      if (!e.repeat && M.controls.onHeadbutt) M.controls.onHeadbutt();
      return;
    }

    const k = moveKey(e);
    if (!k) return;
    e.preventDefault();
    if (!held[k]) {
      held[k] = true;
      lastInteraction = performance.now();
    }
  });

  window.addEventListener('keyup', function (e) {
    if (e.key === 'Control') {
      held.ctrl = false;
      return;
    }
    if (e.code === 'Space' || e.key === ' ') {
      held.space = false;
      e.preventDefault();
      return;
    }
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
    held.shift = held.space = held.ctrl = false;
  }

  window.addEventListener('blur', function () { pageFocused = false; stopSteering(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopSteering();
    else restoreLook();
  });

  function snapTo(position) {
    viewPolar = polar;
    camTarget.set(position.x, position.y + 1.25, position.z);
    cameraRef.position.set(position.x + 4.4, position.y + 4.2, position.z + 5.2);
    cameraRef.lookAt(camTarget);
  }

  function init(camera) {
    cameraRef = camera;
    orbitFov = camera.fov;

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
        if (lookWanted) releaseLook();
        else requestLook();
      });
    }
  }

  M.controls = {
    init: init,
    update: updateCamera,
    requestLook: requestLook,
    releaseLook: releaseLook,
    suspendLook: suspendLook,
    resumeLook: resumeLook,
    get lookActive() { return lookActive; },
    get firstPerson() { return firstPerson && !(M.strategy && M.strategy.active); },
    resumeCamera: function () {
      cameraRef.fov = firstPerson ? 70 : orbitFov; cameraRef.updateProjectionMatrix();
      snapCamera = true; snapTo(M.goat.group.position);
    },
    getFacingYaw: function () { return azimuth + Math.PI; },
    getMovement: getMovement,
    getSwimPitch: getSwimPitch,
    get swimVertical() { return M.strategy && M.strategy.active ? 0 : (held.space ? 1 : 0) - (held.ctrl ? 1 : 0); },
    noteActivity: noteActivity,
    snapTo: snapTo,
    stopSteering: stopSteering,
    onJump: null,
    onHeadbutt: null,
    onStomp: null,
    onTap: null,
    onSelectSlot: null,
    get running() { return held.shift; }
  };
})(window.Meadow = window.Meadow || {});
