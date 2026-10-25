import assert from 'node:assert/strict';
import test from 'node:test';
import { classicModules, game } from './helpers/animal-game.mjs';

const step = (M, seconds) => { for (let i = 0; i < Math.ceil(seconds / .05); i++) M.enemies.update(.05); };

test('sea raids unlock at four, reserve complete crews and override delivery only on 15, 35 and 75', () => {
  const { M, load } = classicModules(); load('js/enemy-rules.js');
  const rules = M.enemyRules;
  for (let wave = 1; wave <= 150; wave++) {
    const size = rules.waveSize(wave), sea = [];
    for (let slot = 0; slot < size; slot++) {
      const type = rules.typeForWave(wave, slot), delivery = rules.deliveryForWave(wave, slot, type);
      if (delivery === 'boat') sea.push(slot);
      if (wave < 4) { assert.notEqual(type, 'raider'); assert.notEqual(delivery, 'boat'); }
      if ([15, 35, 75].includes(wave)) assert.equal(delivery, 'boat');
      else if ([20, 40, 60, 80].includes(wave)) assert.equal(delivery, 'parachute');
      else if (type === 'worm') assert.equal(delivery, 'ground', 'ordinary Worms keep their tunnels');
    }
    assert.equal(sea.length % 4, 0);
    for (let i = 0; i < sea.length; i += 4) assert.deepEqual(sea.slice(i, i + 4), [0, 1, 2, 3].map(j => sea[i] + j));
    if (wave >= 4 && ![20, 30, 40, 60, 70, 80, 130].includes(wave)) assert.ok(sea.length >= 4);
    assert.ok(size <= 200);
  }
  assert.deepEqual([15, 35, 75].map(rules.waveSize), [64, 144, 200]);
  assert.match(rules.introduction(4), /Sea Raiders/);
  for (const wave of [15, 35, 75]) assert.match(rules.introduction(wave), /Sea invasion/);
});

test('real ocean crews sail, remain vulnerable, jump ashore, march to the Hearth and release their boats', async t => {
  const { M, scene } = game({ seed: 42, renderRadius: 0 }), e = M.enemies;
  M.hearthTree.damage = () => {}; e.beginFrame();
  let crew, boat;
  await t.test('wave four adds four sea raiders without replacing the other gate arrivals', () => {
    e.startWave(4);
    let ground = 0;
    for (let i = 0; i < 160 && !e.boats.length; i++) {
      e.update(.05);
      for (const enemy of e.zombies.slice()) if (!enemy.boat) { ground++; e.damageEnemy(enemy, enemy.hp); }
    }
    assert.equal(ground, 4);
    boat = e.boats[0]; assert.ok(boat); crew = boat.crew;
    assert.equal(crew.length, 4); assert.ok(crew.every(enemy => enemy.type === 'raider' && enemy.boat === boat));
    const water = M.world.waterInfoAtBlock(Math.floor(boat.position.x / 2), Math.floor(boat.position.z / 2));
    assert.equal(water.type, 'sea'); assert.ok(water.depth >= 4);
    assert.equal(e.getState().pending, e.waveSize(4) - 8, 'one launch consumes exactly four roster slots');
    assert.match(e.getState().approaches, /Sea/);
    assert.equal(new Set(crew.map(enemy => enemy.position.x + '/' + enemy.position.z)).size, 4);
    const hp = crew[0].hp;
    assert.equal(e.damageEnemy(crew[0], 1), false); assert.equal(crew[0].hp, hp - 1);
    const before = Math.hypot(boat.position.x, boat.position.z), seats = crew.map(enemy => enemy.position.clone());
    step(M, 1);
    assert.ok(Math.hypot(boat.position.x, boat.position.z) < before - 6);
    crew.forEach((enemy, i) => { assert.ok(enemy.position.distanceTo(seats[i]) > 6); assert.equal(enemy.bite, 0); });
    e.syncRender(); e.beginFrame();
    const hull = scene.getObjectByName('Enemy landing boats'); assert.ok(hull.count > 0);
    assert.ok(hull.count <= hull.instanceMatrix.count); assert.ok(hull.instanceMatrix.array.every(Number.isFinite));
  });
  await t.test('crews disembark before the hull collapses, then walk and attack normally', () => {
    let jumped = false, collapsed = false;
    for (let i = 0; i < 1450 && crew.some(enemy => enemy.mode !== 'tree'); i++) {
      e.update(.05);
      for (const enemy of e.zombies.slice()) if (!crew.includes(enemy)) e.damageEnemy(enemy, enemy.hp);
      if (crew.some(enemy => enemy.boatExit)) { jumped = true; assert.ok(crew.every(enemy => !enemy.boat)); }
      if (boat.collapse > 0 && boat.collapse < .9) collapsed = true;
    }
    assert.ok(jumped); assert.ok(collapsed); assert.ok(!e.boats.includes(boat));
    assert.ok(crew.every(enemy => enemy.mode === 'tree' && enemy.hp > 0 && !enemy.exploded));
    for (const enemy of crew) e.damageEnemy(enemy, enemy.hp);
    step(M, 1); e.syncRender(); e.beginFrame(); assert.equal(scene.getObjectByName('Enemy landing boats').count, 0);
  });
  await t.test('all three sea invasions deliver their exact roster in full boats, including surface Worms and the Boss', () => {
    for (const wave of [15, 35, 75]) {
      e.startWave(wave); const seen = new Set(), ships = new Set();
      for (let i = 0; i < 2700 && e.getState().pending; i++) {
        e.update(.05);
        for (const enemy of e.zombies.slice()) {
          assert.ok(enemy.boat); assert.ok(!enemy.airborne && !enemy.burrowed && !enemy.gateId);
          seen.add(enemy); ships.add(enemy.boat); e.damageEnemy(enemy, enemy.hp);
        }
      }
      assert.equal(e.getState().pending, 0); assert.equal(seen.size, e.waveSize(wave));
      assert.equal(ships.size, seen.size / 4); assert.ok([...ships].every(ship => ship.crew.length === 4));
      assert.ok([...seen].some(enemy => enemy.type === 'worm'));
      if (wave === 35) assert.equal([...seen].filter(enemy => enemy.type === 'boss').length, 1);
      step(M, 1); assert.equal(e.boats.length, 0);
    }
  });
  await t.test('mixed crews cross the paved shore bridges at 60 Hz without stranding short swimmers', () => {
    e.startWave(15); e.update(1 / 60);
    const mixed = e.boats[0].crew; assert.ok(mixed.some(enemy => enemy.type === 'spider'));
    for (let i = 0; i < 4500 && mixed.some(enemy => enemy.mode !== 'tree'); i++) {
      e.update(1 / 60);
      for (const enemy of e.zombies.slice()) if (!mixed.includes(enemy)) e.damageEnemy(enemy, enemy.hp);
    }
    assert.ok(mixed.every(enemy => enemy.mode === 'tree' && enemy.hp > 0 && !enemy.exploded));
    for (const enemy of mixed) e.damageEnemy(enemy, enemy.hp);
    step(M, 1);
  });
  await t.test('a boat waits for four free living slots and never launches a partial crew', () => {
    for (let i = 0; i < 197; i++) e.spawnAt({ x: 23, y: 14, z: 23 }, 'zombie');
    e.startWave(15); step(M, .1);
    assert.equal(e.zombies.length, 197); assert.equal(e.getState().pending, 64); assert.equal(e.boats.length, 0);
    e.damageEnemy(e.zombies[0], 1000); step(M, .55);
    assert.equal(e.zombies.length, 200); assert.equal(e.getState().pending, 60); assert.equal(e.boats[0].crew.length, 4);
    for (const enemy of e.zombies.slice()) e.damageEnemy(enemy, enemy.hp);
    // Replace the pending sea invasion before exercising an isolated landing.
    e.startWave(1); step(M, 1);
    for (const enemy of e.zombies.slice()) e.damageEnemy(enemy, enemy.hp);
  });
  await t.test('building over a landing cannot teleport passengers into walls, and their empty boat disappears', () => {
    e.startWave(15); e.update(.05);
    const ship = e.boats[0], passengers = ship.crew;
    let placed = 0;
    for (const land of ship.land) {
      M.world.update(land, 0, 0); // Construction, like player input, requires a streamed chunk.
      for (let y = Math.floor(land.y / 2); y < Math.floor(land.y / 2) + 3; y++) {
        if (M.world.placeBlock('stone', land.bx, y, land.bz)) placed++;
      }
    }
    assert.ok(placed > 0);
    ship.position.copy(ship.path.at(-2)); ship.cursor = ship.path.length - 1;
    step(M, 1.7);
    assert.ok(!e.boats.includes(ship));
    for (const enemy of passengers) {
      assert.ok(!enemy.boat && !enemy.boatExit);
      assert.ok(M.actorPhysics.clear(M.world, enemy.position.x, enemy.position.y, enemy.position.z, enemy.body));
    }
  });
});
