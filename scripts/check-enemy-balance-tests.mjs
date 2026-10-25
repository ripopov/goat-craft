import assert from 'node:assert/strict';
import test from 'node:test';
import { runDefense } from './check-enemy-balance.mjs';

// Longer complete-defense simulations run separately from the default suite.
for (const wave of [12, 15]) test('a prepared mixed defense clears wave ' + wave + ' without underground stragglers', () => {
  const result = runDefense(wave, 42);
  assert.equal(result.cleared, true, JSON.stringify(result));
  assert.ok(result.health > 0, 'a plausible investment survives the encounter');
  assert.ok(result.seconds < 120, 'the wave ends without a long cleanup tail');
  assert.equal(result.watchdogDeaths, 0, 'successful defense does not rely on forced watchdog kills');
  assert.ok(result.worms > 0 && result.airdrops > 0, 'both new delivery threats participate');
  assert.equal(result.survivors.length, 0);
});
