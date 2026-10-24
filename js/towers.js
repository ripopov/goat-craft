(function (M) {
  'use strict';

  // Original designs drawing on the elemental / siege roles of classic RTS TD maps.
  const definitions = [
    { id: 'ballista', name: 'Oak Ballista', role: 'Reliable single target', height: 1, damage: 1, interval: 1.15, range: 19, color: 0xdab478, cost: { coins: 6, log: 2 }, style: 'bolt' },
    { id: 'mortar', name: 'Iron Mortar', role: 'Explosive area damage', height: 1, damage: 1.5, interval: 2.5, range: 22, color: 0xefad63, cost: { coins: 14, stone: 4, iron: 1 }, splash: 4, style: 'shell' },
    { id: 'frost', name: 'Frost Spire', role: 'Chills enemies by 45%', height: 2, damage: .5, interval: 1.3, range: 17, color: 0x91eaff, cost: { coins: 12, stone: 3 }, slow: .55, style: 'crystal' },
    { id: 'ember', name: 'Ember Cannon', role: 'Splash + lingering burn', height: 2, damage: 1, interval: 1.6, range: 18, color: 0xff794d, cost: { coins: 18, stone: 3, coal: 2 }, splash: 2.8, dot: .5, style: 'shell' },
    { id: 'venom', name: 'Venom Idol', role: 'Four seconds of poison', height: 2, damage: .3, interval: 1.2, range: 18, color: 0x9bd55e, cost: { coins: 15, log: 3, dirt: 3 }, dot: .7, style: 'crystal' },
    { id: 'storm', name: 'Storm Coil', role: 'Lightning chains to 3 foes', height: 2, damage: 1.2, interval: 1.8, range: 19, color: 0x83bbff, cost: { coins: 24, stone: 3, copper: 2 }, chain: 3, style: 'coil' },
    { id: 'sniper', name: 'Watchman', role: 'Long range, heavy shot', height: 3, damage: 3.5, interval: 2.7, range: 32, color: 0xe4ce96, cost: { coins: 22, log: 4, iron: 2 }, style: 'bolt' },
    { id: 'earth', name: 'Earthshaker', role: 'Boulder splash + stagger', height: 1, damage: 1.8, interval: 2.8, range: 16, color: 0xc0b17a, cost: { coins: 16, stone: 5, dirt: 4 }, splash: 4.5, slow: .35, style: 'shell' },
    { id: 'arcane', name: 'Arcane Prism', role: 'Rapid magic bolts', height: 3, damage: .8, interval: .45, range: 20, color: 0xc4a0ff, cost: { coins: 32, stone: 4, copper: 3 }, style: 'crystal' },
    { id: 'sun', name: 'Sunspire', role: 'Radiant beam pierces 3 foes', height: 3, damage: 2.5, interval: 1.7, range: 25, color: 0xffd975, cost: { coins: 45, stone: 5, iron: 3, coal: 2 }, pierce: true, style: 'coil' }
  ];
  const byId = Object.fromEntries(definitions.map(d => [d.id, d]));
  const list = [], cells = new Map(), effects = [], projectiles = [], motion = new WeakMap();
  const MAX_TOWERS = 80, SIZE = 2;
  let scene, removing = false;
  const cube = new THREE.BoxGeometry(1, 1, 1), materials = new Map(), templates = new Map();
  function material(color, glow) {
    const key = color + '/' + !!glow;
    if (!materials.has(key)) materials.set(key, M.std(color, .68, glow ? { emissive: color, emissiveIntensity: .55 } : {}));
    return materials.get(key);
  }
  function part(parent, x, y, z, w, h, d, color, glow) {
    const mesh = new THREE.Mesh(cube, material(color, glow));
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  function model(id) {
    if (templates.has(id)) {
      const copy = templates.get(id).clone();
      copy.userData.turret = copy.getObjectByName('Turret'); copy.userData.weapon = copy.getObjectByName('Weapon'); return copy;
    }
    const def = byId[id], group = new THREE.Group(), top = def.height * SIZE;
    group.name = def.name;
    part(group, 0, .18, 0, 1.96, .36, 1.96, 0x535f54);
    for (let i = 0; i < def.height; i++) {
      const h = i === def.height - 1 ? .75 : 1.8;
      part(group, 0, i * SIZE + .4 + h / 2, 0, 1.6, h, 1.6, def.id === 'ballista' || def.id === 'sniper' ? 0x785a3e : 0x78817b);
      for (const x of [-.73, .73]) for (const z of [-.73, .73]) {
        part(group, x, i * SIZE + .55, z, .25, .65, .25, 0xa5aa8f);
      }
      if (i < def.height - 1) {
        part(group, 0, i * SIZE + 1.95, 0, 1.87, .2, 1.87, 0x4b5852);
        part(group, 0, i * SIZE + 1.25, -.815, .3, .45, .06, def.color, true);
      }
    }
    const turret = new THREE.Group(); turret.name = 'Turret'; turret.position.y = top - .65; group.add(turret);
    part(turret, 0, -.25, 0, 1.94, .25, 1.94, 0x485850);
    const weapon = new THREE.Group(); weapon.name = 'Weapon'; turret.add(weapon);
    if (def.style === 'crystal') {
      const gem = part(weapon, 0, .13, 0, .65, .78, .65, def.color, true); gem.rotation.y = Math.PI / 4;
      for (const x of [-.66, .66]) part(weapon, x, -.02, 0, .2, .65, .3, 0xc3b58b);
    } else if (def.style === 'coil') {
      for (const x of [-.6, .6]) {
        part(weapon, x, .02, 0, .25, .8, .3, 0xa88757);
        part(weapon, x, .37, 0, .38, .15, .42, def.color, true);
      }
      part(weapon, 0, .12, 0, .4, .4, .4, def.color, true);
    } else {
      part(weapon, 0, 0, 0, .8, .65, .85, 0x3d4a49);
      const barrel = part(weapon, 0, .16, -.46, def.id === 'mortar' ? .65 : .36, .36, def.id === 'sniper' ? 1.65 : 1.2, 0x273936);
      barrel.rotation.x = 0;
      part(weapon, 0, .16, def.id === 'sniper' ? -1.32 : -1.1, .23, .23, .08, def.color, true);
      if (def.style === 'bolt') part(weapon, 0, .06, -.4, 1.7, .18, .22, 0xb49664);
    }
    // Bake the masonry by material once per blueprint. Instances, pickups and
    // previews reuse geometry; rotating barrels remain a separate small group.
    function bake(parent) {
      const batches = new Map();
      parent.children.slice().forEach(mesh => {
        if (!mesh.isMesh) return;
        mesh.updateMatrix();
        const geometry = cube.toNonIndexed(); geometry.applyMatrix4(mesh.matrix);
        if (!batches.has(mesh.material)) batches.set(mesh.material, { positions: [], normals: [] });
        const batch = batches.get(mesh.material);
        batch.positions.push(...geometry.attributes.position.array); batch.normals.push(...geometry.attributes.normal.array);
        geometry.dispose(); parent.remove(mesh);
      });
      batches.forEach((batch, mat) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
        const mesh = new THREE.Mesh(geometry, mat); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
      });
    }
    bake(group); bake(turret); bake(weapon);
    if (def.style === 'shell') weapon.rotation.x = .35;
    templates.set(id, group.clone());
    group.userData.turret = turret; group.userData.weapon = weapon;
    return group;
  }
  function itemDefinition(kind) { return typeof kind === 'string' && kind.startsWith('tower_') ? byId[kind.slice(6)] || null : null; }
  function atCell(bx, by, bz) { return cells.get(bx + ',' + by + ',' + bz) || null; }
  function inventoryCount(id) { return M.items.count('tower_' + id); }
  function available(def) { return inventoryCount(def.id) > 0 || M.upgrades.canAfford(def.cost); }
  function site(id, bx, by, bz) {
    const def = byId[id];
    if (!def || !Number.isInteger(bx) || !Number.isInteger(by) || !Number.isInteger(bz)) return { valid: false, reason: 'Choose solid, dry ground.' };
    if (list.length >= MAX_TOWERS) return { valid: false, reason: 'Tower limit reached (80).' };
    // The arena stays streamed and simulated even when the player explores.
    if (Math.hypot((bx + .5) * SIZE, (bz + .5) * SIZE) > 50) return { valid: false, reason: 'Build within 50m of the Hearth.' };
    if (!M.world.blockInfoAt(bx, by - 1, bz) || atCell(bx, by - 1, bz)) return { valid: false, reason: 'A tower needs a solid foundation.' };
    for (let y = by; y < by + def.height; y++) {
      if (!M.world.canPlaceBlock(bx, y, bz)) return { valid: false, reason: 'Blocked: leave room for the full tower.' };
      if (M.world.waterAt((bx + .5) * SIZE, y * SIZE + .1, (bz + .5) * SIZE)) return { valid: false, reason: 'Towers need dry ground.' };
    }
    return { valid: true, reason: 'Click to deploy · Shift keeps building' };
  }
  function place(id, bx, by, bz, inventoryOnly) {
    const def = byId[id];
    if (!scene || !def || M.hearthTree.health <= 0 || !site(id, bx, by, bz).valid) return false;
    const owned = inventoryCount(id) > 0;
    if (inventoryOnly && !owned || !owned && !M.upgrades.canAfford(def.cost)) return false;
    // Validate every cell and both balances before editing or spending.
    const tower = { id, bx, by, bz, def, cooldown: .25, kills: 0, shots: 0, fireAge: 10, group: model(id) };
    for (let y = by; y < by + def.height; y++) {
      if (!M.world.placeBlock('stone', bx, y, bz)) {
        for (let old = by; old < y; old++) M.world.breakBlockAt(bx, old, bz, { drop: false, towerInternal: true });
        return false;
      }
    }
    if (owned) M.items.spend({ ['tower_' + id]: 1 });
    else { M.enemies.spendCoins(def.cost.coins); M.items.spend(def.cost); }
    tower.group.position.set((bx + .5) * SIZE, by * SIZE, (bz + .5) * SIZE);
    tower.position = tower.group.position;
    for (let y = by; y < by + def.height; y++) cells.set(bx + ',' + y + ',' + bz, tower);
    scene.add(tower.group); list.push(tower);
    if (M.audio && M.audio.pickup) M.audio.pickup();
    return tower;
  }
  function dismantle(tower) {
    if (removing || !list.includes(tower)) return false;
    removing = true;
    for (let y = tower.by; y < tower.by + tower.def.height; y++) {
      cells.delete(tower.bx + ',' + y + ',' + tower.bz);
      M.world.breakBlockAt(tower.bx, y, tower.bz, { drop: false, towerInternal: true });
    }
    removing = false;
    list.splice(list.indexOf(tower), 1); scene.remove(tower.group);
    M.items.dropBlock('tower_' + tower.id, tower.position.x, tower.position.y + .7, tower.position.z, { persistent: true });
    return true;
  }
  function localTarget(kind) {
    const def = itemDefinition(kind), hit = M.targeting.aim(M.goat.aimCamera, M.goat.group.position);
    if (!def || !hit) return null;
    const bx = hit.bx + hit.normal.x, by = hit.by + hit.normal.y, bz = hit.bz + hit.normal.z;
    return { kind, bx, by, bz, x: (bx + .5) * SIZE, y: (by + .5) * SIZE, z: (bz + .5) * SIZE, valid: site(def.id, bx, by, bz).valid };
  }
  function lineClear(origin, destination, tower) {
    const delta = destination.clone().sub(origin), distance = delta.length(), steps = Math.ceil(distance / .45);
    const p = new THREE.Vector3();
    for (let i = 1; i < steps; i++) {
      p.copy(origin).addScaledVector(delta, i / steps);
      if (tower && atCell(Math.floor(p.x / SIZE), Math.floor(p.y / SIZE), Math.floor(p.z / SIZE)) === tower) continue;
      if (M.world.blockedAt(p.x, p.z, p.y, p.y + .05)) return false;
    }
    return true;
  }
  function alive(enemy) { return enemy.hp > 0 && M.enemies.zombies.includes(enemy); }
  function aimAt(enemy) {
    return enemy.position.clone().add(new THREE.Vector3(0, Math.min(1.25, enemy.body.height * .6), 0));
  }
  function hit(tower, enemy, amount) {
    if (!alive(enemy)) return;
    if (M.enemies.damageEnemy(enemy, amount)) tower.kills++;
    if (alive(enemy) && tower.def.slow) { enemy.towerSlow = tower.def.slow; enemy.towerSlowTime = 2.5; }
    if (alive(enemy) && tower.def.dot) {
      enemy.towerDots = enemy.towerDots || {};
      enemy.towerDots[tower.id] = { remaining: 4, rate: tower.def.dot, tower };
    }
  }

  // Geometry and materials are shared by all flights and bursts. Visual budgets
  // never suppress collision or damage, including with reduced motion enabled.
  const MAX_PROJECTILES = 256, MAX_EFFECTS = 100;
  const ice = new THREE.OctahedronGeometry(1), ring = new THREE.TorusGeometry(1, .045, 4, 24);
  const fxMaterials = new Map();
  function fxMaterial(color) {
    if (!fxMaterials.has(color)) fxMaterials.set(color, new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    return fxMaterials.get(color);
  }
  function fxPart(parent, color, x, y, z, sx, sy, sz, geometry) {
    const mesh = new THREE.Mesh(geometry || cube, fxMaterial(color));
    mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); parent.add(mesh); return mesh;
  }
  function addEffect(group, duration, animate) {
    if (M.config.reducedMotion || effects.length >= MAX_EFFECTS) return;
    scene.add(group); effects.push({ group, age: 0, duration, animate });
  }
  function muzzle(tower, point, aim) {
    if (M.config.reducedMotion || effects.length >= MAX_EFFECTS) return;
    const id = tower.id, color = tower.def.color, g = new THREE.Group();
    g.name = tower.def.name + ' muzzle'; g.position.copy(point); g.lookAt(aim);
    const magic = ['frost', 'venom', 'storm', 'arcane', 'sun'].includes(id);
    const core = fxPart(g, magic ? color : 0xffe7a0, 0, 0, 0,
      id === 'sniper' ? .22 : .4, id === 'sniper' ? .22 : .4, id === 'sniper' ? 1.1 : .5, ice);
    const bits = [];
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      const mesh = fxPart(g, id === 'earth' ? 0x9d8963 : color, Math.cos(angle) * .3, Math.sin(angle) * .3, -.12,
        id === 'ballista' ? .05 : .1, .1, magic ? .35 : .15, id === 'frost' || id === 'arcane' ? ice : cube);
      bits.push({ mesh, angle });
    }
    let halo;
    if (['arcane', 'sun', 'frost'].includes(id)) halo = fxPart(g, color, 0, 0, 0, .3, .3, .3, ring);
    addEffect(g, id === 'sun' ? .32 : .22, k => {
      core.scale.setScalar((id === 'sun' ? .45 : .32) * (1 - k));
      bits.forEach(({ mesh, angle }, i) => {
        const radius = .25 + k * (id === 'earth' ? .9 : .5);
        const spin = id === 'arcane' ? k * 5 : id === 'storm' ? Math.sin(k * 50 + i) * .6 : 0;
        mesh.position.set(Math.cos(angle + spin) * radius, Math.sin(angle + spin) * radius, k * (id === 'venom' ? -.6 : .4));
        if (id === 'venom') mesh.position.y -= k * k;
        mesh.scale.setScalar((id === 'ember' ? .22 : .12) * (1 - k));
      });
      if (halo) { halo.scale.setScalar(.2 + k * .8); halo.rotation.z = k * 3; }
    });
  }
  function burst(id, point, groundY, wall) {
    if (M.config.reducedMotion || effects.length >= MAX_EFFECTS) return;
    const def = byId[id], g = new THREE.Group(), pieces = [];
    g.position.copy(point); g.name = def.name + ' impact';
    const heavy = ['mortar', 'earth', 'ember'].includes(id), duration = heavy ? .65 : .38;
    const colors = id === 'mortar' ? [0xffd783, 0xff853d, 0x62645a] :
      id === 'earth' ? [0x9d8963, 0x71644d, 0xc0b17a] :
      id === 'ember' ? [0xffdc70, 0xff853d, 0xc94325] : [def.color, 0xf3fbff, def.color];
    for (let i = 0; i < (heavy ? 9 : 6); i++) {
      const angle = i * 2.39996, size = heavy ? .22 + i % 3 * .1 : .12;
      const mesh = fxPart(g, colors[i % 3], 0, 0, 0, size, size, size,
        ['frost', 'arcane', 'venom'].includes(id) ? ice : cube);
      if (id === 'ballista' || id === 'sniper') mesh.scale.set(.04, .04, .35);
      if (id === 'frost') mesh.scale.set(.09, .35, .09);
      pieces.push({ mesh, x: Math.cos(angle) * (heavy ? 3.5 : 2), z: Math.sin(angle) * (heavy ? 3.5 : 2), y: 1.3 + i % 4 * .6 });
    }
    let halo;
    if (heavy || ['frost', 'venom', 'sun'].includes(id)) {
      halo = fxPart(g, def.color, 0, wall ? 0 : groundY - point.y + .12, 0, .15, .15, .15, ring);
      halo.rotation.x = Math.PI / 2;
    }
    if (id === 'sun' || id === 'storm') {
      for (let i = 0; i < (id === 'storm' ? 3 : 4); i++) {
        const ray = fxPart(g, id === 'sun' ? 0xffefad : 0xd6f1ff, 0, 0, 0, .06, id === 'sun' ? 1.5 : 1, .06); ray.rotation.z = i * Math.PI / 4;
      }
    }
    addEffect(g, duration, k => {
      pieces.forEach(p => {
        p.mesh.position.set(p.x * k, p.y * k - (heavy ? 3 : 1) * k * k, p.z * k);
        p.mesh.rotation.set(k * 4, k * 6, k * 3);
        if (id === 'venom') p.mesh.position.y = k * (1 + p.y * .6);
        if (id === 'arcane') p.mesh.position.set(Math.cos(k * 8 + p.x) * (1 - k), p.y * k * .3, Math.sin(k * 8 + p.z) * (1 - k));
        if (id === 'frost') { p.mesh.position.y = Math.max(groundY - point.y + .15, p.mesh.position.y * .3); p.mesh.scale.set(.1 * (1 - k), .7 * (1 - k), .1 * (1 - k)); }
        else if (id === 'sniper' || id === 'ballista') p.mesh.scale.set(.04 * (1 - k), .04 * (1 - k), .4 * (1 - k));
        else p.mesh.scale.setScalar((heavy ? .28 : .13) * (1 - k));
        p.mesh.visible = k < .95;
      });
      if (halo) { const r = .15 + k * (def.splash || 1.25); halo.scale.set(r, r, 1 - k); }
      if (id === 'storm') g.rotation.y = Math.sin(k * 50) * .6;
      if (id === 'sun') g.rotation.y = k * 2;
    });
  }
  function trail(p) {
    if (M.config.reducedMotion || effects.length >= MAX_EFFECTS) return;
    const g = new THREE.Group(); g.position.copy(p.position);
    const color = p.id === 'earth' ? 0x8e7c59 : p.id === 'mortar' ? 0x858475 : p.tower.def.color;
    const size = p.id === 'earth' ? .28 : p.id === 'ember' ? .24 : .1;
    fxPart(g, color, 0, 0, 0, size, size, size, ['frost', 'arcane'].includes(p.id) ? ice : cube);
    addEffect(g, .28, k => { g.scale.setScalar(1 - k); g.position.y += p.id === 'ember' ? .015 : .004; });
  }
  function projectileModel(id) {
    const g = new THREE.Group(); g.name = byId[id].name + ' projectile';
    const color = byId[id].color;
    switch (id) {
      case 'ballista':
        fxPart(g, 0x94633d, 0, 0, 0, .1, .1, .95);
        fxPart(g, 0xe1e8d9, 0, 0, .52, .18, .18, .3, ice);
        for (const x of [-.14, .14]) fxPart(g, 0xdab478, x, 0, -.35, .25, .05, .26);
        break;
      case 'mortar':
        fxPart(g, 0x394541, 0, 0, 0, .52, .52, .52);
        fxPart(g, 0xffd37e, 0, .3, 0, .12, .16, .12);
        break;
      case 'frost':
        fxPart(g, 0xd6ffff, 0, 0, .1, .22, .22, .85, ice);
        for (const x of [-.24, .24]) fxPart(g, color, x, 0, -.2, .14, .14, .42, ice);
        break;
      case 'ember':
        fxPart(g, 0xffdf75, 0, 0, 0, .4, .4, .5, ice);
        for (let i = 0; i < 3; i++) fxPart(g, i === 1 ? 0xffa431 : 0xf45e26, (i - 1) * .18, 0, -.3 - i * .08, .23, .23, .65, ice);
        break;
      case 'venom':
        fxPart(g, color, 0, 0, 0, .42, .42, .42, ice);
        for (let i = 0; i < 3; i++) fxPart(g, 0xd7f77a, Math.cos(i * 2.1) * .25, Math.sin(i * 2.1) * .25, -.15, .15, .15, .15);
        break;
      case 'storm':
        fxPart(g, 0xecfaff, 0, 0, .1, .16, .16, .5, ice);
        for (let i = 0; i < 6; i++) fxPart(g, i % 2 ? color : 0xffffff, 0, 0, -.2 - i * .24, .07, .07, .35);
        break;
      case 'sniper':
        fxPart(g, 0xfff2c4, 0, 0, .25, .08, .08, 1.2);
        fxPart(g, color, 0, 0, -.65, .035, .035, 1.3);
        break;
      case 'earth':
        fxPart(g, 0x817457, 0, 0, 0, .8, .75, .8);
        for (let i = 0; i < 3; i++) fxPart(g, i % 2 ? color : 0x9e916a, Math.cos(i * 2.1) * .36, .13, Math.sin(i * 2.1) * .36, .45, .45, .45);
        break;
      case 'arcane':
        fxPart(g, 0xeee3ff, 0, 0, .1, .18, .18, .5, ice);
        for (const x of [-.23, .23]) fxPart(g, color, x, 0, -.12, .18, .18, .35, ice);
        break;
      case 'sun':
        fxPart(g, 0xffffe7, 0, 0, 0, .13, .13, 1.8);
        for (const z of [-.6, .3]) fxPart(g, color, 0, 0, z, .27, .27, .27, ring);
        break;
    }
    return g;
  }
  const flight = {
    ballista: { speed: 26 }, mortar: { speed: 14, arc: 5 }, frost: { speed: 19, homing: true },
    ember: { speed: 18, arc: 2.5 }, venom: { speed: 15, homing: true }, storm: { speed: 72, homing: true },
    sniper: { speed: 64 }, earth: { speed: 12, arc: 3 }, arcane: { speed: 27, homing: true }, sun: { speed: 44 }
  };
  function launch(tower, target, origin, visited) {
    if (projectiles.length >= MAX_PROJECTILES) return false;
    const id = tower.id, spec = flight[id], aim = aimAt(target);
    // Lead physical shots using observed velocity; teleports never create
    // impossible intercepts. Homing magic instead follows the live body.
    const movement = motion.get(target);
    if (!spec.homing && movement) {
      const lead = Math.min(2, origin.distanceTo(aim) / spec.speed);
      aim.addScaledVector(movement.velocity, lead);
    }
    const direction = aim.clone().sub(origin).normalize();
    const destination = tower.def.pierce ? origin.clone().addScaledVector(direction, tower.def.range) : aim;
    // Siege shots aim at the ground and can miss enemies that move away.
    if (spec.arc) destination.y = aim.y - Math.min(1.25, target.body.height * .6) + .15;
    const distance = origin.distanceTo(destination);
    const p = { id, tower, target, spec, position: origin.clone(), origin: origin.clone(), destination,
      direction, age: 0, duration: Math.max(.12, distance / spec.speed), trailTime: 0,
      visited: visited || new Set(), hits: new Set(), mesh: projectileModel(id) };
    p.mesh.position.copy(origin); p.mesh.lookAt(destination); scene.add(p.mesh); projectiles.push(p); return true;
  }
  // Swept body-box intersections prevent fast darts and lances tunnelling through
  // enemies. Wall samples and enemy intersections share the same segment ordering.
  function bodyIntersection(from, to, enemy, padding) {
    const r = enemy.body.radius + padding, pos = enemy.position;
    const min = [pos.x - r, pos.y - padding, pos.z - r];
    const max = [pos.x + r, pos.y + enemy.body.height + padding, pos.z + r];
    const a = [from.x, from.y, from.z], b = [to.x, to.y, to.z];
    let enter = 0, leave = 1;
    for (let axis = 0; axis < 3; axis++) {
      const d = b[axis] - a[axis];
      if (Math.abs(d) < 1e-8) { if (a[axis] < min[axis] || a[axis] > max[axis]) return null; }
      else {
        let t1 = (min[axis] - a[axis]) / d, t2 = (max[axis] - a[axis]) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        enter = Math.max(enter, t1); leave = Math.min(leave, t2); if (enter > leave) return null;
      }
    }
    return enter;
  }
  function wallIntersection(from, to, tower) {
    const steps = Math.max(1, Math.ceil(from.distanceTo(to) / .18)), point = new THREE.Vector3();
    for (let i = 1; i <= steps; i++) {
      point.lerpVectors(from, to, i / steps);
      if (atCell(Math.floor(point.x / SIZE), Math.floor(point.y / SIZE), Math.floor(point.z / SIZE)) === tower) continue;
      if (M.world.blockedAt(point.x, point.z, point.y, point.y + .04)) return Math.max(0, (i - 1) / steps);
    }
    return Infinity;
  }
  function impact(p, point, enemy, wall) {
    const tower = p.tower, def = tower.def;
    burst(p.id, point, enemy ? enemy.position.y : p.destination.y, wall);
    if (M.audio && M.audio.towerImpact) M.audio.towerImpact(point, p.id);
    if (def.splash) {
      // Evaluate victims at impact, not launch. The struck enemy is always in
      // the blast; other victims need an unobstructed path from the near side.
      M.enemies.zombies.slice().forEach(e => {
        if (e === enemy || aimAt(e).distanceTo(point) <= def.splash && lineClear(point, aimAt(e), null)) hit(tower, e, def.damage);
      });
    } else if (enemy) hit(tower, enemy, def.damage);
    if (def.chain && enemy) {
      p.visited.add(enemy);
      if (p.visited.size < def.chain) {
        const next = M.enemies.zombies.filter(e => alive(e) && !p.visited.has(e) &&
          e.position.distanceTo(enemy.position) < 7 && lineClear(point, aimAt(e), null))
          .sort((a, b) => a.position.distanceToSquared(enemy.position) - b.position.distanceToSquared(enemy.position))[0];
        if (next) launch(tower, next, point, p.visited);
      }
    }
  }
  function animateFlight(p, dt) {
    p.mesh.position.copy(p.position); p.mesh.lookAt(p.position.clone().add(p.direction));
    const t = p.age, children = p.mesh.children;
    if (M.config.reducedMotion) return;
    if (p.id === 'mortar' || p.id === 'earth') { p.mesh.rotateX(t * 5); p.mesh.rotateZ(t * 3); }
    if (p.id === 'frost') { p.mesh.rotateZ(t * 5); children[1].position.y = Math.sin(t * 12) * .12; }
    if (p.id === 'ember') { p.mesh.rotateZ(t * 9); p.mesh.scale.setScalar(1 + Math.sin(t * 24) * .12); }
    if (p.id === 'venom') { p.mesh.scale.set(1 + Math.sin(t * 13) * .13, 1 - Math.sin(t * 13) * .13, 1); p.mesh.rotateZ(t * 3); }
    if (p.id === 'storm') children.slice(1).forEach((m, i) => {
      m.position.x = Math.sin(t * 95 + i * 2.4) * .18; m.rotation.y = Math.sin(t * 80 + i) * .65;
    });
    if (p.id === 'arcane') { p.mesh.rotateZ(t * 17); children[1].position.y = Math.sin(t * 17) * .2; children[2].position.y = -Math.sin(t * 17) * .2; }
    if (p.id === 'sun') p.mesh.rotateZ(t * 6);
    p.trailTime += dt;
    if (!['ballista', 'sniper', 'storm'].includes(p.id) && p.trailTime >= .07) { p.trailTime = 0; trail(p); }
  }
  function advanceProjectile(p, dt) {
    p.age += dt;
    const from = p.position.clone(), to = from.clone();
    let finished = false;
    if (p.spec.arc) {
      const k = Math.min(1, p.age / p.duration);
      to.lerpVectors(p.origin, p.destination, k); to.y += Math.sin(k * Math.PI) * p.spec.arc;
      finished = k >= 1;
    } else {
      if (p.spec.homing && alive(p.target)) p.destination.copy(aimAt(p.target));
      const delta = p.destination.clone().sub(from), distance = delta.length(), travel = p.spec.speed * dt;
      if (distance > .0001) p.direction.copy(delta).divideScalar(distance);
      to.addScaledVector(p.direction, Math.min(travel, distance)); finished = distance <= travel;
    }
    const wallT = wallIntersection(from, to, p.tower);
    const collisions = M.enemies.zombies.filter(e => alive(e) && !p.hits.has(e) && !p.visited.has(e)).map(enemy =>
      ({ enemy, t: bodyIntersection(from, to, enemy, p.id === 'earth' ? .28 : .09) }))
      .filter(c => c.t !== null && c.t < wallT).sort((a, b) => a.t - b.t);
    for (const collision of collisions) {
      const point = from.clone().lerp(to, collision.t);
      p.hits.add(collision.enemy); impact(p, point, collision.enemy, false);
      if (!p.tower.def.pierce || p.hits.size >= 3) { p.position.copy(point); return true; }
    }
    if (wallT !== Infinity) {
      p.position.lerpVectors(from, to, wallT); impact(p, p.position, null, true); return true;
    }
    p.position.copy(to);
    if (finished || p.age > 5) {
      if (p.tower.def.splash) impact(p, to, null, false);
      return true;
    }
    animateFlight(p, dt); return false;
  }
  function shoot(tower) {
    if (projectiles.length >= MAX_PROJECTILES) return false;
    const def = tower.def, center = tower.position.clone(); center.y += def.height * SIZE - .4;
    const enemies = M.enemies.zombies.filter(e => alive(e) && Math.hypot(e.position.x - center.x, e.position.z - center.z) <= def.range &&
      Math.abs(e.position.y - tower.position.y) < 15);
    enemies.sort((a, b) => a.position.lengthSq() - b.position.lengthSq());
    const target = enemies.find(e => lineClear(center, aimAt(e), tower));
    if (!target) return false;
    const aim = aimAt(target), turret = tower.group.userData.turret;
    turret.rotation.y = Math.atan2(center.x - aim.x, center.z - aim.z);
    const weapon = tower.group.userData.weapon;
    if (def.style === 'bolt' || def.style === 'shell') {
      const rise = (flight[tower.id].arc ? target.position.y + .15 + Math.PI * flight[tower.id].arc : aim.y) - center.y;
      weapon.rotation.x = Math.atan2(rise, Math.hypot(aim.x - center.x, aim.z - center.z));
    }
    const origin = new THREE.Vector3(0, .16, def.style === 'bolt' || def.style === 'shell' ? (def.id === 'sniper' ? -1.36 : -1.12) : 0);
    tower.group.updateMatrixWorld(true); weapon.localToWorld(origin);
    if (!lineClear(center, origin, tower) || !launch(tower, target, origin)) return false;
    tower.fireAge = 0; muzzle(tower, origin, aim);
    if (M.audio && M.audio.towerShot) M.audio.towerShot(origin, def.style);
    tower.shots++; return true;
  }
  function animateTower(tower, dt) {
    tower.fireAge += dt;
    const weapon = tower.group.userData.weapon, def = tower.def;
    const k = Math.max(0, 1 - tower.fireAge / (def.id === 'earth' ? .5 : .3));
    const recoil = Math.sin(k * Math.PI * .8) * k;
    weapon.position.z = (def.id === 'sniper' ? .48 : def.style === 'shell' ? .32 : .13) * recoil;
    weapon.position.y = def.id === 'earth' ? -recoil * .15 : def.style === 'crystal' ? recoil * .18 : 0;
    weapon.scale.setScalar(1 + (def.style === 'crystal' || def.style === 'coil' ? recoil * .18 : 0));
    weapon.rotation.z = def.id === 'ballista' ? recoil * .035 : 0;
    if (M.config.reducedMotion) { weapon.position.set(0, 0, 0); weapon.scale.setScalar(1); weapon.rotation.z = 0; }
  }
  function update(dt) {
    for (const enemy of M.enemies.zombies.slice()) {
      let movement = motion.get(enemy);
      if (!movement) { movement = { position: enemy.position.clone(), velocity: new THREE.Vector3() }; motion.set(enemy, movement); }
      movement.velocity.copy(enemy.position).sub(movement.position).divideScalar(Math.max(.0001, dt));
      if (movement.velocity.lengthSq() > 100) movement.velocity.set(0, 0, 0);
      movement.position.copy(enemy.position);
      if (enemy.towerSlowTime > 0) enemy.towerSlowTime = Math.max(0, enemy.towerSlowTime - dt);
      if (enemy.towerDots) Object.entries(enemy.towerDots).forEach(([id, dot]) => {
        const tick = Math.max(0, Math.min(dt, dot.remaining)); dot.remaining -= tick;
        if (tick > 0 && M.enemies.damageEnemy(enemy, dot.rate * tick)) dot.tower.kills++;
        if (dot.remaining <= 0) delete enemy.towerDots[id];
      });
    }
    // Flights already in the air resolve before new shots. Chain jumps created
    // by an impact start moving on the next tick, never all in one frame.
    for (const p of projectiles.slice()) {
      if (M.hearthTree.health <= 0 || advanceProjectile(p, dt)) {
        scene.remove(p.mesh); projectiles.splice(projectiles.indexOf(p), 1);
      }
    }
    for (const tower of list.slice()) {
      if (!M.world.blockInfoAt(tower.bx, tower.by - 1, tower.bz)) { dismantle(tower); continue; }
      animateTower(tower, dt);
      if (M.hearthTree.health <= 0) continue;
      tower.cooldown -= dt;
      if (tower.cooldown <= 0) tower.cooldown = shoot(tower) ? tower.def.interval : .35;
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const effect = effects[i]; effect.age += dt;
      const k = Math.min(1, effect.age / effect.duration); effect.animate(k);
      if (k >= 1) { scene.remove(effect.group); effects.splice(i, 1); }
    }
  }
  M.towers = { definitions, byId, list, atCell, site, place, dismantle, available, inventoryCount, itemDefinition, localTarget,
    model, lineClear, maxTowers: MAX_TOWERS, init: function (value) { scene = value; }, update };
})(window.Meadow = window.Meadow || {});
