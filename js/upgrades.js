(function (M) {
  'use strict';

  // Training belongs to an individual, never to its shared species definition.
  const player = {}, training = new WeakMap();
  const MAX_LEVEL = 3, TALK_RANGE = 5.5;
  const definitions = {
    move: { name: 'Vector Striders', region: 'Legs · cyan', tiers: ['Servo soles', 'Hydraulic shins', 'Vector jets'], description: 'Fit cyan servo hooves, then hydraulic legs and jet-assisted strides. Changes legs and movement effects only.', material: 'log', coins: [8, 20, 36], blocks: [2, 4, 6] },
    cadence: { name: 'Reflex Drive', region: 'Neck & jaw · magenta', tiers: ['Servo collar', 'Coil jaw', 'Overclock visor'], description: 'Build a magenta piston collar, articulated jaw guard and targeting visor. Shorter windup, snapping strikes and controlled recoil.', material: 'stone', coins: [10, 24, 42], blocks: [2, 4, 6] },
    reach: { name: 'Arc Antlers', region: 'Horns · violet', tiers: ['Arc prongs', 'Relay horns', 'Siege antlers'], description: 'Grow violet rail horns from compact prongs to towering siege antlers. Charge and release electric bolts, chains, then fireballs.', material: 'log', coins: [8, 20, 36], blocks: [2, 4, 6] },
    power: { name: 'Nova Core', region: 'Torso & shoulders · orange', tiers: ['Ignition cell', 'Reactor mantle', 'Nova carapace'], description: 'Install an orange chest reactor, armored shoulders, then a complete torso carapace. Reactor recoil and stronger projectile effects show increased damage.', material: 'stone', coins: [12, 28, 48], blocks: [3, 5, 8] },
    craft: { name: 'Forge Harness', region: 'Back & tools · emerald', tiers: ['Tool cradle', 'Twin manipulators', 'Mobile forge'], description: 'An emerald construction harness gains articulated tools and a protective forge shell. Tool arms swing on work strokes; stronger Frost Spires and faster building.', material: 'stone', coins: [8, 18, 32], blocks: [2, 4, 6] }
  };
  function valid(target) { return target === player || !!(M.animals && M.animals.list.includes(target)); }
  function keys(target) { return target !== player && target.role === 'builder' ? ['move', 'craft'] : ['move', 'cadence', 'reach', 'power']; }
  function level(target, key) { const levels = training.get(target); return levels ? levels[key] || 0 : 0; }
  // All attack ranges are tripled: the default headbutt reaches 2.8*3, the
  // stomp 3.1*3, and the spell tiers are 3/4/10 blocks scaled to 9/12/30.
  // Arc Antlers trains the same elemental strikes on the player and on hunters;
  // reach therefore reads the spell range once trained, and 0 before.
  const REACH_BASE = 8.4, DAMAGE_BASE = 1;
  const SPELL_RANGES = [0, 9, 12, 30];
  const SPELL_DESCRIPTION = 'Horns channel elemental strikes: an electric bolt, then a chaining arc, then a fireball. ' +
    'Walls stop the bolt; the fireball bursts on impact with a 3-block blast.';
  function stats(target) {
    target = target || player;
    const reachLevel = level(target, 'reach');
    const move = 1 + level(target, 'move') / 3;
    // Builders use the movement bonus for quarrying, placement and job waits
    // too. Forge Harness remains an additional multiplier on that work.
    const workMove = target.role === 'builder' ? move : 1;
    return { move: move, rate: 1 + level(target, 'cadence') / 3,
      reach: reachLevel === 0 ? 0 : SPELL_RANGES[reachLevel],
      damage: level(target, 'power') * DAMAGE_BASE * 2 / 3,
      craft: (1 + level(target, 'craft') * 0.25) * workMove };
  }
  function effect(target, key, rank) {
    if (key === 'move') return '+' + Math.round(rank * 100 / 3) +
      (target.role === 'builder' ? '% movement, gathering & building speed' : '% movement');
    if (key === 'cadence') return '+' + Math.round(rank * 100 / 3) + '% attack speed' +
      (rank > 0 ? ' · ' + M.styleFx.neckStyle[rank].name : '');
    if (key === 'reach') {
      if (rank <= 0) return 'melee headbutts';
      if (rank === 1) return 'electric bolt · 9 blocks, nearest enemy';
      if (rank === 2) return 'electric chain · 12 blocks, up to 3 foes';
      return 'fireball · 30 blocks, 3-block blast';
    }
    if (key === 'power') return '+' + (rank * DAMAGE_BASE * 2 / 3).toFixed(1) + ' damage' +
      (rank > 0 ? ' · ' + M.styleFx.powerStyle[rank].name : '');
    return '+' + (rank * 25) + '% work speed' + (rank ? ' · Frost Spires ' + ['I', 'II', 'III'][rank - 1] : ' · walls only');
  }
  function offer(target, key) {
    if (!valid(target) || !keys(target).includes(key)) return null;
    const def = definitions[key], rank = level(target, key), maxed = rank >= MAX_LEVEL;
    const description = def.description + (key === 'move' && target.role === 'builder'
      ? ' Also speeds gathering and building; stacks with Forge Harness. Building still consumes gathered blocks.' : key === 'reach' ? ' Walls still stop attacks.' : '');
    return { key: key, name: def.name, description: description, region: def.region,
      appearance: rank ? def.tiers[rank - 1] : 'Natural', nextAppearance: def.tiers[Math.min(2, rank)],
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
    if (key === 'craft' && target.craftFx) target.craftFx.apply(levels[key], { chest: target.parts.chest });
    if (key === 'craft' && M.towers && M.towers.trainBuilder) M.towers.trainBuilder(target);
    if (target === player && key === 'move' && M.goat && M.goat.applySpeedStyle) {
      M.goat.applySpeedStyle(levels[key]);
    }
    if (target === player && key === 'reach' && M.goat && M.goat.applyHornStyle) {
      M.goat.applyHornStyle(levels[key]);
    }
    if (target !== player && key === 'move' && target.speedFx) target.speedFx.apply(levels[key], target.speedCtx);
    if (target !== player && key === 'reach' && target.hornFx) target.hornFx.apply(levels[key], target.hornCtx);
    if (key === 'cadence') {
      if (target === player && M.goat && M.goat.applyNeckStyle) M.goat.applyNeckStyle(levels[key]);
      else if (target.neckFx) target.neckFx.apply(levels[key], target.neckCtx);
    }
    if (key === 'power') {
      if (target === player && M.goat && M.goat.applyPowerStyle) M.goat.applyPowerStyle(levels[key]);
      else if (target.powerFx) target.powerFx.apply(levels[key], target.powerCtx);
    }
    if (target !== player && target.refreshLoadout) target.refreshLoadout();
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
  M.upgrades = { player: player, stats: stats, level: level, keys: keys, offer: offer, buy: buy,
    canAfford: canAfford, nearest: nearest, maxLevel: MAX_LEVEL, talkRange: TALK_RANGE,
    spellRanges: function () { return SPELL_RANGES; } };
})(window.Meadow = window.Meadow || {});
