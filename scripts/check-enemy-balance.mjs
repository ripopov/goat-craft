import assert from 'node:assert/strict';
import { game } from './helpers/animal-game.mjs';

// Real combat, excavation, status effects, targeting and economy. Only the
// human's steering is fixed; the inner reserve must handle air and burrow lanes.
export function runDefense(wave, seed = 42) {
  const { M, load, scene, controls } = game({ seed });
  load('js/coin-model.js'); load('js/inventory.js'); load('js/items.js'); M.items.init(scene); load('js/upgrades.js'); load('js/towers.js'); M.towers.init(scene);
  M.enemies.addCoins(10000);
  for (const kind of ['log', 'stone', 'iron', 'copper', 'coal']) M.items.addItem(kind, 1000);
  M.animals.list.forEach((animal, i) => animal.group.position.set(-35 + i * 3, 14, 35));
  M.goat.group.position.set(8, 14, 4); controls.firstPerson = true;
  let invested = 0;
  for (const [kind, tiers] of [['power', wave < 10 ? 1 : wave < 15 ? 2 : 3], ['reach', wave < 10 ? 1 : wave < 15 ? 2 : 3], ['cadence', wave < 10 ? 1 : wave < 15 ? 2 : 3]]) {
    for (let i = 0; i < tiers; i++) { invested += M.upgrades.offer(M.upgrades.player, kind).cost.coins; assert.ok(M.upgrades.buy(M.upgrades.player, kind)); }
  }
  function build(id, x, z) {
    const bx = Math.floor(x / 2), bz = Math.floor(z / 2);
    const tower = M.towers.place(id, bx, 7, bz);
    assert.ok(tower, id + ' has a legal benchmark site ' + [x, z]); invested += tower.def.cost.coins;
  }
  for (const [x, z] of [[17, 1], [1, 17], [-17, 1], [1, -17]]) build('ballista', x, z);
  for (const [x, z] of [[11, 11], [11, -11], [-11, 11], [-11, -11]]) build('frost', x, z);
  // Introduce affordable splash coverage when frontal armor first appears.
  if (wave >= 12) for (const [x, z] of [[21, 9], [-21, -9]]) build('mortar', x, z);
  // Fourfold enemy health calls for a larger prepared battery. Keep real tower
  // damage and costs: this benchmark measures an investment, not free buffs.
  if (wave >= 12) {
    for (const [x, z] of [[23, 11], [23, -11], [-23, 11], [-23, -11]]) build('arcane', x, z);
    for (const [x, z] of [[11, 23], [11, -23], [-11, 23], [-11, -23]]) build('sun', x, z);
  }
  if (wave >= 20) for (const [x, z] of [[9, -21], [-9, 21]]) build('mortar', x, z);
  if (wave >= 30) for (const [x, z] of [[19, -15], [-15, -19], [-19, 15], [15, 19]]) build('arcane', x, z);
  const deaths = [], seen = new Set(), trace = new WeakMap(); let air = 0, burrows = 0, sailors = 0, maxLiving = 0;
  M.enemies.startWave(wave);
  let seconds = 0; const stepTimes = [];
  for (let frame = 0; frame < 240 * 60 && M.hearthTree.health > 0; frame++) {
    seconds = frame / 60;
    const started = performance.now();
    M.goat.update(1 / 60, seconds); M.enemies.update(1 / 60); M.towers.update(1 / 60); M.items.update(1 / 60, seconds, M.goat.group);
    stepTimes.push(performance.now() - started);
    for (const enemy of M.enemies.zombies) if (!seen.has(enemy)) { seen.add(enemy); deaths.push(enemy); if (enemy.airborne) air++; if (enemy.boat) sailors++; if (enemy.type === 'worm') burrows++; }
    if (process.env.TRACE_ENEMIES) for (const e of M.enemies.zombies) if (e.type === 'worm' || e.boat || e.boatExit) {
      const state = e.mode + '/' + Math.floor(seconds / 30);
      if (trace.get(e) !== state) console.log(JSON.stringify({ seconds, id: e.id, mode: e.mode, burrowed: e.burrowed,
        position: e.position, goal: e.emergence, progressAge: seconds - e.progressAt, emergeTime: e.emergeTime,
        boat: e.boat && { cursor: e.boat.cursor, length: e.boat.path.length, point: e.boat.position },
        target: e.target && { x: e.target.x, y: e.target.y, z: e.target.z, blocks: e.target.blocks?.length } }));
      trace.set(e, state);
    }
    maxLiving = Math.max(maxLiving, M.enemies.zombies.length);
    if (M.enemies.getState().phase === 'intermission') break;
  }
  stepTimes.sort((a, b) => a - b);
  const result = { wave, seed, investedCoins: invested, towers: M.towers.list.length, health: M.hearthTree.health,
    cleared: M.enemies.getState().phase === 'intermission', seconds: Math.round(seconds * 10) / 10,
    cpuStepP95ms: +stepTimes[Math.floor(stepTimes.length * .95)].toFixed(2),
    maxLiving, airdrops: air, sailors, worms: burrows, watchdogDeaths: deaths.filter(enemy => enemy.exploded).length,
    watchdogVictims: deaths.filter(enemy => enemy.exploded).map(e => ({ type: e.type, position: e.position, mode: e.mode, boat: e.boat && { cursor: e.boat.cursor, length: e.boat.path.length } })),
    pending: M.enemies.getState().pending,
    survivors: M.enemies.zombies.map(e => ({ type: e.type, mode: e.mode, hp: e.hp, x: +e.position.x.toFixed(1), y: +e.position.y.toFixed(1), z: +e.position.z.toFixed(1), progressAge: +(seconds - e.progressAt).toFixed(1) })) };
  return result;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const waves = process.argv.slice(2).map(Number);
  for (const wave of waves.length ? waves : [5, 7, 10, 12, 15, 20, 30]) console.log(JSON.stringify(runDefense(wave)));
}
