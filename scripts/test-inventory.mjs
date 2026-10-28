import assert from 'node:assert/strict';
import test from 'node:test';
import { classicModules } from './helpers/animal-game.mjs';

function inventory(size = 4) {
  const { M, load } = classicModules();
  load('js/inventory.js');
  return M.inventory.create(size);
}
const name = kind => kind;

test('stacks fill available slots, reject invalid amounts and preserve the tool', () => {
  const bag = inventory();
  assert.equal(bag.add('stone', 2, name), 1);
  assert.equal(bag.add('stone', 3, name), 1);
  assert.equal(bag.count('stone'), 5);
  for (const amount of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(bag.add('stone', amount, name), -1);
  }
  assert.equal(bag.add('tool', 1, name), -1);
  assert.equal(bag.add('', 1, name), -1);
  assert.equal(bag.add('wood', undefined, name), 2);
  assert.equal(bag.add('dirt', 1, name), 3);
  assert.equal(bag.add('iron', 1, name), -1);
  assert.equal(bag.consumeSlot(0), false);
  assert.equal(bag.count('stone'), 5);
  assert.equal(bag.count('tool'), 1);
});

test('spending checks every material before changing any stack', () => {
  const bag = inventory();
  bag.add('stone', 3, name); bag.add('wood', 2, name);
  assert.equal(bag.spend({ stone: 2, wood: 3, coins: 5 }), null);
  assert.equal(bag.spend({ stone: -1 }), null);
  assert.equal(bag.spend({ tool: 1 }), null);
  assert.equal(bag.count('stone'), 3);
  assert.equal(bag.count('wood'), 2);
  assert.deepEqual(Array.from(bag.spend({ stone: 3, wood: 1, coins: 5 })), [1, 2]);
  assert.equal(bag.count('stone'), 0);
  assert.equal(bag.count('wood'), 1);
  assert.equal(bag.consumeSlot(2), true);
  assert.equal(bag.slots[2], null);
});

test('bag stacks can move, swap and merge without moving the permanent tool', () => {
  const bag = inventory(37);
  bag.add('stone', 6, name); bag.add('log', 3, name);
  assert.equal(bag.move(1, 10), true);
  assert.equal(bag.slots[1], null);
  assert.equal(bag.count('stone'), 6);
  assert.equal(bag.move(10, 2), true);
  assert.equal(bag.slots[2].kind, 'stone');
  assert.equal(bag.slots[10].kind, 'log');
  assert.equal(bag.move(0, 11), false);
  assert.equal(bag.move(10, 0), false);
  assert.equal(bag.spend({ log: 2, stone: 6 }).length, 2);
  assert.equal(bag.count('log'), 1);
  assert.equal(bag.count('stone'), 0);
  bag.add('log', 1, name);
  bag.slots[1] = { kind: 'log', count: 4, name: 'log' };
  assert.equal(bag.move(1, 10), true);
  assert.equal(bag.count('log'), 6);
  assert.equal(bag.slots[1], null);
});

test('exchange buys and sells bundles atomically, including when the bag is full', () => {
  const { M, load } = classicModules(); load('js/inventory.js'); load('js/inventory-menu.js');
  const bag = M.inventory.create(3); let coins = 8;
  M.items = { canAdd: bag.canAdd, addItem: (kind, amount) => bag.add(kind, amount, name), canSpend: bag.canSpend,
    spend: cost => !!bag.spend(cost), count: bag.count };
  M.enemies = { getState: () => ({ coins }), spendCoins: n => { if (coins < n) return false; coins -= n; return true; },
    addCoins: n => { coins += n; return true; } };
  assert.equal(M.inventoryMenu.trade('stone', 'buy'), true);
  assert.equal(coins, 0); assert.equal(bag.count('stone'), 5);
  assert.equal(M.inventoryMenu.trade('log', 'buy'), false);
  assert.equal(M.inventoryMenu.trade('stone', 'sell'), true);
  assert.equal(coins, 3); assert.equal(bag.count('stone'), 0);
  assert.equal(M.inventoryMenu.trade('stone', 'sell'), false);
  bag.add('log', 1, name); bag.add('dirt', 1, name); coins = 100;
  assert.equal(M.inventoryMenu.trade('stone', 'buy'), false);
  assert.equal(coins, 100); assert.equal(bag.count('stone'), 0);
  assert.equal(M.inventoryMenu.trade('dirt', 'buy'), true, 'a full bag can still add to an existing stack');
  assert.equal(coins, 96); assert.equal(bag.count('dirt'), 6);
});

test('inventory menu moves stacks and refreshes the exchange', () => {
  const { M, load, context } = classicModules(); load('js/inventory.js');
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.dataset = {}; this.attrs = {}; this.classList = { toggle() {} }; }
    appendChild(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key]; }
    addEventListener(type, listener) { this.listeners[type] = listener; }
    click() { this.listeners.click?.({ target: this }); }
    focus() { context.document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
    querySelector(selector) {
      const match = /data-(inventory-slot|trade)="([^"]+)"/.exec(selector);
      const visit = node => {
        if (match && node.dataset[match[1] === 'trade' ? 'trade' : 'inventorySlot'] === match[2]) return node;
        for (const child of node.children) { const found = visit(child); if (found) return found; }
        return null;
      };
      return visit(this);
    }
  }
  const elements = Object.fromEntries(['bag-menu', 'bag-open', 'bag-close', 'bag-to-upgrades', 'bag-to-strategy', 'bag-hotbar', 'bag-grid', 'bag-coins', 'bag-instruction', 'trade-list', 'bag-message'].map(id => [id, new Element()]));
  elements['bag-menu'].children = Object.entries(elements).filter(([id]) => id !== 'bag-menu').map(([, el]) => el);
  context.document.createElement = () => new Element(); context.document.getElementById = id => elements[id] || null;
  const bag = M.inventory.create(37); bag.add('stone', 5, name); let coins = 8;
  M.items = { slots: bag.slots, hotbarSize: 10, iconFor: () => null, itemName: name, count: bag.count,
    canAdd: bag.canAdd, addItem: (kind, n) => bag.add(kind, n, name), moveStack: bag.move,
    canSpend: bag.canSpend, spend: cost => !!bag.spend(cost) };
  M.enemies = { getState: () => ({ coins, defeated: false }), spendCoins: n => { coins -= n; return true; }, addCoins: n => { coins += n; return true; } };
  M.controls = { stopSteering() {}, suspendLook() {}, resumeLook() {}, noteActivity() {} };
  load('js/inventory-menu.js'); M.inventoryMenu.init(); M.inventoryMenu.open();
  assert.equal(M.inventoryMenu.isOpen, true);
  assert.equal(elements['bag-hotbar'].children.length, 10); assert.equal(elements['bag-grid'].children.length, 27);
  elements['bag-hotbar'].children[1].click(); elements['bag-grid'].children[0].click();
  assert.equal(bag.slots[1], null); assert.equal(bag.slots[10].kind, 'stone');
  elements['trade-list'].children[1].children[1].click();
  assert.equal(bag.count('stone'), 10); assert.equal(coins, 0);
  assert.match(elements['bag-message'].textContent, /Bought 5 stone/);
  M.inventoryMenu.close(); assert.equal(M.inventoryMenu.isOpen, false);
});
