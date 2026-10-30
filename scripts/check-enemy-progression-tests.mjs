import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './helpers/enemy-game.mjs';

// Complete multi-wave delivery runs are separate from the fast default suite.
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
