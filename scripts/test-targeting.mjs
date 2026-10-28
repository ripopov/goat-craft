import assert from 'node:assert/strict';
import test from 'node:test';
import { game } from './helpers/animal-game.mjs';

function fixture() {
  const h = game(), { M, load, scene } = h;
  load('js/coin-model.js'); load('js/inventory.js'); load('js/items.js'); M.items.init(scene); load('js/upgrades.js'); load('js/highlights.js'); M.highlights.init(scene);
  M.goat.group.position.set(15, 14, 15); M.goat.state.manualHold = 1000;
  const camera = M.goat.aimCamera; camera.position.set(15, 15.75, 15);
  return { ...h, camera };
}
function advance(M, seconds) { for (let i = 0; i < Math.round(seconds * 60); i++) M.goat.update(1 / 60, i / 60); }

test('camera aims and the mine action destroys blocks in four directions, above and below', () => {
  const { M, camera } = fixture(), w = M.world;
  for (const [bx,by,bz] of [[9,7,7],[5,7,7],[7,7,9],[7,7,5],[7,9,7]]) {
    assert.ok(w.placeBlock('stone', bx,by,bz));
    camera.lookAt((bx+.5)*2,(by+.5)*2,(bz+.5)*2);
    const hit = M.targeting.aim(camera,M.goat.group.position);
    assert.ok(hit); assert.deepEqual([hit.bx,hit.by,hit.bz],[bx,by,bz]);
    M.goat.mine();
    assert.equal(w.blockInfoAt(bx,by,bz),null, 'the aimed voxel was destroyed');
  }
  camera.lookAt(15,10,15);
  assert.equal(M.targeting.aim(camera,M.goat.group.position).by,6);
  M.goat.mine();
  assert.equal(w.blockInfoAt(7,6,7),null, 'look down to mine the floor');
});

test('manual mining swings the head or hoof without consuming combat cooldowns or dealing combat damage', () => {
  const { M, camera } = fixture(), goat = M.goat, s = goat.state;
  camera.lookAt(15,15.75,19);
  const enemy = M.enemies.spawnAt({ x: 18, y: 14, z: 15 }), hp = enemy.hp;
  s.headbuttCooldown = s.stompCooldown = 100;
  advance(M, .8);
  const neck = goat.headPivot.parent, restingNeck = neck.rotation.x;
  const hip = goat.group.children[0].children.find(node => node.isGroup && node.position.x > 0 && node.position.z > 0 && node.position.y < 1);
  const restingHip = hip.rotation.x;
  for (const style of [undefined, 'hoof']) {
    assert.ok(M.world.placeBlock('stone',7,7,9));
    const headCooldown = s.headbuttCooldown, hoofCooldown = s.stompCooldown;
    if (style === 'hoof') goat.kick();
    else goat.mine();
    if (style === 'hoof') {
      assert.equal(M.world.blockInfoAt(7,6,7),null, 'hoof immediately breaks the ground beneath it');
      assert.ok(M.world.blockInfoAt(7,7,9), 'hoof ignores the camera target');
    } else assert.equal(M.world.blockInfoAt(7,7,9),null, 'head mining remains immediate');
    assert.equal(s.headbuttCooldown,headCooldown);
    assert.equal(s.stompCooldown,hoofCooldown);
    advance(M, style === 'hoof' ? .24 : .15);
    if (style === 'hoof') assert.ok(hip.rotation.x < restingHip - .3, 'right hoof visibly lifts for the strike');
    else assert.ok(neck.rotation.x > restingNeck + .1, 'head swings into the mining strike');
    advance(M, .8);
    assert.equal(s.mining,-1, 'the manual pose finishes');
    assert.ok(Math.abs(hip.rotation.x - restingHip) < .01, 'hoof returns to its resting pose');
    assert.ok(Math.abs(neck.rotation.x - restingNeck) < .01, 'neck returns to its resting pose');
    assert.equal(enemy.hp,hp, 'mining cannot trigger a melee attack or spell');
    assert.equal(s.headbutt,-1);
    assert.equal(s.stomp,-1);
  }
});

test('hoof mining uses the striking hoof footprint with the camera pointing sideways or into the sky', () => {
  const { M, camera } = fixture(), goat = M.goat;
  goat.group.position.set(15.85,14,15.85);
  goat.group.rotation.y = goat.state.yaw = 0;
  camera.position.set(15.85,15.75,15.85);
  M.world.placeBlock('stone',9,7,7);
  camera.lookAt(19,15,15);
  assert.ok(M.targeting.aim(camera,goat.group.position), 'camera is aimed at a different block');
  goat.kick();
  assert.equal(M.world.blockInfoAt(8,6,8),null, 'breaks beneath the front right hoof across the voxel boundary');
  assert.ok(M.world.blockInfoAt(7,6,7), 'the block beneath the body remains');
  assert.ok(M.world.blockInfoAt(9,7,7), 'the aimed block remains');
  assert.equal(goat.state.yaw,0, 'hoof strike preserves the goat facing');

  goat.group.position.set(15,14,15);
  camera.lookAt(15,30,15);
  assert.equal(M.targeting.aim(camera,goat.group.position),null);
  goat.kick();
  assert.equal(M.world.blockInfoAt(7,6,7),null, 'skyward camera does not prevent ground mining');

  goat.group.position.y = 18; goat.state.grounded = false;
  assert.ok(M.world.blockInfoAt(7,5,7));
  goat.kick();
  assert.ok(M.world.blockInfoAt(7,5,7), 'airborne kicks cannot mine distant ground');
});

test('placement contour uses the same adjacent face and validity check as the action', () => {
  const { M, camera } = fixture(); M.world.placeBlock('stone',7,7,9);
  camera.lookAt(15,15,19); M.items.selectSlot(M.items.addItem('log',2));
  const target = M.items.placementTarget(); assert.ok(target.valid);
  assert.deepEqual([target.bx,target.by,target.bz],[7,7,8]);
  M.highlights.update(); assert.equal(M.highlights.placement.visible,true);
  assert.deepEqual(Array.from(M.highlights.placement.position.toArray()),[15,15,17]);
  assert.equal(M.items.placeSelectedBlock(),true); assert.equal(M.world.blockInfoAt(7,7,8).kind,'log');
  assert.equal(M.items.count('log'),1);
  const blocked = M.items.placementTarget(); assert.equal(blocked.valid,false, 'next cell intersects the player');
  M.highlights.update(); assert.equal(M.highlights.placement.material.color.getHex(),0xeb8e74);
  assert.equal(M.items.placeSelectedBlock(),false); assert.equal(M.items.count('log'),1);
});

test('mining cannot reach distant blocks or pass through an intervening wall', () => {
  const { M, camera } = fixture();
  M.world.placeBlock('stone',7,7,12); camera.lookAt(15,15,25);
  assert.equal(M.targeting.aim(camera,M.goat.group.position),null);
  M.world.placeBlock('stone',7,7,8);
  const hit = M.targeting.aim(camera,M.goat.group.position);
  assert.equal(hit.bz,8,'nearest wall intercepts the ray');
});

test('Q outline selects exactly the animal that opens for upgrades; combat targets are never highlighted', () => {
  const { M, camera, scene } = fixture(), p=M.goat.group.position;
  M.animals.list.forEach((a,i)=>a.group.position.set(-20+i*3,14,-18));
  const animal=M.animals.list[0]; animal.group.position.set(18,14,15);
  camera.lookAt(15,15,25);
  const enemy = M.enemies.spawnAt({x:15,y:14,z:17}); M.enemies.update(0);
  M.highlights.update(); assert.equal(M.highlights.animal,M.upgrades.nearest());
  const shells=[]; animal.group.traverse(node=>{if(node.name==='Q upgrade target')shells.push(node);});
  assert.ok(shells.length>0&&shells.every(node=>node.visible));
  assert.equal(scene.getObjectByName('Enemies in attack range').count,0,'attacks are automatic: no enemy is outlined for combat');
  enemy.position.set(25,14,25); animal.group.position.set(30,14,15); M.enemies.update(0); M.highlights.update();
  assert.equal(M.highlights.animal,null); assert.ok(shells.every(node=>!node.visible));
  assert.equal(scene.getObjectByName('Enemies in attack range').count,0);
});

test('voxel aiming skips cells only grazed at a corner and handles negative coordinates', () => {
  const { M, THREE } = fixture();
  M.world.placeBlock('stone',8,7,7); M.world.placeBlock('stone',8,7,8);
  const diagonal=M.targeting.trace(new THREE.Vector3(15,15,15),new THREE.Vector3(1,0,1).normalize(),6);
  assert.deepEqual([diagonal.bx,diagonal.by,diagonal.bz],[8,7,8]);
  M.world.placeBlock('stone',-10,7,-8);
  const negative=M.targeting.trace(new THREE.Vector3(-15,15,-15),new THREE.Vector3(-1,0,0),6);
  assert.deepEqual([negative.bx,negative.by,negative.bz],[-10,7,-8]);
  assert.equal(negative.normal.x,1);
});
