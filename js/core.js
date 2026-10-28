(function (M) {
  'use strict';

  THREE.ColorManagement.legacyMode = false;

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function damp(a, b, k, dt) {
    return a + (b - a) * (1 - Math.exp(-k * dt));
  }

  function turnToward(a, b, maxDelta) {
    let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + clamp(d, -maxDelta, maxDelta);
  }

  // Long planted stance, short lifted recovery. Zero slope at contact makes
  // hooves settle instead of scissoring continuously through the floor.
  function hoofPose(phase, stride, run) {
    const cycle = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
    const stance = 0.62 - run * 0.18;
    const swing = clamp((cycle - stance) / (1 - stance), 0, 1);
    return {
      hip: (cycle < stance ? Math.cos(Math.PI * cycle / stance) : -Math.cos(Math.PI * swing)) * (0.6 + run * 0.35) * stride,
      knee: 0.04 + Math.pow(Math.sin(Math.PI * swing), 2) * (0.85 + run * 0.3) * stride
    };
  }

  function actionPose(time, impact, end) {
    function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
    if (time < 0) return 0;
    if (time < impact * 0.55) return -0.2 * smooth(time / (impact * 0.55));
    if (time < impact) return -0.2 + 1.2 * smooth((time - impact * 0.55) / (impact * 0.45));
    return 1 - smooth((time - impact) / (end - impact));
  }

  function std(color, roughness, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color: color,
      roughness: roughness === undefined ? 0.9 : roughness,
      metalness: 0,
      flatShading: true
    }, extra || {}));
  }

  M.config = {
    coarsePointer: coarsePointer,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    renderRadius: coarsePointer ? 4 : 5,
    // Shared goat/herd locomotion tuning; upgrades and terrain scale speed once.
    locomotion: { walkSpeed: 4.8, runSpeed: 9.6, walkCadence: 4.6, runCadence: 2.4 },
    // World units from the center on either horizontal axis (square extent).
    ocean: { boundary: 360, dangerBoundary: 390, shoreWidth: 36 },
    // Center and spawn use world units; radius and height use terrain blocks
    // (two world units per block).
    startingArea: {
      x: 0, z: 0, radiusBlocks: 15, transitionBlocks: 5, heightBlocks: 7,
      spawn: { x: 8, z: 24 }
    }
  };

  M.utils = {
    hoofPose: hoofPose,
    actionPose: actionPose,
    clamp: clamp,
    rand: rand,
    damp: damp,
    turnToward: turnToward
  };

  M.std = std;
})(window.Meadow = window.Meadow || {});
