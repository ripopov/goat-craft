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
    renderRadius: coarsePointer ? 4 : 5
  };

  M.utils = {
    clamp: clamp,
    rand: rand,
    damp: damp,
    turnToward: turnToward
  };

  M.std = std;
})(window.Meadow = window.Meadow || {});
