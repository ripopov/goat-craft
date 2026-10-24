import assert from 'node:assert/strict';
import test from 'node:test';
import { game, isolatedAnimal } from './helpers/animal-game.mjs';

function training(fixture = game()) {
  const { M, load, scene } = fixture;
  load('js/items.js'); M.items.init(scene); load('js/upgrades.js');
  return fixture;
}
function supplies(M, coins = 1000) {
  M.enemies.addCoins(coins); M.items.addItem('log', 100); M.items.addItem('stone', 100);
}
function train(M, target, key, tiers = 3) { for (let i = 0; i < tiers; i++) assert.equal(M.upgrades.buy(target, key), true); }
function advancePlayer(M, seconds) { for (let i = 0; i < Math.round(seconds * 60); i++) M.goat.update(1 / 60, i / 60); }

test('starter resources are granted once, and purchases debit coins and the selected block stack', () => {
  const { M } = training(), u = M.upgrades;
  u.init(); u.init();
  assert.equal(M.enemies.getState().coins, 45);
  for (const [kind, count] of Object.entries({ log: 4, stone: 5, dirt: 4, coal: 2, copper: 3, iron: 3 }))
    assert.equal(M.items.count(kind), count, kind + ' starting balance');
  M.enemies.spendCoins(37); M.items.spend({ log: 2 });
  M.items.selectSlot(1);
  assert.equal(M.items.heldKind, 'log');
  assert.equal(u.buy(u.player, 'move'), true);
  assert.equal(M.enemies.getState().coins, 0); assert.equal(M.items.count('log'), 0); assert.equal(M.items.count('stone'), 5);
  assert.equal(M.items.heldMesh, null, 'spending the carried stack clears the held block');
  assert.equal(u.level(u.player, 'move'), 1); assert.equal(u.stats().move, 4 / 3);
  assert.equal(u.buy(u.player, 'reach'), false); assert.equal(M.enemies.getState().coins, 0);
});

test('insufficient coins or blocks never partially debit, and invalid or maxed purchases are rejected', () => {
  const { M } = training(), u = M.upgrades;
  M.enemies.addCoins(100);
  assert.equal(u.buy(u.player, 'power'), false); assert.equal(M.enemies.getState().coins, 100);
  M.items.addItem('stone', 50); M.enemies.spendCoins(95);
  assert.equal(u.buy(u.player, 'power'), false); assert.equal(M.items.count('stone'), 50);
  assert.equal(u.buy({}, 'move'), false); assert.equal(u.buy(u.player, 'cheat'), false);
  assert.equal(M.enemies.spendCoins(-2), false); assert.equal(M.items.spend({ tool: 1 }), false);
  supplies(M); train(M, u.player, 'power');
  const wallet = M.enemies.getState().coins, stone = M.items.count('stone');
  assert.equal(u.buy(u.player, 'power'), false); assert.equal(u.offer(u.player, 'power').maxed, true);
  assert.equal(M.enemies.getState().coins, wallet); assert.equal(M.items.count('stone'), stone);
});

test('NPC training is individual, role appropriate, and leaves shared species definitions intact', () => {
  const { M } = training(), u = M.upgrades; supplies(M);
  const [builder, cow, stag, sheep] = M.animals.list;
  const base = sheep.def.walkSpeed;
  train(M, stag, 'power', 2); train(M, builder, 'craft'); train(M, builder, 'move');
  assert.ok(Math.abs(u.stats(stag).damage - 4 / 3) < 1e-9); assert.equal(u.stats(sheep).damage, 0); assert.equal(u.stats().damage, 0);
  assert.equal(u.stats(builder).craft, 1.75); assert.equal(u.stats(cow).craft, 1);
  assert.equal(u.buy(builder, 'power'), false); assert.equal(u.buy(stag, 'craft'), false);
  assert.equal(builder.def.walkSpeed, base, 'two sheep share definitions without sharing training');
  assert.equal(u.stats(builder).move, 2, 'fully trained fleet hooves double movement speed'); assert.equal(u.stats(sheep).move, 1);
});

test('nearby targeting respects talking distance, vertical distance and solid walls', () => {
  const { M } = training(), p = M.goat.group.position;
  for (const [i, animal] of M.animals.list.entries()) animal.group.position.set(p.x + 30 + i * 4, p.y, p.z);
  assert.equal(M.upgrades.nearest(), null);
  const [a, b] = M.animals.list;
  a.group.position.set(p.x + 4, p.y, p.z); b.group.position.set(p.x + 3, p.y, p.z);
  assert.equal(M.upgrades.nearest(), b);
  b.group.position.y += 6; assert.equal(M.upgrades.nearest(), a);
  M.world.blockedAt = () => true; assert.equal(M.upgrades.nearest(), null);
});

test('movement and cadence upgrades change the real player controller and timed impact', () => {
  const { M, input, controls } = training(); supplies(M);
  const p = M.goat.group.position;
  p.set(15, 14, 15); input.set(1, 0); controls.firstPerson = true;
  advancePlayer(M, 1); const baseDistance = p.x - 15;
  p.set(15, 14, 15); M.goat.state.speed = 0;
  train(M, M.upgrades.player, 'move'); advancePlayer(M, 1);
  assert.ok(p.x - 15 > baseDistance * 1.3, 'actual movement gains about 33%');
  input.set(0, 0); p.set(15, 14, 15); M.goat.state.yaw = 0;
  train(M, M.upgrades.player, 'cadence');
  const zombie = M.enemies.spawnAt({ x: 15, y: 14, z: 17 });
  M.goat.startHeadbutt(); advancePlayer(M, .1);
  assert.equal(zombie.hp, 1, 'faster windup deals its impact before the base 120ms');
  advancePlayer(M, .27); assert.equal(M.goat.state.headbuttCooldown, 0, 'faster recovery permits another strike');
});

test('reach and damage upgrades affect real attacks without hitting through walls', () => {
  const { M, controls } = training(); supplies(M);
  controls.firstPerson = true; M.goat.group.position.set(15, 14, 15); M.goat.state.yaw = 0;
  const zombie = M.enemies.spawnAt({ x: 15, y: 14, z: 18.5 });
  M.goat.startHeadbutt(); advancePlayer(M, .6); assert.equal(zombie.hp, 2, 'out of base reach');
  train(M, M.upgrades.player, 'reach', 2); train(M, M.upgrades.player, 'power', 2);
  M.goat.startHeadbutt(); advancePlayer(M, .2);
  assert.equal(M.enemies.zombies.includes(zombie), false, 'extended, two-and-a-third-damage horns kill in one strike');
  assert.equal(M.enemies.getState().coins, 1000 - 8 - 20 - 12 - 28, 'kill is only a physical pickup');
  assert.equal(M.items.drops.filter(drop => drop.userData.drop.kind === 'coin').length, 1);
});

test('hunter reach, damage and cadence training changes real NPC strikes', () => {
  const { M } = training(isolatedAnimal('Bramble')); supplies(M);
  const hunter = M.animals.list.find(a => a.name === 'Bramble');
  hunter.group.position.set(15, 14, 15); hunter.state.yaw = 0;
  const zombie = M.enemies.spawnAt({ x: 15, y: 14, z: 18.4 });
  train(M, hunter, 'reach'); train(M, hunter, 'power', 2); train(M, hunter, 'cadence');
  hunter.state.mode = 'hunt'; hunter.state.huntTarget = zombie;
  for (let i = 0; i < 20 && zombie.hp > 0; i++) M.animals.update(.02, i * .02);
  assert.ok(zombie.hp <= 0, 'hunter kills beyond its original reach in under 0.4 seconds');
});

test('builder work training accelerates the actual action and its block edit', () => {
  const { M, animal } = training(isolatedAnimal()); supplies(M); train(M, animal, 'craft');
  animal.group.position.set(15, 14, 15);
  animal.state.mode = 'break';
  animal.state.action = { kind: 'break', target: { bx: 8, by: 6, bz: 7, x: 17, z: 15 }, time: 0, duration: .8, hit: false };
  for (let i = 0; i < 9; i++) M.animals.update(.02, i * .02);
  assert.equal(animal.state.action.hit, true, 'trained impact occurs before the untrained 220ms windup');
  assert.equal(M.world.blockInfoAt(8, 6, 7), null, 'the real quarry block is removed');
  assert.equal(animal.state.carryCount, 1);
});

test('enemy coin loot stays in the world until picked up and needs no inventory slot', () => {
  const { M, THREE } = training();
  const p = new THREE.Vector3(15, 14, 15);
  const zombie = M.enemies.spawnAt(p, 'brute');
  M.enemies.attack(p, 0, true, { damage: 20 });
  assert.equal(M.enemies.zombies.includes(zombie), false); assert.equal(M.enemies.getState().coins, 0);
  assert.equal(M.items.drops[0].userData.drop.count, 4);
  for (let i = 1; i < 10; i++) M.items.slots[i] = { kind: 'stone', name: 'Stone', count: 1 };
  const collector = new THREE.Group(); collector.position.set(30, 14, 30);
  for (let i = 0; i < 40; i++) M.items.update(.05, i * .05, collector);
  assert.equal(M.enemies.getState().coins, 0, 'distance prevents automatic collection');
  const drop = M.items.drops[0]; collector.position.copy(drop.position); collector.position.y -= .9; collector.position.x += .8;
  const blocked = M.world.blockedAt; M.world.blockedAt = () => true;
  M.items.update(.05, 3, collector); assert.equal(M.enemies.getState().coins, 0, 'walls prevent collection');
  M.world.blockedAt = blocked;
  for (let i = 0; i < 30; i++) M.items.update(.05, 4 + i * .05, collector);
  assert.equal(M.enemies.getState().coins, 4); assert.equal(M.items.drops.length, 0);
  assert.equal(M.items.slots.filter(item => item?.kind === 'coin').length, 0);
});

test('coin stacks persist, preserve their total value and stay bounded through long sieges', () => {
  const { M, THREE } = training();
  for (let i = 0; i < 400; i++) M.items.dropCoins(new THREE.Vector3(i * 10, 14, 30), 2);
  assert.equal(M.items.drops.length, 160);
  assert.equal(M.items.drops.reduce((sum, drop) => sum + drop.userData.drop.count, 0), 800);
  const collector = new THREE.Group(); collector.position.set(-100, 14, -100);
  for (let i = 0; i < 40; i++) M.items.update(.05, i * .05, collector);
  assert.equal(M.enemies.getState().coins, 0);
});

test('coin stacks on opposite sides of a wall cannot merge their rewards through it', () => {
  const { M, THREE } = training();
  M.world.placeBlock('stone', 10, 7, 7); M.world.placeBlock('stone', 10, 8, 7);
  M.items.dropCoins(new THREE.Vector3(19.5, 14, 15), 1);
  M.items.dropCoins(new THREE.Vector3(22.5, 14, 15), 4);
  assert.equal(M.items.drops.length, 2, 'loot remains on its own side of the wall');
  const collector = new THREE.Group(); collector.position.set(19.5, 14, 15);
  for (let i = 0; i < 40; i++) M.items.update(.05, i * .05, collector);
  assert.equal(M.enemies.getState().coins, 1, 'only the reachable coin enters the wallet');
  assert.equal(M.items.drops[0].userData.drop.count, 4);
});
