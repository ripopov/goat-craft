(function (M) {
  'use strict';

  const { rand, clamp } = M.utils;
  let ctx = null;
  let noiseBuffer = null;
  let stepSide = 1;

  function makeNoise(seconds) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function unlock() {
    try {
      if (!ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        ctx = new Ctx();
      }
      if (ctx.state === 'suspended') ctx.resume();
      if (!noiseBuffer) noiseBuffer = makeNoise(1.2);
      return ctx;
    } catch (err) {
      return null;
    }
  }

  function out(pan) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(ctx.destination);
    return panner;
  }

  function bleat() {
    try {
      const audio = unlock();
      if (!audio) return;

      const now = audio.currentTime + 0.01;
      const dur = 0.55;
      const base = rand(235, 285);

      const osc = audio.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.linearRampToValueAtTime(base * 1.14, now + 0.08);
      osc.frequency.exponentialRampToValueAtTime(base * 0.62, now + dur);

      const vib = audio.createOscillator();
      vib.type = 'sine';
      vib.frequency.value = rand(19, 26);
      const vibGain = audio.createGain();
      vibGain.gain.value = 22;
      vib.connect(vibGain);
      vibGain.connect(osc.frequency);

      const filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1500;
      filter.Q.value = 3;

      const body = audio.createBiquadFilter();
      body.type = 'peaking';
      body.frequency.value = 850;
      body.gain.value = 7;
      body.Q.value = 1.4;

      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.13, now + 0.03);
      gain.gain.setValueAtTime(0.13, now + 0.17);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      osc.connect(filter);
      filter.connect(body);
      body.connect(gain);
      gain.connect(audio.destination);

      osc.start(now);
      vib.start(now);
      osc.stop(now + dur + 0.05);
      vib.stop(now + dur + 0.05);
    } catch (err) { /* audio is a bonus, never fatal */ }
  }

  function thud() {
    try {
      const audio = ctx;
      if (!audio) return;

      const now = audio.currentTime + 0.005;
      const dur = 0.16;

      const buffer = audio.createBuffer(1, Math.max(1, Math.floor(audio.sampleRate * dur)), audio.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / data.length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
      }

      const src = audio.createBufferSource();
      src.buffer = buffer;
      const filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      filter.Q.value = 0.7;
      const gain = audio.createGain();
      gain.gain.value = 0.08;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(audio.destination);
      src.start(now);

      const osc = audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(95, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.12);
      const og = audio.createGain();
      og.gain.setValueAtTime(0.0001, now);
      og.gain.exponentialRampToValueAtTime(0.11, now + 0.01);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
      osc.connect(og);
      og.connect(audio.destination);
      osc.start(now);
      osc.stop(now + 0.16);

      // short stony crack
      const crackSrc = audio.createBufferSource();
      crackSrc.buffer = noiseBuffer;
      const crackFilter = audio.createBiquadFilter();
      crackFilter.type = 'bandpass';
      crackFilter.frequency.value = 1900;
      crackFilter.Q.value = 1.1;
      const crackGain = audio.createGain();
      crackGain.gain.setValueAtTime(0.0001, now);
      crackGain.gain.exponentialRampToValueAtTime(0.018, now + 0.004);
      crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
      crackSrc.connect(crackFilter);
      crackFilter.connect(crackGain);
      crackGain.connect(audio.destination);
      crackSrc.start(now);
      crackSrc.stop(now + 0.07);
    } catch (err) { /* audio is a bonus */ }
  }

  function step(running, speed) {
    try {
      const audio = ctx;
      if (!audio) return;

      const now = audio.currentTime + 0.002;
      const intensity = clamp(speed / 9.6, 0, 1);
      const level = (running ? 0.038 : 0.026) * (0.75 + intensity * 0.4);
      stepSide *= -1;
      const dest = out(stepSide * (running ? 0.22 : 0.16));

      // soft hoof body
      const osc = audio.createOscillator();
      osc.type = 'sine';
      const f0 = running ? rand(84, 100) : rand(100, 120);
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, now + 0.08);
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(level, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.11);

      // grass rustle
      const hiss = audio.createBufferSource();
      hiss.buffer = noiseBuffer;
      const filter = audio.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = rand(760, 1450);
      filter.Q.value = 0.8;
      const ng = audio.createGain();
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.exponentialRampToValueAtTime(level * 0.32, now + 0.005);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      hiss.connect(filter);
      filter.connect(ng);
      ng.connect(dest);
      hiss.start(now, rand(0, 0.42));
      hiss.stop(now + 0.09);

      // tiny hoof tick
      const tick = audio.createBufferSource();
      tick.buffer = noiseBuffer;
      const high = audio.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 2800;
      const tg = audio.createGain();
      tg.gain.setValueAtTime(0.0001, now);
      tg.gain.exponentialRampToValueAtTime(level * 0.12, now + 0.003);
      tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
      tick.connect(high);
      high.connect(tg);
      tg.connect(dest);
      tick.start(now, rand(0, 0.55));
      tick.stop(now + 0.04);
    } catch (err) { /* audio is a bonus */ }
  }

  function jump() {
    try {
      const audio = unlock();
      if (!audio) return;

      const now = audio.currentTime + 0.002;
      const dest = out(0.12);

      const src = audio.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = audio.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.1;
      filter.frequency.setValueAtTime(520, now);
      filter.frequency.exponentialRampToValueAtTime(1500, now + 0.1);
      filter.frequency.exponentialRampToValueAtTime(580, now + 0.24);
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.014, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      src.start(now, rand(0, 0.3));
      src.stop(now + 0.3);

      const breath = audio.createOscillator();
      breath.type = 'triangle';
      breath.frequency.setValueAtTime(145, now);
      breath.frequency.exponentialRampToValueAtTime(210, now + 0.12);
      const bg = audio.createGain();
      bg.gain.setValueAtTime(0.0001, now);
      bg.gain.exponentialRampToValueAtTime(0.0045, now + 0.02);
      bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      breath.connect(bg);
      bg.connect(dest);
      breath.start(now);
      breath.stop(now + 0.15);
    } catch (err) { /* audio is a bonus */ }
  }

  function whoosh() {
    try {
      const audio = unlock();
      if (!audio) return;

      const now = audio.currentTime + 0.002;
      const dest = out(0.1);
      const src = audio.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = audio.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.4;
      filter.frequency.setValueAtTime(340, now);
      filter.frequency.exponentialRampToValueAtTime(1700, now + 0.1);
      filter.frequency.exponentialRampToValueAtTime(420, now + 0.19);
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.018, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      src.start(now, rand(0, 0.4));
      src.stop(now + 0.22);
    } catch (err) { /* audio is a bonus */ }
  }

  function land(force) {
    try {
      const audio = ctx;
      if (!audio) return;

      const now = audio.currentTime + 0.002;
      const strength = clamp(force, 0.3, 1.2);
      const dest = out(0);

      const osc = audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(96, now);
      osc.frequency.exponentialRampToValueAtTime(46, now + 0.15);
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05 * strength, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.22);

      const hiss = audio.createBufferSource();
      hiss.buffer = noiseBuffer;
      const filter = audio.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 560;
      filter.Q.value = 0.8;
      const ng = audio.createGain();
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.exponentialRampToValueAtTime(0.014 * strength, now + 0.008);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      hiss.connect(filter);
      filter.connect(ng);
      ng.connect(dest);
      hiss.start(now, rand(0, 0.45));
      hiss.stop(now + 0.16);
    } catch (err) { /* audio is a bonus */ }
  }

  function stomp(broke) {
    try {
      const audio = unlock();
      if (!audio) return;

      const now = audio.currentTime + 0.002;
      const dest = out(0);

      // heavy hoof hitting packed earth
      const osc = audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(86, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.18);
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + 0.26);

      const hiss = audio.createBufferSource();
      hiss.buffer = noiseBuffer;
      const filter = audio.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.7;
      const ng = audio.createGain();
      ng.gain.setValueAtTime(0.0001, now);
      ng.gain.exponentialRampToValueAtTime(0.024, now + 0.006);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
      hiss.connect(filter);
      filter.connect(ng);
      ng.connect(dest);
      hiss.start(now, rand(0, 0.45));
      hiss.stop(now + 0.19);

      if (broke) {
        const crack = audio.createBufferSource();
        crack.buffer = noiseBuffer;
        const crackFilter = audio.createBiquadFilter();
        crackFilter.type = 'bandpass';
        crackFilter.frequency.value = 1750;
        crackFilter.Q.value = 1.2;
        const crackGain = audio.createGain();
        crackGain.gain.setValueAtTime(0.0001, now);
        crackGain.gain.exponentialRampToValueAtTime(0.022, now + 0.004);
        crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        crack.connect(crackFilter);
        crackFilter.connect(crackGain);
        crackGain.connect(dest);
        crack.start(now, rand(0, 0.5));
        crack.stop(now + 0.09);

        const scatter = audio.createBufferSource();
        scatter.buffer = noiseBuffer;
        const scatterFilter = audio.createBiquadFilter();
        scatterFilter.type = 'highpass';
        scatterFilter.frequency.value = 950;
        const scatterGain = audio.createGain();
        scatterGain.gain.setValueAtTime(0.0001, now + 0.01);
        scatterGain.gain.exponentialRampToValueAtTime(0.011, now + 0.025);
        scatterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        scatter.connect(scatterFilter);
        scatterFilter.connect(scatterGain);
        scatterGain.connect(dest);
        scatter.start(now + 0.01, rand(0, 0.4));
        scatter.stop(now + 0.18);
      }
    } catch (err) { /* audio is a bonus */ }
  }

  function breath() {
    try {
      const audio = ctx;
      if (!audio) return;

      const now = audio.currentTime + 0.02;
      const dest = out(rand(-0.12, 0.12));
      const src = audio.createBufferSource();
      src.buffer = noiseBuffer;
      const filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 620;
      filter.Q.value = 0.4;
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.0045, now + 0.28);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      src.start(now, rand(0, 0.2));
      src.stop(now + 0.8);
    } catch (err) { /* audio is a bonus */ }
  }

  M.audio = {
    unlock: unlock,
    bleat: bleat,
    thud: thud,
    step: step,
    jump: jump,
    whoosh: whoosh,
    land: land,
    stomp: stomp,
    breath: breath
  };
})(window.Meadow = window.Meadow || {});
