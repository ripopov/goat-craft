import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Record real script scheduling and graph lifetime without speakers or npm.
function harness({ suspended = false } = {}) {
  const nodes = [];
  const sources = [];
  const buffers = [];
  const intervals = new Set();
  const errors = [];
  let time = 0;
  let state = suspended ? 'suspended' : 'running';
  function param(value = 0) {
    return {
      value, events: [],
      setValueAtTime(value, at) { this.events.push({ type: 'set', value, at }); },
      linearRampToValueAtTime(value, at) { this.events.push({ type: 'linear', value, at }); },
      exponentialRampToValueAtTime(value, at) {
        assert.ok(value > 0, 'exponential targets must be positive');
        this.events.push({ type: 'exponential', value, at });
      },
      cancelScheduledValues(at) { this.events = this.events.filter(event => event.at < at); },
      setTargetAtTime(value, at, constant) { this.events.push({ type: 'target', value, at, constant }); }
    };
  }
  function node(type) {
    const result = { type, connections: [], disconnected: false,
      connect(target) { assert.ok(target); this.connections.push(target); return target; },
      disconnect() { this.connections = []; this.disconnected = true; }
    };
    for (const key of ['gain', 'pan', 'frequency', 'detune', 'Q', 'playbackRate', 'threshold', 'knee', 'ratio', 'attack', 'release']) {
      result[key] = param(key === 'gain' || key === 'playbackRate' ? 1 : 0);
    }
    if (type === 'Oscillator' || type === 'BufferSource') {
      sources.push(result);
      result.start = (at = time, offset = 0) => {
        result.started = at;
        result.scheduledAt = time;
        result.offset = offset;
        if (type === 'BufferSource') assert.ok(result.buffer);
      };
      result.stop = at => { result.stopped = at; };
    }
    nodes.push(result);
    return result;
  }
  const audio = {
    sampleRate: 12000,
    get currentTime() { return time; },
    get state() { return state; },
    destination: { type: 'Destination' },
    resume() { state = 'running'; return Promise.resolve(); },
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buffer = { numberOfChannels: channels, length, sampleRate, getChannelData: ch => data[ch] };
      buffers.push(buffer);
      return buffer;
    }
  };
  for (const type of ['Gain', 'StereoPanner', 'BiquadFilter', 'DynamicsCompressor', 'Oscillator', 'BufferSource', 'Convolver']) {
    audio['create' + type] = () => node(type);
  }
  let contexts = 0;
  const window = {
    Meadow: { utils: { rand: (a, b) => (a + b) / 2, clamp: (x, low, high) => Math.min(high, Math.max(low, x)) } },
    AudioContext: function () { contexts++; return audio; }
  };
  const context = vm.createContext({ window, console, Math, Float32Array,
    setInterval: fn => { intervals.add(fn); return fn; },
    clearInterval: fn => intervals.delete(fn)
  });
  for (const name of ['audio', 'music']) {
    vm.runInContext(readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'), context);
  }
  function advance(to, tick = true) {
    time = to;
    // Deliver each ended callback once, just as Web Audio does.
    for (const source of sources) {
      const naturalEnd = source.buffer && !source.loop ? source.started + (source.buffer.length / source.buffer.sampleRate - source.offset) / source.playbackRate.value : Infinity;
      if (!source.ended && Math.min(source.stopped ?? Infinity, naturalEnd) <= time) {
        source.ended = true;
        if (source.onended) source.onended();
      }
    }
    if (tick) for (const fn of intervals) {
      try { fn(); } catch (err) { errors.push(err); }
    }
  }
  return { M: window.Meadow, audio, nodes, sources, buffers, intervals, errors, advance,
    setState(value) { state = value; }, get contexts() { return contexts; } };
}

const effects = [
  ...['boss', 'raider', 'worm', 'binder', 'prismback', 'sower'].flatMap(species =>
    ['warn', 'cast', 'hurt', 'death', 'idle', 'step', 'bite'].map(event => ['enemy', species, event, { x: 0, y: 0, z: 0 }])),
  ['enemy', 'boat', 'land', { x: 0, y: 0, z: 0 }],
  ['enemy', 'parachute', 'open', { x: 0, y: 0, z: 0 }], ['enemy', 'parachute', 'land', { x: 0, y: 0, z: 0 }],
  ...['ballista', 'mortar', 'frost', 'ember', 'venom', 'storm', 'sniper', 'earth', 'arcane', 'sun'].map(id => ['towerImpact', { x: 0, y: 0, z: 0 }, id]),
  ['towerShot', { x: 0, y: 0, z: 0 }, 'shell'], ['towerShot', { x: 0, y: 0, z: 0 }, 'bolt'],
  ['towerShot', { x: 0, y: 0, z: 0 }, 'crystal'], ['towerShot', { x: 0, y: 0, z: 0 }, 'coil'],
  ...['ballista', 'mortar', 'frost', 'ember', 'venom', 'storm', 'sniper', 'earth', 'arcane', 'sun'].map((id, i) =>
    ['towerShot', null, ['bolt', 'shell', 'crystal', 'shell', 'crystal', 'coil', 'bolt', 'shell', 'crystal', 'coil'][i], id]),
  ...['stone', 'log', 'leaves', 'dirt', 'grass', 'coal', 'iron', 'copper'].flatMap(material =>
    [['block', 'break', null, material], ['block', 'place', null, material]]),
  ['cue', 'clear'], ['enemyBurst', { x: 0, y: 0, z: 0 }],
  ['bleat'], ['thud'], ['step', false, 4.8], ['step', true, 9.6], ['jump'], ['whoosh'],
  ['land', 1.2], ['stomp', false], ['stomp', true], ['pickup'], ['breath'], ['splash', 1],
  ['aerialStomp', 1], ['aerialStomp', 5], ['aerialStomp', 20],
  ['zombie', 'groan'], ['zombie', 'hurt'], ['zombie', 'death'], ['zombie', 'bite'],
  ['animal', 'sheep'], ['animal', 'cow'], ['animal', 'stag'], ['actorStep', 'zombie'],
  ['actorStep', 'cow'], ['actorJump', null, false], ['actorJump', null, true],
  ['block', 'break'], ['block', 'place'], ['cue', 'wave'], ['cue', 'damage'], ['cue', 'defeat'], ['select']
];

test('every effect has a silent attack/release, scheduling headroom, and frees its complete graph', () => {
  const h = harness();
  h.M.audio.unlock();
  const persistent = h.nodes.length;
  const bufferCount = h.buffers.length;
  for (let i = 0; i < effects.length; i++) {
    const [name, ...args] = effects[i];
    h.advance(i * 2, false);
    const firstNode = h.nodes.length;
    const firstSource = h.sources.length;
    h.M.audio[name](...args);
    const created = h.nodes.slice(firstNode);
    assert.ok(h.sources.length > firstSource, `${name} must actually create sources`);
    for (const source of h.sources.slice(firstSource)) {
      assert.ok(source.started >= source.scheduledAt + 0.02, `${name} starts with scheduling headroom`);
      assert.ok(source.stopped > source.started);
      if (source.buffer && !source.loop) {
        const end = source.started + (source.buffer.length / source.buffer.sampleRate - source.offset) / source.playbackRate.value;
        assert.ok(end >= source.stopped - 0.02, `${name} noise lasts through its release`);
      }
    }
    const envelopes = created.flatMap(node => node.gain.events.length ? [node.gain] : []);
    assert.ok(envelopes.length > 0);
    for (const gain of envelopes) {
      assert.equal(gain.events[0].value, 0, `${name} starts at zero`);
      assert.equal(gain.events.at(-1).value, 0, `${name} finishes at zero`);
      assert.ok(gain.events[1].at - gain.events[0].at >= 0.008 - 1e-9);
    }
    h.advance(i * 2 + 1.5, false);
    assert.ok(created.every(node => node.disconnected), `${name} leaves no connected voice nodes`);
  }
  assert.equal(h.contexts, 1);
  assert.equal(h.buffers.length, bufferCount, 'effects reuse noise rather than allocate buffers per hit');
  assert.ok(h.nodes.slice(persistent).every(node => node.disconnected));
});

test('music and effects share the protected output, and wind loops meet at zero', () => {
  const h = harness({ suspended: true });
  assert.equal(h.M.music.start(), true);
  h.M.audio.bleat();
  h.M.audio.thud();
  assert.equal(h.contexts, 1);
  const finalNodes = h.nodes.filter(node => node.connections.includes(h.audio.destination));
  assert.equal(finalNodes.length, 1, 'no music/effect bypass of the shared mixer');
  assert.equal(finalNodes[0].gain.value, 0.8);
  assert.ok(h.nodes.some(node => node.ratio.value === 8 && node.attack.value <= 0.005));
  const wind = h.sources.find(source => source.loop);
  assert.ok(wind);
  for (let ch = 0; ch < wind.buffer.numberOfChannels; ch++) {
    const data = wind.buffer.getChannelData(ch);
    assert.equal(Math.abs(data[0]), 0);
    assert.equal(Math.abs(data.at(-1)), 0);
    assert.ok(data.some(sample => sample !== 0), 'wind is not accidentally silent');
  }
});

test('late timers and suspended contexts do not produce overdue note bursts', () => {
  const h = harness();
  h.M.music.start();
  for (const time of [0.08, 0.16, 0.24, 0.32, 1.1, 1.7, 8, 8.08, 90, 90.08]) {
    const before = h.sources.length;
    h.advance(time);
    const added = h.sources.slice(before);
    assert.ok(added.length <= 18, 'a missed frame cannot replay the backlog');
    for (const source of added) assert.ok(source.started >= time + 0.03, 'notes must not start in the past');
  }
  const before = h.sources.length;
  h.setState('suspended');
  h.advance(95);
  assert.equal(h.sources.length, before);
  h.setState('running');
  h.advance(110);
  assert.ok(h.sources.length > before, 'playback resumes after suspension');
  for (const source of h.sources.slice(before)) assert.ok(source.started >= 110.03);
  assert.deepEqual(h.errors, []);
});

test('rapid music toggles preserve fade level and cancel all old queued notes', () => {
  const h = harness();
  h.M.music.start();
  const master = h.nodes.find(node => node.gain.events.some(event => event.value === 0.3));
  const oldSources = h.sources.filter(source => source.stopped !== undefined);
  h.advance(0.2, false);
  h.M.music.stop();
  const stopLevel = master.gain.events.findLast(event => event.type === 'set').value;
  assert.ok(Math.abs(stopLevel - 0.03) < 1e-8, 'stop holds the actual in-flight fade');
  assert.ok(oldSources.every(source => source.stopped <= 0.56));
  assert.equal(h.intervals.size, 0);
  h.advance(0.3, false);
  h.M.music.start();
  const restartLevel = master.gain.events.findLast(event => event.type === 'set').value;
  assert.ok(Math.abs(restartLevel - 0.02625) < 1e-8, 'restart continues from the fading level');
  assert.equal(h.intervals.size, 1);
  h.advance(0.6, false);
  assert.ok(oldSources.every(source => source.disconnected));
});

test('long playback releases transient graphs and effect storms have bounded polyphony', () => {
  const h = harness();
  h.M.music.start();
  let maxConnected = 0;
  for (let i = 1; i <= 1500; i++) {
    h.advance(i * 0.08);
    if (i % 3 === 0) h.M.audio.step(true, 9.6);
    maxConnected = Math.max(maxConnected, h.nodes.filter(node => node.connections.length).length);
  }
  assert.ok(maxConnected < 220, `connected nodes grew to ${maxConnected}`);
  assert.ok(h.sources.length > 500, 'the full song keeps producing notes across loops');
  assert.deepEqual(h.errors, []);
  h.M.music.stop();
  h.advance(123);
  assert.ok(h.sources.filter(source => source.stopped !== undefined).every(source => source.disconnected));
  const before = h.sources.length;
  for (let i = 0; i < 1000; i++) h.M.audio.thud();
  assert.ok(h.sources.length - before <= 96 * 3, 'voice count is bounded during effect storms');
  h.advance(125, false);
  const after = h.sources.length;
  h.M.audio.thud();
  assert.ok(h.sources.length > after, 'freed voices can be reused');
});


test('world sounds attenuate, pan with the camera, and cull distant events', () => {
  const h = harness();
  h.M.audio.unlock();
  const camera = { position: { x: 0, y: 0, z: 0 }, matrixWorld: { elements: [1, 0, 0] } };
  h.M.audio.setListener(camera);
  const first = h.nodes.length;
  h.M.audio.zombie('groan', { x: 4, y: 0, z: 0 });
  const near = h.nodes.slice(first);
  assert.ok(near.some(n => n.pan.value > 0.5), 'right-side groan comes from the right');
  const nearLevel = Math.max(...near.flatMap(n => n.gain.events.map(e => e.value)));
  h.advance(2, false);
  const second = h.nodes.length;
  camera.matrixWorld.elements[0] = -1;
  h.M.audio.setListener(camera);
  h.M.audio.zombie('groan', { x: 25, y: 0, z: 0 });
  const far = h.nodes.slice(second);
  assert.ok(far.some(n => n.pan.value < -0.5), 'turning the camera reverses stereo');
  const farLevel = Math.max(...far.flatMap(n => n.gain.events.map(e => e.value)));
  assert.ok(farLevel < nearLevel * 0.3, 'distant groans are much quieter');
  h.advance(4, false);
  const count = h.sources.length;
  h.M.audio.zombie('groan', { x: 100, y: 0, z: 0 });
  assert.equal(h.sources.length, count, 'offscreen distant horde does not allocate voices');
});

test('crowds are rate limited, suspended audio does not queue, and mute preserves music', () => {
  const h = harness();
  h.M.audio.unlock();
  const count = h.sources.length;
  for (let i = 0; i < 50; i++) {
    h.M.audio.zombie('groan', { x: 2, y: 0, z: 0 });
    h.M.audio.zombie('bite', { x: 2, y: 0, z: 0 });
    h.M.audio.actorStep('zombie', { x: 2, y: 0, z: 0 });
  }
  assert.ok(h.sources.length - count < 15, 'a whole wave cannot start fifty simultaneous groans');
  h.advance(2, false);
  assert.ok(h.sources.every(s => s.disconnected), 'the complete crowd graph is released');
  h.setState('suspended');
  const before = h.sources.length;
  h.M.audio.zombie('groan'); h.M.audio.thud();
  assert.equal(h.sources.length, before, 'paused contexts never queue ambient sounds');
  h.setState('running');
  h.M.audio.setEffectsEnabled(false);
  h.M.audio.zombie('hurt'); h.M.audio.pickup();
  assert.equal(h.sources.length, before, 'muted effects allocate no sources');
  h.M.music.start();
  assert.ok(h.sources.length > before, 'music remains independent of effects mute');
  h.M.audio.setEffectsEnabled(true);
  const playing = h.sources.length;
  h.M.audio.zombie('hurt');
  assert.ok(h.sources.length > playing, 'unmuting restores effects');
});

test('combat layers build and recover, caves darken, and pause reaches both dry and wet paths', () => {
  function run(combat) {
    const h = harness();
    h.M.music.start();
    for (let i = 1; i <= 400; i++) {
      h.advance(i * 0.08);
      h.M.music.update(0.08, { combat, speed: 7 });
    }
    return h;
  }
  const calm = run(0), battle = run(1);
  assert.ok(battle.sources.length > calm.sources.length * 1.4, 'battle adds actual instrumental layers');
  const action = battle.nodes.find(n => n.gain.events.some(e => e.type === 'target' && e.constant === 0.5 && e.value > 0.95));
  assert.ok(action, 'combat bus smoothly opens');
  battle.advance(32.08);
  battle.M.music.update(0.08, { combat: 0, underground: true });
  const colour = battle.nodes.find(n => n.frequency.events.some(e => e.type === 'target' && e.value === 2100));
  assert.ok(colour, 'caves get a darker tonal balance');
  for (let i = 402; i <= 900; i++) {
    battle.advance(i * 0.08);
    battle.M.music.update(0.08, { combat: 0, underground: true });
  }
  assert.ok(action.gain.events.at(-1).value < 0.001, 'rhythm recedes after a wave');
  // The visibility event can arrive in the same audio clock tick as a mix update.
  battle.M.music.update(0, { paused: true });
  const dimmed = battle.nodes.filter(n => n.gain.events.at(-1)?.type === 'target' && Math.abs(n.gain.events.at(-1).value - 0.12) < 0.001);
  const wet = battle.nodes.filter(n => n.gain.events.at(-1)?.type === 'target' && Math.abs(n.gain.events.at(-1).value - 0.096) < 0.001);
  assert.ok(dimmed.length >= 1 && wet.length >= 1, 'pause dims reverb sends as well as the direct music');
  assert.equal(battle.intervals.size, 1, 'scene changes keep the transport running');
  assert.deepEqual(battle.errors, []);
});

test('danger adds rhythm, defeat releases it, and full-suite battle playback stays bounded', () => {
  const h = harness();
  h.M.music.update(10, { danger: 1 });
  h.M.music.start();
  let peak = 0;
  for (let i = 1; i <= 2800; i++) {
    h.advance(i * 0.08);
    h.M.music.update(0.08, { danger: 1, combat: 1, speed: 9.6 });
    peak = Math.max(peak, h.nodes.filter(n => n.connections.length).length);
  }
  assert.ok(peak < 350, `battle graph stays bounded across all sections and variations (${peak})`);
  h.M.music.update(60, { danger: 1, combat: 1, defeated: true });
  const action = h.nodes.find(n => n.gain.events.some(e => e.type === 'target' && e.constant === 0.5 && e.value > 0.95));
  assert.ok(action.gain.events.at(-1).value < 0.0001, 'defeat overrides combat and danger');
  h.M.music.stop(); h.advance(230, false);
  assert.ok(h.sources.filter(s => s.stopped !== undefined).every(s => s.disconnected));
  assert.deepEqual(h.errors, []);
});

test('important cues duck only music and overlapping cues keep a continuous gain', () => {
  const h = harness();
  h.M.music.start();
  h.M.audio.cue('wave');
  const bus = h.nodes.find(n => n.gain.events.some(e => e.type === 'linear' && e.value === 0.4));
  assert.ok(bus);
  h.advance(0.01, false);
  h.M.audio.cue('damage');
  const held = bus.gain.events.findLast(e => e.type === 'set').value;
  assert.ok(Math.abs(held - 0.76) < 1e-8, 'second cue starts at the first cue\'s in-flight level');
  assert.equal(bus.gain.events.at(-1).value, 1, 'music recovers automatically');
  const before = h.sources.length;
  h.M.audio.setEffectsEnabled(false);
  h.M.audio.cue('defeat');
  assert.equal(h.sources.length, before, 'muted cues do not trigger a duck');
});

test('aerial stomp damage selects three distinct impact sounds with clean mute and zero-damage behavior', () => {
  const h = harness(); h.M.audio.unlock();
  function signature(scale) {
    const first = h.sources.length;
    h.M.audio.aerialStomp(scale);
    return JSON.stringify(h.sources.slice(first).map(s => [s.type, s.frequency.events, s.stopped-s.started]));
  }
  const light = signature(1), medium = signature(5), heavy = signature(20);
  assert.equal(new Set([light,medium,heavy]).size,3, 'tiers change timbre, layering and decay, beyond volume');
  assert.equal(signature(2.99),light);
  assert.equal(signature(3),medium);
  assert.equal(signature(11.99),medium);
  assert.equal(signature(12),heavy);
  assert.equal(signature(100),heavy, 'very high falls retain the heavy impact identity');
  const before = h.sources.length;
  h.M.audio.aerialStomp(0);
  assert.equal(h.sources.length,before, 'a zero-damage landing plays no stomp');
  h.M.audio.setEffectsEnabled(false);
  h.M.audio.aerialStomp(20);
  assert.equal(h.sources.length,before, 'all stomp tiers honor the effects mute');
});

test('tower identities and block materials have distinct physical sound signatures', () => {
  const h = harness(); h.M.audio.unlock();
  function signature(method, ...args) {
    const first = h.sources.length;
    h.M.audio[method](...args);
    return JSON.stringify(h.sources.slice(first).map(s => [s.type, s.frequency.events, s.stopped - s.started]));
  }
  const ids = ['ballista', 'mortar', 'frost', 'ember', 'venom', 'storm', 'sniper', 'earth', 'arcane', 'sun'];
  const styles = ['bolt', 'shell', 'crystal', 'shell', 'crystal', 'coil', 'bolt', 'shell', 'crystal', 'coil'];
  const shots = new Set(), impacts = new Set();
  for (let i = 0; i < ids.length; i++) {
    // Use the same time for signatures, and a fresh family for each tower.
    shots.add(signature('towerShot', null, styles[i], ids[i]));
    impacts.add(signature('towerImpact', null, ids[i]));
  }
  assert.equal(shots.size, 10, 'all ten weapons have a distinct launch');
  assert.equal(impacts.size, 10, 'all ten elements have a distinct impact');
  const materials = new Set();
  for (const material of ['stone', 'log', 'leaves', 'dirt']) {
    const separate = harness(); separate.M.audio.unlock();
    separate.M.audio.block('break', null, material);
    materials.add(JSON.stringify(separate.sources.map(s => [s.type, s.frequency.events, s.stopped - s.started])));
  }
  assert.equal(materials.size, 4, 'stone, wood, foliage and soil sound different');
});


test('dense effects reserve enough voices for music to keep its beat', () => {
  const h = harness(); h.M.audio.unlock();
  for (let i = 0; i < 300; i++) h.M.audio.thud();
  const before = h.sources.length;
  h.M.music.start();
  assert.ok(h.sources.length > before + 5, 'the initial chord and picking survive an effect storm');
  h.advance(0.4);
  const next = h.sources.length;
  h.advance(1.1);
  assert.ok(h.sources.length > next, 'the next beat still schedules');
  assert.deepEqual(h.errors, []);
});
