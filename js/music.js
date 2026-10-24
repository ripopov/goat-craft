(function (M) {
  'use strict';

  const { rand, clamp } = M.utils;

  const BPM = 84;
  const STEP = 60 / BPM / 2; // eighth note
  const BAR_DUR = STEP * 8;
  const LOOP_STEPS = 192; // three eight-bar movements
  const MUSIC_LEVEL = 0.3;
  const SCHEDULE_LEAD = 0.04;
  const LOOKAHEAD = 0.32;

  // "Hearth / Canopy / Ridgeline": an original D-Dorian suite. Common tones
  // connect open ninths and sixths; the B-natural gives the meadow its own colour.
  const CHORDS = [
    { bass: 38, pad: [53, 57, 64], arp: [62, 69, 64, 65, 69, 74, 65, 64] }, // Dm9
    { bass: 43, pad: [55, 59, 64], arp: [62, 67, 71, 64, 67, 74, 71, 64] }, // G6
    { bass: 36, pad: [52, 59, 62], arp: [60, 67, 62, 64, 71, 76, 67, 62] }, // Cmaj9
    { bass: 40, pad: [55, 59, 62], arp: [64, 71, 67, 62, 64, 74, 71, 67] }, // Em7
    { bass: 41, pad: [57, 60, 67], arp: [65, 72, 67, 69, 72, 76, 69, 67] }, // Fadd9
    { bass: 45, pad: [55, 62, 64], arp: [64, 69, 62, 67, 69, 74, 67, 62] }, // Asus4
    { bass: 35, pad: [53, 57, 62], arp: [62, 69, 65, 57, 62, 74, 69, 65] }, // B half-diminished
    { bass: 38, pad: [53, 59, 64], arp: [62, 69, 64, 65, 71, 76, 69, 62] }  // Dm6/9
  ];
  const HARMONY = [
    [0, 1, 4, 2, 0, 6, 5, 7],
    [4, 2, 1, 0, 4, 6, 1, 5],
    [0, 0, 1, 4, 6, 2, 5, 7]
  ];
  // [eighth-note position, MIDI, length]; purposeful rests and 3+3+2 replies.
  const THEMES = [
    [ [[0,74,2],[3,76,1],[4,77,2],[7,69,1]], [[1,71,2],[4,74,3]],
      [[0,72,3],[3,69,2],[6,67,2]], [[2,71,2],[5,76,2]],
      [[0,77,2],[3,76,1],[4,74,3]], [[1,77,2],[4,74,2],[7,69,1]],
      [[0,76,3],[4,74,2],[6,67,2]], [[0,65,3],[3,64,2],[6,62,2]] ],
    [ [[1,81,2],[4,79,1],[6,76,2]], [[0,79,3],[3,76,1],[5,74,2]],
      [[0,74,2],[3,71,2],[6,69,2]], [[2,77,2],[5,76,2]],
      [[0,76,2],[2,79,1],[4,81,3]], [[1,77,2],[4,74,2]],
      [[0,79,3],[4,76,2],[7,74,1]], [[0,76,2],[3,74,2],[6,69,2]] ],
    [ [[0,74,2],[3,69,1],[6,76,2]], [[0,77,2],[3,76,2],[6,74,2]],
      [[0,79,3],[4,77,2],[6,74,2]], [[1,77,2],[4,81,3]],
      [[0,77,2],[3,74,2],[6,69,2]], [[0,76,3],[4,74,2],[7,71,1]],
      [[0,69,2],[3,74,2],[6,76,2]], [[0,77,3],[4,76,2],[6,74,2]] ]
  ];

  let ctx = null;
  let master = null;
  let reverbSend = null;
  let action = null;
  let atmosphereSend = null;
  let actionSend = null;
  let atmosphere = null;
  let colourFilter = null;
  let intensity = 0;
  let travel = 0;
  let cave = false;
  let quiet = 1;
  let lastMix = -Infinity;
  let mixedIntensity = -1;
  let mixedCave = null;
  let mixedQuiet = null;
  let built = false;
  let playing = false;
  let timer = null;
  let nextTime = 0;
  let stepIndex = 0;
  let loopCount = 0;
  let noiseLong = null;
  let noiseShort = null;
  const voices = new Set();
  let fade = { from: 0, to: 0, start: 0, end: 0 };

  function fadeMaster(target, duration) {
    const now = ctx.currentTime;
    const k = fade.end > fade.start ? Math.min(1, Math.max(0, (now - fade.start) / (fade.end - fade.start))) : 1;
    const current = fade.from + (fade.to - fade.from) * k;
    // Preserve the in-flight ramp even on browsers without cancelAndHoldAtTime.
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(current, now);
    master.gain.linearRampToValueAtTime(target, now + duration);
    fade = { from: current, to: target, start: now, end: now + duration };
  }

  function voiceAt(pan, reverb, bus) {
    const voice = M.audio.createVoice(bus || atmosphere, pan);
    if (!voice) return null;
    if (reverb) voice.output.connect(bus === action ? actionSend : atmosphereSend);
    voices.add(voice);
    voice.onended = function () { voices.delete(voice); };
    return voice;
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function makeNoiseBuffer(seconds) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        // Both ends meet at zero: the wind loop has no waveform discontinuity.
        const edge = Math.min(1, i / (ctx.sampleRate * 0.03), (data.length - 1 - i) / (ctx.sampleRate * 0.03));
        data[i] = (Math.random() * 2 - 1) * edge;
      }
    }
    return buffer;
  }

  function makeImpulse(seconds, decay) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.min(1, i / (ctx.sampleRate * 0.012)) * Math.pow(1 - i / data.length, decay);
      }
    }
    return buffer;
  }

  function pluck(midi, when, level, pan, bus) {
    const voice = voiceAt(pan, true, bus);
    if (!voice) return;
    const f = midiToFreq(midi);
    const osc = voice.create('Oscillator');
    const osc2 = voice.create('Oscillator');
    osc.type = 'triangle';
    osc2.type = 'sine';
    osc.frequency.value = f;
    osc2.frequency.value = f * 3.002;
    osc.detune.value = rand(-4, 4);

    const filter = voice.create('BiquadFilter');
    filter.type = 'lowpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(1900, when);
    filter.frequency.exponentialRampToValueAtTime(620, when + 1.0);

    const gain = voice.create('Gain');
    M.audio.envelope(gain.gain, when, 1.35, level, 0.012);

    const second = voice.create('Gain');
    second.gain.value = 0.09;

    osc.connect(filter);
    osc2.connect(second);
    second.connect(filter);
    filter.connect(gain);
    gain.connect(voice.input);

    voice.start(osc, when, when + 1.4);
    voice.start(osc2, when, when + 1.4);
  }

  function flute(midi, when, duration, level, pan) {
    const voice = voiceAt(pan || 0.08, true);
    if (!voice) return;
    const f = midiToFreq(midi);
    const osc = voice.create('Oscillator');
    const octave = voice.create('Oscillator');
    osc.type = 'sine';
    octave.type = 'sine';
    osc.frequency.value = f;
    octave.frequency.value = f * 2;

    const vib = voice.create('Oscillator');
    vib.type = 'sine';
    vib.frequency.value = rand(4.3, 5.2);
    const vibGain = voice.create('Gain');
    M.audio.envelope(vibGain.gain, when, duration + 0.22, f * 0.003, 0.12, Math.max(0.12, duration - 0.2));
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);
    vibGain.connect(octave.frequency);

    const air = voice.create('BufferSource');
    air.buffer = noiseShort; air.loop = true;
    const airFilter = voice.create('BiquadFilter');
    airFilter.type = 'bandpass'; airFilter.frequency.value = f * 2.6; airFilter.Q.value = 1.2;
    const airGain = voice.create('Gain');
    M.audio.envelope(airGain.gain, when, duration + 0.22, level * 0.12, 0.09, Math.max(0.09, duration - 0.25));
    air.connect(airFilter); airFilter.connect(airGain); airGain.connect(voice.input);
    voice.start(air, when, when + duration + 0.3);

    const filter = voice.create('BiquadFilter');
    filter.type = 'lowpass';
    filter.frequency.value = 1700;
    filter.Q.value = 0.5;

    const octaveGain = voice.create('Gain');
    octaveGain.gain.value = 0.1;

    const gain = voice.create('Gain');
    M.audio.envelope(gain.gain, when, duration + 0.22, level, 0.08, Math.max(0.08, duration - 0.25));

    osc.connect(filter);
    octave.connect(octaveGain);
    octaveGain.connect(filter);
    filter.connect(gain);
    gain.connect(voice.input);

    voice.start(osc, when, when + duration + 0.3);
    voice.start(octave, when, when + duration + 0.3);
    voice.start(vib, when, when + duration + 0.3);
  }

  function pad(midis, when, level) {
    for (let i = 0; i < midis.length; i++) {
      const voice = voiceAt(i === 0 ? -0.25 : i === 2 ? 0.25 : 0, true);
      if (!voice) continue;
      const osc = voice.create('Oscillator');
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(midis[i]);
      osc.detune.value = rand(-5, 5);

      const filter = voice.create('BiquadFilter');
      filter.type = 'lowpass';
      filter.frequency.value = 720;
      filter.Q.value = 0.4;

      const gain = voice.create('Gain');
      M.audio.envelope(gain.gain, when, BAR_DUR + 0.1, level, 0.75, BAR_DUR - 0.8);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(voice.input);

      voice.start(osc, when, when + BAR_DUR + 0.2);
    }
  }

  function bass(midi, when, strength) {
    const voice = voiceAt(0, false);
    if (!voice) return;
    const osc = voice.create('Oscillator');
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi);

    const filter = voice.create('BiquadFilter');
    filter.type = 'lowpass';
    filter.frequency.value = 240;
    filter.Q.value = 0.4;

    const gain = voice.create('Gain');
    M.audio.envelope(gain.gain, when, 1.55, 0.042 * strength, 0.035);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(voice.input);

    voice.start(osc, when, when + 1.6);
  }

  function drum(when, strength) {
    const voice = voiceAt(0, false, action);
    if (!voice) return;
    const osc = voice.create('Oscillator');
    osc.type = 'sine';
    osc.frequency.setValueAtTime(84, when);
    osc.frequency.exponentialRampToValueAtTime(48, when + 0.16);

    const gain = voice.create('Gain');
    M.audio.envelope(gain.gain, when, 0.28, 0.032 * strength, 0.012);

    osc.connect(gain);
    gain.connect(voice.input);
    voice.start(osc, when, when + 0.3);

    const noise = voice.create('BufferSource');
    noise.buffer = noiseShort;
    const filter = voice.create('BiquadFilter');
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    const ng = voice.create('Gain');
    M.audio.envelope(ng.gain, when, 0.14, 0.009 * strength, 0.012);
    noise.connect(filter);
    filter.connect(ng);
    ng.connect(voice.input);
    voice.start(noise, when, when + 0.16);
  }

  function shaker(when, pan, strength) {
    const voice = voiceAt(pan, false, action);
    if (!voice) return;
    const noise = voice.create('BufferSource');
    noise.buffer = noiseShort;
    const filter = voice.create('BiquadFilter');
    filter.type = 'bandpass';
    filter.frequency.value = 2800;
    filter.Q.value = 0.6;
    const gain = voice.create('Gain');
    M.audio.envelope(gain.gain, when, 0.12, 0.009 * strength, 0.012);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(voice.input);
    voice.start(noise, when, when + 0.14);
  }

  function chime(midi, when, level, pan) {
    const voice = voiceAt(pan, true);
    if (!voice) return;
    const f = midiToFreq(midi);
    [1, 2.756, 5.404].forEach(function (ratio, i) {
      const osc = voice.create('Oscillator');
      osc.type = 'sine'; osc.frequency.value = f * ratio;
      const gain = voice.create('Gain');
      const duration = 1.9 / (1 + i * 0.65);
      M.audio.envelope(gain.gain, when, duration, level * [1, 0.22, 0.06][i], 0.012);
      osc.connect(gain); gain.connect(voice.input);
      voice.start(osc, when, when + duration + 0.02);
    });
  }

  function scheduleStep(index, when) {
    const bar = Math.floor(index / 8), step = index % 8;
    const section = Math.floor(bar / 8), phrase = bar % 8;
    const chord = CHORDS[HARMONY[section][phrase]];
    const variation = loopCount % 3;
    const intro = loopCount === 0 && bar < 2;
    const sparse = cave || (section === 1 && variation === 2);
    if (step === 0) {
      pad(chord.pad, when, sparse ? 0.009 : 0.007);
      bass(chord.bass, when, 0.85 + intensity * 0.3);
    }
    if (step === 4 && intensity > 0.45) bass(chord.bass + 7, when, 0.55);

    // Broken 3+3+2 picking, with space for the woodwind to answer.
    const pattern = sparse ? [0, 3, 6] : section === 1 ? [0, 2, 3, 5, 6] : [0, 1, 3, 4, 6];
    if (pattern.includes(step) && !(phrase % 4 === 3 && step > 5)) {
      const pick = (step + (variation === 1 ? 2 : 0)) % 8;
      pluck(chord.arp[pick], when + rand(0, 0.007),
        (step === 0 || step === 3 || step === 6 ? 0.055 : 0.035) * rand(0.9, 1.06),
        step % 2 ? 0.32 : -0.32);
    }
    if (!intro && !(variation === 2 && phrase === 2)) {
      for (const event of THEMES[section][phrase]) {
        if (event[0] !== step) continue;
        flute(event[1] - (cave ? 12 : 0), when + 0.008,
          Math.max(0.25, event[2] * STEP * 0.82), cave ? 0.023 : 0.036, section === 1 ? -0.16 : 0.14);
      }
    }
    // The little struck-stone reply changes each pass rather than shadowing
    // every melody note. Never fill every available gap.
    if (!intro && phrase % 2 === 1 && step === 6 && (travel > 0.25 || section === 1 || cave)) {
      chime(chord.arp[(variation + phrase) % 8] + (cave ? 0 : 12), when, 0.022, -0.4);
    }
    if (intensity > 0.08) {
      if (step === 0 || step === 3 || step === 6) drum(when, step === 0 ? 1.25 : 0.7);
      if (step % 2 || intensity > 0.65) shaker(when + 0.012, step % 2 ? -0.38 : 0.38, step % 2 ? 0.65 : 0.35);
      if (intensity > 0.4 && [1, 4, 7].includes(step)) {
        pluck(chord.arp[step] - 12, when, 0.035, 0.18, action);
      }
      if (intensity > 0.75 && phrase % 4 === 3 && step === 7) drum(when + STEP * 0.5, 0.5);
    }
  }

  // Gameplay supplies facts; musical transitions retain the running beat and
  // ease over several seconds instead of restarting the tune at every kill.
  function update(dt, state) {
    state = state || {};
    const combat = clamp(Number(state.combat) || 0, 0, 1);
    const danger = clamp(Number(state.danger) || 0, 0, 1);
    const target = state.defeated ? 0 : Math.max(combat, danger * 0.85);
    intensity += (target - intensity) * (1 - Math.exp(-Math.max(0, dt) / (target > intensity ? 1.5 : 5)));
    travel = clamp((Number(state.speed) || 0) / 9.6, 0, 1);
    cave = !!state.underground;
    const previousQuiet = quiet;
    quiet = state.paused ? 0.12 : state.defeated ? 0.35 : 1;
    const mix = Math.round(intensity * 100) / 100;
    if (!built || (quiet === previousQuiet && ctx.currentTime - lastMix < 0.1)) return;
    if (mix === mixedIntensity && cave === mixedCave && quiet === mixedQuiet) return;
    lastMix = ctx.currentTime;
    mixedIntensity = mix; mixedCave = cave; mixedQuiet = quiet;
    action.gain.setTargetAtTime(mix * quiet, lastMix, 0.5);
    atmosphere.gain.setTargetAtTime((1 - mix * 0.18) * quiet, lastMix, 0.6);
    actionSend.gain.setTargetAtTime(mix * quiet * 0.8, lastMix, 0.5);
    atmosphereSend.gain.setTargetAtTime((1 - mix * 0.18) * quiet * 0.8, lastMix, 0.6);
    colourFilter.frequency.setTargetAtTime(cave ? 2100 : 5600 + mix * 1200, lastMix, 1.2);
  }

  function scheduleAhead() {
    if (!playing) return;
    if (ctx.state !== 'running') return;
    const earliest = ctx.currentTime + SCHEDULE_LEAD;
    if (nextTime < earliest) {
      const skipped = Math.ceil((earliest - nextTime) / STEP);
      const total = stepIndex + skipped;
      loopCount += Math.floor(total / LOOP_STEPS);
      stepIndex = total % LOOP_STEPS;
      nextTime += skipped * STEP;
    }
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(stepIndex, nextTime);
      nextTime += STEP;
      stepIndex++;
      if (stepIndex >= LOOP_STEPS) {
        stepIndex = 0;
        loopCount++;
      }
    }
  }

  function ensureGraph() {
    ctx = M.audio.unlock();
    if (!ctx) return false;
    if (built) return true;

    const masterFilter = colourFilter = ctx.createBiquadFilter();
    masterFilter.type = 'lowpass';
    masterFilter.frequency.value = 5600;
    masterFilter.Q.value = 0.4;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.03;
    compressor.release.value = 0.5;

    master = ctx.createGain();
    master.gain.value = 0;
    atmosphere = ctx.createGain();
    atmosphere.gain.value = quiet;
    atmosphere.connect(master);
    action = ctx.createGain();
    action.gain.value = intensity * quiet;
    action.connect(master);
    master.connect(masterFilter);
    masterFilter.connect(compressor);
    compressor.connect(M.audio.getMusicInput());

    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(2.8, 2.7);
    const wet = ctx.createGain();
    wet.gain.value = 0.24;
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 1;
    atmosphereSend = ctx.createGain();
    atmosphereSend.gain.value = quiet * 0.8;
    atmosphereSend.connect(reverbSend);
    actionSend = ctx.createGain();
    actionSend.gain.value = intensity * quiet * 0.8;
    actionSend.connect(reverbSend);
    reverbSend.connect(convolver);
    convolver.connect(wet);
    wet.connect(master);

    noiseLong = makeNoiseBuffer(8);
    noiseShort = makeNoiseBuffer(0.35);

    // airy wind bed
    const wind = ctx.createBufferSource();
    wind.buffer = noiseLong;
    wind.loop = true;
    const windHigh = ctx.createBiquadFilter();
    windHigh.type = 'highpass';
    windHigh.frequency.value = 90;
    const windLow = ctx.createBiquadFilter();
    windLow.type = 'lowpass';
    windLow.frequency.value = 480;
    windLow.Q.value = 0.5;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.012;
    const windPan = ctx.createStereoPanner();
    windPan.pan.value = -0.15;
    wind.connect(windHigh);
    windHigh.connect(windLow);
    windLow.connect(windGain);
    windGain.connect(windPan);
    windPan.connect(atmosphere);
    wind.start();

    const windLfo = ctx.createOscillator();
    windLfo.type = 'sine';
    windLfo.frequency.value = 0.065;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 0.004;
    windLfo.connect(windLfoGain);
    windLfoGain.connect(windGain.gain);
    windLfo.start();

    built = true;
    return true;
  }

  function start() {
    if (playing) return true;
    if (!ensureGraph()) return false;

    playing = true;
    stepIndex = 0;
    loopCount = 0;
    nextTime = ctx.currentTime + 0.18;

    fadeMaster(MUSIC_LEVEL, 2.0);

    scheduleAhead();
    timer = setInterval(scheduleAhead, 80);
    return true;
  }

  function stop() {
    if (!playing) return false;
    playing = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (ctx) {
      fadeMaster(0, 0.8);
      // Fade and cancel queued notes too, so a quick restart does not revive
      // notes from the previous playback session.
      for (const voice of voices) voice.stop(ctx.currentTime + 0.35);
      voices.clear();
    }
    return false;
  }

  function toggle() {
    if (playing) {
      stop();
    } else {
      start();
    }
    return playing;
  }

  M.music = {
    start: start,
    stop: stop,
    toggle: toggle,
    update: update,
    isPlaying: function () { return playing; }
  };
})(window.Meadow = window.Meadow || {});
