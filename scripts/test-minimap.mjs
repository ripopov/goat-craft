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

test('strategic view can hide the minimap and restore it without invalid canvas arcs', () => {
  let arcs = 0;
  const drawing = new Proxy({}, { get: (_, key) => key === 'arc' ? (x, y, radius) => {
    assert.ok(radius >= 0); arcs++;
  } : () => {} });
  const canvas = { clientWidth: 0, width: 0, height: 0, getContext: () => drawing, setAttribute() {} };
  const position = { x: 0, z: 0 };
  const context = vm.createContext({ window: { devicePixelRatio: 2, Meadow: {
    goat: { group: { position }, state: { yaw: 0 } }, enemies: { zombies: [] },
    animals: { list: [] }, hearthTree: { position }
  } }, document: { getElementById: () => canvas } });
  vm.runInContext(readFileSync(new URL('../js/minimap.js', import.meta.url), 'utf8'), context);
  const map = context.window.Meadow.minimap;
  map.init(); assert.equal(arcs, 0);
  canvas.clientWidth = 132; map.update(.2);
  assert.ok(arcs > 0); assert.equal(canvas.width, 264);
  const before = arcs;
  canvas.clientWidth = 0; map.update(.2); assert.equal(arcs, before);
  canvas.clientWidth = 180; map.update(.2);
  assert.ok(arcs > before); assert.equal(canvas.width, 360);
});
