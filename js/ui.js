(function (M) {
  'use strict';

  const { clamp } = M.utils;
  let bubbleEl = null;
  let bubbleTime = 0;
  let defenseEls = null;
  let lastHealth = 100;

  function showBubble(text) {
    if (!bubbleEl) return;
    bubbleEl.textContent = text;
    bubbleEl.classList.add('show');
    bubbleTime = 1.3;
  }

  function updateBubble(dt, headPivot, camera) {
    if (bubbleTime <= 0 || !headPivot) return;
    bubbleTime -= dt;

    const p = new THREE.Vector3(0, 0.82, 0.05);
    headPivot.localToWorld(p);
    p.project(camera);

    if (p.z > 1) {
      bubbleEl.classList.remove('show');
      bubbleTime = 0;
      return;
    }

    const x = clamp((p.x * 0.5 + 0.5) * window.innerWidth, 62, window.innerWidth - 62);
    const y = Math.max(58, (-p.y * 0.5 + 0.5) * window.innerHeight);
    bubbleEl.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-100%)';

    if (bubbleTime <= 0) {
      bubbleEl.classList.remove('show');
      bubbleTime = 0;
    }
  }

  function init() {
    bubbleEl = document.getElementById('bubble');
    defenseEls = {};
    ['tree-hp', 'tree-health', 'tree-health-fill', 'defense-coins', 'defense-enemies', 'defense-wave', 'defense-status', 'defeat'].forEach(function (id) {
      defenseEls[id] = document.getElementById(id);
    });
    const retry = document.getElementById('defense-retry');
    if (retry) retry.addEventListener('click', function () { window.location.reload(); });

    const greetButton = document.getElementById('hi');
    if (greetButton) {
      greetButton.addEventListener('click', function () {
        if (M.ui.onGreet) M.ui.onGreet();
      });
    }

    const musicButton = document.getElementById('music');
    if (musicButton) {
      musicButton.addEventListener('click', function () {
        if (M.ui.onMusicToggle) M.ui.onMusicToggle();
      });
    }

    const effectsButton = document.getElementById('effects');
    if (effectsButton) effectsButton.addEventListener('click', function () {
      const enabled = effectsButton.getAttribute('aria-pressed') !== 'true';
      M.audio.unlock(); M.audio.setEffectsEnabled(enabled);
      effectsButton.setAttribute('aria-pressed', String(enabled));
      effectsButton.setAttribute('aria-label', enabled ? 'Mute sound effects' : 'Unmute sound effects');
      effectsButton.classList.toggle('muted', !enabled);
      effectsButton.querySelector('.label').textContent = enabled ? 'Sound' : 'Muted';
    });

    window.addEventListener('keydown', function (event) {
      if (event.code === 'Escape') {
        const help = document.getElementById('controls-help');
        if (help) help.open = false;
      }
    });

    if (M.config.coarsePointer) {
      const hint = document.getElementById('hint');
      if (hint) hint.innerHTML = '<strong>Defend the Hearth</strong><p><b>Drag</b> Orbit<br><b>Pinch</b> Zoom<br><b>Tap</b> Headbutt / place</p><small>Horns: 2 hits · Stomp: 1 hit<br>Each zombie earns 1 coin.</small>';
    }
  }

  function setMusic(on) {
    const button = document.getElementById('music');
    if (!button) return;
    button.classList.toggle('on', !!on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.setAttribute('aria-label', on ? 'Turn music off' : 'Turn music on');
    const label = button.querySelector('.label');
    if (label) label.textContent = on ? 'Music on' : 'Music';
  }

  function setDefense(state) {
    if (!defenseEls) return;
    function text(id, value) { if (defenseEls[id]) defenseEls[id].textContent = value; }
    const card = document.querySelector('.objective-card');
    if (state.health < lastHealth && card) {
      card.classList.remove('damaged');
      void card.offsetWidth;
      card.classList.add('damaged');
    }
    lastHealth = state.health;
    text('tree-hp', state.health + ' / ' + state.maxHealth + ' HP');
    text('defense-coins', state.coins);
    text('defense-enemies', state.count + ' / 50');
    text('defense-wave', state.wave ? 'Wave ' + state.wave : 'Prepare your defenses');
    text('defense-status', state.defeated ? 'The Hearth has fallen' :
      state.wave ? 'Next wave in ' + state.nextWave + 's' : 'First zombies in ' + state.nextWave + 's');
    const bar = defenseEls['tree-health'];
    if (bar) {
      bar.setAttribute('aria-valuenow', state.health);
      bar.classList.toggle('critical', state.health <= 25);
    }
    if (defenseEls['tree-health-fill']) defenseEls['tree-health-fill'].style.width = state.health + '%';
    if (defenseEls.defeat) defenseEls.defeat.hidden = !state.defeated;
  }

  M.ui = {
    init: init,
    showBubble: showBubble,
    updateBubble: updateBubble,
    setMusic: setMusic,
    setDefense: setDefense,
    onGreet: null,
    onMusicToggle: null
  };
})(window.Meadow = window.Meadow || {});
