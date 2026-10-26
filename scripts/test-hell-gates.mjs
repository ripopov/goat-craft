import assert from 'node:assert/strict';
import test from 'node:test';
import { game } from './helpers/animal-game.mjs';

test('four starting forest gates have dry ground routes, collision and protected openings', () => {
  const { M, THREE, scene } = game({ renderRadius: 3 });
  const { gates, cells, roads, roadCells } = M.hellGates, world = M.world, nav = M.enemies.navigation;
  assert.equal(gates.length, 4);
  assert.equal(new Set(gates.map(g => g.x + ',' + g.z)).size, 4);
  const distances = gates.map(g => Math.hypot(g.x, g.z));
  assert.ok(Math.min(...distances) >= 64 && Math.max(...distances) <= 96);
  assert.ok(Math.max(...distances) - Math.min(...distances) > 10, 'near and far forest entrances');
  for (const gate of gates) {
    assert.equal(world.waterDepthAt(gate.x, gate.z), 0);
    assert.ok(Number.isFinite(nav.nodeAt(gate.x, gate.y, gate.z).distance));
    assert.equal(world.canPlaceBlock(gate.bx, gate.by, gate.bz), false);
    assert.equal(world.navigationBlockedAt(gate.x, gate.z, gate.y + .01, gate.y + 2.8), false);
  }
  assert.equal(roads.length, 8);
  for (const road of roads) {
    const gate = M.hellGates.sites.find(g => g.id === road.gateId), path = road.path;
    assert.equal(path[0].bx, gate.bx); assert.equal(path[0].bz, gate.bz);
    assert.ok(Math.hypot(path.at(-1).bx * 2 + 1, path.at(-1).bz * 2 + 1) < 10);
    const dx = path.at(-1).bx - gate.bx, dz = path.at(-1).bz - gate.bz;
    assert.ok(path.some(c => Math.abs((c.bx - gate.bx) * dz - (c.bz - gate.bz) * dx) / Math.hypot(dx, dz) > 3), 'visible bends on every road');
    for (let i = 0; i < path.length; i++) {
      const c = path[i], point = { x: c.bx * 2 + 1, y: c.top * 2, z: c.bz * 2 + 1 };
      assert.ok(Number.isFinite(nav.nodeAt(point.x, point.y, point.z)?.distance), 'every road tile reaches the Hearth');
      if (i) {
        const p = path[i - 1];
        assert.equal(Math.abs(c.bx - p.bx) + Math.abs(c.bz - p.bz), 1);
        assert.ok(nav.canWalk({ x: p.bx * 2 + 1, y: p.top * 2, z: p.bz * 2 + 1 }, point), 'walkable grade and headroom');
      }
    }
    let node = nav.nodeAt(gate.x, gate.y, gate.z), paved = 0, steps = 0;
    while (node.next) { paved += Number(node.road); steps++; node = node.next; assert.ok(steps < 150); }
    assert.ok(node.goal); assert.ok(paved / steps > .8, 'enemies favor the winding road');
  }
  for (const cell of [...cells, ...roadCells]) {
    assert.equal(world.blockInfoAt(cell.bx, cell.by, cell.bz).unbreakable, true);
    assert.equal(world.breakBlockAt(cell.bx, cell.by, cell.bz, { towerInternal: true, drop: false }), null);
    assert.equal(world.canPlaceBlock(cell.bx, cell.by, cell.bz), false);
    assert.equal(world.navigationBlockedAt(cell.bx * 2 + 1, cell.bz * 2 + 1, cell.by * 2 + .01, cell.by * 2 + 1.99), true);
  }
  // Terrain must never draw a face already owned by an overlapping plinth.
  const gateFaces = new Set();
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const cell of [...cells, ...roadCells]) for (const n of directions) gateFaces.add(
    [cell.bx * 2 + 1 + n[0], cell.by * 2 + 1 + n[1], cell.bz * 2 + 1 + n[2], ...n].join(','));
  const terrainGroup = scene.children.find(object => object.isGroup && object !== M.hearthTree.group);
  for (const chunk of terrainGroup.children) {
    const positions = chunk.children[0].geometry.attributes.position;
    const normals = chunk.children[0].geometry.attributes.normal;
    for (let i = 0; i < positions.count; i += 4) {
      const center = new THREE.Vector3();
      for (let j = 0; j < 4; j++) center.add(new THREE.Vector3().fromBufferAttribute(positions, i + j));
      center.multiplyScalar(.25).add(chunk.position);
      const face = [...center.toArray(), normals.getX(i), normals.getY(i), normals.getZ(i)].join(',');
      assert.equal(gateFaces.has(face), false, 'no coplanar soil/gate face: ' + face);
    }
  }
  // Walls may occupy the lane even though its paving cannot be mined.
  const tile = roadCells.find(c => Math.hypot(c.bx * 2 + 1, c.bz * 2 + 1) > 20 &&
    world.canPlaceBlock(c.bx, c.by + 1, c.bz) && world.canPlaceBlock(c.bx, c.by + 2, c.bz));
  assert.ok(tile);
  assert.equal(world.placeBlock('stone', tile.bx, tile.by + 1, tile.bz), true);
  assert.equal(world.placeBlock('stone', tile.bx, tile.by + 2, tile.bz), true);
  assert.ok(world.navigationBlockedAt(tile.bx * 2 + 1, tile.bz * 2 + 1, tile.by * 2 + 2.01, tile.by * 2 + 4.8));
  world.breakBlockAt(tile.bx, tile.by + 1, tile.bz, { drop: false });
  world.breakBlockAt(tile.bx, tile.by + 2, tile.bz, { drop: false });

  // Exercise real blast destruction beside a portal and again at the tree.
  M.actorPhysics.moveHorizontal = () => false;
  const health = M.hearthTree.health, treeGeometry = M.hearthTree.group.children.map(c => c.geometry);
  const gate = gates[0], inward = Math.sign(-gate.z);
  const wall = { bx: gate.bx, by: gate.by, bz: gate.bz + inward };
  assert.equal(world.placeBlock('stone', wall.bx, wall.by, wall.bz), true);
  const enemy = M.enemies.spawnAt({ x: gate.x, y: gate.y, z: gate.z });
  enemy.progressAt = -30; M.enemies.update(.05);
  assert.equal(enemy.exploded, true);
  assert.equal(world.blockInfoAt(wall.bx, wall.by, wall.bz), null, 'blast destroys a player wall');
  assert.ok(scene.getObjectByName('Enemy burst signal'));
  const nearTree = roads[0].path.at(-1);
  const attacker = M.enemies.spawnAt({ x: nearTree.bx * 2 + 1, y: nearTree.top * 2, z: nearTree.bz * 2 + 1 });
  attacker.progressAt = -30; M.enemies.update(.05);
  assert.equal(attacker.exploded, true);
  assert.equal(M.hearthTree.health, health, 'blast cannot damage the objective');
  assert.deepEqual(M.hearthTree.group.children.map(c => c.geometry), treeGeometry);
  // At this grade the Worm straddles two road columns with different heights.
  // Its tunnel must clear the lower paving before its center crosses the seam.
  const worm = M.enemies.spawnAt({ x: -5, y: world.terrainHeight(-5, -50.45), z: -50.45 }, 'worm');
  for (let i = 0; i < 20; i++) M.enemies.update(.05);
  assert.ok(worm.position.z > -48.45, 'underground movement passes beneath the road step');
  assert.equal(worm.burrowed, true); assert.equal(worm.exploded, undefined);
  assert.equal(scene.getObjectByName('Enemy burst signal'), undefined, 'blast effects expire');
  assert.equal(scene.getObjectByName('Enemy burrow signal').children[0].material.opacity, .9, 'blast fading cannot fade the shared Worm warning');
  for (const c of [...cells, ...roadCells]) assert.equal(world.blockInfoAt(c.bx, c.by, c.bz)?.unbreakable, true);
  world.update(new THREE.Vector3(600, 14, 600), .05, 1);
  for (const c of [...cells, ...roadCells]) assert.equal(world.blockInfoAt(c.bx, c.by, c.bz).unbreakable, true);
  assert.equal(M.hellGates.sites.filter(g => g.group.visible).length, 4);
});

test('ground arrivals use gates while boats and parachutes retain separate delivery', () => {
  const { M } = game({ seed: 17 }), enemies = M.enemies;
  M.hearthTree.damage = () => {};
  const seen = new Set(), species = new Set(), usedGates = new Set();
  let air = false, worm = false, sea = false;
  for (const wave of [1, 2, 3, 4, 5, 7, 8, 10, 12, 16]) {
    enemies.startWave(wave);
    for (let tick = 0; tick < 2000 && enemies.getState().pending; tick++) {
      enemies.update(.05);
      for (const enemy of enemies.zombies.slice()) {
        if (!seen.has(enemy.id)) {
          seen.add(enemy.id);
          if (enemy.boat) {
            sea = true; assert.equal(enemy.gateId, undefined);
            assert.equal(enemy.boat.crew.length, 4);
          } else if (enemy.airborne) {
            air = true; assert.equal(enemy.gateId, undefined);
            assert.ok(Math.hypot(enemy.position.x, enemy.position.z) >= 18);
            assert.ok(Math.hypot(enemy.position.x, enemy.position.z) <= 26);
          } else if (enemy.type === 'worm') {
            worm = true; assert.equal(enemy.burrowed, true);
            const gate = M.hellGates.gates.find(g => g.id === enemy.gateId);
            assert.ok(gate);
            assert.ok(Math.hypot(enemy.position.x - gate.x, enemy.position.z - gate.z) < .3);
            assert.ok(enemy.position.y + enemy.body.height < gate.y - 2, 'the whole body spawns below the plinth');
          } else {
            const gate = M.hellGates.gates.find(g => g.id === enemy.gateId);
            assert.ok(gate, enemy.type + ' comes from a hell gate');
            assert.ok(Math.hypot(enemy.position.x - gate.x, enemy.position.z - gate.z) < .3);
            species.add(enemy.type); usedGates.add(gate.id);
          }
        }
        // Removing arrivals isolates delivery from travel, combat and the cap.
        enemies.damageEnemy(enemy, 1000, { origin: enemy.position, area: true });
      }
    }
    assert.equal(enemies.getState().pending, 0, 'the complete roster can exit its gates');
  }
  assert.equal(species.size, Object.keys(enemies.types).length - 2);
  assert.ok(usedGates.size === 4); assert.ok(air); assert.ok(worm); assert.ok(sea);
});

test('all tower weapons damage gates on contact, each lane retreats once, and eight kills end the siege', () => {
  const { M, THREE, scene, load, context } = game({ seed: 17, renderRadius: 0 });
  const gates = M.hellGates, first = gates.gates[0], initial = gates.gates.slice();
  const bossHp = M.enemyRules.healthForWave('boss', M.enemyRules.types.boss.unlock);
  assert.equal(first.hp, bossHp * 100);
  assert.equal(first.successor.hp, bossHp * 200);
  for (const gate of initial) {
    const next = gate.successor;
    assert.ok(Math.abs(Math.hypot(next.x, next.z) - Math.hypot(gate.x, gate.z) - 100) < 1.5, '50 two-unit blocks farther from the Hearth');
    assert.equal(next.group.visible, false);
    assert.equal(M.world.blockInfoAt(next.blocks[0].bx, next.blocks[0].by, next.blocks[0].bz), null, 'dormant frame has no collision');
  }
  load('js/coin-model.js'); load('js/items.js'); M.items.init(scene); load('js/upgrades.js'); load('js/towers.js'); M.towers.init(scene);
  M.enemies.addCoins(10000);
  for (const kind of ['log', 'stone', 'dirt', 'coal', 'iron', 'copper']) M.items.addItem(kind, 1000);
  const road = gates.roads.find(r => r.gateId === first.id);
  for (const c of road.path) if (Math.hypot(c.bx * 2 + 1 - first.x, c.bz * 2 + 1 - first.z) < 20)
    M.world.update(new THREE.Vector3(c.bx * 2 + 1, c.top * 2, c.bz * 2 + 1), 0, 0);
  const advance = seconds => { for (let i = 0; i < seconds * 60; i++) M.towers.update(1 / 60); };
  let site;
  for (const def of M.towers.definitions) {
    site = road.path.find(c => {
      const distance = Math.hypot(c.bx * 2 + 1 - first.x, c.bz * 2 + 1 - first.z);
      return distance > 9 && distance < 14 && M.towers.site(def.id, c.bx, c.top, c.bz).valid;
    });
    assert.ok(site, def.id + ' can deploy a forward siege tower');
    const tower = M.towers.place(def.id, site.bx, site.top, site.bz); assert.ok(tower);
    const before = first.hp;
    M.towers.update(.25);
    assert.equal(first.hp, before, def.id + ' launch does not damage the gate');
    advance(3);
    assert.ok(first.hp < before, def.id + ' projectile hits the gate');
    assert.ok(first.flash > 0, def.id + ' triggers portal and stone hit feedback');
    M.towers.dismantle(tower); advance(5);
  }
  // An actual bolt, rather than a test-only damage call, earns the first kill.
  const tower = M.towers.place('ballista', site.bx, site.top, site.bz); assert.ok(tower);
  first.hp = 1; advance(3);
  assert.equal(first.active, false); assert.equal(first.hp, 0); assert.equal(gates.destroyed, 1);
  assert.equal(gates.gates.length, 4); assert.ok(gates.gates.includes(first.successor));
  assert.equal(first.successor.active, true); assert.equal(first.successor.hp, bossHp * 200);
  for (const c of first.blocks) assert.equal(M.world.blockInfoAt(c.bx, c.by, c.bz), null, 'shattered frame loses collision');
  for (const c of first.successor.blocks) assert.equal(M.world.blockInfoAt(c.bx, c.by, c.bz)?.unbreakable, true);
  assert.equal(gates.damage(first, 1000000), false, 'stale projectiles cannot create a third gate');
  M.enemies.update(.05);
  const next = first.successor;
  assert.ok(Number.isFinite(M.enemies.navigation.nodeAt(next.x, next.y, next.z)?.distance), 'replacement has a live route');
  assert.ok(!M.enemies.getState().spawnLanes.some(lane => lane.x === first.x && lane.z === first.z), 'queued lanes abandon the dead gate');
  gates.update(3); assert.equal(first.group.visible, false, 'collapse animation finishes');
  M.towers.dismantle(tower);
  const nextRoad = gates.roads.find(r => r.gateId === next.id);
  for (const c of nextRoad.path) if (Math.hypot(c.bx * 2 + 1 - next.x, c.bz * 2 + 1 - next.z) < 20)
    M.world.update(new THREE.Vector3(c.bx * 2 + 1, c.top * 2, c.bz * 2 + 1), 0, 0);
  const forward = nextRoad.path.find(c => Math.hypot(c.bx * 2 + 1 - next.x, c.bz * 2 + 1 - next.z) > 9 &&
    Math.hypot(c.bx * 2 + 1 - next.x, c.bz * 2 + 1 - next.z) < 14 && M.towers.site('ballista', c.bx, c.top, c.bz).valid);
  assert.ok(forward, 'the expanded build area reaches the final gate');
  const siege = M.towers.place('ballista', forward.bx, forward.top, forward.bz); assert.ok(siege);
  const nextHp = next.hp; advance(3); assert.ok(next.hp < nextHp, 'replacement gates take real projectile damage');
  M.towers.dismantle(siege);
  M.enemies.startWave(4);
  assert.ok(M.enemies.spawnAt({ x: 17, y: 14, z: 17 }));
  for (const gate of initial.slice(1)) gates.damage(gate, gate.hp);
  for (const gate of gates.gates.slice(0, 3)) gates.damage(gate, gate.hp);
  assert.equal(gates.destroyed, 7); assert.equal(gates.won, false);
  const last = gates.gates[0]; gates.damage(last, last.hp);
  assert.equal(gates.destroyed, 8); assert.equal(gates.won, true); assert.equal(gates.gates.length, 0);

  const elements = new Map(), listeners = {}, classes = new Set(); let reloads = 0;
  for (const id of ['victory', 'victory-replay']) elements.set(id, { hidden: true, style: { setProperty() {} }, focus() { this.focused = true; },
    addEventListener(type, fn) { this[type] = fn; } });
  context.document.getElementById = id => elements.get(id);
  context.document.body = { classList: { add: value => classes.add(value) } };
  context.window.addEventListener = (type, fn) => { listeners[type] = fn; };
  context.window.location = { reload: () => reloads++ };
  M.controls = { stopSteering() {}, suspendLook() {} };
  load('js/victory.js');
  const camera = new THREE.PerspectiveCamera(42, .46, .1, 400); camera.position.set(last.x, last.y + 5, last.z);
  M.victory.init({ scene, camera, tree: M.hearthTree });
  assert.equal(M.victory.check(), true); assert.equal(M.victory.check(), false);
  assert.equal(M.enemies.getState().victorious, true); assert.equal(M.enemies.getState().pending, 0);
  assert.equal(M.enemies.zombies.length, 0); assert.equal(M.enemies.startNextWave(), false);
  assert.equal(M.enemies.spawnAt({ x: 17, y: 14, z: 17 }), null);
  const health = M.hearthTree.health; M.enemies.update(100); assert.equal(M.hearthTree.health, health);
  let blocked = 0;
  listeners.keydown({ key: 'q', target: { id: 'victory-replay' }, preventDefault() { blocked++; }, stopImmediatePropagation() { blocked++; } });
  assert.equal(blocked, 2);
  M.victory.update(3); assert.equal(elements.get('victory-replay').hidden, true);
  M.victory.update(3); assert.equal(elements.get('victory-replay').hidden, false);
  assert.equal(elements.get('victory-replay').focused, true);
  assert.ok(classes.has('victorious')); assert.equal(elements.get('victory').hidden, false);
  assert.ok(camera.position.toArray().every(Number.isFinite));
  assert.ok(scene.getObjectByName('Hearth victory celebration'));
  M.config.reducedMotion = true; M.victory.update(.1);
  assert.ok(camera.position.toArray().every(Number.isFinite));
  elements.get('victory-replay').click(); assert.equal(reloads, 1);
});
