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
    renderRadius: coarsePointer ? 4 : 5,
    // Center and spawn use world units; radius and height use terrain blocks
    // (two world units per block).
    startingArea: {
      x: 0, z: 0, radiusBlocks: 15, transitionBlocks: 5, heightBlocks: 7,
      spawn: { x: 8, z: 24 }
    }
  };

  M.utils = {
    clamp: clamp,
    rand: rand,
    damp: damp,
    turnToward: turnToward
  };

  M.std = std;
})(window.Meadow = window.Meadow || {});
