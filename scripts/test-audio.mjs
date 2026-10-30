import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Record real script scheduling and graph lifetime without speakers or npm.
function harness({ suspended = false, missingTrack = false } = {}) {
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
  const track = {
    paused: true, volume: 1, currentTime: 0, playCalls: 0, pauseCalls: 0,
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    play() { this.playCalls++; this.paused = false; return Promise.resolve(); },
    pause() { this.pauseCalls++; this.paused = true; }
  };
  let contexts = 0;
  const window = {
    Meadow: { utils: { rand: (a, b) => (a + b) / 2, clamp: (x, low, high) => Math.min(high, Math.max(low, x)) } },
    AudioContext: function () { contexts++; return audio; }
  };
  const context = vm.createContext({ window, console, Math, Float32Array,
    document: { getElementById: id => id === 'game-music' && !missingTrack ? track : null },
    performance: { now: () => time * 1000 },
    setInterval: fn => { intervals.add(fn); return fn; },
    clearInterval: fn => intervals.delete(fn)
  });
  for (const name of ['audio', 'music']) {
    vm.runInContext(readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'), context);
  }
  function advance(to, tick = true) {
    if (!track.paused) track.currentTime = (track.currentTime + Math.max(0, to - time)) % 104.05263;
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
  return { M: window.Meadow, audio, track, nodes, sources, buffers, intervals, errors, advance,
    setState(value) { state = value; }, get contexts() { return contexts; } };
}

const effects = [
  ...['boss', 'raider', 'worm', 'binder', 'prismback', 'sower', 'cinderwing'].flatMap(species =>
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

test('ocean cinematic cues release every source and reuse the shared noise buffer', () => {
  const h = harness(); h.M.audio.unlock();
  const persistent = h.nodes.length, buffers = h.buffers.length;
  for (const [i, stage] of ['rise', 'roar', 'grab', 'death'].entries()) {
    h.advance(i * 5, false);
    const before = h.sources.length;
    h.M.audio.oceanHorror(stage);
    assert.ok(h.sources.length > before);
    for (const source of h.sources.slice(before)) if (source.buffer) {
      const end = source.started + (source.buffer.length / source.buffer.sampleRate - source.offset) / source.playbackRate.value;
      assert.ok(end >= source.stopped - .02, 'noise continues through its release');
    }
    h.advance(i * 5 + 4, false);
    assert.ok(h.nodes.slice(persistent).every(node => node.disconnected));
  }
  assert.equal(h.buffers.length, buffers);
});

test('native soundtrack starts on request while effects retain their protected output', () => {
  const h = harness({ suspended: true });
  assert.equal(h.track.playCalls, 0, 'no autoplay before a gesture');
  assert.equal(h.M.music.start(), true);
  assert.equal(h.track.playCalls, 1);
  assert.equal(h.contexts, 0, 'music does not depend on a running Web Audio context');
  h.advance(1.2);
  assert.equal(h.track.volume, 0.12);
  h.M.audio.bleat();
  assert.equal(h.contexts, 1);
  const output = h.nodes.filter(node => node.connections.includes(h.audio.destination));
  assert.equal(output.length, 1, 'effects keep their protected mixer');
  assert.equal(output[0].gain.value, 0.8);
  const effectsBus = h.nodes.find(node => node.type === 'Gain' && node.connections.some(target => target.type === 'highpass' && target.frequency.value === 25));
  assert.equal(effectsBus.gain.value, 1.5, 'effects get the louder mix before compression');
  h.M.audio.setEffectsEnabled(false);
  assert.equal(effectsBus.gain.events.at(-1).value, 0);
  h.M.audio.setEffectsEnabled(true);
  assert.equal(effectsBus.gain.events.at(-1).value, 1.5, 'unmuting restores the boosted level');
  assert.equal(h.track.volume, 0.12, 'effects gain does not raise music');
  assert.ok(h.nodes.some(node => node.ratio.value === 8 && node.attack.value <= 0.005));
});

test('music toggles fade continuously, resume position, and leave no idle timers', () => {
  const h = harness();
  h.M.music.start();
  h.advance(0.3);
  const before = h.track.volume;
  h.M.music.stop();
  assert.equal(h.track.volume, before, 'stop holds the in-flight fade');
  h.advance(0.4);
  const fading = h.track.volume;
  h.M.music.start();
  assert.equal(h.track.volume, fading, 'restart holds the fading level');
  assert.equal(h.intervals.size, 1);
  h.advance(2);
  assert.equal(h.track.paused, false, 'an old stop cannot pause a newer start');
  assert.equal(h.track.volume, 0.12);
  h.M.music.stop();
  h.advance(2.4);
  assert.equal(h.track.volume, 0);
  assert.equal(h.track.paused, true);
  assert.equal(h.intervals.size, 0);
  const position = h.track.currentTime;
  assert.ok(position > 0);
  h.advance(6);
  h.M.music.start();
  assert.equal(h.track.currentTime, position, 'the next start resumes rather than resets');
  h.M.music.stop();
  h.advance(7);
  assert.equal(h.intervals.size, 0);
});

test('blocked or failed playback is caught and can retry on the next gesture', async () => {
  const h = harness();
  h.track.play = () => Promise.reject(new Error('NotAllowedError'));
  h.M.music.start();
  await Promise.resolve();
  assert.equal(h.M.music.isPlaying(), false);
  assert.equal(h.track.paused, true);
  assert.equal(h.intervals.size, 0);
  h.track.play = function () { this.paused = false; return Promise.resolve(); };
  assert.equal(h.M.music.start(), true);
  await Promise.resolve();
  assert.equal(h.M.music.isPlaying(), true);
  h.track.listeners.error();
  assert.equal(h.M.music.isPlaying(), false);
  assert.equal(h.track.volume, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(harness({ missingTrack: true }).M.music.start(), false);
});

test('a late play rejection cannot cancel a newer successful playback', async () => {
  const h = harness();
  let reject;
  h.track.play = () => new Promise((resolve, fail) => { reject = fail; });
  h.M.music.start();
  h.M.music.stop();
  h.track.play = function () { this.paused = false; return Promise.resolve(); };
  h.M.music.start();
  reject(new Error('AbortError'));
  await Promise.resolve();
  assert.equal(h.M.music.isPlaying(), true);
  h.advance(2);
  assert.equal(h.track.volume, 0.12);
  assert.equal(h.intervals.size, 1);
});

test('late timers and long native playback cannot replay notes or allocate growing graphs', () => {
  const h = harness();
  h.M.music.start();
  h.advance(1);
  h.advance(1000);
  h.advance(36000);
  assert.equal(h.track.playCalls, 1);
  assert.equal(h.track.paused, false);
  assert.equal(h.track.volume, 0.12);
  assert.equal(h.sources.length, 0);
  assert.equal(h.nodes.length, 0);
  assert.equal(h.intervals.size, 1);
  h.M.music.stop(); h.advance(36001);
  assert.equal(h.intervals.size, 0);
  h.M.audio.unlock();
  const before = h.sources.length;
  for (let i = 0; i < 1000; i++) h.M.audio.thud();
  assert.ok(h.sources.length - before <= 96 * 3, 'effect storms still respect the voice budget');
  h.advance(36003);
  assert.ok(h.sources.every(source => source.disconnected));
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
  assert.equal(h.track.paused, false, 'music remains independent of effects mute');
  h.M.audio.setEffectsEnabled(true);
  const playing = h.sources.length;
  h.M.audio.zombie('hurt');
  assert.ok(h.sources.length > playing, 'unmuting restores effects');
});

test('pause, caves and defeat lower the recorded score without restarting it', () => {
  const h = harness();
  h.M.music.start();
  h.advance(2);
  const full = h.track.volume;
  h.M.music.update(0, { paused: true });
  h.advance(2.3);
  assert.ok(Math.abs(h.track.volume - full * 0.12) < 1e-8);
  h.M.music.update(0.1, { underground: true });
  h.advance(3.2);
  assert.ok(Math.abs(h.track.volume - full * 0.75) < 1e-8);
  h.M.music.update(0.1, { defeated: true, danger: 1, combat: 1 });
  h.advance(4.1);
  assert.ok(Math.abs(h.track.volume - full * 0.35) < 1e-8);
  h.M.music.update(0.1, {});
  h.advance(5);
  assert.equal(h.track.volume, full);
  assert.equal(h.track.playCalls, 1);
  assert.equal(h.track.paused, false);
  assert.deepEqual(h.errors, []);
});

test('important cues duck native music, overlap continuously, and honor effects mute', () => {
  const h = harness();
  h.M.audio.unlock();
  h.M.music.start(); h.advance(2);
  h.M.audio.cue('wave');
  h.advance(2.01, false);
  h.M.audio.cue('damage');
  assert.ok(Math.abs(h.track.volume - 0.12 * 0.76) < 1e-8,
    'overlapping cue holds the previous in-flight duck level');
  h.advance(2.04);
  assert.ok(h.track.volume < 0.12 * 0.6, 'cue lowers the actual media volume');
  h.advance(3.2);
  assert.equal(h.track.volume, 0.12, 'music recovers automatically');
  const before = h.sources.length;
  h.M.audio.setEffectsEnabled(false);
  h.M.audio.cue('defeat');
  h.advance(3.3);
  assert.equal(h.track.volume, 0.12, 'muted cues do not duck music');
  assert.equal(h.sources.length, before);
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


test('native music remains independent of dense effects and their mute switch', () => {
  const h = harness(); h.M.audio.unlock();
  for (let i = 0; i < 300; i++) h.M.audio.thud();
  const before = h.sources.length;
  h.M.music.start();
  assert.equal(h.track.paused, false);
  assert.equal(h.sources.length, before, 'music consumes none of the effect voice budget');
  h.advance(1.2);
  h.M.audio.setEffectsEnabled(false);
  assert.equal(h.track.volume, 0.12);
  h.M.music.stop(); h.advance(2);
  const beforeMutedEffect = h.sources.length;
  h.M.audio.thud();
  assert.equal(h.sources.length, beforeMutedEffect);
  assert.equal(h.track.paused, true);
  assert.deepEqual(h.errors, []);
});
