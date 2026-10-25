(function (M) {
  'use strict';

  const { rand, clamp } = M.utils;
  const LEAD = 0.025;
  const MAX_VOICES = 96;
  const MAX_EFFECT_VOICES = 64; // reserve headroom for the score during sieges
  let ctx = null;
  let effects = null;
  let music = null;
  let noiseBuffer = null;
  let stepSide = 1;
  let effectsEnabled = true;
  let duck = { start: 0, end: 0, from: 1, level: 1 };
  let pickupIndex = 0;
  let lastPickup = -Infinity;
  const listener = { x: 0, y: 0, z: 0, rightX: 1, rightZ: 0 };
  const lastSound = Object.create(null);
  const voices = new Set();
  let effectVoices = 0;

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
    const effect = !destination || destination === effects;
    if (!ctx || voices.size >= MAX_VOICES || (effect && effectVoices >= MAX_EFFECT_VOICES)) return null;
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
      pitch: rand(0.967, 1.033),
      start: function (source, when, end, offset) {
        sources.push(source);
        pending++;
        source.onended = function () {
          pending--;
          if (pending !== 0) return;
          for (const node of nodes) node.disconnect();
          voices.delete(voice);
          if (effect) effectVoices--;
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
    if (effect) effectVoices++;
    return voice;
  }

  function tone(voice, when, options) {
    const duration = options.duration;
    const osc = voice.create('Oscillator');
    osc.type = options.type || 'sine';
    osc.frequency.setValueAtTime(options.frequency * (options.tuned ? 1 : voice.pitch), when);
    if (options.endFrequency) osc.frequency.exponentialRampToValueAtTime(options.endFrequency * (options.tuned ? 1 : voice.pitch), when + duration * 0.8);
    const gain = voice.create('Gain');
    envelope(gain.gain, when, duration, options.level, options.attack, options.hold);
    osc.connect(gain);
    gain.connect(voice.input);
    voice.start(osc, when, when + duration + 0.02);
  }

  function noise(voice, when, options) {
    const src = voice.create('BufferSource');
    src.buffer = noiseBuffer;
    src.playbackRate.value = (options.rate || 1) * voice.pitch;
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
    const safeOffset = Math.max(0, noiseBuffer.length / noiseBuffer.sampleRate - (options.duration + 0.025) * src.playbackRate.value);
    voice.start(src, when, when + options.duration + 0.02, rand(0, Math.min(0.3, safeOffset)));
  }

  function play(pan, wake, build) {
    try {
      const audio = wake ? unlock() : ctx;
      if (!audio || audio.state !== 'running' || !effectsEnabled) return;
      const voice = createVoice(effects, pan);
      if (voice) build(voice, audio.currentTime + LEAD);
    } catch (err) { /* audio is a bonus, never fatal */ }
  }

  // Short modal resonances give wood, stone and metal physical bodies.
  // All layers belong to one voice, including delayed debris and water drops.
  function body(voice, when, frequency, duration, level, material) {
    const ratios = material === 'metal' ? [1, 2.76, 5.4] : material === 'wood' ? [1, 2.32, 3.9] : [1, 1.48, 2.09];
    ratios.forEach(function (ratio, i) {
      tone(voice, when, { frequency: frequency * ratio, duration: duration / (1 + i * 0.6),
        level: level * [1, 0.3, 0.12][i], attack: 0.009 });
    });
  }

  function fragments(voice, when, frequency, level, count) {
    for (let i = 0; i < count; i++) {
      noise(voice, when + 0.035 + i * 0.037, { frequency: frequency * rand(0.65, 1.5),
        duration: rand(0.045, 0.09), level: level / (1 + i * 0.65), attack: 0.008, q: 1.1 });
    }
  }

  function duckMusic(level, duration) {
    if (!ctx || !music) return;
    const now = ctx.currentTime;
    const attackEnd = duck.start + 0.025;
    const previous = now < attackEnd ? duck.from + (duck.level - duck.from) * clamp((now - duck.start) / 0.025, 0, 1) :
      now < duck.end ? duck.level + (1 - duck.level) * (now - attackEnd) / (duck.end - attackEnd) : 1;
    const held = Math.min(previous, level);
    music.gain.cancelScheduledValues(now);
    music.gain.setValueAtTime(previous, now);
    music.gain.linearRampToValueAtTime(held, now + 0.025);
    music.gain.linearRampToValueAtTime(1, now + duration);
    duck = { start: now, end: now + duration, from: previous, level: held };
  }

  function bleat() {
    play(0, true, function (voice, when) {
      vocal(voice, when, rand(240, 275), 0.62, 0.2, 920, 'sheep');
      noise(voice, when + 0.03, { frequency: 3000, duration: 0.13, level: 0.014, attack: 0.025 });
    });
  }

  function thud() {
    play(0, false, function (voice, when) {
      noise(voice, when, { frequency: 1850, endFrequency: 650, duration: 0.095, level: 0.095, attack: 0.008 });
      tone(voice, when, { type: 'triangle', frequency: 155, endFrequency: 115, duration: 0.115, level: 0.047, attack: 0.008 });
      noise(voice, when + 0.035, { frequency: 3200, duration: 0.065, level: 0.018, attack: 0.008 });
    });
  }

  function step(running, speed) {
    stepSide *= -1;
    play(stepSide * (running ? 0.22 : 0.15), false, function (voice, when) {
      const level = (running ? 0.045 : 0.03) * (0.75 + clamp(speed / 9.6, 0, 1) * 0.4);
      const frequency = stepSide > 0 ? 210 : 185;
      body(voice, when, frequency, 0.072, level * 0.6, 'wood');
      noise(voice, when + 0.008, { frequency: rand(1900, 2900), endFrequency: 900, duration: 0.1, level: level * 0.7 });
      noise(voice, when + (running ? 0.035 : 0.055), { frequency: 4800, duration: 0.055, level: level * 0.16 });
    });
  }

  function jump() {
    play(-stepSide * 0.12, true, function (voice, when) {
      body(voice, when, 190, 0.075, 0.018, 'wood');
      noise(voice, when + 0.025, { frequency: 650, endFrequency: 2400, duration: 0.24, level: 0.018, attack: 0.04 });
    });
  }

  function whoosh() {
    play(stepSide * 0.24, true, function (voice, when) {
      noise(voice, when, { frequency: 380, endFrequency: 2900, duration: 0.23, level: 0.025, attack: 0.035 });
      noise(voice, when + 0.035, { frequency: 3200, endFrequency: 800, duration: 0.18, level: 0.01, attack: 0.045 });
    });
  }

  function land(force) {
    play(0, false, function (voice, when) {
      const strength = clamp(force, 0.3, 1.2);
      body(voice, when, 105, 0.19, 0.045 * strength, 'wood');
      noise(voice, when, { frequency: 1400, endFrequency: 450, duration: 0.17, level: 0.05 * strength });
      fragments(voice, when + 0.015, 2600, 0.014 * strength, 2);
    });
  }

  function stomp(broke) {
    play(0, true, function (voice, when) {
      body(voice, when, 92, 0.24, 0.06, 'stone');
      noise(voice, when, { frequency: 1050, endFrequency: 270, duration: 0.2, level: 0.08, attack: 0.008 });
      fragments(voice, when, broke ? 2100 : 1200, broke ? 0.04 : 0.012, broke ? 4 : 2);
    });
  }

  function pickup() {
    play(rand(-0.18, 0.18), true, function (voice, when) {
      pickupIndex = when - lastPickup < 0.65 ? (pickupIndex + 1) % 5 : 0;
      lastPickup = when;
      const root = [587.33, 659.25, 783.99, 880, 987.77][pickupIndex];
      tone(voice, when, { frequency: root, duration: 0.22, level: 0.032, attack: 0.009, tuned: true });
      tone(voice, when + 0.045, { frequency: root * 1.5, duration: 0.25, level: 0.019, attack: 0.009, tuned: true });
      tone(voice, when, { frequency: root * 2.76, duration: 0.09, level: 0.005, attack: 0.009, tuned: true });
    });
  }

  function breath() {
    play(rand(-0.08, 0.08), false, function (voice, when) {
      noise(voice, when, { frequency: 850, endFrequency: 460, duration: 0.38, level: 0.008, attack: 0.11 });
      noise(voice, when + 0.42, { frequency: 600, endFrequency: 350, duration: 0.42, level: 0.005, attack: 0.13 });
    });
  }

  function splash(strength) {
    play(rand(-0.18, 0.18), false, function (voice, when) {
      const level = clamp(strength, 0.05, 1);
      noise(voice, when, { frequency: 1800, endFrequency: 450, duration: 0.38, level: 0.075 * level, rate: rand(0.8, 1.1), attack: 0.02 });
      noise(voice, when + 0.055, { frequency: 3800, endFrequency: 1600, duration: 0.31, level: 0.025 * level, attack: 0.035 });
      for (let i = 0; i < 3; i++) {
        const frequency = rand(420, 1100);
        tone(voice, when + 0.12 + i * 0.065, { frequency: frequency, endFrequency: frequency * 1.8,
          duration: 0.07, level: 0.009 * level / (1 + i), attack: 0.009 });
      }
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
    play(pan, false, function (voice, when) {
      // Distant transients lose their brittle high end before reaching stereo.
      const air = voice.create('BiquadFilter');
      air.type = 'lowpass'; air.frequency.value = 10000 - distance / radius * 7800; air.Q.value = 0.5;
      voice.input.disconnect(); voice.input.connect(air); air.connect(voice.output);
      build(voice, when, level);
    });
  }

  // A breathy glottal voice with three moving vowel resonances. Keep pitch
  // nearly steady and cut sub-bass: big bass slides read as comic burps.
  function vocal(voice, when, base, duration, level, formant, species) {
    const throat = voice.create('Oscillator');
    throat.type = 'sawtooth';
    throat.frequency.setValueAtTime(base, when);
    throat.frequency.linearRampToValueAtTime(base * 1.035, when + duration * 0.2);
    throat.frequency.linearRampToValueAtTime(base * 0.94, when + duration);
    const wobble = voice.create('Oscillator');
    wobble.frequency.value = species === 'sheep' ? rand(12, 17) : species === 'cow' ? 2.1 : rand(3.1, 4.8);
    const depth = voice.create('Gain');
    depth.gain.value = base * (species === 'sheep' ? 0.027 : 0.018);
    wobble.connect(depth); depth.connect(throat.frequency);
    const highpass = voice.create('BiquadFilter');
    highpass.type = 'highpass'; highpass.frequency.value = species === 'cow' ? 70 : 110; highpass.Q.value = 0.7;
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
          level * (kind === 'groan' ? 0.24 : 0.3), kind === 'hurt' ? 980 : 570);
        if (kind === 'hurt') fragments(voice, when, 1600, level * 0.025, 2);
        if (kind === 'death') noise(voice, when + 0.2, { frequency: 1800, endFrequency: 1100, duration: 0.48, level: level * 0.055, attack: 0.05 });
      }
    });
  }

  // Each new silhouette has a matching acoustic material. Wind-ups rise in
  // pitch; casts resolve them, without long bass sweeps or permanent loops.
  function enemy(species, event, point) {
    if (!['parachute', 'worm', 'binder', 'prismback', 'sower', 'boss'].includes(species)) return;
    const warning = event === 'warn' || event === 'open';
    const death = event === 'death', hurt = event === 'hurt';
    nearby(point, 42, 'enemy-' + species + '-' + event, event === 'idle' ? 1.5 : .16, function (voice, when, level) {
      const gain = level * (event === 'idle' ? .035 : warning ? .09 : .07);
      if (species === 'parachute') {
        noise(voice, when, { frequency: event === 'open' ? 1900 : 1100, endFrequency: 500,
          duration: event === 'open' ? .7 : .22, level: gain, attack: .035 });
        body(voice, when + .06, event === 'open' ? 310 : 145, .2, gain * .45, 'wood');
      } else if (species === 'worm') {
        noise(voice, when, { frequency: warning ? 520 : 310, endFrequency: warning ? 1000 : 180,
          duration: warning ? .65 : death ? .55 : .3, level: gain, attack: .025 });
        body(voice, when + .04, warning ? 185 : hurt ? 270 : 120, .24, gain * .6, 'stone');
        fragments(voice, when + .1, 1700, gain * .25, death || event === 'emerge' ? 4 : 2);
      } else if (species === 'binder') {
        body(voice, when, warning ? 310 : death ? 170 : 420, .3, gain * .7, 'wood');
        tone(voice, when + .06, { type: 'triangle', frequency: warning ? 380 : 650,
          endFrequency: warning ? 570 : 420, duration: warning ? .65 : .24, level: gain * .4, attack: .03 });
        fragments(voice, when, 2400, gain * .23, death ? 4 : 2);
      } else if (species === 'prismback') {
        body(voice, when, event === 'block' ? 1020 : warning ? 480 : 680, .32, gain * .7, 'metal');
        tone(voice, when + .07, { frequency: warning ? 720 : 1440, endFrequency: warning ? 1080 : 950,
          duration: warning ? .6 : .25, level: gain * .3, attack: .012 });
      } else if (species === 'sower') {
        for (let i = 0; i < 3; i++) tone(voice, when + i * .07, { type: 'sine',
          frequency: (warning ? 360 : 240) + i * 100, endFrequency: 150 + i * 50,
          duration: .18, level: gain * .55 / (1 + i * .3), attack: .014 });
        noise(voice, when + .04, { frequency: 1300, endFrequency: 500, duration: death ? .45 : .25, level: gain * .6, attack: .02 });
      } else if (species === 'boss') {
        body(voice, when, warning ? 190 : hurt ? 300 : 220, .42, gain * .85, 'stone');
        body(voice, when + .05, warning ? 130 : 90, .55, gain * .55, 'wood');
        noise(voice, when, { frequency: warning ? 640 : 420, endFrequency: warning ? 1250 : hurt ? 300 : 240,
          duration: warning ? .8 : death ? .75 : .32, level: gain * .95, attack: warning ? .08 : .03 });
        fragments(voice, when + .1, 700, gain * .3, death ? 5 : 2);
      }
    });
  }

  function animal(species, point) {
    nearby(point, 30, 'animal', 1.5, function (voice, when, level) {
      const cow = species === 'cow', stag = species === 'stag';
      vocal(voice, when, cow ? rand(95, 115) : stag ? rand(125, 145) : rand(220, 260),
        cow ? 1.1 : 0.65, level * 0.16, cow ? 330 : stag ? 580 : 850, cow ? 'cow' : stag ? 'stag' : 'sheep');
    });
  }

  function block(kind, point, material) {
    nearby(point, 25, 'block-' + kind, 0.07, function (voice, when, level) {
      const placing = kind === 'place';
      const wood = material === 'log' || material === 'planks';
      const leaves = material === 'leaves' || material === 'grass';
      const rock = ['stone', 'coal', 'copper', 'iron', 'crystal'].includes(material);
      const frequency = wood ? 260 : rock ? 730 : leaves ? 1900 : 430;
      if (!leaves) body(voice, when, frequency, placing ? 0.12 : 0.22, level * (rock ? 0.035 : 0.045), wood ? 'wood' : 'stone');
      noise(voice, when, { frequency: leaves ? 3400 : wood ? 1200 : rock ? 2800 : 750, endFrequency: leaves ? 1600 : 380,
        duration: placing ? 0.13 : 0.26, level: level * 0.085, attack: 0.008 });
      if (!placing) fragments(voice, when, frequency * 2.2, level * 0.025, 3);
    });
  }

  function enemyBurst(point) {
    nearby(point, 40, 'enemy-burst', 0.12, function (voice, when, level) {
      noise(voice, when, { frequency: 1450, endFrequency: 300, duration: 0.29, level: level * 0.13, attack: 0.008 });
      body(voice, when, 105, 0.23, level * 0.04, 'stone');
      fragments(voice, when, 3000, level * 0.035, 4);
    });
  }

  function towerShot(point, style, id) {
    nearby(point, 90, 'tower-' + (id || style), .09, function (voice, when, level) {
      // Give the elemental weapons different rhythms and acoustic materials,
      // rather than transposing the same magic chirp for every crystal.
      if (id === 'frost') {
        body(voice, when, 1568, .32, level * .025, 'metal');
        [2352, 3136].forEach((frequency, i) => tone(voice, when + .045 + i * .035,
          { frequency, endFrequency: frequency * .88, duration: .16, level: level * .012, attack: .008 }));
        noise(voice, when, { frequency: 5200, endFrequency: 2400, duration: .18, level: level * .035, attack: .025 });
      } else if (id === 'venom') {
        noise(voice, when, { frequency: 2100, endFrequency: 500, duration: .16, level: level * .07, attack: .012 });
        for (let i = 0; i < 3; i++) tone(voice, when + .025 + i * .045,
          { frequency: 160 + i * 55, endFrequency: 480 + i * 80, duration: .075, level: level * .025, attack: .009 });
      } else if (id === 'arcane') {
        // Tight rising shimmer resolves into the blade's cutting transient.
        tone(voice, when, { type: 'triangle', frequency: 392, endFrequency: 1176, duration: .1, level: level * .035, attack: .025 });
        tone(voice, when + .025, { frequency: 1568, endFrequency: 784, duration: .12, level: level * .018 });
        noise(voice, when + .055, { frequency: 4400, endFrequency: 1800, duration: .1, level: level * .04 });
      } else if (id === 'sun') {
        // An open, sustained major chord distinguishes sunlight from sparks.
        [1, 1.25, 1.5, 2].forEach((ratio, i) => tone(voice, when + i * .018,
          { frequency: 660 * ratio, duration: .46 - i * .04, level: level * .026 / (1 + i), attack: .035, tuned: true }));
        noise(voice, when, { frequency: 3500, endFrequency: 6000, duration: .3, level: level * .022, attack: .065 });
      } else if (id === 'sniper') {
        body(voice, when, 520, .095, level * .045, 'metal');
        noise(voice, when, { frequency: 4600, endFrequency: 1200, duration: .075, level: level * .11, attack: .008 });
        // A delayed bolt-action latch, separate from the muzzle crack.
        body(voice, when + .16, 920, .085, level * .022, 'metal');
      } else if (id === 'ember') {
        noise(voice, when, { frequency: 700, endFrequency: 2400, duration: .27, level: level * .09, attack: .025 });
        fragments(voice, when, 3400, level * .03, 3);
        tone(voice, when, { frequency: 105, endFrequency: 72, duration: .2, level: level * .035 });
      } else if (id === 'earth') {
        body(voice, when, 72, .26, level * .055, 'stone');
        noise(voice, when, { frequency: 480, endFrequency: 220, duration: .24, level: level * .09, attack: .015 });
        fragments(voice, when, 1400, level * .02, 3);
      } else if (style === 'shell') {
        noise(voice, when, { frequency: 850, endFrequency: 140, duration: .26, level: level * .14, attack: .008 });
        body(voice, when, 85, .25, level * .075, 'metal');
        noise(voice, when + .055, { frequency: 1800, endFrequency: 400, duration: .22, level: level * .025 });
      } else if (style === 'bolt') {
        body(voice, when, id === 'sniper' ? 420 : 235, .12, level * .04, 'wood');
        noise(voice, when, { frequency: id === 'sniper' ? 3800 : 2200, endFrequency: 800, duration: .11, level: level * .085, attack: .008 });
        tone(voice, when + .02, { frequency: 720, endFrequency: 300, duration: .14, level: level * .012 });
      } else if (style === 'coil' && id !== 'sun') {
        tone(voice, when, { type: 'triangle', frequency: 180, endFrequency: 1100, duration: .14, level: level * .025 });
        fragments(voice, when, 4000, level * .04, 3);
        body(voice, when + .02, 880, .19, level * .018, 'metal');
      } else {
        const root = { frost: 1174.66, ember: 293.66, venom: 220, arcane: 587.33, sun: 880, earth: 146.83 }[id] || 587.33;
        tone(voice, when, { frequency: root * .65, endFrequency: root, duration: .2, level: level * .032 });
        tone(voice, when + .025, { frequency: root * 1.5, duration: .22, level: level * .018 });
        noise(voice, when, { frequency: id === 'ember' ? 900 : 2900, endFrequency: 1200, duration: .18, level: level * .025, attack: .025 });
      }
    });
  }

  function towerImpact(point, id) {
    nearby(point, 90, 'impact-' + id, .08, function (voice, when, level) {
      if (id === 'mortar' || id === 'earth') {
        body(voice, when, id === 'earth' ? 65 : 95, .38, level * .08, 'stone');
        noise(voice, when, { frequency: id === 'earth' ? 480 : 1400, endFrequency: 120, duration: .43, level: level * .14, attack: .008 });
        fragments(voice, when + .05, 1800, level * .025, 4);
      } else if (id === 'ember') {
        noise(voice, when, { frequency: 800, endFrequency: 2000, duration: .34, level: level * .11, attack: .02 });
        fragments(voice, when, 3200, level * .035, 5);
        tone(voice, when, { frequency: 105, endFrequency: 65, duration: .24, level: level * .04 });
      } else if (id === 'ballista' || id === 'sniper') {
        body(voice, when, id === 'sniper' ? 380 : 210, .12, level * .035, 'wood');
        noise(voice, when, { frequency: id === 'sniper' ? 3100 : 1500, endFrequency: 450, duration: .12, level: level * .08, attack: .008 });
      } else if (id === 'frost') {
        body(voice, when, 1250, .38, level * .027, 'metal');
        fragments(voice, when, 4800, level * .023, 4);
      } else if (id === 'venom') {
        noise(voice, when, { frequency: 1600, endFrequency: 650, duration: .3, level: level * .055, attack: .025 });
        for (let i = 0; i < 3; i++) tone(voice, when + i * .065, { frequency: 190 + i * 80,
          endFrequency: 450 + i * 110, duration: .09, level: level * .022, attack: .009 });
      } else if (id === 'storm') {
        fragments(voice, when, 4200, level * .065, 4);
        noise(voice, when + .03, { frequency: 650, endFrequency: 180, duration: .28, level: level * .08 });
        tone(voice, when, { type: 'triangle', frequency: 145, endFrequency: 65, duration: .19, level: level * .03 });
      } else if (id === 'arcane') {
        noise(voice, when, { frequency: 4800, endFrequency: 900, duration: .16, level: level * .06, attack: .012 });
        tone(voice, when, { type: 'triangle', frequency: 1176, endFrequency: 294, duration: .18, level: level * .028 });
        tone(voice, when + .035, { frequency: 1568, duration: .13, level: level * .012 });
      } else if (id === 'sun') {
        [1, 1.25, 1.5, 2].forEach((ratio, i) => tone(voice, when + i * .02,
          { frequency: 880 * ratio, duration: .48 - i * .05, level: level * .028 / (1 + i), attack: .025, tuned: true }));
        noise(voice, when, { frequency: 4200, endFrequency: 2200, duration: .28, level: level * .025, attack: .035 });
      } else {
        const root = 587.33;
        [1, 1.5, 2].forEach(function (ratio, i) {
          tone(voice, when + i * .025, { frequency: root * ratio, duration: .34 - i * .05,
            level: level * .03 / (1 + i), attack: .016, tuned: true });
        });
        noise(voice, when, { frequency: 3600, endFrequency: 1600, duration: .22, level: level * .02, attack: .025 });
      }
    });
  }

  function cue(kind) {
    nearby(null, 1, 'cue-' + kind, kind === 'damage' ? 1 : 0.5, function (voice, when) {
      duckMusic(kind === 'damage' ? .55 : .4, kind === 'defeat' ? 2.5 : 1.1);
      const notes = kind === 'wave' ? [293.66, 440, 329.63, 587.33] : kind === 'clear' ? [587.33, 659.25, 880, 1174.66] :
        kind === 'defeat' ? [293.66, 261.63, 220, 146.83] : [196, 146.83];
      notes.forEach(function (frequency, i) {
        const at = when + i * (kind === 'damage' ? .11 : .14);
        tone(voice, at, { type: 'triangle', frequency: frequency, duration: .42, level: .048, attack: .022, tuned: true });
        tone(voice, at, { frequency: frequency * 2, duration: .3, level: .009, attack: .025, tuned: true });
      });
      if (kind === 'wave') body(voice, when, 98, .32, .045, 'wood');
      if (kind === 'damage') noise(voice, when, { frequency: 520, duration: .24, level: .045, attack: .015 });
    });
  }

  function actorStep(species, point) {
    nearby(point, 20, 'actor-step-' + species, 0.13, function (voice, when, level) {
      const undead = species === 'zombie';
      body(voice, when, species === 'cow' ? 140 : undead ? 115 : 240, .09, level * .016, 'wood');
      noise(voice, when + (undead ? .02 : .008), { frequency: undead ? 650 : 1800, endFrequency: 350,
        duration: undead ? .2 : .09, level: level * .027 });
    });
  }

  function actorJump(point, landing) {
    nearby(point, 22, landing ? 'actor-land' : 'actor-jump', 0.12, function (voice, when, level) {
      if (landing) body(voice, when, 150, .13, level * .027, 'wood');
      noise(voice, when, { frequency: landing ? 1700 : 900, endFrequency: landing ? 600 : 2100,
        duration: landing ? .17 : .2, level: level * .04, attack: .02 });
    });
  }

  function select() {
    play(0, true, function (voice, when) {
      tone(voice, when, { frequency: 880, duration: .052, level: .013, attack: .008, tuned: true });
      tone(voice, when + .015, { frequency: 1320, duration: .045, level: .004, attack: .008, tuned: true });
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
    enemy: enemy,
    enemyBurst: enemyBurst,
    towerShot: towerShot,
    towerImpact: towerImpact,
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
