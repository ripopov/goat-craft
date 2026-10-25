import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);

export function game({ seed } = {}) {
  const drawing = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  const context = vm.createContext({ window: { matchMedia: () => ({ matches: false }) },
    document: { createElement: () => ({ getContext: () => drawing }), getElementById: () => null }, console });
  if (Number.isInteger(seed)) vm.runInContext(`{ let state = ${seed >>> 0}; Math.random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296;
  }; }`, context);
  const load = file => vm.runInContext(readFileSync(new URL(file, root), 'utf8'), context, { filename: file });
  for (const file of ['vendor/three.min.js', 'js/core.js', 'js/actor-physics.js', 'js/voxel-water.js']) load(file);
  const M = context.window.Meadow, THREE = context.THREE;
  M.config.renderRadius = 1;
  for (const file of ['js/animal-style.js', 'js/caves.js', 'js/world.js', 'js/hearth-tree.js', 'js/targeting.js', 'js/goat.js', 'js/animal-recovery.js', 'js/animals.js', 'js/zombie-navigation.js', 'js/enemies.js']) load(file);
  const scene = new THREE.Scene();
  M.world.init(scene, { capabilities: { getMaxAnisotropy: () => 1 } });
  M.hearthTree.init(scene);
  const input = new THREE.Vector2();
  const controls = { firstPerson: false, running: false, swimVertical: 0, getMovement: () => input,
    getFacingYaw: () => 0, getSwimPitch: () => 0, noteActivity() {} };
  const audio = new Proxy({}, { get: () => () => {} });
  M.goat.init({ scene, camera: new THREE.PerspectiveCamera(), controls, world: M.world, audio, ui: { showBubble() {} } });
  M.goat.state.manualHold = 1000;
  M.animals.init({ scene, world: M.world, audio, goat: M.goat });
  M.enemies.init({ scene, world: M.world, tree: M.hearthTree });
  return { M, THREE, scene, controls, input, load };
}

export function isolatedAnimal(name = 'Mallow') {
  const fixture = game();
  const { M } = fixture;
  const animal = M.animals.list.find(candidate => candidate.name === name);
  M.animals.list.forEach((other, i) => {
    if (other === animal) return;
    other.group.position.set(-20 + i * 3, 14, -18);
    Object.assign(other.state, { mode: 'idle', wait: 1000, buildTimer: 1000, pitTimer: 1000, retired: true });
  });
  Object.assign(animal.state, { mode: 'idle', wait: 1000, buildTimer: 1000, pitTimer: 1000,
    project: null, action: null, escape: null, grounded: true, vy: 0, speed: 0 });

  function advance(seconds, update) {
    for (let i = 0; i < Math.round(seconds / .05); i++) {
      M.animals.update(.05, i * .05);
      if (update) update(i);
    }
  }
  function advanceUntil(seconds, predicate) {
    for (let i = 0; i < Math.round(seconds / .05); i++) {
      M.animals.update(.05, i * .05);
      if (predicate()) return true;
    }
    return false;
  }
  function place(bx, bz, from = 7, to = 8, kind = 'stone') {
    for (let by = from; by <= to; by++) M.world.placeBlock(kind, bx, by, bz);
  }
  function walkTo(x, z) {
    animal.state.mode = 'walk';
    animal.state.target.set(x, animal.group.position.y, z);
    animal.state.wait = 0;
  }
  return { ...fixture, animal, advance, advanceUntil, place, walkTo };
}
