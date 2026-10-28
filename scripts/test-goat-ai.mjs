import test from 'node:test';
import assert from 'node:assert/strict';
import { game, classicModules } from './helpers/animal-game.mjs';

function fixture() {
  const h = game({ seed: 72 }), { M, load, scene } = h;
  load('js/coin-model.js'); load('js/inventory.js'); load('js/items.js'); M.items.init(scene);
  M.strategy = { active: true };
  M.goat.group.position.set(15, 14, 15);
  function advance(seconds, dt = .05, enemies = false) {
    for (let t = 0; t < seconds; t += dt) {
      M.goat.update(dt, t);
      if (enemies) M.enemies.update(dt, t);
      M.items.update(dt, t, M.goat.group);
    }
  }
  return { ...h, advance };
}

test('strategic goat fights with real attacks, collects kill coins and relinquishes control', () => {
  const { M, advance, controls, input } = fixture();
  const enemy = M.enemies.spawnAt({ x: 15, y: 14, z: 24 });
  advance(5);
  assert.ok(!M.enemies.zombies.includes(enemy), 'kills an enemy while strategic camera faces elsewhere');
  advance(6);
  assert.ok(M.enemies.getState().coins > 0, 'collects the real kill drop');
  M.strategy.active = false; controls.firstPerson = true; input.set(-1, 0);
  const x = M.goat.group.position.x; advance(.5);
  assert.ok(M.goat.group.position.x < x, 'manual steering resumes immediately');
});

test('urgent tree attackers interrupt coin gathering; stale targets are discarded', () => {
  const { M, advance } = fixture();
  M.items.dropCoins({ x: 25, y: 14, z: 15 }, 3);
  advance(.3); assert.equal(M.goat.state.mode, 'collect');
  const enemy = M.enemies.spawnAt({ x: -10, y: 14, z: 5 }); enemy.mode = 'tree';
  advance(.3); assert.equal(M.goat.state.mode, 'defend');
  M.enemies.damageEnemy(enemy, 1000);
  advance(.4); assert.notEqual(M.goat.state.mode, 'defend');
});

test('routes around a tall wall and collects without mining it', () => {
  const { M, advance } = fixture();
  M.goat.group.position.set(15,14,15);
  for (let z = 5; z <= 9; z++) for (let y = 7; y <= 9; y++) M.world.placeBlock('stone', 9, y, z);
  M.items.dropCoins({ x: 23, y: 14, z: 15 }, 5);
  advance(12);
  assert.equal(M.enemies.getState().coins, 5);
  assert.ok(M.world.blockInfoAt(9,7,7), 'does not destroy defenses');
});

test('bounded search skips sealed loot', () => {
  const { M, advance } = fixture();
  for (let x = 10; x <= 12; x++) for (let z = 6; z <= 8; z++) {
    if (x === 11 && z === 7) continue;
    for (let y = 7; y <= 10; y++) M.world.placeBlock('stone', x, y, z);
  }
  M.items.dropCoins({ x: 23, y: 14, z: 15 }, 5);
  M.items.dropCoins({ x: 15, y: 14, z: 22 }, 2);
  advance(8);
  assert.equal(M.enemies.getState().coins, 2, 'unreachable nearest loot cannot monopolize the goat');
});

test('jumps a one-block obstacle, survives frame rates and replans construction changes', () => {
  const { M, advance } = fixture();
  for (let z = 3; z <= 12; z++) M.world.placeBlock('stone', 9, 7, z);
  M.items.dropCoins({ x: 23, y: 14, z: 15 }, 5);
  let airborne = false;
  for (let i = 0; i < 300; i++) {
    advance(1/30, 1/30);
    airborne ||= !M.goat.state.grounded;
  }
  assert.ok(airborne, 'uses normal jumping to cross a one-block rise');
  assert.equal(M.enemies.getState().coins, 5);
  M.items.dropCoins({ x: 15, y: 14, z: 15 }, 2);
  advance(.5, 1/120);
  for (let z = 5; z <= 9; z++) for (let y = 8; y <= 10; y++) M.world.placeBlock('stone', 9, y, z);
  advance(10, 1/120);
  assert.equal(M.enemies.getState().coins, 7, 'new tall wall invalidates the committed path ' + M.goat.group.position.toArray() + ' ' + M.goat.state.mode);
});

test('defends successive real moving attackers on opposite sides of the hearth', () => {
  const { M, advance } = fixture();
  M.goat.group.position.set(12,14,0);
  const enemies = [M.enemies.spawnAt({ x: 11, y: 14, z: 1 }), M.enemies.spawnAt({ x: -11, y: 14, z: 1 })];
  advance(15, .05, true);
  assert.ok(enemies.every(e => !M.enemies.zombies.includes(e)), 'routes around the actual roots and defeats both attackers');
  assert.ok(M.hearthTree.health > 0, 'hearth survives the scenario');
  assert.ok(M.enemies.getState().coins > 0);
});


test('navigation rejects deep drops and water; a stalled target is temporarily skipped', () => {
  const { M, load } = classicModules({ seed: 1 });
  load('js/actor-physics.js'); load('js/goat-ai.js');
  const world = { blockSize: 2, revision: 0, surfaceHeight: () => 14,
    bodySupportHeight: (x, z) => x > 30 ? -10 : 14,
    bodyBlockedAt: () => false,
    waterInfoAtBlock: (x, z) => x === 10 ? { level: 18, depth: 4 } : null };
  M.enemies = { zombies: [] };
  const coin = (x, z) => ({ position: { x, y: 14.65, z }, userData: { drop: { kind: 'coin' } } });
  M.items = { drops: [coin(12, 0), coin(8, 8)] };
  const pilot = M.goatAI.create(world, { radius: .42, height: 1.9, skin: .002 });
  assert.equal(pilot.safe(32,14,0),false, 'rejects unsupported cliffs');
  assert.equal(pilot.safe(21,14,0),false, 'does not walk into deep water');
  const p = { x: 8, y: 14, z: 0 }, state = { grounded: true };
  assert.equal(pilot.update(.25,p,state,8.4).waypoint.z,0);
  let command;
  for (let i=0; i<8; i++) command = pilot.update(.25,p,state,8.4);
  assert.ok(command.waypoint.z > 0, 'a jammed route yields to another reachable coin');
  world.revision++;
  assert.equal(pilot.update(.25,p,state,8.4).waypoint.z,0, 'world edit clears failure cooldowns');
});

test('leaves the actual Hearth crown using gravity and returns to defense without rescue', () => {
  const { M, advance } = fixture(), goat = M.goat, home = M.config.startingArea;
  const crown = M.hearthTree.boxSupportHeight(home.x,home.z,goat.body.radius,Infinity);
  goat.group.position.set(home.x,crown,home.z);
  Object.assign(goat.state,{grounded:true,vy:0});
  const enemy = M.enemies.spawnAt({ x: 12, y: 14, z: 0 });
  let largestStep = 0, previous = goat.group.position.clone();
  for (let i=0;i<400;i++) {
    advance(.05);
    largestStep = Math.max(largestStep,previous.distanceTo(goat.group.position));
    previous.copy(goat.group.position);
  }
  assert.ok(goat.group.position.y < crown-10, 'descends from crown: '+goat.group.position.toArray());
  assert.ok(!M.enemies.zombies.includes(enemy),'resumes combat on the ground');
  assert.ok(largestStep < 2.1,'descends with normal physics, never teleports');
});

test('digs stairs out of a sealed shaft without losing inventory, then fights', () => {
  const { M, advance, load } = fixture(), p = M.goat.group.position;
  load('js/upgrades.js');
  M.enemies.addCoins(42); M.items.addItem('log',7);
  // Two blocks wide, three blocks deep; too high for a normal jump.
  for (let x=7;x<=8;x++) for (let z=7;z<=8;z++) for (let y=4;y<=6;y++) {
    assert.ok(M.world.breakBlockAt(x,y,z,{drop:false}));
  }
  p.set(16,8,16); Object.assign(M.goat.state,{grounded:true,vy:0});
  let cuts=0, maxStep=0, previous=p.clone();
  const breakBlock=M.world.breakBlockAt;
  M.world.breakBlockAt=(...args)=>{const result=breakBlock(...args);if(result)cuts++;return result;};
  M.items.selectSlot(M.items.addItem('stone',3));
  for(let i=0;i<160;i++) {
    advance(.05);maxStep=Math.max(maxStep,previous.distanceTo(p));previous.copy(p);
  }
  assert.ok(cuts>0,'actually excavates natural blocks');
  assert.ok(maxStep<2.1,'walks and jumps out without rescue teleportation');
  assert.ok(p.y>=14,'climbs to dry ground: '+p.toArray());
  assert.ok(M.items.count('stone')>=3,'selected building stack is never placed or consumed');
  assert.ok(M.actorPhysics.clear(M.world,p.x,p.y,p.z,M.goat.body));
  assert.equal(M.enemies.getState().coins,42); assert.equal(M.items.count('log'),7);
  assert.ok(M.world.blockInfoAt(6,6,7),'unneeded shaft walls remain intact');
  const enemy=M.enemies.spawnAt({x:p.x+4,y:p.y,z:p.z});
  advance(5);
  assert.ok(!M.enemies.zombies.includes(enemy),'combat resumes after excavation');
});

test('roof, airborne entry and void return all lead back to ground duty at different frame rates', () => {
  const { M, advance } = fixture(), goat=M.goat, home=M.config.startingArea;
  for (let x=6;x<=8;x++) for(let z=6;z<=8;z++) M.world.placeBlock('stone',x,18,z);
  const crown=M.hearthTree.boxSupportHeight(home.x,home.z,goat.body.radius,Infinity);
  for (const [position,hz] of [[[15,38,15],20],[[home.x,crown+8,home.z],60],[[15,-7,15],144]]) {
    M.strategy.active=false; advance(.05);
    goat.group.position.set(...position);
    Object.assign(goat.state,{grounded:false,vy:0}); M.strategy.active=true;
    advance(18,1/hz);
    assert.ok(goat.group.position.y<20,'returns to ground at '+hz+' Hz: '+goat.group.position.toArray());
    assert.ok(goat.state.grounded);
    assert.ok(M.actorPhysics.clear(M.world,goat.group.position.x,goat.group.position.y,goat.group.position.z,goat.body));
  }
});

function navigationFixture() {
  const { M, load }=classicModules({seed:2});
  load('js/actor-physics.js'); load('js/goat-ai.js');
  const world={ blockSize:2, revision:0, surfaceHeight:()=>14,
    bodySupportHeight:()=>14, bodyBlockedAt:()=>false, waterInfoAtBlock:()=>null };
  M.enemies={ zombies:[] }; M.items={ drops:[] };
  return { M, world, pilot:M.goatAI.create(world,{radius:.42,height:1.9,skin:.002}) };
}

test('long-distance returns use bounded route prefixes rather than standing still', () => {
  const { pilot }=navigationFixture(), p={x:3000,y:14,z:0};
  for(let i=0;i<2200;i++) {
    const command=pilot.update(.25,p,{grounded:true},8.4);
    assert.ok(!command.rescue,'a traversable long return never needs rescue');
    if(command.waypoint) Object.assign(p,command.waypoint);
    if(Math.hypot(p.x,p.z)<12) break;
  }
  assert.ok(Math.hypot(p.x,p.z)<12,'reaches Hearth from beyond a single search budget');
});

test('no-route watchdog covers swimming, survives world edits, and never rescues a resting guard', () => {
  const { M, world, pilot }=navigationFixture(), p={x:80,y:12.7,z:80};
  world.waterInfoAtBlock=(x,z)=>x>25?{level:14,depth:10}:null;
  world.bodySupportHeight=(x,z)=>x>50?4:14;
  const state={grounded:false,swimming:true,waterLevel:14};
  let command;
  for(let i=0;i<48;i++) {
    world.revision++;
    command=pilot.update(.25,p,state,8.4);
    if(command.rescue) break;
  }
  assert.ok(command.rescue,'no nearby shore triggers delayed rescue even during continuous world edits');
  assert.equal(command.rescue.y,14);
  Object.assign(p,command.rescue); state.swimming=false;state.grounded=true;
  for(let i=0;i<200;i++) {
    const next=pilot.update(.25,p,state,8.4);
    assert.ok(!next.rescue,'healthy guard duty never triggers rescue');
    if(next.waypoint) Object.assign(p,next.waypoint);
  }
  assert.equal(pilot.rescues,1);
  // A completely blocked rescue zone must not teleport the goat into solids.
  pilot.reset(); world.bodyBlockedAt=()=>true;
  for(let i=0;i<48;i++) command=pilot.update(.25,p,{grounded:true},8.4);
  assert.ok(!command.rescue,'no safe destination means no invalid teleport');
  world.bodyBlockedAt=()=>false; world.revision++;
  assert.ok(pilot.update(.25,p,{grounded:true},8.4),'can resume when the world opens');
});

test('slow continuous progress at 144 Hz does not trip frame-dependent stuck detection', () => {
  const { M,pilot }=navigationFixture(),p={x:12,y:14,z:0};
  M.items.drops=[{position:{x:20,y:14.65,z:0},userData:{drop:{kind:'coin'}}}];
  for(let i=0;i<144*6;i++) {
    const command=pilot.update(1/144,p,{grounded:true},8.4);
    assert.equal(command.mode,'collect');
    assert.ok(!command.rescue);
    p.x+=.5/144;
  }
});

test('finds the starter cave exit and climbs its stairs using normal physics', () => {
  const { M,advance }=fixture(),p=M.goat.group.position;
  p.set(21,4,41); Object.assign(M.goat.state,{grounded:true,vy:0});
  let previous=p.clone(),maxStep=0;
  for(let i=0;i<500;i++) {
    advance(.05);maxStep=Math.max(maxStep,previous.distanceTo(p));previous.copy(p);
    if(p.y>=14 && Math.hypot(p.x,p.z)<15) break;
  }
  assert.ok(p.y>=14 && Math.hypot(p.x,p.z)<15,'exits cave and returns to guard: '+p.toArray());
  assert.ok(maxStep<2.1,'uses stairs rather than a rescue');
});

test('oscillating movement cannot indefinitely postpone recovery', () => {
  const { M,pilot }=navigationFixture(),p={x:12,y:14,z:0};
  M.items.drops=[{position:{x:22,y:14.65,z:0},userData:{drop:{kind:'coin'}}}];
  let rescued=false;
  for(let i=0;i<800;i++) {
    p.x=12+Math.sin(i*.05*2);
    const command=pilot.update(.05,p,{grounded:true},8.4);
    if(command.rescue) { rescued=true;break; }
  }
  assert.ok(rescued,'moving in circles without approaching the objective triggers recovery');
});

test('a coin on a lower floor is not considered collected from the ledge above', () => {
  const { M,world,pilot }=navigationFixture(),p={x:12,y:16,z:0};
  world.bodySupportHeight=x=>x<12.5?16:14;
  M.items.drops=[{position:{x:12.7,y:14.1,z:0},userData:{drop:{kind:'coin'}}}];
  const command=pilot.update(.25,p,{grounded:true},8.4);
  assert.equal(command.mode,'collect');
  assert.ok(command.waypoint && command.waypoint.y===14,'plans a descent into pickup range');
});

test('escapes a one-block shaft from the world bottom at 20, 60 and 144 Hz', () => {
  const { M,advance }=fixture(),p=M.goat.group.position;
  for(const [bx,bz,hz] of [[7,7,20],[-8,-8,60],[-10,5,144]]) {
    M.strategy.active=false;advance(.05);
    for(let by=1;by<=6;by++) assert.ok(M.world.breakBlockAt(bx,by,bz,{drop:false}), `shaft cell ${bx},${by},${bz}`);
    p.set(bx*2+1,2,bz*2+1);Object.assign(M.goat.state,{grounded:true,vy:0});
    M.strategy.active=true;
    let previous=p.clone(),maxStep=0,escape=false;
    for(let i=0;i<hz*16;i++) {
      advance(1/hz,1/hz);
      escape ||= M.goat.state.mode==='escape';
      maxStep=Math.max(maxStep,previous.distanceTo(p));previous.copy(p);
      if(p.y>=14 && M.goat.state.grounded && M.goat.state.mode!=='escape') break;
    }
    assert.ok(escape,'enters excavation at '+hz+' Hz');
    assert.ok(p.y>=14,'climbs from the deepest solid floor at '+hz+' Hz: '+p.toArray());
    assert.ok(maxStep<38/hz+.1,'no teleport at '+hz+' Hz');
    assert.ok(M.world.blockInfoAt(bx,0,bz),'does not mine out its own last supporting block');
  }
});

test('excavates out of a closed natural cave and then kills a Hearth attacker', () => {
  const { M,advance }=fixture(),p=M.goat.group.position;
  // Cut a buried pocket away from the starter cave entrance. Surrounding
  // original stone and its roof stay natural, so the goat must excavate.
  for(let bx=8;bx<=9;bx++) for(let bz=8;bz<=9;bz++) for(let by=1;by<=2;by++) {
    assert.ok(M.world.breakBlockAt(bx,by,bz,{drop:false}), `shaft cell ${bx},${by},${bz}`);
  }
  p.set(17,2,17);Object.assign(M.goat.state,{grounded:true,vy:0});
  const attacker=M.enemies.spawnAt({x:11,y:14,z:1});
  let cuts=0,maxStep=0,previous=p.clone();
  const original=M.world.breakBlockAt;
  M.world.breakBlockAt=(...args)=>{const result=original(...args);if(result)cuts++;return result;};
  for(let i=0;i<500;i++) {
    advance(.05,.05,true);maxStep=Math.max(maxStep,previous.distanceTo(p));previous.copy(p);
    if(!M.enemies.zombies.includes(attacker)) break;
  }
  assert.ok(cuts>0,'clears a real staircase through the stone ceiling');
  assert.ok(maxStep<2.1,'no rescue fallback');
  assert.ok(!M.enemies.zombies.includes(attacker),'leaves the cave and resumes Hearth combat');
  assert.ok(M.hearthTree.health>0,'Hearth survives while the goat escapes and returns');
});

test('leaving strategic view stops excavation immediately and preserves building blocks', () => {
  const { M,advance }=fixture(),p=M.goat.group.position;
  for(let by=1;by<=6;by++) M.world.breakBlockAt(7,by,7,{drop:false});
  p.set(15,2,15);Object.assign(M.goat.state,{grounded:true,vy:0});
  let cuts=0;const original=M.world.breakBlockAt;
  M.world.breakBlockAt=(...args)=>{const result=original(...args);if(result)cuts++;return result;};
  advance(.1);assert.ok(cuts>0);
  M.strategy.active=false;
  const count=cuts;advance(2);
  assert.equal(cuts,count,'no queued cuts after taking back control');
  const excavation=M.goatExcavation.create(M.world,M.goat.body);
  assert.equal(excavation.natural({bx:7,by:2,bz:7,type:'placed',placed:true}),false);
  assert.equal(excavation.natural({bx:7,by:2,bz:7,type:'gate',unbreakable:true}),false);
  assert.equal(excavation.natural({bx:0,by:2,bz:0,type:'terrain'}),false,'Hearth foundation is protected');
});

test('construction during excavation invalidates the cut and protects its foundation', () => {
  const { M }=fixture(),p=M.goat.group.position;
  for(let by=1;by<=6;by++) M.world.breakBlockAt(7,by,7,{drop:false});
  p.set(15,2,15);
  const excavation=M.goatExcavation.create(M.world,M.goat.body);
  assert.ok(excavation.begin(p));
  const command=excavation.update(.05,p,{grounded:true});
  assert.ok(command.dig);
  const b=command.dig;
  assert.ok(M.world.breakBlockAt(b.bx,b.by,b.bz,{drop:false}));
  assert.ok(M.world.placeBlock('stone',b.bx,b.by,b.bz));
  assert.equal(excavation.update(.5,p,{grounded:true}),null,'rechecks planned cuts against new construction');
  assert.ok(M.world.blockInfoAt(b.bx,b.by,b.bz).placed);
  assert.equal(excavation.natural(M.world.blockInfoAt(b.bx,b.by-1,b.bz)),false,'preserves natural support beneath a built block');
});

test('failed mining attempts cannot reset the recovery clock forever', () => {
  const { M,advance }=fixture(),p=M.goat.group.position;
  for(let by=1;by<=6;by++) M.world.breakBlockAt(7,by,7,{drop:false});
  p.set(15,2,15);Object.assign(M.goat.state,{grounded:true,vy:0});
  let attempts=0;M.world.breakBlockAt=()=>{attempts++;return null;};
  advance(15);
  assert.ok(attempts>0,'attempts actual mining before using the last-resort fallback');
  assert.ok(p.y>=14,'a failed cut does not cause an endless escape animation');
});

test('coins have no Hearth-distance leash and a long trip continues across route budgets', () => {
  const { M,pilot }=navigationFixture(),p={x:12,y:14,z:0};
  const coin={position:{x:2000,y:14.65,z:0},userData:{drop:{kind:'coin'}}};
  M.items.drops=[coin];
  for(let i=0;i<1200;i++) {
    const command=pilot.update(.25,p,{grounded:true},8.4);
    assert.equal(command.mode,'collect','distant loot remains a valid objective');
    assert.ok(!command.rescue);
    if(command.waypoint) Object.assign(p,command.waypoint);
    if(Math.hypot(p.x-coin.position.x,p.z-coin.position.z)<.8) break;
  }
  assert.ok(Math.hypot(p.x-coin.position.x,p.z-coin.position.z)<.8,'reaches loot far beyond the former 30-unit cap');
  M.items.drops=[];
  assert.equal(pilot.update(.25,p,{grounded:true},8.4).mode,'guard','returns toward the Hearth after the coin is collected');
});

test('strategic goat physically collects a real drop beyond the former coin radius', () => {
  const { M,advance }=fixture();
  const point={x:43,y:M.world.surfaceHeight(43,15),z:15};
  M.items.dropCoins(point,7);
  advance(15);
  assert.equal(M.enemies.getState().coins,7,'distant coin is credited through normal pickup');
});
