// Shared visual style machinery for the player goat and the herd. Fleet
// hooves and Long horns training decorate the same rig pieces on every
// animal: glowing energy bands climb the legs and the tail tip lights up,
// tier 3 turns the legs into spinning wheel rims, and the horns re-forge
// into cyan / gold / molten elemental charges that pulse with the spell
// about to be thrown. NPC hunters train with exactly the same looks as the
// player goat.
(function (M) {
  'use strict';

  const TIER_GLOW = [0x000000, 0x2fe6d0, 0xffc13d, 0xff5ce1]; // none, teal, gold, magenta
  const HORN_STYLE = [
    null,
    { tint: 0x4fd8ff, tips: 0.05, base: 0.5, swing: 0.14, pulse: 3.4 },   // bolt
    { tint: 0xffc13d, tips: 0.06, base: 0.6, swing: 0.18, pulse: 5.2 },   // chain
    { tint: 0xff7a2a, tips: 0.085, base: 0.8, swing: 0.24, pulse: 8 }     // fireball
  ];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function glowMaterial(THREE, color) {
    return new THREE.MeshStandardMaterial({
      color: color, emissive: color, emissiveIntensity: 0.9,
      roughness: 0.35, metalness: 0.25, flatShading: true
    });
  }
  function disposeNodes(THREE, nodes) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.parent) node.parent.remove(node);
      node.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const list = Array.isArray(o.material) ? o.material : [o.material];
          for (let j = 0; j < list.length; j++) list[j].dispose();
        }
      });
    }
    nodes.length = 0;
  }

  // ------------------------------------------------------------------ speed
  // ctx = { legs: [{ ankle, hip }], tailPivot, scale } — scale is the
  // leg-size ratio against the player goat (goat 1, sheep ~0.85, ...).
  function makeSpeedStyle(THREE) {
    const state = { level: 0, nodes: [] };
    const api = {
      apply: function (level, ctx) {
        level = clamp(level || 0, 0, 3);
        if (level === state.level || !ctx || !ctx.legs || !ctx.legs.length) return state.level;
        state.level = level;
        disposeNodes(THREE, state.nodes);
        if (level < 1) return 0;
        const color = TIER_GLOW[level];
        const k = ctx.scale || 1;
        for (let i = 0; i < ctx.legs.length; i++) {
          const leg = ctx.legs[i];
          const ankle = new THREE.Mesh(new THREE.TorusGeometry(0.082 * k, 0.022 * k, 8, 20), glowMaterial(THREE, color));
          ankle.rotation.x = Math.PI / 2;
          ankle.position.y = 0;
          leg.ankle.add(ankle);
          state.nodes.push(ankle);
          if (level >= 2) {
            const hipBand = new THREE.Mesh(new THREE.TorusGeometry(0.135 * k, 0.022 * k, 8, 20), glowMaterial(THREE, color));
            hipBand.rotation.x = Math.PI / 2;
            hipBand.position.y = -0.24;
            leg.hip.add(hipBand);
            state.nodes.push(hipBand);
          }
          if (level >= 3) {
            const upperBand = new THREE.Mesh(new THREE.TorusGeometry(0.17 * k, 0.022 * k, 8, 20), glowMaterial(THREE, color));
            upperBand.rotation.x = Math.PI / 2;
            upperBand.position.y = -0.08;
            leg.hip.add(upperBand);
            state.nodes.push(upperBand);
            const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5 * k, 0.022 * k, 8, 28), glowMaterial(THREE, color));
            rim.rotation.y = Math.PI / 2;
            rim.position.y = -0.47;   // hub at mid-leg; the leg is the spoke
            leg.hip.add(rim);
            state.nodes.push(rim);
            const hub = new THREE.Mesh(new THREE.SphereGeometry(0.09 * k, 10, 8), glowMaterial(THREE, color));
            hub.position.y = -0.47;
            leg.hip.add(hub);
            state.nodes.push(hub);
          }
        }
        if (ctx.tailPivot) {
          const comet = new THREE.Mesh(new THREE.SphereGeometry(0.06 * k, 10, 8), glowMaterial(THREE, color));
          comet.position.y = 0.46;
          ctx.tailPivot.add(comet);
          state.nodes.push(comet);
        }
        return state.level;
      },
      get level() { return state.level; },
      dispose: function () { disposeNodes(THREE, state.nodes); state.level = 0; }
    };
    return api;
  }

  // ------------------------------------------------------------------ horns
  // ctx = { horns: [{ mesh, tip: Vector3|undefined, band: Vector3|undefined }],
  //         defaultMat, scale } — tip/band offsets are in the horn mesh's local
  // space; antler tines can omit them to stay a simple tint.
  function makeHornStyle(THREE) {
    const state = { level: 0, mats: [], nodes: [] };
    const api = {
      apply: function (level, ctx) {
        level = clamp(level || 0, 0, 3);
        if (level === state.level || !ctx || !ctx.horns || !ctx.horns.length) return state.level;
        state.level = level;
        disposeNodes(THREE, state.nodes);
        for (let i = 0; i < state.mats.length; i++) state.mats[i].dispose();
        state.mats = [];
        const style = HORN_STYLE[level];
        const k = ctx.scale || 1;
        for (let i = 0; i < ctx.horns.length; i++) {
          const horn = ctx.horns[i];
          const mesh = horn.mesh;
          if (style) {
            if (mesh.material !== ctx.defaultMat && state.mats.indexOf(mesh.material) < 0) {
              state.mats.push(mesh.material);
            } else {
              const mat = mesh.material.clone();
              mesh.material = mat;
              state.mats.push(mat);
            }
            mesh.material.emissive = new THREE.Color(style.tint);
            mesh.material.emissiveIntensity = style.base;
            if (horn.tip) {
              const tip = new THREE.Mesh(new THREE.SphereGeometry(style.tips * k, 10, 8), glowMaterial(THREE, style.tint));
              tip.position.copy(horn.tip);
              mesh.add(tip);
              state.nodes.push(tip);
              if (level >= 3) {
                const halo = new THREE.Mesh(new THREE.SphereGeometry(style.tips * 1.7 * k, 10, 8), glowMaterial(THREE, style.tint));
                halo.material.transparent = true;
                halo.material.opacity = 0.35;
                halo.material.depthWrite = false;
                halo.position.copy(horn.tip);
                mesh.add(halo);
                state.nodes.push(halo);
              }
            }
            if (level >= 2 && horn.band) {
              const bandR = level >= 3 ? 0.082 : 0.072;
              const band = new THREE.Mesh(new THREE.TorusGeometry(bandR * k, 0.022 * k, 8, 20), glowMaterial(THREE, style.tint));
              band.rotation.x = Math.PI / 2;
              band.position.copy(horn.band);
              mesh.add(band);
              state.nodes.push(band);
            }
          } else {
            mesh.material = ctx.defaultMat;
          }
        }
        return state.level;
      },
      pulse: function (t) {
        if (state.level <= 0 || !HORN_STYLE[state.level]) return;
        const style = HORN_STYLE[state.level];
        const charge = style.base + Math.sin(t * style.pulse) * style.swing;
        for (let i = 0; i < state.mats.length; i++) state.mats[i].emissiveIntensity = charge;
      },
      get level() { return state.level; },
      dispose: function () {
        disposeNodes(THREE, state.nodes);
        for (let i = 0; i < state.mats.length; i++) state.mats[i].dispose();
        state.mats = [];
        state.level = 0;
      }
    };
    return api;
  }

  M.styleFx = {
    makeSpeedStyle: makeSpeedStyle,
    makeHornStyle: makeHornStyle,
    tierGlow: TIER_GLOW,
    hornStyle: HORN_STYLE
  };
})(window.Meadow = window.Meadow || {});