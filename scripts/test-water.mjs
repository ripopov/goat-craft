import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);

// Exercise the actual classic scripts and THREE math/rig without WebGL or any
// npm dependencies. Only DOM drawing and input dispatch are substituted.
function harness({ pointerLock = false } = {}) {
  const listeners = { window: {}, document: {}, canvas: {} };
  const listen = target => (type, fn) => (listeners[target][type] ||= []).push(fn);
  const drawing = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  const canvas = { getContext: () => drawing, addEventListener: listen('canvas'), classList: { add() {}, remove() {} } };
  const document = {
    createElement: () => canvas,
    getElementById: id => id === 'scene' ? canvas : null,
    addEventListener: listen('document'),
    body: { classList: { toggle() {} } }
  };
  const window = { matchMedia: () => ({ matches: false }), addEventListener: listen('window') };
  if (pointerLock) {
    canvas.requestPointerLock = () => {
      document.pointerLockElement = canvas;
      dispatch('document', 'pointerlockchange');
    };
    document.exitPointerLock = () => {
      document.pointerLockElement = null;
      dispatch('document', 'pointerlockchange');
    };
  }
  let now = 0;
  const context = vm.createContext({ window, document, console, performance: { now: () => now } });
  const load = name => vm.runInContext(readFileSync(new URL(name, root), 'utf8'), context, { filename: name });
  load('vendor/three.min.js');
  load('js/core.js');
  load('js/actor-physics.js');
  const M = window.Meadow;
  const THREE = context.THREE;
  M.config.renderRadius = 1;
  load('js/voxel-water.js');
  load('js/world.js');
  function dispatch(target, type, values = {}) {
    const event = { type, key: '', code: '', ctrlKey: false, preventDefault() { this.prevented = true; }, ...values };
    for (const listener of listeners[target][type] || []) listener(event);
    return event;
  }
  function setHidden(hidden) {
    document.hidden = hidden;
    dispatch('document', 'visibilitychange');
  }
  return { M, THREE, load, dispatch, setHidden, setTime: value => { now = value; } };
}

function swimmer({ floor = 0, level = 10, depth = 10, blocked = () => false } = {}) {
  const h = harness();
  const { M, THREE } = h;
  h.load('js/goat.js');
  const input = new THREE.Vector2();
  const controls = { running: false, swimVertical: 0, getMovement: () => input, getSwimPitch: () => 0, noteActivity() {} };
  const world = {
    blockSize: 2, surfaceHeight: () => floor, supportHeight: () => floor,
    waterInfoAtBlock: () => level ? { level, depth } : null,
    blockedAt: (x, z, low, high) => low < floor || blocked(x, z, low, high)
  };
  const sounds = [];
  const audio = new Proxy({}, { get: (_, name) => () => sounds.push(name) });
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(4, 6, 7);
  M.goat.init({ scene: new THREE.Scene(), camera, controls, world, audio, ui: { showBubble() {} } });
  const goat = M.goat;
  goat.group.position.set(0, level ? level - 1.3 : floor, 0);
  goat.state.manualHold = 100;
  let time = 0;
  function advance(seconds, hz = 60) {
    for (let i = 0; i < Math.ceil(seconds * hz); i++) goat.update(1 / hz, time += 1 / hz);
  }
  return { ...h, goat, controls, input, world, sounds, advance, camera };
}

test('water generation: dry clearing, nearby pond, connected rivers and seas', () => {
  const { M } = harness();
  const world = M.world;
  const spawn = M.config.startingArea.spawn;
  assert.equal(world.waterDepthAt(spawn.x, spawn.z), 0);
  assert.equal(world.waterDepthAt(-20, -4), 0, 'the old pond site is now flat meadow');
  assert.ok(world.waterDepthAt(-54, 6) > 3);
  assert.ok(world.waterDepthAt(300, 56) > 10);
  // Trace the continuous river through negative coordinates and into both seas.
  for (let bx = -170; bx <= 170; bx++) {
    const bz = 28 + Math.sin(bx * 0.028) * 10 + Math.sin(bx * 0.011) * 8;
    const info = world.waterInfoAtBlock(bx, Math.floor(bz));
    assert.ok(info, `river disconnected at ${bx},${bz}`);
    assert.ok(info.depth > 3);
    assert.equal(info.level, 13.45);
  }
  assert.equal(world.waterAt(300, 14, 56), null);
  assert.equal(world.waterAt(300, 1, 56), null);
  assert.equal(world.waterAt(300, 5, 56).type, 'sea');
});

test('water columns remain deterministic after cache eviction and terrain edits', () => {
  const { M, THREE } = harness();
  const world = M.world;
  const before = JSON.stringify(world.waterInfoAtBlock(-27, 3));
  for (let x = 0; x < 66000; x++) world.surfaceHeight(x * 2, 460);
  assert.equal(JSON.stringify(world.waterInfoAtBlock(-27, 3)), before);
  world.init(new THREE.Scene(), { capabilities: { getMaxAnisotropy: () => 1 } });
  world.update(new THREE.Vector3(-54, 10, 6), 0, 0);
  const pond = world.waterInfoAtBlock(-27, 3);
  assert.ok(world.breakBlockAt(-27, pond.top / 2 - 1, 3, { drop: false }));
  assert.equal(world.waterInfoAtBlock(-27, 3).depth, pond.depth, 'newly mined space fills on a fluid tick');
  for (let i = 0; i < 12; i++) world.fluid.tick();
  assert.equal(world.waterInfoAtBlock(-27, 3).depth, pond.depth + 2);
});

test('deep water floats and paddles instead of walking on the bed', () => {
  const { goat, advance, sounds } = swimmer();
  advance(4);
  assert.equal(goat.state.swimming, true);
  assert.equal(goat.state.grounded, false);
  assert.ok(Math.abs(goat.group.position.y - 8.7) < 0.02);
  assert.ok(goat.state.swimBlend > 0.99);
  assert.ok(goat.state.swimPhase > 10);
  assert.equal(goat.state.jumps, 0);
  assert.ok(!sounds.includes('step') && !sounds.includes('land'));
});

test('Ctrl dives, Space rises, the bed blocks diving, and swimming never consumes jumps', () => {
  const { goat, controls, advance } = swimmer();
  advance(0.5);
  controls.swimVertical = -1;
  advance(6);
  assert.equal(goat.state.submerged, true);
  assert.ok(goat.group.position.y >= 0 && goat.group.position.y < 0.02);
  goat.jump();
  assert.equal(goat.state.jumps, 0);
  controls.swimVertical = 1;
  advance(5);
  assert.ok(Math.abs(goat.group.position.y - 8.78) < 0.02);
  assert.equal(goat.state.grounded, false);
  controls.swimVertical = 0;
  advance(2);
  assert.ok(Math.abs(goat.group.position.y - 8.7) < 0.02);
});

test('mouse pitch steers forward swimming and a solid ceiling blocks rising', () => {
  const { goat, controls, input, advance } = swimmer({ blocked: (x, z, low, high) => low < 7 && high > 6 });
  goat.group.position.y = 3;
  controls.getSwimPitch = () => -0.8;
  input.set(0, 1);
  advance(0.5);
  assert.ok(goat.group.position.y < 2.5);
  controls.swimVertical = 1;
  advance(3);
  assert.ok(goat.group.position.y + 1.9 <= 6.001);
  assert.ok(goat.group.position.y > 3.8);
});

test('water entry damps a fall, shallow water wades, and dry land retains triple jumps', () => {
  const deep = swimmer();
  deep.goat.group.position.y = 8.5;
  deep.goat.state.grounded = false;
  deep.goat.state.vy = -25;
  deep.advance(3);
  assert.ok(deep.goat.group.position.y > 8.5);
  assert.equal(deep.goat.state.swimming, true);
  const shallow = swimmer({ floor: 9.2, depth: 0.8 });
  shallow.goat.group.position.y = 9.2;
  shallow.advance(0.3);
  assert.equal(shallow.goat.state.swimming, false);
  assert.equal(shallow.goat.state.grounded, true);
  shallow.goat.jump();
  assert.ok(shallow.goat.state.vy > 0, 'wading must not disable jumping');
  const dry = swimmer({ level: 0, depth: 0 });
  dry.goat.jump(); dry.goat.jump(); dry.goat.jump(); dry.goat.jump();
  assert.equal(dry.goat.state.jumps, 3);
});

test('a surface swimmer scrambles onto a river bank and resumes walking', () => {
  const s = swimmer();
  Object.assign(s.world, s.M.world);
  s.goat.group.position.set(0, 12.15, 46);
  s.goat.state.yaw = Math.PI;
  s.input.set(0, -1);
  s.controls.swimVertical = 1;
  s.advance(8);
  assert.ok(s.goat.group.position.z < 37, 'swimmer is stuck at the bank: ' + s.goat.group.position.toArray());
  assert.equal(s.goat.state.swimming, false);
  assert.ok(s.goat.group.position.y >= s.world.surfaceHeight(s.goat.group.position.x, s.goat.group.position.z));
});

test('swim buoyancy and travel are stable at 20, 60 and 144fps', () => {
  const positions = [20, 60, 144].map(hz => {
    const s = swimmer();
    s.controls.swimVertical = -1;
    s.advance(2, hz);
    return s.goat.group.position.y;
  });
  assert.ok(Math.max(...positions) - Math.min(...positions) < 0.15);
});

test('held Space/Ctrl, Ctrl+movement and blur/visibility reset work together', () => {
  const { M, THREE, load, dispatch, setHidden } = harness();
  load('js/controls.js');
  const camera = new THREE.PerspectiveCamera();
  M.controls.init(camera);
  let jumps = 0;
  M.controls.onJump = () => jumps++;
  dispatch('window', 'keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true });
  assert.equal(M.controls.swimVertical, -1);
  dispatch('window', 'keydown', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true });
  assert.equal(M.controls.running, true);
  const forward = dispatch('window', 'keydown', { key: 'w', code: 'KeyW', ctrlKey: true });
  assert.equal(forward.prevented, true);
  assert.ok(M.controls.getMovement(camera).lengthSq() > 0);
  dispatch('window', 'keydown', { key: ' ', code: 'Space', ctrlKey: true });
  assert.equal(M.controls.swimVertical, 0);
  dispatch('window', 'keydown', { key: ' ', code: 'Space', repeat: true, ctrlKey: true });
  assert.equal(jumps, 1);
  dispatch('window', 'keyup', { key: 'Control', code: 'ControlLeft' });
  assert.equal(M.controls.swimVertical, 1);
  dispatch('window', 'blur');
  assert.equal(M.controls.swimVertical, 0);
  assert.equal(M.controls.getMovement(camera).lengthSq(), 0);
  assert.equal(M.controls.running, false);
  dispatch('window', 'keydown', { key: ' ', code: 'Space' });
  setHidden(true);
  assert.equal(M.controls.swimVertical, 0);
});

test('the orbit camera follows a dive instead of being clamped to the waterline', () => {
  const { M, THREE, load } = harness();
  load('js/controls.js');
  const camera = new THREE.PerspectiveCamera();
  const goat = new THREE.Group();
  goat.position.set(0, 2, 0);
  M.controls.init(camera);
  M.controls.snapTo(goat.position);
  const world = { surfaceHeight: () => 0, waterLevelAt: () => 12, blockedAt: () => false };
  for (let i = 0; i < 180; i++) M.controls.update(1 / 60, i / 60, goat, { grounded: false, runBlend: 0 }, world);
  assert.ok(camera.position.y < 6);
  assert.ok(camera.position.y > 2);
});

test('the camera boom retracts before hitting solid river banks', () => {
  const { M, THREE, load } = harness();
  load('js/controls.js');
  const camera = new THREE.PerspectiveCamera();
  const goat = new THREE.Group();
  goat.position.set(0, 2, 0);
  M.controls.init(camera);
  M.controls.snapTo(goat.position);
  const world = { surfaceHeight: () => 0, blockedAt: x => x > 2 };
  M.controls.update(1 / 60, 0, goat, { grounded: false, runBlend: 0 }, world);
  assert.ok(camera.position.x < 2);
});

test('P toggles FPS once per press, preserves orbit zoom, and works with mouse capture', () => {
  const { M, THREE, load, dispatch } = harness({ pointerLock: true });
  load('js/controls.js');
  const camera = new THREE.PerspectiveCamera(42);
  const goat = new THREE.Group();
  const state = { grounded: true, runBlend: 0 };
  const world = { surfaceHeight: () => 0, blockedAt: () => false };
  M.controls.init(camera);
  M.controls.snapTo(goat.position);
  dispatch('canvas', 'wheel', { deltaY: 200 });
  for (let i = 0; i < 180; i++) M.controls.update(1 / 60, 0, goat, state, world);
  const orbitPosition = camera.position.clone();

  dispatch('window', 'keydown', { key: 'f', code: 'KeyF' });
  assert.equal(M.controls.lookActive, true);
  // Physical key codes work even with a non-Latin keyboard layout.
  const press = dispatch('window', 'keydown', { key: 'з', code: 'KeyP' });
  assert.equal(press.prevented, true);
  assert.equal(M.controls.firstPerson, true);
  dispatch('window', 'keydown', { key: 'p', code: 'KeyP', repeat: true });
  assert.equal(M.controls.firstPerson, true);
  M.controls.update(1 / 60, 0, goat, state, world);
  assert.equal(goat.visible, false);
  assert.equal(camera.fov, 70);
  assert.equal(M.controls.lookActive, true);
  dispatch('canvas', 'wheel', { deltaY: -500 });

  dispatch('window', 'keydown', { key: 'P', code: 'KeyP' });
  M.controls.update(1 / 60, 0, goat, state, world);
  assert.equal(M.controls.firstPerson, false);
  assert.equal(goat.visible, true);
  assert.equal(camera.fov, 42);
  assert.ok(camera.position.distanceTo(orbitPosition) < 1e-8);
  assert.equal(M.controls.lookActive, true);
  dispatch('window', 'keydown', { key: 'Escape', code: 'Escape' });
  assert.equal(M.controls.lookActive, false);
  dispatch('window', 'keydown', { key: 'p', code: 'KeyP', ctrlKey: true });
  assert.equal(M.controls.firstPerson, false, 'leave browser shortcuts alone');
});

test('FPS follows jumps and dives directly, supports looking up, and stays still when idle', () => {
  const { M, THREE, load, dispatch, setTime } = harness();
  load('js/controls.js');
  const camera = new THREE.PerspectiveCamera();
  const goat = new THREE.Group();
  const state = { grounded: false, runBlend: 0 };
  const world = { surfaceHeight: () => 0, blockedAt: () => true };
  M.controls.init(camera);
  dispatch('window', 'keydown', { key: 'p', code: 'KeyP' });
  for (const position of [[10, 20, -5], [-3, 2, 8]]) {
    goat.position.set(...position);
    M.controls.update(1 / 60, 0, goat, state, world);
    assert.equal(camera.position.x, goat.position.x);
    assert.equal(camera.position.z, goat.position.z);
    assert.equal(camera.position.y, goat.position.y + 1.75);
  }
  const direction = camera.getWorldDirection(new THREE.Vector3());
  setTime(60000);
  M.controls.update(1, 60, goat, state, world);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction) < 1e-8);

  dispatch('canvas', 'pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
  dispatch('canvas', 'pointermove', { pointerId: 1, clientX: 80, clientY: -200 });
  dispatch('canvas', 'pointerup', { pointerId: 1 });
  for (let i = 0; i < 60; i++) M.controls.update(1 / 60, 60, goat, state, world);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).y > 0.5);
  dispatch('window', 'keydown', { key: 'w', code: 'KeyW' });
  assert.ok(M.controls.getSwimPitch(camera) > 0.5);
});

test('FPS strafes and backs up without turning away from the view or wandering while idle', () => {
  const { goat, controls, input, advance } = swimmer({ level: 0, depth: 0 });
  controls.firstPerson = true;
  controls.getFacingYaw = () => Math.PI / 2;
  input.set(0, -1);
  advance(1);
  assert.ok(goat.group.position.z < -1);
  assert.equal(goat.group.position.x, 0);
  assert.equal(goat.state.yaw, Math.PI / 2);
  const z = goat.group.position.z;
  input.set(1, 0);
  advance(1);
  assert.ok(goat.group.position.x > 1);
  assert.equal(goat.group.position.z, z);
  const position = goat.group.position.clone();
  input.set(0, 0);
  advance(12);
  assert.ok(goat.group.position.distanceTo(position) < 1e-8);
});

test('underwater feedback uses a fixed particle pool and restores daylight fog', () => {
  const { M, THREE, load } = harness();
  load('js/water.js');
  M.audio = { splash() {} };
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 60, 145);
  M.water.init(scene);
  const goat = new THREE.Group();
  goat.position.y = 3;
  const camera = new THREE.PerspectiveCamera();
  camera.position.y = 5;
  const state = { speed: 3, vy: 0, submerged: true, yaw: 0, swimming: true };
  const info = { level: 10, depth: 10 };
  const world = { blockSize: 2, waterInfoAtBlock: () => info, waterAt: (x, y) => y < 10 ? info : null };
  function frame(t) {
    // The solar environment resets these before water feedback every frame.
    scene.fog.color.set(0xffffff);
    scene.fog.near = 60;
    scene.fog.far = 145;
    M.water.update(1 / 60, t, goat, state, camera, world);
  }
  for (let i = 0; i < 1200; i++) frame(i / 60);
  assert.equal(scene.children.length, 48);
  assert.ok(scene.fog.far < 26);
  camera.position.y = 14;
  for (let i = 0; i < 180; i++) frame(20 + i / 60);
  assert.ok(scene.fog.far > 144.9);
  assert.ok(scene.fog.color.r > 0.99);
});

test('a real pond leaks through a mined bank and a rebuilt wall drains the channel', () => {
  const { M, THREE } = harness();
  const w = M.world, player = new THREE.Vector3(-54, 14, 6);
  w.init(new THREE.Scene(), { capabilities: { getMaxAnisotropy: () => 1 } });
  w.update(player, 0, 0);
  for (let x = -27; x <= -14; x++) for (let y = 5; y <= 6; y++) w.breakBlockAt(x, y, 3, { drop: false });
  for (let i = 0; i < 150 && w.fluid.pending; i++) w.fluid.tick();
  assert.ok(w.waterAt(-29, 10.1, 7), 'pond water must reach the channel outside its generated basin');
  for (let y = 5; y <= 6; y++) assert.ok(w.placeBlock('stone', -18, y, 3));
  assert.equal(w.waterAt(-35, 10.1, 7), null, 'placed walls immediately displace water');
  for (let i = 0; i < 150 && w.fluid.pending; i++) w.fluid.tick();
  assert.equal(w.waterAt(-29, 10.1, 7), null, 'a sealed channel drains');
  assert.ok(w.waterDepthAt(-54, 6) > 3, 'the natural pond remains a renewable source');
});

test('mined tunnels have exact floors and ceilings, and stomping breaks the floor underfoot', () => {
  const { M, THREE } = harness();
  const w = M.world;
  w.init(new THREE.Scene(), { capabilities: { getMaxAnisotropy: () => 1 } });
  assert.ok(w.breakBlockAt(9, 4, 0, { drop: false }));
  assert.ok(w.breakBlockAt(9, 5, 0, { drop: false }));
  assert.equal(w.blockedAt(19, 1, 8.06, 11.99), false);
  assert.equal(w.blockedAt(19, 1, 11, 12.1), true);
  assert.equal(w.supportHeight(19, 1, 10), 8, 'a roof above the feet is never a floor');
  assert.ok(w.breakBlockBelow(19, 1, 8));
  assert.ok(w.blockInfoAt(9, 6, 0), 'the roof must survive the stomp');
  assert.equal(w.supportHeight(19, 1, 8), 6);
});

test('dry jumps hit ceilings, fast falls land on block edges, and wall slides stay clear', () => {
  const s = swimmer({ level: 0, depth: 0, blocked: (x, z, low, high) => high > 3 && low < 5 });
  s.goat.jump(); s.advance(0.2, 20);
  assert.ok(s.goat.group.position.y + 1.9 <= 3.001, 'jump must stop below the ceiling');
  s.advance(1); assert.equal(s.goat.state.grounded, true);
  const edge = swimmer({ level: 0, depth: 0 });
  edge.world.supportHeight = x => x > .1 ? 2 : 0;
  edge.world.blockedAt = (x, z, low) => x > .1 && low < 2;
  edge.goat.group.position.y = 10; edge.goat.state.grounded = false; edge.goat.state.vy = -35;
  edge.advance(1, 20);
  assert.ok(Math.abs(edge.goat.group.position.y - 2) < .001, 'a trailing hoof must catch the edge');
  const slide = swimmer({ level: 0, depth: 0, blocked: x => x > 1 });
  slide.controls.firstPerson = true; slide.controls.getFacingYaw = () => 0;
  slide.input.set(1, 1).normalize(); slide.advance(2, 20);
  assert.ok(slide.goat.group.position.z > 3);
  assert.ok(slide.goat.group.position.x + slide.goat.body.radius <= 1.001);
});

test('turning against a wall cannot bury the muzzle or lock movement', () => {
  const s = swimmer({ level: 0, depth: 0, blocked: x => x > .7 });
  s.controls.firstPerson = true; s.controls.getFacingYaw = () => Math.PI / 2;
  s.advance(.1);
  assert.equal(s.goat.state.yaw, Math.PI / 2, 'turning must remain free beside a wall');
  assert.equal(s.goat.group.position.lengthSq(), 0);
  s.input.set(-1, 0); s.advance(1);
  assert.ok(s.goat.group.position.x < -1);
  assert.equal(s.goat.state.yaw, Math.PI / 2, 'the view-facing pose resumes once there is room');
});

test('player movement and camera can remain inside a mined tunnel', () => {
  const s = swimmer({ level: 0, depth: 0 });
  Object.assign(s.world, s.M.world);
  s.world.init(new s.THREE.Scene(), { capabilities: { getMaxAnisotropy: () => 1 } });
  for (let x = 8; x <= 13; x++) for (let y = 4; y <= 5; y++) s.world.breakBlockAt(x, y, 0, { drop: false });
  s.goat.group.position.set(19, 8, 1); s.goat.state.yaw = Math.PI / 2;
  s.controls.firstPerson = true; s.controls.getFacingYaw = () => Math.PI / 2;
  s.input.set(1, 0); s.advance(1);
  assert.ok(s.goat.group.position.x > 22);
  assert.equal(s.goat.group.position.y, 8);
  assert.equal(s.world.canPlaceBlock(Math.floor(s.goat.group.position.x / 2), 4, 0), false, 'placement cannot overlap the player');
  s.load('js/controls.js'); s.M.controls.init(s.camera); s.M.controls.snapTo(s.goat.group.position);
  for (let i = 0; i < 90; i++) s.M.controls.update(1 / 60, i / 60, s.goat.group, s.goat.state, s.world);
  assert.ok(s.camera.position.y < 12, 'the underground camera must not snap to the surface');
});

test('landed block drops fall again when their supporting block is mined', () => {
  const { M, THREE, load } = harness();
  const scene = new THREE.Scene();
  M.world.init(scene, { capabilities: { getMaxAnisotropy: () => 1 } });
  load('js/items.js'); M.items.init(scene);
  assert.ok(M.world.placeBlock('stone', 10, 7, 0));
  M.items.dropBlock('dirt', 21, 17, 1);
  const distantGoat = new THREE.Group(); distantGoat.position.set(100, 14, 100);
  for (let i = 0; i < 120; i++) M.items.update(1 / 60, i / 60, distantGoat);
  assert.ok(Math.abs(M.items.drops[0].userData.drop.baseY - 16.24) < .001);
  M.world.breakBlockAt(10, 7, 0, { drop: false });
  for (let i = 0; i < 120; i++) M.items.update(1 / 60, 2 + i / 60, distantGoat);
  assert.ok(Math.abs(M.items.drops[0].userData.drop.baseY - 14.24) < .001);
});

test('a wall corner blocks pickup attraction until the wall is removed', () => {
  const { M, THREE, load } = harness();
  const scene = new THREE.Scene();
  M.world.init(scene, { capabilities: { getMaxAnisotropy: () => 1 } });
  load('js/items.js'); M.items.init(scene);
  M.world.placeBlock('stone', 10, 7, 0);
  M.items.dropBlock('dirt', 19.8, 15, 1.5);
  M.items.drops[0].position.set(19.8, 15, 1.5);
  M.items.drops[0].userData.drop.vy = 0;
  const goat = new THREE.Group(); goat.position.set(20.5, 14.1, 2.2);
  for (let i = 0; i < 30; i++) M.items.update(1 / 60, i / 60, goat);
  assert.equal(M.items.slots[1], null, 'items cannot be pulled through a solid corner');
  assert.equal(M.items.drops.length, 1);
  M.world.breakBlockAt(10, 7, 0, { drop: false });
  for (let i = 0; i < 60; i++) M.items.update(1 / 60, 1 + i / 60, goat);
  assert.equal(M.items.slots[1].kind, 'dirt');
});

test('adjacent placed blocks mesh only exposed faces while collision updates immediately', () => {
  const { M, THREE } = harness();
  const scene = new THREE.Scene(), w = M.world;
  w.init(scene, { capabilities: { getMaxAnisotropy: () => 1 } });
  const worldGroup = scene.children.find(group => group.children.some(chunk => chunk.position.x === 0 && chunk.position.z === -32));
  const chunk = worldGroup.children.find(chunk => chunk.position.x === 0 && chunk.position.z === -32);
  const vertices = () => chunk.children.filter(mesh => mesh.castShadow).reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
  const before = vertices();
  for (let x = 8; x < 11; x++) for (let z = -3; z < 0; z++) for (let y = 7; y < 10; y++) assert.ok(w.placeBlock('stone', x, y, z));
  assert.equal(w.blockedAt(19, -3, 14.1, 19.9), true, 'physics must not wait for the next mesh batch');
  w.update(new THREE.Vector3(8, 14, 24), 0, 0);
  assert.equal(vertices() - before, 180, 'a grounded 3×3×3 cube needs 45 exposed quads');
});

test('third-person steering can walk away from a two-block inside corner without jumping', () => {
  const blocked = (x, z, low, high) => high > 0 && low < 2 &&
    ((x >= 2 && x < 4 && z >= 0 && z < 2) || (z >= 2 && z < 4 && x >= 0 && x < 2));
  const s = swimmer({ level: 0, depth: 0, blocked });
  s.goat.group.position.set(1, 0, 1); s.goat.state.yaw = Math.PI / 4;
  s.input.set(-1, 0); s.advance(1.5);
  assert.ok(s.goat.group.position.x < -2, 'steering away must not keep moving toward the rejected facing angle: ' + s.goat.group.position.toArray());
  assert.equal(s.goat.group.position.y, 0);
  assert.equal(s.goat.state.jumps, 0);
});
