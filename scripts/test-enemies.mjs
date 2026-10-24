import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
function harness(realWorld = false) {
  const drawing = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  const context = vm.createContext({ window: { matchMedia: () => ({ matches: false }) },
    document: { createElement: () => ({ getContext: () => drawing }), getElementById: () => null }, console });
  const load = file => vm.runInContext(readFileSync(new URL(file, root), 'utf8'), context, { filename: file });
  ['vendor/three.min.js', 'js/core.js', 'js/actor-physics.js'].forEach(load);
  const M = context.window.Meadow, THREE = context.THREE;
  M.config.renderRadius = 1;
  const drops = [], coinDrops = [];
  M.items = { dropBlock: (...args) => drops.push(args), dropCoins: (position, count) => coinDrops.push({ position: position.clone(), count }) };
  M.ui = { showBubble() {}, setDefense() {} };
  const scene = new THREE.Scene();
  if (realWorld) {
    ['js/voxel-water.js', 'js/caves.js', 'js/world.js', 'js/hearth-tree.js'].forEach(load);
    M.world.init(scene, { capabilities: { getMaxAnisotropy: () => 1 } });
    M.hearthTree.init(scene);
  }
  ['js/zombie-navigation.js', 'js/enemies.js'].forEach(load);
  return { M, THREE, scene, drops, coinDrops, load, context };
}
function fixture() {
  const { M, THREE, scene, coinDrops } = harness();
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
  return { M, THREE, scene, world, tree, drops, coinDrops };
}
const advance = (M, seconds, dt = .05) => { for (let i = 0; i < Math.round(seconds / dt); i++) M.enemies.update(dt); };

// Deliberately assert resulting routes and behavior rather than the particular
// search implementation: edits, height limits, unreachable goals and timing.
test('walk routes detour around two-block walls and can climb only one block', () => {
  const { M, world, tree } = fixture();
  for (let z = -3; z <= 3; z++) { world.place(3, 0, z); world.place(3, 1, z); }
  const nav = M.zombieNavigation.create(world, tree, { radius: 10 }); nav.rebuild();
  let node = nav.nodeAt(13, 0, 1);
  assert.ok(Number.isFinite(node.distance));
  const path = [];
  while (node.next) { node = node.next; path.push(node); assert.ok(path.length < 100); }
  assert.ok(path.some(n => Math.abs(n.bz) >= 4), 'walk around the end of the high wall');
  assert.equal(nav.canWalk({ x: 5, y: 0, z: 1 }, { x: 7, y: 4, z: 1 }), false);
  world.breakBlockAt(3, 1, 0); nav.rebuild();
  assert.equal(nav.canWalk(nav.nodeAt(5, 0, 1), nav.nodeAt(7, 2, 1)), true);
});

test('enclosed tree requires a breach, and a thick wall yields a multi-block plan', () => {
  const { M, world, tree } = fixture();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    if (Math.max(Math.abs(x), Math.abs(z)) < 2) continue;
    for (let y = 0; y < 3; y++) world.place(x, y, z);
  }
  const nav = M.zombieNavigation.create(world, tree, { radius: 9 }); nav.rebuild();
  const start = nav.nodeAt(13, 0, 1);
  assert.equal(start.distance, Infinity);
  const path = nav.breach(start);
  assert.ok(path.length > 0, 'find a route through a sealed defense');
  assert.ok(path.filter(n => n.blocks.length).length >= 2, 'plan through both wall courses');
});

test('zombies arrive gradually, increase with waves, and never exceed fifty', () => {
  const { M, scene, world, tree } = fixture();
  tree.damage = () => {}; // Keep the objective alive while testing the spawn cap.
  M.enemies.init({ scene, world, tree });
  advance(M, 9); assert.equal(M.enemies.zombies.length, 0);
  advance(M, 1.1); assert.equal(M.enemies.zombies.length, 1);
  const node = M.enemies.navigation.nodeAt(45, 0, 1);
  for (let i = 0; i < 80; i++) M.enemies.spawnAt(node);
  assert.equal(M.enemies.zombies.length, 50);
  advance(M, 40);
  assert.ok(M.enemies.zombies.length <= 50);
  assert.equal(M.enemies.getState().wave, 1, 'a crowded wave cannot silently queue another wave');
});

test('automatic zombie spawns use the fifty-percent-farther ring', () => {
  const { M, scene, world, tree } = fixture();
  M.enemies.init({ scene, world, tree });
  advance(M, 10.1);
  assert.equal(M.enemies.zombies.length, 1);
  const p = M.enemies.zombies[0].position;
  const distance = Math.hypot(p.x - tree.position.x, p.z - tree.position.z);
  // The walker has already had up to three 50ms movement ticks since spawn.
  assert.ok(distance >= 54 - M.enemies.types.zombie.speed * .15 && distance <= 72, `spawn distance ${distance}`);
});

test('startNextWave begins the next wave on demand and refuses after defeat', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  assert.equal(M.enemies.startNextWave(), true);
  assert.equal(M.enemies.getState().wave, 1);
  assert.equal(M.enemies.getState().phase, 'combat');
  assert.equal(M.enemies.getState().pending, M.enemies.waveSize(1));
  advance(M, .1);
  assert.equal(M.enemies.zombies.length, 1, 'the first enemy arrives without waiting for the timer');
  tree.damage(100);
  assert.equal(M.enemies.startNextWave(), false);
});

test('startWave jumps to an exact level and allows going backwards', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  assert.equal(M.enemies.startWave(10), true);
  assert.equal(M.enemies.getState().wave, 10);
  assert.equal(M.enemies.getState().pending, M.enemies.waveSize(10));
  advance(M, .1);
  assert.equal(M.enemies.zombies.length, 1);

  assert.equal(M.enemies.startWave(2), true);
  assert.equal(M.enemies.getState().wave, 2);
  assert.equal(M.enemies.getState().pending, M.enemies.waveSize(2));
  assert.equal(M.enemies.startWave(0), false);
  assert.equal(M.enemies.startWave(1.5), false);
  assert.equal(M.enemies.getState().wave, 2, 'invalid levels leave the current wave untouched');

  tree.damage(100);
  assert.equal(M.enemies.startWave(5), false);
});

test('each zombie eats exactly one tree HP per three seconds; defeat clamps at zero', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  const zombie = M.enemies.spawnAt(M.enemies.navigation.nodeAt(3, 0, 1));
  advance(M, 2.95); assert.equal(tree.health, 100);
  advance(M, .05); assert.equal(tree.health, 99); assert.equal(zombie.mode, 'tree');
  advance(M, 3); assert.equal(tree.health, 98);
  tree.damage(97); advance(M, 3); assert.equal(tree.health, 0);
  const count = M.enemies.zombies.length; advance(M, 60);
  assert.equal(tree.health, 0); assert.equal(M.enemies.zombies.length, count);
  assert.equal(M.enemies.getState().defeated, true);
});

test('headbutts and stomps kill zombies, drop one coin each, and cannot hit through walls', () => {
  const { M, THREE, scene, world, tree, coinDrops } = fixture(); M.enemies.init({ scene, world, tree });
  const node = M.enemies.navigation.nodeAt(9, 0, 1), origin = new THREE.Vector3(9, 0, 3);
  const zombie = M.enemies.spawnAt(node);
  assert.equal(M.enemies.attack(origin, Math.PI, false), true); assert.equal(zombie.hp, 1);
  assert.equal(M.enemies.attack(origin, Math.PI, false), true); assert.equal(M.enemies.getState().coins, 0);
  M.enemies.attack(origin, Math.PI, false); assert.equal(M.enemies.getState().coins, 0);
  M.enemies.spawnAt(node); M.enemies.attack(origin, 0, true);
  assert.equal(M.enemies.getState().coins, 0);
  assert.deepEqual(coinDrops.map(drop => drop.count), [1, 1], 'each kill leaves physical loot once');
  M.enemies.spawnAt(M.enemies.navigation.nodeAt(9, 0, -1)); world.place(4, 0, 0);
  assert.equal(M.enemies.attack(new THREE.Vector3(9, 0, 1.5), Math.PI, false), false);
  assert.equal(M.enemies.getState().coins, 0);
});

test('a zombie jumps onto a single block but never climbs a double wall', () => {
  const { M, scene, world, tree } = fixture();
  // A one-block step directly on the shortest route.
  for (let z = -8; z <= 8; z++) world.place(3, 0, z);
  M.enemies.init({ scene, world, tree });
  const zombie = M.enemies.spawnAt(M.enemies.navigation.nodeAt(9, 0, 1));
  let highest = 0;
  for (let i = 0; i < 180; i++) { M.enemies.update(.05); highest = Math.max(highest, zombie.position.y); }
  assert.ok(highest >= 2 && highest < 3.2, 'jump clears one block');
  assert.ok(zombie.position.x < 6, 'cross the step toward the tree');
});

test('a sealed wall takes ten seconds per chewed block and leaves pickable material', () => {
  const { M, scene, world, tree, drops } = fixture();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== 3) continue;
    for (let y = 0; y < 3; y++) world.place(x, y, z);
  }
  M.enemies.init({ scene, world, tree });
  const zombie = M.enemies.spawnAt(M.enemies.navigation.nodeAt(9, 0, 1));
  advance(M, 9.95); assert.equal(drops.length, 0); assert.equal(zombie.mode, 'block');
  advance(M, .05); assert.equal(drops.length, 1); assert.equal(drops[0], 'stone');
  advance(M, 25);
  assert.ok(drops.length >= 2); assert.ok(zombie.position.x < 6, 'enter the breach after eating enough headroom');
});

test('real terrain, roots and tree health support navigation and recoverable block edits', () => {
  const { M, THREE, scene, drops } = harness(true);
  const start = performance.now();
  M.enemies.init({ scene, world: M.world, tree: M.hearthTree });
  assert.ok(performance.now() - start < 10000, 'bounded initial navigation build');
  const nodes = M.enemies.navigation.nodes;
  assert.ok(nodes.filter(n => Number.isFinite(n.distance)).length > 100);
  const node = nodes.find(n => n.distance > 5 && n.distance < 20 && M.world.waterDepthAt(n.x, n.z) === 0);
  const zombie = M.enemies.spawnAt(node);
  advance(M, 35);
  assert.ok(M.hearthTree.health < 100, JSON.stringify({start: [node.x,node.y,node.z,node.distance], p:zombie.position, target:zombie.target && [zombie.target.x,zombie.target.y,zombie.target.z], grounded:zombie.grounded, mode:zombie.mode, vy:zombie.vy}));
  assert.equal(zombie.mode, 'tree');
  assert.ok(scene.getObjectByName('Enemy horde').count <= 50 * 40);
  for (const value of scene.getObjectByName('Enemy horde').instanceMatrix.array) assert.ok(Number.isFinite(value));
  const x = 2, z = -13, y = Math.floor(M.world.surfaceHeight(5, -25) / 2);
  assert.ok(M.world.placeBlock('stone', x, y, z));
  assert.equal(M.world.breakBlockAt(x, y, z, { persistentDrop: true }), 'stone');
  assert.equal(drops.at(-1)[0], 'stone');
  assert.ok(M.world.placeBlock('stone', x, y, z), 'the eaten block can be placed again');
  M.world.update(new THREE.Vector3(600, 16, 600), .05, 50);
  assert.ok(M.world.blockInfoAt(x, y, z), 'defense blocks stay loaded while exploring');
});


test('unrelated construction cannot reset an ongoing ten-second bite', () => {
  const { M, scene, world, tree, drops } = fixture();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== 3) continue;
    for (let y = 0; y < 3; y++) world.place(x, y, z);
  }
  M.enemies.init({ scene, world, tree });
  M.enemies.spawnAt(M.enemies.navigation.nodeAt(9, 0, 1));
  for (let i = 0; i < 10; i++) { world.place(20, i, 20); advance(M, 1); }
  assert.equal(drops.length, 1);
});

test('chewed drops stack, survive ordinary drop limits, and collect into placeable inventory', () => {
  const { M, THREE, scene, load } = harness(true);
  load('js/items.js'); M.items.init(scene);
  for (let i = 0; i < 200; i++) M.items.dropBlock('stone', 5, 13, -25, { persistent: true });
  assert.equal(M.items.drops.length, 1);
  assert.equal(M.items.drops[0].userData.drop.count, 200);
  for (let i = 0; i < 200; i++) M.items.dropBlock('dirt', 70, 14, 70);
  assert.ok(M.items.drops.some(drop => drop.userData.drop.persistent));
  const drop = M.items.drops.find(drop => drop.userData.drop.persistent);
  const goat = new THREE.Group(); goat.position.copy(drop.position); goat.position.y -= .9;
  for (let i = 0; i < 20; i++) M.items.update(.05, i * .05, goat);
  assert.equal(M.items.slots[1].kind, 'stone'); assert.equal(M.items.slots[1].count, 200);
});


test('later waves send larger groups, still staggered rather than all at once', () => {
  const { M, scene, world, tree } = fixture(); tree.damage = () => {};
  M.enemies.init({ scene, world, tree });
  advance(M, 25); assert.equal(M.enemies.zombies.length, 4);
  while (M.enemies.zombies.length) M.enemies.attack(M.enemies.zombies[0].position, 0, true);
  advance(M, .1); assert.equal(M.enemies.getState().coins, 6, 'wave clear bonus is paid once');
  assert.equal(M.enemies.getState().phase, 'intermission');
  advance(M, 12.1); assert.equal(M.enemies.getState().wave, 2); assert.equal(M.enemies.zombies.length, 1);
  advance(M, 20); assert.equal(M.enemies.zombies.length, 7);
});

test('local navigation edits match a fresh field, including new walls and mined tunnels', () => {
  const { M } = harness(true), w = M.world, t = M.hearthTree;
  const nav = M.zombieNavigation.create(w, t, { radius: 12 }); nav.rebuild();
  const x = 6, z = 0, by = Math.floor(w.surfaceHeight(13, 1) / 2);
  function compare() {
    nav.rebuild();
    const fresh = M.zombieNavigation.create(w, t, { radius: 12 }); fresh.rebuild();
    const distances = n => n.nodes.map(p => [p.bx, p.y, p.bz, p.distance].join('/')).sort();
    assert.deepEqual(distances(nav), distances(fresh));
  }
  w.placeBlock('stone', x, by, z); w.placeBlock('stone', x, by + 1, z); compare();
  w.breakBlockAt(x, by, z); compare();
  w.breakBlockAt(x, by + 1, z); compare();
  // A two-block-high tunnel beneath an intact roof is navigable even though
  // the terrain column still has a higher top surface.
  const bx = 9, bz = 0, ground = w.surfaceHeight(19, 1) / 2;
  w.breakBlockAt(bx, ground - 2, bz); w.breakBlockAt(bx, ground - 3, bz); compare();
  const floor = (ground - 3) * 2;
  assert.equal(w.navigationBlockedAt(19, 1, floor + .01, floor + 2.8), false);
  assert.ok(nav.nodeAt(19, floor, 1), 'tunnel floor appears in navigation');
});


test('death animation stays bounded and expires without changing immediate kills or rewards', () => {
  const { M, THREE, world, tree, scene } = fixture();
  M.enemies.init({ scene, world, tree });
  const origin = new THREE.Vector3(9, 0, 1);
  for (let i = 0; i < 50; i++) M.enemies.spawnAt(origin);
  const mesh = scene.children.find(node => node.name === 'Enemy horde');
  assert.ok(mesh.instanceColor, 'instance colors exist before an empty first draw compiles the shader');
  M.enemies.attack(origin, 0, true);
  assert.equal(M.enemies.getState().count, 0, 'fallen bodies stop being enemies immediately');
  assert.equal(M.enemies.getState().coins, 0, 'kills never credit the wallet automatically');
  assert.ok(mesh.count > 0 && mesh.count <= mesh.instanceMatrix.count, 'only a bounded visual death pool remains');
  for (let i = 0; i < 50; i++) M.enemies.spawnAt(origin);
  advance(M, 0.2);
  assert.ok(mesh.count <= mesh.instanceMatrix.count);
  assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite), 'crowded articulated poses stay finite');
  M.enemies.attack(origin, 0, true);
  advance(M, 0.8);
  assert.equal(mesh.count, 0, 'no corpse instances leak after their animation');
});

test('new enemy species unlock gradually with bounded durable-unit proportions', () => {
  const { M } = harness();
  for (let wave = 1; wave <= 30; wave++) {
    const roster = Array.from({ length: M.enemies.waveSize(wave) }, (_, i) => M.enemies.typeForWave(wave, i));
    assert.ok(roster.length <= 50);
    for (const type of roster) assert.ok(M.enemies.types[type].unlock <= wave);
    if (wave < 3) assert.ok(roster.every(type => type === 'zombie'));
    if (wave >= 3) assert.ok(roster.includes('spider'));
    if (wave >= 5) assert.ok(roster.includes('skeleton'));
    if (wave >= 8) assert.ok(roster.includes('brute'));
    assert.ok(roster.filter(type => type === 'brute').length <= Math.floor(roster.length / 6));
  }
});

test('all enemy species walk toward the Hearth and deal their distinct contact damage', () => {
  for (const type of ['zombie', 'spider', 'skeleton', 'brute']) {
    const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
    const enemy = M.enemies.spawnAt({ x: 9, y: 0, z: 1 }, type);
    const def = M.enemies.types[type];
    advance(M, 3);
    assert.ok(enemy.position.x < 8, type + ' follows the shared route');
    // Isolate contact timing from travel and other automatic spawns.
    enemy.position.set(3, 0, 1); enemy.bite = 0;
    const health = tree.health;
    advance(M, def.bite - .1); assert.equal(tree.health, health);
    advance(M, .15); assert.equal(tree.health, health - def.damage, type + ' bites once at its interval');
    assert.equal(enemy.hp, def.hp);
  }
});

test('a mixed horde shares the fifty-enemy cap, finite render pool and physical rewards', () => {
  const { M, scene, world, tree, coinDrops } = fixture(); M.enemies.init({ scene, world, tree });
  const types = Object.keys(M.enemies.types);
  for (let i = 0; i < 100; i++) M.enemies.spawnAt({ x: 9, y: 0, z: 1 }, types[i % 4]);
  assert.equal(M.enemies.getState().count, 50);
  const expected = M.enemies.zombies.reduce((sum, enemy) => sum + M.enemies.types[enemy.type].reward, 0);
  advance(M, .1);
  const mesh = scene.getObjectByName('Enemy horde');
  assert.ok(mesh.count <= mesh.instanceMatrix.count); assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite));
  M.enemies.attack({ x: 9, y: 0, z: 1 }, 0, true, { damage: 10, range: 5 });
  assert.equal(M.enemies.getState().count, 0); assert.equal(M.enemies.getState().coins, 0);
  assert.equal(coinDrops.reduce((sum, drop) => sum + drop.count, 0), expected);
  advance(M, 1); assert.equal(mesh.count, 0);
});

test('clearing actual waves introduces each species, pays one bonus, and gives a training break', () => {
  const { M, scene, world, tree } = fixture(); tree.damage = () => {};
  M.enemies.init({ scene, world, tree });
  const rosters = new Map();
  let lastId = -1, bonus = 0;
  for (let i = 0; i < 12000 && M.enemies.getState().wave < 9; i++) {
    M.enemies.update(.05);
    const state = M.enemies.getState();
    for (const enemy of M.enemies.zombies.slice()) {
      if (enemy.id > lastId) {
        if (!rosters.has(state.wave)) rosters.set(state.wave, []);
        rosters.get(state.wave).push(enemy.type); lastId = enemy.id;
      }
      M.enemies.attack(enemy.position, 0, true, { damage: 20, range: 1 });
    }
    if (state.phase === 'intermission') {
      assert.ok(state.nextWave <= 12); assert.ok(!state.count && !state.pending);
      if (state.coins > bonus) bonus = state.coins;
    }
  }
  assert.equal(M.enemies.getState().wave, 9);
  assert.equal(rosters.get(1).length, 4); assert.equal(rosters.get(2).length, 7);
  assert.ok(rosters.get(3).includes('spider')); assert.ok(rosters.get(5).includes('skeleton')); assert.ok(rosters.get(8).includes('brute'));
  assert.equal(M.enemies.getState().coins, Array.from({ length: 8 }, (_, i) => Math.min(24, 6 + i * 2)).reduce((a, b) => a + b), 'bonuses pay once per completed wave');
});

test('automatic waves skip isolated canopy surfaces that would stall wave completion', () => {
  const { M, scene, context } = harness(true);
  M.enemies.init({ scene, world: M.world, tree: M.hearthTree });
  const nodes = M.enemies.navigation.nodes;
  const stranded = nodes.find(node => !Number.isFinite(node.distance) && Math.hypot(node.x, node.z) >= 54 &&
    Math.hypot(node.x, node.z) <= 72 && M.world.waterDepthAt(node.x, node.z) < .9);
  assert.ok(stranded, 'real woodland has isolated canopy spawn candidates');
  // Force the exact formerly failing choice, independently of random sampling.
  nodes.splice(nodes.indexOf(stranded), 1); nodes.unshift(stranded);
  vm.runInContext('Math.random = () => 0;', context);
  advance(M, 10.05);
  assert.equal(M.enemies.zombies.length, 1);
  const enemy = M.enemies.zombies[0], node = M.enemies.navigation.nodeAt(enemy.position.x, enemy.position.y, enemy.position.z);
  assert.ok(node && Number.isFinite(node.distance), 'the chosen spawn has a proven walking route');
  assert.notEqual(node, stranded);
});

test('twenty seconds without real progress explodes stalled enemies, drops loot once and frees the cap', () => {
  for (const type of Object.keys(harness().M.enemies.types)) {
    const { M, scene, world, tree, coinDrops } = fixture();
    const blasts = []; M.audio = { enemyBurst: point => blasts.push(point.clone()) };
    M.enemies.init({ scene, world, tree });
    const enemy = M.enemies.spawnAt({ x: 9, y: 0, z: 1 }, type);
    M.actorPhysics.moveHorizontal = () => false;
    advance(M, 19.95); assert.ok(M.enemies.zombies.includes(enemy), type + ' survives until the full deadline');
    advance(M, .05); assert.equal(M.enemies.zombies.includes(enemy), false, type + ' explodes at 20 seconds');
    assert.equal(enemy.hp, 0); assert.equal(enemy.exploded, true);
    assert.equal(blasts.length, 1); assert.equal(coinDrops.length, 1);
    assert.equal(coinDrops[0].count, M.enemies.types[type].reward);
    assert.equal(M.enemies.getState().coins, 0, 'watchdog loot must still be collected');
    assert.equal(tree.health, 100, 'a recovery explosion does not damage the Hearth');
    const mesh = scene.getObjectByName('Enemy horde');
    assert.ok(mesh.count <= mesh.instanceMatrix.count); assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite));
    advance(M, 1); assert.equal(blasts.length, 1); assert.equal(coinDrops.length, 1);
  }
});

test('watchdog ignores jitter and replans, but resets after meaningful movement', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  const enemy = M.enemies.spawnAt({ x: 15, y: 0, z: 1 });
  M.actorPhysics.moveHorizontal = () => false;
  for (let i = 0; i < 300; i++) {
    enemy.position.x = 15 + Math.sin(i) * .03;
    enemy.target = null; enemy.path = null;
    M.enemies.update(.05);
  }
  assert.ok(M.enemies.zombies.includes(enemy));
  enemy.position.x = 13; M.enemies.update(.05);
  const progressAt = enemy.progressAt;
  advance(M, 19.9); assert.ok(M.enemies.zombies.includes(enemy));
  advance(M, .1); assert.equal(M.enemies.zombies.includes(enemy), false);
  assert.ok(progressAt > 15, 'real movement earns another 20-second window');
});

test('productive wall breaches and Hearth bites remain alive beyond twenty seconds', () => {
  const { M, scene, world, tree } = fixture();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== 3) continue;
    for (let y = 0; y < 3; y++) world.place(x, y, z);
  }
  M.enemies.init({ scene, world, tree });
  const enemy = M.enemies.spawnAt({ x: 9, y: 0, z: 1 });
  advance(M, 25);
  assert.ok(M.enemies.zombies.includes(enemy), 'successful block breaks are progress');
  assert.ok(enemy.progressAt > 10);
  enemy.position.set(3, 0, 1); enemy.target = null; enemy.path = null;
  advance(M, 21);
  assert.ok(M.enemies.zombies.includes(enemy), 'attacking the objective is progress');
  assert.equal(enemy.exploded, undefined); assert.ok(tree.health < 100);
});

test('watchdog accepts progress along a longer detour after construction changes the route', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  const enemy = M.enemies.spawnAt({ x: 15, y: 0, z: 1 });
  advance(M, .05);
  // Closing the short western route requires walking away from the Hearth
  // for more than twenty seconds before reaching the other side of this wall.
  for (let z = -10; z <= 10; z++) for (let y = 0; y < 3; y++) world.place(5, y, z);
  advance(M, 23);
  assert.ok(M.enemies.zombies.includes(enemy), 'a moving enemy must not expire against its old shorter route');
  assert.ok(enemy.progressAt > 20, 'advancing along the new route resets the watchdog');
});

test('unrelated navigation revisions cannot extend a stalled enemy watchdog', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  const enemy = M.enemies.spawnAt({ x: 15, y: 0, z: 1 });
  M.actorPhysics.moveHorizontal = () => false;
  for (let i = 0; i < 20; i++) { world.place(22, i % 3, 10 + i); advance(M, 1); }
  assert.equal(M.enemies.zombies.includes(enemy), false);
});

test('all enemy species animate hierarchical joints with finite colors and aligned highlights', () => {
  const { M, THREE, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  const mesh = scene.getObjectByName('Enemy horde');
  const outline = scene.getObjectByName('Enemies in attack range');
  assert.ok(mesh.geometry.getAttribute('position').count > 24, 'shared enemy geometry has beveled surfaces');
  for (const type of Object.keys(M.enemies.types)) M.enemies.spawnAt({ x: 9, y: 0, z: 1 }, type);
  advance(M, .2);
  const first = Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16));
  advance(M, .2);
  const second = Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16));
  assert.notDeepEqual(first, second, 'hierarchical poses change over time');
  assert.ok(second.every(Number.isFinite));
  assert.ok(Array.from(mesh.instanceColor.array.slice(0, mesh.count * 3)).every(value => Number.isFinite(value) && value >= 0));
  M.enemies.highlight(() => true);
  assert.equal(outline.count, mesh.count);
  const matrix = new THREE.Matrix4(), expected = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix); outline.getMatrixAt(i, expected);
    assert.ok(Math.abs(matrix.elements[12] - expected.elements[12]) < .001);
    assert.ok(Math.abs(matrix.elements[14] - expected.elements[14]) < .001);
  }
});
