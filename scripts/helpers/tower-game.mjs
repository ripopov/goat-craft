import assert from 'node:assert/strict';
import { game } from './animal-game.mjs';

export function defense(rich = true, renderRadius = 0) {
  // Most tower checks stay in the initial chunk. Load neighboring chunks only
  // for the negative-coordinate case; avoid rendering irrelevant forest.
  const fixture = game({ renderRadius }), { M, load, scene } = fixture;
  load('js/coin-model.js'); load('js/inventory.js'); load('js/items.js'); M.items.init(scene); load('js/upgrades.js'); load('js/towers.js'); M.towers.init(scene);
  M.goat.group.position.set(-25, 14, -25);
  M.animals.list.forEach((animal, i) => animal.group.position.set(-25 + i * 3, 14, -20));
  if (rich) {
    M.enemies.addCoins(1000);
    for (const kind of ['log', 'stone', 'dirt', 'coal', 'iron', 'copper']) M.items.addItem(kind, 100);
  }
  return fixture;
}
export function step(M, duration) { for (let i = 0; i < duration * 60; i++) M.towers.update(1 / 60); }

export function fireOnce(M, tower) {
  step(M, .27); assert.equal(tower.shots, 1); tower.cooldown = 1000;
}
export function until(M, condition, seconds = 3) {
  for (let i = 0; i < seconds * 60 && !condition(); i++) M.towers.update(1 / 60);
  assert.ok(condition(), 'expected an impact before timeout');
}
export function flights(scene) { return scene.children.filter(o => o.name.endsWith(' projectile')); }
