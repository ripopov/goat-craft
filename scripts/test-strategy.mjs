import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Run the actual input, RTS camera and goat controller together. The DOM and
// flat terrain are fixtures; camera math, input capture and wandering are real.
function commandGame() {
  const listeners = new Map(), elements = new Map();
  const drawing = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  function listen(target, type, fn, options) {
    const key = target + ':' + type;
    if (!listeners.has(key)) listeners.set(key, []);
    listeners.get(key).push({ fn, capture: options === true || !!options?.capture });
  }
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const node = { hidden: false, innerHTML: '', textContent: '', attrs: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(child) { this.children.push(child); },
      querySelector: selector => element(id + selector),
      addEventListener: (type, fn, options) => listen(id, type, fn, options),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
      getContext: () => drawing,
      setPointerCapture() {}, blur() {}
    };
    elements.set(id, node); return node;
  }
  const document = { getElementById: element, createElement: () => element('created-' + elements.size),
    addEventListener: (type, fn, options) => listen('document', type, fn, options), body: element('body') };
  const window = { matchMedia: () => ({ matches: false }), addEventListener: (type, fn, options) => listen('window', type, fn, options) };
  function dispatch(target, type, values = {}) {
    const event = { type, key: '', code: '', ctrlKey: false, repeat: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
    for (const { fn } of (listeners.get(target + ':' + type) || []).slice().sort((a, b) => Number(b.capture) - Number(a.capture))) {
      fn(event); if (event.stopped) break;
    }
    return event;
  }
  element('scene').requestPointerLock = () => { document.pointerLockElement = element('scene'); dispatch('document', 'pointerlockchange'); };
  document.exitPointerLock = () => { document.pointerLockElement = null; dispatch('document', 'pointerlockchange'); };
  const context = vm.createContext({ window, document, console, performance: { now: () => 0 } });
  const load = file => vm.runInContext(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context);
  for (const file of ['vendor/three.min.js', 'js/core.js', 'js/actor-physics.js', 'js/controls.js', 'js/goat.js', 'js/towers.js', 'js/strategy.js']) load(file);
  const M = window.Meadow, THREE = context.THREE, scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1280 / 720, .1, 400);
  M.world = { blockSize: 2, surfaceHeight: () => 14, landingHeight: () => 14, waterInfoAtBlock: () => null,
    blockedAt: (x, z, low) => low < 14, blockInfoAt: () => null };
  M.items = { count: () => 0 }; M.targeting = { trace: () => null };
  M.upgrades = { canAfford: () => false, stats: () => ({ move: 1, rate: 1, reach: 0, damage: 0 }) };
  M.upgradeMenu = { isOpen: false, close() { this.isOpen = false; } };
  M.enemies = { getState: () => ({ coins: 8 }), zombies: [] };
  M.hearthTree = { position: new THREE.Vector3(0, 14, 0), health: 100 };
  M.controls.init(camera);
  M.goat.init({ scene, camera, controls: M.controls, world: M.world, audio: new Proxy({}, { get: () => () => {} }), ui: { showBubble() {} } });
  M.towers.init(scene); M.strategy.init(scene, camera); M.controls.snapTo(M.goat.group.position);
  const press = (key, code) => dispatch('window', 'keydown', { key, code: code || key });
  function advance(seconds) {
    for (let i = 0; i < seconds * 60; i++) {
      M.goat.update(1 / 60, i / 60); M.controls.update(1 / 60, i / 60, M.goat.group, M.goat.state, M.world); M.strategy.update(1 / 60);
    }
  }
  return { M, camera, press, dispatch, element, advance, document };
}

test('T releases captured FPS, hands the goat to AI, pans independently and restores the prior view', () => {
  const { M, camera, press, advance, document } = commandGame();
  press('p', 'KeyP'); assert.equal(M.controls.firstPerson, true);
  M.controls.requestLook(); assert.ok(document.pointerLockElement);
  press('w', 'KeyW'); assert.ok(M.controls.getMovement(camera).lengthSq() > 0);
  press('t', 'KeyT'); assert.equal(M.strategy.active, true); assert.equal(M.controls.firstPerson, false);
  assert.equal(document.pointerLockElement, null); assert.equal(camera.fov, 48);
  const goat = M.goat.group.position.clone(), focus = M.strategy.focus.clone();
  press('d', 'KeyD'); advance(1.5);
  assert.equal(M.controls.getMovement(camera).lengthSq(), 0);
  assert.ok(M.strategy.focus.x > focus.x + 10, 'D pans the command camera');
  assert.ok(M.goat.group.position.distanceTo(goat) > .25, 'real autonomous goat wanders while commanding');
  assert.equal(M.goat.group.visible, true);
  press('t', 'KeyT'); assert.equal(M.strategy.active, false); assert.equal(M.controls.firstPerson, true);
  assert.equal(camera.fov, 70); assert.equal(M.controls.getMovement(camera).lengthSq(), 0);
  advance(.1); assert.equal(M.goat.group.visible, false);
});

test('RTS keys select towers instead of inventory/actions, Tab remains accessible, Esc cancels before leaving', () => {
  const { M, press, dispatch } = commandGame();
  let slots = 0, attacks = 0, jumps = 0;
  M.controls.onSelectSlot = () => slots++; M.controls.onHeadbutt = () => attacks++; M.controls.onJump = () => jumps++;
  press('t', 'KeyT'); press('0', 'Digit0'); assert.equal(M.strategy.selected, 'sun');
  press('e', 'KeyE'); press(' ', 'Space'); assert.equal(slots + attacks + jumps, 0);
  dispatch('window', 'keydown', { key: ' ', code: 'Space', ctrlKey: true });
  assert.equal(jumps, 0, 'Ctrl+Space cannot jump the goat from the command camera');
  const tab = press('Tab', 'Tab'); assert.equal(tab.prevented, undefined);
  press('Escape', 'Escape'); assert.equal(M.strategy.active, true); assert.equal(M.strategy.selected, null);
  press('Escape', 'Escape'); assert.equal(M.strategy.active, false);
  assert.equal(dispatch('window', 'keydown', { key: 't', code: 'KeyT', repeat: true }).prevented, true);
  assert.equal(M.strategy.active, false, 'key repeat does not switch views');
});

test('command wheel changes zoom, blur stops camera drift, and the HUD button switches without resetting third person', () => {
  const { M, camera, press, dispatch, advance } = commandGame();
  dispatch('strategy-toggle', 'click'); advance(.1);
  const high = camera.position.y;
  dispatch('scene', 'wheel', { deltaY: -400 }); advance(.1);
  assert.ok(camera.position.y < high - 10);
  press('a', 'KeyA'); dispatch('window', 'blur'); const before = M.strategy.focus.x;
  advance(.2); assert.equal(M.strategy.focus.x, before);
  dispatch('strategy-toggle', 'click'); assert.equal(M.strategy.active, false); assert.equal(M.controls.firstPerson, false);
  assert.equal(camera.fov, 42);
});
