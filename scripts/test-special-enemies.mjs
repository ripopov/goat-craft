import assert from 'node:assert/strict';
import test from 'node:test';
import { game } from './helpers/animal-game.mjs';

function defense() {
  const f = game(), { M, scene, load } = f;
  load('js/coin-model.js'); load('js/items.js'); M.items.init(scene); load('js/upgrades.js');
  load('js/towers.js'); M.towers.init(scene);
  M.goat.group.position.set(-24, 14, -24);
  M.animals.list.forEach((animal, i) => animal.group.position.set(-24 + i * 3, 14, -20));
  M.enemies.addCoins(1000); M.items.addItem('stone', 100);
  return f;
}
function step(M, seconds, extra) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) { M.enemies.update(1 / 60); if (extra) extra(i); }
}

test('specialist wave slots stay rare, unlock gradually and preserve early wave pacing', () => {
  const { M } = defense(), e = M.enemies;
  for (let wave = 1; wave <= 60; wave++) {
    if (wave === 30) continue; // Dedicated Worm swarm overrides the normal mixed roster.
    const roster = Array.from({ length: e.waveSize(wave) }, (_, slot) => e.typeForWave(wave, slot));
    for (const type of roster) assert.ok(e.types[type].unlock <= wave);
    const count = type => roster.filter(t => t === type).length;
    assert.ok(count('worm') <= Math.ceil(roster.length / 12));
    for (const type of ['binder', 'prismback', 'sower']) assert.ok(count(type) <= Math.ceil(roster.length / 20));
    assert.ok(roster.filter(t => ['worm', 'binder', 'prismback', 'sower'].includes(t)).length <= Math.ceil(roster.length * .25));
    const air = roster.filter((type, slot) => e.deliveryForWave(wave, slot, type) === 'parachute');
    assert.ok(wave >= 5 || !air.length);
    if ([20, 40, 60, 80].includes(wave)) assert.equal(air.length, roster.length);
    else assert.ok(air.length <= Math.ceil(roster.length / 10));
    if (wave === 5) assert.equal(air.length, 1, 'the first airdrop is a single readable introduction');
    if (wave >= 10) assert.ok(count('worm') > 0);
  }
  assert.equal(e.emergenceRadius, 36, 'dig-outs occur at twice the previous distance');
  assert.deepEqual([1, 2, 3].map(wave => e.waveSize(wave)), [6, 10, 14]);
  for (const wave of [30, 70]) {
    for (let slot = 0; slot < e.waveSize(wave); slot++) {
      assert.equal(e.typeForWave(wave, slot), 'worm', 'the entire special roster, including the usual wave-70 Boss');
      assert.equal(e.deliveryForWave(wave, slot, 'worm'), 'ground');
    }
    M.enemies.startWave(wave);
    M.enemies.update(.05);
    const enemy = M.enemies.zombies.at(-1);
    assert.equal(enemy.type, 'worm'); assert.equal(enemy.burrowed, true);
    const gate = M.hellGates.gates.find(gate => gate.id === enemy.gateId);
    assert.ok(gate); assert.ok(Math.hypot(enemy.position.x - gate.x, enemy.position.z - gate.z) < .4);
    assert.ok(enemy.position.y + enemy.body.height < gate.y);
    M.enemies.damageEnemy(enemy, enemy.hp);
  }
  for (const wave of [29, 31, 69, 71, 129, 131]) assert.equal(e.typeForWave(wave, 1), 'spider', 'neighboring waves keep their mix');
  for (const wave of [20, 40, 60, 80]) {
    for (let slot = 0; slot < e.waveSize(wave); slot++) assert.equal(e.deliveryForWave(wave, slot, e.typeForWave(wave, slot)), 'parachute');
    e.startWave(wave); e.update(.05);
    const enemy = e.zombies.at(-1);
    assert.equal(enemy.airborne, true); assert.equal(enemy.burrowed, undefined);
    assert.ok(enemy.position.y > enemy.landingY + 10);
    e.damageEnemy(enemy, enemy.hp);
  }
  // The all-air invasion preserves the mixed species roster. Even Worms
  // descend on a canopy and begin crawling after landing instead of digging.
  const airborne = Object.keys(e.types).map(type => e.spawnAt({ x: 23, y: 14, z: 23 }, type, { airborne: true }));
  for (const enemy of airborne) { assert.equal(enemy.airborne, true); assert.ok(!enemy.burrowed); }
  for (let i = 0; i < 88; i++) e.update(.05);
  for (const enemy of airborne) {
    assert.equal(enemy.airborne, false, enemy.type + ' landed');
    assert.equal(enemy.mode, 'recover', enemy.type + ' receives landing recovery');
    assert.ok(!enemy.burrowed, 'air-dropped Worms stay on the surface');
  }
});

test('airdrops enter actual wave five, remain vulnerable, and cannot bite before landing recovery', () => {
  const { M, scene } = defense(); M.hearthTree.damage = () => {};
  M.enemies.startWave(4); step(M, 2);
  assert.ok(M.enemies.zombies.every(e => !e.airborne));
  M.enemies.startWave(5); step(M, 2);
  const enemy = M.enemies.zombies.find(e => e.airborne);
  assert.ok(enemy); assert.ok(enemy.position.y > enemy.landingY + 10);
  assert.equal(enemy.mode, 'air'); assert.equal(enemy.bite, 0);
  assert.ok(scene.children.some(o => o.name === 'Enemy air signal'));
  const hp = enemy.hp;
  M.enemies.damageEnemy(enemy, .5, { origin: enemy.position });
  assert.equal(enemy.hp, hp - .5, 'descent is not invulnerability');
  step(M, 4);
  assert.equal(enemy.airborne, false); assert.equal(enemy.grounded, true);
  assert.equal(enemy.bite, 0, 'landing outside the core never deals a surprise hit');
  assert.ok(enemy.position.y >= enemy.landingY - .1);
  assert.ok(scene.getObjectByName('Enemy horde').count <= scene.getObjectByName('Enemy horde').instanceMatrix.count);
});

test('Worms excavate real covered tunnels, surface only within the doubled emergence band and allow an emergence response', () => {
  const { M, THREE } = defense();
  const cuts = [], original = M.world.breakBlockAt;
  M.world.breakBlockAt = function (bx, by, bz, opts) {
    const top = M.world.surfaceHeight((bx + .5) * 2, (bz + .5) * 2);
    const kind = original(bx, by, bz, opts);
    if (kind) cuts.push({ bx, by, bz, top }); return kind;
  };
  const enemy = M.enemies.spawnAt({ x: 51, y: 14, z: 1 }, 'worm');
  assert.equal(enemy.burrowed, true); assert.ok(enemy.position.y <= M.world.terrainHeight(51, 1) - 4);
  assert.equal(M.enemies.spellTargets(new THREE.Vector3(51, 14, 1), 30, 10).includes(enemy), false);
  assert.equal(M.enemies.isTargetable(enemy, enemy.position.clone()), true, 'underground defenders can intercept a visible tunnel');
  let emerging = false;
  for (let i = 0; i < 1200 && enemy.mode !== 'walk'; i++) {
    M.enemies.update(1 / 60);
    if (enemy.mode === 'emerge') {
      emerging = true;
      assert.ok(Math.hypot(enemy.position.x, enemy.position.z) <= M.enemies.emergenceRadius + .01, 'no early surface breach');
    }
    if (Math.hypot(enemy.position.x, enemy.position.z) > M.enemies.emergenceRadius)
      assert.ok(enemy.position.y + enemy.body.height < M.world.terrainHeight(enemy.position.x, enemy.position.z) - .5);
  }
  assert.ok(emerging); assert.equal(enemy.burrowed, false); assert.ok(enemy.recoverTime > 0);
  assert.ok(cuts.length > 6, 'the route contains real excavated voxels');
  const shaftX = enemy.emergence.x, shaftZ = enemy.emergence.z;
  for (const cell of cuts) {
    const radius = Math.hypot((cell.bx + .5) * 2, (cell.bz + .5) * 2);
    // The emergence shaft breaks the roof course where the Worm digs out;
    // every other cell beyond the tunnel's forecastle keeps a complete roof.
    const shaftCell = Math.abs((cell.bx + .5) * 2 - shaftX) <= 1.6 && Math.abs((cell.bz + .5) * 2 - shaftZ) <= 1.6;
    if (radius > 11.5 && !shaftCell) assert.ok((cell.by + 1) * 2 <= cell.top - 2, 'outer tunnel retains a complete roof course');
    assert.equal(M.world.isProtectedArea(cell.bx, cell.bz), false, 'Hearth foundation is untouched');
  }
  assert.ok(M.items.drops.length > 0, 'excavation leaves collectible resources');
  assert.ok(M.world.landingHeight(enemy.shaft.x, enemy.shaft.z, enemy.emergence.y + .1) >= enemy.emergence.y - 2,
    'settled excavation spoil leaves a one-block step rather than a trap for the following wave');
  const resources = M.items.drops.filter(drop => drop.userData.drop.kind !== 'coin').reduce((n, drop) => n + drop.userData.drop.count, 0);
  const restored = cuts.filter(cell => M.world.blockInfoAt(cell.bx, cell.by, cell.bz)?.placed).length;
  assert.equal(resources + restored, cuts.length, 'all excavation material is dropped or used for the exit step exactly once');
  const health = M.hearthTree.health; step(M, .5);
  assert.equal(M.hearthTree.health, health, 'the emergence/recovery telegraph allows a response');
  step(M, 3);
  assert.ok(enemy.position.y >= 13.9, 'the Worm clears the shaft rather than falling back into its tunnel');
});

test('digging a shaft reveals a rendered Worm and lets the real player controller kill it underground', () => {
  const { M, controls, scene, THREE } = defense();
  // A tougher Worm needs trained strikes to finish it before it leaves the
  // opened shaft. Exercise the real upgrade and controller damage path.
  for (let tier = 0; tier < 3; tier++) assert.ok(M.upgrades.buy(M.upgrades.player, 'power'));
  M.goat.group.position.set(25, 14, 1); controls.firstPerson = true; controls.getFacingYaw = () => Math.PI / 2;
  const enemy = M.enemies.spawnAt({ x: 29, y: 14, z: 1 }, 'worm');
  // A legal inner-band exit leaves time to intercept this manually placed Worm.
  enemy.emergence.set(19, 14, 1);
  assert.equal(M.enemies.spellTargets(M.goat.group.position, 9, 3).includes(enemy), false, 'unbroken soil occludes the buried model');
  const camera = M.goat.aimCamera; camera.position.set(25, 15.8, 1); camera.lookAt(25, 0, 1);
  M.goat.mine(); M.goat.mine();
  assert.equal(M.world.blockInfoAt(12, 6, 0), null, 'the player mines the real grass block');
  assert.equal(M.world.blockInfoAt(12, 5, 0), null, 'the player opens the shaft down to tunnel level');
  M.enemies.update(1 / 60);
  const mesh = scene.getObjectByName('Enemy horde'), matrix = new THREE.Matrix4();
  assert.ok(mesh.count > 20, 'the articulated Worm stays rendered throughout its burrow');
  mesh.getMatrixAt(0, matrix);
  assert.ok(matrix.elements[13] > 10 && matrix.elements[13] < 12, 'the model is physically inside the tunnel');
  for (let i = 0; i < 180 && enemy.hp > 0; i++) { M.enemies.update(1 / 60); M.goat.update(1 / 60, i / 60); }
  assert.equal(M.goat.group.position.y, 10);
  assert.equal(enemy.hp, 0, 'trained automatic attacks kill the exposed Worm');
  assert.equal(enemy.burrowed, true, 'the kill happens before the Worm surfaces');
  assert.ok(Math.hypot(enemy.position.x, enemy.position.z) > 10, 'the player intercepts it far from the tree');
  assert.ok(M.items.drops.some(drop => drop.userData.drop.kind === 'coin' && drop.position.y < 12), 'loot stays in the accessible tunnel');
});

test('wave-ten Worms spawn beneath their gate, tunnel inward and surface in the doubled emergence band', () => {
  const { M } = defense();
  M.hearthTree.damage = () => {};
  M.enemies.startWave(10);
  const lane = M.enemies.getState().spawnLanes[1];
  M.goat.group.position.set(lane.x, 14, lane.z);
  let worm;
  for (let i = 0; i < 400 && !worm; i++) { M.enemies.update(.05); worm = M.enemies.zombies.find(e => e.type === 'worm'); }
  assert.ok(worm);
  const gate = M.hellGates.gates.find(g => g.id === worm.gateId);
  assert.ok(gate);
  assert.ok(Math.hypot(worm.position.x - gate.x, worm.position.z - gate.z) < .2);
  assert.ok(worm.position.y + worm.body.height < gate.y - 2, 'the full body is under the permanent gate foundation');
  assert.equal(worm.burrowed, true);
  const goalDistance = Math.hypot(worm.emergence.x, worm.emergence.z);
  assert.ok(goalDistance >= 19 && goalDistance <= 36, 'both emergence bounds are doubled');
  for (let i = 0; i < 800 && worm.mode !== 'walk'; i++) M.enemies.update(.05);
  assert.equal(worm.burrowed, false); assert.equal(worm.mode, 'walk');
  assert.equal(worm.exploded, undefined);
  const distance = Math.hypot(worm.position.x, worm.position.z);
  assert.ok(distance >= 19 && distance <= 36);
  step(M, 3);
  assert.ok(Math.hypot(worm.position.x, worm.position.z) < distance, 'the surfaced Worm crawls toward the Hearth');
  for (const c of [...M.hellGates.cells, ...M.hellGates.roadCells])
    assert.equal(M.world.blockInfoAt(c.bx, c.by, c.bz)?.unbreakable, true);
});

test('Briar Binder charges before a temporary single-tower snare, and killing it clears the snare', () => {
  const { M } = defense();
  const tower = M.towers.place('frost', 8, 7, 8); assert.ok(tower);
  const enemy = M.enemies.spawnAt({ x: 21, y: 14, z: 17 }, 'binder'); enemy.abilityTimer = 0;
  step(M, .1); assert.equal(enemy.mode, 'chant'); assert.ok(enemy.snareTarget);
  assert.ok(!tower.snareTime, 'there is a real windup before the penalty');
  step(M, 1.3); assert.equal(tower.snareOwner, enemy); assert.equal(tower.snareTime, 3);
  tower.cooldown = 2;
  for (let i = 0; i < 60; i++) M.towers.update(1 / 60);
  assert.ok(Math.abs(tower.cooldown - 1.4) < 1e-8, 'the tower still fires at 60% cadence');
  M.enemies.damageEnemy(enemy, 100);
  assert.equal(tower.snareTime, 0, 'focus fire immediately releases the tower');
  const interrupted = M.enemies.spawnAt({ x: 21, y: 14, z: 17 }, 'binder'); interrupted.abilityTimer = 0;
  step(M, .2); M.enemies.damageEnemy(interrupted, 100); step(M, 1.5);
  assert.equal(tower.snareTime, 0, 'an interrupted chant never applies its delayed effect');
  const survivor = M.enemies.spawnAt({ x: 21, y: 14, z: 17 }, 'binder'); survivor.abilityTimer = 0;
  step(M, 1.5); assert.equal(tower.snareOwner, survivor);
  for (let i = 0; i < 190; i++) M.towers.update(1 / 60);
  assert.equal(tower.snareTime, 0, 'the snare expires naturally while its caster is alive');
  assert.equal(tower.snareOwner, null);
});

test('Prismback armor has directional counterplay and an exposed window after its telegraphed rush', () => {
  const { M, THREE } = defense();
  const enemy = M.enemies.spawnAt({ x: 15, y: 14, z: 15 }, 'prismback'); enemy.hp = 100; enemy.yaw = 0;
  M.enemies.damageEnemy(enemy, 4, { origin: new THREE.Vector3(15, 14, 20) });
  assert.ok(Math.abs(enemy.hp - 98.2) < 1e-9, 'front armor mitigates rather than blocks all damage');
  M.enemies.damageEnemy(enemy, 4, { origin: new THREE.Vector3(15, 14, 10) });
  assert.ok(Math.abs(enemy.hp - 94.2) < 1e-9, 'rear attacks bypass armor');
  M.enemies.damageEnemy(enemy, 4, { origin: new THREE.Vector3(15, 14, 20), area: true });
  assert.ok(Math.abs(enemy.hp - 90.2) < 1e-9, 'stomps and area damage are always usable counters');
  enemy.prismTimer = 0; step(M, .1); assert.equal(enemy.prismPhase, 'brace');
  step(M, 1.15); assert.equal(enemy.prismPhase, 'rush');
  step(M, 1.55); assert.equal(enemy.prismPhase, 'exposed');
  const hp = enemy.hp;
  M.enemies.damageEnemy(enemy, 4, { origin: enemy.position.clone().add(new THREE.Vector3(Math.sin(enemy.yaw) * 4, 0, Math.cos(enemy.yaw) * 4)) });
  assert.equal(hp - enemy.hp, 4, 'folded plates expose the front after rushing');
});

test('Mire Sower warns before a bounded slowing field; jumping, leaving and waiting all counter it', () => {
  const { M, THREE, input, controls } = defense();
  const enemy = M.enemies.spawnAt({ x: 15, y: 14, z: 15 }, 'sower'); enemy.abilityTimer = 0;
  step(M, .4); assert.equal(M.enemies.mudPools.length, 0, 'the outline precedes activation');
  step(M, .6); assert.equal(M.enemies.mudPools.length, 1);
  const center = M.enemies.mudPools[0].point;
  assert.equal(M.enemies.movementScale(center), .65);
  assert.equal(M.enemies.movementScale(center.clone().add(new THREE.Vector3(0, 2, 0))), 1, 'a bridge or jump is unaffected');
  assert.equal(M.enemies.movementScale(center.clone().add(new THREE.Vector3(2.5, 0, 0))), 1, 'the visible edge matches gameplay');
  controls.firstPerson = true; input.set(1, 0); M.goat.group.position.copy(center); M.goat.state.speed = 4.8 * .65;
  M.goat.update(.1, 0);
  assert.ok(M.goat.state.mired); assert.ok(M.goat.state.speed < 4.8 * .8, 'the real controller is slowed');
  M.enemies.damageEnemy(enemy, 100); step(M, 5.1);
  assert.equal(M.enemies.movementScale(center), 1); assert.equal(M.enemies.mudPools.length, 0);
});

test('a 200-unit special horde keeps effect pools, render matrices and rewards bounded', () => {
  const { M, scene } = defense(); M.hearthTree.damage = () => {};
  for (let i = 0; i < 200; i++) {
    const enemy = M.enemies.spawnAt({ x: 15, y: 14, z: 15 }, 'sower'); enemy.abilityTimer = 0;
  }
  step(M, 1.2);
  assert.equal(M.enemies.zombies.length, 200); assert.ok(M.enemies.mudPools.length <= 12); assert.ok(M.enemies.signals.length <= 64);
  const mesh = scene.getObjectByName('Enemy horde');
  assert.ok(mesh.count <= mesh.instanceMatrix.count);
  assert.ok(Array.from(mesh.instanceMatrix.array.subarray(0, mesh.count * 16)).every(Number.isFinite));
  for (const enemy of M.enemies.zombies.slice()) M.enemies.damageEnemy(enemy, 100);
  step(M, 6);
  assert.equal(M.enemies.signals.length, 0); assert.equal(M.enemies.mudPools.length, 0);
  assert.ok(M.items.drops.filter(drop => drop.userData.drop.kind === 'coin').length <= 160);
});
