import assert from 'node:assert/strict';
import test from 'node:test';
import { game } from './helpers/animal-game.mjs';

function defense(rich = true) {
  const fixture = game(), { M, load, scene } = fixture;
  load('js/items.js'); M.items.init(scene); load('js/upgrades.js'); load('js/towers.js'); M.towers.init(scene);
  M.goat.group.position.set(-25, 14, -25);
  M.animals.list.forEach((animal, i) => animal.group.position.set(-25 + i * 3, 14, -20));
  if (rich) {
    M.enemies.addCoins(1000);
    for (const kind of ['log', 'stone', 'dirt', 'coal', 'iron', 'copper']) M.items.addItem(kind, 100);
  }
  return fixture;
}
function step(M, duration) { for (let i = 0; i < duration * 60; i++) M.towers.update(1 / 60); }

test('all ten blueprints buy real 1–3 block towers and debit the complete price', () => {
  const { M } = defense();
  assert.equal(M.towers.definitions.length, 10);
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
  assert.equal(M.towers.place('ballista', 30, 7, 8), false, 'beyond arena');
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
  for (let i = 1; i < 10; i++) M.items.slots[i] = { kind: 'stone', count: 1, name: 'Stone' };
  const collector = new THREE.Group(); collector.position.copy(packed.position); collector.position.y -= .9;
  M.items.update(.01, 0, collector);
  assert.ok(M.items.drops.includes(packed), 'full inventory retains physical tower');
});

test('cannons auto-target within range, obey walls and award normal physical coin loot', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('ballista', 8, 7, 8);
  const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 23)); assert.ok(enemy);
  step(M, .3); assert.equal(enemy.hp, 2, 'launch does not damage'); assert.equal(tower.shots, 1);
  step(M, .2); assert.equal(enemy.hp, 1, 'bolt arrival damages');
  step(M, 1.3); assert.equal(enemy.hp, 0); assert.equal(tower.kills, 1);
  assert.equal(M.items.drops.filter(d => d.userData.drop.kind === 'coin').length, 1);
  const blocked = M.enemies.spawnAt(new THREE.Vector3(17, 14, 25));
  for (let y = 7; y < 12; y++) M.world.placeBlock('stone', 8, y, 10);
  step(M, 3); assert.equal(blocked.hp, 2, 'wall blocks tower shots');
  const far = M.enemies.spawnAt(new THREE.Vector3(45, 14, 17)); assert.ok(far);
  step(M, 3); assert.equal(far.hp, 2, 'out of range');
});

test('frost slows actual walking, poison and fire linger, and splash / chain / beam hit groups', () => {
  for (const id of ['frost', 'venom', 'ember', 'mortar', 'storm', 'sun', 'earth', 'arcane']) {
    const { M, THREE } = defense();
    const tower = M.towers.place(id, 8, 7, 8); assert.ok(tower);
    const a = M.enemies.spawnAt(new THREE.Vector3(17, 14, 23), 'brute');
    const b = M.enemies.spawnAt(new THREE.Vector3(id === 'sun' ? 17 : 19, 14, 24), 'brute');
    const initial = a.hp; step(M, 1.1);
    assert.ok(a.hp < initial, id + ' attacks');
    if (tower.def.splash || tower.def.chain || tower.def.pierce) assert.ok(b.hp < 7, id + ' hits multiple enemies');
    if (tower.def.slow) {
      assert.ok(a.towerSlowTime > 0); assert.equal(a.towerSlow, tower.def.slow);
      const before = a.position.clone(); M.enemies.update(.05, 0);
      assert.ok(a.position.distanceTo(before) < M.enemies.types.brute.speed * .05 + .001);
    }
    if (tower.def.dot) {
      const hp = a.hp; M.towers.dismantle(tower); step(M, 1);
      assert.ok(a.hp < hp, id + ' effect survives packing source');
    }
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

for (const id of ['ballista', 'mortar', 'frost', 'ember', 'venom', 'storm', 'sniper', 'earth', 'arcane', 'sun']) {
  test(id + ': launch is harmless, flight is visible, damage and status begin only on collision', () => {
    const { M, THREE, scene } = defense();
    const tower = M.towers.place(id, 8, 7, 8);
    const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
    fireOnce(M, tower);
    assert.equal(enemy.hp, 7); assert.ok(!enemy.towerSlowTime); assert.ok(!enemy.towerDots);
    const projectile = flights(scene)[0]; assert.ok(projectile, 'visible distinctive projectile');
    const start = projectile.position.clone(); step(M, .05);
    assert.ok(projectile.position.distanceTo(start) > .1, 'projectile travels'); assert.equal(enemy.hp, 7);
    until(M, () => enemy.hp < 7);
    assert.equal(enemy.hp, 7 - tower.def.damage, 'exact direct damage at the collision tick');
    if (tower.def.slow) assert.equal(enemy.towerSlowTime, 2.5);
    if (tower.def.dot) assert.equal(enemy.towerDots[id].remaining, 4);
    M.towers.dismantle(tower); step(M, 6);
    assert.equal(flights(scene).length, 0, 'flights expire');
    assert.equal(scene.children.filter(o => o.name.endsWith(' impact')).length, 0, 'bursts expire');
  });
}

test('physical bolts can miss a moving target; homing frost follows without early damage', () => {
  for (const id of ['ballista', 'frost']) {
    const { M, THREE } = defense();
    const tower = M.towers.place(id, 8, 7, 8);
    const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
    fireOnce(M, tower); enemy.position.x += 5; step(M, 1.5);
    assert.equal(enemy.hp, id === 'frost' ? 6.5 : 7, id);
  }
});

test('an enemy entering a bolt flight path intercepts it and protects the intended target', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('ballista', 8, 7, 8);
  const target = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
  fireOnce(M, tower);
  const blocker = M.enemies.spawnAt(new THREE.Vector3(17, 14, 23), 'brute');
  step(M, 1); assert.equal(blocker.hp, 6); assert.equal(target.hp, 7);
});

test('new walls stop in-flight shots, even with a long swept simulation step', () => {
  for (const wall of [false, true]) {
    const { M, THREE } = defense();
    const tower = M.towers.place('sniper', 8, 7, 8);
    const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
    fireOnce(M, tower);
    if (wall) for (let y = 7; y < 12; y++) assert.ok(M.world.placeBlock('stone', 8, y, 11));
    M.towers.update(.5);
    assert.equal(enemy.hp, wall ? 7 : 3.5, 'earliest wall/body contact wins');
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
  until(M, () => target.hp < 7);
  assert.equal(target.hp, 5.5); assert.equal(newcomer.hp, 5.5);
  assert.equal(escaped.hp, 7); assert.equal(protectedEnemy.hp, 7);
});

test('lightning damages each of its three victims on separate sequential arrivals', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('storm', 8, 7, 8);
  const targets = [17, 20, 23].map(x => M.enemies.spawnAt(new THREE.Vector3(x, 14, 29), 'brute'));
  fireOnce(M, tower);
  until(M, () => targets[0].hp < 7);
  assert.equal(targets[1].hp, 7); assert.equal(targets[2].hp, 7);
  until(M, () => targets[1].hp < 7); assert.equal(targets[2].hp, 7);
  until(M, () => targets[2].hp < 7);
  targets.forEach(e => assert.equal(e.hp, 5.8)); step(M, 1);
  targets.forEach(e => assert.equal(e.hp, 5.8, 'chain never loops back'));
});

test('Sunspire sweeps through at most three bodies, in their actual flight order', () => {
  const { M, THREE } = defense();
  const tower = M.towers.place('sun', 8, 7, 8);
  const targets = [29, 31, 33, 35].map(z => M.enemies.spawnAt(new THREE.Vector3(17, 14, z), 'brute'));
  fireOnce(M, tower);
  until(M, () => targets[0].hp < 7); assert.equal(targets[1].hp, 7);
  until(M, () => targets[1].hp < 7); assert.equal(targets[2].hp, 7);
  until(M, () => targets[2].hp < 7); step(M, 1);
  assert.deepEqual(targets.map(e => e.hp), [4.5, 4.5, 4.5, 7]);
});

test('a shot survives packing its tower, while an already killed target yields no duplicate loot', () => {
  for (const killed of [false, true]) {
    const { M, THREE } = defense();
    const tower = M.towers.place('sniper', 8, 7, 8);
    const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29));
    fireOnce(M, tower); M.towers.dismantle(tower);
    if (killed) M.enemies.damageEnemy(enemy, 2);
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
  fireOnce(M, tower); assert.equal(a.hp, 7); assert.equal(flights(scene).length, 1);
  until(M, () => a.hp < 7); assert.equal(b.hp, 7);
  until(M, () => b.hp < 7);
  assert.equal(scene.children.filter(o => o.name.endsWith(' impact')).length, 0);
});

test('physical arrows, darts and siege shots lead a steadily walking enemy', () => {
  for (const id of ['ballista', 'sniper', 'mortar', 'earth']) {
    const { M, THREE } = defense();
    const tower = M.towers.place(id, 8, 7, 8);
    const enemy = M.enemies.spawnAt(new THREE.Vector3(15, 14, 29), 'brute');
    for (let i = 0; i < 180 && enemy.hp === 7; i++) {
      enemy.position.x += 1.65 / 60; M.towers.update(1 / 60);
      if (tower.shots) tower.cooldown = 1000;
    }
    assert.equal(enemy.hp, 7 - tower.def.damage, id + ' intercepts walking target');
  }
});
