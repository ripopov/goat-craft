import assert from 'node:assert/strict';
import test from 'node:test';
import { game } from './helpers/animal-game.mjs';

test('four permanent forest gates have dry ground routes, collision and protected openings', () => {
  const { M, THREE, scene } = game({ renderRadius: 3 });
  const { gates, cells } = M.hellGates, world = M.world, nav = M.enemies.navigation;
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
  for (const cell of cells) {
    assert.equal(world.blockInfoAt(cell.bx, cell.by, cell.bz).unbreakable, true);
    assert.equal(world.breakBlockAt(cell.bx, cell.by, cell.bz, { towerInternal: true, drop: false }), null);
    assert.equal(world.canPlaceBlock(cell.bx, cell.by, cell.bz), false);
    assert.equal(world.navigationBlockedAt(cell.bx * 2 + 1, cell.bz * 2 + 1, cell.by * 2 + .01, cell.by * 2 + 1.99), true);
  }
  // Terrain must never draw a face already owned by an overlapping plinth.
  const gateFaces = new Set();
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const cell of cells) for (const n of directions) gateFaces.add(
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
  world.update(new THREE.Vector3(600, 14, 600), .05, 1);
  for (const gate of gates) assert.equal(world.blockInfoAt(gate.bx, gate.by - 1, gate.bz).unbreakable, true);
  assert.equal(scene.getObjectByName('Living hell gate portals').count, 4);
});

test('every surface species arrives inside a gate; parachutes and Worms keep separate delivery', () => {
  const { M } = game({ seed: 17 }), enemies = M.enemies;
  M.hearthTree.damage = () => {};
  const seen = new Set(), species = new Set(), usedGates = new Set();
  let air = false, worm = false;
  for (const wave of [1, 2, 3, 5, 8, 10, 12, 15]) {
    enemies.startWave(wave);
    for (let tick = 0; tick < 2000 && enemies.getState().pending; tick++) {
      enemies.update(.05);
      for (const enemy of enemies.zombies.slice()) {
        if (!seen.has(enemy.id)) {
          seen.add(enemy.id);
          if (enemy.airborne) {
            air = true; assert.equal(enemy.gateId, undefined);
            assert.ok(Math.hypot(enemy.position.x, enemy.position.z) >= 18);
            assert.ok(Math.hypot(enemy.position.x, enemy.position.z) <= 26);
          } else if (enemy.type === 'worm') {
            worm = true; assert.equal(enemy.gateId, undefined); assert.equal(enemy.burrowed, true);
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
  assert.equal(species.size, Object.keys(enemies.types).length - 1);
  assert.ok(usedGates.size === 4); assert.ok(air); assert.ok(worm);
});
