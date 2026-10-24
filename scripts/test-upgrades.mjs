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
  assert.equal(u.stats(builder).craft, 3.5, 'Fleet hooves doubles the Practiced builder work rate'); assert.equal(u.stats(cow).craft, 1);
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

test('each Quick strikes purchase immediately refits only the trained neck and releases old fittings', () => {
  const { M, THREE } = training(); supplies(M);
  const goatNeck = M.goat.headPivot.parent.children.find(node => node.geometry?.type === 'CylinderGeometry');
  const hunters = M.animals.list.filter(animal => animal.role === 'hunter');
  const models = [{ neck: goatNeck, head: M.goat.headPivot, target: M.upgrades.player },
    ...hunters.map(animal => ({ neck: animal.parts.neck, head: animal.parts.headPivot, target: animal }))];
  const builder = M.animals.list.find(animal => animal.role === 'builder');
  const builderScale = builder.parts.neck.scale.clone();
  const goatEyes = ['goat-eye-left', 'goat-eye-right'].map(name => M.goat.headPivot.getObjectByName(name));
  let previousShine = 0;
  for (const { neck, head, target } of models) {
    let previousLength = head.position.y;
    for (let tier = 1; tier <= 3; tier++) {
      const oldFittings = neck.getObjectByName('quick-strikes-' + (tier - 1));
      let disposed = 0, owned = 0;
      oldFittings?.traverse(node => {
        if (node.geometry) { owned++; node.geometry.addEventListener('dispose', () => disposed++); }
        if (node.material) { owned++; node.material.addEventListener('dispose', () => disposed++); }
      });
      train(M, target, 'cadence', 1);
      assert.equal(target === M.upgrades.player ? M.goat.neckStyle : target.neckFx.level, tier);
      assert.ok(neck.getObjectByName('quick-strikes-' + tier), 'new fittings appear before the next simulation tick');
      assert.ok(head.position.y > previousLength, 'every tier changes the actual neck silhouette');
      assert.ok(neck.scale.x > 1 && neck.scale.y > 1);
      if (oldFittings) { assert.equal(oldFittings.parent, null); assert.equal(disposed, owned); }
      assert.match(M.upgrades.offer(target, 'cadence').current, new RegExp(M.styleFx.neckStyle[tier].name));
      if (target === M.upgrades.player) {
        for (const eye of goatEyes) {
          const iris = eye.getObjectByName('eye-iris');
          assert.ok(iris.material.color.equals(new THREE.Color(M.styleFx.neckStyle[tier].color)), 'eyes match the neck tier immediately');
          assert.ok(iris.material.emissiveIntensity > previousShine, 'each tier adds more shine');
          assert.equal(eye.getObjectByName('eye-catchlight').material.type, 'MeshBasicMaterial', 'catchlights shine even at night');
          assert.equal(eye.getObjectByName('eye-star-shine').visible, tier === 3);
          assert.equal(eye.getObjectByName('eye-pupil').material.emissive.getHex(), 0, 'the pupil stays dark and readable');
        }
        previousShine = goatEyes[0].getObjectByName('eye-iris').material.emissiveIntensity;
      }
      previousLength = head.position.y;
    }
  }
  assert.ok(builder.parts.neck.scale.equals(builderScale), 'builders keep their original neck');
  assert.equal(builder.neckFx.level, 0);
  assert.equal(M.upgrades.buy(builder, 'cadence'), false);
});

test('Quick strikes tiers have distinct normalized motion, synchronized impacts and bounded recovery', () => {
  const { M, THREE } = training();
  const profiles = [];
  for (let tier = 1; tier <= 3; tier++) {
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(.17, .26, .58), M.std(0xffffff));
    neck.position.y = .25;
    const headPivot = new THREE.Group(); headPivot.position.y = .55;
    const fx = M.styleFx.makeNeckStyle(THREE);
    fx.apply(tier, { neck, headPivot });
    const restLength = headPivot.position.y;
    // The player headbutt, stomp and NPC hunter use different combat clocks.
    for (const [impact, end] of [[.12, .34], [.36, .54], [.16, .45]]) {
      const windup = { ...fx.animate(impact * .5, impact, end, false) };
      assert.equal(fx.animate(impact, impact, end, false).lunge, 1, 'the strongest pose coincides with damage');
      const extended = headPivot.position.y;
      fx.animate(impact, impact, end, true);
      assert.ok(Math.abs(headPivot.position.y - restLength) < Math.abs(extended - restLength), 'reduced motion limits extension');
      const quiet = fx.animate(impact * .5, impact, end, true);
      assert.ok(quiet.yaw === 0 && quiet.roll === 0, 'reduced motion removes sideways twists');
      const recovery = { ...fx.animate(impact + (end - impact) * .125, impact, end, false) };
      if (impact === .12) profiles.push([windup.lunge, windup.yaw, recovery.lunge, recovery.roll]);
      for (let i = 0; i <= 120; i++) {
        fx.animate(end * i / 120, impact, end, false);
        assert.ok(Number.isFinite(neck.scale.x + neck.scale.y + headPivot.position.y));
        assert.ok(headPivot.position.y > .4 && headPivot.position.y < 1, 'extension stays within the rig');
        assert.ok(Math.abs(headPivot.position.y / .55 - neck.position.y / .25) < 1e-9, 'head stays attached to the extending neck');
      }
      fx.animate(-1, impact, end, false);
      assert.equal(headPivot.position.y, restLength, 'no drift after recovery');
    }
    fx.dispose();
    assert.equal(headPivot.position.y, .55);
    assert.equal(neck.scale.y, 1);
  }
  assert.equal(new Set(profiles.map(profile => JSON.stringify(profile))).size, 3, 'tiers change the motion shape, beyond playing faster');
});

test('player headbutts, stomps and both hunter species drive their upgraded neck rigs', () => {
  const { M, controls } = training(); supplies(M); controls.firstPerson = true;
  M.goat.group.position.set(15, 14, 15);
  for (let tier = 1; tier <= 3; tier++) {
    train(M, M.upgrades.player, 'cadence', 1);
    const rate = M.upgrades.stats().rate, rest = M.goat.headPivot.position.y;
    Object.assign(M.goat.state, { headbutt: .06 - .001 * rate, stomp: -1, headbuttCooldown: 10, stompCooldown: 10 });
    M.goat.update(.001, 0);
    const jab = M.goat.headPivot.position.y;
    assert.notEqual(jab, rest, 'headbutt animates neck extension');
    Object.assign(M.goat.state, { headbutt: -1, stomp: .18 - .001 * rate });
    M.goat.update(.001, 0);
    assert.equal(M.goat.headPivot.position.y, jab, 'stomp windup uses the same tier motion on its own clock');
  }
  M.goat.group.position.set(-20, 14, -20);
  for (const hunter of M.animals.list.filter(animal => animal.role === 'hunter')) {
    const zombie = M.enemies.spawnAt({ x: 15, y: 14, z: 18 });
    for (let tier = 1; tier <= 3; tier++) {
      train(M, hunter, 'cadence', 1);
      const rest = hunter.parts.headPivot.position.y, rate = M.upgrades.stats(hunter).rate;
      hunter.group.position.set(15, 14, 15);
      Object.assign(hunter.state, { mode: 'hunt', huntTarget: zombie, strikeTime: .08 - .001 * rate, attackCooldown: 10 });
      M.animals.update(.001, 0);
      assert.notEqual(hunter.parts.headPivot.position.y, rest, hunter.species + ' animates its trained neck');
    }
  }
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

test('Fleet hooves speeds up gathering and building at every tier without granting free blocks', () => {
  for (const name of ['Mallow', 'Clover']) {
    const { M, animal } = training(isolatedAnimal(name)); supplies(M);
    animal.group.position.set(15, 14, 15);
    const dt = 1 / 600, timings = [];
    function action(kind, bx, by, bz, duration) {
      const job = { kind, target: { bx, by, bz, x: bx * 2 + 1, z: bz * 2 + 1 }, time: 0, duration, hit: false };
      Object.assign(animal.state, { mode: kind, action: job });
      let elapsed = 0, impact = 0;
      for (let i = 0; i < 1000 && animal.state.action; i++) {
        M.animals.update(dt, elapsed); elapsed += dt;
        if (!impact && job.hit) impact = elapsed;
      }
      assert.equal(animal.state.action, null, name + ' finishes the action');
      return { elapsed, impact, result: job.result };
    }
    const sources = [[8, 7], [7, 8], [6, 7], [7, 6]];
    const destinations = [[9, 9], [9, 8], [8, 9], [9, 7]];
    for (let tier = 0; tier <= 3; tier++) {
      if (tier) train(M, animal, 'move', 1);
      const [sx, sz] = sources[tier], [bx, bz] = destinations[tier];
      assert.equal(M.world.blockInfoAt(bx, 7, bz), null);
      assert.equal(action('place', bx, 7, bz, .68).result, 'failed', 'an empty builder cannot place blocks');
      assert.equal(M.world.blockInfoAt(bx, 7, bz), null, 'speed never creates free construction material');
      const mined = action('break', sx, 6, sz, .62);
      assert.equal(mined.result, 'broke');
      assert.equal(M.world.blockInfoAt(sx, 6, sz), null, 'resources are removed from the actual world');
      assert.equal(animal.state.carryCount, 1);
      const material = animal.state.carry;
      const placed = action('place', bx, 7, bz, .68);
      assert.equal(placed.result, 'placed');
      assert.equal(M.world.blockInfoAt(bx, 7, bz).kind, material);
      assert.equal(animal.state.carryCount, 0, 'placing consumes the gathered block');
      assert.equal(animal.state.carry, null);
      const rate = 1 + tier / 3;
      for (const [timing, duration] of [[mined, .62], [placed, .68]]) {
        assert.ok(Math.abs(timing.elapsed - duration / rate) < dt * 2, name + ' completes work at the tier speed');
        assert.ok(Math.abs(timing.impact - .22 / rate) < dt * 2, 'the real block edit is accelerated too');
      }
      timings.push([mined.elapsed, placed.elapsed]);
    }
    for (let kind = 0; kind < 2; kind++) {
      assert.ok(Math.abs(timings[0][kind] - timings[3][kind] * 2) < dt * 3, name + ' gathers and builds twice as fast at tier 3');
    }
    assert.equal(M.items.drops.length, 0, 'gathered resources go into the builder carry stack');
  }
});

test('builder Fleet hooves accelerates work waits, stacks with Practiced builder and stays individual', () => {
  const { M, animal } = training(isolatedAnimal()); supplies(M);
  const hunter = M.animals.list.find(a => a.role === 'hunter');
  train(M, animal, 'move'); train(M, hunter, 'move'); train(M, M.upgrades.player, 'move');
  assert.equal(M.upgrades.stats(animal).craft, 2);
  assert.equal(M.upgrades.stats(hunter).craft, 1, 'hunter movement does not boost work');
  assert.equal(M.upgrades.stats().craft, 1, 'player movement does not boost work');
  const otherBuilder = M.animals.list.find(a => a.role === 'builder' && a !== animal);
  assert.equal(M.upgrades.stats(otherBuilder).craft, 1, 'the other builder keeps its original work speed');
  const offer = M.upgrades.offer(animal, 'move');
  assert.match(offer.current, /100% movement, gathering & building speed/);
  assert.match(offer.description, /consumes gathered blocks/);
  for (const [craftTiers, rate] of [[0, 2], [3, 3.5]]) {
    if (craftTiers) train(M, animal, 'craft', craftTiers);
    assert.equal(M.upgrades.stats(animal).craft, rate);
    Object.assign(animal.state, { mode: 'idle', wait: 10, actionTimer: 10, buildTimer: 10 });
    M.animals.update(.1, 0);
    for (const timer of ['wait', 'actionTimer', 'buildTimer']) {
      assert.ok(Math.abs(animal.state[timer] - (10 - .1 * rate)) < 1e-9, timer + ' uses the combined work rate');
    }
  }
});

test('Heavy horns tiers enlarge horns and restyle beards without disturbing elemental training', () => {
  const { M } = training(); supplies(M);
  const goatHorns = ['goat-horn-left', 'goat-horn-right'].map(name => M.goat.headPivot.getObjectByName(name));
  const goatBeard = M.goat.headPivot.getObjectByName('goat-beard');
  const originalTufts = goatBeard.children.slice();
  const actors = [{ target: M.upgrades.player, horns: goatHorns, beard: goatBeard },
    ...M.animals.list.filter(a => a.role === 'hunter').map(a => ({ target: a, horns: a.parts.horns.map(h => h.mesh), beard: a.parts.beard }))];
  for (const [i, { target, horns, beard }] of actors.entries()) {
    if (i === 0) train(M, target, 'reach'); // elemental glow before horn growth
    let previousSize = 1;
    for (let tier = 1; tier <= 3; tier++) {
      const old = beard.getObjectByName('heavy-horns-beard-' + (tier - 1));
      let owned = 0, disposed = 0;
      old?.traverse(node => {
        for (const resource of [node.geometry, node.material].filter(Boolean)) {
          owned++; resource.addEventListener('dispose', () => disposed++);
        }
      });
      train(M, target, 'power', 1);
      assert.ok(horns.every(h => h.scale.y > previousSize && h.scale.x > 1), 'every horn and antler branch grows');
      assert.ok(beard.getObjectByName('heavy-horns-beard-' + tier), 'each purchase changes the beard immediately');
      if (old) { assert.equal(old.parent, null); assert.equal(disposed, owned); }
      previousSize = horns[0].scale.y;
    }
    if (i > 0) {
      train(M, target, 'reach'); // elemental glow after horn growth
      M.animals.update(.001, 0);
    }
    assert.ok(horns[0].children.length > 0, 'elemental tips and bands stay attached');
    const before = horns[0].scale.clone();
    if (target === M.upgrades.player) M.goat.applyPowerStyle(3);
    else target.powerFx.apply(3, target.powerCtx);
    assert.ok(horns[0].scale.equals(before), 'reapplying the style never compounds growth');
  }
  assert.ok(originalTufts.every(tuft => !tuft.visible), 'the original tuft gives way to the upgraded beard');
  assert.ok(M.animals.list.filter(a => a.role === 'builder').every(a => a.powerFx.level === 0));
  M.goat.applyPowerStyle(0);
  assert.ok(goatHorns.every(h => h.scale.x === 1 && h.scale.y === 1));
  assert.ok(originalTufts.every(tuft => tuft.visible), 'reset restores the original beard');
});

test('Heavy horns makes bolts and fireballs progressively thicker and shinier while preserving spell damage', () => {
  const { M, THREE, scene } = training();
  const origin = new THREE.Vector3(15, 14, 15);
  const enemy = M.enemies.spawnAt({ x: 15, y: 14, z: 21 }); enemy.hp = 1000;
  let radius = 0, glow = 0, ballSize = 0;
  for (let tier = 0; tier <= 3; tier++) {
    let hp = enemy.hp;
    assert.equal(M.goat.castSpellAt(origin, 1, 1, undefined, tier), true);
    assert.equal(hp - enemy.hp, 1, 'visual strength never adds damage of its own');
    const bolt = scene.getObjectByName('spell-bolt');
    if (tier) {
      const core = bolt.getObjectByName('spell-bolt-core'), halo = bolt.getObjectByName('spell-bolt-halo');
      assert.ok(core.geometry.parameters.radius > radius);
      assert.ok(halo.material.opacity > glow);
      assert.equal(halo.material.blending, THREE.AdditiveBlending);
      assert.equal(core.material.toneMapped, false, 'the bright core stays luminous at night');
      radius = core.geometry.parameters.radius; glow = halo.material.opacity;
    }
    let owned = 0, disposed = 0;
    bolt.traverse(node => {
      if (node.geometry) { owned++; node.geometry.addEventListener('dispose', () => disposed++); }
      if (tier && node.material) { owned++; node.material.addEventListener('dispose', () => disposed++); }
    });
    M.goat.advanceSpellFx(.4, 0);
    assert.equal(scene.getObjectByName('spell-bolt'), undefined);
    assert.equal(disposed, owned, 'expired lightning releases its tubes and materials');
    hp = enemy.hp;
    assert.equal(M.goat.castSpellAt(origin, 3, 1, undefined, tier), true);
    const ball = scene.getObjectByName('spell-fireball');
    assert.ok(ball.scale.x > ballSize, 'fireballs become wider at every tier');
    ballSize = ball.scale.x;
    if (tier) assert.equal(ball.getObjectByName('spell-fireball-halo').material.opacity, glow);
    M.goat.advanceSpellFx(.05, .05);
    assert.equal(ball.userData.powerLevel, tier, 'a flying projectile retains its cast-time style');
    M.goat.advanceSpellFx(1, 1);
    assert.equal(hp - enemy.hp, 1, 'the upgraded blast keeps its original damage');
    assert.equal(scene.getObjectByName('spell-fireball'), undefined);
    M.goat.advanceSpellFx(1, 2);
  }
  for (const z of [21.5, 22]) { const target = M.enemies.spawnAt({ x: 15, y: 14, z }); target.hp = 1000; }
  M.goat.castSpellAt(origin, 2, 1, undefined, 3);
  assert.equal(scene.children.filter(node => node.name === 'spell-bolt').length, 3, 'every chain link receives the upgraded effect');
  for (let i = 0; i < 60; i++) M.goat.castSpellAt(origin, 2, 1, undefined, 3);
  assert.ok(scene.children.filter(node => ['spell-bolt', 'spell-flash'].includes(node.name)).length <= 64);
  assert.ok(scene.children.filter(node => node.name === 'spell-spark').length <= 160, 'particles stay bounded during repeated casts');
  M.goat.advanceSpellFx(2, 4);
  assert.ok(scene.children.filter(node => node.name === 'spell-spark').every(node => !node.visible));
  M.config.reducedMotion = true;
  const hp = enemy.hp;
  M.goat.castSpellAt(origin, 3, 1, undefined, 3);
  assert.equal(scene.getObjectByName('spell-fireball'), undefined, 'reduced motion suppresses the added visual motion');
  M.goat.advanceSpellFx(1, 5);
  assert.equal(hp - enemy.hp, 1, 'reduced motion still deals normal damage');
});

test('automatic player and hunter spells use their individual Heavy horns visual tiers', () => {
  const { M, scene, controls } = training(isolatedAnimal('Bramble')); supplies(M);
  const hunter = M.animals.list.find(a => a.name === 'Bramble');
  train(M, M.upgrades.player, 'power'); train(M, M.upgrades.player, 'reach', 1);
  train(M, hunter, 'power', 1); train(M, hunter, 'reach', 1);
  controls.firstPerson = true;
  M.goat.group.position.set(15, 14, 15);
  hunter.group.position.set(-20, 14, -20);
  const enemy = M.enemies.spawnAt({ x: 15, y: 14, z: 21 }); enemy.hp = 1000;
  advancePlayer(M, .2);
  assert.equal(scene.getObjectByName('spell-bolt').userData.powerLevel, 3);
  M.goat.advanceSpellFx(.4, .6);
  M.goat.group.position.set(-20, 14, -20); hunter.group.position.set(15, 14, 15);
  Object.assign(hunter.state, { mode: 'hunt', huntTarget: enemy, strikeTime: .15, attackCooldown: 10 });
  M.animals.update(.02, .7);
  assert.equal(scene.getObjectByName('spell-bolt').userData.powerLevel, 1, 'the hunter does not inherit the player visual tier');
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
