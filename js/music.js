(function (M) {
  'use strict';

  const MUSIC_LEVEL = 0.12; // keep the mastered track behind gameplay effects
  const FADE_OUT = 0.35;
  let track = null;
  let playing = false;
  let pending = false;
  let request = 0;
  let timer = null;
  let fade = { from: 0, to: 0, start: 0, end: 0 };
  let scene = { from: 1, to: 1, start: 0, end: 0 };
  let duck = { from: 1, level: 1, start: -Infinity, end: -Infinity };

  function now() { return performance.now() / 1000; }

  function rampValue(ramp, time) {
    const k = ramp.end > ramp.start ? Math.min(1, Math.max(0, (time - ramp.start) / (ramp.end - ramp.start))) : 1;
    return ramp.from + (ramp.to - ramp.from) * k;
  }

  function duckValue(time) {
    if (time >= duck.end) return 1;
    const attack = duck.start + 0.025;
    if (time < attack) return duck.from + (duck.level - duck.from) * Math.max(0, (time - duck.start) / 0.025);
    return duck.level + (1 - duck.level) * (time - attack) / (duck.end - attack);
  }

  function clearTimer() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function tick() {
    if (!track) return;
    const time = now();
    track.volume = Math.min(1, Math.max(0, MUSIC_LEVEL * rampValue(fade, time) * rampValue(scene, time) * duckValue(time)));
    if (!playing && time >= fade.end) {
      track.pause();
      clearTimer();
    }
  }

  function fadeTo(target, seconds) {
    const time = now();
    fade = { from: rampValue(fade, time), to: target, start: time, end: time + seconds };
    if (timer === null) timer = setInterval(tick, 50);
    tick();
  }

  function failed(id) {
    // An interrupted play() may reject after a newer start. It must not mute it.
    if (id !== request) return;
    playing = pending = false;
    fade = { from: 0, to: 0, start: 0, end: 0 };
    tick();
  }

  function start() {
    if (playing && (pending || !track.paused)) return true;
    if (!track) {
      track = document.getElementById('game-music');
      if (!track) return false;
      // Keep native media output: routing file:// media through a Web Audio
      // MediaElementSource can produce CORS silence. No fetch, CDN or server.
      track.volume = 0;
      track.addEventListener('error', function () { failed(request); });
    }
    const id = ++request;
    playing = pending = true;
    fadeTo(1, 1.2);
    try {
      // Call synchronously inside the user's gesture, before any await/timer.
      const result = track.play();
      if (result && result.then) result.then(function () {
        if (id === request) pending = false;
      }, function () { failed(id); });
      else pending = false;
    } catch (err) { failed(id); }
    return playing;
  }

  function stop() {
    if (!track || !playing) return false;
    request++;
    playing = pending = false;
    fadeTo(0, FADE_OUT);
    // Preserve currentTime so switching music back on resumes the song.
    return false;
  }

  function update(dt, state) {
    state = state || {};
    const target = state.paused ? 0.12 : state.defeated ? 0.35 : state.underground ? 0.75 : 1;
    if (target === scene.to) return;
    const time = now();
    scene = { from: rampValue(scene, time), to: target, start: time, end: time + (state.paused ? 0.25 : 0.8) };
    tick();
  }

  function duckMusic(level, seconds) {
    const time = now();
    const from = duckValue(time);
    duck = { from: from, level: Math.min(from, Math.max(0, Math.min(1, level))),
      start: time, end: time + Math.max(0.05, seconds) };
    tick();
  }

  M.music = {
    start: start,
    stop: stop,
    toggle: function () { return playing ? stop() : start(); },
    update: update,
    duck: duckMusic,
    isPlaying: function () { return playing && (pending || !track.paused); }
  };
})(window.Meadow = window.Meadow || {});
