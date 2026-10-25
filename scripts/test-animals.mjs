import assert from 'node:assert/strict';
import test from 'node:test';
import { game } from './helpers/animal-game.mjs';

function advanceAnimals(M, seconds) {
  for (let i = 0; i < Math.round(seconds / .05); i++) M.animals.update(.05, i * .05);
}

test('the four starting animals have two hunter and two builder roles', () => {
  const { M } = game();
  assert.equal(M.animals.list.length, 4);
  assert.deepEqual(Array.from(M.animals.list, animal => [animal.name, animal.role]), [
    ['Mallow', 'builder'], ['Clover', 'builder'], ['Bramble', 'hunter'], ['Poppy', 'hunter']
  ]);
});

test('hunters chase and headbutt zombies while builders stay on their tasks', () => {
  const { M } = game();
  const hunter = M.animals.list.find(animal => animal.role === 'hunter');
  for (const animal of M.animals.list) {
    Object.assign(animal.state, { mode: 'idle', wait: 1000, buildTimer: 1000, pitTimer: 1000 });
  }
  hunter.group.position.set(9, 14, 27);
  const zombie = M.enemies.spawnAt(M.enemies.navigation.nodeAt(9, 14, 25));
  assert.ok(zombie);
  advanceAnimals(M, 2);
  assert.ok(zombie.hp < 2 || !M.enemies.zombies.includes(zombie), 'hunter damaged the zombie');
  assert.equal(hunter.state.project, null);
  advanceAnimals(M, 2);
  assert.equal(M.enemies.zombies.includes(zombie), false);
  assert.equal(M.enemies.getState().coins, 0, 'hunter kills leave loot for the player to collect');
});

test('builders complete ten-block walls outside the tree exclusion and repair missing blocks', () => {
  const { M } = game();
  const builder = M.animals.list.find(animal => animal.name === 'Mallow');
  M.animals.list.forEach((animal, i) => {
    if (animal === builder) return;
    animal.group.position.set(-20 + i * 3, 14, -18);
    Object.assign(animal.state, { mode: 'idle', wait: 1000, buildTimer: 1000, pitTimer: 1000, retired: true });
  });

  let wall = null;
  for (let i = 0; i < 6000 && !wall; i++) {
    M.animals.update(.05, i * .05);
    wall = builder.state.walls[0] || null;
  }
  assert.ok(wall, JSON.stringify({ mode: builder.state.mode, abandon: builder.state.lastAbandon,
    carry: builder.state.carryCount, position: builder.group.position, gathering: builder.state.gathering,
    batchGoal: builder.state.batchGoal, wait: builder.state.wait, buildTimer: builder.state.buildTimer,
    project: builder.state.project && { steps: builder.state.project.stepCount,
      missing: builder.state.project.plan.filter(target => !M.world.blockInfoAt(target.bx, target.by, target.bz)) } }));
  assert.equal(wall.plan.length, 20);
  const xs = new Set(wall.plan.map(target => target.bx));
  const zs = new Set(wall.plan.map(target => target.bz));
  const ys = new Set(wall.plan.map(target => target.by));
  assert.equal(xs.size, 10);
  assert.equal(zs.size, 1);
  assert.equal(ys.size, 2);
  for (const target of wall.plan) {
    assert.ok(Math.hypot(target.x - M.hearthTree.position.x, target.z - M.hearthTree.position.z) >= 20);
    assert.ok(M.world.blockInfoAt(target.bx, target.by, target.bz), 'every planned wall cell is filled');
  }

  const damaged = wall.plan[7];
  assert.ok(M.world.breakBlockAt(damaged.bx, damaged.by, damaged.bz));
  builder.state.buildTimer = 0;
  for (let i = 0; i < 4000 && !M.world.blockInfoAt(damaged.bx, damaged.by, damaged.bz); i++) {
    M.animals.update(.05, 300 + i * .05);
  }
  assert.ok(M.world.blockInfoAt(damaged.bx, damaged.by, damaged.bz), 'missing wall block is rebuilt');
});

test('wandering animals detour around the hearth tree instead of grinding on its trunk', () => {
  // Deterministic seed; the target sits straight across the trunk, which used
  // to wedge walkers against the tree's curved edge forever. Recovery now
  // detects the blockage and routes around it.
  const { M } = game({ seed: 1 });
  const animal = M.animals.list.find(candidate => candidate.name === 'Clover');
  M.animals.list.forEach((other, i) => {
    if (other === animal) return;
    other.group.position.set(-20 + i * 3, 14, -18);
    Object.assign(other.state, { mode: 'idle', wait: 1000, retired: true });
  });
  const s = animal.state;
  Object.assign(s, { mode: 'idle', wait: 0.2, project: null, action: null, escape: null,
    buildTimer: 1000, pitTimer: 1000 });
  const tree = M.hearthTree.position;
  const tv = {
    x: tree.x, z: tree.z + 10, y: M.world.surfaceHeight(tree.x, tree.z + 10),
    set(x, y, z) { this.x = x; this.y = y; this.z = z; },
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; }
  };
  animal.group.position.set(tree.x, M.world.surfaceHeight(tree.x, tree.z - 8), tree.z - 8);
  s.target = tv;
  s.mode = 'walk';
  s.wait = 0;

  let crossed = false;
  for (let i = 0; i < 2600 && !crossed; i++) {
    M.animals.update(.05, i * .05);
    if (s.mode === 'idle' && s.wait <= 0 && !s.escape && !s.action && !s.pendingClimb) {
      s.mode = 'walk';
      s.wait = 0;
      s.target.copy(tv);
    }
    const p = animal.group.position;
    if (Math.hypot(tv.x - p.x, tv.z - p.z) < 5.6) crossed = true;
  }
  assert.ok(crossed, 'animal reached the far side of the hearth tree');
});

test('player and every NPC rig articulate through walk, airborne and action poses', () => {
  const { M, input } = game();
  function finiteRig(root) {
    root.updateMatrixWorld(true);
    root.traverse(node => {
      assert.ok(Number.isFinite(node.position.x + node.position.y + node.position.z));
      assert.ok(Array.from(node.matrixWorld.elements).every(Number.isFinite));
    });
  }
  input.set(0, 1);
  for (let i = 0; i < 8; i++) M.goat.update(.05, i * .05);
  finiteRig(M.goat.group);
  input.set(0, 0);
  M.goat.startHeadbutt();
  M.goat.update(.08, .5);
  finiteRig(M.goat.group);

  for (const animal of M.animals.list) {
    assert.equal(animal.parts.legs.length, 4);
    assert.equal(animal.parts.eyes.length, 2);
    assert.equal(animal.parts.ears.length, 2);
    assert.ok(animal.parts.legs.every(leg => leg.ankle && leg.ankle.children.length === 2), animal.species + ' has split articulated hooves');
    Object.assign(animal.state, { mode: 'walk', speed: animal.def.walkSpeed, grounded: true, wait: 1000, buildTimer: 1000, pitTimer: 1000 });
    animal.state.target.copy(animal.group.position).add({ x: 0, y: 0, z: 4 });
    const before = animal.parts.legs[0].hip.rotation.x;
    M.animals.update(.1, 1);
    assert.notEqual(animal.parts.legs[0].hip.rotation.x, before, animal.species + ' walk pose changes');
    animal.state.grounded = false;
    animal.state.vy = 4;
    M.animals.update(.1, 1.1);
    finiteRig(animal.group);
    animal.state.grounded = true;
    animal.state.vy = 0;
    animal.state.mode = 'graze';
    animal.state.grazeTime = 2;
    M.animals.update(.2, 1.2);
    finiteRig(animal.group);
  }
});
