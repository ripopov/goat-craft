import assert from 'node:assert/strict';
import test from 'node:test';
import { game, isolatedAnimal } from './helpers/animal-game.mjs';

function clearBody(M, animal) {
  const p = animal.group.position;
  return M.actorPhysics.clear(M.world, p.x, p.y, p.z, M.animals.bodyOf(animal));
}

test('progress monitor ignores idle animals and escalates only sustained blockage', () => {
  const { M } = game();
  const monitor = M.animalRecovery.create();
  const position = { x: 1, y: 14, z: 1 };
  for (let i = 0; i < 100; i++) M.animalRecovery.update(monitor, position, 'idle', false, .05);
  assert.equal(monitor.stage, 'clear');
  assert.equal(monitor.stagnant, 0);
  for (let i = 0; i < 8; i++) M.animalRecovery.update(monitor, position, 'walk', true, .05);
  assert.equal(monitor.stage, 'jump');
  for (let i = 0; i < 15; i++) M.animalRecovery.update(monitor, position, 'walk', true, .05);
  assert.equal(monitor.stage, 'detour');
  for (let i = 0; i < 22; i++) M.animalRecovery.update(monitor, position, 'walk', true, .05);
  assert.equal(monitor.stage, 'escape');
  position.x += .2;
  M.animalRecovery.update(monitor, position, 'walk', true, .05);
  assert.equal(monitor.stage, 'clear');
});

test('a walker jumps a one-block ledge without emergency relocation', () => {
  const { M, animal, advance, place, walkTo } = isolatedAnimal();
  animal.group.position.set(17, 14, 1);
  place(9, 0, 7, 7);
  walkTo(27, 1);
  advance(8);
  assert.ok(animal.group.position.x > 21, `x=${animal.group.position.x}`);
  assert.ok(['ledge', 'stuck-ledge'].includes(animal.state.jumpReason));
  assert.equal(animal.state.recovery.rescues, 0);
  assert.ok(clearBody(M, animal));
});

test('a walker digs through a tall solid wall and continues past it', () => {
  const { M, animal, advanceUntil, place, walkTo } = isolatedAnimal();
  animal.group.position.set(17, 14, 1);
  for (let z = -12; z <= 12; z++) place(9, z, 7, 9);
  walkTo(27, 1);
  const escaped = advanceUntil(30, () => animal.group.position.x > 21);
  assert.ok(escaped, JSON.stringify({ p: animal.group.position, recovery: animal.state.recovery, escape: animal.state.escape }));
  assert.ok([-1, 0, 1, 2].some(bz => !M.world.blockInfoAt(9, 7, bz)), 'a wall block was excavated');
  assert.equal(animal.state.recovery.rescues, 0);
  assert.ok(clearBody(M, animal));
});

test('a trapped builder digs and places steps to climb out of a deep pit', () => {
  const { M, animal, advanceUntil, walkTo } = isolatedAnimal('Clover');
  for (const [bx, bz] of [[9, 0], [9, 1], [10, 0], [10, 1]]) {
    M.world.breakBlockAt(bx, 6, bz, { drop: false });
    M.world.breakBlockAt(bx, 5, bz, { drop: false });
  }
  animal.group.position.set(19, 10, 1);
  animal.state.carryCount = 0;
  animal.state.carry = null;
  walkTo(27, 1);
  const escaped = advanceUntil(35, () => animal.group.position.y >= 13.9);
  assert.ok(escaped, JSON.stringify({ p: animal.group.position, recovery: animal.state.recovery, escape: animal.state.escape }));
  let placedStep = false;
  for (let bx = 9; bx <= 12; bx++) for (let bz = -1; bz <= 2; bz++) for (let by = 5; by <= 7; by++) {
    if (M.world.blockInfoAt(bx, by, bz)?.type === 'placed') placedStep = true;
  }
  assert.ok(placedStep, 'recovered material was placed as an escape step');
  assert.equal(animal.state.recovery.rescues, 0);
  assert.ok(clearBody(M, animal));
});

test('escape digging can open an enclosure made from placed blocks', () => {
  const { M, animal, advanceUntil, place, walkTo } = isolatedAnimal();
  animal.group.position.set(19, 14, 1);
  for (let bx = 8; bx <= 10; bx++) for (let bz = -1; bz <= 1; bz++) {
    if (bx === 9 && bz === 0) continue;
    place(bx, bz, 7, 8);
  }
  walkTo(27, 1);
  const escaped = advanceUntil(25, () => animal.group.position.x > 21);
  assert.ok(escaped, JSON.stringify({ p: animal.group.position, recovery: animal.state.recovery, escape: animal.state.escape }));
  assert.equal(animal.state.recovery.rescues, 0);
  assert.ok(clearBody(M, animal));
});

test('a roof that invalidates jumping leads to excavation instead of a jump loop', () => {
  const { M, animal, advanceUntil, place, walkTo } = isolatedAnimal();
  animal.group.position.set(17, 14, 1);
  for (let z = -8; z <= 8; z++) {
    place(9, z, 7, 7);
    place(9, z, 9, 9);
    place(8, z, 9, 9);
  }
  walkTo(27, 1);
  const escaped = advanceUntil(25, () => animal.group.position.x > 21);
  assert.ok(escaped, JSON.stringify({ p: animal.group.position, recovery: animal.state.recovery, escape: animal.state.escape }));
  assert.equal(animal.state.recovery.rescues, 0);
  assert.ok(clearBody(M, animal));
});

test('two animals detour around each other without digging or relocation', () => {
  const { M, animal, advance, walkTo } = isolatedAnimal();
  const other = M.animals.list.find(candidate => candidate.name === 'Poppy');
  animal.group.position.set(17, 14, 1);
  other.group.position.set(21, 14, 1);
  Object.assign(other.state, { mode: 'walk', wait: 0, buildTimer: 1000, pitTimer: 1000, retired: false });
  other.state.target.set(15, 14, 1);
  walkTo(25, 1);
  advance(8);
  assert.ok(animal.group.position.x > 19, `first x=${animal.group.position.x}`);
  assert.ok(other.group.position.x < 19, `second x=${other.group.position.x}`);
  assert.equal(animal.state.recovery.rescues, 0);
  assert.equal(other.state.recovery.rescues, 0);
  assert.equal(animal.state.escape, null);
  assert.equal(other.state.escape, null);
});

test('a hunter clears an obstacle and resumes attacking its zombie', () => {
  const { M, animal, advance, place } = isolatedAnimal('Bramble');
  animal.group.position.set(17, 14, 1);
  place(9, 0, 7, 7);
  const zombie = M.enemies.spawnAt(M.enemies.navigation.nodeAt(23, 14, 1));
  assert.ok(zombie);
  advance(12);
  assert.ok(zombie.hp < 2 || !M.enemies.zombies.includes(zombie));
  assert.equal(animal.state.recovery.rescues, 0);
  assert.ok(clearBody(M, animal));
});
