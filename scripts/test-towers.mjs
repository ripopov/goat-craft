import assert from 'node:assert/strict';
import test from 'node:test';
import { game } from './helpers/animal-game.mjs';

function defense(rich = true, renderRadius = 0) {
  // Most tower checks stay in the initial chunk. Load neighboring chunks only
  // for the negative-coordinate case; avoid rendering irrelevant forest.
  const fixture = game({ renderRadius }), { M, load, scene } = fixture;
  load('js/coin-model.js'); load('js/inventory.js'); load('js/items.js'); M.items.init(scene); load('js/upgrades.js'); load('js/towers.js'); M.towers.init(scene);
  M.goat.group.position.set(-25, 14, -25);
  M.animals.list.forEach((animal, i) => animal.group.position.set(-25 + i * 3, 14, -20));
  if (rich) {
    M.enemies.addCoins(1000);
    for (const kind of ['log', 'stone', 'dirt', 'coal', 'iron', 'copper']) M.items.addItem(kind, 100);
  }
  return fixture;
}
function step(M, duration) { for (let i = 0; i < duration * 60; i++) M.towers.update(1 / 60); }

test('a fresh run has to earn resources before purchasing any tower', () => {
  const { M } = defense(false);
  assert.equal(M.enemies.getState().coins, 0);
  for (const def of M.towers.definitions) {
    assert.equal(M.towers.available(def), false);
    assert.equal(M.towers.place(def.id, 8, 7, 8), false);
  }
  assert.equal(M.towers.list.length, 0);
  for (const kind of ['log', 'stone', 'dirt', 'coal', 'iron', 'copper']) assert.equal(M.items.count(kind), 0);
});

test('all ten blueprints buy real 1–3 block towers and debit the complete price', () => {
  const { M } = defense();
  assert.equal(M.towers.definitions.length, 10);
  for (const def of Object.values(M.towers.byId)) {
    for (const [y, multiplier] of [[-10, 1], [14, 1], [15.99, 1], [16, 1.2], [17.99, 1.2], [18, 1.4], [20, 1.6], [32, 2.8]]) {
      assert.ok(Math.abs(M.towers.rangeAt(def, y) - def.range * multiplier) < 1e-9, def.id + ' range at Y ' + y);
    }
  }
  const premium = {
    ember: [1, { coins: 18, stone: 3, coal: 2 }],
    storm: [1.2, { coins: 24, stone: 3, copper: 2 }],
    sniper: [3.5, { coins: 22, log: 4, iron: 2 }],
    arcane: [.8, { coins: 32, stone: 4, copper: 3 }],
    sun: [2.5, { coins: 45, stone: 5, iron: 3, coal: 2 }]
  };
  for (const [id, [damage, cost]] of Object.entries(premium)) {
    const def = M.towers.byId[id];
    assert.ok(Math.abs(def.damage - damage * 1.5) < 1e-9, id + ' has 50% more direct damage');
    for (const [kind, amount] of Object.entries(cost)) assert.equal(def.cost[kind], Math.ceil(amount * 1.5), id + ' price');
  }
  assert.equal(M.towers.byId.ember.dot, .75, 'burn also gains 50% damage');
  assert.equal(M.towers.byId.ballista.cost.coins, 6);
  assert.equal(M.towers.byId.frost.cost.coins, 12);
  assert.equal(M.towers.byId.venom.cost.coins, 15);
  assert.equal(M.towers.byId.earth.cost.coins, 16);
  assert.equal(M.towers.byId.mortar.cost.coins, 14);
  M.towers.definitions.forEach((def, i) => {
    const before = M.enemies.getState().coins;
    const resources = Object.fromEntries(Object.keys(def.cost).filter(k => k !== 'coins').map(k => [k, M.items.count(k)]));
    const bx = 6 + (i % 5) * 2, bz = 7 + Math.floor(i / 5) * 2;
    const tower = M.towers.place(def.id, bx, 7, bz);
    assert.ok(tower, def.name);
    assert.equal(M.enemies.getState().coins, before - def.cost.coins);
    for (const [kind, count] of Object.entries(resources)) assert.equal(M.items.count(kind), count - def.cost[kind]);
    for (let y = 7; y < 7 + def.height; y++) {
      assert.equal(M.towers.atCell(bx, y, bz), tower);
      assert.ok(M.world.blockInfoAt(bx, y, bz)?.placed);
      assert.equal(M.world.canPlaceBlock(bx, y, bz), false);
    }
    assert.ok(def.height >= 1 && def.height <= 3);
  });
});

test('blocked cells, dry foundations, occupied actors, arena limits and balances reject without charging', () => {
  const { M } = defense(false);
  M.enemies.addCoins(6);
  assert.equal(M.towers.place('ballista', 8, 7, 8), false, 'missing wood');
  assert.equal(M.enemies.getState().coins, 6);
  M.items.addItem('log', 2);
  const blocked = M.world.placeBlock('stone', 8, 8, 8); assert.equal(blocked, true);
  assert.equal(M.towers.place('sniper', 8, 7, 8), false, 'upper cell blocked');
  assert.equal(M.towers.place('ballista', 8, 10, 8), false, 'floating');
  assert.equal(M.towers.place('ballista', 120, 7, 8), false, 'beyond arena');
  assert.equal(M.towers.place('ballista', .5, 7, 8), false);
  M.goat.group.position.set(17, 14, 17);
  assert.equal(M.towers.place('ballista', 8, 7, 8), false, 'goat collision');
  M.goat.group.position.set(-25, 14, -25);
  const waterAt = M.world.waterAt; M.world.waterAt = () => ({ level: 17 });
  assert.equal(M.towers.place('ballista', 8, 7, 8), false, 'water'); M.world.waterAt = waterAt;
  assert.equal(M.items.count('log'), 2); assert.equal(M.enemies.getState().coins, 6);
  assert.equal(M.towers.place('unknown', 8, 7, 8), false);
});

test('mining any tower cell produces one persistent pickup; collection and redeployment cost no resources', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('sniper', 8, 7, 8);
  assert.ok(tower);
  assert.equal(M.world.breakBlockAt(8, 9, 8), 'tower_sniper');
  assert.equal(M.towers.list.length, 0);
  for (let y = 7; y <= 9; y++) assert.equal(M.world.blockInfoAt(8, y, 8), null);
  assert.equal(M.items.drops.length, 1);
  const drop = M.items.drops[0];
  assert.equal(drop.userData.drop.kind, 'tower_sniper'); assert.equal(drop.userData.drop.persistent, true);
  const collector = new THREE.Group(); collector.position.copy(drop.position); collector.position.y -= .9;
  for (let i = 0; i < 40; i++) M.items.update(.05, i * .05, collector);
  assert.equal(M.items.count('tower_sniper'), 1); assert.equal(M.items.drops.length, 0);
  const balance = M.enemies.getState().coins, wood = M.items.count('log');
  const moved = M.towers.place('sniper', 10, 7, 8, true);
  assert.ok(moved); assert.equal(M.items.count('tower_sniper'), 0);
  assert.equal(M.enemies.getState().coins, balance); assert.equal(M.items.count('log'), wood);
  assert.equal(M.towers.place('sniper', 12, 7, 8, true), false, 'inventory-only cannot buy a fresh tower');
});

test('packed towers stay collectible when inventory is full and foundations cannot leave floating cannons', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('frost', 8, 7, 8);
  assert.equal(M.world.breakBlockAt(8, 7, 8, { protectPlaced: true }), null);
  assert.equal(M.towers.list.includes(tower), true);
  M.world.breakBlockAt(8, 6, 8); M.towers.update(.02);
  assert.equal(M.towers.list.length, 0);
  const packed = M.items.drops.find(d => d.userData.drop.kind === 'tower_frost'); assert.ok(packed);
  for (let i = 1; i < M.items.slots.length; i++) M.items.slots[i] = { kind: 'stone', count: 1, name: 'Stone' };
  const collector = new THREE.Group(); collector.position.copy(packed.position); collector.position.y -= .9;
  M.items.update(.01, 0, collector);
  assert.ok(M.items.drops.includes(packed), 'full inventory retains physical tower');
});

test('cannons auto-target within range, obey walls and award normal physical coin loot', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('ballista', 8, 7, 8);
  const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 23)); assert.ok(enemy);
  step(M, .3); assert.equal(enemy.hp, 8, 'launch does not damage'); assert.equal(tower.shots, 1);
  step(M, .2); assert.equal(enemy.hp, 7, 'bolt arrival damages');
  step(M, 8.3); assert.equal(enemy.hp, 0); assert.equal(tower.kills, 1);
  assert.equal(M.items.drops.filter(d => d.userData.drop.kind === 'coin').length, 1);
  const blocked = M.enemies.spawnAt(new THREE.Vector3(17, 14, 25));
  for (let y = 7; y < 12; y++) M.world.placeBlock('stone', 8, y, 10);
  step(M, 3); assert.equal(blocked.hp, 8, 'wall blocks tower shots');
  const far = M.enemies.spawnAt(new THREE.Vector3(45, 14, 17)); assert.ok(far);
  step(M, 3); assert.equal(far.hp, 8, 'out of range');
});

test('frost slows actual walking, poison and fire linger, and splash / chain / beam hit groups', () => {
  // These independent shots share the same arena. Pack each source, remove
  // its targets and drain effects rather than generating eight full forests.
  const { M, THREE } = defense();
  for (const id of ['frost', 'venom', 'ember', 'mortar', 'storm', 'sun', 'earth', 'arcane']) {
    const tower = M.towers.place(id, 8, 7, 8); assert.ok(tower);
    const a = M.enemies.spawnAt(new THREE.Vector3(17, 14, 23), 'brute');
    const b = M.enemies.spawnAt(new THREE.Vector3(id === 'sun' ? 17 : id === 'venom' ? 18 : 19, 14, 24), 'brute');
    const initial = a.hp; step(M, 1.1);
    assert.ok(a.hp < initial, id + ' attacks');
    if (id === 'mortar' || id === 'earth') {
      assert.ok(Math.abs(initial - a.hp - tower.def.damage) < 1e-8, id + ' retains normal damage against enemies');
      assert.ok(Math.abs(b.maxHp - b.hp - tower.def.damage) < 1e-8, id + ' retains normal splash damage against enemies');
    }
    if (tower.def.splash || tower.def.chain || tower.def.pierce) assert.ok(b.hp < 28, id + ' hits multiple enemies');
    if (tower.def.slow) {
      assert.ok(a.towerSlowTime > 0); assert.equal(a.towerSlow, tower.def.slow);
      const before = a.position.clone(); M.enemies.update(.05, 0);
      assert.ok(a.position.distanceTo(before) < M.enemies.types.brute.speed * .05 + .001);
    }
    if (tower.def.dot) {
      const hp = a.hp; M.towers.dismantle(tower); step(M, 1);
      assert.ok(a.hp < hp, id + ' effect survives packing source');
      assert.ok(Math.abs(hp - a.hp - tower.def.dot) < 1e-8, id + ' retains normal lingering damage against enemies');
    }
    if (M.towers.list.includes(tower)) assert.ok(M.towers.dismantle(tower));
    M.enemies.zombies.slice().forEach(enemy => M.enemies.damageEnemy(enemy, 1000));
    step(M, 6);
  }
});

function fireOnce(M, tower) {
  step(M, .27); assert.equal(tower.shots, 1); tower.cooldown = 1000;
}
function until(M, condition, seconds = 3) {
  for (let i = 0; i < seconds * 60 && !condition(); i++) M.towers.update(1 / 60);
  assert.ok(condition(), 'expected an impact before timeout');
}
function flights(scene) { return scene.children.filter(o => o.name.endsWith(' projectile')); }

test('raised towers reach farther, shoot down from high platforms and extend piercing flight', () => {
  const { M, THREE } = defense();
  // Isolate range from distant forest cover; construction and swept enemy
  // collisions still use the real tower controller and world foundations.
  M.world.blockedAt = () => false;
  let tower = M.towers.place('ballista', 8, 7, 8); assert.ok(tower);
  let enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 38), 'brute');
  step(M, .4); assert.equal(tower.shots, 0, '21m is beyond the ground-level 19m range');
  M.towers.dismantle(tower);
  assert.ok(M.world.placeBlock('stone', 8, 7, 8));
  tower = M.towers.place('ballista', 8, 8, 8); assert.ok(tower);
  fireOnce(M, tower); until(M, () => enemy.hp < enemy.maxHp);
  assert.equal(enemy.hp, 27, 'Y 16 extends the actual shot beyond 19m');
  M.towers.dismantle(tower); M.enemies.damageEnemy(enemy, enemy.hp);
  for (let y = 8; y < 16; y++) assert.ok(M.world.placeBlock('stone', 8, y, 8));
  tower = M.towers.place('ballista', 8, 16, 8); assert.ok(tower);
  enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
  fireOnce(M, tower); until(M, () => enemy.hp < enemy.maxHp);
  assert.equal(enemy.hp, 27, 'a Y 32 platform still reaches enemies on Y 14');
  M.towers.dismantle(tower); M.enemies.damageEnemy(enemy, enemy.hp);
  assert.ok(M.world.placeBlock('stone', 10, 7, 8));
  tower = M.towers.place('sniper', 10, 8, 8); assert.ok(tower);
  const targets = [51, 53].map(z => M.enemies.spawnAt(new THREE.Vector3(21, 16, z), 'brute'));
  fireOnce(M, tower); until(M, () => targets[1].hp < targets[1].maxHp);
  assert.deepEqual(targets.map(e => e.hp), [22.75, 22.75], 'the dart reaches and pierces beyond the old 32m limit');
  M.towers.dismantle(tower); targets.forEach(e => M.enemies.damageEnemy(e, e.hp));
  for (let y = 7; y < 40; y++) assert.ok(M.world.placeBlock('stone', 12, y, 8));
  tower = M.towers.place('mortar', 12, 40, 8); assert.ok(tower);
  enemy = M.enemies.spawnAt(new THREE.Vector3(25, 14, 129), 'brute');
  fireOnce(M, tower); step(M, 5.1);
  assert.equal(enemy.hp, 28, 'a distant shell is still traveling after five seconds');
  until(M, () => enemy.hp < enemy.maxHp, 6);
  assert.equal(enemy.hp, 26.5, 'long elevated flights do not expire before reaching the target');
});

test('every blueprint resolves its lit projectile and status only on collision', async t => {
  // Reuse one arena for independent, fully drained shots instead of generating
  // ten identical gate networks and forests. Each species keeps its own case.
  const { M, THREE, scene } = defense();
  M.environment = { getState: () => ({ night: 1 }) };
  const camera = new THREE.PerspectiveCamera(75, 1.4, .1, 200), colors = new Set();
  camera.position.set(17, 24, 36); camera.lookAt(17, 17, 22);
  const lamps = scene.children.filter(n => n.name === 'Tower projectile light');
  assert.equal(lamps.length, 4, 'flights share a fixed light budget');
  for (const id of ['ballista', 'mortar', 'frost', 'ember', 'venom', 'storm', 'sniper', 'earth', 'arcane', 'sun']) {
    await t.test(id, () => {
      const tower = M.towers.place(id, 8, 7, 8);
      const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
      fireOnce(M, tower);
      assert.equal(enemy.hp, 28); assert.ok(!enemy.towerSlowTime); assert.ok(!enemy.towerDots);
      const projectile = flights(scene)[0]; assert.ok(projectile, 'visible distinctive projectile');
      M.towers.updateLighting(camera, 1 / 60);
      const lamp = lamps.find(l => l.intensity > 0); assert.ok(lamp, id + ' emits real light');
      assert.ok(lamp.position.distanceTo(projectile.position) < 1e-8);
      assert.equal(lamp.castShadow, false); assert.ok(lamp.distance <= 6);
      colors.add(lamp.color.getHex());
      const start = projectile.position.clone(); step(M, .05);
      assert.ok(projectile.position.distanceTo(start) > .1, 'projectile travels'); assert.equal(enemy.hp, 28);
      M.towers.updateLighting(camera, 1 / 60);
      assert.ok(lamp.position.distanceTo(projectile.position) < 1e-8, 'illumination follows the visible flight');
      until(M, () => enemy.hp < 28);
      assert.equal(enemy.hp, 28 - tower.def.damage, 'exact direct damage at the collision tick');
      if (tower.def.slow) assert.equal(enemy.towerSlowTime, 2.5);
      if (tower.def.dot) assert.equal(enemy.towerDots[id].remaining, 4);
      M.towers.dismantle(tower); step(M, 6);
      assert.equal(flights(scene).length, 0, 'flights expire');
      assert.ok(lamps.every(l => l.intensity === 0), 'impacts and expired shots leave no light behind');
      assert.equal(scene.children.filter(o => o.name.endsWith(' impact')).length, 0, 'bursts expire');
      M.enemies.zombies.slice().forEach(e => M.enemies.damageEnemy(e, 1000));
    });
  }
  assert.equal(colors.size, 10, 'all ten projectile types have distinct light colors');
});

test('physical bolts can miss a moving target; homing frost follows without early damage', () => {
  for (const id of ['ballista', 'frost']) {
    const { M, THREE } = defense();
    const tower = M.towers.place(id, 8, 7, 8);
    const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
    fireOnce(M, tower); enemy.position.x += 5; step(M, 1.5);
    assert.equal(enemy.hp, id === 'frost' ? 27.5 : 28, id);
  }
});

test('an enemy entering a bolt flight path intercepts it and protects the intended target', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('ballista', 8, 7, 8);
  const target = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
  fireOnce(M, tower);
  const blocker = M.enemies.spawnAt(new THREE.Vector3(17, 14, 23), 'brute');
  step(M, 1); assert.equal(blocker.hp, 27); assert.equal(target.hp, 28);
});

test('new walls stop in-flight shots, even with a long swept simulation step', () => {
  for (const wall of [false, true]) {
    const { M, THREE } = defense();
    const tower = M.towers.place('sniper', 8, 7, 8);
    const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
    fireOnce(M, tower);
    if (wall) for (let y = 7; y < 12; y++) assert.ok(M.world.placeBlock('stone', 8, y, 11));
    M.towers.update(.5);
    assert.equal(enemy.hp, wall ? 28 : 22.75, 'earliest wall/body contact wins');
  }
});

test('shell splash uses the impact-time positions and cannot propagate through a wall', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('mortar', 8, 7, 8);
  const target = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
  const newcomer = M.enemies.spawnAt(new THREE.Vector3(25, 14, 29), 'brute');
  const escaped = M.enemies.spawnAt(new THREE.Vector3(18, 14, 29), 'brute');
  fireOnce(M, tower);
  escaped.position.x = 25; newcomer.position.x = 15;
  const protectedEnemy = M.enemies.spawnAt(new THREE.Vector3(20.5, 14, 29), 'brute');
  for (let y = 7; y < 11; y++) assert.ok(M.world.placeBlock('stone', 9, y, 14));
  until(M, () => target.hp < 28);
  assert.equal(target.hp, 26.5); assert.equal(newcomer.hp, 26.5);
  assert.equal(escaped.hp, 28); assert.equal(protectedEnemy.hp, 28);
});

test('lightning damages each of its three victims on separate sequential arrivals', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('storm', 8, 7, 8);
  const targets = [17, 20, 23].map(x => M.enemies.spawnAt(new THREE.Vector3(x, 14, 29), 'brute'));
  fireOnce(M, tower);
  until(M, () => targets[0].hp < 28);
  assert.equal(targets[1].hp, 28); assert.equal(targets[2].hp, 28);
  until(M, () => targets[1].hp < 28); assert.equal(targets[2].hp, 28);
  until(M, () => targets[2].hp < 28);
  targets.forEach(e => assert.equal(e.hp, 26.2)); step(M, 1);
  targets.forEach(e => assert.equal(e.hp, 26.2, 'chain never loops back'));
});

test('Sunspire sweeps through at most three bodies, in their actual flight order', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('sun', 8, 7, 8);
  const targets = [29, 31, 33, 35].map(z => M.enemies.spawnAt(new THREE.Vector3(17, 14, z), 'brute'));
  fireOnce(M, tower);
  until(M, () => targets[0].hp < 28); assert.equal(targets[1].hp, 28);
  until(M, () => targets[1].hp < 28); assert.equal(targets[2].hp, 28);
  until(M, () => targets[2].hp < 28); step(M, 1);
  assert.deepEqual(targets.map(e => e.hp), [24.25, 24.25, 24.25, 28]);
});

test('Watchman pierces exactly two enemies and still stops at a newly built wall', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('sniper', 8, 7, 8);
  const targets = [29, 31, 33].map(z => M.enemies.spawnAt(new THREE.Vector3(17, 14, z), 'brute'));
  fireOnce(M, tower);
  until(M, () => targets[0].hp < 28); assert.equal(targets[1].hp, 28);
  until(M, () => targets[1].hp < 28); step(M, .5);
  assert.deepEqual(targets.map(e => e.hp), [22.75, 22.75, 28]);
  targets.forEach(e => M.enemies.damageEnemy(e, 100)); step(M, 1);
  const a = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
  const b = M.enemies.spawnAt(new THREE.Vector3(17, 14, 33), 'brute');
  tower.cooldown = 0; M.towers.update(.01); tower.cooldown = 1000;
  until(M, () => a.hp < 28);
  for (let y = 7; y < 12; y++) assert.ok(M.world.placeBlock('stone', 8, y, 15));
  step(M, 1); assert.equal(b.hp, 28, 'a wall stops penetration after the first body');
});

test('Arcane slash cleaves only two nearby victims, respects cover, and works with reduced motion', () => {
  const { M, THREE, scene } = defense();
  const tower = M.towers.place('arcane', 8, 7, 8);
  for (const reduced of [false, true]) {
    M.config.reducedMotion = reduced;
    const primary = M.enemies.spawnAt(new THREE.Vector3(16.6, 14, 29), 'brute');
    const nearby = [18.2, 18.8, 19.4].map(x => M.enemies.spawnAt(new THREE.Vector3(x, 14, 29), 'brute'));
    tower.cooldown = 0; M.towers.update(.01); tower.cooldown = 1000;
    const covered = M.enemies.spawnAt(new THREE.Vector3(14.6, 14, 27.55), 'brute');
    for (let y = 7; y < 11; y++) if (!M.world.blockInfoAt(7, y, 14)) assert.ok(M.world.placeBlock('stone', 7, y, 14));
    until(M, () => primary.hp < 28);
    assert.equal(primary.hp, 26.8);
    assert.deepEqual(nearby.map(e => e.hp), [27.4, 27.4, 28]);
    assert.equal(covered.hp, 28, 'slash cannot cut through cover');
    assert.equal(scene.children.some(o => o.name === 'Arcane slash'), !reduced);
    M.enemies.zombies.slice().forEach(e => M.enemies.damageEnemy(e, 100)); step(M, 2);
    assert.equal(scene.children.some(o => o.name === 'Arcane slash'), false, 'slash expires');
  }
});

test('Venom splash poisons impact-time neighbors, refreshes without stacking, and survives packing', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('venom', 8, 7, 8);
  const primary = M.enemies.spawnAt(new THREE.Vector3(16.6, 14, 29), 'brute');
  const neighbor = M.enemies.spawnAt(new THREE.Vector3(18.1, 14, 29), 'brute');
  const far = M.enemies.spawnAt(new THREE.Vector3(22, 14, 29), 'brute');
  fireOnce(M, tower);
  const covered = M.enemies.spawnAt(new THREE.Vector3(14.6, 14, 27.55), 'brute');
  for (let y = 7; y < 11; y++) assert.ok(M.world.placeBlock('stone', 7, y, 14));
  until(M, () => primary.hp < 28);
  assert.equal(neighbor.hp, 27.7); assert.equal(neighbor.towerDots.venom.rate, .7);
  assert.equal(far.hp, 28); assert.equal(covered.hp, 28);
  M.enemies.damageEnemy(covered, 100);
  step(M, .5); tower.cooldown = 0; M.towers.update(.01); tower.cooldown = 1000;
  until(M, () => neighbor.towerDots.venom.remaining === 4);
  assert.equal(Object.keys(neighbor.towerDots).length, 1);
  const hp = neighbor.hp; M.towers.dismantle(tower); step(M, 5);
  assert.ok(Math.abs(hp - neighbor.hp - 2.8) < 1e-8, 'one poison refresh deals four seconds at 0.7 DPS');
  assert.equal(Object.keys(neighbor.towerDots).length, 0, 'poison expires');
});

test('a shot survives packing its tower, while an already killed target yields no duplicate loot', () => {
  for (const killed of [false, true]) {
    const { M, THREE } = defense();
    const tower = M.towers.place('sniper', 8, 7, 8);
    const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29));
    enemy.hp = 5; // A wounded enemy can be finished by this one in-flight dart.
    fireOnce(M, tower); M.towers.dismantle(tower);
    if (killed) M.enemies.damageEnemy(enemy, enemy.maxHp);
    step(M, 2);
    assert.equal(enemy.hp, 0); assert.equal(tower.kills, killed ? 0 : 1);
    assert.equal(M.items.drops.filter(d => d.userData.drop.kind === 'coin').length, 1);
  }
});

test('reduced motion preserves visible projectiles, impact timing, damage and chaining', () => {
  const { M, THREE, scene } = defense(); M.config.reducedMotion = true;
  const tower = M.towers.place('storm', 8, 7, 8);
  const a = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
  const b = M.enemies.spawnAt(new THREE.Vector3(20, 14, 29), 'brute');
  fireOnce(M, tower); assert.equal(a.hp, 28); assert.equal(flights(scene).length, 1);
  until(M, () => a.hp < 28); assert.equal(b.hp, 28);
  until(M, () => b.hp < 28);
  assert.equal(scene.children.filter(o => o.name.endsWith(' impact')).length, 0);
});

test('physical arrows, darts and siege shots lead a steadily walking enemy', () => {
  for (const id of ['ballista', 'sniper', 'mortar', 'earth']) {
    const { M, THREE } = defense();
    const tower = M.towers.place(id, 8, 7, 8);
    const enemy = M.enemies.spawnAt(new THREE.Vector3(15, 14, 29), 'brute');
    for (let i = 0; i < 180 && enemy.hp === 28; i++) {
      enemy.position.x += 1.65 / 60; M.towers.update(1 / 60);
      if (tower.shots) tower.cooldown = 1000;
    }
    assert.equal(enemy.hp, 28 - tower.def.damage, id + ' intercepts walking target');
  }
});

test('animated models share baked geometry without moving previews or other tower instances', () => {
  const { M } = defense();
  for (const id of ['ballista', 'frost', 'storm', 'sniper', 'earth', 'arcane', 'sun']) {
    const a = M.towers.model(id), b = M.towers.model(id);
    const moving = a.getObjectByName('Mechanism'), still = b.getObjectByName('Mechanism');
    assert.ok(moving && still, id + ' has an independent mechanism');
    assert.notEqual(moving, still);
    moving.rotation.y = 2; moving.position.y = .5; moving.scale.x = .8;
    assert.equal(still.rotation.y, 0); assert.equal(still.position.y, 0); assert.equal(still.scale.x, 1);
    assert.equal(moving.children[0].geometry, still.children[0].geometry, 'GPU geometry is reused');
    assert.equal(moving.children[0].material, still.children[0].material, 'materials are reused');
  }
  const tower = M.towers.place('arcane', 8, 7, 8), preview = M.towers.model('arcane');
  step(M, .5);
  assert.notEqual(tower.group.getObjectByName('Mechanism').rotation.y, 0);
  assert.equal(preview.getObjectByName('Mechanism').rotation.y, 0);
});

test('deployed towers share GPU batches with exact independent poses, packing and reuse', () => {
  const { M, THREE, scene } = defense();
  const first = M.towers.place('arcane', 8, 7, 8);
  M.towers.update(.1);
  const batches = scene.children.filter(node => node.name === 'Tower batch');
  const second = M.towers.place('arcane', 10, 7, 8);
  M.towers.update(.1);
  assert.equal(scene.children.filter(node => node.name === 'Tower batch').length, batches.length,
    'a second identical tower adds no draw submissions');
  const actual = new THREE.Matrix4();
  for (const tower of [first, second]) tower.group.traverse(node => {
    if (!node.isMesh) return;
    assert.equal(node.visible, false, 'rig meshes are submitted only through their batch');
    const batch = batches.find(b => b.geometry === node.geometry && b.material === node.material);
    assert.ok(batch && batch.castShadow && batch.receiveShadow);
    let found = false;
    for (let i = 0; i < batch.count; i++) {
      batch.getMatrixAt(i, actual);
      if (actual.elements.every((v, j) => Math.abs(v - node.matrixWorld.elements[j]) < .00001)) found = true;
    }
    assert.ok(found, 'the displayed instance matches its own animated rig');
    assert.ok(batch.count <= batch.instanceMatrix.count);
  });
  M.towers.dismantle(first);
  assert.ok(batches.every(batch => batch.count === 1), 'packing immediately removes only its own instances');
  M.towers.dismantle(second);
  assert.ok(batches.every(batch => batch.count === 0 && !batch.visible), 'empty batches stop drawing');
  assert.ok(M.towers.place('arcane', 8, 7, 8)); M.towers.update(.1);
  assert.ok(batches.every(batch => batch.count === 1), 'redeployment reuses the allocated buffers');
});

test('spatial projectile queries include moving interceptors across negative cell boundaries', () => {
  const { M, THREE } = defense(true, 1);
  const tower = M.towers.place('ballista', -9, 7, -9); assert.ok(tower);
  const target = M.enemies.spawnAt(new THREE.Vector3(-17, 14, -31), 'brute');
  const interceptor = M.enemies.spawnAt(new THREE.Vector3(45, 14, 45), 'brute');
  fireOnce(M, tower);
  interceptor.position.set(-17, 14, -24);
  M.towers.update(.6); // Sweeps through several grid cells in a single tick.
  assert.equal(interceptor.hp, 27, 'the fresh spatial index catches a newly arrived body');
  assert.equal(target.hp, 28, 'the nearer interceptor protects the original target');
});

test('tower batches preserve hidden loading mechanisms and repeated builder trim instances', () => {
  const { M, scene } = defense();
  const earth = M.towers.place('earth', 8, 7, 8);
  M.items.addItem('tower_builder_frost_3', 1);
  assert.ok(M.towers.place('builder_frost_3', 10, 7, 8));
  M.towers.update(.1);
  const mechanism = earth.group.getObjectByName('Mechanism');
  const batches = scene.children.filter(node => node.name === 'Tower batch');
  const mechanismBatches = mechanism.children.filter(n => n.isMesh).map(n => batches.find(b => b.geometry === n.geometry && b.material === n.material));
  assert.ok(mechanismBatches.length > 0);
  mechanism.visible = false; M.towers.syncRender();
  assert.ok(mechanismBatches.every(b => b.count === 0), 'an unloaded cradle hides its stone');
  mechanism.visible = true; M.towers.syncRender();
  assert.ok(mechanismBatches.every(b => b.count === 1), 'the loaded stone returns');
  assert.ok(batches.some(b => b.count === 3), 'all three shared-geometry builder tier marks render');
});

test('sustained rapid combat keeps particles bounded, reuses buffers and drains every effect after packing', () => {
  const { M, THREE, scene } = defense();
  const tower = M.towers.place('ember', 8, 7, 8);
  tower.def.interval = 1 / 60;
  const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute'); enemy.hp = 10000;
  const pools = scene.children.filter(o => o.isPoints && o.name.startsWith('Tower '));
  assert.equal(pools.length, 2, 'only two particle draw calls');
  const buffers = pools.map(o => o.geometry.attributes.position.array);
  step(M, 4);
  assert.ok(tower.shots > 150);
  assert.ok(pools.some(o => o.geometry.attributes.alpha.array.some(v => v > 0)), 'combat emits visible particles');
  assert.ok(scene.children.filter(o => / (muzzle|impact)$/.test(o.name)).length <= 80, 'mesh effects are bounded');
  for (const pool of pools) for (const attr of Object.values(pool.geometry.attributes))
    assert.ok(attr.array.every(Number.isFinite), 'particle simulation remains finite');
  M.towers.dismantle(tower); step(M, 7);
  pools.forEach((pool, i) => {
    assert.equal(pool.geometry.attributes.position.array, buffers[i], 'no buffer growth or replacement');
    assert.ok(pool.geometry.attributes.alpha.array.every(v => v === 0), 'trails, smoke and status particles drain');
  });
  assert.equal(flights(scene).length, 0);
  assert.equal(scene.children.filter(o => / (muzzle|impact)$/.test(o.name)).length, 0);
});

test('lightning afterimages release their unique GPU geometry', () => {
  const { M, THREE, scene } = defense();
  const tower = M.towers.place('storm', 8, 7, 8);
  M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
  fireOnce(M, tower); step(M, .06);
  const arc = scene.children.find(o => o.name === 'Storm afterimage'); assert.ok(arc);
  let disposed = false;
  arc.children[0].geometry.addEventListener('dispose', () => { disposed = true; });
  step(M, .2);
  assert.equal(scene.children.includes(arc), false); assert.equal(disposed, true);
});

test('tower night lights follow their emitters, fade by day and disappear when packed', () => {
  const { M, THREE, scene } = defense();
  let night = 1;
  M.environment = { getState: () => ({ night }) };
  const camera = new THREE.PerspectiveCamera(60, 1.4, .1, 200);
  camera.position.set(21, 32, 38); camera.lookAt(21, 14, 19);
  const lamps = scene.children.filter(node => node.name === 'Tower light');
  assert.equal(lamps.length, 8, 'the light budget is fixed before construction');
  assert.ok(lamps.every(l => l.isPointLight && !l.castShadow && l.intensity === 0));
  const towers = M.towers.definitions.map((def, i) => M.towers.place(def.id, 6 + i % 5 * 2, 7, 7 + Math.floor(i / 5) * 3));
  assert.ok(towers.every(Boolean));
  const settle = () => { for (let i = 0; i < 120; i++) M.towers.updateLighting(camera, 1 / 60); };
  M.towers.update(.05); settle();
  assert.equal(lamps.filter(l => l.intensity > .1).length, 8, 'a dense defense stays within the budget');
  for (const lamp of lamps) {
    assert.ok(towers.some(tower => tower.glowAnchor.getWorldPosition(new THREE.Vector3()).distanceTo(lamp.position) < 1e-8), 'light sits at a real flame or glowing weapon');
    assert.ok(lamp.distance <= 11 && lamp.intensity < 1.6, 'light stays local and restrained');
  }
  assert.ok(new Set(lamps.map(l => l.color.getHex())).size >= 5, 'elemental lights retain distinct colors');
  const lit = towers.find(t => lamps.some(l => l.position.distanceTo(t.glowAnchor.getWorldPosition(new THREE.Vector3())) < 1e-8));
  const lamp = lamps.find(l => l.position.distanceTo(lit.glowAnchor.getWorldPosition(new THREE.Vector3())) < 1e-8);
  M.towers.dismantle(lit);
  assert.equal(lamp.intensity, 0, 'packing immediately clears its illumination');
  settle();
  assert.equal(lamps.filter(l => l.intensity > .1).length, 8, 'a waiting tower takes the vacant slot');
  night = 0; settle();
  assert.ok(lamps.every(l => l.intensity < .001), 'daylight fades the local lights out');
  night = 1; settle();
  assert.ok(lamps.some(l => l.intensity > .1), 'the next night lights them again');
  camera.position.set(1000, 30, 1000); camera.lookAt(1000, 14, 990); settle();
  assert.ok(lamps.every(l => l.intensity === 0), 'offscreen towers release their lights');
  for (const tower of M.towers.list.slice()) M.towers.dismantle(tower);
  assert.equal(scene.children.filter(n => n.name === 'Tower light').length, 8, 'construction and packing reuse the pool');
  assert.ok(lamps.every(l => l.intensity === 0));
});

test('torch flames render through shared batches, stay independent and respect reduced motion', () => {
  const { M, scene } = defense();
  const first = M.towers.place('ballista', 8, 7, 8);
  const second = M.towers.place('ballista', 10, 7, 8);
  const ember = M.towers.place('ember', 12, 7, 8);
  const preview = M.towers.model('ballista');
  assert.equal(first.flames.length, 1); assert.equal(ember.flames.length, 2);
  assert.notEqual(first.flames[0], second.flames[0]);
  let previewLights = 0; preview.traverse(n => { if (n.isLight) previewLights++; });
  assert.equal(previewLights, 0, 'preview and pickup models never carry live lights');
  M.towers.update(.1);
  assert.notEqual(first.flames[0].scale.y, 1, 'deployed flames gently flicker');
  assert.equal(preview.getObjectByName('Torch flame').scale.y, 1, 'previews retain an independent pose');
  const batches = scene.children.filter(n => n.name === 'Tower batch' && n.material.isMeshBasicMaterial);
  assert.ok(batches.some(b => b.count >= 4), 'flames share geometry and materials across towers');
  assert.ok(batches.every(b => !b.castShadow && !b.receiveShadow), 'flames never cast opaque voxel shadows');
  M.config.reducedMotion = true; M.towers.update(.1);
  for (const tower of [first, second, ember]) for (const f of tower.flames) {
    assert.equal(f.scale.y, 1); assert.equal(f.rotation.z, 0);
  }
});

test('projectile lighting stays bounded, survives packing, and supports daylight and reduced motion', () => {
  const { M, THREE, scene } = defense();
  let night = 1;
  M.environment = { getState: () => ({ night }) };
  M.config.reducedMotion = true;
  const camera = new THREE.PerspectiveCamera(75, 1.4, .1, 200);
  camera.position.set(17, 23, 34); camera.lookAt(17, 16, 23);
  const lamps = scene.children.filter(n => n.name === 'Tower projectile light');
  const tower = M.towers.place('frost', 8, 7, 8);
  const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 30), 'brute'); enemy.hp = 10000;
  // Accumulate more simultaneous shots than the light budget permits.
  for (let i = 0; i < 7; i++) { tower.cooldown = 0; M.towers.update(.04); }
  tower.cooldown = 1000;
  assert.equal(flights(scene).length, 7);
  M.towers.updateLighting(camera, 1);
  assert.equal(lamps.filter(l => l.intensity > .1).length, 4);
  const nightStrength = lamps.map(l => l.intensity);
  M.towers.dismantle(tower);
  assert.ok(lamps.every(l => l.intensity > .1), 'packing does not extinguish existing flights');
  night = 0; M.towers.updateLighting(camera, 1);
  lamps.forEach((l, i) => assert.ok(l.intensity > 0 && l.intensity < nightStrength[i] * .3, 'daylight softens rather than removes the glow'));
  const daylightStrength = lamps.map(l => l.intensity);
  M.towers.updateLighting(camera, 1);
  lamps.forEach((l, i) => assert.ok(Math.abs(l.intensity - daylightStrength[i]) < 1e-7, 'reduced motion has no pulsing lights'));
  camera.position.set(1000, 30, 1000); camera.lookAt(1000, 14, 990);
  M.towers.updateLighting(camera, 1);
  assert.ok(lamps.every(l => l.intensity === 0), 'offscreen flights release lights');
  camera.position.set(17, 23, 34); camera.lookAt(17, 16, 23);
  M.towers.updateLighting(camera, 1);
  assert.equal(lamps.filter(l => l.intensity > .1).length, 4, 'the same pool can be reassigned');
  step(M, 6);
  assert.equal(flights(scene).length, 0);
  assert.ok(lamps.every(l => l.intensity === 0), 'collision and expiry clear every assigned light');
  assert.equal(scene.children.filter(n => n.name === 'Tower projectile light').length, 4);
});
