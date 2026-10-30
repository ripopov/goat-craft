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
    ['tree-hp', 'tree-health', 'tree-health-fill', 'defense-coins', 'defense-enemies', 'defense-gates', 'gate-detail', 'defense-wave-card', 'defense-wave', 'defense-status', 'defeat', 'final-boss-hud', 'final-boss-hp', 'final-boss-health', 'final-boss-fill'].forEach(function (id) {
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
      if (hint) hint.innerHTML = '<strong>Defend the Hearth</strong><p><b>Drag</b> Orbit<br><b>Pinch</b> Zoom<br><b>Tap</b> Headbutt / place</p><small>Tap Upgrades to train yourself or a nearby animal.<br>Clear waves for bonus coins.</small>';
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
    text('defense-enemies', state.count + ' / ' + state.maxEnemies);
    text('defense-gates', (state.gatesDestroyed || 0) + ' / 8');
    text('gate-detail', state.finalBoss ? 'Gates sealed. Defeat the last dreamer.' : 'Four gates. Two lives each. Towers can shatter them.');
    const approaches = state.approaches ? ' · ' + state.approaches : '';
    text('defense-wave', state.finalBoss ? 'FINAL BOSS · CTHULHU' : state.wave ? 'Wave ' + state.wave + (state.phase === 'combat' || state.phase === 'endless' ? approaches : '') : 'Prepare your defenses');
    text('defense-status', state.victorious ? 'Cthulhu defeated · Victory!' : state.defeated ? 'The Hearth has fallen' :
      state.finalBoss ? (state.finalBoss.emerging ? 'The elder awakens…' : 'Defeat Cthulhu · Protect the Hearth') :
      state.phase === 'endless' ? 'Endless assault · Seal all eight gates' :
      state.phase === 'combat' ? (state.pending ? state.pending + ' incoming' + (state.nextSquad ? ' · squad in ' + state.nextSquad + 's' : '') : 'Clear the remaining enemies') :
      state.wave ? 'Next wave in ' + state.nextWave + 's' + approaches + ' · Q to train' : 'First wave in ' + state.nextWave + 's' + approaches);
    const elder = state.finalBoss, bossHud = defenseEls['final-boss-hud'];
    if (defenseEls['defense-wave-card']) defenseEls['defense-wave-card'].hidden = !!elder;
    if (bossHud) bossHud.hidden = !elder || state.defeated || state.victorious;
    if (elder) {
      text('final-boss-hp', Math.ceil(elder.hp) + ' / ' + elder.maxHp + ' HP');
      const bossBar = defenseEls['final-boss-health'];
      if (bossBar) { bossBar.setAttribute('aria-valuemax', elder.maxHp); bossBar.setAttribute('aria-valuenow', Math.max(0, elder.hp)); }
      if (defenseEls['final-boss-fill']) defenseEls['final-boss-fill'].style.width = Math.max(0, elder.hp / elder.maxHp * 100) + '%';
    }
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
