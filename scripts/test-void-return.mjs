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
  load('js/coin-model.js'); load('js/inventory.js'); load('js/items.js'); M.items.init(scene); load('js/upgrades.js');
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

function enemyFixture() {
  const h = fixture(), { M } = h;
  M.goat.group.position.set(-24,14,-24);
  M.animals.list.forEach((a,i) => a.group.position.set(-24+i*3,14,-20));
  const coins = [], sounds = [];
  M.items = { dropCoins: (...args) => coins.push(args), dropBlock() {} };
  M.audio = { enemy: (...args) => sounds.push(args) };
  return {...h,coins,sounds};
}

test('an enemy falling through a mined shaft returns by parachute far enough from the Hearth to defend', () => {
  const { M,scene,coins,sounds } = enemyFixture(), e = M.enemies;
  const enemy = e.spawnAt({x:15,y:14,z:15},'zombie');
  enemy.hp -= 1;
  const hp = enemy.hp, id = enemy.id, maxHp = enemy.maxHp;
  const wave = e.getState().wave, balance = e.getState().coins;
  // Keep horizontal steering from walking out of this deliberately narrow shaft.
  const speed = enemy.speedScale; enemy.speedScale = 0;
  let lowest = Infinity, returned = false;
  for (let frame=0; frame<240; frame++) {
    const previousY = enemy.position.y;
    e.update(1/60);
    if (enemy.airborne) {
      assert.ok(previousY>-6 && previousY< -6+38/60, 'returns at the same three-block void threshold as the goat');
      returned = true; break;
    }
    lowest = Math.min(lowest,enemy.position.y);
  }
  assert.ok(returned); assert.ok(lowest< -4, 'falls through the last block before returning');
  const tree = M.hearthTree.position, p = enemy.position;
  const distance = Math.hypot(p.x-tree.x,p.z-tree.z);
  assert.ok(distance>=24 && distance<=32, `landing distance ${distance}`);
  assert.equal(p.y,enemy.landingY+16); assert.equal(enemy.grounded,false);
  assert.equal(enemy.mode,'air'); assert.equal(enemy.vy,0);
  assert.equal(enemy.hp,hp); assert.equal(enemy.maxHp,maxHp); assert.equal(enemy.id,id);
  assert.equal(e.zombies.length,1); assert.equal(e.getState().wave,wave); assert.equal(e.getState().coins,balance);
  assert.equal(coins.length,0, 'returning grants no kill loot');
  assert.equal(sounds.filter(s=>s[0]==='parachute' && s[1]==='open').length,1);
  assert.equal(scene.children.filter(n=>n.name==='Enemy air signal').length,1);
  const mesh=scene.getObjectByName('Enemy horde'), airborneCount=mesh.count;
  const spawnY=p.y, treeHealth=M.hearthTree.health;
  e.update(.1);
  assert.ok(Math.abs((spawnY-p.y)-.38)<1e-8, 'parachute descent is slow and controlled');
  assert.equal(M.hearthTree.health,treeHealth, 'cannot attack the Hearth while descending');
  assert.equal(e.damageEnemy(enemy,.5),false); assert.equal(enemy.hp,hp-.5, 'defenses can damage the returning enemy');
  for (let i=0;i<300 && enemy.airborne;i++) e.update(1/60);
  assert.equal(enemy.airborne,false); assert.equal(enemy.grounded,true); assert.equal(enemy.mode,'recover');
  assert.ok(M.actorPhysics.clear(M.world,p.x,p.y,p.z,enemy.body), 'lands on real support without clipping');
  assert.ok(mesh.count<airborneCount, 'the batched parachute disappears after landing');
  assert.equal(coins.length,0);
  enemy.speedScale=speed;
  const landed=p.clone();
  for (let i=0;i<180 && p.distanceTo(landed)<.1;i++) e.update(1/60);
  assert.ok(p.distanceTo(landed)>.1, 'resumes its approach after landing recovery');
});

test('all enemy species return without restoring health or carrying old transport, routes and casts', () => {
  const { M,scene,coins } = enemyFixture(), e=M.enemies;
  const actors=Object.keys(e.types).map(type=>e.spawnAt({x:15,y:14,z:15},type,{surface:true}));
  const owner=actors.find(a=>a.type==='binder');
  const tower={snareOwner:owner,snareTime:3}; M.towers={list:[tower]};
  for (let i=0;i<actors.length;i++) {
    const enemy=actors[i]; enemy.position.y=-6.1; enemy.hp-=.5;
    Object.assign(enemy,{path:[{}],target:{},jump:{},swimming:true,shoreJump:2,
      boatExit:{},burrowed:enemy.type==='worm',snareTarget:tower,charge:1,bite:2,blockBite:2,progressAt:-29});
  }
  const stats=actors.map(a=>[a.id,a.hp,a.maxHp,a.speedScale,a.type]);
  const hzValues=[20,60,144];
  for (let pass=0;pass<hzValues.length;pass++) {
    const hz=hzValues[pass];
    if(pass) for(const enemy of actors) enemy.position.y=-6.1;
    e.update(1/hz);
    assert.equal(e.zombies.length,actors.length);
    for(let i=0;i<actors.length;i++) {
      const a=actors[i];
      assert.deepEqual([a.id,a.hp,a.maxHp,a.speedScale,a.type],stats[i]);
      assert.equal(a.airborne,true); assert.equal(a.mode,'air');
      assert.equal(a.path,null); assert.equal(a.target,null); assert.equal(a.jump,null);
      assert.equal(a.swimming,false); assert.equal(a.shoreJump,0); assert.equal(a.boatExit,null);
      assert.equal(a.burrowed,false); assert.equal(a.snareTarget,null); assert.equal(a.charge,0); assert.equal(a.bite,0);
      assert.ok(Math.hypot(a.position.x-M.hearthTree.position.x,a.position.z-M.hearthTree.position.z)>=24);
    }
    assert.equal(scene.children.filter(n=>n.name==='Enemy air signal').length,actors.length, 'repeat falls replace their old landing markers');
  }
  assert.equal(tower.snareOwner,null); assert.equal(tower.snareTime,0);
  assert.equal(coins.length,0);
});

test('a parachuting enemy can fall through a newly mined landing zone and return again instead of standing on y=0', () => {
  const { M,scene }=enemyFixture(),e=M.enemies;
  const enemy=e.spawnAt({x:15,y:14,z:15},'skeleton',{airborne:true});
  let belowBottom=false;
  for(let i=0;i<600 && enemy.position.x===15 && enemy.position.z===15;i++) {
    e.update(1/60);
    if(enemy.position.y<0) { belowBottom=true; assert.equal(enemy.airborne,true); }
  }
  assert.ok(belowBottom, 'the parachute does not land on an invisible zero-height floor');
  assert.ok(enemy.position.y>14); assert.equal(enemy.airborne,true);
  assert.ok(Math.hypot(enemy.position.x,enemy.position.z)>=24);
  assert.equal(scene.children.filter(n=>n.name==='Enemy air signal').length,1);
  e.damageEnemy(enemy,enemy.hp);
  e.update(.05);
  assert.equal(scene.children.filter(n=>n.name==='Enemy air signal').length,0, 'death clears the landing warning');
});

test('unavailable landing sites push void returns farther out instead of toward the Hearth', () => {
  const { M }=enemyFixture(),e=M.enemies,w=M.world;
  const enemy=e.spawnAt({x:15,y:14,z:15},'brute'); enemy.position.y=-6.1;
  const waterDepth=w.waterDepthAt;
  w.waterDepthAt=(x,z)=>Math.hypot(x,z)<=32 ? 2 : waterDepth(x,z);
  e.update(1/60);
  const distance=Math.hypot(enemy.position.x,enemy.position.z);
  assert.equal(enemy.airborne,true);
  assert.ok(distance>32 && distance<=48, `fallback stays outside the defense band: ${distance}`);
  assert.ok(M.actorPhysics.clear(w,enemy.position.x,enemy.landingY,enemy.position.z,enemy.body));
});
