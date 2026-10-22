(function (M) {
  'use strict';

  const { rand } = M.utils;

  const BPM = 72;
  const STEP = 60 / BPM / 2; // eighth note
  const BAR_DUR = STEP * 8;
  const LOOP_STEPS = 64;
  const MUSIC_LEVEL = 0.22;

  // D minor folk progression: Dm – Bb – F – C
  const CHORDS = [
    { bass: 38, pad: [50, 53, 57], arp: [50, 57, 62, 65, 69, 65, 62, 57] },
    { bass: 34, pad: [46, 50, 53], arp: [46, 53, 58, 62, 65, 62, 58, 53] },
    { bass: 41, pad: [53, 57, 60], arp: [53, 57, 60, 65, 69, 65, 60, 57] },
    { bass: 36, pad: [48, 52, 55], arp: [48, 55, 60, 64, 67, 64, 60, 55] }
  ];

  const MELODY = [
    [{ step: 0, midi: 74, len: 3 }, { step: 3, midi: 72, len: 2 }, { step: 5, midi: 69, len: 3 }],
    [{ step: 0, midi: 67, len: 2 }, { step: 2, midi: 69, len: 2 }, { step: 4, midi: 70, len: 4 }],
    [{ step: 0, midi: 65, len: 2 }, { step: 2, midi: 69, len: 2 }, { step: 4, midi: 72, len: 4 }],
    [{ step: 0, midi: 67, len: 2 }, { step: 2, midi: 64, len: 2 }, { step: 4, midi: 67, len: 4 }],
    [{ step: 0, midi: 74, len: 2 }, { step: 2, midi: 77, len: 2 }, { step: 4, midi: 76, len: 2 }, { step: 6, midi: 74, len: 2 }],
    [{ step: 0, midi: 72, len: 3 }, { step: 3, midi: 70, len: 2 }, { step: 5, midi: 69, len: 3 }],
    [{ step: 0, midi: 69, len: 2 }, { step: 2, midi: 72, len: 2 }, { step: 4, midi: 74, len: 2 }, { step: 6, midi: 72, len: 2 }],
    [{ step: 0, midi: 69, len: 4 }, { step: 4, midi: 67, len: 2 }, { step: 6, midi: 64, len: 2 }]
  ];

  let ctx = null;
  let master = null;
  let reverbSend = null;
  let built = false;
  let playing = false;
  let timer = null;
  let nextTime = 0;
  let stepIndex = 0;
  let loopCount = 0;
  let noiseLong = null;
  let noiseShort = null;

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function makeNoiseBuffer(seconds) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  function makeImpulse(seconds, decay) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, decay);
      }
    }
    return buffer;
  }

  function connectOut(node, pan, sendToReverb) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    node.connect(panner);
    panner.connect(master);
    if (sendToReverb) panner.connect(reverbSend);
  }

  function pluck(midi, when, level, pan) {
    const f = midiToFreq(midi);
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc.type = 'triangle';
    osc2.type = 'sine';
    osc.frequency.value = f;
    osc2.frequency.value = f * 2;
    osc.detune.value = rand(-4, 4);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(2300, when);
    filter.frequency.exponentialRampToValueAtTime(620, when + 1.0);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(level, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 1.35);

    const second = ctx.createGain();
    second.gain.value = 0.16;

    osc.connect(filter);
    osc2.connect(second);
    second.connect(filter);
    filter.connect(gain);
    connectOut(gain, pan, true);

    osc.start(when);
    osc2.start(when);
    osc.stop(when + 1.4);
    osc2.stop(when + 1.4);
  }

  function flute(midi, when, duration, level) {
    const f = midiToFreq(midi);
    const osc = ctx.createOscillator();
    const octave = ctx.createOscillator();
    osc.type = 'triangle';
    octave.type = 'sine';
    osc.frequency.value = f;
    octave.frequency.value = f * 2;

    const vib = ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 5.1;
    const vibGain = ctx.createGain();
    vibGain.gain.value = f * 0.0035;
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);
    vibGain.connect(octave.frequency);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1700;
    filter.Q.value = 0.5;

    const octaveGain = ctx.createGain();
    octaveGain.gain.value = 0.13;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(level, when + 0.06);
    gain.gain.setValueAtTime(level, when + Math.max(0.08, duration - 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.22);

    osc.connect(filter);
    octave.connect(octaveGain);
    octaveGain.connect(filter);
    filter.connect(gain);
    connectOut(gain, 0.08, true);

    osc.start(when);
    octave.start(when);
    vib.start(when);
    osc.stop(when + duration + 0.3);
    octave.stop(when + duration + 0.3);
    vib.stop(when + duration + 0.3);
  }

  function pad(midis, when) {
    for (let i = 0; i < midis.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreq(midis[i]);
      osc.detune.value = rand(-5, 5);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 720;
      filter.Q.value = 0.4;

      const gain = ctx.createGain();
      const level = 0.0065;
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(level, when + 0.75);
      gain.gain.setValueAtTime(level, when + BAR_DUR - 0.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + BAR_DUR + 0.1);

      osc.connect(filter);
      filter.connect(gain);
      connectOut(gain, i === 0 ? -0.25 : i === 2 ? 0.25 : 0, true);

      osc.start(when);
      osc.stop(when + BAR_DUR + 0.2);
    }
  }

  function bass(midi, when) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 240;
    filter.Q.value = 0.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.045, when + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 2.4);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc.start(when);
    osc.stop(when + 2.5);
  }

  function drum(when, strength) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(84, when);
    osc.frequency.exponentialRampToValueAtTime(48, when + 0.16);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.04 * strength, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.24);

    osc.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + 0.26);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseShort;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, when);
    ng.gain.exponentialRampToValueAtTime(0.012 * strength, when + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
    noise.connect(filter);
    filter.connect(ng);
    ng.connect(master);
    noise.start(when);
    noise.stop(when + 0.12);
  }

  function shaker(when, pan) {
    const noise = ctx.createBufferSource();
    noise.buffer = noiseShort;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 4200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.0065, when + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
    noise.connect(filter);
    filter.connect(gain);
    connectOut(gain, pan, false);
    noise.start(when);
    noise.stop(when + 0.1);
  }

  function scheduleStep(index, when) {
    const bar = Math.floor(index / 8);
    const step = index % 8;
    const chord = CHORDS[bar % 4];

    if (step === 0) {
      pad(chord.pad, when);
      bass(chord.bass, when);
    }

    const rest = step === 7 && bar % 2 === 1;
    if (!rest) {
      const accent = step === 0 ? 1.15 : step === 4 ? 1.0 : 0.8;
      pluck(
        chord.arp[step],
        when + rand(-0.005, 0.005),
        0.052 * accent * rand(0.86, 1.1),
        step % 2 ? 0.28 : -0.28
      );
    }

    const intro = loopCount === 0 && bar < 2;
    if (!intro) {
      const events = MELODY[bar];
      for (let i = 0; i < events.length; i++) {
        if (events[i].step === step) {
          flute(events[i].midi, when + 0.004, Math.max(0.3, events[i].len * STEP * 0.9), 0.036);
        }
      }
    }

    if (step === 0 || step === 4) drum(when, step === 0 ? 1 : 0.65);
    if (step === 2 || step === 6) shaker(when, step === 2 ? -0.45 : 0.45);
  }

  function scheduleAhead() {
    if (!playing) return;
    if (nextTime < ctx.currentTime - 0.3) nextTime = ctx.currentTime + 0.1;
    while (nextTime < ctx.currentTime + 0.7) {
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

    const masterFilter = ctx.createBiquadFilter();
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
    master.gain.value = 0.0001;
    master.connect(masterFilter);
    masterFilter.connect(compressor);
    compressor.connect(ctx.destination);

    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(2.8, 2.7);
    const wet = ctx.createGain();
    wet.gain.value = 0.34;
    reverbSend = ctx.createGain();
    reverbSend.gain.value = 1;
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
    windPan.connect(master);
    wind.start();

    const windLfo = ctx.createOscillator();
    windLfo.type = 'sine';
    windLfo.frequency.value = 0.065;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 0.004;
    windLfo.connect(windLfoGain);
    windLfoGain.connect(windGain.gain);
    windLfo.start();

    // low D/A drone under everything
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.011;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 270;
    droneFilter.Q.value = 0.4;
    droneGain.connect(droneFilter);
    droneFilter.connect(master);

    const droneNotes = [
      [73.416, 'triangle', 0.5],
      [110.0, 'sine', 0.32],
      [146.832, 'sine', 0.14]
    ];
    for (let i = 0; i < droneNotes.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = droneNotes[i][1];
      osc.frequency.value = droneNotes[i][0];
      osc.detune.value = rand(-3, 3);
      const gain = ctx.createGain();
      gain.gain.value = droneNotes[i][2];
      osc.connect(gain);
      gain.connect(droneGain);
      osc.start();
    }

    const droneLfo = ctx.createOscillator();
    droneLfo.type = 'sine';
    droneLfo.frequency.value = 0.045;
    const droneLfoGain = ctx.createGain();
    droneLfoGain.gain.value = 0.003;
    droneLfo.connect(droneLfoGain);
    droneLfoGain.connect(droneGain.gain);
    droneLfo.start();

    built = true;
    return true;
  }

  function start() {
    if (playing) return true;
    if (!ensureGraph()) return false;
    if (ctx.state === 'suspended') ctx.resume();

    playing = true;
    stepIndex = 0;
    loopCount = 0;
    nextTime = ctx.currentTime + 0.18;

    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
    master.gain.linearRampToValueAtTime(MUSIC_LEVEL, now + 2.0);

    scheduleAhead();
    timer = setInterval(scheduleAhead, 120);
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
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.linearRampToValueAtTime(0.0001, now + 1.2);
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
    isPlaying: function () { return playing; }
  };
})(window.Meadow = window.Meadow || {});
