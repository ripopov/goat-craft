import assert from 'node:assert/strict';
import test from 'node:test';
import { isolatedAnimal } from './helpers/animal-game.mjs';

function builders(name = 'Mallow', tier = 1) {
  const fixture = isolatedAnimal(name, { seed: 42 }), { M, animal, load, scene } = fixture;
  load('js/coin-model.js'); load('js/inventory.js'); load('js/items.js'); M.items.init(scene); load('js/upgrades.js'); load('js/towers.js'); M.towers.init(scene);
  M.enemies.addCoins(1000); M.items.addItem('stone', 100);
  for (let i = 0; i < tier; i++) assert.equal(M.upgrades.buy(animal, 'craft'), true);
  M.goat.group.position.set(-5, 14, 8);
  Object.assign(animal.state, { wait: 0, buildTimer: 0, actionTimer: 0, pitTimer: 1000 });
  return fixture;
}
function until(M, predicate, seconds = 600) {
  for (let i = 0; i < seconds * 20 && !predicate(); i++) {
    M.items.update(.05, i * .05, M.goat.group); M.animals.update(.05, i * .05);
  }
  assert.ok(predicate(), 'expected builder progress before timeout: ' + JSON.stringify(M.animals.list.filter(a => a.role === 'builder').map(a => ({
    name: a.name, position: a.group.position, mode: a.state.mode, coins: a.state.coins, stone: a.state.towerStone,
    walls: a.state.walls.length, placed: a.state.project?.stepCount
  }))));
}

test('trained sheep and cow builders collect real coins, quarry tower stone, and resume wall repairs', () => {
  for (const name of ['Mallow', 'Clover']) {
    const { M, animal } = builders(name);
    const wallet = M.enemies.getState().coins, stock = M.items.count('stone');
    let minedStone = 0;
    const breakBlock = M.world.breakBlockAt;
    M.world.breakBlockAt = function (...args) {
      const kind = breakBlock(...args);
      if (kind === 'stone' && args[3]?.drop === false) minedStone++;
      return kind;
    };
    M.items.dropCoins(animal.group.position, 12);
    until(M, () => M.towers.list.length === 1);
    const tower = M.towers.list[0];
    assert.equal(tower.builder, animal); assert.equal(tower.def.builderTier, 1);
    assert.ok(animal.state.walls.length >= 1 || animal.state.project?.stepCount >= 4, 'real wall work precedes the occasional tower job');
    assert.ok(minedStone >= 3, 'tower materials came from actual quarry edits');
    assert.equal(animal.state.coins, 0); assert.equal(animal.state.towerStone, 0);
    assert.equal(M.enemies.getState().coins, wallet, 'autonomous construction never drains the player wallet');
    assert.equal(M.items.count('stone'), stock, 'autonomous construction never drains the hotbar');
    assert.equal(M.items.drops.filter(drop => drop.userData.drop.kind === 'coin').length, 0);
    const wall = animal.state.walls[0] || animal.state.project;
    const damaged = wall.plan.find(cell => M.world.blockInfoAt(cell.bx, cell.by, cell.bz));
    assert.ok(M.world.breakBlockAt(damaged.bx, damaged.by, damaged.bz, { drop: false }));
    until(M, () => !!M.world.blockInfoAt(damaged.bx, damaged.by, damaged.bz), 240);
    assert.equal(M.towers.list.length, 1, 'wall repair continues without unfunded extra towers');
  }
});

test('coin collection is physical, individual and cannot duplicate player rewards', () => {
  const { M, animal, THREE } = builders('Mallow', 0);
  animal.group.position.set(15, 14, 15);
  Object.assign(animal.state, { wait: 1000, buildTimer: 1000 });
  M.items.dropCoins(animal.group.position, 7);
  M.animals.update(.05, 0);
  assert.equal(animal.state.coins, 0, 'untrained wall builders leave coins for the player');
  assert.equal(M.upgrades.buy(animal, 'craft'), true);
  const other = M.animals.list.find(a => a.name === 'Clover');
  assert.equal(M.upgrades.buy(other, 'craft'), true);
  Object.assign(other.state, { retired: false, wait: 1000, buildTimer: 1000 });
  other.group.position.set(16.5, 14, 15);
  const wallet = M.enemies.getState().coins;
  M.animals.update(.05, .05);
  assert.equal(animal.state.coins + other.state.coins, 7, 'one stack can only be claimed once');
  const collector = new THREE.Group(); collector.position.set(15, 14, 15);
  for (let i = 0; i < 40; i++) M.items.update(.05, i * .05, collector);
  assert.equal(M.enemies.getState().coins, wallet, 'the removed stack cannot also pay the player');
  assert.equal(M.items.slots.some(slot => slot?.kind === 'coin'), false);
  animal.state.coins = 12; other.state.retired = true;
  M.items.dropCoins(animal.group.position, 4);
  M.animals.update(.05, 3);
  assert.equal(animal.state.coins, 12, 'a funded builder leaves further coins available to the player');
  assert.ok(M.items.drops.some(drop => drop.userData.drop.kind === 'coin'));
});

test('builders walk to nearby coins and ignore coins behind walls or on other floors', () => {
  const { M, animal, THREE } = builders();
  animal.group.position.set(15, 14, 15);
  Object.assign(animal.state, { wait: 0, buildTimer: 1000 });
  M.items.dropCoins(new THREE.Vector3(21, 14, 15), 5);
  M.animals.update(.05, 0);
  assert.ok(animal.state.coinTarget, 'a nearby stack starts a short collection trip');
  until(M, () => animal.state.coins === 5, 12);
  assert.ok(animal.group.position.x > 18, 'the builder actually approaches the stack');
  animal.group.position.set(15, 14, 15);
  M.items.dropCoins(new THREE.Vector3(19, 14, 15), 9);
  for (let by = 7; by <= 8; by++) M.world.placeBlock('stone', 8, by, 7);
  assert.equal(M.items.nearestCoin(animal.group.position, 18), null, 'walls block coin targeting');
  assert.equal(M.items.takeCoins(animal.group.position), 0, 'walls never allow remote collection');
  M.items.dropCoins(new THREE.Vector3(15, 21, 15), 4);
  assert.equal(M.items.nearestCoin(animal.group.position, 2), null, 'coins above a different floor are ignored');
});

test('tower construction validates local funds, materials and the entire site before charging', () => {
  const { M, animal } = builders();
  M.goat.group.position.set(-25, 14, -25); animal.group.position.set(-20, 14, -20);
  const wallet = M.enemies.getState().coins, stock = M.items.count('stone');
  assert.equal(M.towers.placeBuilder(animal, 8, 7, 8), false, 'player wealth cannot fund an empty builder');
  animal.state.coins = 12; animal.state.towerStone = 2;
  assert.equal(M.towers.placeBuilder(animal, 8, 7, 8), false, 'all three stone are required');
  animal.state.towerStone = 3;
  M.world.placeBlock('stone', 8, 8, 8);
  assert.equal(M.towers.placeBuilder(animal, 8, 7, 8), false, 'a blocked upper cell rejects the whole tower');
  assert.equal(animal.state.coins, 12); assert.equal(animal.state.towerStone, 3);
  assert.equal(M.world.blockInfoAt(8, 7, 8), null);
  M.world.breakBlockAt(8, 8, 8, { drop: false });
  const place = M.world.placeBlock;
  M.world.placeBlock = (kind, bx, by, bz) => by === 8 ? false : place(kind, bx, by, bz);
  assert.equal(M.towers.placeBuilder(animal, 8, 7, 8), false, 'a failed edit rolls back earlier cells');
  assert.equal(M.world.blockInfoAt(8, 7, 8), null);
  assert.equal(animal.state.coins, 12); assert.equal(animal.state.towerStone, 3);
  M.world.placeBlock = place;
  const tower = M.towers.placeBuilder(animal, 8, 7, 8);
  assert.ok(tower); assert.equal(animal.state.coins, 0); assert.equal(animal.state.towerStone, 0);
  assert.equal(M.enemies.getState().coins, wallet); assert.equal(M.items.count('stone'), stock);
  const hunter = M.animals.list.find(a => a.role === 'hunter');
  Object.assign(hunter.state, { coins: 100, towerStone: 100 });
  assert.equal(M.towers.placeBuilder(hunter, 10, 7, 8), false);
});

test('each Practiced builder tier strengthens its own standing towers and their real attacks', () => {
  const { M, animal, THREE, scene } = builders();
  M.goat.group.position.set(-25, 14, -25); animal.group.position.set(-20, 14, -20);
  Object.assign(animal.state, { coins: 12, towerStone: 3 });
  const tower = M.towers.placeBuilder(animal, 8, 7, 8);
  const normal = M.towers.place('frost', 12, 7, 8);
  assert.ok(tower && normal);
  const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 25), 'brute');
  normal.cooldown = 1000;
  let interval = Infinity;
  const countInstances = () => scene.children.filter(n => n.name === 'Tower batch').reduce((sum, n) => sum + n.count, 0);
  M.towers.syncRender();
  const initialInstances = countInstances();
  for (let tier = 1; tier <= 3; tier++) {
    if (tier > 1) assert.equal(M.upgrades.buy(animal, 'craft'), true);
    assert.equal(countInstances(), initialInstances + tier - 1, 'training replaces the old rig and adds exactly one visible tier mark');
    assert.equal(tower.def.builderTier, tier);
    assert.equal(tower.def.damage, .5 * tier); assert.ok(tower.def.interval < interval);
    interval = tower.def.interval;
    assert.equal(normal.def.damage, .5, 'player towers are unaffected by another builder training');
    const hp = enemy.hp, shots = tower.shots;
    tower.cooldown = 0;
    M.towers.update(.01); tower.cooldown = 1000;
    assert.equal(tower.shots, shots + 1); assert.equal(enemy.hp, hp, 'damage waits for projectile arrival');
    for (let i = 0; i < 120 && enemy.hp === hp; i++) M.towers.update(1 / 60);
    assert.equal(hp - enemy.hp, .5 * tier, 'higher tier damage reaches the enemy on impact');
  }
  M.towers.dismantle(tower); M.towers.dismantle(normal);
  assert.equal(countInstances(), 0, 'packing trained towers leaves no old models in the batches');
});

test('packing and redeploying a trained tower preserves its tier without a second payment', () => {
  const { M, animal, THREE } = builders('Mallow', 3);
  M.goat.group.position.set(-25, 14, -25); animal.group.position.set(-20, 14, -20);
  Object.assign(animal.state, { coins: 12, towerStone: 3 });
  const tower = M.towers.placeBuilder(animal, 8, 7, 8), id = tower.id;
  assert.equal(M.world.blockIcon('tower_' + id), 'assets/towers/frost.png');
  assert.equal(M.world.breakBlockAt(8, 8, 8), 'tower_' + id);
  const drop = M.items.drops.find(drop => drop.userData.drop.kind === 'tower_' + id);
  assert.ok(drop);
  const collector = new THREE.Group(); collector.position.copy(drop.position); collector.position.y -= .9;
  for (let i = 0; i < 40; i++) M.items.update(.05, i * .05, collector);
  assert.equal(M.items.count('tower_' + id), 1);
  assert.equal(M.towers.inventoryCount('frost'), 1, 'the strategic Frost card includes the packed trained tower');
  const wallet = M.enemies.getState().coins, stock = M.items.count('stone');
  const restored = M.towers.place('frost', 10, 7, 8, true);
  assert.ok(restored); assert.equal(restored.def.builderTier, 3); assert.equal(restored.def.damage, 1.5);
  assert.equal(M.enemies.getState().coins, wallet); assert.equal(M.items.count('stone'), stock);
  assert.equal(M.items.count('tower_' + id), 0);
});
