import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);

// A tiny DOM fixture is enough to exercise the real console module: the
// keyboard capture handler, command dispatch and log rendering are all loaded
// from js/console.js rather than reimplemented here.
function consoleGame() {
  const listeners = new Map(), elements = new Map();
  let created = 0;
  const document = {
    activeElement: null,
    body: { classList: { values: new Set(), add(value) { this.values.add(value); }, remove(value) { this.values.delete(value); }, contains(value) { return this.values.has(value); } } },
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(), children: [], className: '', textContent: '', hidden: false, value: '',
        scrollTop: 0, scrollHeight: 0, isContentEditable: false,
        get childElementCount() { return this.children.length; },
        appendChild(child) { this.children.push(child); return child; },
        replaceChildren() { this.children = []; },
        addEventListener() {},
        focus() { document.activeElement = this; },
        blur() { if (document.activeElement === this) document.activeElement = null; },
        setSelectionRange() {}
      };
      elements.set('created-' + created++, node);
      return node;
    },
    getElementById(id) { return elements.get(id) || null; }
  };
  function element(id, extra) {
    const node = Object.assign({
      id, children: [], hidden: false, textContent: '', value: '', className: '', isContentEditable: false,
      scrollTop: 0, scrollHeight: 0,
      get childElementCount() { return this.children.length; },
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren() { this.children = []; },
      addEventListener(type, fn, options) {
        const key = id + ':' + type;
        if (!listeners.has(key)) listeners.set(key, []);
        listeners.get(key).push({ fn, capture: options === true || !!options?.capture });
      },
      focus() { document.activeElement = this; },
      blur() { if (document.activeElement === this) document.activeElement = null; },
      setSelectionRange(start, end) { this.selection = { start, end }; }
    }, extra || {});
    elements.set(id, node); return node;
  }
  element('dev-console', { hidden: true });
  element('dev-console-log');
  element('dev-console-form');
  element('dev-console-input');
  const window = {
    matchMedia: () => ({ matches: false }),
    addEventListener(type, fn, options) {
      const key = 'window:' + type;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push({ fn, capture: options === true || !!options?.capture });
    }
  };
  function dispatch(target, type, values = {}) {
    const event = { type, key: '', code: '', target: target === 'window' ? undefined : elements.get(target),
      ctrlKey: false, metaKey: false, altKey: false, repeat: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...values };
    for (const { fn } of (listeners.get(target + ':' + type) || []).slice().sort((a, b) => Number(b.capture) - Number(a.capture))) {
      fn(event);
      if (event.stopped) break;
    }
    return event;
  }
  const context = vm.createContext({ window, document, console });
  const load = file => vm.runInContext(readFileSync(new URL(file, root), 'utf8'), context, { filename: file });
  load('vendor/three.min.js');
  load('js/core.js');
  const M = window.Meadow;
  const added = [], calls = [];
  const coins = { value: 0 };
  M.items = { addItem(kind, count) { added.push([kind, count]); return 1; } };
  M.towers = { definitions: [
    { cost: { coins: 6, log: 2 } },
    { cost: { coins: 14, stone: 4, iron: 1 } },
    { cost: { coins: 18, stone: 3, coal: 2 } },
    { cost: { coins: 15, log: 3, dirt: 3 } },
    { cost: { coins: 24, stone: 3, copper: 2 } }
  ] };
  let wave = 4;
  M.enemies = {
    addCoins(amount) { coins.value += amount; return true; },
    startNextWave() { calls.push('wave'); return true; },
    startWave(level) { calls.push('wave:' + level); if (!Number.isSafeInteger(level) || level < 1) return false; wave = level; return true; },
    getState() { return { wave, pending: 13, defeated: false }; }
  };
  M.controls = {
    stopSteering() { calls.push('stop'); },
    suspendLook() { calls.push('suspend'); },
    resumeLook() { calls.push('resume'); },
    noteActivity() { calls.push('activity'); }
  };
  M.upgradeMenu = { isOpen: false, close() { calls.push('close-upgrades'); } };
  load('js/console.js');
  M.devConsole.init();
  const press = (key, code, values = {}) => dispatch('window', 'keydown', { key, code, ...values });
  const type = text => {
    const input = elements.get('dev-console-input');
    input.value = text;
    return dispatch('window', 'keydown', { target: input, key: 'Enter', code: 'Enter' });
  };
  return { M, document, elements, added, calls, coins, press, type, dispatch };
}

test('/ opens the console, captures keyboard input and closes with / or Esc', () => {
  const { M, document, elements, calls, press } = consoleGame();
  press('/', 'Slash');
  assert.equal(M.devConsole.isOpen, true);
  assert.equal(elements.get('dev-console').hidden, false);
  assert.equal(document.activeElement, elements.get('dev-console-input'));
  assert.ok(calls.includes('stop') && calls.includes('suspend'));

  // Gameplay keys are swallowed while the log owns the keyboard, without
  // cancelling the input's own text editing.
  const typing = press('w', 'KeyW');
  assert.equal(typing.stopped, true);
  assert.notEqual(typing.prevented, true);

  // The opening key doubles as the closing key, just like Q for the upgrades
  // menu and T for the strategic view.
  press('/', 'Slash');
  assert.equal(M.devConsole.isOpen, false);
  assert.equal(elements.get('dev-console').hidden, true);
  assert.ok(calls.includes('resume') && calls.includes('activity'));

  press('/', 'Slash');
  assert.equal(M.devConsole.isOpen, true);
  press('Escape', 'Escape');
  assert.equal(M.devConsole.isOpen, false);
});

test('money grants 1000 coins and 1000 of every tower resource', () => {
  const { M, elements, added, coins, press, type } = consoleGame();
  press('/', 'Slash');
  type('money');
  assert.equal(coins.value, 1000);
  assert.deepEqual(added.map(([kind]) => kind).sort(), ['coal', 'copper', 'dirt', 'iron', 'log', 'stone']);
  added.forEach(([kind, count]) => assert.equal(count, 1000, kind + ' receives 1000'));
  const log = elements.get('dev-console-log').children.map(child => child.textContent).join('\n');
  assert.match(log, /Granted 1000 coins/);
  assert.match(log, /wood/);
  assert.equal(M.devConsole.isOpen, true);
});

test('spawn starts the next wave immediately and reports its size', () => {
  const { M, elements, calls, press, type } = consoleGame();
  press('/', 'Slash');
  type('spawn');
  assert.ok(calls.includes('wave'));
  const log = elements.get('dev-console-log').children.map(child => child.textContent).join('\n');
  assert.match(log, /Wave 4 incoming/);
  assert.match(log, /13 enemies/);
});

test('spawn with a level switches directly, including to lower waves', () => {
  const { elements, calls, press, type } = consoleGame();
  press('/', 'Slash');
  type('spawn 10');
  assert.ok(calls.includes('wave:10'));
  let log = elements.get('dev-console-log').children.map(child => child.textContent).join('\n');
  assert.match(log, /Wave 10 incoming/);

  type('spawn 3');
  assert.ok(calls.includes('wave:3'));
  log = elements.get('dev-console-log').children.map(child => child.textContent).join('\n');
  assert.match(log, /Wave 3 incoming/);

  type('spawn 0');
  type('spawn nope');
  type('spawn 5 extra');
  log = elements.get('dev-console-log').children.map(child => child.textContent).join('\n');
  assert.match(log, /Wave level must be 1 or greater/);
  assert.match(log, /Wave level must be a whole number/);
  assert.match(log, /Spawn expects at most one wave level/);
  assert.equal(calls.filter(value => value.startsWith('wave:')).length, 2, 'invalid levels never reach the wave controller');
});

test('slash is ignored inside text fields, and history recalls submitted commands', () => {
  const { M, elements, press, type } = consoleGame();
  press('/', 'Slash', { target: { tagName: 'INPUT' } });
  assert.equal(M.devConsole.isOpen, false, 'typing slash in a text field must not open the console');

  press('/', 'Slash');
  type('money');
  type('spawn');
  const input = elements.get('dev-console-input');
  press('ArrowUp', 'ArrowUp', { target: input });
  assert.equal(input.value, 'spawn');
  press('ArrowUp', 'ArrowUp', { target: input });
  assert.equal(input.value, 'money');
  press('ArrowDown', 'ArrowDown', { target: input });
  assert.equal(input.value, 'spawn');
});

test('the console opens without listing commands, and unknown commands stay terse', () => {
  const { M, elements, press } = consoleGame();
  press('/', 'Slash');
  assert.equal(elements.get('dev-console-log').children.length, 0, 'opening the console shows no command list');
  assert.equal(M.devConsole.execute('dance'), false);
  const log = elements.get('dev-console-log').children.map(child => child.textContent).join('\n');
  assert.match(log, /Unknown command "dance"/);
  assert.doesNotMatch(log, /money|spawn|help/);
  assert.equal(M.devConsole.execute('help'), false);
});
