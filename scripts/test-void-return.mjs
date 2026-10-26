import assert from 'node:assert/strict';
import test from 'node:test';
import { game } from './helpers/animal-game.mjs';

function fixture() {
  const h = game({seed:19}), { M, controls } = h;
  M.goat.group.position.set(15,14,15);
  M.goat.state.headbuttCooldown = M.goat.state.stompCooldown = 100;
  const cameraSnaps = [];
  controls.snapTo = point => cameraSnaps.push(point.clone());
  // A complete, one-voxel-wide mining shaft through the last terrain block.
  for (let by=6; by>=0; by--) assert.ok(M.world.breakBlockAt(7,by,7,{drop:false}));
  return {...h,cameraSnaps};
}

test('the mined world bottom has no invisible collision or support plane', () => {
  const { M } = fixture(), w = M.world, physics = M.actorPhysics;
  assert.equal(w.landingHeight(15,15,14),-Infinity);
  assert.equal(w.bodySupportHeight(15,15,14,M.goat.body.radius),-Infinity);
  assert.equal(w.supportHeight(15,15,-1),-Infinity);
  for (const feet of [0,-.1,-2,-5.9]) {
    assert.equal(w.blockedAt(15,15,feet+.002,feet+1.9),false);
    assert.ok(physics.clear(w,15,feet,15,M.goat.body), 'the entire body can pass through the bottom');
  }
  assert.ok(w.blockInfoAt(8,0,7), 'the adjacent last-layer block remains solid');
  assert.equal(w.blockedAt(17,15,.01,1.99),true);
});

test('three-block void fall returns above the Hearth, preserves progress, and free-falls onto its crown', () => {
  const { M, load, scene, cameraSnaps } = fixture(), goat = M.goat, p = goat.group.position;
  load('js/coin-model.js'); load('js/items.js'); M.items.init(scene); load('js/upgrades.js');
  M.enemies.addCoins(42); M.items.addItem('stone',5);
  assert.ok(M.upgrades.buy(M.upgrades.player,'power'));
  const slot = M.items.addItem('log',2); M.items.selectSlot(slot);
  const coins = M.enemies.getState().coins;
  let lowest = Infinity, returned = false;
  for (let frame=0; frame<240; frame++) {
    const previousY = p.y;
    goat.update(1/60,frame/60);
    if (cameraSnaps.length) {
      assert.ok(previousY>-6 && previousY< -6+38/60, 'returns only when crossing three voxel blocks below y=0');
      returned = true; break;
    }
    lowest = Math.min(lowest,p.y);
    assert.equal(goat.state.grounded,false, 'falling through the shaft never lands on the void');
  }
  assert.ok(returned);
  assert.ok(lowest< -4, 'the goat visibly falls below the world before returning');
  const home = M.config.startingArea;
  const crown = M.hearthTree.boxSupportHeight(home.x,home.z,goat.body.radius,Infinity);
  assert.deepEqual(Array.from(p.toArray()),[home.x,crown+12,home.z]);
  assert.equal(goat.state.vy,0, 'void-fall velocity is cleared before the new free fall');
  assert.equal(goat.state.grounded,false);
  assert.equal(cameraSnaps.length,1);
  assert.ok(cameraSnaps[0].equals(p), 'camera moves with the respawn');
  assert.equal(M.enemies.getState().coins,coins);
  assert.equal(M.items.count('log'),2); assert.equal(M.items.selectedSlot,slot);
  assert.equal(M.upgrades.level(M.upgrades.player,'power'),1);
  const spawnY = p.y;
  goat.update(1/60,0);
  assert.ok(p.y<spawnY && p.y>crown && goat.state.vy<0, 'gravity starts a real fall above the crown');
  for (let frame=0; frame<180 && !goat.state.grounded; frame++) goat.update(1/60,frame/60);
  assert.equal(goat.state.grounded,true);
  assert.equal(p.y,crown);
  assert.ok(crown>M.hearthTree.group.position.y+10, 'lands on the canopy rather than the ground or trunk');
  assert.ok(M.actorPhysics.clear(M.world,p.x,p.y,p.z,goat.body), 'the landing does not penetrate the tree');
  assert.equal(cameraSnaps.length,1, 'the canopy landing cannot retrigger a return');
});

test('void return cancels a pending aerial stomp and works at 20, 60 and 144 Hz', () => {
  const { M, scene, cameraSnaps } = fixture(), goat = M.goat, p = goat.group.position;
  for (const hz of [20,60,144]) {
    p.set(15,.2,15);
    Object.assign(goat.state,{grounded:false,vy:-10,manualHold:1000});
    goat.kick(); assert.equal(goat.state.aerialStomp,true);
    const before = cameraSnaps.length;
    for (let frame=0; frame<hz*2 && cameraSnaps.length===before; frame++) goat.update(1/hz,frame/hz);
    assert.equal(cameraSnaps.length,before+1);
    assert.equal(goat.state.aerialStomp,false);
    assert.equal(goat.state.vy,0);
    assert.equal(goat.state.grounded,false);
    for (let frame=0; frame<hz*2 && !goat.state.grounded; frame++) goat.update(1/hz,frame/hz);
    assert.equal(goat.state.grounded,true);
    assert.equal(scene.getObjectByName('aerial-stomp-shockwave'),undefined, 'return is an ordinary free fall with no stale attack');
  }
});
