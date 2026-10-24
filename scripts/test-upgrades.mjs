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
  advancePlayer(M, .27); assert.equal(zombie.hp, 0, 'the automatic follow-up strike lands after the faster recovery');
});

test('reach and damage upgrades scale real electric strikes', () => {
  const { M, controls } = training(); supplies(M);
  controls.firstPerson = true; M.goat.group.position.set(15, 14, 15); M.goat.state.yaw = 0;
  const zombie = M.enemies.spawnAt({ x: 15, y: 14, z: 25 });
  M.goat.startHeadbutt(); advancePlayer(M, .6); assert.equal(zombie.hp, 2, 'out of base reach');
  train(M, M.upgrades.player, 'reach', 2); train(M, M.upgrades.player, 'power', 2);
  M.goat.startHeadbutt(); advancePlayer(M, .2);
  assert.equal(M.enemies.zombies.includes(zombie), false, 'the 12-block electric chain kills in one strike');
  assert.equal(M.enemies.getState().coins, 1000 - 8 - 20 - 12 - 28, 'kill is only a physical pickup');
  assert.equal(M.items.drops.filter(drop => drop.userData.drop.kind === 'coin').length, 1);
});

test('electric bolt targets the nearest enemy in range from any direction, one zap at tier 1', () => {
  const { M, controls } = training(); supplies(M);
  controls.firstPerson = true; M.goat.group.position.set(15, 14, 15); M.goat.state.yaw = 0; // facing +z
  const behind = M.enemies.spawnAt({ x: 15, y: 14, z: 12.4 });  // 2.6 away, behind the goat
  const ahead = M.enemies.spawnAt({ x: 15, y: 14, z: 17.8 });   // 2.8 away, ahead
  train(M, M.upgrades.player, 'reach', 1); // tier 1: 9 blocks, nearest, single target
  M.goat.startHeadbutt(); advancePlayer(M, .2);
  assert.equal(behind.hp, 1, 'the nearest enemy is struck even though the goat faces away');
  assert.equal(ahead.hp, 2, 'tier 1 strikes exactly one enemy');
});

test('tier 2 electric chain hits up to three enemies inside four blocks', () => {
  const { M, controls } = training(); supplies(M);
  controls.firstPerson = true; M.goat.group.position.set(15, 14, 15); M.goat.state.yaw = 0;
  const first = M.enemies.spawnAt({ x: 15, y: 14, z: 18.2 });
  const second = M.enemies.spawnAt({ x: 15, y: 14, z: 18.6 });
  const third = M.enemies.spawnAt({ x: 15, y: 14, z: 19.0 });
  const far = M.enemies.spawnAt({ x: 15, y: 14, z: 19.5 });
  train(M, M.upgrades.player, 'reach', 2);
  M.goat.startHeadbutt(); advancePlayer(M, .2);
  for (const enemy of [first, second, third]) assert.equal(enemy.hp, 1, 'chained inside the 4-block span');
  assert.equal(far.hp, 2, 'beyond four blocks is untouched');
});

test('tier 3 fireball reaches far and blasts everything in a 3-block radius', () => {
  const { M, controls } = training(); supplies(M);
  controls.firstPerson = true; M.goat.group.position.set(15, 14, 15); M.goat.state.yaw = 0;
  const main = M.enemies.spawnAt({ x: 15, y: 14, z: 26 });    // 11 away: far beyond melee and stomp
  const friend = M.enemies.spawnAt({ x: 15, y: 14, z: 27.4 }); // ~1.4 from impact, in the blast
  const far = M.enemies.spawnAt({ x: 15, y: 14, z: 30 });      // out of blast radius
  train(M, M.upgrades.player, 'reach', 3);
  M.goat.startHeadbutt(); advancePlayer(M, .9); // windup + ~0.7s flight
  assert.equal(main.hp, 1, 'fireball flies far to the nearest enemy');
  assert.equal(friend.hp, 1, 'blast radius swallows nearby enemies');
  assert.equal(far.hp, 2, 'enemies beyond the blast radius are safe');
});

test('automatic attacks never rotate the player; the facing stays mouse-controlled', () => {
  const { M, controls } = training(); supplies(M);
  controls.firstPerson = true;
  const p = M.goat.group.position; p.set(15, 14, 15); M.goat.state.yaw = 0; // facing +z
  const behind = M.enemies.spawnAt({ x: 15, y: 14, z: 9 }); // 6 units behind the goat
  advancePlayer(M, .2);
  assert.equal(M.goat.state.yaw, 0, 'the goat never turns toward a target');
  assert.equal(behind.hp, 2, 'melee does not reach behind; the player directs where the horns swing');
  advancePlayer(M, .3); // stomp impact at 0.36s pounds all around without any aiming
  assert.equal(behind.hp, 0, 'the automatic stomp still clears enemies behind without turning the goat');
});

test('enemies straight ahead are headbutted automatically with no input', () => {
  const { M, controls } = training(); supplies(M);
  controls.firstPerson = true;
  const p = M.goat.group.position; p.set(15, 14, 15); M.goat.state.yaw = 0; // facing +z
  const ahead = M.enemies.spawnAt({ x: 15, y: 14, z: 21 }); // 6 units ahead, inside tripled melee 8.4
  advancePlayer(M, .2);
  assert.equal(ahead.hp, 1, 'the automatic headbutt lands on what the player faces');
  assert.equal(M.goat.state.yaw, 0, 'the player direction is untouched');
});

test('automatic attacks idle without enemies and never mine anything', () => {
  const { M, controls } = training(); supplies(M);
  controls.firstPerson = true;
  M.goat.group.position.set(15, 14, 15); M.goat.state.yaw = 0;
  advancePlayer(M, .6);
  assert.equal(M.goat.state.headbutt, -1, 'no enemy, no lunge');
  assert.equal(M.goat.state.stomp, -1, 'no enemy, no stomp');
  assert.equal(M.world.placeBlock('stone', 7, 8, 9), true); // three voxels ahead, above the goat's head
  advancePlayer(M, .6);
  assert.ok(M.world.blockInfoAt(7, 8, 9), 'standing near blocks never mines them automatically');
});

test('spell targeting respects range and walls, and the blast burns around impact', () => {
  const { M } = training();
  const origin = { x: 15, y: 14, z: 15 };
  M.enemies.spawnAt({ x: 15, y: 14, z: 20.5 });  // 5.5 blocks: out of electro range and blast radius
  assert.equal(M.world.placeBlock('stone', 7, 7, 8), true, 'wall placed'); // spans z 16..18
  const close = M.enemies.spawnAt({ x: 15, y: 14, z: 18.6 }); // 3.6 away, behind the wall
  assert.equal(M.enemies.spellTargets(origin, 4, 3).length, 0, 'walls stop the bolt');
  M.world.breakBlockAt(7, 7, 8);
  const found = [...M.enemies.spellTargets(origin, 4, 3).map(e => e.position.z)];
  assert.deepEqual(found, [18.6], 'bolt finds the enemy in line');
  assert.equal(M.enemies.spellTargets(origin, 2, 3).length, 0, 'range limits the strike');
  // Blast: 3-block radius around the impact point, corners count somewhat.
  M.enemies.spellBlast({ x: 15, y: 14, z: 17 }, 3, 2);
  assert.equal(close.hp, 0, 'impact damage lands on the primary');
  assert.equal(M.enemies.zombies.length, 1, 'both enemies are gone: close via blast, far untouched');
  assert.equal(M.enemies.zombies[0].position.z, 20.5, 'the far enemy never entered target range');
});

test('hunter reach, damage and cadence training changes real NPC strikes', () => {
  const { M } = training(isolatedAnimal('Bramble')); supplies(M);
  const hunter = M.animals.list.find(a => a.name === 'Bramble');
  hunter.group.position.set(15, 14, 15); hunter.state.yaw = 0;
  const zombie = M.enemies.spawnAt({ x: 15, y: 14, z: 18.4 });
  train(M, hunter, 'reach'); train(M, hunter, 'power', 2); train(M, hunter, 'cadence');
  hunter.state.mode = 'hunt'; hunter.state.huntTarget = zombie;
  for (let i = 0; i < 20 && zombie.hp > 0; i++) {
    M.animals.update(.02, i * .02);
    if (M.goat.advanceSpellFx) M.goat.advanceSpellFx(.02, i * .02); // fireballs land in the shared FX tick
  }
  assert.ok(zombie.hp <= 0, 'hunter kills beyond its original reach in under 0.4 seconds, casting like the player');
});

test('trained hunters cast the same auto-aimed elemental strikes as the player', () => {
  const { M } = training(isolatedAnimal('Bramble')); supplies(M);
  const hunter = M.animals.list.find(a => a.name === 'Bramble');
  hunter.group.position.set(15, 14, 15); hunter.state.yaw = 0; // facing +z
  const behind = M.enemies.spawnAt({ x: 15, y: 14, z: 9 });  // 6 behind the hunter
  const ahead = M.enemies.spawnAt({ x: 15, y: 14, z: 19 });  // 4 ahead, the nearest
  train(M, hunter, 'reach', 2);
  assert.equal(M.upgrades.stats(hunter).reach, 12, 'hunter reach reports the chain range like the player');
  hunter.state.mode = 'hunt'; hunter.state.huntTarget = ahead;
  for (let i = 0; i < 15 && ahead.hp > 0; i++) {
    M.animals.update(.02, i * .02);
    if (M.goat.advanceSpellFx) M.goat.advanceSpellFx(.02, i * .02);
  }
  assert.equal(ahead.hp, 1, 'the chain strikes the nearest foe');
  assert.equal(behind.hp, 1, 'the arc auto-aims behind the hunter; no facing cone needed');
});

test('trained animals wear the same visible upgrades as the player goat', () => {
  const { M } = training(isolatedAnimal('Bramble')); supplies(M);
  const hunter = M.animals.list.find(a => a.name === 'Bramble');
  hunter.group.position.set(15, 14, 15);
  M.goat.group.position.set(15, 14, 2); // keep the goat away from the fight
  train(M, hunter, 'move', 3); train(M, hunter, 'reach', 3); train(M, M.upgrades.player, 'move', 3);
  for (let i = 0; i < 10; i++) M.animals.update(.1, i * .1);
  assert.equal(hunter.speedFx.level, 3, 'the stag spins wheel rims at tier 3 like the goat');
  assert.equal(hunter.hornFx.level, 3, 'the stag horns charge molten at tier 3');
  const rimCount = hunter.parts.legs.reduce((sum, leg) => sum + leg.hip.children.length, 0);
  assert.ok(rimCount > 4 * 2, 'wheel rims, hubs and bands are mounted on the stag legs');
  assert.equal(M.goat.speedStyle, 3, 'the player goat keeps its wheel rims after the shared refactor');
  const builder = M.animals.list.find(a => a.name === 'Mallow');
  assert.equal(builder.hornFx.level, 0, 'builders never train horns and keep plain antlers');
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
