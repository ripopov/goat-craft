import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Run the actual input, RTS camera and goat controller together. The DOM and
// flat terrain are fixtures; camera math, input capture and wandering are real.
function commandGame({ coarsePointer = false, deferredLock = false } = {}) {
  const listeners = new Map(), elements = new Map();
  const lockEvents = [];
  let focused = true, lockRequests = 0, rejectLock = false;
  const drawing = new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  function listen(target, type, fn, options) {
    const key = target + ':' + type;
    if (!listeners.has(key)) listeners.set(key, []);
    listeners.get(key).push({ fn, capture: options === true || !!options?.capture });
  }
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const node = { hidden: false, open: false, innerHTML: '', textContent: '', attrs: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(child) { this.children.push(child); },
      querySelector: selector => element(id + selector),
      replaceChildren() { this.children = []; },
      focus() { document.activeElement = this; },
      showModal() { this.open = true; },
      close() { this.open = false; lockEvents.push(() => dispatch(id, 'close')); },
      addEventListener: (type, fn, options) => listen(id, type, fn, options),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
      getContext: () => drawing,
      setPointerCapture() {}, blur() {}
    };
    elements.set(id, node); return node;
  }
  const document = { getElementById: element, createElement: () => element('created-' + elements.size),
    hasFocus: () => focused, hidden: false,
    addEventListener: (type, fn, options) => listen('document', type, fn, options), body: element('body') };
  const window = { matchMedia: query => ({ matches: coarsePointer && query.includes('pointer') }), addEventListener: (type, fn, options) => listen('window', type, fn, options) };
  function dispatch(target, type, values = {}) {
    const event = { type, key: '', code: '', ctrlKey: false, repeat: false,
      preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; }, ...values };
    for (const { fn } of (listeners.get(target + ':' + type) || []).slice().sort((a, b) => Number(b.capture) - Number(a.capture))) {
      fn(event); if (event.stopped) break;
    }
    return event;
  }
  function lockChange(fn) { if (deferredLock) lockEvents.push(fn); else fn(); }
  element('scene').requestPointerLock = () => {
    lockRequests++;
    if (rejectLock) {
      lockChange(() => dispatch('document', 'pointerlockerror'));
      return Promise.reject(new Error('Activation required'));
    }
    lockChange(() => { document.pointerLockElement = element('scene'); dispatch('document', 'pointerlockchange'); });
  };
  document.exitPointerLock = () => { document.pointerLockElement = null; lockChange(() => dispatch('document', 'pointerlockchange')); };
  const context = vm.createContext({ window, document, console, performance: { now: () => 0 } });
  const load = file => vm.runInContext(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), context);
  for (const file of ['vendor/three.min.js', 'js/core.js', 'js/actor-physics.js', 'js/controls.js', 'js/animal-style.js', 'js/goat.js', 'js/towers.js', 'js/strategy.js']) load(file);
  const M = window.Meadow, THREE = context.THREE, scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1280 / 720, .1, 400);
  M.world = { blockSize: 2, surfaceHeight: () => 14, landingHeight: () => 14, waterInfoAtBlock: () => null,
    blockedAt: (x, z, low) => low < 14, blockInfoAt: () => null };
  M.items = { count: () => 0 }; M.targeting = { trace: () => null };
  M.upgrades = { player: {}, nearest: () => null, keys: () => [], canAfford: () => false, stats: () => ({ move: 1, rate: 1, reach: 0, damage: 0 }) };
  load('js/upgrade-menu.js'); M.upgradeMenu.init();
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
  return { M, camera, press, dispatch, element, advance, document,
    flush() { while (lockEvents.length) lockEvents.shift()(); },
    setFocused(value) { focused = value; dispatch('window', value ? 'focus' : 'blur'); },
    setRejectLock(value) { rejectLock = value; },
    get lockRequests() { return lockRequests; }
  };
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
  assert.ok(document.pointerLockElement, 'returning from strategic view restores capture');
  assert.equal(camera.fov, 70); assert.equal(M.controls.getMovement(camera).lengthSq(), 0);
  advance(.1); assert.equal(M.goat.group.visible, false);
});

test('upgrades restore capture on Q, Esc, close button, backdrop and native dialog close', () => {
  const { M, press, dispatch, element, document, flush } = commandGame();
  press('f', 'KeyF');
  const exits = [
    () => press('q', 'KeyQ'),
    () => press('Escape', 'Escape'),
    () => dispatch('upgrade-close', 'click'),
    () => dispatch('upgrade-menu', 'click', { target: element('upgrade-menu'), clientX: -1, clientY: -1 }),
    () => dispatch('upgrade-menu', 'cancel'),
    () => element('upgrade-menu').close()
  ];
  for (const exit of exits) {
    press('q', 'KeyQ'); assert.equal(M.upgradeMenu.isOpen, true);
    assert.equal(document.pointerLockElement, null);
    exit(); flush();
    assert.equal(M.upgradeMenu.isOpen, false);
    assert.equal(document.pointerLockElement, element('scene'));
  }
});

test('nested training and strategy keep the pointer free until returning to the goat', () => {
  const { M, press, dispatch, document, element, flush } = commandGame();
  press('f', 'KeyF'); press('t', 'KeyT'); press('q', 'KeyQ');
  press('Escape', 'Escape'); flush();
  assert.equal(M.strategy.active, true); assert.equal(document.pointerLockElement, null);
  press('Escape', 'Escape'); assert.equal(document.pointerLockElement, element('scene'));
  press('q', 'KeyQ'); press('t', 'KeyT'); flush();
  assert.equal(M.upgradeMenu.isOpen, false); assert.equal(document.pointerLockElement, null);
  dispatch('strategy-toggle', 'click'); assert.equal(document.pointerLockElement, element('scene'));
});

test('uncaptured players and touch controls remain free after menus and strategic view', () => {
  for (const coarsePointer of [false, true]) {
    const game = commandGame({ coarsePointer }), { M, press, dispatch, flush } = game;
    if (coarsePointer) press('f', 'KeyF');
    press('q', 'KeyQ'); press('q', 'KeyQ'); flush();
    press('t', 'KeyT'); press('t', 'KeyT');
    dispatch('document', 'click'); dispatch('window', 'keyup');
    assert.equal(game.lockRequests, 0); assert.equal(M.controls.lookActive, false);
  }
});

test('Esc and F explicitly disable recapture, including browser-consumed Esc', () => {
  for (const exit of ['escape', 'native-escape', 'f', 'button', 'suspended-f']) {
    const game = commandGame(), { M, press, dispatch, document, element, flush } = game;
    press('f', 'KeyF');
    if (exit === 'escape') press('Escape', 'Escape');
    else if (exit === 'native-escape') {
      document.pointerLockElement = null; dispatch('document', 'pointerlockchange');
    } else if (exit === 'button') dispatch('look', 'click');
    else {
      if (exit === 'suspended-f') press('t', 'KeyT');
      press('f', 'KeyF');
      if (M.strategy.active) press('t', 'KeyT');
    }
    press('q', 'KeyQ'); press('q', 'KeyQ'); flush();
    press('t', 'KeyT'); press('t', 'KeyT');
    game.setFocused(false); game.setFocused(true);
    dispatch('document', 'click'); dispatch('window', 'keyup');
    assert.equal(document.pointerLockElement, null, exit);
    assert.equal(game.lockRequests, 1, 'no recapture after ' + exit);
    dispatch('look', 'click'); assert.equal(document.pointerLockElement, element('scene'));
  }
});

test('focus and visibility losses preserve capture preference and retry denied requests on interaction', async () => {
  const game = commandGame(), { M, press, document, dispatch, element } = game;
  press('f', 'KeyF'); press('w', 'KeyW');
  game.setFocused(false);
  document.pointerLockElement = null; dispatch('document', 'pointerlockchange');
  game.setRejectLock(true); game.setFocused(true);
  await Promise.resolve();
  assert.equal(document.pointerLockElement, null);
  game.setRejectLock(false); dispatch('document', 'click');
  assert.equal(document.pointerLockElement, element('scene'));
  document.hidden = true; dispatch('document', 'visibilitychange');
  document.pointerLockElement = null; dispatch('document', 'pointerlockchange');
  document.hidden = false; dispatch('document', 'visibilitychange');
  assert.equal(document.pointerLockElement, element('scene'));
  assert.equal(M.controls.getMovement(game.camera).lengthSq(), 0, 'returning never leaves movement held');
});

test('asynchronous lock changes handle fast menu transitions and cancelled pending requests', () => {
  const game = commandGame({ deferredLock: true }), { M, press, document, flush, element } = game;
  press('f', 'KeyF'); press('q', 'KeyQ'); flush();
  assert.equal(document.pointerLockElement, null, 'late capture cannot trap the pointer in training');
  press('q', 'KeyQ'); flush(); assert.equal(document.pointerLockElement, element('scene'));
  press('q', 'KeyQ'); press('q', 'KeyQ'); flush();
  assert.equal(document.pointerLockElement, element('scene'), 'closing before unlock notification still restores');
  M.controls.releaseLook(); flush();
  press('f', 'KeyF'); press('f', 'KeyF'); flush();
  assert.equal(document.pointerLockElement, null, 'F cancels an in-flight capture');
  press('f', 'KeyF'); press('Escape', 'Escape'); flush();
  assert.equal(document.pointerLockElement, null, 'Esc cancels an in-flight capture');
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
