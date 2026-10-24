(function (M) {
  'use strict';

  const canvas = document.getElementById('scene');

  function fail(message) {
    const el = document.getElementById('error');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
  } catch (err) {
    fail('This scene needs WebGL, which is not available in your browser.');
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(4.4, 4.2, 5.2);

  M.environment.init(scene, M.config.coarsePointer, renderer);
  M.world.init(scene, renderer);
  M.hearthTree.init(scene);
  M.water.init(scene);
  M.ui.init();
  M.items.init(scene);
  M.controls.init(camera);

  M.goat.init({
    scene: scene,
    camera: camera,
    controls: M.controls,
    world: M.world,
    audio: M.audio,
    ui: M.ui
  });

  M.animals.init({
    scene: scene,
    world: M.world,
    audio: M.audio,
    goat: M.goat
  });

  M.fish.init({
    scene: scene,
    world: M.world
  });

  M.enemies.init({ scene: scene, world: M.world, tree: M.hearthTree });

  M.controls.snapTo(M.goat.group.position);
  M.items.refreshHeld();

  M.controls.onJump = function () {
    M.goat.jump();
  };

  M.controls.onHeadbutt = function () {
    M.goat.startHeadbutt();
  };

  M.controls.onStomp = function () {
    M.goat.startStomp();
  };

  M.controls.onTap = function () {
    M.goat.startHeadbutt();
  };

  M.controls.onSelectSlot = function (index) {
    M.items.selectSlot(index);
  };

  M.ui.onGreet = function () {
    M.goat.greet();
  };

  M.ui.onMusicToggle = function () {
    const on = M.music.toggle();
    M.ui.setMusic(on);
  };

  function wakeAudio() {
    M.audio.unlock();
  }

  window.addEventListener('pointerdown', wakeAudio);
  window.addEventListener('keydown', wakeAudio);
  window.addEventListener('wheel', wakeAudio, { passive: true });

  const clock = new THREE.Clock();
  let elapsed = 0, accumulator = 0;
  const STEP = 1 / 60;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (document.hidden) { accumulator = 0; return; }
    accumulator += dt;
    while (accumulator + 0.000001 >= STEP) {
      elapsed += STEP;
      M.goat.update(STEP, elapsed);
      M.enemies.update(STEP, elapsed);
      M.items.update(STEP, elapsed, M.goat.group);
      M.animals.update(STEP, elapsed, M.goat.group);
      accumulator -= STEP;
    }
    M.world.update(M.goat.group.position, dt, elapsed);
    M.controls.update(dt, elapsed, M.goat.group, M.goat.state, M.world);
    M.hearthTree.update(dt, elapsed);
    M.fish.update(dt, elapsed, M.goat.group.position);
    M.environment.update(camera, M.goat.group, dt, elapsed);
    M.water.update(dt, elapsed, M.goat.group, M.goat.state, camera, M.world);
    M.ui.updateBubble(dt, M.goat.headPivot, camera);

    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(frame);

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
})(window.Meadow = window.Meadow || {});
