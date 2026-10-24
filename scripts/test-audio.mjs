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
      cancelScheduledValues(at) { this.events = this.events.filter(event => event.at < at); }
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
  ['bleat'], ['thud'], ['step', false, 4.8], ['step', true, 9.6], ['jump'], ['whoosh'],
  ['land', 1.2], ['stomp', false], ['stomp', true], ['pickup'], ['breath'], ['splash', 1]
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
