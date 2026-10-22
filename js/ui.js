(function (M) {
  'use strict';

  const { clamp } = M.utils;
  let bubbleEl = null;
  let bubbleTime = 0;

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

    if (M.config.coarsePointer) {
      const hint = document.getElementById('hint');
      if (hint) hint.innerHTML = '<b>drag</b> to orbit &nbsp;·&nbsp; <b>pinch</b> to zoom &nbsp;·&nbsp; <b>tap the goat</b>';
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

  M.ui = {
    init: init,
    showBubble: showBubble,
    updateBubble: updateBubble,
    setMusic: setMusic,
    onGreet: null,
    onMusicToggle: null
  };
})(window.Meadow = window.Meadow || {});
