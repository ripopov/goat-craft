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
  return { M, THREE: context.THREE, scene };
}

test('Hearth Tree is a bounded, detailed dry-ground landmark near spawn', () => {
  const { M, THREE, scene } = meadow();
  const tree = M.hearthTree.group;
  assert.equal(tree.parent, scene);
  assert.ok(tree.position.distanceTo(new THREE.Vector3(0.9, 16, 0.7)) < 32);
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
  for (let i = 0; i < 5; i++) w.update(new THREE.Vector3(0.9, 16, 0.7), 0, 2);
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
