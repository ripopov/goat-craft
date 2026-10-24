(function (M) {
  'use strict';

  // Training belongs to an individual, never to its shared species definition.
  const player = {}, training = new WeakMap();
  const MAX_LEVEL = 3, TALK_RANGE = 5.5;
  const definitions = {
    move: { name: 'Fleet hooves', description: 'Walk, gallop and swim faster.', material: 'log', coins: [8, 20, 36], blocks: [2, 4, 6] },
    cadence: { name: 'Quick strikes', description: 'Recover faster between headbutts and stomps.', material: 'stone', coins: [10, 24, 42], blocks: [2, 4, 6] },
    reach: { name: 'Long horns', description: 'Reach enemies farther away. Walls still stop attacks.', material: 'log', coins: [8, 20, 36], blocks: [2, 4, 6] },
    power: { name: 'Heavy horns', description: 'Deal more damage with every strike.', material: 'stone', coins: [12, 28, 48], blocks: [3, 5, 8] },
    craft: { name: 'Practiced builder', description: 'Quarry, place and prepare the next job faster.', material: 'stone', coins: [8, 18, 32], blocks: [2, 4, 6] }
  };
  function valid(target) { return target === player || !!(M.animals && M.animals.list.includes(target)); }
  function keys(target) { return target !== player && target.role === 'builder' ? ['move', 'craft'] : ['move', 'cadence', 'reach', 'power']; }
  function level(target, key) { const levels = training.get(target); return levels ? levels[key] || 0 : 0; }
  // All attack ranges are tripled: the default headbutt reaches 2.8*3 and the
  // spell tiers are 3/4/10 blocks scaled to 9/12/30. Heavy horns still add
  // damage to every hit; hunters keep their melee reach (base 2.8 headbutt
  // range, also tripled).
  const REACH_BASE = 8.4, DAMAGE_BASE = 1;
  const SPELL_RANGES = [0, 9, 12, 30];
  const SPELL_DESCRIPTION = 'Your horns channel elemental strikes: an electric bolt, then a chaining arc, then a fireball. ' +
    'Walls stop the bolt; the fireball bursts on impact with a 3-block blast.';
  function stats(target) {
    target = target || player;
    const reachLevel = level(target, 'reach');
    return { move: 1 + level(target, 'move') / 3, rate: 1 + level(target, 'cadence') / 3,
      reach: target === player ? SPELL_RANGES[reachLevel] : reachLevel * REACH_BASE * 2 / 3,
      damage: level(target, 'power') * DAMAGE_BASE * 2 / 3,
      craft: 1 + level(target, 'craft') * 0.25 };
  }
  function effect(target, key, rank) {
    if (key === 'move') return '+' + Math.round(rank * 100 / 3) + '% movement';
    if (key === 'cadence') return '+' + Math.round(rank * 100 / 3) + '% attack speed';
    if (key === 'reach') {
      if (target === player) {
        if (rank <= 0) return 'melee headbutts';
        if (rank === 1) return 'electric bolt · 9 blocks, nearest enemy';
        if (rank === 2) return 'electric chain · 12 blocks, up to 3 foes';
        return 'fireball · 30 blocks, 3-block blast';
      }
      return '+' + (rank * REACH_BASE * 2 / 3).toFixed(1) + ' reach';
    }
    if (key === 'power') return '+' + (rank * DAMAGE_BASE * 2 / 3).toFixed(1) + ' damage';
    return '+' + (rank * 25) + '% work speed';
  }
  function offer(target, key) {
    if (!valid(target) || !keys(target).includes(key)) return null;
    const def = definitions[key], rank = level(target, key), maxed = rank >= MAX_LEVEL;
    const description = key === 'move' && target !== player ? 'Move faster between enemies or construction jobs.'
      : key === 'reach' && target === player ? SPELL_DESCRIPTION
      : def.description;
    return { key: key, name: def.name, description: description,
      level: rank, maxed: maxed, current: effect(target, key, rank), next: effect(target, key, Math.min(MAX_LEVEL, rank + 1)),
      cost: maxed ? null : { coins: def.coins[rank], [def.material]: def.blocks[rank] } };
  }
  function canAfford(cost) {
    return !!cost && M.enemies.getState().coins >= cost.coins && M.items.canSpend(cost);
  }
  function buy(target, key) {
    const item = offer(target, key);
    if (!item || item.maxed || (M.hearthTree && M.hearthTree.health <= 0) || !canAfford(item.cost)) return false;
    // Validate both balances before either synchronous debit; no partial purchase.
    if (!M.enemies.spendCoins(item.cost.coins)) return false;
    M.items.spend(item.cost);
    let levels = training.get(target);
    if (!levels) { levels = {}; training.set(target, levels); }
    levels[key] = item.level + 1;
    if (target === player && key === 'move' && M.goat && M.goat.applySpeedStyle) {
      M.goat.applySpeedStyle(levels[key]);
    }
    if (target === player && key === 'reach' && M.goat && M.goat.applyHornStyle) {
      M.goat.applyHornStyle(levels[key]);
    }
    if (M.audio && M.audio.pickup) M.audio.pickup();
    return true;
  }
  function nearest() {
    if (!M.goat || !M.goat.group || !M.animals) return null;
    const p = M.goat.group.position;
    let best = null, distance = TALK_RANGE;
    M.animals.list.forEach(function (animal) {
      const q = animal.group.position, d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d >= distance || Math.abs(q.y - p.y) > 2.8) return;
      const steps = Math.ceil(d / 0.3);
      for (let i = 1; i < steps; i++) {
        const k = i / steps, y = p.y + (q.y - p.y) * k + 1;
        if (M.world.blockedAt(p.x + (q.x - p.x) * k, p.z + (q.z - p.z) * k, y, y + 0.1)) return;
      }
      best = animal; distance = d;
    });
    return best;
  }
  let initialized = false;
  function init() {
    if (initialized) return;
    initialized = true;
    // Cover the highest individual cost of each material across the workshop,
    // so the opening build can be any one of the ten towers.
    M.enemies.addCoins(45);
    const supplies = { log: 4, stone: 5, dirt: 4, coal: 2, copper: 3, iron: 3 };
    Object.entries(supplies).forEach(([kind, count]) => M.items.addItem(kind, count));
  }
  M.upgrades = { player: player, stats: stats, level: level, keys: keys, offer: offer, buy: buy,
    canAfford: canAfford, nearest: nearest, init: init, maxLevel: MAX_LEVEL, talkRange: TALK_RANGE };
})(window.Meadow = window.Meadow || {});
