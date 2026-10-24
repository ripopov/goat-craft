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
  let effectsEnabled = true;
  const listener = { x: 0, y: 0, z: 0, rightX: 1, rightZ: 0 };
  const lastSound = Object.create(null);
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
    effects.gain.value = effectsEnabled ? 0.75 : 0;
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
      if (!audio || audio.state !== 'running' || !effectsEnabled) return;
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
      noise(voice, when, { frequency: 1700, endFrequency: 900, duration: 0.11, level: 0.09, attack: 0.009 });
      tone(voice, when, { type: 'triangle', frequency: 175, endFrequency: 150, duration: 0.09, level: 0.035, attack: 0.009 });
    });
  }

  function step(running, speed) {
    stepSide *= -1;
    play(stepSide * (running ? 0.2 : 0.14), false, function (voice, when) {
      const level = (running ? 0.038 : 0.026) * (0.75 + clamp(speed / 9.6, 0, 1) * 0.4);
      const frequency = running ? rand(155, 175) : rand(175, 195);
      tone(voice, when, { frequency: frequency, endFrequency: frequency * 0.9, duration: 0.075, level: level * 0.6, attack: 0.009 });
      noise(voice, when, { frequency: rand(1500, 2300), duration: 0.09, level: level * 0.65 });
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
      tone(voice, when, { type: 'triangle', frequency: 145, endFrequency: 125, duration: 0.13, level: 0.035 * strength });
      noise(voice, when, { frequency: 1200, duration: 0.16, level: 0.04 * strength });
    });
  }

  function stomp(broke) {
    play(0, true, function (voice, when) {
      tone(voice, when, { type: 'triangle', frequency: 120, endFrequency: 100, duration: 0.14, level: 0.05 });
      noise(voice, when, { frequency: 950, duration: 0.15, level: 0.065 });
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

  // Distance and camera-relative stereo keep a crowd readable. Cooldowns use
  // audio time, so fixed-step catch-up cannot produce a burst of stale sounds.
  function nearby(point, radius, family, interval, build) {
    if (!ctx || ctx.state !== 'running' || !effectsEnabled) return;
    const dx = point ? point.x - listener.x : 0;
    const dz = point ? point.z - listener.z : 0;
    const dy = point ? (point.y || 0) - listener.y : 0;
    const distance = Math.hypot(dx, dz, dy * 0.5);
    if (distance >= radius) return;
    if (lastSound[family] !== undefined && ctx.currentTime - lastSound[family] < interval) return;
    lastSound[family] = ctx.currentTime;
    const pan = clamp((dx * listener.rightX + dz * listener.rightZ) / Math.max(3, distance), -0.85, 0.85);
    const level = Math.pow(1 - distance / radius, 2);
    play(pan, false, function (voice, when) { build(voice, when, level); });
  }

  // A breathy glottal voice with three moving vowel resonances. Keep pitch
  // nearly steady and cut sub-bass: big bass slides read as comic burps.
  function vocal(voice, when, base, duration, level, formant) {
    const throat = voice.create('Oscillator');
    throat.type = 'sawtooth';
    throat.frequency.setValueAtTime(base, when);
    throat.frequency.linearRampToValueAtTime(base * 1.035, when + duration * 0.2);
    throat.frequency.linearRampToValueAtTime(base * 0.94, when + duration);
    const wobble = voice.create('Oscillator');
    wobble.frequency.value = rand(2.7, 3.5);
    const depth = voice.create('Gain');
    depth.gain.value = base * 0.012;
    wobble.connect(depth); depth.connect(throat.frequency);
    const highpass = voice.create('BiquadFilter');
    highpass.type = 'highpass'; highpass.frequency.value = 180; highpass.Q.value = 0.7;
    throat.connect(highpass);
    [formant, formant * 2.1, 2500].forEach(function (frequency, i) {
      const filter = voice.create('BiquadFilter');
      filter.type = 'bandpass'; filter.Q.value = [3.5, 5, 4][i];
      filter.frequency.setValueAtTime(frequency * 0.85, when);
      filter.frequency.linearRampToValueAtTime(frequency, when + duration * 0.25);
      filter.frequency.linearRampToValueAtTime(frequency * (i ? 0.95 : 0.72), when + duration);
      const gain = voice.create('Gain');
      envelope(gain.gain, when, duration, level * [1, 0.7, 0.35][i], 0.07, duration * 0.35);
      highpass.connect(filter); filter.connect(gain); gain.connect(voice.input);
    });
    noise(voice, when, { frequency: 2300, duration: duration, level: level * 0.14, attack: 0.08 });
    voice.start(throat, when, when + duration + 0.02);
    voice.start(wobble, when, when + duration + 0.02);
  }

  function zombie(kind, point) {
    nearby(point, kind === 'groan' ? 42 : 30, 'zombie-' + kind, kind === 'groan' ? 0.75 : 0.1, function (voice, when, level) {
      if (kind === 'bite') {
        noise(voice, when, { frequency: 2100, endFrequency: 1300, duration: 0.1, level: level * 0.1, attack: 0.009 });
        noise(voice, when + 0.06, { frequency: 1400, duration: 0.09, level: level * 0.05, attack: 0.009 });
      } else {
        const duration = kind === 'hurt' ? 0.3 : kind === 'death' ? 0.85 : rand(1.05, 1.35);
        vocal(voice, when, rand(125, 150) * (kind === 'hurt' ? 1.25 : 1), duration,
          level * (kind === 'groan' ? 0.3 : 0.34), kind === 'hurt' ? 780 : 620);
        if (kind === 'death') noise(voice, when + 0.2, { frequency: 1800, endFrequency: 1100, duration: 0.48, level: level * 0.055, attack: 0.05 });
      }
    });
  }

  function animal(species, point) {
    nearby(point, 30, 'animal', 1.5, function (voice, when, level) {
      const cow = species === 'cow', stag = species === 'stag';
      vocal(voice, when, cow ? rand(95, 115) : stag ? rand(125, 145) : rand(220, 260),
        cow ? 1.1 : 0.65, level * 0.13, cow ? 330 : stag ? 580 : 850);
    });
  }

  function block(kind, point) {
    nearby(point, 25, 'block-' + kind, 0.07, function (voice, when, level) {
      const placing = kind === 'place';
      noise(voice, when, { frequency: placing ? 480 : 1500, endFrequency: 350, duration: placing ? 0.16 : 0.3, level: level * 0.09 });
      tone(voice, when, { type: 'triangle', frequency: placing ? 200 : 160, endFrequency: 140, duration: 0.09, level: level * 0.035 });
      if (!placing) noise(voice, when + 0.07, { frequency: 2200, duration: 0.19, level: level * 0.035 });
    });
  }

  function enemyBurst(point) {
    nearby(point, 40, 'enemy-burst', 0.12, function (voice, when, level) {
      noise(voice, when, { frequency: 1250, endFrequency: 700, duration: 0.28, level: level * 0.14, attack: 0.008 });
      noise(voice, when + 0.04, { frequency: 2500, endFrequency: 1700, duration: 0.32, level: level * 0.065, attack: 0.012 });
    });
  }

  function cue(kind) {
    nearby(null, 1, 'cue-' + kind, kind === 'damage' ? 1 : 0.5, function (voice, when) {
      const notes = kind === 'wave' ? [196, 246.94, 293.66] : kind === 'defeat' ? [196, 164.81, 130.81] : [220, 164.81];
      notes.forEach(function (frequency, i) {
        tone(voice, when + i * 0.15, { type: 'triangle', frequency: frequency, duration: 0.45, level: 0.055, attack: 0.02 });
      });
    });
  }

  function actorStep(species, point) {
    nearby(point, 20, 'actor-step', 0.1, function (voice, when, level) {
      const undead = species === 'zombie';
      noise(voice, when, { frequency: undead ? 600 : 1000, endFrequency: 300, duration: undead ? 0.22 : 0.1, level: level * 0.025 });
      tone(voice, when, { type: 'triangle', frequency: species === 'cow' ? 150 : 190, endFrequency: 145, duration: 0.08, level: level * 0.02 });
    });
  }

  function actorJump(point, landing) {
    nearby(point, 22, landing ? 'actor-land' : 'actor-jump', 0.12, function (voice, when, level) {
      noise(voice, when, { frequency: landing ? 1400 : 2000, endFrequency: landing ? 850 : 2400, duration: landing ? 0.16 : 0.22, level: level * 0.045, attack: 0.02 });
    });
  }

  function select() {
    play(0, true, function (voice, when) {
      tone(voice, when, { type: 'triangle', frequency: 580, endFrequency: 440, duration: 0.065, level: 0.012, attack: 0.009 });
    });
  }

  function setListener(camera) {
    const p = camera.position, e = camera.matrixWorld.elements;
    listener.x = p.x; listener.y = p.y; listener.z = p.z;
    listener.rightX = e[0]; listener.rightZ = e[2];
  }

  function setEffectsEnabled(enabled) {
    effectsEnabled = !!enabled;
    if (ctx && effects) {
      effects.gain.cancelScheduledValues(ctx.currentTime);
      effects.gain.setTargetAtTime(effectsEnabled ? 0.75 : 0, ctx.currentTime, 0.025);
    }
    return effectsEnabled;
  }

  M.audio = {
    unlock: unlock,
    setListener: setListener,
    setEffectsEnabled: setEffectsEnabled,
    zombie: zombie,
    enemyBurst: enemyBurst,
    actorStep: actorStep,
    actorJump: actorJump,
    select: select,
    animal: animal,
    block: block,
    cue: cue,
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
