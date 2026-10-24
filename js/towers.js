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
  // Builder variants stay out of the workshop catalogue. Their distinct item
  // IDs preserve training strength when a tower is packed and redeployed.
  for (let tier = 1; tier <= 3; tier++) {
    const id = 'builder_frost_' + tier;
    byId[id] = { ...byId.frost, id, baseId: 'frost', builderTier: tier,
      name: 'Builder Frost Spire ' + ['I', 'II', 'III'][tier - 1],
      damage: .5 * tier, interval: 1.3 - (tier - 1) * .15 };
  }
  const list = [], cells = new Map(), effects = [], projectiles = [], motion = new WeakMap();
  const MAX_TOWERS = 80, SIZE = 2;
  let scene, removing = false, visualTime = 0;
  const cube = new THREE.BoxGeometry(1, 1, 1), materials = new Map(), templates = new Map();
  const crystal = new THREE.OctahedronGeometry(1), hoop = new THREE.TorusGeometry(1, .065, 4, 8);
  function material(color, glow) {
    const key = color + '/' + !!glow;
    const metal = [0x34434b, 0x526575, 0xa9bac1, 0xb88a49, 0xd9b875].includes(color);
    if (!materials.has(key)) materials.set(key, M.std(color, metal ? .32 : .82,
      glow ? { emissive: color, emissiveIntensity: .85 } : { metalness: metal ? .65 : .05 }));
    return materials.get(key);
  }
  function part(parent, x, y, z, w, h, d, color, glow, geometry) {
    const mesh = new THREE.Mesh(geometry || cube, material(color, glow));
    mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }
  function model(id) {
    if (byId[id] && byId[id].baseId) {
      const def = byId[id], group = model(def.baseId);
      group.name = def.name;
      for (let i = 0; i < def.builderTier; i++)
        part(group, 0, .55 + i * .24, .79, .34, .13, .08, def.color, true);
      return group;
    }
    if (templates.has(id)) {
      const copy = templates.get(id).clone();
      copy.userData.turret = copy.getObjectByName('Turret'); copy.userData.weapon = copy.getObjectByName('Weapon'); return copy;
    }
    const def = byId[id], group = new THREE.Group(), top = def.height * SIZE;
    group.name = def.name;
    const wood = id === 'ballista' || id === 'sniper', gold = id === 'sun' || id === 'arcane';
    const stone = id === 'ember' ? 0x3c3539 : id === 'frost' ? 0x7399a6 : id === 'venom' ? 0x52634a :
      id === 'arcane' ? 0x595574 : id === 'sun' ? 0xd9caa5 : id === 'storm' ? 0x34434b : 0x667581;
    const trim = gold ? 0xd9b875 : id === 'storm' || id === 'ember' ? 0xb88a49 : 0xa9bac1;
    part(group, 0, .12, 0, 1.96, .24, 1.96, wood ? 0x4c382d : 0x34434b);
    part(group, 0, .3, 0, 1.76, .16, 1.76, wood ? 0x987344 : stone);
    // Staggered masonry, inset joints and buttresses give the shafts depth at
    // both ground level and RTS distance. Everything stays inside its voxel.
    if (wood) {
      for (const x of [-.65, .65]) for (const z of [-.65, .65]) {
        part(group, x, (top - .5) / 2, z, .29, top - .5, .29, 0x785035);
        part(group, x, .49, z, .35, .19, .35, trim);
        if (id === 'sniper') {
          part(group, x, 3.1, z, .36, .16, .36, trim);
          const brace = part(group, x, 2.2, 0, .16, 2.4, .19, 0xb18a53); brace.rotation.x = z > 0 ? .5 : -.5;
        }
      }
      for (let y = .65; y < (id === 'sniper' ? 1 : top - .8); y += .42) {
        part(group, 0, y, .63, 1.12, .32, .17, y % .84 < .42 ? 0x987344 : 0x785035);
        part(group, 0, y, -.63, 1.12, .32, .17, 0x987344);
      }
      if (id === 'sniper') {
        for (const y of [1.2, 3.25, 4.85]) {
          part(group, 0, y, 0, 1.52, .13, 1.52, 0x987344);
          for (const z of [-.65, .65]) for (const side of [-1, 1]) {
            const brace = part(group, 0, y - .87, z, .14, 1.85, .13, 0xb18a53); brace.rotation.z = side * .65;
          }
        }
        for (let y = .65; y < 4.9; y += .42) part(group, .81, y, .05, .09, .09, .7, 0xb18a53);
        for (const z of [-.3, .4]) part(group, .81, 2.65, z, .1, 4.6, .1, 0x4c382d);
      }
    } else {
      const shaft = id === 'arcane' ? .98 : id === 'sun' ? 1.12 : 1.4;
      part(group, 0, (top - .65) / 2 + .1, 0, shaft, top - .85, shaft, id === 'storm' ? 0x34434b : stone);
      for (let row = 0; row < Math.ceil((top - 1) / .48); row++) {
        const y = .55 + row * .48;
        for (let face = 0; face < 4; face++) for (let brick = 0; brick < 2; brick++) {
          const slab = part(group, 0, y, 0, shaft * .46, .4, .085,
            [stone, id === 'ember' ? 0x55444a : id === 'sun' ? 0xe7ddbc : id === 'arcane' ? 0x77708d : id === 'storm' ? 0x526575 : 0x84949a, stone][(row + brick + face) % 3]);
          const side = (brick - .5) * shaft * .49;
          if (face % 2) { slab.position.set((face === 1 ? 1 : -1) * (shaft / 2 + .02), y, side); slab.rotation.y = Math.PI / 2; }
          else slab.position.set(side, y, (face === 0 ? 1 : -1) * (shaft / 2 + .02));
        }
      }
      for (const x of [-.74, .74]) for (const z of [-.74, .74]) {
        part(group, x, .67, z, .27, .62, .27, stone);
        if (def.height > 1) {
          part(group, x * .84, (top - .8) / 2, z * .84, .16, top - 1.15, .16, trim);
          part(group, x, .97, z, .22, .18, .22, trim);
        }
      }
      for (let y = 1.7; y < top - .8; y += 1.6) {
        part(group, 0, y, 0, shaft + .2, .16, shaft + .2, trim);
        for (const z of [-1, 1]) {
          part(group, 0, y - .55, z * (shaft / 2 + .075), .3, .55, .1, 0x34434b);
          part(group, 0, y - .55, z * (shaft / 2 + .14), .1, .34, .04, def.color, true);
        }
      }
    }
    if (id === 'frost') for (const x of [-.72, .72]) for (const z of [-.72, .72]) {
      const shard = part(group, x, 1.17, z, .22, .86, .22, 0xadd6df, false, crystal); shard.rotation.z = -x * .19;
      part(group, x * .85, 2.85, z * .85, .12, .36, .12, def.color, true, crystal);
    }
    if (id === 'storm') for (let i = 0; i < 4; i++) {
      const coil = part(group, 0, .65 + i * .61, 0, .88, .88, .1, 0xb88a49, false, hoop); coil.rotation.x = Math.PI / 2;
      for (const x of [-.78, .78]) part(group, x, .7 + i * .61, 0, .14, .22, .3, 0x9aa7ac);
    }
    if (id === 'venom') {
      part(group, 0, .49, 0, 1.85, .21, 1.85, 0x65704a);
      for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
        part(group, side * (.47 + Math.sin(i * 1.7) * .06), .7 + i * .46, -.76, .12, .48, .06, i % 2 ? 0x668545 : 0x40553c);
        if (i % 2) part(group, side * .6, .74 + i * .46, -.8, .24, .13, .07, 0x668545);
      }
    }
    if (id === 'sun') for (const x of [-.48, .48]) for (const z of [-.62, .62])
      part(group, x, 2.7, z, .08, 4.3, .08, 0xd9b875);
    const turret = new THREE.Group(); turret.name = 'Turret'; turret.position.y = top - .65; group.add(turret);
    part(turret, 0, -.25, 0, 1.88, .22, 1.88, wood ? 0x785035 : 0x34434b);
    part(turret, 0, -.09, 0, 1.56, .12, 1.56, trim);
    for (const x of [-.73, .73]) for (const z of [-.73, .73])
      part(turret, x, -.01, z, .12, .08, .12, 0xd9b875);
    const weapon = new THREE.Group(); weapon.name = 'Weapon'; turret.add(weapon);
    const animated = new THREE.Group(); animated.name = 'Mechanism'; weapon.add(animated);
    switch (id) {
      case 'ballista':
        part(weapon, 0, .06, .06, .52, .28, 1.35, 0x785035);
        for (const x of [-.3, .3]) part(weapon, x, .21, -.35, .1, .12, 1.48, trim);
        for (const side of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            const limb = part(animated, side * (.31 + i * .2), .18, -.6 + i * .15, .36, .17, .2, 0xb18a53);
            limb.rotation.y = side * -.5;
          }
          const string = part(animated, side * .38, .18, -.12, .035, .035, .91, 0xe4d5ac); string.rotation.y = side * .95;
          part(weapon, side * .55, -.05, .35, .16, .3, .38, 0x34434b);
        }
        part(weapon, 0, .3, -.48, .07, .07, 1.14, 0xe4d5ac);
        break;
      case 'mortar': case 'ember': {
        const hot = id === 'ember';
        for (const x of [-.61, .61]) {
          part(turret, x, .02, .2, .28, .46, .7, hot ? 0x55444a : 0x526575);
          part(weapon, x, .12, .05, .18, .28, .28, trim);
        }
        part(weapon, 0, .12, -.25, .83, .69, 1.35, 0x34434b);
        for (const z of [.25, -.32, -.86]) part(weapon, 0, .12, z, .94, .8, .14, trim);
        // A recessed dark bore surrounded by four separate muzzle walls.
        part(weapon, 0, .16, -1.02, .55, .49, .03, 0x171e23);
        for (const x of [-.36, .36]) part(weapon, x, .16, -1.1, .15, .7, .25, 0x526575);
        for (const y of [-.12, .44]) part(weapon, 0, y, -1.1, .6, .15, .25, 0x526575);
        if (hot) {
          for (const x of [-.43, .43]) for (let i = 0; i < 3; i++) part(weapon, x, .16, -.65 + i * .32, .035, .32, .12, def.color, true);
          for (const x of [-.78, .78]) {
            part(group, x, top - 1.3, .55, .27, .75, .3, 0x34434b);
            part(group, x, top - .85, .55, .34, .12, .37, trim);
          }
        } else {
          for (const x of [-.45, .45]) part(weapon, x, .25, .51, .13, .55, .12, 0xa9bac1);
          for (const x of [-.45, .45]) part(group, x, .48, .67, .32, .32, .32, 0x34434b);
        }
        break;
      }
      case 'frost':
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3;
          const shard = part(weapon, Math.cos(a) * .54, .04, Math.sin(a) * .54, .19, i % 2 ? .43 : .65, .19, i % 2 ? 0xadd6df : def.color, true, crystal);
          shard.rotation.z = -Math.cos(a) * .4;
        }
        part(animated, 0, .18, 0, .38, .67, .38, 0xd5f7ff, true, crystal);
        part(animated, 0, .12, 0, .51, .1, .51, trim, false, hoop);
        break;
      case 'venom':
        part(weapon, 0, .05, 0, 1.12, .45, .9, 0x40553c);
        part(weapon, 0, .38, -.08, .87, .28, .7, 0x7b8b54);
        for (const x of [-.29, .29]) {
          part(weapon, x, .25, -.48, .23, .17, .08, 0x202f2b);
          part(weapon, x, .27, -.53, .12, .08, .04, def.color, true);
          part(weapon, x, -.12, -.49, .12, .3, .16, 0xe4d5ac);
        }
        part(weapon, 0, -.07, -.48, .27, .15, .13, def.color, true);
        for (const x of [-.67, .67]) part(weapon, x, .04, .05, .18, .4, .38, 0x9b8654);
        part(animated, 0, .56, 0, .22, .18, .22, def.color, true, crystal);
        break;
      case 'storm':
        part(weapon, 0, .13, 0, .4, .6, .4, 0x34434b);
        for (let i = 0; i < 3; i++) {
          const coil = part(weapon, 0, -.02 + i * .2, 0, .64 - i * .08, .64 - i * .08, .12, 0xb88a49, false, hoop); coil.rotation.x = Math.PI / 2;
        }
        for (const x of [-.62, .62]) {
          part(weapon, x, .17, 0, .15, .72, .18, 0xa9bac1);
          part(weapon, x, .48, 0, .32, .13, .32, def.color, true);
        }
        part(animated, 0, .46, 0, .24, .24, .24, 0xd6f4ff, true, crystal);
        break;
      case 'sniper':
        for (const x of [-.72, .72]) part(turret, x, .1, .1, .13, .4, 1.27, 0x987344);
        part(weapon, 0, .04, .12, .4, .29, .95, 0x785035);
        part(weapon, 0, .16, -.49, .21, .22, 1.63, 0x34434b);
        for (const z of [-1.14, -.66, -.12]) part(weapon, 0, .16, z, .29, .3, .12, trim);
        part(weapon, 0, .16, -1.33, .13, .13, .035, 0x171e23);
        part(weapon, .13, .39, -.02, .18, .18, .56, 0x34434b);
        part(weapon, .13, .39, -.32, .12, .12, .04, 0x84d8db, true);
        part(animated, .27, .12, .32, .11, .11, .4, trim);
        break;
      case 'earth':
        for (const x of [-.64, .64]) {
          part(weapon, x, .02, -.1, .3, .5, 1.6, 0x6a624f);
          part(weapon, x, .28, -.58, .38, .15, .48, trim);
        }
        part(weapon, 0, -.08, -.2, .85, .23, 1.55, 0x34434b);
        part(animated, 0, .17, -.45, .63, .61, .65, 0x9c8b65);
        for (const x of [-.84, .84]) part(group, x, .45, .5, .22, .54, .52, 0x6a624f);
        break;
      case 'arcane':
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + Math.PI / 4;
          part(weapon, Math.cos(a) * .73, .1, Math.sin(a) * .73, .15, .48, .15, trim);
        }
        part(animated, 0, .2, 0, .42, .68, .42, def.color, true, crystal);
        for (const tilt of [-.75, .75]) {
          const orbit = part(animated, 0, .12, 0, .66, .66, .66, trim, false, hoop); orbit.rotation.set(tilt, .4, tilt);
        }
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI * 2 / 3;
          part(animated, Math.cos(a) * .68, .18, Math.sin(a) * .68, .13, .2, .13, 0xead9ff, true, crystal);
        }
        break;
      case 'sun':
        for (const x of [-.65, .65]) {
          part(weapon, x, .06, 0, .2, .6, .3, trim);
          part(weapon, x, .38, 0, .3, .1, .4, 0xfff0bb, true);
        }
        part(animated, 0, .18, 0, .24, .37, .24, 0xfff5cd, true, crystal);
        part(animated, 0, .18, 0, .48, .48, .48, trim, false, hoop);
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          const ray = part(animated, Math.cos(a) * .63, .18 + Math.sin(a) * .63, 0, .14, .28, .12, trim);
          ray.rotation.z = a - Math.PI / 2;
        }
        break;
    }
    // Bake the masonry by material once per blueprint. Instances, pickups and
    // previews reuse geometry; rotating barrels remain a separate small group.
    function bake(parent) {
      const batches = new Map();
      parent.children.slice().forEach(mesh => {
        if (!mesh.isMesh) return;
        mesh.updateMatrix();
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone(); geometry.applyMatrix4(mesh.matrix);
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
    bake(group); bake(turret); bake(weapon); bake(animated);
    if (def.style === 'shell') weapon.rotation.x = .35;
    templates.set(id, group.clone());
    group.userData.turret = turret; group.userData.weapon = weapon;
    return group;
  }
  function itemDefinition(kind) { return typeof kind === 'string' && kind.startsWith('tower_') ? byId[kind.slice(6)] || null : null; }
  function atCell(bx, by, bz) { return cells.get(bx + ',' + by + ',' + bz) || null; }
  function inventoryCount(id) {
    let count = M.items.count('tower_' + id);
    if (id === 'frost') for (let tier = 1; tier <= 3; tier++) count += M.items.count('tower_builder_frost_' + tier);
    return count;
  }
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
  function construct(id, bx, by, bz, pay) {
    const def = byId[id];
    if (!scene || !def || M.hearthTree.health <= 0 || !site(id, bx, by, bz).valid) return false;
    // Validate every cell and both balances before editing or spending.
    const tower = { id, bx, by, bz, def, cooldown: .25, kills: 0, shots: 0, fireAge: 10, group: model(id) };
    for (let y = by; y < by + def.height; y++) {
      if (!M.world.placeBlock('stone', bx, y, bz)) {
        for (let old = by; old < y; old++) M.world.breakBlockAt(bx, old, bz, { drop: false, towerInternal: true });
        return false;
      }
    }
    pay();
    tower.group.position.set((bx + .5) * SIZE, by * SIZE, (bz + .5) * SIZE);
    tower.position = tower.group.position;
    for (let y = by; y < by + def.height; y++) cells.set(bx + ',' + y + ',' + bz, tower);
    scene.add(tower.group); list.push(tower);
    if (M.audio && M.audio.pickup) M.audio.pickup();
    return tower;
  }
  function place(id, bx, by, bz, inventoryOnly) {
    // The Frost card can redeploy trained variants too, preserving their rank.
    if (id === 'frost' && !M.items.count('tower_frost')) {
      for (let tier = 3; tier >= 1; tier--) if (M.items.count('tower_builder_frost_' + tier)) {
        id = 'builder_frost_' + tier; break;
      }
    }
    const def = byId[id];
    if (!def) return false;
    const owned = inventoryCount(id) > 0;
    if (inventoryOnly && !owned || !owned && (def.builderTier || !M.upgrades.canAfford(def.cost))) return false;
    return construct(id, bx, by, bz, function () {
      if (owned) M.items.spend({ ['tower_' + id]: 1 });
      else { M.enemies.spendCoins(def.cost.coins); M.items.spend(def.cost); }
    });
  }
  function builderDefinition(animal) {
    if (!animal || animal.role !== 'builder' || !M.animals || !M.animals.list.includes(animal) || !M.upgrades || !M.upgrades.level) return null;
    return byId['builder_frost_' + M.upgrades.level(animal, 'craft')] || null;
  }
  function placeBuilder(animal, bx, by, bz) {
    const def = builderDefinition(animal), s = animal && animal.state;
    if (!def || !s || !(s.coins >= def.cost.coins && s.towerStone >= def.cost.stone)) return false;
    const tower = construct(def.id, bx, by, bz, function () { s.coins -= def.cost.coins; s.towerStone -= def.cost.stone; });
    if (tower) tower.builder = animal;
    return tower;
  }
  function trainBuilder(animal) {
    const def = builderDefinition(animal);
    if (!def) return;
    for (const tower of list) if (tower.builder === animal && tower.def.builderTier < def.builderTier) {
      const previous = tower.group;
      tower.id = def.id; tower.def = def; tower.group = model(def.id);
      tower.group.position.copy(tower.position); tower.position = tower.group.position;
      tower.mechanism = null; tower.cooldown = Math.min(tower.cooldown, def.interval);
      scene.remove(previous); scene.add(tower.group);
    }
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
  const MAX_PROJECTILES = 256, MAX_EFFECTS = 80;
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
  // Two persistent GPU batches carry all soft particles. Slot reuse keeps a
  // full arena from allocating hundreds of meshes or materials every frame.
  const particlePools = [];
  const particleColor = new THREE.Color();
  function particlePool(smoke, capacity) {
    const geometry = new THREE.BufferGeometry(), slots = [], free = [];
    for (const [name, width] of [['position', 3], ['color', 3], ['size', 1], ['alpha', 1]])
      geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(capacity * width), width).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
      uniforms: { viewport: { value: 800 } },
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color;
        uniform float viewport; varying vec3 tint; varying float opacity;
        void main() {
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * view;
          gl_PointSize = clamp(size * viewport * projectionMatrix[1][1] / max(1.0, -2.0 * view.z), 1.0, 160.0);
          tint = color; opacity = view.z < 0.0 ? alpha : 0.0;
        }`,
      fragmentShader: `varying vec3 tint; varying float opacity;
        void main() {
          float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float soft = pow(max(0.0, 1.0 - r * r), ${smoke ? '2.0' : '3.0'});
          gl_FragColor = vec4(tint, soft * opacity);
          #include <encodings_fragment>
        }`
    });
    const points = new THREE.Points(geometry, mat); points.frustumCulled = false;
    points.name = smoke ? 'Tower smoke particles' : 'Tower glow particles'; points.renderOrder = smoke ? 2 : 3;
    for (let i = 0; i < capacity; i++) { slots.push({ life: 0 }); free.push(i); }
    const pool = { smoke, geometry, points, slots, free }; particlePools.push(pool); scene.add(points); return pool;
  }
  function particle(point, color, size, life, vx, vy, vz, smoke, gravity) {
    if (M.config.reducedMotion || !particlePools.length) return;
    const pool = particlePools[smoke ? 1 : 0], i = pool.free.pop();
    if (i === undefined) return;
    const p = pool.slots[i];
    Object.assign(p, { x: point.x, y: point.y, z: point.z, vx: vx || 0, vy: vy || 0, vz: vz || 0,
      size, life, duration: life, gravity: gravity || 0 });
    particleColor.setHex(color);
    pool.geometry.attributes.color.setXYZ(i, particleColor.r, particleColor.g, particleColor.b);
  }
  function updateParticles(dt) {
    for (const pool of particlePools) {
      const a = pool.geometry.attributes;
      // Physical pixels keep the same world-space diameter on Retina screens.
      pool.points.material.uniforms.viewport.value = (window.innerHeight || 800) * Math.min(window.devicePixelRatio || 1, 2);
      for (let i = 0; i < pool.slots.length; i++) {
        const p = pool.slots[i]; if (p.life <= 0) continue;
        p.life = M.config.reducedMotion ? 0 : Math.max(0, p.life - dt);
        if (!p.life) { a.alpha.setX(i, 0); pool.free.push(i); continue; }
        const k = 1 - p.life / p.duration, drag = Math.exp(-dt * (pool.smoke ? 1.3 : 1.8));
        p.vx *= drag; p.vz *= drag; p.vy += p.gravity * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        a.position.setXYZ(i, p.x, p.y, p.z);
        a.size.setX(i, p.size * (pool.smoke ? .5 + k * 1.8 : 1 - k * .65));
        a.alpha.setX(i, (pool.smoke ? .3 : .9) * Math.min(1, (1 - k) * 4) * (1 - k));
      }
      for (const attr of Object.values(a)) attr.needsUpdate = true;
    }
  }
  function spray(point, colors, count, speed, size, life, smoke, gravity) {
    for (let i = 0; i < count; i++) {
      const angle = i * 2.39996 + Math.random() * .4, reach = speed * (.4 + Math.random() * .6);
      particle(point, colors[i % colors.length], size * (.6 + Math.random() * .8), life * (.7 + Math.random() * .6),
        Math.cos(angle) * reach, speed * (.2 + Math.random() * .8), Math.sin(angle) * reach, smoke, gravity);
    }
  }
  const lightningMaterial = new THREE.LineBasicMaterial({ color: 0xb6e9ff, transparent: true, opacity: .85,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  function lightning(from, to) {
    if (M.config.reducedMotion || effects.length >= MAX_EFFECTS) return;
    const g = new THREE.Group(), points = [], delta = to.clone().sub(from), side = new THREE.Vector3(-delta.z, 0, delta.x).normalize();
    for (let i = 0; i <= 12; i++) {
      const k = i / 12, offset = i === 0 || i === 12 ? 0 : (Math.random() - .5) * .65;
      points.push(from.clone().addScaledVector(delta, k).addScaledVector(side, offset).add(new THREE.Vector3(0, offset * .5, 0)));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points), line = new THREE.Line(geometry, lightningMaterial);
    g.name = 'Storm afterimage'; g.add(line);
    addEffect(g, .14, k => { line.visible = k < .8; });
    // This geometry belongs to the short-lived arc, unlike shared burst shapes.
    g.userData.disposeGeometry = geometry;
  }
  function muzzle(tower, point, aim) {
    if (M.config.reducedMotion || effects.length >= MAX_EFFECTS) return;
    const id = tower.def.baseId || tower.id, color = tower.def.color, g = new THREE.Group();
    const forward = aim.clone().sub(point).normalize();
    const palette = id === 'ember' || id === 'mortar' ? [0xffdb7c, 0xff8b36, 0xffedba] : [color, 0xecfaff];
    for (let i = 0; i < (id === 'ballista' ? 5 : 15); i++) {
      const speed = 1.5 + Math.random() * 4;
      particle(point, palette[i % palette.length], .14 + Math.random() * .22, .18 + Math.random() * .2,
        forward.x * speed + (Math.random() - .5) * 2, forward.y * speed + (Math.random() - .5) * 2,
        forward.z * speed + (Math.random() - .5) * 2, false, id === 'venom' ? -4 : -1);
    }
    if (['mortar', 'ember', 'sniper', 'earth'].includes(id))
      spray(point, id === 'earth' ? [0x9c8b65] : [0x777980, 0xa4a29d], 5, .9, .7, .65, true, .5);
    particle(point, palette[0], id === 'sniper' ? 1 : 1.65, .16, 0, 0, 0);
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
    const coreScale = core.scale.clone();
    addEffect(g, id === 'sun' ? .32 : .22, k => {
      core.scale.copy(coreScale).multiplyScalar(1 - k);
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
    const heavy = ['mortar', 'earth', 'ember'].includes(id), duration = heavy ? .85 : .6;
    const colors = id === 'mortar' ? [0xffd783, 0xff853d, 0x62645a] :
      id === 'earth' ? [0x9d8963, 0x71644d, 0xc0b17a] :
      id === 'ember' ? [0xffdc70, 0xff853d, 0xc94325] : [def.color, 0xf3fbff, def.color];
    const kinetic = id === 'ballista' || id === 'sniper' || id === 'earth';
    spray(point, colors, heavy ? 36 : 20, heavy ? 5 : 3, heavy ? .28 : .18, heavy ? .7 : .5, false, kinetic ? -6 : -.8);
    particle(point, colors[0], heavy ? 3.5 : 1.8, .22, 0, 0, 0);
    if (heavy) spray(point, id === 'earth' ? [0x9c8b65, 0xbaa987] : [0x646771, 0x9b9492], 12, 1.6, 1.2, 1.05, true, .8);
    if (id === 'venom') spray(point, [0x6eac38, 0xa4d85a], 10, .8, .85, 1.2, true, 1.4);
    if (id === 'frost') spray(point, [0xadd9e8, 0xe0faff], 8, 1.5, .7, .9, true, -.3);
    for (let i = 0; i < (heavy ? 12 : 8); i++) {
      const angle = i * 2.39996, size = heavy ? .22 + i % 3 * .1 : .12;
      const mesh = kinetic || id === 'mortar' ? part(g, 0, 0, 0, size, size, size, colors[i % 3]) :
        fxPart(g, colors[i % 3], 0, 0, 0, size, size, size, ['frost', 'arcane', 'venom'].includes(id) ? ice : cube);
      if (id === 'ballista' || id === 'sniper') mesh.scale.set(.04, .04, .35);
      if (id === 'frost') mesh.scale.set(.09, .35, .09);
      pieces.push({ mesh, x: Math.cos(angle) * (heavy ? 3.5 : 2), z: Math.sin(angle) * (heavy ? 3.5 : 2), y: 1.3 + i % 4 * .6 });
    }
    let halo, secondHalo;
    if (heavy || ['frost', 'venom', 'sun'].includes(id)) {
      halo = fxPart(g, def.color, 0, wall ? 0 : groundY - point.y + .12, 0, .15, .15, .15, ring);
      halo.rotation.x = Math.PI / 2;
      if (heavy || id === 'sun') {
        secondHalo = fxPart(g, id === 'earth' ? 0x9c8b65 : 0xffefc5, 0, wall ? 0 : groundY - point.y + .14, 0, .15, .15, .15, ring);
        secondHalo.rotation.x = Math.PI / 2;
      }
    }
    const spikes = [];
    if (id === 'frost' || id === 'sun' || id === 'arcane' || id === 'earth') for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, r = id === 'earth' ? 1.1 : .7;
      const spike = id === 'earth' ? part(g, Math.cos(a) * r, -.1, Math.sin(a) * r, .22, .55, .22, 0x9c8b65) :
        fxPart(g, colors[i % 3], Math.cos(a) * r, wall ? 0 : groundY - point.y + .1, Math.sin(a) * r, .1, .65, .1, ice);
      spike.rotation.z = Math.cos(a) * -.4; spikes.push(spike);
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
      if (secondHalo) { const r = .1 + Math.max(0, k - .15) * (def.splash || 1.8) * 1.15; secondHalo.scale.set(r, r, (1 - k) * .7); }
      spikes.forEach((spike, i) => {
        const swell = Math.sin(Math.min(1, k * 2) * Math.PI / 2) * (1 - k);
        spike.scale.y = swell * (id === 'frost' ? .95 : .55);
        spike.position.x = Math.cos(i * Math.PI / 4) * (.7 + k * (id === 'arcane' ? -.6 : 1.1));
        spike.position.z = Math.sin(i * Math.PI / 4) * (.7 + k * (id === 'arcane' ? -.6 : 1.1));
      });
      if (id === 'storm') g.rotation.y = Math.sin(k * 50) * .6;
      if (id === 'sun') g.rotation.y = k * 2;
    });
  }
  function trail(p, from, to) {
    if (M.config.reducedMotion) return;
    const id = p.id, smoke = id === 'mortar' || id === 'earth';
    const distance = from.distanceTo(to), count = Math.min(20, Math.ceil(distance / (smoke ? .35 : .22)));
    const point = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      point.lerpVectors(from, to, i / count);
      const color = id === 'earth' ? 0x9c8b65 : id === 'mortar' ? 0x8d8c88 :
        id === 'ember' ? (i % 2 ? 0xffa73c : 0xff5026) : p.tower.def.color;
      const size = smoke ? .55 : id === 'ember' ? .42 : id === 'sun' ? .23 : .15;
      particle(point, color, size, smoke ? .65 : id === 'sun' || id === 'sniper' ? .16 : .32,
        (Math.random() - .5) * .25, id === 'venom' || id === 'ember' ? .45 : .08, (Math.random() - .5) * .25, smoke, smoke ? .35 : 0);
      if (id === 'ember' || id === 'mortar') particle(point, 0xffd16c, .13, .32,
        (Math.random() - .5) * 1.4, .5, (Math.random() - .5) * 1.4, false, -1.5);
      if (id === 'arcane' || id === 'frost') {
        const a = p.age * 18 + i * .6;
        point.x += Math.cos(a) * .22; point.y += Math.sin(a) * .22;
        particle(point, 0xeffaff, .1, .25, 0, 0, 0);
      }
    }
  }
  const projectileTemplates = new Map();
  function projectileModel(id) {
    if (projectileTemplates.has(id)) return projectileTemplates.get(id).clone();
    const g = new THREE.Group(); g.name = byId[id].name + ' projectile';
    const color = byId[id].color;
    switch (id) {
      case 'ballista':
        part(g, 0, 0, 0, .09, .09, 1.25, 0xb18a53);
        part(g, 0, 0, .65, .18, .18, .3, 0xa9bac1, false, ice);
        for (const x of [-.12, .12]) part(g, x, 0, -.44, .23, .035, .33, 0xe4d5ac);
        part(g, 0, .12, -.44, .035, .23, .33, 0xe4d5ac);
        break;
      case 'mortar':
        part(g, 0, 0, 0, .5, .5, .5, 0x34434b);
        for (const z of [-.16, .16]) part(g, 0, 0, z, .54, .54, .08, 0xb88a49);
        part(g, 0, .31, 0, .06, .16, .06, 0x785035);
        fxPart(g, 0xffd37e, 0, .4, 0, .1, .1, .1, ice);
        break;
      case 'frost':
        fxPart(g, 0xd6ffff, 0, 0, .1, .22, .22, .85, ice);
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI * 2 / 3;
          fxPart(g, color, Math.cos(a) * .23, Math.sin(a) * .23, -.18, .13, .13, .52, ice);
        }
        break;
      case 'ember':
        fxPart(g, 0xffdf75, 0, 0, 0, .4, .4, .5, ice);
        for (let i = 0; i < 3; i++) fxPart(g, i === 1 ? 0xffa431 : 0xf45e26, (i - 1) * .18, 0, -.3 - i * .08, .23, .23, .65, ice);
        break;
      case 'venom':
        fxPart(g, color, 0, 0, 0, .42, .42, .42, ice);
        part(g, 0, 0, .02, .24, .24, .28, 0x40553c, false, ice);
        for (let i = 0; i < 3; i++) fxPart(g, 0xd7f77a, Math.cos(i * 2.1) * .25, Math.sin(i * 2.1) * .25, -.15, .15, .15, .15);
        break;
      case 'storm':
        fxPart(g, 0xecfaff, 0, 0, .1, .16, .16, .5, ice);
        for (let i = 0; i < 6; i++) fxPart(g, i % 2 ? color : 0xffffff, 0, 0, -.2 - i * .24, .07, .07, .35);
        break;
      case 'sniper':
        fxPart(g, 0xfff2c4, 0, 0, .25, .08, .08, 1.2);
        fxPart(g, color, 0, 0, -.65, .035, .035, 1.3);
        fxPart(g, 0xfffaf0, 0, 0, .9, .12, .12, .28, ice);
        break;
      case 'earth':
        part(g, 0, 0, 0, .8, .75, .8, 0x6a624f);
        for (let i = 0; i < 5; i++) {
          const rock = part(g, Math.cos(i * 2.1) * .28, .13, Math.sin(i * 2.1) * .28, .43, .43, .43, i % 2 ? 0x9c8b65 : 0xc0b17a);
          rock.rotation.set(i * .4, i, .3);
        }
        fxPart(g, color, 0, .38, 0, .49, .025, .06);
        break;
      case 'arcane':
        fxPart(g, 0xeee3ff, 0, 0, .1, .18, .18, .5, ice);
        for (let i = 0; i < 3; i++) {
          const a = i * Math.PI * 2 / 3;
          fxPart(g, color, Math.cos(a) * .27, Math.sin(a) * .27, -.12, .15, .15, .35, ice);
        }
        fxPart(g, color, 0, 0, -.1, .38, .38, .38, ring);
        break;
      case 'sun':
        fxPart(g, 0xffffe7, 0, 0, 0, .13, .13, 1.8);
        for (const z of [-.6, .3]) fxPart(g, color, 0, 0, z, .32, .32, .32, ring);
        for (let i = 0; i < 4; i++) {
          const ray = fxPart(g, color, 0, 0, -.25, .035, .035, 1.1); ray.position.x = Math.cos(i * Math.PI / 2) * .14; ray.position.y = Math.sin(i * Math.PI / 2) * .14;
        }
        break;
    }
    projectileTemplates.set(id, g.clone()); return g;
  }
  const flight = {
    ballista: { speed: 26 }, mortar: { speed: 14, arc: 5 }, frost: { speed: 19, homing: true },
    ember: { speed: 18, arc: 2.5 }, venom: { speed: 15, homing: true }, storm: { speed: 72, homing: true },
    sniper: { speed: 64 }, earth: { speed: 12, arc: 3 }, arcane: { speed: 27, homing: true }, sun: { speed: 44 }
  };
  function launch(tower, target, origin, visited) {
    if (projectiles.length >= MAX_PROJECTILES) return false;
    const id = tower.def.baseId || tower.id, spec = flight[id], aim = aimAt(target);
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
    if (p.id === 'frost') p.mesh.rotateZ(t * 7);
    if (p.id === 'ember') { p.mesh.rotateZ(t * 9); p.mesh.scale.setScalar(1 + Math.sin(t * 24) * .12); }
    if (p.id === 'venom') { p.mesh.scale.set(1 + Math.sin(t * 13) * .13, 1 - Math.sin(t * 13) * .13, 1); p.mesh.rotateZ(t * 3); }
    if (p.id === 'storm') children.slice(1).forEach((m, i) => {
      m.position.x = Math.sin(t * 95 + i * 2.4) * .18; m.rotation.y = Math.sin(t * 80 + i) * .65;
    });
    if (p.id === 'arcane') p.mesh.rotateZ(t * 17);
    if (p.id === 'sun') p.mesh.rotateZ(t * 6);
  }
  function flightEffects(p, from, to, dt, impact) {
    trail(p, from, to);
    p.trailTime += dt;
    if (p.id === 'storm' && (impact || p.trailTime >= .045)) {
      p.trailTime = 0; lightning(p.origin, to);
    }
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
      if (!p.tower.def.pierce || p.hits.size >= 3) { flightEffects(p, from, point, dt, true); p.position.copy(point); return true; }
    }
    if (wallT !== Infinity) {
      p.position.lerpVectors(from, to, wallT); flightEffects(p, from, p.position, dt, true); impact(p, p.position, null, true); return true;
    }
    // Face the instantaneous ballistic tangent rather than the original aim.
    if (to.distanceToSquared(from) > .000001) p.direction.copy(to).sub(from).normalize();
    flightEffects(p, from, to, dt, finished);
    p.position.copy(to);
    if (finished || p.age > 5) {
      if (p.tower.def.splash) impact(p, to, null, false);
      return true;
    }
    animateFlight(p, dt); return false;
  }
  function shoot(tower) {
    if (projectiles.length >= MAX_PROJECTILES) return false;
    const def = tower.def, center = tower.position.clone(), id = def.baseId || tower.id; center.y += def.height * SIZE - .4;
    const enemies = M.enemies.zombies.filter(e => alive(e) && Math.hypot(e.position.x - center.x, e.position.z - center.z) <= def.range &&
      Math.abs(e.position.y - tower.position.y) < 15);
    enemies.sort((a, b) => a.position.lengthSq() - b.position.lengthSq());
    const target = enemies.find(e => lineClear(center, aimAt(e), tower));
    if (!target) return false;
    const aim = aimAt(target), turret = tower.group.userData.turret;
    turret.rotation.y = Math.atan2(center.x - aim.x, center.z - aim.z);
    const weapon = tower.group.userData.weapon;
    if (def.style === 'bolt' || def.style === 'shell') {
      const rise = (flight[id].arc ? target.position.y + .15 + Math.PI * flight[id].arc : aim.y) - center.y;
      weapon.rotation.x = Math.atan2(rise, Math.hypot(aim.x - center.x, aim.z - center.z));
    }
    const origin = new THREE.Vector3(0, .16, def.style === 'bolt' || def.style === 'shell' ? (def.id === 'sniper' ? -1.36 : -1.12) : 0);
    tower.group.updateMatrixWorld(true); weapon.localToWorld(origin);
    if (!lineClear(center, origin, tower) || !launch(tower, target, origin)) return false;
    tower.fireAge = 0; muzzle(tower, origin, aim);
    if (M.audio && M.audio.towerShot) M.audio.towerShot(origin, def.style, id);
    tower.shots++; return true;
  }
  function animateTower(tower, dt) {
    tower.fireAge += dt;
    const weapon = tower.group.userData.weapon, def = tower.def;
    const id = def.baseId || def.id;
    const k = Math.max(0, 1 - tower.fireAge / (def.id === 'earth' ? .5 : .3));
    const recoil = Math.sin(k * Math.PI * .8) * k;
    weapon.position.z = (def.id === 'sniper' ? .48 : def.style === 'shell' ? .32 : .13) * recoil;
    weapon.position.y = def.id === 'earth' ? -recoil * .15 : def.style === 'crystal' ? recoil * .18 : 0;
    weapon.scale.setScalar(1 + (def.style === 'crystal' || def.style === 'coil' ? recoil * .18 : 0));
    weapon.rotation.z = def.id === 'ballista' ? recoil * .035 : 0;
    const mechanism = tower.mechanism || (tower.mechanism = weapon.getObjectByName('Mechanism'));
    const t = visualTime + tower.bx * .7 + tower.bz * .4;
    const charge = 1 - M.utils.clamp(tower.cooldown / def.interval, 0, 1);
    if (mechanism) {
      if (def.id === 'arcane') { mechanism.rotation.y = t * .8; mechanism.position.y = Math.sin(t * 2) * .055; }
      if (id === 'frost') { mechanism.rotation.y = -t * .4; mechanism.position.y = Math.sin(t * 1.8) * .055; }
      if (def.id === 'sun') mechanism.rotation.z = t * .22;
      if (def.id === 'storm' || def.id === 'venom') mechanism.scale.setScalar(1 + Math.sin(t * 4) * .07 + charge * .12);
      if (def.id === 'ballista') mechanism.scale.x = 1 - recoil * .18;
      if (def.id === 'earth') mechanism.visible = tower.fireAge > .45;
      if (def.id === 'sniper') mechanism.position.z = recoil * .3;
    }
    if (M.config.reducedMotion) {
      weapon.position.set(0, 0, 0); weapon.scale.setScalar(1); weapon.rotation.z = 0;
      if (mechanism) { mechanism.rotation.set(0, 0, 0); mechanism.position.set(0, 0, 0); mechanism.scale.setScalar(1); mechanism.visible = true; }
      return;
    }
    tower.particleTime = (tower.particleTime || 0) + dt;
    if (tower.particleTime > .35 && ['frost', 'ember', 'venom', 'storm', 'arcane', 'sun'].includes(id)) {
      tower.particleTime = 0;
      const point = new THREE.Vector3(Math.cos(t * 2) * .4, .3, Math.sin(t * 2) * .4);
      tower.group.updateMatrixWorld(true); weapon.localToWorld(point);
      particle(point, def.color, id === 'ember' ? .2 : .11, .65, 0, id === 'frost' ? -.28 : .4, 0);
      if (def.id === 'ember') particle(point, 0x68616a, .55, .9, .08, .45, 0, true, .3);
      if (def.id === 'storm') {
        const left = weapon.localToWorld(new THREE.Vector3(-.62, .48, 0));
        const right = weapon.localToWorld(new THREE.Vector3(.62, .48, 0)); lightning(left, right);
      }
    }
  }
  function update(dt) {
    visualTime += dt;
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
      // Lingering effects stay attached to the victim, even after the source
      // tower is packed. This makes slow, burn and poison readable in a crowd.
      if (!M.config.reducedMotion && alive(enemy)) {
        enemy.towerParticleTime = (enemy.towerParticleTime || 0) + dt;
        if (enemy.towerParticleTime > .18) {
          enemy.towerParticleTime = 0;
          const point = enemy.position.clone();
          point.x += (Math.random() - .5) * .6; point.z += (Math.random() - .5) * .6;
          if (enemy.towerDots && enemy.towerDots.ember) {
            point.y += .4;
            particle(point, 0xffa336, .28, .5, 0, 1.3, 0, false, .3);
            particle(point, 0x77727a, .5, .8, .1, .6, 0, true, .4);
          }
          if (enemy.towerDots && enemy.towerDots.venom) {
            point.y += enemy.body.height * .5;
            particle(point, 0xb2e866, .17, .8, .1, .7, 0);
          }
          if (enemy.towerSlowTime > 0 && enemy.towerSlow === .55) {
            point.y = enemy.position.y + .15;
            particle(point, 0xb4edff, .17, .6, .1, .2, -.1);
          }
        }
      }
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
      if (k >= 1) {
        scene.remove(effect.group);
        if (effect.group.userData.disposeGeometry) effect.group.userData.disposeGeometry.dispose();
        effects.splice(i, 1);
      }
    }
    updateParticles(dt);
  }
  M.towers = { definitions, byId, list, atCell, site, place, dismantle, available, inventoryCount, itemDefinition, localTarget,
    builderDefinition, placeBuilder, trainBuilder,
    model, lineClear, maxTowers: MAX_TOWERS, init: function (value) {
      scene = value;
      if (!particlePools.length) { particlePool(false, 900); particlePool(true, 220); }
    }, update };
})(window.Meadow = window.Meadow || {});
