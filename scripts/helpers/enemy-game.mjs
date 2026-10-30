import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const scripts = new Map();
export function harness(realWorld = false, renderRadius = 0) {
  const drawing = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  const context = vm.createContext({ window: { matchMedia: () => ({ matches: false }) },
    document: { createElement: () => ({ getContext: () => drawing }), getElementById: () => null }, console });
  const load = file => {
    if (!scripts.has(file)) scripts.set(file, new vm.Script(readFileSync(new URL(file, root), 'utf8'), { filename: file }));
    return scripts.get(file).runInContext(context);
  };
  ['vendor/three.min.js', 'js/core.js', 'js/actor-physics.js'].forEach(load);
  const M = context.window.Meadow, THREE = context.THREE;
  M.config.renderRadius = renderRadius;
  const drops = [], coinDrops = [];
  M.items = { dropBlock: (...args) => drops.push(args), dropCoins: (position, count) => coinDrops.push({ position: position.clone(), count }) };
  M.ui = { showBubble() {}, setDefense() {} };
  const scene = new THREE.Scene();
  if (realWorld) {
    ['js/voxel-water.js', 'js/caves.js', 'js/world.js', 'js/hearth-tree.js'].forEach(load);
    M.world.init(scene, { capabilities: { getMaxAnisotropy: () => 1 } });
    M.hearthTree.init(scene);
  }
  ['js/zombie-navigation.js', 'js/hell-gates.js', 'js/enemy-rules.js', 'js/enemy-models.js', 'js/enemy-boats.js', 'js/enemies.js'].forEach(load);
  return { M, THREE, scene, drops, coinDrops, load, context };
}
export function fixture() {
  const { M, THREE, scene, coinDrops, context } = harness();
  const blocks = new Map(), drops = [];
  let revision = 0, hp = 100;
  const key = (x, y, z) => [x, y, z].join(',');
  const world = {
    blockSize: 2, get revision() { return revision; },
    waterDepthAt: () => 0, isProtectedArea: () => false,
    blockInfoAt(bx, by, bz) {
      const kind = by < 0 ? 'dirt' : blocks.get(key(bx, by, bz));
      return kind ? { bx, by, bz, kind, type: by < 0 ? 'terrain' : 'placed' } : null;
    },
    navigationSurfaces(bx, bz) {
      const ys = [];
      for (let by = -1; by < 10; by++) if (this.blockInfoAt(bx, by, bz) && !this.blockInfoAt(bx, by + 1, bz)) ys.push((by + 1) * 2);
      return ys;
    },
    navigationBlockedAt(x, z, min, max, includeTree = true) {
      for (let by = Math.floor((min + .001) / 2); by <= Math.floor((max - .001) / 2); by++) {
        if (this.blockInfoAt(Math.floor(x / 2), by, Math.floor(z / 2))) return true;
      }
      return includeTree && tree.blockedAt(x, z, min, max);
    },
    landingHeight(x, z, max) {
      for (let by = Math.floor((max + .001) / 2) - 1; by >= -1; by--) {
        if (this.blockInfoAt(Math.floor(x / 2), by, Math.floor(z / 2))) return (by + 1) * 2;
      }
      return 0;
    },
    breakBlockAt(bx, by, bz) {
      const value = blocks.get(key(bx, by, bz));
      if (!value) return null;
      blocks.delete(key(bx, by, bz)); drops.push(value); revision++; return value;
    },
    place(bx, by, bz) { blocks.set(key(bx, by, bz), 'stone'); revision++; }
  };
  const tree = { position: { x: 1, z: 1 }, get health() { return hp; },
    damage(n) { hp = Math.max(0, hp - n); },
    blockedAt(x, z, min, max) { return x >= 0 && x < 2 && z >= 0 && z < 2 && min < 8 && max > 0; } };
  return { M, THREE, scene, world, tree, drops, coinDrops, context };
}
// Simulation scenarios need only their final pose; dedicated render tests below
// exercise per-frame uploads and animation independently.
export const advance = (M, seconds, dt = .05) => {
  M.enemies.beginFrame();
  for (let i = 0; i < Math.round(seconds / dt); i++) M.enemies.update(dt);
  M.enemies.syncRender();
};

