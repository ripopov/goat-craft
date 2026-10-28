import assert from 'node:assert/strict';
import test from 'node:test';
import { game } from './helpers/animal-game.mjs';

const JUMP_HEIGHT = 12.2 ** 2 / (2 * 26);

function fixture(audio) {
  const h = game({ seed: 19 }), { M, controls, load, scene } = h;
  load('js/coin-model.js'); load('js/inventory.js'); load('js/items.js'); M.items.init(scene); load('js/upgrades.js');
  if (audio) M.goat.init({ scene, camera: M.goat.aimCamera, controls, world: M.world, audio, ui: { showBubble() {} } });
  controls.firstPerson = true;
  M.goat.group.position.set(15,14,15);
  // Isolate the manual landing hit from independent automatic combat.
  M.goat.state.headbuttCooldown = M.goat.state.stompCooldown = 100;
  const camera = M.goat.aimCamera;
  camera.position.set(15,15.75,15); camera.lookAt(15,30,15);
  return h;
}
function advance(M, seconds, dt = 1/60) {
  for (let i=0; i<Math.round(seconds/dt); i++) M.goat.update(dt,i*dt);
}
function land(M, dt = 1/60) {
  for (let i=0; i<120; i++) {
    M.goat.update(dt,i*dt);
    if (M.goat.state.grounded) return;
  }
  assert.fail('aerial stomp did not land');
}

test('airborne right click dives, then hits once inside its visible radius without mining or placing', () => {
  const { M, scene } = fixture(), goat = M.goat;
  M.items.selectSlot(M.items.addItem('log',3));
  const near = M.enemies.spawnAt({x:15,y:14,z:17});
  const behind = M.enemies.spawnAt({x:15,y:14,z:8});
  const edge = M.enemies.spawnAt({x:15,y:14,z:22.99});
  const outside = M.enemies.spawnAt({x:15,y:14,z:23.05});
  const blocked = M.enemies.spawnAt({x:21,y:14,z:15});
  assert.ok(M.world.placeBlock('stone',8,7,7));
  goat.jump(); goat.group.position.y = 14 + JUMP_HEIGHT;
  const drop = goat.group.position.y - 14;
  goat.kick();
  assert.equal(goat.state.aerialStomp,true);
  assert.ok(goat.state.vy <= -24, 'right click reverses the rising jump into a dive');
  assert.equal(near.hp,8, 'there is no damage before landing');
  assert.equal(scene.getObjectByName('aerial-stomp-shockwave'),undefined);
  goat.kick(); const velocity = goat.state.vy; goat.jump();
  assert.equal(goat.state.vy,velocity, 'repeated clicks or jumps cannot restart the slam');
  land(M);
  const remainingHp = 3;
  for (const enemy of [near,behind,edge]) assert.ok(Math.abs(enemy.hp-remainingHp)<1e-9, 'landing damage includes distance fallen after activation');
  assert.equal(outside.hp,8, 'outside the visible radius is safe');
  assert.equal(blocked.hp,8, 'solid walls block the shockwave damage');
  assert.ok(M.world.blockInfoAt(7,6,7), 'landing never mines the floor');
  assert.equal(M.items.count('log'),3, 'airborne right click takes priority over block placement');
  const fx = scene.getObjectByName('aerial-stomp-shockwave');
  assert.ok(fx);
  assert.ok(Math.abs(fx.userData.radius-8)<1e-9);
  assert.equal(fx.userData.dropDistance,drop);
  assert.equal(fx.children[0].geometry.parameters.outerRadius,fx.userData.radius, 'visible boundary matches combat range');
  assert.deepEqual(Array.from(fx.position.toArray()),[15,14.07,15]);
  let disposed = 0;
  fx.traverse(node => {
    if (node.geometry) node.geometry.addEventListener('dispose',() => disposed++);
    if (node.material) node.material.addEventListener('dispose',() => disposed++);
  });
  goat.state.stompCooldown = 100;
  advance(M,.8);
  assert.ok(Math.abs(near.hp-remainingHp)<1e-9, 'the lingering visual never deals repeated damage');
  assert.equal(scene.getObjectByName('aerial-stomp-shockwave'),undefined);
  assert.equal(disposed,4, 'expired shockwaves release both geometries and materials');
});

test('slam respects block-top collisions and upgrades, and works on successive jumps at different frame rates', () => {
  const { M } = fixture(), goat = M.goat;
  M.enemies.addCoins(100); M.items.addItem('stone',20);
  assert.ok(M.upgrades.buy(M.upgrades.player,'power'));
  goat.group.position.set(15,20,15);
  assert.ok(M.world.placeBlock('stone',7,7,7));
  const enemy = M.enemies.spawnAt({x:15,y:16,z:17}); enemy.hp = 100;
  for (const dt of [1/30,1/120]) {
    goat.group.position.set(15,16+JUMP_HEIGHT,15);
    Object.assign(goat.state,{grounded:false,vy:0,stomp:-1,stompCooldown:100});
    const hp = enemy.hp;
    goat.kick(); land(M,dt);
    assert.equal(goat.group.position.y,16, 'fast dive lands on the placed voxel without tunneling');
    assert.ok(Math.abs(hp-enemy.hp-5*(1+M.upgrades.stats().damage))<1e-9, 'full single-jump drop scales upgraded headbutt damage by five');
    const afterSlamHp = enemy.hp;
    goat.jump(); goat.kick();
    assert.equal(goat.state.aerialStomp,true, 'the next jump can slam immediately after landing');
    land(M,dt);
    assert.equal(enemy.hp,afterSlamHp, 'upgrades cannot add damage to a zero-distance drop');
  }
});

test('reduced motion retains a static range ring and normal aerial stomp damage', () => {
  const { M, scene } = fixture(); M.config.reducedMotion = true;
  const enemy = M.enemies.spawnAt({x:15,y:14,z:17});
  M.goat.jump(); M.goat.group.position.y = 14 + JUMP_HEIGHT;
  M.goat.kick(); land(M);
  assert.ok(Math.abs(enemy.hp-3)<1e-9);
  const fx = scene.getObjectByName('aerial-stomp-shockwave');
  assert.ok(fx, 'essential range feedback remains visible');
  const scale = fx.children[1].scale.x;
  M.goat.advanceSpellFx(.15,.15);
  assert.equal(fx.children[1].scale.x,scale, 'reduced motion removes ring expansion');
  assert.equal(scene.getObjectByName('spell-spark'),undefined);
});

test('ordinary jumps and water entry never produce an aerial shockwave', () => {
  const { M, scene } = fixture(), goat = M.goat;
  const enemy = M.enemies.spawnAt({x:15,y:14,z:17});
  goat.jump(); land(M);
  assert.equal(enemy.hp,8, 'ordinary jump landings do not attack');
  assert.equal(scene.getObjectByName('aerial-stomp-shockwave'),undefined);
  goat.jump(); advance(M,.15); goat.kick();
  M.world.waterInfoAtBlock = () => ({level:20,depth:6});
  advance(M,.1);
  assert.equal(goat.state.aerialStomp,false, 'water entry cancels the pending landing strike');
  assert.equal(scene.getObjectByName('aerial-stomp-shockwave'),undefined);
  assert.equal(enemy.hp,8);
  goat.kick();
  assert.equal(goat.state.aerialStomp,false, 'right click while swimming does not start an aerial slam');
});

test('slam activates at takeoff, ascent, apex, descent and just before landing without a cooldown', () => {
  const { M } = fixture(), goat = M.goat;
  const enemy = M.enemies.spawnAt({x:15,y:14,z:15.01}); enemy.hp = 1000;
  for (const delay of [0,.15,.45,.7,.9]) {
    enemy.position.set(15,14,15.01);
    goat.state.stompCooldown = 100;
    goat.jump(); advance(M,delay);
    assert.equal(goat.state.grounded,false, `still airborne at ${delay}s`);
    const startY = goat.group.position.y, hp = enemy.hp;
    goat.kick();
    assert.equal(goat.state.aerialStomp,true, `activates at ${delay}s`);
    land(M);
    if (delay === 0) assert.equal(enemy.hp,hp, 'no remaining drop means zero damage');
    else {
      assert.ok(enemy.hp<hp, 'a slam still hits when triggered late in the jump');
      const fx = M.goat.group.parent.children.filter(node => node.name==='aerial-stomp-shockwave').at(-1);
      assert.equal(fx.userData.dropDistance,startY-14, 'measures only the distance after activation');
    }
  }
});

test('longer falls after activation hit harder; distance before activation and repeated presses do not add damage', () => {
  const { M, scene } = fixture(), goat = M.goat;
  const enemy = M.enemies.spawnAt({x:15,y:14,z:15.01}); enemy.hp = 1000;
  const distant = M.enemies.spawnAt({x:15,y:14,z:21}); distant.hp = 1000;
  let previousDamage = 0, previousWidth = 0, previousRadius = 0;
  for (const drop of [0,.01,1,JUMP_HEIGHT,3*JUMP_HEIGHT]) {
    enemy.position.set(15,14,15.01); distant.position.set(15,14,21);
    goat.group.position.set(15,14+drop,15);
    Object.assign(goat.state,{grounded:false,vy:-10,stompCooldown:100});
    const hp = enemy.hp, distantHp = distant.hp;
    goat.kick();
    goat.update(1/120,0);
    if (!goat.state.grounded) goat.kick();
    land(M,1/120);
    const damage = hp-enemy.hp;
    if (drop === 0) {
      assert.equal(damage,0, 'zero drop has zero damage, even at point-blank range');
      assert.equal(scene.getObjectByName('aerial-stomp-shockwave'),undefined, 'zero drop has zero shockwave radius');
      continue;
    }
    if (drop === .01) assert.ok(damage<.01, 'near-zero drops give near-zero damage');
    if (drop === JUMP_HEIGHT) assert.ok(Math.abs(damage-5)<1e-9, 'single-jump drop deals five normal hits');
    if (drop === 3*JUMP_HEIGHT) assert.ok(Math.abs(damage-20)<1e-9, 'triple-jump drop deals twenty normal hits');
    assert.ok(damage>previousDamage, 'a longer remaining fall gives a stronger hit');
    const fx = scene.children.filter(node => node.name==='aerial-stomp-shockwave').at(-1);
    assert.ok(fx.userData.radius>previousRadius, 'longer falls increase the actual shockwave radius');
    assert.equal(fx.children[0].geometry.parameters.outerRadius,fx.userData.radius);
    if (drop<=1) assert.equal(distant.hp,distantHp, 'short falls cannot reach a distant enemy');
    else assert.ok(distant.hp<distantHp, 'longer falls reach enemies outside a short slam radius');
    const ring = fx.children[0].geometry.parameters;
    const width = ring.outerRadius-ring.innerRadius;
    assert.ok(width>previousWidth, 'stronger impacts get a thicker shockwave ring');
    previousDamage = damage; previousWidth = width; previousRadius = fx.userData.radius;
  }
  goat.group.position.set(15,22,15);
  Object.assign(goat.state,{grounded:false,vy:-10,stompCooldown:100});
  advance(M,.2);
  enemy.position.set(15,14,15.01);
  const startY = goat.group.position.y, hp = enemy.hp;
  goat.kick(); land(M);
  const damage = hp-enemy.hp;
  const fx = scene.children.filter(node => node.name==='aerial-stomp-shockwave').at(-1);
  assert.equal(fx.userData.dropDistance,startY-14, 'falling before activation adds no strength or range');
  assert.ok(damage>5 && damage<20, 'damage reflects only the remaining drop between one and three jump heights');
});

test('real single and triple jumps reach approximately 5x and 20x normal attack damage with matching expanding ranges', () => {
  const { M, scene } = fixture(), goat = M.goat;
  const enemy = M.enemies.spawnAt({x:15,y:14,z:17}); enemy.hp = 1000;
  for (const jumps of [1,3]) {
    goat.state.stompCooldown = 100;
    enemy.position.set(15,14,17);
    for (let jump=0; jump<jumps; jump++) {
      goat.jump();
      for (let frame=0; frame<120; frame++) {
        goat.update(1/120,frame/120);
        if (goat.state.vy<=0) break;
      }
    }
    const hp = enemy.hp;
    goat.kick(); land(M,1/120);
    const damage = hp-enemy.hp, targetDamage = jumps===1 ? 5 : 20;
    assert.ok(Math.abs(damage/targetDamage-1)<.05, `${jumps} real jumps deal approximately ${targetDamage} normal hits, got ${damage}`);
    const fx = scene.children.filter(node => node.name==='aerial-stomp-shockwave').at(-1);
    assert.ok(Math.abs(fx.userData.radius/(8*Math.sqrt(jumps))-1)<.05);
  }
});

test('aerial landing audio receives its damage multiplier once, including misses and upgraded attacks', () => {
  const sounds = [];
  const audio = new Proxy({}, { get: (_,name) => (...args) => sounds.push([name,...args]) });
  const { M } = fixture(audio), goat = M.goat;
  function slam(drop, expectedScale) {
    sounds.length = 0;
    goat.group.position.set(15,14+drop,15);
    Object.assign(goat.state,{grounded:false,vy:0,stompCooldown:100});
    goat.kick();
    assert.equal(sounds.filter(([name]) => name==='aerialStomp').length,0, 'impact audio waits for landing');
    land(M,1/120);
    const impacts = sounds.filter(([name]) => name==='aerialStomp');
    assert.equal(impacts.length,drop>0 ? 1 : 0);
    if (impacts.length) assert.ok(Math.abs(impacts[0][1]-expectedScale)<1e-9);
    assert.equal(sounds.filter(([name]) => name==='land' || name==='stomp').length,0, 'generic impacts cannot mask the selected stomp sound');
  }
  slam(0,0);
  slam(JUMP_HEIGHT/4,5*Math.pow(.25,Math.log(4)/Math.log(3)));
  slam(JUMP_HEIGHT,5);
  slam(3*JUMP_HEIGHT,20);
  M.enemies.addCoins(100); M.items.addItem('stone',20);
  assert.ok(M.upgrades.buy(M.upgrades.player,'power'));
  slam(JUMP_HEIGHT,5);
});
