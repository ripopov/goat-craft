(function (M) {
  'use strict';

  const { rand } = M.utils;
  let ctx = null;

  function unlock() {
    try {
      if (!ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        ctx = new Ctx();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (err) {
      return null;
    }
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
    } catch (err) { /* audio is a bonus */ }
  }

  M.audio = {
    unlock: unlock,
    bleat: bleat,
    thud: thud
  };
})(window.Meadow = window.Meadow || {});
