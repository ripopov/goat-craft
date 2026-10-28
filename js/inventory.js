(function (M) {
  'use strict';

  // Inventory state is independent of the hotbar, world and renderer. Slot 0
  // is reserved for the goat's permanent tool; materials occupy the rest.
  function create(size) {
    const slots = new Array(size).fill(null);
    slots[0] = { kind: 'tool', name: 'Horns & Hooves', count: 1 };

    function count(kind) {
      return slots.reduce(function (sum, item) { return sum + (item && item.kind === kind ? item.count : 0); }, 0);
    }

    function canAdd(kind, amount) {
      if (typeof kind !== 'string' || !kind || kind === 'tool' || !Number.isSafeInteger(amount) || amount <= 0) return false;
      const existing = slots.find(function (item, index) { return index > 0 && item && item.kind === kind; });
      return existing ? Number.isSafeInteger(existing.count + amount) : slots.some(function (item, index) { return index > 0 && !item; });
    }

    function add(kind, amount, nameFor) {
      if (amount === undefined) amount = 1;
      if (!canAdd(kind, amount)) return -1;
      let target = slots.findIndex(function (item, index) { return index > 0 && item && item.kind === kind; });
      if (target >= 0) {
        if (!Number.isSafeInteger(slots[target].count + amount)) return -1;
        slots[target].count += amount;
      } else {
        target = slots.findIndex(function (item, index) { return index > 0 && !item; });
        if (target < 0) return -1;
        slots[target] = { kind: kind, name: nameFor(kind), count: amount };
      }
      return target;
    }

    function canSpend(cost) {
      return !!cost && typeof cost === 'object' && Object.keys(cost).filter(function (kind) { return kind !== 'coins'; }).every(function (kind) {
        return kind !== 'tool' && Number.isSafeInteger(cost[kind]) && cost[kind] >= 0 && count(kind) >= cost[kind];
      });
    }

    function spend(cost) {
      if (!canSpend(cost)) return null;
      const changed = [];
      Object.keys(cost).forEach(function (kind) {
        if (kind === 'coins') return;
        let left = cost[kind];
        for (let i = 1; i < slots.length && left > 0; i++) {
          if (!slots[i] || slots[i].kind !== kind) continue;
          const amount = Math.min(left, slots[i].count);
          slots[i].count -= amount; left -= amount;
          if (!slots[i].count) slots[i] = null;
          changed.push(i);
        }
      });
      return changed;
    }

    function consumeSlot(index) {
      if (!Number.isInteger(index) || index <= 0 || index >= slots.length || !slots[index]) return false;
      if (--slots[index].count === 0) slots[index] = null;
      return true;
    }

    function move(from, to) {
      if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to <= 0 || from >= slots.length || to >= slots.length || from === to || !slots[from]) return false;
      const source = slots[from], target = slots[to];
      if (target && source.kind === target.kind) {
        if (!Number.isSafeInteger(source.count + target.count)) return false;
        target.count += source.count; slots[from] = null;
      } else { slots[to] = source; slots[from] = target; }
      return true;
    }

    return { slots: slots, count: count, add: add, canAdd: canAdd, canSpend: canSpend, spend: spend, consumeSlot: consumeSlot, move: move };
  }

  M.inventory = { create: create };
})(window.Meadow = window.Meadow || {});
