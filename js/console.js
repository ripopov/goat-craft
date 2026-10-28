(function (M) {
  'use strict';

  // The console is a development shortcut, not a normal gameplay menu. It
  // stays out of the way until "/" is pressed and grants resources or starts
  // waves without touching the simulation directly.
  const AMOUNT = 1000;
  const FALLBACK_RESOURCES = ['log', 'stone', 'dirt', 'coal', 'copper', 'iron'];
  const RESOURCE_NAMES = { log: 'wood', stone: 'stone', dirt: 'soil', coal: 'coal', copper: 'copper', iron: 'iron' };
  const HISTORY_LIMIT = 40;

  let root, logEl, form, input, open = false;
  let history = [], historyIndex = 0, draft = '';

  function line(text, kind) {
    if (!logEl) return;
    const el = document.createElement('div');
    el.className = 'dev-console-line' + (kind ? ' ' + kind : '');
    el.textContent = text;
    logEl.appendChild(el);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function resourceKinds() {
    const kinds = new Set(FALLBACK_RESOURCES);
    if (M.towers && Array.isArray(M.towers.definitions)) {
      M.towers.definitions.forEach(function (def) {
        Object.keys(def.cost || {}).forEach(function (kind) {
          if (kind !== 'coins' && !kind.startsWith('tower_')) kinds.add(kind);
        });
      });
    }
    return Array.from(kinds);
  }

  function resourceNames(kinds) {
    return kinds.map(function (kind) { return RESOURCE_NAMES[kind] || kind; }).join(', ');
  }

  function giveMoney() {
    if (!M.enemies || typeof M.enemies.addCoins !== 'function' || !M.items || typeof M.items.addItem !== 'function') {
      line('Resource access is unavailable right now.', 'warn');
      return false;
    }
    if (!M.enemies.addCoins(AMOUNT)) {
      line('Could not add coins.', 'warn');
      return false;
    }
    const added = [], full = [];
    resourceKinds().forEach(function (kind) {
      if (M.items.addItem(kind, AMOUNT) < 0) full.push(kind);
      else added.push(kind);
    });
    line('Granted ' + AMOUNT + ' coins' +
      (added.length ? ' and ' + AMOUNT + ' each of ' + resourceNames(added) : '') + '.', 'ok');
    if (full.length) line('No hotbar space for ' + resourceNames(full) + '.', 'warn');
    return true;
  }

  function spawnWave(args) {
    if (!M.enemies || typeof M.enemies.startNextWave !== 'function') {
      line('Wave control is unavailable right now.', 'warn');
      return false;
    }
    args = Array.isArray(args) ? args : [];
    if (args.length > 1) {
      line('Spawn expects at most one wave level.', 'warn');
      return false;
    }
    const argument = args[0];
    const hasLevel = argument !== undefined && argument !== '';
    let level;
    if (hasLevel) {
      if (!/^\d+$/.test(argument)) {
        line('Wave level must be a whole number.', 'warn');
        return false;
      }
      level = Number(argument);
      if (!Number.isSafeInteger(level) || level < 1 || level > 100) {
        line('Wave level must be between 1 and 100.', 'warn');
        return false;
      }
      if (typeof M.enemies.startWave !== 'function') {
        line('Exact wave control is unavailable right now.', 'warn');
        return false;
      }
    }
    const started = hasLevel ? M.enemies.startWave(level) : M.enemies.startNextWave();
    if (!started) {
      line('Cannot start that wave right now.', 'warn');
      return false;
    }
    const state = M.enemies.getState();
    line('Wave ' + state.wave + ' incoming — ' + state.pending + (state.pending === 1 ? ' enemy.' : ' enemies.'), 'ok');
    return true;
  }

  function clearLog() {
    if (logEl) logEl.replaceChildren();
  }

  function execute(raw) {
    const tokens = String(raw || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    const command = tokens[0];
    line('> ' + tokens.join(' '), 'command');
    if (command === 'money') return giveMoney();
    if (command === 'spawn') return spawnWave(tokens.slice(1));
    if (command === 'clear') { clearLog(); return true; }
    line('Unknown command "' + tokens.join(' ') + '".', 'warn');
    return false;
  }

  function remember(command) {
    const text = String(command || '').trim();
    if (!text) return;
    if (history[history.length - 1] !== text) history.push(text);
    if (history.length > HISTORY_LIMIT) history.shift();
    historyIndex = history.length;
    draft = '';
  }

  function recall(step) {
    if (!history.length) return;
    if (historyIndex === history.length) draft = input.value;
    historyIndex = M.utils.clamp(historyIndex + step, 0, history.length);
    input.value = historyIndex === history.length ? draft : history[historyIndex];
    const end = input.value.length;
    if (typeof input.setSelectionRange === 'function') input.setSelectionRange(end, end);
  }

  function submit() {
    const command = input.value;
    remember(command);
    execute(command);
    input.value = '';
  }

  function openConsole() {
    if (open) return;
    if (M.upgradeMenu && M.upgradeMenu.isOpen) M.upgradeMenu.close();
    open = true;
    if (M.controls) {
      M.controls.stopSteering();
      M.controls.suspendLook();
    }
    root.hidden = false;
    historyIndex = history.length;
    draft = '';
    input.value = '';
    input.focus();
  }

  function closeConsole() {
    if (!open) return;
    open = false;
    root.hidden = true;
    if (typeof input.blur === 'function') input.blur();
    if (M.controls) {
      M.controls.noteActivity();
      M.controls.resumeLook();
    }
  }

  function editable(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function keydown(event) {
    if (event.isComposing) return;
    if (!open) {
      const slash = event.code === 'Slash' || event.code === 'NumpadDivide' || event.key === '/';
      if (!slash || event.metaKey || event.ctrlKey || event.altKey || event.repeat || editable(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openConsole();
      return;
    }

    // The same key that opens the console closes it too: "/" (or the numpad
    // root slash) drops it straight back into the game, just like the
    // upgrades menu with Q and the strategic view with T. Escape still works.
    if (event.key === 'Escape' || event.code === 'Slash' || event.code === 'NumpadDivide' || event.key === '/') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeConsole();
      return;
    }

    if (event.target !== input) {
      // The backdrop blocks the pointer; keep stray gameplay keys from
      // reaching the goat, camera or strategic view while the log is open.
      event.stopImmediatePropagation();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      submit();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'ArrowUp') recall(-1); else recall(1);
      return;
    }
    // Do not preventDefault: the focused input still edits normally. Only the
    // game's window-level gameplay handlers are silenced.
    event.stopImmediatePropagation();
  }

  function init() {
    root = document.getElementById('dev-console');
    logEl = document.getElementById('dev-console-log');
    form = document.getElementById('dev-console-form');
    input = document.getElementById('dev-console-input');
    if (!root || !logEl || !form || !input) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      submit();
    });
    root.addEventListener('pointerdown', function (event) {
      if (event.target !== root && event.target !== input && typeof input.focus === 'function') input.focus();
    });
    root.addEventListener('click', function (event) {
      if (event.target !== root) return;
      event.preventDefault();
      closeConsole();
    });
    window.addEventListener('keydown', keydown, true);
  }

  M.devConsole = {
    init: init,
    open: openConsole,
    close: closeConsole,
    execute: execute,
    get isOpen() { return open; }
  };
})(window.Meadow = window.Meadow || {});
