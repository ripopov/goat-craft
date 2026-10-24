import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);

function meadow({ coarse = false, reducedMotion = false } = {}) {
  const drawing = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  const canvas = { getContext: () => drawing };
  const window = { matchMedia: query => ({ matches: query.includes('reduced-motion') ? reducedMotion : coarse }) };
  const context = vm.createContext({ window, document: { createElement: () => canvas }, console });
  const load = file => vm.runInContext(readFileSync(new URL(file, root), 'utf8'), context, { filename: file });
  for (const file of ['vendor/three.min.js', 'js/core.js']) load(file);
  const M = window.Meadow;
  M.config.renderRadius = 1;
  for (const file of ['js/world.js', 'js/hearth-tree.js']) load(file);
  const scene = new context.THREE.Scene();
  M.world.init(scene, { capabilities: { getMaxAnisotropy: () => 1 } });
  M.hearthTree.init(scene);
  return { M, THREE: context.THREE, scene, load };
}

test('Hearth Tree is a bounded, detailed dry-ground landmark near spawn', () => {
  const { M, THREE, scene } = meadow();
  const tree = M.hearthTree.group;
  assert.equal(tree.parent, scene);
  const spawn = M.config.startingArea.spawn;
  assert.ok(tree.position.distanceTo(new THREE.Vector3(spawn.x, tree.position.y, spawn.z)) < 30);
  assert.equal(tree.position.x, M.config.startingArea.x);
  assert.equal(tree.position.z, M.config.startingArea.z);
  assert.equal(M.world.waterDepthAt(tree.position.x, tree.position.z), 0);
  assert.equal(tree.position.y, M.world.surfaceHeight(tree.position.x, tree.position.z));
  const bounds = new THREE.Box3().setFromObject(tree);
  assert.ok(bounds.max.y - tree.position.y > 18);
  assert.ok(bounds.max.x - bounds.min.x > 18);
  let vertices = 0;
  tree.traverse(object => {
    if (!object.geometry) return;
    const positions = object.geometry.attributes.position;
    for (const value of positions.array) assert.ok(Number.isFinite(value));
    vertices += positions.count;
  });
  assert.ok(vertices < 40000, 'exposed-face meshing keeps the landmark small');
  const children = tree.children.length;
  M.hearthTree.init(scene);
  assert.equal(tree.children.length, children, 'initialization is idempotent');
});

test('trunk, roots, placement and terrain protection agree with the world', () => {
  const { M, THREE } = meadow();
  const w = M.world;
  const { x, y, z } = M.hearthTree.group.position;
  assert.equal(w.blockedAt(x, z, y + 0.1, y + 2), true);
  assert.equal(w.blockedAt(x + 11, z, y + 0.1, y + 2), false, 'the nearby lawn stays walkable');
  assert.equal(w.canPlaceBlock(Math.floor(x / 2), y / 2, Math.floor(z / 2)), false);
  assert.equal(w.canPlaceBlock(2, y / 2, -13), true, 'defenses can be built outside the roots');

  let rootTop = null;
  for (let dx = -6; dx <= 6 && !rootTop; dx += 0.25) {
    for (let dz = -6; dz <= 6; dz += 0.25) {
      if (Math.hypot(dx, dz) < 3) continue;
      const ground = w.surfaceHeight(x + dx, z + dz);
      const top = w.supportHeight(x + dx, z + dz, ground + 1.6);
      if (top > ground + 0.1 && !w.blockedAt(x + dx, z + dz, top + 0.01, top + 1.8)) {
        rootTop = { x: x + dx, z: z + dz, top };
        break;
      }
    }
  }
  assert.ok(rootTop, 'low roots provide reachable standing surfaces');
  assert.equal(w.landingHeight(rootTop.x, rootTop.z, rootTop.top + 0.1), rootTop.top);
  assert.equal(w.blockedAt(rootTop.x, rootTop.z, rootTop.top - 0.2, rootTop.top - 0.01), true);

  const bx = Math.floor(x / 2), bz = Math.floor(z / 2);
  assert.equal(w.topSoilInfo(bx, bz), null, 'the herd cannot quarry the foundation');
  assert.equal(w.breakBlockAt(bx, y / 2 - 1, bz), null);
  assert.equal(w.breakBlockBelow(x, z, y), false, 'stomping cannot undermine the tree');
  assert.equal(w.surfaceHeight(x, z), y);
  assert.equal(w.canPlaceBlock(50, 6, 50), false, 'unloaded terrain retains existing placement rules');

  // Landmark collision is independent of procedural chunk ownership.
  w.update(new THREE.Vector3(600, y, 600), 0, 1);
  assert.equal(w.blockedAt(x, z, y + 0.1, y + 2), true);
  assert.equal(w.supportHeight(rootTop.x, rootTop.z, rootTop.top + 0.1), rootTop.top);
  for (let i = 0; i < 5; i++) w.update(new THREE.Vector3(M.config.startingArea.spawn.x, y, M.config.startingArea.spawn.z), 0, 2);
  assert.equal(w.canPlaceBlock(bx, y / 2, bz), false);
});

test('mobile embers stay bounded and respect reduced motion', () => {
  const { M } = meadow({ coarse: true, reducedMotion: true });
  const tree = M.hearthTree.group;
  const embers = tree.getObjectByName('Hearth Tree drifting embers');
  assert.equal(embers.count, 18);
  const initial = Array.from(embers.instanceMatrix.array);
  const children = tree.children.length;
  for (let time = 1; time <= 120; time++) M.hearthTree.update(1, time);
  assert.deepEqual(Array.from(embers.instanceMatrix.array), initial);
  assert.equal(tree.children.length, children, 'animation never allocates scene objects');
  for (const value of initial) assert.ok(Number.isFinite(value));
});


test('starting meadow is flat, dry and free of natural props for fifteen blocks around the tree', () => {
  const { M, THREE } = meadow();
  const w = M.world, home = M.config.startingArea, size = w.blockSize;
  assert.equal(home.radiusBlocks, 15);
  const ground = home.heightBlocks * size;
  for (let bz = -16; bz <= 16; bz++) for (let bx = -16; bx <= 16; bx++) {
    if (!w.isStartingClearing(bx, bz)) continue;
    const x = (bx + 0.5) * size, z = (bz + 0.5) * size;
    assert.equal(w.surfaceHeight(x, z), ground, 'flat at ' + bx + ',' + bz);
    assert.equal(w.waterInfoAtBlock(bx, bz), null);
    assert.equal(w.topSoilInfo(bx, bz), null, 'herd quarrying leaves the lawn intact');
    for (let by = home.heightBlocks; by < home.heightBlocks + 16; by++) {
      assert.equal(w.blockInfoAt(bx, by, bz), null, 'no natural tree or rock at ' + bx + ',' + bz);
    }
  }
  const spawn = home.spawn;
  assert.ok(Math.hypot(spawn.x - home.x, spawn.z - home.z) < home.radiusBlocks * size);
  assert.equal(w.blockedAt(spawn.x, spawn.z, ground + .01, ground + 3), false, 'player spawns in open ground');
  assert.equal(w.supportHeight(spawn.x, spawn.z, ground + 2), ground);

  // The clearing remains editable by the player, including after streaming.
  assert.ok(w.placeBlock('stone', 8, home.heightBlocks, 0));
  assert.equal(w.breakBlockAt(8, home.heightBlocks, 0), 'stone');
  assert.equal(w.breakBlockAt(8, home.heightBlocks - 1, 0), 'grass');
  w.update(new THREE.Vector3(600, ground, 600), 0, 1);
  assert.equal(w.surfaceHeight(17, 1), ground - size);
});

test('the clearing blends into forest, hills, nearby water and an endless seeded world', () => {
  const { M } = meadow(), w = M.world;
  const heights = new Set();
  let woodland = 0;
  for (let bz = -16; bz <= 31; bz++) for (let bx = -16; bx <= 31; bx++) {
    const x = (bx + .5) * 2, z = (bz + .5) * 2;
    if (Math.hypot(x, z) < 44) continue;
    heights.add(w.surfaceHeight(x, z));
    for (let by = 4; by < 20; by++) {
      if (w.blockInfoAt(bx, by, bz)?.kind === 'log') woodland++;
    }
  }
  assert.ok(heights.size >= 3, 'natural hills resume beyond the meadow');
  assert.ok(woodland > 10, 'a forest grows outside the open center');
  const pond = w.pondsNear(0, 0, 100).find(p => p.starter);
  assert.ok(Math.hypot(pond.x, pond.z) - pond.r * 2 * 1.18 > 30, 'the entire nearby pond lies outside the clearing');
  assert.ok(w.waterDepthAt(pond.x, pond.z) > 3);
  assert.ok(w.waterDepthAt(0, 56) > 3, 'the river remains outside the clearing');
  const distant = [[1422, -954], [-3200, 2100], [4000, 6000]];
  for (const [x, z] of distant) {
    const before = w.surfaceHeight(x, z);
    assert.ok(Number.isFinite(before));
    assert.equal(w.surfaceHeight(x, z), before, 'generation stays deterministic far from home');
  }
});


test('the player initializes at the configured open-meadow spawn', () => {
  const { M, THREE, scene, load } = meadow();
  load('js/goat.js');
  M.goat.init({ scene, camera: new THREE.PerspectiveCamera(), world: M.world,
    controls: {}, audio: {}, ui: {} });
  const spawn = M.config.startingArea.spawn, p = M.goat.group.position;
  assert.equal(p.x, spawn.x); assert.equal(p.z, spawn.z);
  assert.equal(p.y, M.config.startingArea.heightBlocks * M.world.blockSize);
  assert.equal(M.world.blockedAt(p.x, p.z, p.y + .01, p.y + 3), false);
});
