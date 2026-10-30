import assert from 'node:assert/strict';
import test from 'node:test';
import { defense, step, fireOnce, flights } from './helpers/tower-game.mjs';

// Extended particle lifetime and lighting checks remain part of CI.
test('sustained rapid combat keeps particles bounded, reuses buffers and drains every effect after packing', () => {
  const { M, THREE, scene } = defense();
  const tower = M.towers.place('ember', 8, 7, 8);
  tower.def.interval = 1 / 60;
  const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute'); enemy.hp = 10000;
  const pools = scene.children.filter(o => o.isPoints && o.name.startsWith('Tower '));
  assert.equal(pools.length, 2, 'only two particle draw calls');
  const buffers = pools.map(o => o.geometry.attributes.position.array);
  step(M, 4);
  assert.ok(tower.shots > 150);
  assert.ok(pools.some(o => o.geometry.attributes.alpha.array.some(v => v > 0)), 'combat emits visible particles');
  assert.ok(scene.children.filter(o => / (muzzle|impact)$/.test(o.name)).length <= 80, 'mesh effects are bounded');
  for (const pool of pools) for (const attr of Object.values(pool.geometry.attributes))
    assert.ok(attr.array.every(Number.isFinite), 'particle simulation remains finite');
  M.towers.dismantle(tower); step(M, 7);
  pools.forEach((pool, i) => {
    assert.equal(pool.geometry.attributes.position.array, buffers[i], 'no buffer growth or replacement');
    assert.ok(pool.geometry.attributes.alpha.array.every(v => v === 0), 'trails, smoke and status particles drain');
  });
  assert.equal(flights(scene).length, 0);
  assert.equal(scene.children.filter(o => / (muzzle|impact)$/.test(o.name)).length, 0);
});

test('lightning afterimages release their unique GPU geometry', () => {
  const { M, THREE, scene } = defense();
  const tower = M.towers.place('storm', 8, 7, 8);
  M.enemies.spawnAt(new THREE.Vector3(17, 14, 29), 'brute');
  fireOnce(M, tower); step(M, .06);
  const arc = scene.children.find(o => o.name === 'Storm afterimage'); assert.ok(arc);
  let disposed = false;
  arc.children[0].geometry.addEventListener('dispose', () => { disposed = true; });
  step(M, .2);
  assert.equal(scene.children.includes(arc), false); assert.equal(disposed, true);
});

test('tower night lights follow their emitters, fade by day and disappear when packed', () => {
  const { M, THREE, scene } = defense();
  let night = 1;
  M.environment = { getState: () => ({ night }) };
  const camera = new THREE.PerspectiveCamera(60, 1.4, .1, 200);
  camera.position.set(21, 32, 38); camera.lookAt(21, 14, 19);
  const lamps = scene.children.filter(node => node.name === 'Tower light');
  assert.equal(lamps.length, 8, 'the light budget is fixed before construction');
  assert.ok(lamps.every(l => l.isPointLight && !l.castShadow && l.intensity === 0));
  const towers = M.towers.definitions.map((def, i) => M.towers.place(def.id, 6 + i % 5 * 2, 7, 7 + Math.floor(i / 5) * 3));
  assert.ok(towers.every(Boolean));
  const settle = () => { for (let i = 0; i < 120; i++) M.towers.updateLighting(camera, 1 / 60); };
  M.towers.update(.05); settle();
  assert.equal(lamps.filter(l => l.intensity > .1).length, 8, 'a dense defense stays within the budget');
  for (const lamp of lamps) {
    assert.ok(towers.some(tower => tower.glowAnchor.getWorldPosition(new THREE.Vector3()).distanceTo(lamp.position) < 1e-8), 'light sits at a real flame or glowing weapon');
    assert.ok(lamp.distance <= 11 && lamp.intensity < 1.6, 'light stays local and restrained');
  }
  assert.ok(new Set(lamps.map(l => l.color.getHex())).size >= 5, 'elemental lights retain distinct colors');
  const lit = towers.find(t => lamps.some(l => l.position.distanceTo(t.glowAnchor.getWorldPosition(new THREE.Vector3())) < 1e-8));
  const lamp = lamps.find(l => l.position.distanceTo(lit.glowAnchor.getWorldPosition(new THREE.Vector3())) < 1e-8);
  M.towers.dismantle(lit);
  assert.equal(lamp.intensity, 0, 'packing immediately clears its illumination');
  settle();
  assert.equal(lamps.filter(l => l.intensity > .1).length, 8, 'a waiting tower takes the vacant slot');
  night = 0; settle();
  assert.ok(lamps.every(l => l.intensity < .001), 'daylight fades the local lights out');
  night = 1; settle();
  assert.ok(lamps.some(l => l.intensity > .1), 'the next night lights them again');
  camera.position.set(1000, 30, 1000); camera.lookAt(1000, 14, 990); settle();
  assert.ok(lamps.every(l => l.intensity === 0), 'offscreen towers release their lights');
  for (const tower of M.towers.list.slice()) M.towers.dismantle(tower);
  assert.equal(scene.children.filter(n => n.name === 'Tower light').length, 8, 'construction and packing reuse the pool');
  assert.ok(lamps.every(l => l.intensity === 0));
});

test('torch flames render through shared batches, stay independent and respect reduced motion', () => {
  const { M, scene } = defense();
  const first = M.towers.place('ballista', 8, 7, 8);
  const second = M.towers.place('ballista', 10, 7, 8);
  const ember = M.towers.place('ember', 12, 7, 8);
  const preview = M.towers.model('ballista');
  assert.equal(first.flames.length, 1); assert.equal(ember.flames.length, 2);
  assert.notEqual(first.flames[0], second.flames[0]);
  let previewLights = 0; preview.traverse(n => { if (n.isLight) previewLights++; });
  assert.equal(previewLights, 0, 'preview and pickup models never carry live lights');
  M.towers.update(.1);
  assert.notEqual(first.flames[0].scale.y, 1, 'deployed flames gently flicker');
  assert.equal(preview.getObjectByName('Torch flame').scale.y, 1, 'previews retain an independent pose');
  const batches = scene.children.filter(n => n.name === 'Tower batch' && n.material.isMeshBasicMaterial);
  assert.ok(batches.some(b => b.count >= 4), 'flames share geometry and materials across towers');
  assert.ok(batches.every(b => !b.castShadow && !b.receiveShadow), 'flames never cast opaque voxel shadows');
  M.config.reducedMotion = true; M.towers.update(.1);
  for (const tower of [first, second, ember]) for (const f of tower.flames) {
    assert.equal(f.scale.y, 1); assert.equal(f.rotation.z, 0);
  }
});

test('projectile lighting stays bounded, survives packing, and supports daylight and reduced motion', () => {
  const { M, THREE, scene } = defense();
  let night = 1;
  M.environment = { getState: () => ({ night }) };
  M.config.reducedMotion = true;
  const camera = new THREE.PerspectiveCamera(75, 1.4, .1, 200);
  camera.position.set(17, 23, 34); camera.lookAt(17, 16, 23);
  const lamps = scene.children.filter(n => n.name === 'Tower projectile light');
  const tower = M.towers.place('frost', 8, 7, 8);
  const enemy = M.enemies.spawnAt(new THREE.Vector3(17, 14, 30), 'brute'); enemy.hp = 10000;
  // Accumulate more simultaneous shots than the light budget permits.
  for (let i = 0; i < 7; i++) { tower.cooldown = 0; M.towers.update(.04); }
  tower.cooldown = 1000;
  assert.equal(flights(scene).length, 7);
  M.towers.updateLighting(camera, 1);
  assert.equal(lamps.filter(l => l.intensity > .1).length, 4);
  const nightStrength = lamps.map(l => l.intensity);
  M.towers.dismantle(tower);
  assert.ok(lamps.every(l => l.intensity > .1), 'packing does not extinguish existing flights');
  night = 0; M.towers.updateLighting(camera, 1);
  lamps.forEach((l, i) => assert.ok(l.intensity > 0 && l.intensity < nightStrength[i] * .3, 'daylight softens rather than removes the glow'));
  const daylightStrength = lamps.map(l => l.intensity);
  M.towers.updateLighting(camera, 1);
  lamps.forEach((l, i) => assert.ok(Math.abs(l.intensity - daylightStrength[i]) < 1e-7, 'reduced motion has no pulsing lights'));
  camera.position.set(1000, 30, 1000); camera.lookAt(1000, 14, 990);
  M.towers.updateLighting(camera, 1);
  assert.ok(lamps.every(l => l.intensity === 0), 'offscreen flights release lights');
  camera.position.set(17, 23, 34); camera.lookAt(17, 16, 23);
  M.towers.updateLighting(camera, 1);
  assert.equal(lamps.filter(l => l.intensity > .1).length, 4, 'the same pool can be reassigned');
  step(M, 6);
  assert.equal(flights(scene).length, 0);
  assert.ok(lamps.every(l => l.intensity === 0), 'collision and expiry clear every assigned light');
  assert.equal(scene.children.filter(n => n.name === 'Tower projectile light').length, 4);
});
