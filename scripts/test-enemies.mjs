import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const scripts = new Map();
function harness(realWorld = false) {
  const drawing = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  const context = vm.createContext({ window: { matchMedia: () => ({ matches: false }) },
    document: { createElement: () => ({ getContext: () => drawing }), getElementById: () => null }, console });
  const load = file => {
    if (!scripts.has(file)) scripts.set(file, new vm.Script(readFileSync(new URL(file, root), 'utf8'), { filename: file }));
    return scripts.get(file).runInContext(context);
  };
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
  ['js/zombie-navigation.js', 'js/hell-gates.js', 'js/enemy-rules.js', 'js/enemy-models.js', 'js/enemy-boats.js', 'js/enemies.js'].forEach(load);
  return { M, THREE, scene, drops, coinDrops, load, context };
}
function fixture() {
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
const advance = (M, seconds, dt = .05) => {
  M.enemies.beginFrame();
  for (let i = 0; i < Math.round(seconds / dt); i++) M.enemies.update(dt);
  M.enemies.syncRender();
};

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

test('enemies arrive gradually and share the configured living cap', () => {
  const { M, scene, world, tree } = fixture();
  tree.damage = () => {}; // Keep the objective alive while testing the spawn cap.
  M.enemies.init({ scene, world, tree });
  advance(M, 29); assert.equal(M.enemies.zombies.length, 0);
  advance(M, 1.1); assert.equal(M.enemies.zombies.length, 1);
  const node = M.enemies.navigation.nodeAt(45, 0, 1);
  for (let i = 0; i < M.enemies.maxEnemies + 80; i++) M.enemies.spawnAt(node);
  assert.equal(M.enemies.zombies.length, M.enemies.maxEnemies);
  // A short crowded interval exercises cap retention; dedicated watchdog
  // tests below already cover the much longer stalled-enemy deadline.
  advance(M, 2);
  assert.ok(M.enemies.zombies.length <= M.enemies.maxEnemies);
  assert.equal(M.enemies.getState().wave, 1, 'a crowded wave cannot silently queue another wave');
});

test('wave 100 continuously replenishes every species without advancing', () => {
  const { M, scene } = harness(true), world = M.world, tree = M.hearthTree;
  tree.damage = () => {};
  M.enemies.init({ scene, world, tree });
  const e = M.enemies;
  assert.equal(e.startWave(100), true);
  assert.equal(e.getState().phase, 'endless');
  const roster = new Set(Array.from({ length: 200 }, (_, i) => e.typeForWave(100, i)));
  assert.deepEqual([...roster].sort(), Object.keys(e.types).sort());
  assert.equal(e.startNextWave(), false);
  assert.equal(e.startWave(101), false);
  const node = e.navigation.nodes.find(n => !n.swim && Number.isFinite(n.distance));
  for (let i = 0; i < 200; i++) e.spawnAt(node);
  advance(M, .1);
  assert.equal(e.zombies.length, 200);
  for (const enemy of e.zombies.slice(0, 5)) e.damageEnemy(enemy, enemy.maxHp);
  advance(M, 3);
  assert.ok(e.zombies.length > 195 && e.zombies.length <= 200, 'fallen enemies are replenished within the cap');
  assert.equal(e.getState().wave, 100);
  for (const enemy of e.zombies.slice()) e.damageEnemy(enemy, enemy.maxHp);
  advance(M, .6);
  assert.equal(e.getState().wave, 100);
  assert.equal(e.getState().phase, 'endless');
  assert.ok(e.zombies.length > 0, 'spawning resumes even after a complete wipe');
});

test('opening enemies spawn at a distant forest gate', () => {
  const { M, scene, world, tree } = fixture();
  M.enemies.init({ scene, world, tree });
  advance(M, 30.1);
  assert.equal(M.enemies.zombies.length, 1);
  const p = M.enemies.zombies[0].position;
  const distance = Math.hypot(p.x - tree.position.x, p.z - tree.position.z);
  // The walker has already had up to three 50ms movement ticks since spawn.
  assert.ok(distance >= 64 - M.enemies.types.zombie.speed * .15 && distance <= 96, `spawn distance ${distance}`);
});

test('opening squads arrive together, leave a recovery gap, and finish the exact roster', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  M.enemies.startNextWave();
  advance(M, 1.4);
  assert.equal(M.enemies.zombies.length, 3, 'three enemies arrive close enough to pressure hunters together');
  assert.equal(M.enemies.getState().pending, 3);
  assert.ok(M.enemies.getState().nextSquad >= 4);
  const first = M.enemies.zombies.map(enemy => enemy.position.clone());
  assert.ok(first.every(p => p.z > tree.position.z + 30), 'opening squad approaches from the player side');
  assert.ok(Math.max(...first.map(p => p.x)) - Math.min(...first.map(p => p.x)) < 14, 'squad shares a narrow front');
  advance(M, 3.5); assert.equal(M.enemies.zombies.length, 3, 'squad gap provides breathing room');
  advance(M, 2);
  assert.equal(M.enemies.zombies.length, 6); assert.equal(M.enemies.getState().pending, 0);
  advance(M, 2); assert.equal(M.enemies.getState().wave, 1, 'living enemies prevent automatic overlap');
});

test('wave two alternates squads across the announced opposing flanks', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  M.enemies.startWave(2);
  const lanes = M.enemies.getState().spawnLanes;
  assert.equal(lanes.length, 2);
  const heading = p => Math.atan2(p.x - tree.position.x, p.z - tree.position.z);
  const separation = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  assert.ok(separation(heading(lanes[0]), heading(lanes[1])) > 2.9);
  const seen = new Set(), fronts = [];
  for (let i = 0; i < 150; i++) {
    M.enemies.update(.05);
    for (const enemy of M.enemies.zombies) if (!seen.has(enemy.id)) {
      seen.add(enemy.id); fronts.push(heading(enemy.position));
    }
  }
  assert.ok(fronts.length >= 6);
  fronts.slice(0, 3).forEach(angle => assert.ok(separation(angle, heading(lanes[0])) < .2));
  fronts.slice(3, 6).forEach(angle => assert.ok(separation(angle, heading(lanes[1])) < .2));
  assert.equal(M.enemies.getState().approaches, lanes.map(lane => lane.label).join(' / '));
});

test('blocked spawns retain their squad and resume without a catch-up burst', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  M.enemies.startWave(2);
  world.waterDepthAt = () => 2;
  advance(M, 3);
  assert.equal(M.enemies.getState().pending, 10); assert.equal(M.enemies.zombies.length, 0);
  world.waterDepthAt = () => 0;
  advance(M, .55);
  assert.equal(M.enemies.zombies.length, 1); assert.equal(M.enemies.getState().pending, 9);
  advance(M, .65); assert.equal(M.enemies.zombies.length, 2);
});

test('a full living cap preserves queued enemies until a slot becomes free', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  for (let i = 0; i < M.enemies.maxEnemies; i++) M.enemies.spawnAt({ x: 15, y: 0, z: 1 });
  M.enemies.startWave(3); advance(M, 1);
  assert.equal(M.enemies.getState().pending, 14);
  M.enemies.damageEnemy(M.enemies.zombies[0], 100);
  advance(M, .05);
  assert.equal(M.enemies.zombies.length, M.enemies.maxEnemies);
  assert.equal(M.enemies.getState().pending, 13);
});

test('opening difficulty teaches groups before raising HP, with bounded late-wave pressure', () => {
  const { M } = harness();
  for (let wave = 1; wave <= 100; wave++) {
    const plan = M.enemies.wavePlan(wave), difficulty = M.enemies.waveDifficulty(wave);
    assert.ok(plan.size <= M.enemies.maxEnemies && plan.size >= 6);
    assert.ok(plan.squadSize <= 5 && plan.memberInterval >= .3 && plan.squadInterval >= 2.4);
    assert.ok(difficulty.hp >= 1 && difficulty.hp < 5 && difficulty.speed >= 1 && difficulty.speed < 3);
    if (wave <= 3) assert.equal(difficulty.hp, 1, 'opening waves keep the same base health');
    if (wave >= 6) assert.equal(plan.lanes, 3);
    if ([3, 5, 8].includes(wave)) {
      const previous = M.enemies.wavePlan(wave - 1);
      assert.equal(plan.lanes, previous.lanes, 'new species do not also introduce another front');
      assert.equal(plan.squadSize, previous.squadSize, 'new species do not also enlarge squads');
    }
  }
  assert.equal(M.enemies.waveSize(1000), M.enemies.maxEnemies);
});

test('every species has exactly four times its previous health and wave gains, including bosses and special deliveries', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  const previousBase = { zombie: 2, spider: 2, skeleton: 3, brute: 7, worm: 4, binder: 3, prismback: 4, sower: 3, boss: 2 };
  const previousHealth = (type, wave) => Math.round(previousBase[type] *
    (1 + 4 * (1 - Math.exp(-Math.max(0, wave - 3) / 30))) * (type === 'boss' ? 20 : 1));
  for (const type of Object.keys(previousBase)) {
    assert.equal(M.enemies.types[type].hp, 4 * previousBase[type]);
    for (const wave of [1, 3, 4, 7, 12, 20, 30, 70, 80, 130, 1000]) {
      const current = M.enemyRules.healthForWave(type, wave);
      assert.equal(current, 4 * previousHealth(type, wave), type + ' at wave ' + wave);
      assert.equal(current - M.enemyRules.healthForWave(type, 1),
        4 * (previousHealth(type, wave) - previousHealth(type, 1)), 'wave health gains scale proportionally');
    }
  }
  // Exercise real spawn initialization as well as pure rules. Stats stay locked
  // when later waves start, and parachuting and surface Worms use the same HP.
  const initial = M.enemies.spawnAt({ x: 15, y: 0, z: 1 });
  assert.equal(initial.hp, 8); assert.equal(initial.maxHp, 8);
  for (const wave of [20, 30, 70, 100]) {
    M.enemies.startWave(wave);
    for (const type of Object.keys(previousBase)) {
      const enemy = M.enemies.spawnAt({ x: 15, y: 30, z: 1 }, type, { airborne: true });
      assert.equal(enemy.hp, 4 * previousHealth(type, wave)); assert.equal(enemy.maxHp, enemy.hp);
      M.enemies.damageEnemy(enemy, enemy.hp);
    }
    assert.equal(initial.maxHp, 8, 'a later wave never retroactively levels up an existing enemy');
  }
});

test('the actual terrain delivers opening threats promptly without an immediate defeat', () => {
  const { M, scene } = harness(true);
  M.enemies.init({ scene, world: M.world, tree: M.hearthTree });
  M.enemies.startNextWave(); // This scenario measures travel after the preparation countdown.
  let usedRoad = false;
  for (let i = 0; i < 1400; i++) {
    M.enemies.update(.05);
    usedRoad ||= M.enemies.zombies.some(e => M.hellGates.isRoad(Math.floor(e.position.x / 2), Math.floor(e.position.z / 2), e.position.y));
  }
  assert.ok(usedRoad, 'gate arrivals use the winding paved approaches');
  assert.ok(M.hearthTree.health < 100, 'distant gate arrivals reach the Hearth without defenders');
  assert.ok(M.hearthTree.health >= 70, 'the first wave still leaves time to respond');
  assert.equal(M.enemies.getState().pending, 0);
});

test('automatic squads can spawn with a viable breach when the Hearth is sealed', () => {
  const { M, scene, world, tree } = fixture();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== 3) continue;
    for (let y = 0; y < 3; y++) world.place(x, y, z);
  }
  M.enemies.init({ scene, world, tree }); M.enemies.startNextWave();
  advance(M, 1.4);
  assert.equal(M.enemies.zombies.length, 3);
  for (const enemy of M.enemies.zombies) {
    assert.ok(enemy.path && enemy.path.some(node => node.blocks.length), 'each disconnected spawn has a real breach plan');
  }
});

test('defense HUD reports the living cap, squad countdown and upcoming approaches', () => {
  const { M, scene, world, tree, context } = fixture(); M.enemies.init({ scene, world, tree });
  const elements = new Map(['tree-hp', 'tree-health', 'tree-health-fill', 'defense-coins', 'defense-enemies', 'defense-wave', 'defense-status', 'defeat'].map(id => [id,
    { style: {}, setAttribute() {}, classList: { toggle() {} } }]));
  context.document.getElementById = id => elements.get(id) || null;
  context.document.querySelector = () => null;
  context.window.addEventListener = () => {};
  vm.runInContext(readFileSync(new URL('js/ui.js', root), 'utf8'), context);
  M.ui.init(); M.ui.setDefense(M.enemies.getState());
  assert.equal(elements.get('defense-enemies').textContent, '0 / 200');
  assert.match(elements.get('defense-status').textContent, /First wave in 30s · S/);
  M.enemies.startNextWave(); advance(M, 1.4);
  assert.match(elements.get('defense-wave').textContent, /Wave 1 · S/);
  assert.match(elements.get('defense-status').textContent, /3 incoming · squad in [45]s/);
  advance(M, 6);
  M.enemies.zombies.slice().forEach(enemy => M.enemies.damageEnemy(enemy, 100));
  advance(M, .05);
  const state = M.enemies.getState();
  assert.equal(state.phase, 'intermission');
  assert.equal(state.spawnLanes.length, 2);
  assert.ok(elements.get('defense-status').textContent.includes(state.approaches));
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
  assert.equal(M.enemies.attack(origin, Math.PI, false), true); assert.equal(zombie.hp, 7);
  for (let i = 0; i < 7; i++) assert.equal(M.enemies.attack(origin, Math.PI, false), true);
  assert.equal(zombie.hp, 0); assert.equal(M.enemies.getState().coins, 0);
  M.enemies.attack(origin, Math.PI, false); assert.equal(M.enemies.getState().coins, 0);
  const stomped = M.enemies.spawnAt(node);
  for (let i = 0; i < 4; i++) M.enemies.attack(origin, 0, true);
  assert.equal(stomped.hp, 0);
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
  assert.ok(scene.getObjectByName('Enemy horde').count <= scene.getObjectByName('Enemy horde').instanceMatrix.count);
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
  // Two separate rebuilds during the bite cover timer preservation without
  // rebuilding the same flat arena every simulated second.
  for (let i = 0; i < 2; i++) { world.place(20, i, 20); advance(M, 5); }
  assert.equal(drops.length, 1);
});

test('chewed drops stack, survive ordinary drop limits, and collect into placeable inventory', () => {
  const { M, THREE, scene, load } = harness(true);
  load('js/coin-model.js'); load('js/inventory.js'); load('js/items.js'); M.items.init(scene);
  for (let i = 0; i < 200; i++) M.items.dropBlock('stone', 5, 15, -25, { persistent: true });
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
  advance(M, 40); assert.equal(M.enemies.zombies.length, 6);
  while (M.enemies.zombies.length) M.enemies.attack(M.enemies.zombies[0].position, 0, true);
  advance(M, .1); assert.equal(M.enemies.getState().coins, 6, 'wave clear bonus is paid once');
  assert.equal(M.enemies.getState().phase, 'intermission');
  advance(M, 10.1); assert.equal(M.enemies.getState().wave, 2); assert.equal(M.enemies.zombies.length, 1);
  advance(M, 20); assert.equal(M.enemies.zombies.length, 10);
});

test('every tenth cleared wave gives a full minute of rest, while ordinary breaks stay ten seconds', () => {
  const { M, scene } = harness(true), world = M.world, tree = M.hearthTree; tree.damage = () => {};
  const e = M.enemies; e.init({ scene, world, tree }); e.beginFrame();
  for (const level of [9, 10, 20, 30]) {
    for (const enemy of e.zombies.slice()) e.damageEnemy(enemy, enemy.maxHp);
    const wallet = e.getState().coins;
    e.startWave(level);
    let ticks = 0;
    while ((e.getState().pending || e.getState().count) && ticks++ < 5000) {
      e.update(.1);
      for (const enemy of e.zombies.slice()) e.damageEnemy(enemy, enemy.maxHp);
    }
    assert.ok(ticks < 5000, 'the complete roster was delivered');
    e.update(.1);
    const rest = level % 10 === 0 ? 60 : 10;
    assert.equal(e.getState().phase, 'intermission');
    assert.equal(e.getState().nextWave, rest);
    assert.equal(e.getState().coins, wallet + Math.min(24, 4 + level * 2));
    e.update(rest - .1);
    assert.equal(e.getState().wave, level, 'no wave arrives during the promised break');
    assert.equal(e.getState().count, 0); assert.equal(e.getState().pending, 0);
    assert.equal(e.getState().coins, wallet + Math.min(24, 4 + level * 2), 'bonus is paid once');
    e.update(.2);
    assert.equal(e.getState().wave, level + 1);
    assert.ok(e.getState().pending > 0);
  }
  e.syncRender();
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
  M.enemies.attack(origin, 0, true, { damage: 8 });
  assert.equal(M.enemies.getState().count, 0, 'fallen bodies stop being enemies immediately');
  assert.equal(M.enemies.getState().coins, 0, 'kills never credit the wallet automatically');
  assert.ok(mesh.count > 0 && mesh.count <= mesh.instanceMatrix.count, 'only a bounded visual death pool remains');
  for (let i = 0; i < 50; i++) M.enemies.spawnAt(origin);
  advance(M, 0.2);
  assert.ok(mesh.count <= mesh.instanceMatrix.count);
  assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite), 'crowded articulated poses stay finite');
  M.enemies.attack(origin, 0, true, { damage: 8 });
  advance(M, 0.8);
  assert.equal(mesh.count, 0, 'no corpse instances leak after their animation');
});

test('new enemy species unlock gradually with bounded durable-unit proportions', () => {
  const { M } = harness();
  for (let wave = 1; wave <= 30; wave++) {
    if (wave === 30) continue; // The all-Worm special wave overrides normal species proportions.
    const roster = Array.from({ length: M.enemies.waveSize(wave) }, (_, i) => M.enemies.typeForWave(wave, i));
    assert.ok(roster.length <= M.enemies.maxEnemies);
    for (const type of roster) assert.ok(M.enemies.types[type].unlock <= wave);
    if (wave < 3) assert.ok(roster.every(type => type === 'zombie'));
    if (wave >= 3) assert.ok(roster.includes('spider'));
    if (wave >= 5) assert.ok(roster.includes('skeleton'));
    if (wave >= 8) assert.ok(roster.includes('brute'));
    assert.ok(roster.filter(type => type === 'brute').length <= Math.floor(roster.length / 6));
  }
});

test('all enemy species walk toward the Hearth and deal their distinct contact damage', () => {
  for (const type of ['zombie', 'spider', 'raider', 'skeleton', 'brute']) {
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

test('a mixed horde shares the living cap, finite render pool and physical rewards', () => {
  const { M, scene, world, tree, coinDrops } = fixture(); M.enemies.init({ scene, world, tree });
  const types = ['zombie', 'spider', 'raider', 'skeleton'];
  for (let i = 0; i < M.enemies.maxEnemies + 100; i++) M.enemies.spawnAt({ x: 9, y: 0, z: 1 }, types[i % 4]);
  assert.equal(M.enemies.getState().count, M.enemies.maxEnemies);
  const expected = M.enemies.zombies.reduce((sum, enemy) => sum + M.enemies.types[enemy.type].reward, 0);
  advance(M, .1);
  const mesh = scene.getObjectByName('Enemy horde');
  assert.ok(mesh.count <= mesh.instanceMatrix.count); assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite));
  M.enemies.attack({ x: 9, y: 0, z: 1 }, 0, true, { damage: 28, range: 5 });
  assert.equal(M.enemies.getState().count, 0); assert.equal(M.enemies.getState().coins, 0);
  assert.equal(coinDrops.reduce((sum, drop) => sum + drop.count, 0), expected);
  advance(M, 1); assert.equal(mesh.count, 0);
});

test('clearing actual waves introduces each species, pays one bonus, and gives a training break', () => {
  const { M, scene } = harness(true), world = M.world, tree = M.hearthTree; tree.damage = () => {};
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
      M.enemies.attack(enemy.position, 0, true, { damage: enemy.maxHp, range: 1 });
    }
    if (state.phase === 'intermission') {
      assert.ok(state.nextWave <= 10); assert.ok(!state.count && !state.pending);
      if (state.coins > bonus) bonus = state.coins;
    }
  }
  assert.equal(M.enemies.getState().wave, 9);
  assert.equal(rosters.get(1).length, 6); assert.equal(rosters.get(2).length, 10);
  assert.ok(rosters.get(3).includes('spider')); assert.ok(rosters.get(5).includes('skeleton')); assert.ok(rosters.get(8).includes('brute'));
  assert.equal(M.enemies.getState().coins, Array.from({ length: 8 }, (_, i) => Math.min(24, 6 + i * 2)).reduce((a, b) => a + b), 'bonuses pay once per completed wave');
});

test('automatic waves skip isolated canopy surfaces that would stall wave completion', () => {
  const { M, scene, context } = harness(true);
  M.enemies.init({ scene, world: M.world, tree: M.hearthTree });
  const nodes = M.enemies.navigation.nodes;
  const stranded = nodes.find(node => !Number.isFinite(node.distance) && Math.hypot(node.x, node.z) >= 36 &&
    Math.hypot(node.x, node.z) <= 44 && M.world.waterDepthAt(node.x, node.z) < .9);
  assert.ok(stranded, 'real woodland has isolated canopy spawn candidates');
  // Force the exact formerly failing choice, independently of random sampling.
  nodes.splice(nodes.indexOf(stranded), 1); nodes.unshift(stranded);
  vm.runInContext('Math.random = () => 0;', context);
  advance(M, 30.05);
  assert.equal(M.enemies.zombies.length, 1);
  const enemy = M.enemies.zombies[0], node = M.enemies.navigation.nodeAt(enemy.position.x, enemy.position.y, enemy.position.z);
  assert.ok(node && Number.isFinite(node.distance), 'the chosen spawn has a proven walking route');
  assert.notEqual(node, stranded);
});

test('thirty seconds without progress explodes stalled walkers, burrowers and fliers and pays loot once', () => {
  // The watchdog is shared; sample all three movement modes rather than
  // repeating the same thirty-second scenario for every walking model.
  for (const type of ['zombie', 'worm', 'cinderwing']) {
    const { M, scene, world, tree, coinDrops } = fixture();
    const blasts = []; M.audio = { enemyBurst: point => blasts.push(point.clone()) };
    M.enemies.init({ scene, world, tree });
    const enemy = M.enemies.spawnAt({ x: 9, y: 0, z: 1 }, type, { surface: true });
    M.actorPhysics.moveHorizontal = () => false;
    enemy.speedScale = 0; // Flight also stalls for the shared watchdog scenario.
    M.enemies.beginFrame(); // Only the final pose matters in this timing regression.
    advance(M, 29.95); assert.ok(M.enemies.zombies.includes(enemy), type + ' survives until the full deadline');
    advance(M, .05); assert.equal(M.enemies.zombies.includes(enemy), false, type + ' explodes at 30 seconds');
    assert.equal(enemy.hp, 0); assert.equal(enemy.exploded, true);
    assert.equal(blasts.length, 1); assert.equal(coinDrops.length, 1);
    assert.equal(coinDrops[0].count, M.enemies.types[type].reward);
    assert.equal(M.enemies.getState().coins, 0, 'watchdog loot must still be collected');
    assert.equal(tree.health, 100, 'a recovery explosion does not damage the Hearth');
    M.enemies.syncRender();
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
  advance(M, 29.9); assert.ok(M.enemies.zombies.includes(enemy));
  advance(M, .1); assert.equal(M.enemies.zombies.includes(enemy), false);
  assert.ok(progressAt > 15, 'real movement earns another 30-second window');
});

test('wall breaks and Hearth bites cannot reset the distance watchdog', () => {
  const { M, scene, world, tree } = fixture();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== 3) continue;
    for (let y = 0; y < 3; y++) world.place(x, y, z);
  }
  M.enemies.init({ scene, world, tree });
  const enemy = M.enemies.spawnAt({ x: 9, y: 0, z: 1 });
  advance(M, 25);
  assert.ok(M.enemies.zombies.includes(enemy), 'the enemy advances through the breach before its deadline');
  assert.ok(enemy.progressAt > 10, 'advancing through the breach gets closer');
  M.enemies.damageEnemy(enemy, 1000);
  const biter = M.enemies.spawnAt({ x: 3, y: 0, z: 1 }), progressAt = biter.progressAt;
  advance(M, 29.95); assert.ok(M.enemies.zombies.includes(biter));
  assert.equal(biter.progressAt, progressAt, 'bites do not decrease distance');
  advance(M, .05); assert.equal(biter.exploded, true); assert.ok(tree.health < 100);
});

test('advancing along a detour without getting closer cannot extend the watchdog', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  const enemy = M.enemies.spawnAt({ x: 15, y: 0, z: 1 });
  advance(M, .05);
  // Closing the short western route requires walking away from the Hearth
  // for more than thirty seconds before reaching the other side of this wall.
  for (let z = -20; z <= 20; z++) for (let y = 0; y < 3; y++) world.place(5, y, z);
  advance(M, 2); const progressAt = enemy.progressAt;
  advance(M, 27.9);
  assert.ok(M.enemies.zombies.includes(enemy));
  assert.equal(enemy.progressAt, progressAt, 'route distance does not count as a closer approach');
  advance(M, 2); assert.equal(enemy.exploded, true);
});

test('unrelated navigation revisions cannot extend a stalled enemy watchdog', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  const enemy = M.enemies.spawnAt({ x: 15, y: 0, z: 1 });
  M.actorPhysics.moveHorizontal = () => false;
  for (let i = 0; i < 4; i++) { world.place(22, i % 3, 10 + i); advance(M, 7.5); }
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

test('catch-up simulation and multi-target spells upload just one final horde pose per frame', () => {
  const { M, THREE, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  const origin = new THREE.Vector3(15, 0, 1);
  for (let i = 0; i < 12; i++) M.enemies.spawnAt(origin, 'brute');
  const mesh = scene.getObjectByName('Enemy horde');
  M.enemies.update(1 / 60);
  const version = mesh.instanceMatrix.version;
  M.enemies.beginFrame();
  for (let i = 0; i < 4; i++) {
    M.enemies.update(1 / 60);
    M.enemies.spellBlast(origin, 4, .5);
  }
  assert.equal(mesh.instanceMatrix.version, version, 'neither catch-up ticks nor individual spell victims rebuild the horde');
  assert.ok(M.enemies.zombies.every(e => e.hp === 26), 'all four combat ticks still resolve');
  M.enemies.syncRender();
  assert.equal(mesh.instanceMatrix.version, version + 1);
  assert.equal(mesh.instanceMatrix.updateRange.count, mesh.count * 16, 'only populated instance data is uploaded');
  assert.equal(mesh.instanceColor.updateRange.count, mesh.count * 3);
  M.enemies.update(1 / 60);
  assert.equal(mesh.instanceMatrix.version, version + 2, 'standalone simulation keeps its normal rendering behavior');
});


test('Cinderwings smoothly clear constructed walls, hover four units above ground and bite the Hearth', () => {
  const { M, scene, world, tree, drops, coinDrops } = fixture();
  for (let z = -4; z <= 4; z++) for (let y = 0; y < 4; y++) world.place(6, y, z);
  M.enemies.init({ scene, world, tree });
  const enemy = M.enemies.spawnAt({ x: 23, y: 0, z: 1 }, 'cinderwing');
  assert.equal(enemy.position.y, 4); assert.equal(enemy.grounded, false);
  let crossed = false, previous = enemy.position.clone();
  for (let i = 0; i < 360; i++) {
    M.enemies.update(.05);
    assert.ok(Math.abs(enemy.position.y - previous.y) <= .301, 'continuous lift and descent');
    assert.equal(enemy.swimming, false); assert.equal(enemy.grounded, false);
    assert.ok(M.actorPhysics.clear(world, enemy.position.x, enemy.position.y, enemy.position.z, enemy.body, false));
    if (enemy.position.x >= 12 && enemy.position.x < 14) {
      crossed = true; assert.ok(enemy.position.y >= 8, 'body clears the four-block wall');
    }
    previous.copy(enemy.position);
  }
  assert.ok(crossed); assert.equal(drops.length, 0, 'walls remain intact');
  assert.ok(tree.health < 100, 'hovering at the trunk deals normal contact damage');
  assert.ok(Math.abs(enemy.position.y - 4) < .1, 'returns to two-block cruise clearance');
  assert.equal(M.enemies.isTargetable(enemy), true);
  M.enemies.damageEnemy(enemy, enemy.hp);
  assert.equal(coinDrops.length, 1); assert.equal(coinDrops[0].count, 3);
});

test('Cinderwings unlock at wave five and actually leave gates', () => {
  const { M, scene } = harness(true), world = M.world, tree = M.hearthTree;
  M.enemies.init({ scene, world, tree });
  for (let wave = 1; wave <= 8; wave++) {
    const types = Array.from({ length: M.enemies.waveSize(wave) }, (_, i) => M.enemies.typeForWave(wave, i));
    assert.equal(types.includes('cinderwing'), wave >= 5);
    for (let i = 0; i < types.length; i++) if (types[i] === 'cinderwing') assert.equal(M.enemies.deliveryForWave(wave, i, types[i]), 'ground');
  }
  M.enemies.startWave(5);
  let flier;
  for (let i = 0; i < 500 && !flier; i++) {
    M.enemies.update(.05);
    flier = M.enemies.zombies.find(e => e.type === 'cinderwing');
    for (const e of [...M.enemies.zombies]) if (e !== flier) M.enemies.damageEnemy(e, e.hp);
  }
  assert.ok(flier); assert.ok(flier.gateId !== undefined);
  const gate = M.hellGates.gates.find(g => g.id === flier.gateId);
  assert.ok(gate); assert.ok(Math.hypot(flier.position.x - gate.x, flier.position.z - gate.z) < 1);
  assert.equal(flier.airborne, undefined, 'natural flight has no parachute');
});


test('Cinderwing wingbeats freeze under reduced motion and jumping brings melee into reach', () => {
  const { M, scene, world, tree } = fixture(); M.enemies.init({ scene, world, tree });
  const enemy = M.enemies.spawnAt({ x: 23, y: 0, z: 1 }, 'cinderwing'); enemy.speedScale = 0; enemy.yaw = -Math.PI / 2;
  assert.equal(M.enemies.canHit(enemy, { x: 23, y: 0, z: 1 }, 0, true, 3), false);
  assert.equal(M.enemies.canHit(enemy, { x: 23, y: 2, z: 1 }, 0, true, 3), true);
  const mesh = scene.getObjectByName('Enemy horde');
  M.config.reducedMotion = true; M.enemies.update(.05);
  const pose = Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16));
  M.enemies.update(.1);
  assert.deepEqual(Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)), pose);
  M.config.reducedMotion = false; M.enemies.update(.1);
  assert.notDeepEqual(Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16)), pose);
});
