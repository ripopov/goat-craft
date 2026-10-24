// Shared visual style machinery for the player goat and the herd. Fleet
// hooves, Quick strikes, Long horns and Heavy horns decorate the same rig pieces on every
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

  // Quick strikes reshapes the neck itself, with fittings scaled to each
  // species. Animation uses the combat clock, so the pose peaks at real impact.
  const NECK_STYLE = [null,
    { name: 'braced jab', width: 1.12, length: 1.04, color: 0x58cbb7 },
    { name: 'spring snap', width: 1.18, length: 1.18, color: 0xffc65b },
    { name: 'piston strike', width: 1.26, length: 1.32, color: 0xeb83ff }
  ];
  const POWER_STYLE = [
    { hornWidth: 1, hornLength: 1, beard: 'natural tuft', boltRadius: 0.018, glow: 0.12, fireballSize: 1 },
    { hornWidth: 1.18, hornLength: 1.25, beard: 'pointed goatee', boltRadius: 0.035, glow: 0.2, fireballSize: 1.22 },
    { hornWidth: 1.4, hornLength: 1.55, beard: 'forked beard', boltRadius: 0.055, glow: 0.28, fireballSize: 1.48 },
    { hornWidth: 1.65, hornLength: 1.9, beard: 'braided beard', boltRadius: 0.08, glow: 0.36, fireballSize: 1.78 }
  ];
  // Heavy horns scales the existing horn meshes, so elemental tips/bands and
  // stag antler branches stay attached regardless of upgrade purchase order.
  function makePowerStyle(THREE) {
    const state = { level: 0, ctx: null, rest: [], originalBeard: [], nodes: [] };
    function restore() {
      if (!state.ctx) return;
      state.ctx.horns.forEach(function (horn, i) { horn.mesh.scale.copy(state.rest[i]); });
      state.originalBeard.forEach(function (part) { part.node.visible = part.visible; });
    }
    return {
      apply: function (level, ctx) {
        level = clamp(level || 0, 0, 3);
        if (level === state.level || !ctx || !ctx.horns || !ctx.horns.length) return state.level;
        if (!state.ctx) {
          state.ctx = ctx;
          state.rest = ctx.horns.map(function (horn) { return horn.mesh.scale.clone(); });
          state.originalBeard = ctx.beard ? ctx.beard.children.map(function (node) { return { node: node, visible: node.visible }; }) : [];
        }
        disposeNodes(THREE, state.nodes);
        restore();
        state.level = level;
        const style = POWER_STYLE[level];
        ctx.horns.forEach(function (horn, i) {
          const rest = state.rest[i];
          horn.mesh.scale.set(rest.x * style.hornWidth, rest.y * style.hornLength, rest.z * style.hornLength);
        });
        if (!level || !ctx.beard) return level;
        state.originalBeard.forEach(function (part) { part.node.visible = false; });
        const beard = new THREE.Group();
        beard.name = 'heavy-horns-beard-' + level;
        ctx.beard.add(beard);
        state.nodes.push(beard);
        const k = ctx.scale || 1;
        function piece(geometry, x, y, z, gold) {
          const material = gold ? new THREE.MeshStandardMaterial({ color: 0xe9bf68, roughness: 0.25, metalness: 0.65 })
            : ctx.beardMat.clone();
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(x * k, y * k, z * k);
          mesh.scale.setScalar(k);
          mesh.castShadow = mesh.receiveShadow = true;
          beard.add(mesh);
          return mesh;
        }
        function tuft(x, y, width, length, tilt) {
          const mesh = piece(new THREE.ConeGeometry(width, length, 7), x, y, 0, false);
          mesh.rotation.z = Math.PI + tilt;
        }
        if (level === 1) {
          tuft(0, -0.12, 0.11, 0.32, 0);
          tuft(-0.06, -0.07, 0.055, 0.22, -0.12);
          tuft(0.06, -0.07, 0.055, 0.22, 0.12);
        } else if (level === 2) {
          for (const side of [-1, 1]) {
            tuft(side * 0.075, -0.17, 0.085, 0.43, side * 0.22);
            piece(new THREE.CylinderGeometry(0.036, 0.033, 0.045, 8), side * 0.11, -0.28, 0.012, true);
          }
        } else {
          tuft(0, -0.05, 0.12, 0.24, 0);
          for (let i = 0; i < 6; i++) {
            const knot = piece(new THREE.SphereGeometry(1, 8, 6), (i % 2 ? -1 : 1) * 0.025, -0.12 - i * 0.053, 0.015, false);
            knot.scale.set(0.075 * k * (1 - i * 0.075), 0.065 * k, 0.055 * k);
            knot.rotation.z = (i % 2 ? -1 : 1) * 0.4;
          }
          piece(new THREE.CylinderGeometry(0.05, 0.044, 0.055, 8), 0, -0.43, 0.012, true);
          tuft(0, -0.49, 0.05, 0.14, 0);
        }
        return level;
      },
      get level() { return state.level; },
      dispose: function () { disposeNodes(THREE, state.nodes); restore(); state.level = 0; }
    };
  }
  function makeNeckStyle(THREE) {
    const state = { level: 0, nodes: [], ctx: null, rest: null };
    const pose = { lunge: 0, yaw: 0, roll: 0 };
    function fit(extension) {
      if (!state.ctx) return;
      const style = NECK_STYLE[state.level], rest = state.rest;
      const length = (style ? style.length : 1) + extension;
      const width = (style ? style.width : 1) / Math.sqrt(1 + extension);
      state.ctx.neck.scale.set(rest.scale.x * width, rest.scale.y * length, rest.scale.z * width);
      state.ctx.neck.position.y = rest.neckY * length;
      state.ctx.headPivot.position.y = rest.headY * length;
    }
    const api = {
      apply: function (level, ctx) {
        level = clamp(level || 0, 0, 3);
        if (level === state.level || !ctx || !ctx.neck || !ctx.headPivot) return state.level;
        if (!state.ctx) {
          state.ctx = ctx;
          state.rest = { scale: ctx.neck.scale.clone(), neckY: ctx.neck.position.y, headY: ctx.headPivot.position.y };
        }
        disposeNodes(THREE, state.nodes);
        state.level = level;
        fit(0);
        if (!level) return 0;
        const style = NECK_STYLE[level], p = ctx.neck.geometry.parameters;
        const height = p.height, radius = Math.max(p.radiusTop, p.radiusBottom);
        const fittings = new THREE.Group();
        fittings.name = 'quick-strikes-' + level;
        ctx.neck.add(fittings);
        state.nodes.push(fittings);
        function mount(geometry, x, y, z, glow) {
          const mat = glow ? glowMaterial(THREE, style.color) : new THREE.MeshStandardMaterial({
            color: 0x675446, roughness: 0.48, metalness: 0.45, flatShading: true
          });
          const mesh = new THREE.Mesh(geometry, mat);
          mesh.position.set(x, y, z);
          mesh.castShadow = true;
          fittings.add(mesh);
          return mesh;
        }
        for (let i = 0; i < level; i++) {
          const y = height * (-0.25 + i * 0.27);
          const r = THREE.MathUtils.lerp(p.radiusBottom, p.radiusTop, y / height + 0.5) + 0.018;
          const brace = mount(new THREE.TorusGeometry(r, 0.025, 4, 12), 0, y, 0, true);
          brace.rotation.x = Math.PI / 2;
        }
        if (level === 2) {
          const points = [];
          for (let i = 0; i <= 48; i++) {
            const a = i / 48 * Math.PI * 6;
            const y = (i / 48 - 0.5) * height * 0.8;
            const r = THREE.MathUtils.lerp(p.radiusBottom, p.radiusTop, y / height + 0.5) + 0.022;
            points.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
          }
          mount(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, 0.018, 4, false), 0, 0, 0, false);
        } else if (level === 3) {
          for (let i = 0; i < 3; i++) {
            mount(new THREE.BoxGeometry(radius * 1.1, height * 0.2, 0.065), 0, height * (-0.26 + i * 0.28), radius * 0.86, false);
          }
          for (const side of [-1, 1]) {
            mount(new THREE.CylinderGeometry(0.028, 0.028, height * 0.82, 6), side * radius, 0, 0, false);
          }
        }
        return level;
      },
      animate: function (time, impact, end, reducedMotion) {
        pose.lunge = M.utils.actionPose(time, impact, end);
        pose.yaw = pose.roll = 0;
        let extension = 0;
        if (state.level && time >= 0 && time < end) {
          const windup = clamp(time / impact, 0, 1);
          const recovery = clamp((time - impact) / (end - impact), 0, 1);
          const before = time < impact;
          const motion = reducedMotion ? 0.2 : 1;
          const secondary = reducedMotion ? 0 : 1;
          if (state.level === 1) {
            pose.lunge = before ? -0.14 * Math.sin(windup * Math.PI) + Math.pow(windup, 5) : Math.pow(1 - recovery, 3);
            extension = pose.lunge * 0.08 * motion;
          } else if (state.level === 2) {
            pose.lunge = before ? -0.42 * Math.sin(windup * Math.PI) + Math.pow(windup, 7) : Math.pow(1 - recovery, 2);
            pose.yaw = (before ? -Math.sin(windup * Math.PI) : Math.sin(recovery * Math.PI) * 0.4) * 0.24 * secondary;
            extension = (before ? -0.16 * Math.sin(windup * Math.PI) + Math.pow(windup, 7) * 0.22 : 0.22 * Math.pow(1 - recovery, 3)) * motion;
          } else {
            const recoil = Math.sin(recovery * Math.PI * 4) * Math.pow(1 - recovery, 2) * secondary;
            pose.lunge = before ? -0.28 * Math.sin(windup * Math.PI) + Math.pow(windup, 9) : Math.pow(1 - recovery, 4) - recoil * 0.3;
            pose.roll = before ? Math.sin(windup * Math.PI) * 0.1 * secondary : recoil * 0.12;
            extension = (before ? -0.2 * Math.sin(windup * Math.PI) + Math.pow(windup, 9) * 0.3 : 0.3 * Math.pow(1 - recovery, 4) - recoil * 0.12) * motion;
          }
        }
        fit(extension);
        return pose;
      },
      get level() { return state.level; },
      dispose: function () { disposeNodes(THREE, state.nodes); state.level = 0; fit(0); }
    };
    return api;
  }

  M.styleFx = {
    makeSpeedStyle: makeSpeedStyle,
    makeHornStyle: makeHornStyle,
    makeNeckStyle: makeNeckStyle,
    makePowerStyle: makePowerStyle,
    powerStyle: POWER_STYLE,
    neckStyle: NECK_STYLE,
    tierGlow: TIER_GLOW,
    hornStyle: HORN_STYLE
  };
})(window.Meadow = window.Meadow || {});
