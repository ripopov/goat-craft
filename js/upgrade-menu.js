(function (M) {
  'use strict';
  let dialog, target, nearby, previousFocus;
  const $ = function (id) { return document.getElementById(id); };
  const labels = { coins: 'coins', log: 'wood', stone: 'stone' };
  const icons = {
    move: 'assets/upgrades/move.png',
    cadence: 'assets/upgrades/cadence.png',
    reach: 'assets/upgrades/reach.png',
    power: 'assets/upgrades/power.png',
    craft: 'assets/upgrades/craft.png'
  };
  function balance(kind) { return kind === 'coins' ? M.enemies.getState().coins : M.items.count(kind); }
  function render() {
    const isPlayer = target === M.upgrades.player;
    $('upgrade-title').textContent = isPlayer ? 'Your goat' : target.name;
    $('upgrade-role').textContent = isPlayer ? 'Hearth defender' : target.species + ' · ' + target.role;
    $('upgrade-emblem').textContent = isPlayer ? 'YOU' : target.name.slice(0, 1);
    $('upgrade-note').textContent = isPlayer ? 'Build your own fighting style. Training lasts for this run.' :
      target.role === 'builder' ? 'Invest in faster walls and repairs. Training belongs to ' + target.name + '.' :
      'Strengthen your hunting partner. Training belongs to ' + target.name + '.';
    $('upgrade-player-tab').setAttribute('aria-pressed', String(isPlayer));
    $('upgrade-animal-tab').setAttribute('aria-pressed', String(!isPlayer));
    $('upgrade-resources').textContent = balance('coins') + ' coins  ·  ' + balance('log') + ' wood  ·  ' + balance('stone') + ' stone';
    const cards = $('upgrade-cards'); cards.replaceChildren();
    M.upgrades.keys(target).forEach(function (key) {
      const offer = M.upgrades.offer(target, key);
      const card = document.createElement('article'); card.className = 'upgrade-card';
      const heading = document.createElement('div'); heading.className = 'upgrade-card-heading';
      const icon = document.createElement('img'); icon.className = 'upgrade-icon';
      icon.src = icons[key]; icon.alt = ''; icon.setAttribute('aria-hidden', 'true');
      icon.width = 64; icon.height = 64; icon.draggable = false; icon.decoding = 'async';
      heading.appendChild(icon);
      const summary = document.createElement('div'); summary.className = 'upgrade-card-summary';
      const title = document.createElement('h3'); title.textContent = offer.name;
      const rank = document.createElement('span'); rank.className = 'upgrade-rank'; rank.textContent = offer.level + ' / 3';
      title.appendChild(rank); summary.appendChild(title);
      const pips = document.createElement('div'); pips.className = 'upgrade-pips'; pips.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 3; i++) { const pip = document.createElement('i'); if (i < offer.level) pip.className = 'trained'; pips.appendChild(pip); }
      summary.appendChild(pips); heading.appendChild(summary); card.appendChild(heading);
      const description = document.createElement('p'); description.textContent = offer.description; card.appendChild(description);
      const effect = document.createElement('div'); effect.className = 'upgrade-effect';
      effect.textContent = offer.maxed ? offer.current + ' · Mastered' : offer.current + ' → ' + offer.next;
      card.appendChild(effect);
      const cost = document.createElement('div'); cost.className = 'upgrade-cost';
      if (!offer.maxed) Object.keys(offer.cost).forEach(function (kind) {
        const chip = document.createElement('span'), owned = balance(kind), required = offer.cost[kind];
        chip.className = owned < required ? 'short' : '';
        chip.textContent = required + ' ' + labels[kind];
        chip.title = 'You have ' + owned + ' / need ' + required + ' ' + labels[kind];
        cost.appendChild(chip);
      });
      else cost.textContent = 'All three tiers unlocked';
      card.appendChild(cost);
      const button = document.createElement('button'); button.type = 'button'; button.dataset.upgrade = key;
      const affordable = M.upgrades.canAfford(offer.cost);
      button.disabled = offer.maxed || !affordable;
      button.textContent = offer.maxed ? 'Fully trained' : affordable ? 'Train tier ' + (offer.level + 1) : 'Gather resources';
      button.setAttribute('aria-label', offer.maxed ? offer.name + ', fully trained' : 'Train ' + offer.name + ', tier ' + (offer.level + 1));
      button.addEventListener('click', function () {
        if (!M.upgrades.buy(target, key)) return;
        const message = (isPlayer ? 'Your goat' : target.name) + ': ' + offer.name + ' tier ' + (offer.level + 1) + ' trained.';
        render(); $('upgrade-message').textContent = message;
        const next = dialog.querySelector('[data-upgrade="' + key + '"]:not(:disabled)') || dialog.querySelector('[data-upgrade]:not(:disabled)') || $('upgrade-close');
        next.focus();
      });
      card.appendChild(button); cards.appendChild(card);
    });
  }
  function close() {
    if (!dialog || !dialog.open) return;
    dialog.close();
    M.controls.resumeLook();
  }
  function open(animal) {
    if (!dialog || dialog.open || (M.devConsole && M.devConsole.isOpen) || M.enemies.getState().defeated) return;
    previousFocus = document.activeElement;
    nearby = M.animals && M.animals.list.includes(animal) ? animal : M.upgrades.nearest();
    target = nearby || M.upgrades.player;
    M.controls.stopSteering(); M.controls.suspendLook(); M.controls.noteActivity();
    M.goat.state.manualHold = Math.max(3, M.goat.state.manualHold);
    const help = $('controls-help'); if (help) help.open = false;
    $('upgrade-animal-tab').hidden = !nearby;
    $('upgrade-animal-tab').textContent = nearby ? nearby.name : 'Nearby animal';
    $('upgrade-message').textContent = '';
    render(); dialog.showModal();
    (nearby ? $('upgrade-animal-tab') : $('upgrade-player-tab')).focus();
  }
  function init() {
    dialog = $('upgrade-menu');
    $('upgrade-open').addEventListener('click', function () { open(); });
    $('upgrade-close').addEventListener('click', close);
    $('upgrade-player-tab').addEventListener('click', function () { target = M.upgrades.player; $('upgrade-message').textContent = ''; render(); });
    $('upgrade-animal-tab').addEventListener('click', function () { if (nearby) { target = nearby; $('upgrade-message').textContent = ''; render(); } });
    dialog.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab') return;
      const buttons = Array.from(dialog.querySelectorAll('button:not(:disabled):not([hidden])'));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
    dialog.addEventListener('close', function () {
      M.controls.stopSteering(); M.controls.noteActivity();
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      M.controls.resumeLook();
    });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
    } });
  }
  M.upgradeMenu = { init: init, open: open, close: close, toggle: function () { if (dialog && dialog.open) close(); else open(); },
    get isOpen() { return !!dialog && dialog.open; }, get target() { return target; } };
})(window.Meadow = window.Meadow || {});
