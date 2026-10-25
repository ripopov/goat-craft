import assert from 'node:assert/strict';
import test from 'node:test';
import { game } from './helpers/animal-game.mjs';

// Reuse one rendered fixture; the small voxel pool isolates actual controller,
// route and animation behavior without repeatedly generating the whole forest.
const { M, THREE, scene, input, controls } = game({ seed: 7 });
let bank = 12, ceiling = Infinity;
const wet = (x, z) => x >= 8 && x < 24 && z >= -6 && z < 6;
const floor = (x, z) => wet(x, z) ? 0 : bank;
const water = { top: 0, level: 10, depth: 10 };
const blocked = (x, z, low, high) => low < floor(x, z) - .00001 || high > ceiling;
Object.assign(M.world, {
  surfaceHeight: floor, terrainHeight: floor,
  waterInfoAtBlock: (bx, bz, y) => wet(bx * 2 + 1, bz * 2 + 1) && (y === undefined || y < 10 && y >= 0) ? water : null,
  waterDepthAt: (x, z) => wet(x, z) ? 10 : 0,
  waterAt: (x, y, z) => wet(x, z) && y >= 0 && y < 10 ? water : null,
  isWaterColumn: (bx, bz) => wet(bx * 2 + 1, bz * 2 + 1), isProtectedArea: () => false,
  blockedAt: blocked, navigationBlockedAt: blocked,
  bodyBlockedAt(x, z, low, high, radius) {
    return [-radius, radius].some(dx => [-radius, radius].some(dz => blocked(x + dx, z + dz, low, high)));
  },
  landingHeight(x, z, max) { const y = floor(x, z); return y <= max + .001 ? y : 0; },
  bodySupportHeight(x, z, max, radius) {
    return Math.max(...[-radius, radius].flatMap(dx => [-radius, radius].map(dz => this.landingHeight(x + dx, z + dz, max))));
  },
  navigationSurfaces: (bx, bz) => [floor(bx * 2 + 1, bz * 2 + 1)],
  navigationChangesSince: () => null,
  blockInfoAt(bx, by, bz) {
    return by * 2 < floor(bx * 2 + 1, bz * 2 + 1) ? { bx, by, bz, kind: 'stone', type: 'terrain' } : null;
  }
});
M.hearthTree.damage = () => {};
M.animals.list.forEach((animal, i) => {
  animal.group.position.set(-20 + i * 3, bank, -15);
  Object.assign(animal.state, { retired: true, wait: 1000, buildTimer: 1000, pitTimer: 1000 });
});
function advance(seconds, step, hz = 60) { for (let i = 0; i < seconds * hz; i++) step(1 / hz, i / hz); }
function resetPlayer() {
  M.goat.group.position.set(8.5, 8.7, 1); input.set(-1, 0); controls.swimVertical = 0;
  Object.assign(M.goat.state, { swimming: true, waterLevel: 10, shoreJump: 0, grounded: false, vy: 0, speed: 0, yaw: -Math.PI / 2, manualHold: 1000 });
}

test('player can jump or push out onto a block two units above water without a submerged foothold', () => {
  for (const hz of [20, 60, 144]) {
    resetPlayer();
    advance(2, (dt, t) => M.goat.update(dt, t), hz);
    assert.ok(M.goat.group.position.x < 8, 'push toward the bank exits at ' + hz + ' Hz');
    assert.equal(M.goat.group.position.y, bank); assert.equal(M.goat.state.swimming, false);
  }
  resetPlayer(); input.set(0, 0); M.goat.jump();
  assert.ok(M.goat.state.vy > 0); assert.equal(M.goat.state.swimming, false);
  advance(2, (dt, t) => M.goat.update(dt, t));
  assert.ok(M.goat.group.position.x < 8, 'jump carries an idle player onto the block ahead');
  assert.equal(M.goat.group.position.y, bank);
});

test('shore jumps need an actual nearby landing, respect ceilings and reject tall walls', () => {
  const physics = M.actorPhysics, body = M.goat.body;
  assert.equal(physics.shoreExit(M.world, { x: 16, y: 8.7, z: 1 }, body, -1, 0, 10, 26), null);
  bank = 14;
  assert.equal(physics.shoreExit(M.world, { x: 8.5, y: 8.7, z: 1 }, body, -1, 0, 10, 26), null);
  bank = 12; ceiling = 12.5;
  assert.equal(physics.shoreExit(M.world, { x: 8.5, y: 8.7, z: 1 }, body, -1, 0, 10, 26), null);
  ceiling = Infinity;
});

test('each NPC paddles to the bank and jumps back onto dry ground', () => {
  M.goat.group.position.set(-5, bank, -8);
  for (const animal of M.animals.list) {
    const s = animal.state, draft = M.actorPhysics.swimDepth(M.animals.bodyOf(animal));
    animal.group.position.set(12, 10 - draft, 1);
    Object.assign(s, { mode: 'walk', swimming: true, shoreJump: 0, grounded: false, vy: 0, speed: 0, yaw: -Math.PI / 2 });
    s.target.set(5, bank, 1);
    advance(.3, (dt, t) => M.animals.update(dt, t));
    assert.ok(s.swimBlend > 0, animal.name + ' blends into paddling');
    advance(12, (dt, t) => M.animals.update(dt, t));
    assert.ok(animal.group.position.x < 8, animal.name + ' exits: ' + animal.group.position.toArray());
    assert.equal(animal.group.position.y, bank); assert.equal(s.swimming, false);
    animal.group.position.set(-20, bank, -15); s.mode = 'idle'; s.wait = 1000;
  }
});

test('all surface enemy species follow swimming routes, animate and exit deep water', () => {
  M.enemies.navigation.rebuild();
  const node = M.enemies.navigation.nodeAt(11, 8.7, 1);
  assert.ok(node.swim && Number.isFinite(node.distance), 'surface flow connects across a deep pool to a high bank');
  assert.equal(M.enemies.navigation.nodes.some(n => n.x === 11 && n.z === 1 && n.y === 0), false, 'ground enemies do not choose the waterbed');
  for (const type of Object.keys(M.enemies.types)) {
    M.enemies.zombies.length = 0;
    const draft = M.actorPhysics.swimDepth(M.enemies.types[type]);
    const enemy = M.enemies.spawnAt({ x: 11, y: 10 - draft, z: 1 }, type, { surface: true });
    advance(.3, dt => M.enemies.update(dt));
    assert.equal(enemy.swimming, true, type + ' swims');
    assert.ok(enemy.position.y > 8, type + ' floats instead of sinking');
    const mesh = scene.getObjectByName('Enemy horde');
    const pose = Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16));
    advance(.2, dt => M.enemies.update(dt));
    assert.notDeepEqual(Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)), pose, type + ' paddles');
    advance(9, dt => M.enemies.update(dt));
    assert.ok(enemy.position.x < 8, type + ' reaches the dry bank: ' + enemy.position.toArray());
    assert.equal(enemy.swimming, false); assert.equal(enemy.grounded, true);
    assert.ok(!enemy.exploded && enemy.position.y >= bank);
    assert.ok(Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)).every(Number.isFinite));
  }
});


test('a parachute landing in deep water settles at the surface and starts swimming', () => {
  M.enemies.zombies.length = 0;
  const enemy = M.enemies.spawnAt({ x: 17, y: 8.7, z: 1 }, 'zombie', { airborne: true });
  advance(6, dt => M.enemies.update(dt));
  assert.equal(enemy.airborne, false); assert.equal(enemy.swimming, true);
  assert.ok(enemy.position.y > 8 && !enemy.exploded);
});
