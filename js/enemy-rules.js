(function (M) {
  'use strict';

  // Pure tuning data and deterministic rules. Controllers and renderers read
  // this module; it never changes a world, wallet, actor or scene.
  const MAX_ENEMIES = 200;
  const specialWaves = {};
  [15, 35, 75].forEach(function (wave) {
    specialWaves[wave] = { delivery: 'boat', intro: 'Sea invasion! Every enemy arrives in a four-strong boat crew.' + (wave === 15 ? ' Mire Sowers leave slowing amber puddles.' : '') };
  });
  [30, 70, 130].forEach(function (wave) {
    specialWaves[wave] = { type: 'worm', intro: 'Burrow swarm! Every enemy tunnels beneath the gates.' };
  });
  [20, 40, 60, 80].forEach(function (wave) {
    specialWaves[wave] = { delivery: 'parachute', intro: 'Air invasion! Every enemy arrives by parachute — watch the landing rings.' };
  });
  const TYPES = {
    zombie: { name: 'Zombie', unlock: 1, hp: 8, speed: 1.65, reward: 1, bite: 3, damage: 1, chew: 10, radius: 0.34, height: 2.8 },
    spider: { name: 'Spider', unlock: 3, hp: 8, speed: 2.7, reward: 2, bite: 3.5, damage: 1, chew: 12, radius: 0.42, height: 1.15 },
    raider: { name: 'Sea Raider', unlock: 4, hp: 12, speed: 1.85, reward: 2, bite: 3, damage: 1, chew: 9, radius: .34, height: 2.8 },
    skeleton: { name: 'Skeleton', unlock: 5, hp: 12, speed: 1.9, reward: 2, bite: 2.6, damage: 1, chew: 10, radius: 0.34, height: 2.8 },
    brute: { name: 'Stone brute', unlock: 8, hp: 28, speed: 1.15, reward: 4, bite: 3.5, damage: 2, chew: 7, radius: 0.44, height: 2.8 },
    worm: { name: 'Burrow Worm', unlock: 10, hp: 16, speed: 1.6, reward: 4, bite: 3.6, damage: 1, chew: 9, radius: .4, height: 1.4 },
    binder: { name: 'Briar Binder', unlock: 7, hp: 12, speed: 1.35, reward: 3, bite: 3.8, damage: 1, chew: 11, radius: .4, height: 2.8 },
    prismback: { name: 'Prismback', unlock: 12, hp: 16, speed: 1.25, reward: 4, bite: 3.8, damage: 1, chew: 9, radius: .44, height: 1.8 },
    sower: { name: 'Mire Sower', unlock: 15, hp: 12, speed: 1.5, reward: 3, bite: 3.5, damage: 1, chew: 11, radius: .42, height: 2 },
    boss: { name: 'Boss', unlock: 7, hp: 8, speed: 1.2, reward: 20, bite: 4, damage: 2, chew: 6, radius: 0.46, height: 2.8 }
  };
  function waveSize(level) {
    const size = Math.min(MAX_ENEMIES, 2 + level * 4);
    return specialWaves[level]?.delivery === 'boat' ? Math.ceil(size / 4) * 4 : size;
  }
  function seaSlot(level, slot) {
    // Four consecutive slots, with no half-full boat at the roster's end.
    return level >= 4 && slot % 24 >= 4 && slot % 24 < 8 && slot - slot % 24 + 8 <= waveSize(level);
  }
  // Pressure comes from coordinated arrivals before it comes from stat growth.
  // Short squad gaps leave recovery time without feeding hunters single targets.
  function wavePlan(level) {
    // Separate larger squads and new fronts from species introductions (3/5/8).
    return { size: waveSize(level), squadSize: specialWaves[level]?.delivery === 'boat' ? 4 : level < 4 ? 3 : level < 9 ? 4 : 5,
      memberInterval: Math.max(0.3, 0.6 - (level - 1) * 0.02),
      squadInterval: Math.max(2.4, 4.2 - (level - 1) * 0.15),
      lanes: level === 1 ? 1 : level < 6 ? 2 : 3 };
  }
  // Higher waves toughen enemies: health climbs toward 5x and speed toward 3x
  // of their level-1 values, easing in quickly at first and capping slowly.
  function waveDifficulty(wave) {
    const health = 1 - Math.exp(-Math.max(0, wave - 3) / 30);
    const speed = 1 - Math.exp(-Math.max(0, wave - 1) / 45);
    return { hp: 1 + 4 * health, speed: 1 + 2 * speed };
  }
  function healthForWave(type, wave) {
    // Scale the old rounded health, including every wave's gain, by exactly
    // four. Rounding after scaling would distort the increase on some waves.
    return 4 * Math.max(1, Math.round(TYPES[type].hp / 4 * waveDifficulty(wave).hp * (type === 'boss' ? 20 : 1)));
  }
  // Deterministic slots introduce a readable mix and bound the durable units.
  // Every 7th wave leads with one Boss marching alongside its regular horde.
  function typeForWave(level, slot) {
    if (specialWaves[level] && specialWaves[level].type) return specialWaves[level].type;
    if (level % 7 === 0 && slot === 0) return 'boss';
    if (level >= 10 && slot % 12 === 9) return 'worm';
    if (level >= 15 && slot % 20 === 17) return 'sower';
    if (level >= 12 && slot % 20 === 13) return 'prismback';
    if (level >= 7 && slot % 20 === 7) return 'binder';
    if (seaSlot(level, slot)) return 'raider';
    if (level >= 8 && slot % 6 === 5) return 'brute';
    if (level >= 5 && slot % 4 === 2) return 'skeleton';
    if (level >= 3 && slot % 3 === 1) return 'spider';
    return 'zombie';
  }
  function deliveryForWave(level, slot, type) {
    if (specialWaves[level] && specialWaves[level].delivery) return specialWaves[level].delivery;
    if (!specialWaves[level] && seaSlot(level, slot)) return 'boat';
    return level >= 5 && (type === 'zombie' || type === 'skeleton') &&
      (level === 5 ? slot === 3 : slot % 10 === 3) ? 'parachute' : 'ground';
  }
  function introduction(wave) {
    const introductions = { 3: 'Spiders incoming!', 4: 'Sea Raiders! Four enemies sail in each boat — defend the river landings.', 5: 'Skeletons and parachutes — watch the lavender landing rings.',
      7: 'Briar Binders — interrupt their glowing tower-snare chant.', 8: 'Stone brutes incoming!',
      10: 'Burrow Worms — watch for dig-outs 19–36 units from the Hearth.', 12: 'Prismbacks — flank them or use stomps and splash.',
      15: 'Mire Sowers — avoid amber puddles or jump clear.' };
    if (specialWaves[wave]) return specialWaves[wave].intro;
    let intro = introductions[wave] || 'protect the Hearth!';
    if (wave % 7 === 0) intro = 'A hulking Boss with burning red eyes leads this wave — it carries twenty times the health of a regular enemy. ' +
      (wave === 7 ? 'Briar Binders follow: interrupt their tower-snare chant.' : '');
    return intro;
  }
  M.enemyRules = { types: TYPES, maxEnemies: MAX_ENEMIES, firstWaveDelay: 30,
    wormEmergence: { inner: 19, favor: 29, radius: 36, retries: 3 }, specialWaves: specialWaves,
    waveSize: waveSize, wavePlan: wavePlan, waveDifficulty: waveDifficulty, healthForWave: healthForWave,
    typeForWave: typeForWave, deliveryForWave: deliveryForWave, introduction: introduction,
    restAfter: function (wave) { return wave % 10 === 0 ? 60 : 10; },
    clearBonus: function (wave) { return Math.min(24, 4 + wave * 2); } };
})(window.Meadow = window.Meadow || {});
