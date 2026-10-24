import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const context = vm.createContext({ window: {}, document: { getElementById: () => null } });
vm.runInContext(readFileSync(new URL('../js/minimap.js', import.meta.url), 'utf8'), context);
const map = context.window.Meadow.minimap;

test('minimap stays centered on the player and uses its full advertised range before edge markers', () => {
  const player = { x: 20, z: 40 };
  assert.equal(map.project(player, player).x, 0); assert.equal(map.project(player, player).y, 0);
  assert.equal(map.project({ x: player.x + 79, z: player.z }, player).outside, false);
  assert.equal(map.project({ x: player.x, z: player.z - 80 }, player).outside, false);
  const edge = map.project({ x: player.x, z: player.z - 81 }, player);
  assert.equal(edge.outside, true); assert.ok(edge.y < 0, 'north stays up');
  assert.ok(Math.abs(edge.y) < 1, 'off-map glyphs fit within the circle');
  const translated = map.project({ x: 120, z: 240 }, { x: 120, z: 240 });
  assert.equal(translated.x, 0); assert.equal(translated.y, 0);
});
