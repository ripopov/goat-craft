// Shared tiered equipment, articulated fittings and combat-clock effects.
(function (M) {
  'use strict';

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

  // Each fitting owns its geometry/material. Rebuild only on tier transitions;
  // animation reuses the same objects and never emits unbounded particles.
  function fitting(THREE, parent, geometry, color, x, y, z, glow) {
    const material = glow ? glowMaterial(THREE, color) : new THREE.MeshStandardMaterial({
      color: color, roughness: 0.48, metalness: 0.6, flatShading: true
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); mesh.castShadow = !glow;
    parent.add(mesh); return mesh;
  }
  const METAL = [0, 0x353eaa, 0xd9f5ff, 0x353eaa];
  function makeSpeedStyle() { return makeTierHandle(); }
  function makeHornStyle() {
    const handle = makeTierHandle(); handle.pulse = function () {}; return handle;
  }

  // Builder work has its own module and tier handle.
  function makeCraftStyle() { return makeTierHandle(); }

  // Reflex Drive reshapes the neck itself, with fittings scaled to each
  // species. Animation uses the combat clock, so the pose peaks at real impact.
  const NECK_STYLE = [null,
    { name: 'servo jab', width: 1.12, length: 1.04, color: 0xff28bd },
    { name: 'coil snap', width: 1.18, length: 1.09, color: 0xff28bd },
    { name: 'overclock strike', width: 1.26, length: 1.14, color: 0xff28bd }
  ];
  const POWER_STYLE = [
    { name: 'unpowered', boltRadius: 0.018, glow: 0.12, fireballSize: 1 },
    { name: 'ignition cell', boltRadius: 0.035, glow: 0.2, fireballSize: 1.22 },
    { name: 'reactor mantle', boltRadius: 0.055, glow: 0.28, fireballSize: 1.48 },
    { name: 'nova carapace', boltRadius: 0.08, glow: 0.36, fireballSize: 1.78 }
  ];
  // Tier handles preserve the controller API; modules own all equipment geometry.
  function makeTierHandle() {
    let tier = 0;
    return { apply: function (level) { tier = clamp(level || 0, 0, 3); return tier; },
      animate: function () {}, get level() { return tier; }, dispose: function () { tier = 0; } };
  }
  function makePowerStyle() { return makeTierHandle(); }
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
        for (let i = 0; i <= level; i++) {
          const y = height * (-.3 + i * .55 / level);
          const r = THREE.MathUtils.lerp(p.radiusBottom, p.radiusTop, y / height + .5);
          for (const side of [-1, 1]) {
            const plate = mount(new THREE.BoxGeometry(.055, height * .24, radius * 1.25), side * (r + .018), y, 0, false);
            plate.rotation.z = side * .13;
            plate.material.color.setHex(METAL[level]);
          }
        }
        const clasp = mount(new THREE.OctahedronGeometry(radius * .3), 0, -height * .18, radius + .035, true);
        clasp.scale.set(1, 1.4, .45);
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
            const recoil = Math.sin(recovery * Math.PI * 2) * Math.pow(1 - recovery, 2) * secondary;
            pose.lunge = before ? -0.28 * Math.sin(windup * Math.PI) + Math.pow(windup, 9) : Math.pow(1 - recovery, 4) - recoil * 0.1;
            pose.roll = before ? Math.sin(windup * Math.PI) * 0.1 * secondary : recoil * 0.04;
            extension = (before ? -0.2 * Math.sin(windup * Math.PI) + Math.pow(windup, 9) * 0.3 : 0.3 * Math.pow(1 - recovery, 4) - recoil * 0.04) * motion;
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

  // Layer elemental casting onto the cadence pose without
  // moving its impact. Caller reuses the pose returned by its neck rig.
  function dressAttack(pose, reach, power, time, impact, end, reduced) {
    if (!pose || time < 0 || time >= end || reduced) return;
    const before = time < impact;
    const phase = before ? time / impact : (time - impact) / (end - impact);
    const arc = Math.sin(phase * Math.PI);

    if (reach === 1) pose.lunge -= before ? arc * .08 : 0;
    if (reach === 2) pose.yaw += arc * (before ? -.18 : .12);
    if (reach === 3) {
      pose.lunge -= arc * (before ? .22 : .08);
      pose.roll += arc * (before ? .06 : -.04);
    }
  }

  // Each branch owns an exclusive set of attachments and natural surfaces.
  // Purchasing another branch never rebuilds or changes this module.
  function makeModuleStyle(THREE, branch) {
    const state = { level: 0, nodes: [], hidden: [], engines: [], lights: [], recoil: null, waves: [] };
    const accent = { move: 0x18f5ff, cadence: 0xff28bd, reach: 0xa45bff, power: 0xff8a20, craft: 0x26f0a0 }[branch];
    const colors = { shell: 0x353eaa, dark: 0x101b35, white: 0xd9f5ff,
      cyan: accent, pink: accent, gold: 0xffcb37 };
    function clear() {
      state.hidden.forEach(function (entry) { entry.node.visible = entry.visible; });
      state.hidden = []; state.engines = []; state.lights = []; state.recoil = null; state.waves = [];
      disposeNodes(THREE, state.nodes);
    }
    function hide(node) {
      if (state.hidden.some(entry => entry.node === node)) return;
      state.hidden.push({ node: node, visible: node.visible }); node.visible = false;
    }
    function mount(parent, name) {
      const group = new THREE.Group(); group.name = name;
      group.userData.upgrade = branch;
      parent.add(group); state.nodes.push(group); return group;
    }
    // Chamfered voxel panels: broad colored faces, crisp highlights at edges.
    function panel(parent, w, h, d, color, x, y, z, glow) {
      const b = Math.min(w, h, d) * .18;
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2 + b, -h / 2); shape.lineTo(w / 2 - b, -h / 2);
      shape.lineTo(w / 2, -h / 2 + b); shape.lineTo(w / 2, h / 2 - b);
      shape.lineTo(w / 2 - b, h / 2); shape.lineTo(-w / 2 + b, h / 2);
      shape.lineTo(-w / 2, h / 2 - b); shape.lineTo(-w / 2, -h / 2 + b); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: d - b * 2, bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelSegments: 1, steps: 1, curveSegments: 1 });
      geo.translate(0, 0, -d / 2 + b);
      return fitting(THREE, parent, geo, color, x, y, z, glow);
    }
    function bar(parent, a, b, radius, color, glow) {
      const delta = b.clone().sub(a);
      const mesh = fitting(THREE, parent, new THREE.CylinderGeometry(radius * .7, radius, delta.length(), 6), color, 0, 0, 0, glow);
      mesh.position.copy(a).add(b).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
      return mesh;
    }
    // Bake static panels by finish within each attachment. Joints and animated
    // reactor parts stay independent; no new geometry is made during animation.
    function batch(group) {
      const buckets = new Map();
      group.children.slice().forEach(function (mesh) {
        if (!mesh.isMesh || mesh.userData.cyberAnimated) return;
        const key = mesh.material.color.getHex() + ':' + mesh.material.emissive.getHex();
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(mesh);
      });
      buckets.forEach(function (meshes) {
        if (meshes.length < 2) return;
        const positions = [], normals = [];
        meshes.forEach(function (mesh) {
          mesh.updateMatrix();
          const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
          geo.applyMatrix4(mesh.matrix);
          for (const v of geo.attributes.position.array) positions.push(v);
          for (const v of geo.attributes.normal.array) normals.push(v);
          geo.dispose(); mesh.geometry.dispose(); group.remove(mesh);
        });
        const material = meshes[0].material;
        meshes.slice(1).forEach(function (mesh) { mesh.material.dispose(); });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = material.emissive.getHex() === 0;
        mesh.name = 'cyber-panels'; group.add(mesh);
      });
    }
    return {
      apply: function (level, ctx) {
        level = clamp(level || 0, 0, 3);
        if (level === state.level) return level;
        clear(); state.level = level;
        if (!level) return 0;
        const full = level === 3;
        const k = ctx.torso.scale.x / .4;
        // Capture only natural surfaces before mounting this style. Child joints
        // keep animating normally; neither collision dimensions nor items move.
        if (full && (branch === 'power' || branch === 'craft')) {
          ctx.rig.children.filter(n => n.isMesh).forEach(hide);
          if (ctx.tail) ctx.tail.children.filter(n => n.isMesh).forEach(hide);
        }
        if (full && branch === 'cadence') {
          const horns = ctx.horns.map(h => h.mesh || h);
          ctx.head.children.filter(n => n.isMesh && !horns.includes(n)).forEach(hide);
          if (ctx.beard) hide(ctx.beard);
          if (ctx.ears) ctx.ears.forEach(ear => hide(ear.pivot));
          ctx.neck.parent.children.filter(n => n.isMesh && n !== ctx.neck).forEach(hide);
        }
        if (branch === 'reach') ctx.horns.forEach(h => hide(h.mesh || h));
        if (full && branch === 'move') ctx.legs.forEach(function (leg) {
          [leg.hip, leg.knee, leg.ankle].forEach(joint => joint.children.filter(n => n.isMesh).forEach(hide));
        });
        if (branch === 'power' || branch === 'craft') {
        const body = mount(ctx.rig, branch + '-chassis-' + level);
        if (branch === 'power') state.recoil = body;
        body.position.copy(ctx.torso.position); body.scale.set(k, 1, 1);
        if (full) {
          panel(body, .87, .72, 1.37, colors.dark, 0, 0, -.02);
          panel(body, .76, .38, .24, colors.white, 0, -.12, .64);
          panel(body, .72, .42, .19, colors.shell, 0, -.02, -.75);
        }
          panel(body, .32, .32, .1, colors.dark, 0, -.1, .74);
          const core = fitting(THREE, body, new THREE.OctahedronGeometry(.12), colors.cyan, 0, -.1, .8, true);
          core.scale.set(1, 1.2, .35); core.userData.cyberAnimated = true; state.lights.push(core);
        for (const side of [-1, 1]) {
          const shoulder = panel(body, .31 + level * .035, .3 + level * .035, .46, colors.shell, side * .43, .19, .39);
          shoulder.rotation.z = -side * .2;
          panel(body, .025, .19, .36, colors.cyan, side * (.61 + level * .012), .19, .39, true);
          panel(body, .26, .07, .47, colors.white, side * .45, .42, .36);
          if (level >= 2) {
            for (let i = 0; i < 3; i++) {
              const plate = panel(body, .13, .48, .31, i % 2 ? colors.white : colors.shell, side * .46, -.015, .15 - i * .3);
              plate.rotation.z = side * .08;
              panel(body, .026, .035, .21, i % 2 ? colors.pink : colors.cyan, side * .535, .04, .15 - i * .3, true);
            }
            panel(body, .3, .28, .42, colors.shell, side * .4, .17, -.56);
          }
          if (level >= 2) {
            for (let vent = 0; vent < level; vent++) panel(body, .08, .18, .2, colors.dark, side * .24, .5, -.22 - vent * .15);
          }
        }
        for (let i = 0; i < level + 2; i++) {
          panel(body, .28, .09, .18, colors.white, 0, .43, .38 - i * .22);
          panel(body, .07, .025, .12, colors.pink, 0, .493, .38 - i * .22, true);
        }
        if (branch === 'craft') for (const side of (level === 1 ? [-1] : [-1, 1])) {
          const arm = mount(ctx.rig, 'forge-tool-' + side);
          arm.position.copy(ctx.torso.position).add(new THREE.Vector3(side * .47, .3, -.25));
          panel(arm, .1, .34, .12, colors.white, side * .08, .1, 0);
          panel(arm, .1, .1, .32 + level * .08, colors.shell, side * .08, .27, .16);
          panel(arm, .22, .14, .12, colors.gold, side * .08, .27, .36 + level * .08);
          panel(arm, .08, .05, .3, colors.cyan, side * .08, .33, .17, true);
          batch(arm); state.engines.push(arm);
        }
        if (branch === 'power') {
          const wave = fitting(THREE, body, new THREE.RingGeometry(.16, .19, 20), accent, 0, -.1, .83, true);
          wave.material.transparent = true; wave.material.depthWrite = false; wave.material.side = THREE.DoubleSide;
          wave.userData.cyberAnimated = true; wave.visible = false; state.waves.push(wave);
        }
        batch(body);
        }
        if (branch === 'cadence' && level >= 2) {
          const helmet = mount(ctx.head, 'reflex-helmet-' + level);
          const hk = ctx.species === 'cow' ? 1.18 : ctx.species === 'stag' ? .92 : 1;
          helmet.scale.setScalar(hk);
          panel(helmet, .57, .18, .55, colors.shell, 0, .24, .05);
          for (const side of [-1, 1]) {
            panel(helmet, .12, .37, .43, colors.white, side * .265, .015, .05);
            panel(helmet, .045, .045, .28, colors.pink, side * .337, .08, .1, true);
            const fin = panel(helmet, .07, .28, .24, colors.shell, side * .32, .29, -.12);
            fin.rotation.z = side * -.45;
          }
          if (full) {
            panel(helmet, .44, .13, .12, colors.dark, 0, .07, .36);
            panel(helmet, .4, .035, .028, colors.cyan, 0, .075, .432, true);
            panel(helmet, .33, .19, .37, colors.white, 0, -.13, .29);
            for (const side of [-1, 1]) panel(helmet, .05, .08, .027, colors.gold, side * .09, -.13, .49, true);
            for (let i = -1; i <= 1; i++) {
              bar(helmet, new THREE.Vector3(i * .07, -.22, .28), new THREE.Vector3(i * .095, -.45 + Math.abs(i) * .07, .26), .025, colors.dark);
              panel(helmet, .045, .07, .045, colors.pink, i * .095, -.45 + Math.abs(i) * .07, .26, true);
            }

          }
          batch(helmet);
        }
        if (branch === 'reach') {
          const helmet = mount(ctx.head, 'arc-antlers-' + level);
          helmet.scale.setScalar(.5 + level / 6);
            // Monumental swept-back rail horns, with continuous luminous cores.
            for (const side of [-1, 1]) {
              const points = [[side * .18, .3, -.04], [side * .37, .62, -.16], [side * .54, .94, -.43], [side * .48, 1.23, -.72]];
              for (let i = 0; i < level; i++) {
                const a = new THREE.Vector3(...points[i]), b = new THREE.Vector3(...points[i + 1]);
                bar(helmet, a, b, .13 - i * .032, i === 1 ? colors.white : colors.shell);
                a.z += .09 - i * .02; b.z += .07 - i * .02;
                bar(helmet, a, b, .03 - i * .006, i === 2 ? colors.pink : colors.cyan, true);
              }
              const tip = new THREE.Vector3(...points[level]);
              fitting(THREE, helmet, new THREE.OctahedronGeometry(.05 + level * .02), accent, tip.x, tip.y, tip.z, true);
              if (ctx.species === 'stag' && level >= 2) bar(helmet, new THREE.Vector3(side * .42, .74, -.26), new THREE.Vector3(side * .84, .98, -.35), .07, colors.gold);
            }
          const charge = fitting(THREE, helmet, new THREE.OctahedronGeometry(.07 + level * .02), colors.cyan, 0, .42, -.08, true);
          charge.userData.cyberAnimated = true; state.lights.push(charge);
          const wave = fitting(THREE, helmet, new THREE.RingGeometry(.12, .14, 16), accent, 0, .65, .05, true);
          wave.material.transparent = true; wave.material.depthWrite = false; wave.material.side = THREE.DoubleSide;
          wave.userData.cyberAnimated = true; wave.visible = false; state.waves.push(wave);
          batch(helmet);
        }
        if (branch === 'cadence') {
          const collar = mount(ctx.neck, 'reflex-neck-' + level);
          // Attach to the neck mesh so its telescoping cadence pose carries the armor.
          const p = ctx.neck.geometry.parameters;
          const sleeve = fitting(THREE, collar, new THREE.CylinderGeometry(p.radiusTop + .035, p.radiusBottom + .035, p.height, 8), colors.dark, 0, 0, 0);
          for (let i = 0; i < level + 2; i++) {
            const r = p.radiusBottom + (p.radiusTop - p.radiusBottom) * i / (level + 1) + .045;
            const ring = fitting(THREE, collar, new THREE.TorusGeometry(r, .025, 4, 12), i % 2 ? colors.white : colors.cyan, 0, p.height * (i / (level + 1) - .5), 0, i % 2 === 0);
            ring.rotation.x = Math.PI / 2;
          }
          batch(collar);
        }
        if (branch === 'move') {
          ctx.legs.forEach(function (leg, index) {
            const side = Math.sign(leg.hip.position.x) || 1;
            const upper = mount(leg.hip, 'cyber-upper-leg-' + index);
            const lower = mount(leg.knee, 'cyber-lower-leg-' + index);
            const foot = mount(leg.ankle, 'cyber-foot-' + index);
            const upperLen = Math.abs(leg.knee.position.y), lowerLen = Math.abs(leg.ankle.position.y);
            if (level >= 2) panel(upper, .24, upperLen * .8, .25, colors.shell, 0, -upperLen * .4, 0);
            if (level >= 2) panel(upper, .045, upperLen * .66, .028, colors.cyan, 0, -upperLen * .4, .145, true);
            const joint = fitting(THREE, lower, new THREE.CylinderGeometry(.115, .115, .29, 10), colors.dark, 0, 0, 0); joint.rotation.z = Math.PI / 2;
            const hub = fitting(THREE, lower, new THREE.TorusGeometry(.08, .025, 4, 12), colors.pink, side * .16, 0, 0, true); hub.rotation.y = Math.PI / 2;
            panel(lower, .19, lowerLen * .8, .2, colors.white, 0, -lowerLen * .47, 0);
            bar(lower, new THREE.Vector3(side * .12, -.06, -.06), new THREE.Vector3(side * .12, -lowerLen * .84, -.06), .032, colors.gold);
            panel(lower, .035, lowerLen * .55, .025, colors.cyan, 0, -lowerLen * .46, .12, true);
            panel(foot, .26, .16, .32, colors.shell, 0, -.025, .035);
            panel(foot, .27, .035, .33, colors.pink, 0, -.095, .035, true);
            if (full) {
              const jet = fitting(THREE, lower, new THREE.ConeGeometry(.065, .25, 5), colors.cyan, 0, -.1, -.22, true);
              jet.rotation.x = -Math.PI / 2; jet.userData.cyberAnimated = true; jet.visible = false; state.engines.push(jet);
            }
            [upper, lower, foot].forEach(batch);
          });
        }
        if (full && (branch === 'power' || branch === 'craft')) {
          if (ctx.tail) {
            const tail = mount(ctx.tail, 'cyber-tail');
            panel(tail, .13, .35, .13, colors.shell, 0, .17, 0);
            panel(tail, .14, .06, .14, colors.cyan, 0, .35, 0, true); batch(tail);
          }
        }
        return level;
      },
      animate: function (t, speed, attack, reduced) {
        if (state.recoil) state.recoil.rotation.x = reduced ? 0 : -Math.max(0, attack) * state.level * .035;
        state.waves.forEach(function (wave) {
          wave.visible = !reduced && attack > .25;
          wave.scale.setScalar(1 + (1 - Math.min(1, Math.max(0, attack))) * state.level * 2);
          wave.material.opacity = Math.max(0, attack) * .65;
        });
        state.engines.forEach(function (jet) {
          if (branch === 'craft') jet.rotation.x = reduced ? 0 : -Math.max(0, attack) * (.15 + state.level * .12);
          else { jet.visible = !reduced && speed > .15; jet.scale.y = .65 + speed * .7; }
        });
        state.lights.forEach(function (light) { light.material.emissiveIntensity = reduced ? .8 : .9 + Math.max(0, attack) * 1.4 + Math.sin(t * 3) * .12; });
      },
      get level() { return state.level; },
      dispose: function () { clear(); state.level = 0; }
    };
  }

  function makeLoadout(THREE) {
    const modules = {};
    for (const key of ['move', 'cadence', 'reach', 'power', 'craft']) modules[key] = makeModuleStyle(THREE, key);
    return {
      apply: function (levels, ctx) { for (const key of Object.keys(modules)) modules[key].apply(levels[key] || 0, ctx); },
      animate: function (t, speed, attack, reduced) { for (const key of Object.keys(modules)) modules[key].animate(t, speed, attack, reduced); },
      dispose: function () { for (const key of Object.keys(modules)) modules[key].dispose(); }
    };
  }

  M.styleFx = {
    makeLoadout: makeLoadout,
    makeModuleStyle: makeModuleStyle,
    dressAttack: dressAttack,
    makeCraftStyle: makeCraftStyle,
    makeSpeedStyle: makeSpeedStyle,
    makeHornStyle: makeHornStyle,
    makeNeckStyle: makeNeckStyle,
    makePowerStyle: makePowerStyle,
    powerStyle: POWER_STYLE,
    neckStyle: NECK_STYLE,
  };
})(window.Meadow = window.Meadow || {});
