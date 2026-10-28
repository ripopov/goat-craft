import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { game, isolatedAnimal } from './helpers/animal-game.mjs';

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
  assert.ok(zombie.hp < zombie.maxHp || !M.enemies.zombies.includes(zombie), 'hunter damaged the zombie');
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

  let quarried = 0;
  const breakBlock = M.world.breakBlockAt;
  M.world.breakBlockAt = (bx, by, bz, options) => {
    const action = builder.state.action;
    if (action?.quarry) {
      const site = builder.state.project.site, acrossX = site.axis === 'z';
      const boundary = acrossX ? site.centerX : site.centerZ;
      const hearth = acrossX ? M.hearthTree.position.x : M.hearthTree.position.z;
      const cell = (acrossX ? bx + .5 : bz + .5) * 2;
      assert.ok((cell - boundary) * Math.sign(boundary - hearth) >= 6, 'real quarry hits stay outside the wall and its approaches');
      assert.equal(options.protectPlaced, true);
      quarried++;
    }
    return breakBlock(bx, by, bz, options);
  };
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
  assert.ok(quarried >= 20, 'wall materials are actually gathered outside');
  assert.equal(wall.plan.length, 20);
  const xs = new Set(wall.plan.map(target => target.bx));
  const zs = new Set(wall.plan.map(target => target.bz));
  const ys = new Set(wall.plan.map(target => target.by));
  assert.deepEqual([xs.size, zs.size].sort((a, b) => a - b), [1, 10]);
  assert.equal(ys.size, 2);
  assert.equal(wall.site.axis, Math.abs(wall.site.centerX - M.hearthTree.position.x) > Math.abs(wall.site.centerZ - M.hearthTree.position.z) ? 'z' : 'x');
  for (const target of wall.plan) {
    assert.ok(Math.hypot(target.x - M.hearthTree.position.x, target.z - M.hearthTree.position.z) >= 24);
    assert.ok(Math.hypot(target.x - M.config.startingArea.x, target.z - M.config.startingArea.z) <= M.config.startingArea.radiusBlocks * 2, 'wall stays on the starting meadow');
    assert.ok(M.world.blockInfoAt(target.bx, target.by, target.bz), 'every planned wall cell is filled');
  }

  const damaged = wall.plan[7];
  assert.ok(M.world.breakBlockAt(damaged.bx, damaged.by, damaged.bz));
  builder.state.buildTimer = 0;
  for (let i = 0; i < 4000 && !M.world.blockInfoAt(damaged.bx, damaged.by, damaged.bz); i++) {
    M.animals.update(.05, 300 + i * .05);
  }
  assert.ok(M.world.blockInfoAt(damaged.bx, damaged.by, damaged.bz), 'missing wall block is rebuilt: ' + JSON.stringify({ p: builder.group.position, mode: builder.state.mode, abandon: builder.state.lastAbandon }));
});

test('every NPC body routes across the Hearth from eight directions without jumping, digging or rescue', () => {
  const { M } = game({ seed: 1 }), tree = M.hearthTree.position;
  M.goat.group.position.set(24, 14, 24);
  const revision = M.world.revision;
  for (const animal of M.animals.list) {
    for (let direction = 0; direction < 8; direction++) {
      for (const [i, other] of M.animals.list.entries()) {
        other.group.position.set(-24 + i * 3, 14, -24);
        Object.assign(other.state, { mode: 'idle', wait: 1000, retired: true, pitTimer: 1000, buildTimer: 1000 });
      }
      const angle = direction * Math.PI / 4, dx = Math.sin(angle) * 10, dz = Math.cos(angle) * 10;
      const p = animal.group.position, s = animal.state;
      p.set(tree.x + dx, 14, tree.z + dz);
      s.target.set(tree.x - dx, 14, tree.z - dz);
      Object.assign(s, { mode: 'walk', wait: 0, grounded: true, vy: 0, speed: 0, escape: null,
        detourTarget: null, detourTime: 0, navigation: null, jumpReason: null });
      let arrived = false;
      for (let i = 0; i < 500; i++) {
        M.animals.update(.1, i * .1);
        assert.equal(s.jumpReason, null, animal.name + ' should walk around roots');
        assert.equal(s.escape, null, animal.name + ' should not excavate the tree');
        assert.ok(M.actorPhysics.clear(M.world, p.x, p.y, p.z, M.animals.bodyOf(animal)));
        if (Math.hypot(p.x - s.target.x, p.z - s.target.z) < .4) { arrived = true; break; }
      }
      assert.ok(arrived, animal.name + ' direction ' + direction + ' reached the opposite side: ' + JSON.stringify(p));
      assert.equal(s.recovery.rescues, 0);
    }
  }
  assert.equal(M.world.revision, revision, 'routing does not alter terrain');
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
    Object.assign(animal.state, { mode: 'walk', speed: M.config.locomotion.runSpeed, grounded: true, wait: 1000, buildTimer: 1000, pitTimer: 1000 });
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

test('Hearth routes cache collision work and invalidate immediately after construction or a changed goal', () => {
  let probes = 0, solid = true;
  const world = { revision: 0 };
  const M = { utils: { clamp: (v, a, b) => Math.max(a, Math.min(b, v)) }, actorPhysics: {
    clear: (_, x, y, z, body) => { probes++; return !solid || Math.hypot(x, z) > 3 + body.radius; },
    support: () => 14
  } };
  const context = vm.createContext({ window: { Meadow: M } });
  vm.runInContext(readFileSync(new URL('../js/animal-navigation.js', import.meta.url), 'utf8'), context);
  const nav = M.animalNavigation.create(world, { x: 0, z: 0 });
  const p = { x: 0, y: 14, z: -10 }, goal = { x: 0, y: 14, z: 10 }, body = { radius: .5, height: 2 };
  const state = { retry: 0 };
  const first = nav.waypoint(p, goal, body, state);
  assert.notEqual(first, goal); assert.ok(state.path.length > 1);
  const initial = probes;
  for (let i = 0; i < 100; i++) assert.equal(nav.waypoint(p, goal, body, state), first);
  assert.equal(probes, initial, 'following a committed route does no repeated world sweeps');
  solid = false; world.revision++;
  nav.waypoint(p, goal, body, state);
  assert.equal(state.path.length, 0, 'construction invalidates stale routing immediately');
  solid = true;
  nav.waypoint(p, { x: 2, y: 14, z: 10 }, body, state);
  assert.ok(state.path.length > 1, 'a moving hunt target replans');
});

test('both builders start and complete outer-meadow walls in a fresh herd', () => {
  for (const seed of [1, 42]) {
    const { M } = game({ seed });
    const builders = M.animals.list.filter(a => a.role === 'builder');
    advanceAnimals(M, 12);
    assert.ok(builders.every(a => a.state.project), 'both builders find a site and quarry promptly');
    for (let i = 0; i < 1400 && builders.some(a => !a.state.walls.length); i++) M.animals.update(.05, 12 + i * .05);
    for (const animal of builders) {
      assert.ok(animal.state.walls.length, animal.name + ' completes a wall without intervention');
      assert.equal(animal.state.lastAbandon, null, 'viable quarry prevents project abandonment');
      for (const cell of animal.state.walls[0].plan) {
        const radius = Math.hypot(cell.x - M.hearthTree.position.x, cell.z - M.hearthTree.position.z);
        assert.ok(radius >= 24 && radius <= 30, 'wall is on the starting meadow, away from the Hearth');
        assert.ok(M.world.blockInfoAt(cell.bx, cell.by, cell.bz));
      }
    }
  }
});

test('hunter chase uses shared gallop speed and applies terrain slowdown once', () => {
  const { M } = game({ seed: 42 });
  M.goat.group.position.set(-25, 14, -25);
  M.animals.list.forEach((a, i) => {
    a.group.position.set(-20 + i * 3, 14, -18);
    Object.assign(a.state, { mode: 'idle', wait: 1000, buildTimer: 1000, pitTimer: 1000 });
  });
  const hunter = M.animals.list.find(a => a.name === 'Bramble');
  hunter.group.position.set(15, 14, 15);
  const enemy = M.enemies.spawnAt({ x: 35, y: 14, z: 15 });
  assert.ok(enemy);
  M.enemies.movementScale = () => .65;
  const before = hunter.group.position.clone();
  advanceAnimals(M, 1);
  assert.equal(hunter.state.mode, 'hunt');
  assert.ok(hunter.group.position.distanceTo(before) > 4.5, 'hunter actually gallops toward its target');
  const fullSpeed = M.config.locomotion.runSpeed * .65;
  assert.ok(hunter.state.speed > fullSpeed * .98 && hunter.state.speed <= fullSpeed, 'no role-specific chase multiplier');
});


test('wall and tower quarry searches use the outside in all four directions and recheck construction before mining', () => {
  const { M, animal } = isolatedAnimal('Mallow');
  const soil = M.world.topSoilInfo;
  for (const axis of ['x', 'z']) for (const sign of [-1, 1]) {
    const acrossX = axis === 'z', center = sign * 13;
    const site = { axis, centerX: acrossX ? center : 15, centerZ: acrossX ? 15 : center, groundY: 14, baseBy: 7 };
    site.bx = Math.floor(site.centerX / 2); site.bz = Math.floor(site.centerZ / 2);
    const point = offset => ({ bx: Math.floor((acrossX ? center + sign * offset : 15) / 2),
      bz: Math.floor((acrossX ? 15 : center + sign * offset) / 2) });
    const inner = point(-10), outer = point(6);
    const project = { site, stepCount: 4, plan: [{ bx: site.bx, by: 7, bz: site.bz }], steps: [] };
    M.world.topSoilInfo = (bx, bz) => [inner, outer].some(c => c.bx === bx && c.bz === bz)
      ? { bx, by: 6, bz, kind: 'grass', top: 14 } : null;
    animal.group.position.set(acrossX ? center - sign * 8 : 15, 14, acrossX ? 15 : center - sign * 8);
    Object.assign(animal.state, { mode: 'idle', wait: 0, project, walls: [], action: null, gathering: true,
      carryCount: 0, carry: null, batchGoal: 1, escape: null, grounded: true, vy: 0, pitTimer: 1000 });
    M.animals.update(.05, 0);
    assert.ok(animal.state.action?.quarry, axis + sign + ' finds a wall quarry');
    assert.deepEqual([animal.state.action.target.bx, animal.state.action.target.bz], [outer.bx, outer.bz], 'rejects closer soil on the Hearth side');

    // A player builds above the selected soil while the builder approaches.
    assert.ok(M.world.placeBlock('stone', outer.bx, 7, outer.bz));
    animal.state.mode = 'break'; animal.state.action.time = .21;
    M.animals.update(.05, .05);
    assert.equal(animal.state.action.result, 'failed');
    assert.ok(M.world.blockInfoAt(outer.bx, 6, outer.bz), 'new player wall keeps its natural foundation');
    M.world.breakBlockAt(outer.bx, 7, outer.bz, { drop: false });

    // Tower gathering must obey the same wall boundary, including completed walls.
    const nearInner = point(-2), nearOuter = point(6);
    M.world.topSoilInfo = (bx, bz) => [nearInner, nearOuter].some(c => c.bx === bx && c.bz === bz)
      ? { bx, by: 6, bz, kind: 'stone', top: 14 } : null;
    animal.group.position.set(acrossX ? center + sign * 2 : 15, 14, acrossX ? 15 : center + sign * 2);
    M.towers = { builderDefinition: () => ({ id: 'frost', cost: { coins: 12, stone: 3 } }) };
    Object.assign(animal.state, { mode: 'idle', wait: 0, action: null, project: null, walls: [project],
      towerTimer: 0, coins: 12, towerStone: 0, grounded: true, vy: 0 });
    M.animals.update(.05, .1);
    assert.ok(animal.state.action?.towerQuarry, 'trained builder finds an outside tower quarry');
    assert.deepEqual([animal.state.action.target.bx, animal.state.action.target.bz], [nearOuter.bx, nearOuter.bz]);
    M.towers = null;
  }
  M.world.topSoilInfo = soil;
});
