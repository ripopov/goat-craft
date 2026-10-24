import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function fixture({ floor = 0 } = {}) {
  const context = vm.createContext({ window: { Meadow: {} } });
  vm.runInContext(readFileSync(new URL('../js/voxel-water.js', import.meta.url), 'utf8'), context);
  const blocks = new Set(), sources = new Map(), changes = [];
  const id = (x, y, z) => [x, y, z].join(',');
  const fluid = context.window.Meadow.voxelWater.create({
    blocked: (x, y, z) => y < floor || blocks.has(id(x, y, z)),
    source: (x, y, z) => sources.get(id(x, y, z)),
    active: (x, z) => Math.abs(x) <= 20 && Math.abs(z) <= 20,
    changed: (...cell) => changes.push(cell)
  });
  function source(x, y, z) { sources.set(id(x, y, z), { fill: 1, source: true }); fluid.wake(x, y, z); }
  function wall(x, y, z, present = true) {
    if (present) blocks.add(id(x, y, z)); else blocks.delete(id(x, y, z));
    fluid.wake(x, y, z);
  }
  function settle(limit = 1000) {
    let ticks = 0;
    while (fluid.pending && ticks++ < limit) assert.ok(fluid.tick(256) <= 256);
    assert.equal(fluid.pending, 0, 'local fluid work must converge and become idle');
  }
  return { fluid, blocks, sources, changes, id, source, wall, settle };
}

test('water spreads seven cells over a floor, with diminishing depth and no uphill flow', () => {
  const f = fixture(); f.source(0, 0, 0); f.settle();
  for (let x = 0; x <= 7; x++) assert.equal(f.fluid.get(x, 0, 0).fill, 1 - x / 8);
  assert.equal(f.fluid.get(8, 0, 0), null);
  assert.equal(f.fluid.get(0, 1, 0), null);
  assert.equal(f.fluid.tick(), 0, 'settled water has no periodic scan');
});

test('walls contain water; removing a wall leaks and replacing it drains the disconnected flow', () => {
  const f = fixture();
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) f.wall(x, 0, z);
  f.source(0, 0, 0); f.settle();
  assert.equal(f.fluid.size, 0);
  f.wall(1, 0, 0, false); f.settle();
  assert.ok(f.fluid.get(4, 0, 0));
  f.wall(1, 0, 0); f.settle();
  assert.equal(f.fluid.get(1, 0, 0), null);
  assert.equal(f.fluid.size, 0);
});

test('waterfalls descend before spreading, refill their reach on the floor, and retract without a source', () => {
  const f = fixture(); f.source(0, 5, 0); f.settle();
  for (let y = 0; y < 5; y++) assert.equal(f.fluid.get(0, y, 0).fill, 1);
  assert.equal(f.fluid.get(1, 4, 0), null, 'a falling column does not float sideways');
  assert.equal(f.fluid.get(7, 0, 0).fill, 0.125);
  f.sources.clear(); f.fluid.wake(0, 5, 0); f.settle();
  assert.equal(f.fluid.size, 0, 'neighbouring streams must not sustain one another forever');
});

test('water fills a tunnel under a solid roof and a plug immediately displaces water', () => {
  const f = fixture();
  for (let x = 0; x < 10; x++) {
    f.wall(x, 1, 0); f.wall(x, 0, -1); f.wall(x, 0, 1);
  }
  f.wall(-1, 0, 0); f.source(0, 0, 0); f.settle();
  assert.ok(f.fluid.get(5, 0, 0));
  assert.equal(f.fluid.get(5, 1, 0), null);
  f.wall(3, 0, 0);
  assert.equal(f.fluid.get(3, 0, 0), null, 'collision edits immediately displace fluid');
  f.settle(); assert.equal(f.fluid.get(5, 0, 0), null);
});

test('large fluid updates respect the work budget and are independent of render frequency', () => {
  const snapshots = [20, 60, 144].map(hz => {
    const f = fixture(); f.source(0, 4, 0);
    for (let i = 0; i < hz * 12; i++) f.fluid.update(1 / hz);
    f.settle();
    return [f.fluid.size, f.fluid.get(7, 0, 0).fill];
  });
  assert.deepEqual(snapshots[0], snapshots[1]); assert.deepEqual(snapshots[1], snapshots[2]);
});

test('streamed-out flow releases its cells and reconstructs from the source on return', () => {
  const f = fixture(); f.source(0, 4, 0); f.settle();
  const before = f.fluid.size;
  f.fluid.forgetColumn(0, 0);
  assert.equal(f.fluid.size, before - 4);
  assert.equal(f.fluid.heights(0, 0), undefined);
  f.fluid.wake(0, 4, 0); f.settle();
  assert.equal(f.fluid.size, before);
  assert.equal(f.fluid.get(0, 0, 0).fill, 1);
});
