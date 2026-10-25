import assert from 'node:assert/strict';
import test from 'node:test';
import { game } from './helpers/animal-game.mjs';

function fixture() {
  const h = game(), { M, load, scene } = h;
  load('js/coin-model.js'); load('js/items.js'); M.items.init(scene); load('js/upgrades.js'); load('js/highlights.js'); M.highlights.init(scene);
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
