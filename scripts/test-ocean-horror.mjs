import assert from 'node:assert/strict';
import test from 'node:test';
import { classicModules } from './helpers/animal-game.mjs';

function terrain() {
  const h = classicModules();
  for (const file of ['js/voxel-water.js', 'js/caves.js', 'js/world.js']) h.load(file);
  return h;
}

test('deep ocean surrounds all four expanded edges and never generates another continent', () => {
  const { M } = terrain(), w = M.world, { boundary, shoreWidth, dangerBoundary } = M.config.ocean;
  for (const radius of [boundary, boundary + 2, dangerBoundary, 520, 1040, 10000, 1000000]) {
    for (const side of [-1, 1]) for (const tangent of [-radius, -112, 0, 112, radius]) {
      for (const [x, z] of [[side * radius, tangent], [tangent, side * radius]]) {
        assert.equal(w.terrainHeight(x, z), 2, `deep seabed at ${x},${z}`);
        const water = w.waterAt(x, 10, z);
        assert.equal(water?.type, 'sea', `ocean at ${x},${z}`);
        assert.ok(water.depth > 11);
        assert.equal(water.level, 13.45);
      }
    }
  }
  assert.equal(w.pondsNear(1040, 1040, 100).length, 0, 'no pond bowls or fish ponds offshore');
  assert.equal(w.waterDepthAt(8, 24), 0, 'starting meadow stays dry');
  assert.ok(w.waterDepthAt(-54, 6) > 3, 'starter pond survives');
  for (const side of [-1, 1]) {
    let last = Infinity;
    for (let z = boundary - shoreWidth; z <= boundary + 2; z += 2) {
      const floor = w.terrainHeight(0, side * z);
      assert.ok(floor <= last, 'terraced shore slopes down without an enclosing ridge'); last = floor;
    }
  }
});

function encounter({ reducedMotion = false } = {}) {
  const h = terrain(), { M, THREE, context } = h;
  let now = 0, reloads = 0;
  const listeners = {}, timers = [], sounds = [], calls = [];
  const elements = new Map();
  function element() {
    const classes = new Set();
    return { hidden: true, textContent: '', style: { setProperty() {} },
      classList: { add: value => classes.add(value), contains: value => classes.has(value) } };
  }
  for (const id of ['ocean-cinematic', 'ocean-warning', 'ocean-title', 'ocean-subtitle', 'ocean-eyebrow']) elements.set(id, element());
  context.document.getElementById = id => elements.get(id);
  context.document.body = element();
  context.performance = { now: () => now };
  context.window.addEventListener = (name, fn) => { listeners[name] = fn; };
  context.window.setTimeout = (fn, ms) => timers.push({ fn, ms });
  context.window.location = { reload: () => reloads++ };
  M.controls = { stopSteering: () => calls.push('stop'), suspendLook: () => calls.push('suspend') };
  M.audio = { oceanHorror: stage => sounds.push(stage) };
  M.config.reducedMotion = reducedMotion;
  const goat = { group: new THREE.Group(), state: { swimming: true } };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 16 / 9, .1, 400);
  scene.fog = new THREE.Fog(0xffffff, 30, 180);
  camera.position.set(340, 17, 7); goat.group.position.set(M.config.ocean.dangerBoundary + 1, 12.15, 0);
  h.load('js/ocean-horror.js');
  const horror = M.oceanHorror;
  horror.init({ scene, camera, goat, world: M.world });
  function advance(seconds, hz = 60) {
    for (let i = 0; i < Math.round(seconds * hz); i++) { now += 1000 / hz; horror.update(1 / hz); }
  }
  return { ...h, goat, scene, camera, horror, elements, listeners, timers, sounds, calls, advance,
    setTime: value => { now = value; }, get reloads() { return reloads; } };
}

test('only swimming past the expanded danger boundary on either axis starts Cthulhu, with an earlier offshore warning', () => {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const h = encounter(), { horror, goat } = h;
    const { boundary, dangerBoundary } = h.M.config.ocean;
    for (const extent of [boundary - 1, boundary, boundary + 15, dangerBoundary]) {
      goat.group.position.set(dx * extent, 12.15, dz * extent);
      assert.equal(horror.check(), false);
      assert.equal(h.elements.get('ocean-warning').hidden, extent < boundary);
    }
    goat.group.position.set(dx * (dangerBoundary + 1), 20, dz * (dangerBoundary + 1));
    assert.equal(horror.check(), false, 'flight above the ocean is not swimming');
    goat.group.position.y = 12.15; goat.state.swimming = false;
    assert.equal(horror.check(), false, 'a boat or bridge does not trigger');
    goat.state.swimming = true;
    assert.equal(horror.check(), true);
    assert.equal(h.elements.get('ocean-warning').hidden, true);
    assert.deepEqual(h.calls, ['stop', 'suspend']);
    assert.equal(h.scene.children.filter(node => node.name === 'Cthulhu').length, 1);
    horror.check();
    assert.equal(h.scene.children.filter(node => node.name === 'Cthulhu').length, 1, 'encounter starts once');
  }
  const h = encounter(); h.goat.group.position.set(h.M.config.ocean.boundary, 12.15, h.M.config.ocean.boundary);
  assert.equal(h.horror.check(), false, 'the threshold uses X/Z extent, not circular distance');
});

test('emergence animates a finite rig, grabs and kills the player before a five-second restart', () => {
  const h = encounter(), { horror, scene, goat } = h;
  assert.equal(horror.check(), true);
  const boss = scene.getObjectByName('Cthulhu'), initialY = boss.position.y;
  h.advance(3.8);
  assert.ok(boss.position.y > initialY + 25, 'creature rises out of the ocean');
  assert.equal(horror.dead, false); assert.equal(goat.state.dead, undefined);
  assert.deepEqual(h.sounds, ['rise', 'roar']);
  assert.equal(h.timers.length, 0, 'restart is not scheduled from the start of the cutscene');
  h.advance(1.8);
  assert.ok(goat.group.position.y > 14, 'tentacles lift the goat above the surface');
  scene.updateMatrixWorld(true);
  scene.traverse(node => assert.ok(node.matrixWorld.elements.every(Number.isFinite), node.name + ' has finite animated transforms'));
  assert.ok(h.camera.position.toArray().every(Number.isFinite));
  h.advance(.9);
  assert.equal(horror.dead, true); assert.equal(goat.state.dead, true); assert.equal(goat.group.visible, false);
  assert.deepEqual(h.sounds, ['rise', 'roar', 'grab', 'death']);
  assert.equal(h.timers.length, 1); assert.equal(h.timers[0].ms, 5000);
  assert.equal(h.reloads, 0);
  assert.ok(h.elements.get('ocean-cinematic').classList.contains('ocean-dead'));
  h.advance(4.8); assert.equal(h.reloads, 0, 'the entire five seconds elapse after death');
  h.advance(.3); assert.equal(h.reloads, 1);
  h.timers[0].fn(); assert.equal(h.reloads, 1, 'timer and frame fallback cannot restart twice');
});

test('cutscene blocks gameplay input and its restart survives a background tab', () => {
  const h = encounter({ reducedMotion: true });
  for (const callback of Object.values(h.listeners)) callback({ preventDefault() { assert.fail('normal play input remains available'); } });
  h.horror.check();
  for (const callback of Object.values(h.listeners)) {
    let prevented = false, stopped = false;
    callback({ preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
    assert.ok(prevented && stopped);
  }
  h.advance(6.5, 20);
  assert.equal(h.horror.dead, true);
  h.setTime(100000);
  // The browser timer executes even without another render frame.
  h.timers[0].fn(); assert.equal(h.reloads, 1);
});
