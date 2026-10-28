import assert from 'node:assert/strict';
import test from 'node:test';
import { classicModules, isolatedAnimal } from './helpers/animal-game.mjs';

test('a small displacement revalidates a committed route without a terrain edit', () => {
  const { M, load } = classicModules();
  load('js/actor-physics.js');
  load('js/animal-navigation.js');
  const world = {
    revision: 0,
    bodySupportHeight: () => 14,
    bodyBlockedAt: (x, z, minY, maxY, radius) =>
      Math.abs(x) < 1 + radius && Math.abs(z) < 3 + radius
  };
  const nav = M.animalNavigation.create(world, { x: 0, z: 0 });
  const body = { radius: .5, height: 2, skin: .002 }, state = { retry: 0 };
  const goal = { x: 2, y: 14, z: 4 };
  nav.waypoint({ x: -2, y: 14, z: 4 }, goal, body, state);
  assert.equal(state.path.length, 0, 'initial direct route is open');
  const displaced = { x: -2, y: 14, z: 2 };
  assert.equal(nav.stepClear(displaced, goal, body), false, 'displacement puts a corner in the way');
  state.retry = 0;
  const target = nav.waypoint(displaced, goal, body, state);
  assert.ok(state.path.length > 0, 'replans even though displacement is less than four units');
  assert.ok(nav.stepClear(displaced, target, body), 'new segment goes around the corner');
});

test('every NPC rejects low-root destinations without jumping or excavating the Hearth', () => {
  const { M } = isolatedAnimal('Mallow', { seed: 42 });
  M.goat.group.position.set(24, 14, 24);
  const revision = M.world.revision;
  for (const animal of M.animals.list) {
    for (const [i, other] of M.animals.list.entries()) {
      other.group.position.set(-24 + i * 3, 14, -24);
      Object.assign(other.state, { mode: 'idle', wait: 1000, buildTimer: 1000, pitTimer: 1000 });
    }
    const body = M.animals.bodyOf(animal), goal = { x: -5, z: -1 };
    const floor = M.actorPhysics.support(M.world, goal, 16.01, body);
    assert.ok(floor > 14 && floor <= 16, 'destination is a low root, not the solid trunk');
    assert.ok(M.actorPhysics.clear(M.world, goal.x, floor, goal.z, body));
    animal.group.position.set(10, 14, 0);
    animal.state.target.set(goal.x, floor, goal.z);
    Object.assign(animal.state, { mode: 'walk', grounded: true, vy: 0, speed: 0, navigation: null });
    for (let i = 0; i < 20; i++) {
      M.animals.update(.05, i * .05);
      assert.equal(animal.state.jumpReason, null, animal.name + ' never starts a jump loop');
      assert.equal(animal.state.escape, null);
    }
    assert.equal(animal.state.mode, 'idle', animal.name + ' abandons the unreachable destination');
    assert.equal(animal.state.recovery.rescues, 0);
  }
  assert.equal(M.world.revision, revision, 'no excavation around protected roots');
});

test('an off-centre cow takes an open one-block corridor without mining its walls', () => {
  const { M, animal, place, walkTo, advanceUntil } = isolatedAnimal('Clover', { seed: 42 });
  M.goat.group.position.set(-30, 14, -30);
  for (let bx = 9; bx <= 13; bx++) {
    place(bx, 6, 7, 9);
    place(bx, 8, 7, 9);
  }
  const revision = M.world.revision;
  animal.group.position.set(15, 14, 13.8);
  walkTo(31, 15);
  let usedCorridor = false;
  assert.ok(advanceUntil(10, () => {
    const p = animal.group.position;
    if (p.x > 21 && p.x < 25 && p.z > 14 && p.z < 16) usedCorridor = true;
    assert.ok(M.actorPhysics.clear(M.world, p.x, p.y, p.z, M.animals.bodyOf(animal)));
    return Math.hypot(p.x - 31, p.z - 15) < .4;
  }));
  assert.ok(usedCorridor, 'finds the short passage despite the starting grid offset');
  assert.equal(animal.state.jumpReason, null);
  assert.equal(animal.state.recovery.rescues, 0);
  assert.equal(M.world.revision, revision);
});
