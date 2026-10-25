import assert from 'node:assert/strict';
import { game } from './helpers/animal-game.mjs';

// Sustained full-cap combat, including real terrain collision, articulated
// enemies, projectiles and effects. Invulnerable combatants keep load constant.
// CPU timings exclude WebGL; render submissions count visible mesh batches.
export function stressBattle(frames = 360, loadout = 'mixed') {
  const { M, THREE, scene, load } = game({ seed: 42 });
  load('js/coin-model.js'); load('js/items.js'); M.items.init(scene);
  load('js/upgrades.js'); load('js/towers.js'); M.towers.init(scene);
  assert.ok(loadout === 'mixed' || M.towers.definitions.some(def => def.id === loadout), 'use mixed or a workshop blueprint ID');
  M.enemies.addCoins(100000);
  for (const kind of ['log', 'stone', 'dirt', 'coal', 'iron', 'copper']) M.items.addItem(kind, 10000);
  M.goat.group.position.set(-45, 14, -45);
  M.animals.list.forEach((a, i) => a.group.position.set(-45 + i * 3, 14, -40));
  for (let z = -12; z <= 12; z += 2) for (let x = -12; x <= 12; x += 2) {
    if (M.towers.list.length === M.towers.maxTowers) break;
    const radius = Math.hypot(x * 2 + 1, z * 2 + 1);
    if (radius < 8 || radius > 28) continue;
    const id = loadout === 'mixed' ? M.towers.definitions[M.towers.list.length % 10].id : loadout;
    M.towers.place(id, x, 7, z);
  }
  assert.equal(M.towers.list.length, M.towers.maxTowers);
  const protectedCells = new Set();
  for (const tower of M.towers.list) for (let y = tower.by - 1; y < tower.by + tower.def.height; y++)
    protectedCells.add([tower.bx, y, tower.bz].join(','));
  const breakBlock = M.world.breakBlockAt;
  M.world.breakBlockAt = function (x, y, z, options) {
    return protectedCells.has([x, y, z].join(',')) ? null : breakBlock(x, y, z, options);
  };
  const types = Object.keys(M.enemies.types);
  for (let i = 0; i < M.enemies.maxEnemies; i++) {
    const angle = i * 2.399963, radius = 22 + i % 8;
    const enemy = M.enemies.spawnAt(new THREE.Vector3(Math.cos(angle) * radius, 14, Math.sin(angle) * radius), types[i % types.length]);
    assert.ok(enemy); enemy.hp = enemy.maxHp = 100000;
  }
  M.hearthTree.damage = () => {};
  const timings = { enemies: [], towers: [], total: [] };
  for (let frame = 0; frame < frames + 120; frame++) {
    for (const e of M.enemies.zombies) e.progressAt = frame / 60;
    const start = performance.now();
    M.enemies.update(1 / 60);
    const mid = performance.now();
    M.towers.update(1 / 60);
    const end = performance.now();
    if (frame >= 120) {
      timings.enemies.push(mid - start); timings.towers.push(end - mid); timings.total.push(end - start);
    }
  }
  assert.equal(M.enemies.zombies.length, M.enemies.maxEnemies);
  assert.equal(M.towers.list.length, M.towers.maxTowers);
  let meshes = 0, shadowMeshes = 0;
  scene.traverseVisible(node => {
    if (!(node.isMesh || node.isPoints || node.isLine) || node.isInstancedMesh && !node.count) return;
    meshes++; if (node.castShadow) shadowMeshes++;
  });
  const result = { enemies: M.enemies.zombies.length, towers: M.towers.list.length, loadout, frames, visibleBatches: meshes, shadowBatches: shadowMeshes };
  for (const [name, samples] of Object.entries(timings)) {
    samples.sort((a, b) => a - b);
    result[name + 'MedianMs'] = +samples[Math.floor(samples.length * .5)].toFixed(2);
    result[name + 'P95Ms'] = +samples[Math.floor(samples.length * .95)].toFixed(2);
  }
  return result;
}
if (process.argv[1] === new URL(import.meta.url).pathname) console.log(JSON.stringify(stressBattle(Number(process.argv[2]) || 360, process.argv[3] || 'mixed'), null, 2));
