(function (M) {
  'use strict';

  const { rand, clamp } = M.utils;
  const LEAD = 0.025;
  const MAX_VOICES = 96;
  let ctx = null;
  let effects = null;
  let music = null;
  let noiseBuffer = null;
  let stepSide = 1;
  const voices = new Set();

  function buildMixer() {
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 25;
    high.Q.value = 0.5;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 10000;
    low.Q.value = 0.5;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    const output = ctx.createGain();
    output.gain.value = 0.8;
    effects = ctx.createGain();
    effects.gain.value = 0.75;
    music = ctx.createGain();
    effects.connect(high);
    music.connect(high);
    high.connect(low);
    low.connect(compressor);
    compressor.connect(output);
    output.connect(ctx.destination);
  }

  function unlock() {
    try {
      if (!ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        ctx = new Ctx({ latencyHint: 'interactive' });
        buildMixer();
        noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 1.5), ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') {
        const pending = ctx.resume();
        if (pending && pending.catch) pending.catch(function () {});
      }
      return ctx;
    } catch (err) {
      return null;
    }
  }

  // Every source enters and leaves at exact silence. Exponential releases
  // approach zero; a final short linear tail reaches it before source.stop().
  function envelope(param, when, duration, level, attack, hold) {
    attack = attack === undefined ? 0.012 : attack;
    hold = hold === undefined ? attack : hold;
    param.value = 0;
    param.setValueAtTime(0, when);
    param.linearRampToValueAtTime(level, when + attack);
    if (hold > attack) param.setValueAtTime(level, when + hold);
    param.exponentialRampToValueAtTime(0.00001, when + duration - 0.012);
    param.linearRampToValueAtTime(0, when + duration);
  }

  // A voice owns its whole graph, including its panner. Disconnect it after
  // the last source ends, so long play sessions do not accumulate idle nodes.
  function createVoice(destination, pan) {
    if (!ctx || voices.size >= MAX_VOICES) return null;
    const nodes = [];
    const sources = [];
    let pending = 0;
    function create(type) {
      const node = ctx['create' + type]();
      nodes.push(node);
      return node;
    }
    const input = create('StereoPanner');
    input.pan.value = pan || 0;
    const output = create('Gain');
    input.connect(output);
    output.connect(destination || effects);
    const voice = {
      input: input,
      output: output,
      create: create,
      onended: null,
      start: function (source, when, end, offset) {
        sources.push(source);
        pending++;
        source.onended = function () {
          pending--;
          if (pending !== 0) return;
          for (const node of nodes) node.disconnect();
          voices.delete(voice);
          if (voice.onended) voice.onended();
        };
        if (offset === undefined) source.start(when);
        else source.start(when, offset);
        source.stop(end);
      },
      stop: function (when) {
        const now = ctx.currentTime;
        output.gain.cancelScheduledValues(now);
        output.gain.setValueAtTime(output.gain.value, now);
        output.gain.linearRampToValueAtTime(0, Math.max(now + 0.02, when));
        for (const source of sources) source.stop(Math.max(now + 0.03, when + 0.01));
      }
    };
    voices.add(voice);
    return voice;
  }

  function tone(voice, when, options) {
    const duration = options.duration;
    const osc = voice.create('Oscillator');
    osc.type = options.type || 'sine';
    osc.frequency.setValueAtTime(options.frequency, when);
    if (options.endFrequency) osc.frequency.exponentialRampToValueAtTime(options.endFrequency, when + duration * 0.8);
    const gain = voice.create('Gain');
    envelope(gain.gain, when, duration, options.level, options.attack, options.hold);
    osc.connect(gain);
    gain.connect(voice.input);
    voice.start(osc, when, when + duration + 0.02);
  }

  function noise(voice, when, options) {
    const src = voice.create('BufferSource');
    src.buffer = noiseBuffer;
    src.playbackRate.value = options.rate || 1;
    const filter = voice.create('BiquadFilter');
    filter.type = options.type || 'bandpass';
    filter.Q.value = options.q || 0.65;
    filter.frequency.setValueAtTime(options.frequency, when);
    if (options.endFrequency) filter.frequency.exponentialRampToValueAtTime(options.endFrequency, when + options.duration * 0.8);
    const gain = voice.create('Gain');
    envelope(gain.gain, when, options.duration, options.level, options.attack);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(voice.input);
    voice.start(src, when, when + options.duration + 0.02, rand(0, 0.3));
  }

  function play(pan, wake, build) {
    try {
      const audio = wake ? unlock() : ctx;
      if (!audio || audio.state === 'closed') return;
      const voice = createVoice(effects, pan);
      if (voice) build(voice, audio.currentTime + LEAD);
    } catch (err) { /* audio is a bonus, never fatal */ }
  }

  function bleat() {
    play(0, true, function (voice, when) {
      const base = rand(235, 275);
      const osc = voice.create('Oscillator');
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base, when);
      osc.frequency.linearRampToValueAtTime(base * 1.12, when + 0.09);
      osc.frequency.exponentialRampToValueAtTime(base * 0.65, when + 0.55);
      const vib = voice.create('Oscillator');
      vib.frequency.value = rand(18, 23);
      const vibGain = voice.create('Gain');
      vibGain.gain.value = 16;
      vib.connect(vibGain);
      vibGain.connect(osc.frequency);
      const filter = voice.create('BiquadFilter');
      filter.type = 'lowpass';
      filter.frequency.value = 1350;
      filter.Q.value = 0.9;
      const body = voice.create('BiquadFilter');
      body.type = 'peaking';
      body.frequency.value = 800;
      body.gain.value = 3;
      body.Q.value = 1;
      const gain = voice.create('Gain');
      envelope(gain.gain, when, 0.6, 0.11, 0.04, 0.17);
      osc.connect(filter);
      filter.connect(body);
      body.connect(gain);
      gain.connect(voice.input);
      voice.start(osc, when, when + 0.62);
      voice.start(vib, when, when + 0.62);
    });
  }

  function thud() {
    play(0, false, function (voice, when) {
      noise(voice, when, { type: 'lowpass', frequency: 700, duration: 0.18, level: 0.065 });
      tone(voice, when, { frequency: 95, endFrequency: 55, duration: 0.19, level: 0.09 });
      noise(voice, when, { frequency: 1250, duration: 0.09, level: 0.009 });
    });
  }

  function step(running, speed) {
    stepSide *= -1;
    play(stepSide * (running ? 0.2 : 0.14), false, function (voice, when) {
      const level = (running ? 0.038 : 0.026) * (0.75 + clamp(speed / 9.6, 0, 1) * 0.4);
      const frequency = running ? rand(84, 100) : rand(100, 120);
      tone(voice, when, { frequency: frequency, endFrequency: frequency * 0.55, duration: 0.13, level: level, attack: 0.009 });
      noise(voice, when, { frequency: rand(650, 1100), duration: 0.1, level: level * 0.3 });
    });
  }

  function jump() {
    play(0.1, true, function (voice, when) {
      noise(voice, when, { frequency: 520, endFrequency: 1000, duration: 0.3, level: 0.013, attack: 0.025 });
      tone(voice, when, { type: 'triangle', frequency: 145, endFrequency: 210, duration: 0.17, level: 0.0045, attack: 0.025 });
    });
  }

  function whoosh() {
    play(0.1, true, function (voice, when) {
      noise(voice, when, { frequency: 340, endFrequency: 1250, duration: 0.24, level: 0.016, attack: 0.03 });
    });
  }

  function land(force) {
    play(0, false, function (voice, when) {
      const strength = clamp(force, 0.3, 1.2);
      tone(voice, when, { frequency: 96, endFrequency: 46, duration: 0.24, level: 0.05 * strength });
      noise(voice, when, { frequency: 560, duration: 0.18, level: 0.014 * strength });
    });
  }

  function stomp(broke) {
    play(0, true, function (voice, when) {
      tone(voice, when, { frequency: 86, endFrequency: 42, duration: 0.28, level: 0.07 });
      noise(voice, when, { frequency: 420, duration: 0.21, level: 0.024 });
      if (broke) {
        noise(voice, when, { frequency: 1300, duration: 0.12, level: 0.014 });
        noise(voice, when + 0.015, { frequency: 850, duration: 0.2, level: 0.008, attack: 0.025 });
      }
    });
  }

  function pickup() {
    play(rand(-0.15, 0.15), true, function (voice, when) {
      // A stable perfect fifth is gentler than two independently random pitches.
      const root = 659.255 * rand(0.998, 1.002);
      tone(voice, when, { type: 'sine', frequency: root, duration: 0.24, level: 0.03, attack: 0.016 });
      tone(voice, when + 0.07, { type: 'sine', frequency: root * 1.5, duration: 0.28, level: 0.024, attack: 0.018 });
    });
  }

  function breath() {
    play(rand(-0.1, 0.1), false, function (voice, when) {
      noise(voice, when, { type: 'lowpass', frequency: 580, duration: 0.8, level: 0.004, attack: 0.28 });
    });
  }

  function splash(strength) {
    play(rand(-0.12, 0.12), false, function (voice, when) {
      noise(voice, when, { frequency: 1000, endFrequency: 340, duration: 0.42, level: 0.065 * clamp(strength, 0.05, 1), rate: rand(0.72, 0.92), attack: 0.03 });
    });
  }

  M.audio = {
    unlock: unlock,
    createVoice: createVoice,
    envelope: envelope,
    getMusicInput: function () { return music; },
    bleat: bleat,
    thud: thud,
    step: step,
    jump: jump,
    whoosh: whoosh,
    land: land,
    stomp: stomp,
    pickup: pickup,
    breath: breath,
    splash: splash
  };
})(window.Meadow = window.Meadow || {});
