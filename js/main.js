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
  const caveLight = new THREE.PointLight(0xffdfae, 0, 16, 2);
  scene.add(caveLight);
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 400);
  camera.position.set(4.4, 4.2, 5.2);

  M.environment.init(scene, M.config.coarsePointer, renderer);
  M.world.init(scene, renderer);
  M.hearthTree.init(scene);
  M.water.init(scene);
  M.ui.init();
  M.devConsole.init();
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

  M.upgrades.init();
  M.upgradeMenu.init();
  M.minimap.init();
  M.highlights.init(scene);
  M.towers.init(scene);
  M.strategy.init(scene, camera);

  M.controls.snapTo(M.goat.group.position);
  M.items.refreshHeld();

  M.controls.onJump = function () {
    M.goat.jump();
  };

  // Attacks are fully automatic; clicks and E only interact with blocks.
  M.controls.onHeadbutt = function () {
    M.goat.mine();
  };

  M.controls.onStomp = function () {
    M.goat.mine();
  };

  M.controls.onTap = function () {
    M.goat.mine();
  };

  M.controls.onSelectSlot = function (index) {
    M.items.selectSlot(index);
  };

  M.ui.onGreet = function () {
    M.goat.greet();
  };

  let musicEnabled = true;
  M.ui.setMusic(true);
  M.ui.onMusicToggle = function () {
    musicEnabled = !musicEnabled;
    if (musicEnabled) M.music.start();
    else M.music.stop();
    M.ui.setMusic(musicEnabled);
  };

  function wakeAudio() {
    M.audio.unlock();
    if (musicEnabled && !M.music.isPlaying()) M.music.start();
  }

  window.addEventListener('pointerdown', wakeAudio);
  window.addEventListener('keydown', wakeAudio);
  window.addEventListener('wheel', wakeAudio, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) M.music.update(0, { paused: true });
  });

  const clock = new THREE.Clock();
  let elapsed = 0, accumulator = 0;
  const STEP = 1 / 60;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (document.hidden || M.upgradeMenu.isOpen) {
      M.music.update(dt, { paused: true });
      accumulator = 0; return;
    }
    accumulator += dt;
    const willStep = accumulator + 0.000001 >= STEP;
    if (willStep) M.enemies.beginFrame();
    while (accumulator + 0.000001 >= STEP) {
      elapsed += STEP;
      M.goat.update(STEP, elapsed);
      M.enemies.update(STEP, elapsed);
      M.towers.update(STEP, true);
      M.items.update(STEP, elapsed, M.goat.group);
      M.animals.update(STEP, elapsed, M.goat.group);
      accumulator -= STEP;
    }
    // Catch-up ticks advance combat at 60 Hz; upload only the final pose that
    // will actually be displayed, including damage dealt by this tick's towers.
    if (willStep) {
      M.enemies.syncRender();
      M.towers.syncRender();
    }
    M.world.update(M.goat.group.position, dt, elapsed);
    M.controls.update(dt, elapsed, M.goat.group, M.goat.state, M.world);
    M.strategy.update(dt);
    M.hearthTree.update(dt, elapsed);
    M.fish.update(dt, elapsed, M.goat.group.position);
    M.environment.update(camera, M.goat.group, dt, elapsed);
    const underground = M.goat.group.position.y + 2 < M.world.surfaceHeight(M.goat.group.position.x, M.goat.group.position.z);
    caveLight.position.copy(M.goat.group.position); caveLight.position.y += 1.4;
    caveLight.intensity = M.utils.damp(caveLight.intensity, underground ? 5 : 0, 6, dt);
    M.water.update(dt, elapsed, M.goat.group, M.goat.state, camera, M.world);
    M.audio.setListener(camera);
    const horde = M.enemies.getState();
    const besieged = M.enemies.zombies.some(function (enemy) { return enemy.mode === 'tree'; });
    M.music.update(dt, {
      combat: horde.phase === 'combat' ? Math.min(1, 0.22 + horde.count / 24 + (besieged ? 0.3 : 0)) : 0,
      danger: Math.max(0, 1 - horde.health / 45),
      speed: M.goat.state.speed,
      underground: underground,
      defeated: horde.defeated
    });
    M.minimap.update(dt);
    M.highlights.update();
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
