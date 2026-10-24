import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function game() {
  const drawing = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  const canvas = { getContext: () => drawing };
  const context = vm.createContext({ window: { matchMedia: () => ({ matches: false }) },
    document: { createElement: () => canvas, getElementById: () => null }, console });
  const load = file => vm.runInContext(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context, { filename: file });
  for (const file of ['vendor/three.min.js', 'js/core.js', 'js/actor-physics.js', 'js/voxel-water.js']) load(file);
  const M = context.window.Meadow, THREE = context.THREE;
  M.config.renderRadius = 1;
  load('js/world.js'); load('js/hearth-tree.js'); load('js/goat.js'); load('js/animals.js');
  const scene = new THREE.Scene(), input = new THREE.Vector2();
  M.world.init(scene, { capabilities: { getMaxAnisotropy: () => 1 } }); M.hearthTree.init(scene);
  const controls = { firstPerson: false, running: false, swimVertical: 0, getMovement: () => input,
    getFacingYaw: () => 0, getSwimPitch: () => 0, noteActivity() {} };
  const audio = new Proxy({}, { get: () => () => {} });
  M.goat.init({ scene, camera: new THREE.PerspectiveCamera(), controls, world: M.world, audio, ui: { showBubble() {} } });
  M.goat.state.manualHold = 1000;
  M.animals.init({ scene, world: M.world, audio, goat: M.goat });
  for (let i = 0; i < M.animals.list.length; i++) {
    const animal = M.animals.list[i]; animal.group.position.set(-20 + i * 3, 14, -18);
    Object.assign(animal.state, { mode: 'idle', wait: 1000, buildTimer: 1000, actionTimer: 1000,
      pitTimer: 1000, retired: true, project: null });
  }
  function place(bx, bz, from = 7, to = 8) {
    for (let y = from; y <= to; y++) assert.ok(M.world.placeBlock('stone', bx, y, bz), `place ${bx},${y},${bz}`);
  }
  function clearActor(p, body) { return M.actorPhysics.clear(M.world, p.x, p.y, p.z, body); }
  return { M, THREE, input, controls, place, clearActor };
}

test('touching inside corners stays clear at every facing angle, including negative coordinates', () => {
  const { M, place, clearActor } = game(), body = M.goat.body, p = M.goat.group.position;
  for (const [bx, bz] of [[10, 0], [-12, -1]]) {
    place(bx + 1, bz); place(bx, bz + 1);
    p.set((bx + 1) * 2 - body.radius, 14, (bz + 1) * 2 - body.radius);
    assert.ok(clearActor(p, body), 'touching both faces must not count as overlap');
    for (let i = 0; i < 72; i++) {
      M.goat.state.yaw = i * Math.PI / 36;
      const before = p.clone(); M.goat.update(1 / 60, i / 60);
      assert.ok(p.distanceTo(before) < .00001, 'turning must not trigger a false overlap recovery');
      assert.ok(clearActor(p, body));
    }
  }
});

test('player escapes every corner quadrant in both camera modes at 20, 60 and 144 Hz', () => {
  const { M, input, controls, place, clearActor } = game(), p = M.goat.group.position;
  for (const firstPerson of [false, true]) for (const hz of [20, 60, 144]) {
    for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      p.set(21, 14, 1);
      for (const [bx, bz] of [[9, 0], [11, 0], [10, -1], [10, 1]]) {
        for (let y = 7; y <= 8; y++) M.world.breakBlockAt(bx, y, bz, { drop: false });
      }
      place(10 + dx, 0); place(10, dz);
      p.set(21 + dx * .55, 14, 1 + dz * .55);
      const start = p.clone();
      controls.firstPerson = firstPerson; controls.getFacingYaw = () => Math.atan2(dx, dz);
      Object.assign(M.goat.state, { yaw: Math.atan2(dx, dz), speed: 0, vy: 0, grounded: true, manualHold: 1000 });
      input.set(-dx, -dz).normalize();
      for (let i = 0; i < Math.ceil(hz * 1.5); i++) {
        M.goat.update(1 / hz, i / hz);
        assert.ok(clearActor(p, M.goat.body), 'motion must remain clear at corner contacts');
      }
      assert.ok((p.x - start.x) * -dx > 3, 'the character must leave the corner completely');
      assert.ok((p.z - start.z) * -dz > 3);
      assert.equal(p.y, 14); assert.equal(M.goat.state.jumps, 0);
    }
  }
});

test('player slides around an outside corner and can reverse along touching block seams', () => {
  const { M, input, place, clearActor } = game(), p = M.goat.group.position;
  for (let bz = -3; bz <= 0; bz++) place(11, bz);
  p.set(21, 14, -3); input.set(1, 1).normalize();
  for (let i = 0; i < 240; i++) {
    M.goat.update(1 / 60, i / 60); assert.ok(clearActor(p, M.goat.body));
  }
  assert.ok(p.x > 24 && p.z > 5, 'the end of the wall must release the tangential slide');
  p.set(22 - M.goat.body.radius, 14, -3); input.set(0, -1);
  for (let i = 0; i < 120; i++) M.goat.update(1 / 60, i / 60);
  assert.ok(p.z < -8, 'touching a wall must not catch on its internal block seams');
});

test('every herd species walks away from an inside corner without hopping or relocation', () => {
  const { M, place, clearActor } = game(); place(11, 0); place(10, 1);
  for (const animal of M.animals.list) {
    animal.group.position.set(21, 14, 1);
    Object.assign(animal.state, { mode: 'walk', wait: 1000, speed: 0, yaw: Math.PI / 4,
      grounded: true, vy: 0, jumpReason: null, stuck: 0 });
    animal.state.target.set(15, 14, 1);
    for (let i = 0; i < 300; i++) {
      M.animals.update(1 / 60, i / 60);
      assert.ok(clearActor(animal.group.position, M.animals.bodyOf(animal)));
    }
    assert.ok(animal.group.position.x < 18, animal.species + ' must walk out of the corner');
    assert.equal(animal.group.position.y, 14);
    assert.equal(animal.state.jumpReason, null, 'a false corner collision must not trigger a ledge hop');
    animal.group.position.set(-20, 14, -18); animal.state.mode = 'idle'; animal.state.wait = 1000;
  }
});

test('one-block corridors fit all herd species regardless of facing', () => {
  const { M, place, clearActor } = game();
  for (let x = 8; x <= 13; x++) { place(x, -1); place(x, 1); }
  for (const animal of M.animals.list) {
    animal.group.position.set(17, 14, 1); animal.state.target.set(27, 14, 1);
    Object.assign(animal.state, { mode: 'walk', speed: 0, yaw: -Math.PI / 2, grounded: true, vy: 0 });
    for (let i = 0; i < 360; i++) {
      M.animals.update(1 / 60, i / 60);
      assert.ok(clearActor(animal.group.position, M.animals.bodyOf(animal)));
    }
    assert.ok(animal.group.position.x > 21, animal.species + ' must fit the corridor');
    assert.equal(animal.group.position.y, 14);
    animal.group.position.set(-20, 14, -18); animal.state.mode = 'idle'; animal.state.wait = 1000;
  }
});

test('an animal above a bridge cannot block another walking below it', () => {
  const { M, place } = game(); place(9, 0, 9, 9);
  const [walker, above] = M.animals.list;
  walker.group.position.set(21, 14, 1); walker.state.target.set(15, 14, 1);
  Object.assign(walker.state, { mode: 'walk', speed: 0, yaw: -Math.PI / 2, grounded: true });
  above.group.position.set(19, 20, 1);
  for (let i = 0; i < 240; i++) M.animals.update(1 / 60, i / 60);
  assert.ok(walker.group.position.x < 18);
  assert.equal(walker.group.position.y, 14); assert.equal(above.group.position.y, 20);
});

test('the herd can enter a dry bridge over water from the bank', () => {
  const { M, THREE, place } = game(), w = M.world, walker = M.animals.list[0];
  let firstWet = -40;
  while (firstWet < -27 && !w.waterInfoAtBlock(firstWet, 3)) firstWet++;
  assert.ok(w.waterInfoAtBlock(firstWet, 3));
  const startX = (firstWet - .5) * 2;
  for (let i = 0; i < 8; i++) w.update(new THREE.Vector3(startX, 16, 7), 0, 0);
  for (let x = firstWet - 1; x <= firstWet + 5; x++) place(x, 3, 7, 7);
  walker.group.position.set(startX, 16, 7); walker.state.target.set((firstWet + 4.5) * 2, 16, 7);
  Object.assign(walker.state, { mode: 'walk', speed: 0, yaw: Math.PI / 2, grounded: true, vy: 0 });
  for (let i = 0; i < 420; i++) M.animals.update(1 / 60, i / 60);
  assert.ok(walker.group.position.x > (firstWet + 1.5) * 2, 'water below the bridge must not be an invisible movement wall');
  assert.equal(walker.group.position.y, 16);
});

test('a small real penetration recovers locally while a merely touching body stays put', () => {
  const { M, place, clearActor } = game(); place(11, 0);
  const p = M.goat.group.position, body = M.goat.body;
  p.set(22 - body.radius + .02, 14, 1);
  assert.equal(clearActor(p, body), false);
  const before = p.clone(); M.goat.update(1 / 60, 0);
  assert.ok(clearActor(p, body)); assert.ok(p.distanceTo(before) < .1); assert.equal(p.y, 14);
  const clear = p.clone();
  for (let i = 0; i < 60; i++) M.goat.update(1 / 60, i / 60);
  assert.ok(p.distanceTo(clear) < .00001, 'recovery must not repeatedly pull the actor backward');
});

test('rotated Hearth Tree collision agrees with its visible voxel columns and never supplies a distant floor', () => {
  const { M } = game(), tree = M.hearthTree, w = M.world, base = tree.group.position.y;
  for (let x = -8.13; x < 8; x += .47) for (let z = -8.17; z < 8; z += .53) {
    assert.equal(tree.intersectsBox(x, z, .00001, base + 1.05, base + 1.06),
      tree.blockedAt(x, z, base + 1.05, base + 1.06));
    assert.equal(w.bodySupportHeight(x, z, base + 3, .00001), w.landingHeight(x, z, base + 3));
  }
});
