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
    const node = { id, hidden: false, open: false, innerHTML: '', textContent: '', attrs: {}, dataset: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, appendChild(child) { this.children.push(child); },
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
  M.animals = { list: [
    { name: 'Mallow', species: 'sheep', role: 'builder' },
    { name: 'Clover', species: 'cow', role: 'builder' },
    { name: 'Bramble', species: 'stag', role: 'hunter' },
    { name: 'Poppy', species: 'sheep', role: 'hunter' }
  ].map(animal => ({ ...animal, group: new THREE.Group() })) };
  M.animals.list.forEach(animal => animal.group.position.set(100, 14, 100));
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
  return { M, camera, scene, press, dispatch, element, advance, document, load,
    flush() { while (lockEvents.length) lockEvents.shift()(); },
    setFocused(value) { focused = value; dispatch('window', value ? 'focus' : 'blur'); },
    setRejectLock(value) { rejectLock = value; },
    get lockRequests() { return lockRequests; }
  };
}

test('right mouse press and R immediately slam in orbit and captured modes, including mouse-button chords', () => {
  const { M, press, dispatch, advance } = commandGame();
  let actions = 0, impacts = 0;
  M.controls.onStomp = () => { actions++; M.goat.kick(); };
  M.enemies.attack = () => { impacts++; return true; };
  M.goat.state.manualHold = 100;
  for (const captured of [false,true]) {
    if (captured) press('f','KeyF');
    assert.equal(M.controls.lookActive,captured);
    M.goat.jump(); advance(.15);
    // With the primary button held, browsers send mouse-down for the second
    // button but no new pointer-down. Orbit/mouse-look motion must not cancel it.
    dispatch('scene','pointerdown',{pointerId:1,button:0,clientX:400,clientY:300});
    if (captured) dispatch('document','mousemove',{movementX:30,movementY:20});
    else dispatch('scene','pointermove',{pointerId:1,clientX:450,clientY:350});
    const before = actions, hits = impacts;
    const down = dispatch('scene','mousedown',{button:2,buttons:3});
    assert.equal(down.prevented,true);
    assert.equal(actions,before+1);
    assert.equal(M.goat.state.aerialStomp,true, 'slam starts before releasing the button');
    advance(.6);
    assert.equal(impacts,hits+1);
    dispatch('scene','pointerup',{pointerId:1,button:2,buttons:1});
    dispatch('scene','mouseup',{button:2,buttons:1});
    assert.equal(actions,before+1, 'release cannot cause a second action after landing');
    dispatch('scene','pointerup',{pointerId:1,button:0,clientX:450,clientY:350});

    M.goat.jump(); advance(.15);
    const key = press('к','KeyR');
    assert.equal(key.prevented,true, 'physical R works on non-Latin keyboard layouts');
    assert.equal(M.goat.state.aerialStomp,true, 'the next jump can slam with R immediately');
    assert.equal(actions,before+2);
    dispatch('window','keydown',{key:'r',code:'KeyR',repeat:true});
    assert.equal(actions,before+2, 'holding R never repeats the action');
    advance(.6);
    assert.equal(impacts,hits+2);
  }
  const before = actions;
  assert.equal(dispatch('window','keydown',{key:'r',code:'KeyR',ctrlKey:true}).prevented,undefined);
  assert.equal(actions,before, 'Ctrl+R remains a browser shortcut');
  press('t','KeyT'); press('r','KeyR'); dispatch('scene','mousedown',{button:2});
  assert.equal(actions,before, 'strategic view cannot activate a stomp');
  press('t','KeyT'); press('q','KeyQ');
  press('r','KeyR'); dispatch('scene','mousedown',{button:2});
  assert.equal(actions,before, 'the training menu blocks both inputs');
  press('q','KeyQ'); M.devConsole = {isOpen:true};
  press('r','KeyR'); dispatch('scene','mousedown',{button:2});
  assert.equal(actions,before, 'the developer console blocks both inputs');
});

test('all four strategic portraits open remote individual upgrades and return focus to the chosen ally', () => {
  const { M, load, press, dispatch, element, document, flush, advance } = commandGame();
  load('js/upgrades.js');
  let coins = 100;
  const stock = { log: 20, stone: 20 };
  M.enemies.getState = () => ({ coins });
  M.enemies.spendCoins = amount => { coins -= amount; return true; };
  M.items.count = kind => stock[kind] || 0;
  M.items.canSpend = cost => Object.entries(cost).every(([kind, amount]) => kind === 'coins' || stock[kind] >= amount);
  M.items.spend = cost => { for (const kind of ['log', 'stone']) stock[kind] -= cost[kind] || 0; };
  const portraits = element('rts-animals').children;
  assert.equal(portraits.length, 4);
  assert.equal(M.upgrades.nearest(), null, 'the entire herd is out of talking range');
  press('f', 'KeyF'); press('t', 'KeyT');
  for (const [i, animal] of M.animals.list.entries()) {
    const portrait = portraits[i];
    assert.match(portrait.attrs['aria-label'], new RegExp(animal.name));
    assert.equal(portrait.attrs['aria-haspopup'], 'dialog');
    assert.ok(readFileSync(new URL('../' + portrait.children[0].src, import.meta.url)).length, 'offline portrait exists');
    press('d', 'KeyD');
    portrait.focus(); dispatch(portrait.id, 'click');
    assert.equal(M.upgradeMenu.isOpen, true);
    assert.equal(M.upgradeMenu.target, animal);
    assert.equal(element('upgrade-title').textContent, animal.name);
    assert.equal(element('upgrade-animal-tab').hidden, false);
    const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
    const upgradeButtons = () => descendants(element('upgrade-cards')).filter(node => node.dataset.upgrade);
    assert.deepEqual(upgradeButtons().map(button => button.dataset.upgrade),
      animal.role === 'builder' ? ['move', 'craft'] : ['move', 'cadence', 'reach', 'power']);
    dispatch('upgrade-player-tab', 'click'); assert.equal(M.upgradeMenu.target, M.upgrades.player);
    dispatch('upgrade-animal-tab', 'click'); assert.equal(M.upgradeMenu.target, animal);
    dispatch(upgradeButtons()[0].id, 'click');
    assert.equal(M.upgrades.level(animal, 'move'), 1);
    assert.equal(M.upgrades.level(M.upgrades.player, 'move'), 0);
    assert.equal(M.upgrades.level(M.animals.list[(i + 1) % 4], 'move'), i === 3 ? 1 : 0, 'each animal owns its training');
    assert.match(element('upgrade-message').textContent, new RegExp(animal.name));
    press('Escape', 'Escape'); flush();
    assert.equal(M.upgradeMenu.isOpen, false);
    assert.equal(M.strategy.active, true);
    assert.equal(document.activeElement, portrait);
    assert.equal(document.pointerLockElement, null);
    const focus = M.strategy.focus.clone(); advance(.1);
    assert.equal(M.strategy.focus.x, focus.x, 'opening training clears held camera movement');
  }
  assert.equal(coins, 68); assert.equal(stock.log, 12);
  press('t', 'KeyT'); assert.equal(document.pointerLockElement, element('scene'));
});

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

test('strategic rotation keeps focus, pans relative to view, and preserves the goat camera', () => {
  const { M, camera, press, dispatch, element, advance } = commandGame();
  press('t', 'KeyT'); advance(.1);
  const originalFocus = M.strategy.focus.clone(), originalCamera = camera.position.clone();
  assert.equal(dispatch('window', 'keydown', { key: 'я', code: 'KeyZ' }).prevented, true);
  advance(.3);
  assert.ok(camera.position.x < originalFocus.x - 35, 'Z turns the map counterclockwise');
  assert.ok(Math.abs(camera.position.z - originalFocus.z) < .01);
  assert.ok(M.strategy.focus.distanceTo(originalFocus) < .01, 'rotation keeps the focus fixed');
  assert.match(element('rts-compass-needle').attrs.style, /rotate\(-1\.570796/);
  const panStart = M.strategy.focus.clone();
  press('w', 'KeyW'); advance(.2); dispatch('window', 'keyup', { key: 'w' });
  assert.ok(M.strategy.focus.x > panStart.x + 1, 'W moves toward the top of the rotated view');
  assert.ok(Math.abs(M.strategy.focus.z - panStart.z) < .01);
  const beforeDrag = M.strategy.focus.clone();
  dispatch('scene', 'pointerdown', { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
  dispatch('scene', 'pointermove', { pointerId: 1, clientX: 440, clientY: 300 });
  dispatch('scene', 'pointerup', { pointerId: 1, button: 0, clientX: 440, clientY: 300 });
  assert.ok(M.strategy.focus.z < beforeDrag.z - 1, 'left drag moves the map with the pointer after rotation');
  dispatch('rts-hearth', 'click'); advance(.1);
  assert.ok(camera.position.x < M.strategy.focus.x - 35, 'recentering preserves orientation');
  dispatch('rts-compass', 'click'); advance(.3);
  assert.ok(Math.abs(camera.position.x - M.strategy.focus.x) < .01, 'compass resets north');
  assert.ok(camera.position.z > M.strategy.focus.z + 35);
  press('x', 'KeyX'); advance(.3);
  assert.ok(camera.position.x > M.strategy.focus.x + 35, 'X turns clockwise');
  dispatch('window', 'keydown', { key: 'x', code: 'KeyX', repeat: true }); advance(.3);
  assert.ok(camera.position.x > M.strategy.focus.x + 35, 'key repeat does not cause accidental turns');
  press('t', 'KeyT'); advance(.1); press('t', 'KeyT'); advance(.1);
  assert.ok(camera.position.x > M.strategy.focus.x + 35, 'strategy orientation survives a round trip');
  dispatch('rts-rotate-left', 'click'); advance(.3);
  assert.ok(Math.abs(camera.position.x - M.strategy.focus.x) < .01, 'visible button turns back');
  const spaceOnButton = dispatch('window', 'keydown', { key: ' ', code: 'Space', target: { closest: () => element('rts-compass') } });
  assert.equal(spaceOnButton.prevented, undefined, 'Space can activate a focused camera button');
  assert.ok(originalCamera.z > originalFocus.z + 35);
  press('q', 'KeyQ'); assert.equal(M.upgradeMenu.isOpen, true, 'Q still opens training');
});

test('right drag rotates freely without panning or canceling, while right click cancels', () => {
  const { M, camera, press, dispatch, advance } = commandGame();
  press('t', 'KeyT'); advance(.1); M.strategy.select(M.towers.definitions[0].id);
  const focus = M.strategy.focus.clone();
  dispatch('scene', 'pointerdown', { pointerId: 1, button: 2, clientX: 400, clientY: 300 });
  dispatch('scene', 'pointermove', { pointerId: 1, button: -1, clientX: 500, clientY: 300 });
  dispatch('scene', 'pointerup', { pointerId: 1, button: 2, clientX: 500, clientY: 300 });
  advance(.1);
  assert.ok(camera.position.x > focus.x + 15, 'dragging right rotates the map right');
  assert.ok(M.strategy.focus.distanceTo(focus) < .01, 'right drag does not pan');
  assert.equal(M.strategy.selected, M.towers.definitions[0].id, 'right drag keeps the selected tower');
  dispatch('scene', 'pointerdown', { pointerId: 2, button: 2, clientX: 400, clientY: 300 });
  dispatch('scene', 'pointerup', { pointerId: 2, button: 2, clientX: 400, clientY: 300 });
  assert.equal(M.strategy.selected, null, 'right click still cancels');
  dispatch('rts-compass', 'click'); advance(.3);
  assert.ok(Math.abs(camera.position.x - M.strategy.focus.x) < .01, 'north reset works after a free turn');
  M.config.reducedMotion = true;
  dispatch('rts-rotate-right', 'click'); advance(1 / 60);
  assert.ok(camera.position.x > M.strategy.focus.x + 35, 'reduced motion skips the animation');
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
  press('t', 'KeyT'); press('0', 'Digit0');
  dispatch('rts-close', 'click');
  assert.equal(M.strategy.active, false, 'the T-labeled close button exits strategic view even with a tower selected');
  assert.equal(M.strategy.selected, null);
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

test('placement and inspection show the same elevation-adjusted range as combat', () => {
  const { M, scene, press, dispatch, element, advance } = commandGame();
  let by = 7;
  M.targeting.trace = () => ({ bx: 8, by, bz: 8 });
  M.towers.site = () => ({ valid: true, reason: 'Ready' }); M.towers.available = () => true;
  press('t', 'KeyT'); press('1', 'Digit1');
  dispatch('scene', 'pointermove', { clientX: 400, clientY: 300 }); advance(.2);
  const ring = scene.children.find(node => node.geometry?.type === 'RingGeometry');
  assert.ok(Math.abs(ring.scale.x - 22.8) < 1e-9);
  assert.match(element('rts-detail-stats').textContent, /22\.8m range \(\+20% height\)/);
  by = 8; advance(.2);
  assert.ok(Math.abs(ring.scale.x - 26.6) < 1e-9);
  assert.match(element('rts-detail-stats').textContent, /26\.6m range \(\+40% height\)/);
  press('Escape', 'Escape');
  const tower = { def: M.towers.byId.ballista, position: { x: 17, y: 20, z: 17 }, kills: 0 };
  M.towers.list.push(tower); M.towers.atCell = () => tower;
  dispatch('scene', 'pointerdown', { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
  dispatch('scene', 'pointerup', { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
  assert.ok(Math.abs(ring.scale.x - 30.4) < 1e-9);
  assert.match(element('rts-detail-stats').textContent, /30\.4m range \(\+60% height\)/);
});


test('inventory, upgrades and strategy switch directly without losing strategic view', () => {
  const { M, load, press, dispatch, element, flush, document } = commandGame({ deferredLock: true });
  load('js/inventory.js');
  const bag = M.inventory.create(37);
  M.items = { slots: bag.slots, hotbarSize: 10, iconFor: () => null, itemName: kind => kind,
    count: bag.count, canAdd: bag.canAdd, canSpend: bag.canSpend };
  load('js/inventory-menu.js'); M.inventoryMenu.init();
  M.controls.requestLook(); flush(); assert.ok(document.pointerLockElement);
  press('t', 'KeyT'); flush(); assert.equal(M.strategy.active, true); assert.equal(document.pointerLockElement, null);
  press('i', 'KeyI'); assert.equal(M.inventoryMenu.isOpen, true);
  assert.equal(M.strategy.active, true, 'opening the inventory keeps the map and its state');
  press('q', 'KeyQ');
  assert.equal(M.inventoryMenu.isOpen, false); assert.equal(M.upgradeMenu.isOpen, true);
  flush(); assert.equal(document.activeElement, element('upgrade-player-tab'), 'old close events do not steal focus');
  press('i', 'KeyI'); assert.equal(M.upgradeMenu.isOpen, false); assert.equal(M.inventoryMenu.isOpen, true);
  flush(); assert.equal(document.activeElement, element('bag-close'));
  assert.equal(document.pointerLockElement, null, 'switching menus does not recapture the pointer');
  press('t', 'KeyT'); assert.equal(M.inventoryMenu.isOpen, false); assert.equal(M.strategy.active, true);
  flush();
  dispatch('rts-inventory', 'click'); assert.equal(M.inventoryMenu.isOpen, true);
  dispatch('bag-to-upgrades', 'click'); assert.equal(M.upgradeMenu.isOpen, true);
  dispatch('upgrade-to-strategy', 'click'); assert.equal(M.upgradeMenu.isOpen, false); assert.equal(M.strategy.active, true);
  press('t', 'KeyT'); assert.equal(M.strategy.active, false);
  press('i', 'KeyI'); assert.equal(M.inventoryMenu.isOpen, true);
  press('t', 'KeyT'); assert.equal(M.inventoryMenu.isOpen, false); assert.equal(M.strategy.active, true);
});
