import assert from 'node:assert/strict';
import test from 'node:test';
import { game } from './helpers/animal-game.mjs';

test('stone is guaranteed beneath two soil layers, and mining returns the actual rock', () => {
  const { M } = game(), w = M.world;
  // Quarry ordinary meadow soil beside the permanent eastern road.
  assert.equal(w.breakBlockAt(8, 6, 6, { drop: false }), 'grass');
  assert.equal(w.breakBlockAt(8, 5, 6, { drop: false }), 'dirt');
  assert.equal(w.blockInfoAt(8, 4, 6).kind, 'stone');
  assert.equal(w.breakBlockAt(8, 4, 6, { drop: false }), 'stone');
  assert.equal(w.blockInfoAt(8, 4, 6), null);
});

test('starter entrance has descending walkable floors and connects to a roofed mineral chamber', () => {
  const { M } = game(), w = M.world;
  const floors = [];
  for (let z = 16; z <= 20; z++) {
    const floor = w.landingHeight(21, z * 2 + 1, z === 16 ? 14 : floors.at(-1) + .01); floors.push(floor);
    assert.equal(w.bodyBlockedAt(21, z * 2 + 1, floor + .01, floor + 1.9, .42), false);
    if (z > 16) assert.ok(floors[z - 17] - floor >= 0 && floors[z - 17] - floor <= 2, 'one-block stairs');
  }
  assert.equal(floors.at(-1), 4, 'stairs reach the chamber floor');
  assert.equal(w.surfaceHeight(21, 41), 14, 'covered section keeps its roof at the surface');
  assert.equal(w.bodyBlockedAt(21, 41, 4.01, 5.9, .42), false, 'underground chamber has headroom');
  assert.equal(w.landingHeight(21, 41, 4.1), 4, 'cave floor supports the player');
  assert.ok(w.blockInfoAt(10, 4, 20), 'ceiling is solid');
  assert.ok(w.navigationSurfaces(10, 20).includes(4));
});

test('coal, copper and iron occur in mineable starter veins with their own item art', () => {
  const { M } = game(), w = M.world;
  const found = new Map();
  for (let x = 6; x <= 15; x++) for (let z = 18; z <= 27; z++) {
    const block = w.blockInfoAt(x, 1, z);
    if (block && ['coal', 'copper', 'iron'].includes(block.kind) && !w.blockInfoAt(x, 2, z)) found.set(block.kind, block);
  }
  for (const kind of ['coal', 'copper', 'iron']) {
    const block = found.get(kind); assert.ok(block, kind + ' is exposed in the chamber floor');
    assert.equal(w.breakBlockAt(block.bx, block.by, block.bz, { drop: false }), kind);
    assert.ok(w.makeBlockMesh(kind).geometry.attributes.uv.count > 0);
  }
});

test('caves keep the foundation and dry meadow roof intact and remain deterministic across chunks', () => {
  const { M } = game(), w = M.world;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
    for (let y = 0; y < 7; y++) assert.ok(w.blockInfoAt(x, y, z), 'foundation remains solid');
  }
  for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) if (w.isStartingClearing(x, z)) assert.ok(w.blockInfoAt(x, 6, z));
  const snapshot = [];
  for (let x = 14; x <= 17; x++) for (let z = 17; z <= 23; z++) for (let y = 1; y <= 4; y++) snapshot.push([x,y,z,w.blockInfoAt(x,y,z)?.kind || null]);
  for (const [x,y,z,kind] of snapshot.reverse()) assert.equal(w.blockInfoAt(x,y,z)?.kind || null, kind);
});

test('the real player can descend the starter stairs, mine inside and jump back out', () => {
  const { M, input, controls } = game(), p=M.goat.group.position;
  controls.firstPerson=true; p.set(21,14,31); input.set(0,1);
  let t=0;
  for(let i=0;i<170;i++){M.goat.update(1/60,t+=1/60);}
  assert.ok(p.z>40&&p.y<7,'player enters below the roof');
  input.set(0,-1);
  let lastZ=p.z, stalled=0;
  for(let i=0;i<600&&p.z>31;i++){
    M.goat.update(1/60,t+=1/60);
    stalled=Math.abs(p.z-lastZ)<.002?stalled+1:0;lastZ=p.z;
    if(stalled>8&&M.goat.state.grounded){M.goat.jump();stalled=0;}
  }
  assert.ok(p.z<=32&&p.y>=13.9,'ordinary one-block jumps climb back to the meadow: '+JSON.stringify({p:p.toArray(),grounded:M.goat.state.grounded,vy:M.goat.state.vy,stalled}));
});
