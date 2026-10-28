import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isolatedAnimal } from './helpers/animal-game.mjs';

function clearBody(M, animal) {
  const p = animal.group.position;
  return M.actorPhysics.clear(M.world, p.x, p.y, p.z, M.animals.bodyOf(animal));
}

test('progress monitor ignores idle animals and escalates only sustained blockage', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(new URL('../js/animal-recovery.js', import.meta.url), 'utf8'), context);
  const M = context.window.Meadow;
  const monitor = M.animalRecovery.create();
  const position = { x: 1, y: 14, z: 1 };
  for (let i = 0; i < 100; i++) M.animalRecovery.update(monitor, position, 'idle', false, .05);
  assert.equal(monitor.stage, 'clear');
  assert.equal(monitor.stagnant, 0);
  for (let i = 0; i < 8; i++) M.animalRecovery.update(monitor, position, 'walk', true, .05);
  assert.equal(monitor.stage, 'jump');
  for (let i = 0; i < 15; i++) M.animalRecovery.update(monitor, position, 'walk', true, .05);
  assert.equal(monitor.stage, 'detour');
  for (let i = 0; i < 22; i++) M.animalRecovery.update(monitor, position, 'walk', true, .05);
  assert.equal(monitor.stage, 'escape');
  position.x += .2;
  M.animalRecovery.update(monitor, position, 'walk', true, .05);
  assert.equal(monitor.stage, 'clear');
});

test('escape digging skips permanent gate and road blocks in favor of breakable material', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(new URL('../js/animal-recovery.js', import.meta.url), 'utf8'), context);
  const recovery = context.window.Meadow.animalRecovery;
  const world = {
    surfaceHeight: () => 14, blockedAt: () => true,
    blockInfoAt: (bx, by, bz) => by === 7 && bz === 0 && (bx === 1 || bx === 2)
      ? { kind: bx === 1 ? 'hellstone' : 'stone', type: bx === 1 ? 'gate' : 'placed', unbreakable: bx === 1 }
      : null
  };
  const position = { x: 1.9, y: 14, z: 1 }, body = { height: 1.8, radius: .4 };
  const target = recovery.findDig(world, position, body, { x: 1, z: 0 });
  assert.equal(target.bx, 2, 'reachable breakable wall selected beyond the permanent frame');
  world.blockInfoAt = () => ({ kind: 'roadstone', unbreakable: true });
  assert.equal(recovery.findDig(world, position, body, { x: 1, z: 0 }), null);
});

test('a walker clears a one-block ledge without emergency relocation', () => {
  const { M, animal, advanceUntil, place, walkTo } = isolatedAnimal();
  animal.group.position.set(17, 14, 1);
  place(9, 0, 7, 7);
  walkTo(27, 1);
  assert.ok(advanceUntil(8, () => animal.group.position.x > 21 && animal.state.grounded));
  assert.ok(animal.group.position.x > 21, `x=${animal.group.position.x}`);
  assert.equal(animal.state.escape, null, 'a short ledge needs no excavation');
  assert.equal(animal.state.recovery.rescues, 0);
  assert.ok(clearBody(M, animal));
});

test('a walker digs through a tall solid wall and continues past it', () => {
  const { M, animal, advanceUntil, place, walkTo } = isolatedAnimal();
  animal.group.position.set(17, 14, 1);
  for (let z = -12; z <= 12; z++) place(9, z, 7, 9);
  walkTo(27, 1);
  const escaped = advanceUntil(30, () => animal.group.position.x > 21);
  assert.ok(escaped, JSON.stringify({ p: animal.group.position, recovery: animal.state.recovery, escape: animal.state.escape }));
  assert.ok([-1, 0, 1, 2].some(bz => !M.world.blockInfoAt(9, 7, bz)), 'a wall block was excavated');
  assert.equal(animal.state.recovery.rescues, 0);
  assert.ok(clearBody(M, animal));
});

test('a trapped builder excavates a safe ascending route out of a deep pit', () => {
  const { M, animal, advanceUntil, walkTo } = isolatedAnimal('Clover');
  // Dig beside the permanent road, which deliberately cannot become a pit.
  for (const [bx, bz] of [[9, -6], [9, -5], [10, -6], [10, -5]]) {
    assert.ok(M.world.breakBlockAt(bx, 6, bz, { drop: false }));
    assert.ok(M.world.breakBlockAt(bx, 5, bz, { drop: false }));
  }
  animal.group.position.set(19, 10, -11);
  animal.state.carryCount = 0;
  animal.state.carry = null;
  walkTo(27, -11);
  const escaped = advanceUntil(35, () => animal.group.position.y >= 13.9);
  assert.ok(escaped, JSON.stringify({ p: animal.group.position, recovery: animal.state.recovery, escape: animal.state.escape }));
  assert.ok(animal.state.carryCount > 0, 'excavated material is retained');
  assert.equal(animal.state.recovery.rescues, 0);
  assert.ok(clearBody(M, animal));
});

test('escape digging can open an enclosure made from placed blocks', () => {
  const { M, animal, advanceUntil, place, walkTo } = isolatedAnimal();
  animal.group.position.set(19, 14, 1);
  for (let bx = 8; bx <= 10; bx++) for (let bz = -1; bz <= 1; bz++) {
    if (bx === 9 && bz === 0) continue;
    place(bx, bz, 7, 8);
  }
  walkTo(27, 1);
  const escaped = advanceUntil(25, () => animal.group.position.x > 21);
  assert.ok(escaped, JSON.stringify({ p: animal.group.position, recovery: animal.state.recovery, escape: animal.state.escape }));
  assert.equal(animal.state.recovery.rescues, 0);
  assert.ok(clearBody(M, animal));
});

test('a roof that invalidates jumping leads to excavation instead of a jump loop', () => {
  const { M, animal, advanceUntil, place, walkTo } = isolatedAnimal();
  animal.group.position.set(17, 14, 1);
  for (let z = -8; z <= 8; z++) {
    place(9, z, 7, 7);
    place(9, z, 9, 9);
    place(8, z, 9, 9);
  }
  walkTo(27, 1);
  const escaped = advanceUntil(25, () => animal.group.position.x > 21);
  assert.ok(escaped, JSON.stringify({ p: animal.group.position, recovery: animal.state.recovery, escape: animal.state.escape }));
  assert.equal(animal.state.recovery.rescues, 0);
  assert.ok(clearBody(M, animal));
});

test('two animals detour around each other without digging or relocation', () => {
  const { M, animal, advance, walkTo } = isolatedAnimal();
  const other = M.animals.list.find(candidate => candidate.name === 'Poppy');
  animal.group.position.set(17, 14, 1);
  other.group.position.set(21, 14, 1);
  Object.assign(other.state, { mode: 'walk', wait: 0, buildTimer: 1000, pitTimer: 1000, retired: false });
  other.state.target.set(15, 14, 1);
  walkTo(25, 1);
  let crossed = false, otherCrossed = false;
  advance(8, () => {
    if (other.group.position.x < 17) { otherCrossed = true; other.state.mode = 'idle'; other.state.wait = 1000; }
    if (animal.group.position.x > 23) { crossed = true; animal.state.mode = 'idle'; animal.state.wait = 1000; }
  });
  assert.ok(crossed);
  assert.ok(animal.group.position.x > 19, `first x=${animal.group.position.x}`);
  assert.ok(otherCrossed, `second x=${other.group.position.x}`);
  assert.equal(animal.state.recovery.rescues, 0);
  assert.equal(other.state.recovery.rescues, 0);
  assert.equal(animal.state.escape, null);
  assert.equal(other.state.escape, null);
});

test('a hunter clears an obstacle and resumes attacking its zombie', () => {
  const { M, animal, advance, place } = isolatedAnimal('Bramble');
  animal.group.position.set(17, 14, 1);
  place(9, 0, 7, 7);
  const zombie = M.enemies.spawnAt(M.enemies.navigation.nodeAt(23, 14, 1));
  assert.ok(zombie);
  advance(12);
  assert.ok(zombie.hp < zombie.maxHp || !M.enemies.zombies.includes(zombie));
  assert.equal(animal.state.recovery.rescues, 0);
  assert.ok(clearBody(M, animal));
});

test('all four NPC bodies route around short walls without jumping, excavation or rescue', () => {
  const { M,place }=isolatedAnimal();
  M.goat.group.position.set(-30,14,-30);
  for(let z=5;z<=9;z++) place(9,z,7,9);
  const revision=M.world.revision;
  for(const animal of M.animals.list) {
    for(const [i,other] of M.animals.list.entries()) {
      other.group.position.set(-24+i*3,14,-24);
      Object.assign(other.state,{mode:'idle',wait:1000,retired:true,pitTimer:1000,buildTimer:1000});
    }
    const p=animal.group.position,s=animal.state;
    p.set(15,14,15);s.target.set(25,14,15);
    Object.assign(s,{mode:'walk',grounded:true,vy:0,speed:0,navigation:null,escape:null,detourTarget:null,detourTime:0,jumpReason:null});
    let arrived=false;
    for(let i=0;i<600;i++) {
      M.animals.update(.05,i*.05);
      assert.ok(clearBody(M,animal));
      if(Math.hypot(p.x-25,p.z-15)<.4) {arrived=true;break;}
    }
    assert.ok(arrived,animal.name+' goes around the wall: '+JSON.stringify(p));
    assert.equal(s.jumpReason,null,animal.name+' never jumps at a tall wall');
    assert.equal(s.recovery.rescues,0);
    assert.equal(M.world.revision,revision,'routing leaves the wall intact');
  }
});

test('a concave wall requires an initial retreat instead of oscillating into its corners', () => {
  const { M,animal,place,walkTo,advanceUntil }=isolatedAnimal();
  M.goat.group.position.set(-30,14,-30);
  for(let x=7;x<=10;x++) {place(x,6,7,9);place(x,9,7,9);}
  for(let z=7;z<=8;z++) place(10,z,7,9);
  animal.group.position.set(17,14,15);walkTo(27,15);
  const revision=M.world.revision;
  assert.ok(advanceUntil(30,()=>Math.hypot(animal.group.position.x-27,animal.group.position.z-15)<.4),JSON.stringify(animal.group.position));
  assert.equal(M.world.revision,revision,'walks out of the open end instead of digging');
  assert.equal(animal.state.recovery.rescues,0);
});

test('an impossible wander point inside the Hearth is abandoned without repeated jumping', () => {
  const { M,animal,walkTo,advance }=isolatedAnimal();
  animal.group.position.set(10,14,0);walkTo(0,0);
  const revision=M.world.revision;
  advance(1.5);
  assert.equal(animal.state.mode,'idle');
  assert.equal(animal.state.jumpReason,null);
  assert.equal(animal.state.escape,null);
  assert.equal(animal.state.recovery.rescues,0);
  assert.equal(M.world.revision,revision);
});

test('construction across a committed wall detour triggers a fresh route', () => {
  const { M,animal,place,walkTo,advance,advanceUntil }=isolatedAnimal();
  M.goat.group.position.set(-30,14,-30);
  for(let z=5;z<=9;z++) place(9,z,7,9);
  animal.group.position.set(15,14,15);walkTo(25,15);
  advance(.2);
  const route=animal.state.navigation.path;
  assert.ok(route && route.length>2);
  const crossing=route.find(n=>n.x>=19 && (n.z<10 || n.z>20));
  assert.ok(crossing);
  place(9,Math.floor(crossing.z/2),7,9);
  const revision=M.world.revision;
  assert.ok(advanceUntil(30,()=>Math.hypot(animal.group.position.x-25,animal.group.position.z-15)<.4),JSON.stringify(animal.group.position));
  assert.equal(M.world.revision,revision,'replans without mining the newly placed block');
  assert.equal(animal.state.recovery.rescues,0);
});

test('stationary combat is useful work, not a stuck movement request', () => {
  const { M,animal,advance }=isolatedAnimal('Bramble');
  animal.group.position.set(17,14,1);
  const enemy=M.enemies.spawnAt({x:23,y:14,z:1});enemy.hp=500;
  const start=animal.group.position.clone();
  advance(12);
  assert.ok(enemy.hp<500,'continues attacking');
  assert.ok(animal.group.position.distanceTo(start)<.2,'holds its combat position');
  assert.equal(animal.state.escape,null);
  assert.equal(animal.state.jumpReason,null);
  assert.equal(animal.state.recovery.rescues,0);
});

test('a wall beside the Hearth uses the same terrain routing instead of jumping into roots', () => {
  const { M,animal,place,walkTo,advanceUntil }=isolatedAnimal();
  M.goat.group.position.set(-30,14,-30);
  for(let z=-4;z<=4;z++) place(4,z,7,10);
  animal.group.position.set(12,14,0);walkTo(-12,0);
  const revision=M.world.revision;
  assert.ok(advanceUntil(50,()=>Math.hypot(animal.group.position.x+12,animal.group.position.z)<.4),JSON.stringify(animal.group.position));
  assert.equal(animal.state.jumpReason,null);
  assert.equal(animal.state.recovery.rescues,0);
  assert.equal(M.world.revision,revision);
});

test('the slower builder follows wall routes at low and high update rates', () => {
  const { M,animal,place,walkTo }=isolatedAnimal('Clover');
  M.goat.group.position.set(-30,14,-30);
  for(let z=5;z<=9;z++) place(9,z,7,9);
  for(const hz of [20,144]) {
    animal.group.position.set(15,14,15);
    Object.assign(animal.state,{grounded:true,vy:0,speed:0,navigation:null,escape:null,detourTarget:null,detourTime:0});
    walkTo(25,15);
    let arrived=false;
    for(let i=0;i<hz*30;i++) {
      M.animals.update(1/hz,i/hz);
      if(Math.hypot(animal.group.position.x-25,animal.group.position.z-15)<.4){arrived=true;break;}
    }
    assert.ok(arrived,'reaches the goal at '+hz+' Hz');
    assert.equal(animal.state.recovery.rescues,0);
  }
});

test('hunters skip a target inside solid wood and keep attacking reachable enemies', () => {
  const { M,animal,advance }=isolatedAnimal('Bramble');
  M.goat.group.position.set(-30,14,-30);
  animal.group.position.set(10,14,0);
  const blocked=M.enemies.spawnAt({x:11,y:14,z:0});blocked.position.set(0,14,0);
  const reachable=M.enemies.spawnAt({x:18,y:14,z:8});
  advance(10);
  assert.ok(reachable.hp<reachable.maxHp || !M.enemies.zombies.includes(reachable));
  assert.equal(animal.state.jumpReason,null);
  assert.equal(animal.state.recovery.rescues,0);
});

test('strategic coin expeditions do not relocate the working herd away from the Hearth', () => {
  const { M,animal,advance }=isolatedAnimal('Clover');
  animal.group.position.set(17,14,1);
  const start=animal.group.position.clone();
  M.strategy={active:true}; M.goat.group.position.set(200,14,200);
  advance(1);
  assert.ok(animal.group.position.distanceTo(start)<.1,'keeps its Hearth position while the goat is away');
});

test('all NPC bodies share physical cave excavation and roof descent', () => {
  for (const name of ['Mallow', 'Clover', 'Bramble', 'Poppy']) {
    const { M, animal, advanceUntil, walkTo, place } = isolatedAnimal(name, { seed: 42 });
    for (let bx = 8; bx <= 9; bx++) for (let bz = 8; bz <= 9; bz++) for (let by = 1; by <= 2; by++) {
      assert.ok(M.world.breakBlockAt(bx, by, bz, { drop: false }));
    }
    animal.group.position.set(17, 2, 17);
    animal.state.pitTimer = 0;
    walkTo(27, 17);
    let maxStep = 0, previous = animal.group.position.clone();
    assert.ok(advanceUntil(35, () => {
      maxStep = Math.max(maxStep, previous.distanceTo(animal.group.position));
      previous.copy(animal.group.position);
      return animal.group.position.y >= 14 && animal.state.grounded;
    }), name + ' leaves the buried pocket');
    assert.ok(maxStep < 2.1, name + ' escapes without teleporting');
    assert.equal(animal.state.recovery.rescues, 0);
    place(12, 0, 7, 9);
    animal.group.position.set(25, 20, 1);
    Object.assign(animal.state, { mode: 'idle', wait: 0, escape: null, project: null, grounded: true, vy: 0 });
    assert.ok(advanceUntil(15, () => animal.group.position.y <= 14.1 && animal.state.grounded), name + ' leaves a roof');
    assert.equal(animal.state.recovery.rescues, 0);
  }
});

test('travel watchdog survives changing jobs and jumping in place but ignores useful travel and idle time', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(new URL('../js/animal-recovery.js', import.meta.url), 'utf8'), context);
  const r = context.window.Meadow.animalRecovery, state = r.create();
  for (let i = 0; i < 140; i++) {
    const p = { x: Math.sin(i) * .4, y: 12 + Math.abs(Math.sin(i)) * 2, z: 1 };
    r.update(state, p, i % 2 ? 'walk' : 'seekPlace', true, .05, { x: i % 2 ? 20 : -20, z: 1 });
    r.trackTravel(state, p, false, true, .05);
  }
  assert.ok(r.trackTravel(state, { x: 0, y: 12, z: 1 }, true, true, .05));
  assert.equal(r.trackTravel(state, { x: 3, y: 12, z: 1 }, true, true, .05), false);
  for (let i = 0; i < 400; i++) assert.equal(r.trackTravel(state, { x: 3, y: 12, z: 1 }, true, false, .05), false);
});

test('a recovery climb cannot restart its timeout when a landing becomes unreachable', () => {
  const { M, animal, advanceUntil, place } = isolatedAnimal('Clover', { seed: 42 });
  for (let bz = -6; bz <= -4; bz++) assert.ok(M.world.breakBlockAt(9, 6, bz, { drop: false }));
  place(8, -6, 7, 9);
  animal.group.position.set(19, 12, -11);
  Object.assign(animal.state, { mode: 'climbBuild', grounded: true,
    pendingClimb: { x: 17, z: -11, top: 14 }, seekTime: 4.5,
    escape: { time: 20, attempts: 0, rim: 14, resumeMode: 'walk' } });
  assert.ok(advanceUntil(5, () => animal.group.position.y >= 14 && animal.state.grounded), 'blocked recovery reaches dry ground within its remaining deadline');
});


test('a cow physically exits a narrow trench beneath an overhang at low and high update rates', () => {
  for (const hz of [20, 60]) {
    const { M, animal, place, walkTo } = isolatedAnimal('Clover', { seed: 42 });
    for (let bz = -6; bz <= -4; bz++) M.world.breakBlockAt(9, 6, bz, { drop: false });
    for (let bx = 8; bx <= 10; bx++) place(bx, -6, 8, 8);
    animal.group.position.set(19.4, 12, -11);
    Object.assign(animal.state, { mode: 'idle', escape: null, action: null, grounded: true, vy: 0,
      pitTimer: 0, escapeCooldown: 0, navigation: null });
    walkTo(27, -11);
    let exited = false, previous = animal.group.position.clone();
    for (let i = 0; i < hz * 12; i++) {
      M.animals.update(1 / hz, i / hz);
      assert.ok(previous.distanceTo(animal.group.position) < 1.5, 'no relocation or snap');
      assert.ok(clearBody(M, animal));
      previous.copy(animal.group.position);
      if (animal.state.grounded && animal.group.position.y >= 14) { exited = true; break; }
    }
    assert.ok(exited, 'cow escapes at ' + hz + ' Hz');
    assert.equal(animal.state.recovery.rescues, 0);
  }
});
