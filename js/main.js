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

  M.environment.init(scene, M.config.coarsePointer);
  M.world.init(scene, renderer);
  M.ui.init();
  M.controls.init(camera);

  M.goat.init({
    scene: scene,
    camera: camera,
    controls: M.controls,
    world: M.world,
    audio: M.audio,
    ui: M.ui
  });

  M.controls.snapTo(M.goat.group.position);

  M.controls.onJump = function () {
    M.goat.jump();
  };

  M.controls.onHeadbutt = function () {
    M.goat.startHeadbutt();
  };

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  M.controls.onTap = function (clientX, clientY) {
    ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.intersectObject(M.goat.group, true).length > 0) {
      M.goat.greet();
    }
  };

  M.ui.onGreet = function () {
    M.goat.greet();
  };

  const clock = new THREE.Clock();
  let elapsed = 0;

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    M.goat.update(dt, elapsed);
    M.controls.update(dt, elapsed, M.goat.group, M.goat.state, M.world);
    M.world.update(M.goat.group.position, dt, elapsed);
    M.environment.update(camera, M.goat.group, dt, elapsed);
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
