(function (M) {
  'use strict';

  // Each trade exchanges a fixed bundle. Buying costs more than selling pays.
  const offers = [
    { kind: 'log', amount: 5, buy: 8, sell: 3 },
    { kind: 'stone', amount: 5, buy: 8, sell: 3 },
    { kind: 'dirt', amount: 5, buy: 4, sell: 1 },
    { kind: 'grass', amount: 5, buy: 5, sell: 1 },
    { kind: 'leaves', amount: 5, buy: 4, sell: 1 },
    { kind: 'coal', amount: 5, buy: 12, sell: 5 },
    { kind: 'copper', amount: 5, buy: 15, sell: 6 },
    { kind: 'iron', amount: 5, buy: 20, sell: 8 }
  ];
  let dialog, previousFocus, selected = null, skipClose = 0;
  const $ = id => document.getElementById(id);

  function trade(kind, direction) {
    const offer = offers.find(item => item.kind === kind);
    if (!offer || !M.enemies || !M.items) return false;
    if (direction === 'buy') {
      if (M.enemies.getState().coins < offer.buy || !M.items.canAdd(kind, offer.amount)) return false;
      if (!M.enemies.spendCoins(offer.buy)) return false;
      if (M.items.addItem(kind, offer.amount) < 0) { M.enemies.addCoins(offer.buy); return false; }
      return true;
    }
    if (direction === 'sell') {
      const cost = { [kind]: offer.amount };
      if (!M.items.canSpend(cost) || !Number.isSafeInteger(M.enemies.getState().coins + offer.sell)) return false;
      if (!M.items.spend(cost)) return false;
      M.enemies.addCoins(offer.sell);
      return true;
    }
    return false;
  }

  function renderSlot(index, parent) {
    const item = M.items.slots[index];
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'bag-slot'; button.dataset.inventorySlot = String(index);
    button.classList.toggle('chosen', selected === index);
    const label = index < M.items.hotbarSize ? 'Hotbar ' + ((index + 1) % 10) : 'Bag ' + (index - M.items.hotbarSize + 1);
    button.setAttribute('aria-label', label + ': ' + (item ? item.name + (item.kind === 'tool' ? '' : ' × ' + item.count) : 'Empty'));
    button.setAttribute('aria-pressed', String(selected === index));
    button.title = button.getAttribute('aria-label');
    if (index === 0) button.disabled = true;
    const number = document.createElement('span'); number.className = 'bag-slot-number';
    number.textContent = index < M.items.hotbarSize ? String((index + 1) % 10) : '';
    button.appendChild(number);
    const icon = M.items.iconFor(item);
    if (icon) { const img = document.createElement('img'); img.src = icon; img.alt = ''; button.appendChild(img); }
    if (item && item.kind !== 'tool') { const count = document.createElement('span'); count.className = 'bag-slot-count'; count.textContent = item.count; button.appendChild(count); }
    button.addEventListener('click', function () {
      if (selected === null) { if (item) selected = index; }
      else if (selected === index) selected = null;
      else { M.items.moveStack(selected, index); selected = null; }
      render();
      const focused = dialog.querySelector('[data-inventory-slot="' + index + '"]'); if (focused) focused.focus();
    });
    parent.appendChild(button);
  }
  function render() {
    const hotbar = $('bag-hotbar'), bag = $('bag-grid'); hotbar.replaceChildren(); bag.replaceChildren();
    M.items.slots.forEach((item, index) => renderSlot(index, index < M.items.hotbarSize ? hotbar : bag));
    $('bag-coins').textContent = M.enemies.getState().coins + ' coins';
    $('bag-instruction').textContent = selected === null ? 'Select a stack, then select a slot to move or swap it.' : 'Choose a destination for ' + M.items.slots[selected].name + ', or select it again to cancel.';
    const list = $('trade-list'); list.replaceChildren();
    offers.forEach(function (offer) {
      const row = document.createElement('div'); row.className = 'trade-row';
      const info = document.createElement('div'); info.className = 'trade-info';
      const name = document.createElement('strong'); name.textContent = M.items.itemName(offer.kind);
      const owned = document.createElement('small'); owned.textContent = M.items.count(offer.kind) + ' owned';
      info.appendChild(name); info.appendChild(owned); row.appendChild(info);
      ['buy', 'sell'].forEach(function (direction) {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = direction === 'buy' ? 'Buy ' + offer.amount + ' · ' + offer.buy + ' coins' : 'Sell ' + offer.amount + ' · ' + offer.sell + ' coins';
        button.disabled = direction === 'buy' ? M.enemies.getState().coins < offer.buy || !M.items.canAdd(offer.kind, offer.amount) : M.items.count(offer.kind) < offer.amount;
        button.setAttribute('aria-label', button.textContent + ' ' + M.items.itemName(offer.kind));
        button.dataset.trade = direction + '-' + offer.kind;
        button.addEventListener('click', function () {
          if (!trade(offer.kind, direction)) return;
          selected = null; render();
          $('bag-message').textContent = (direction === 'buy' ? 'Bought ' : 'Sold ') + offer.amount + ' ' + M.items.itemName(offer.kind) + '.';
          const next = dialog.querySelector('[data-trade="' + direction + '-' + offer.kind + '"]');
          if (next && !next.disabled) next.focus(); else $('bag-close').focus();
        });
        row.appendChild(button);
      });
      list.appendChild(row);
    });
  }
  function close(switching) { if (dialog && dialog.open) { if (switching) skipClose++; dialog.close(); } }
  function open() {
    if (!dialog || dialog.open || (M.devConsole && M.devConsole.isOpen) || M.enemies.getState().defeated || (M.victory && M.victory.active) || (M.oceanHorror && M.oceanHorror.active)) return;
    const focus = M.upgradeMenu && M.upgradeMenu.isOpen ? M.upgradeMenu.returnFocus : document.activeElement;
    if (M.upgradeMenu && M.upgradeMenu.isOpen) M.upgradeMenu.close(true);
    if (M.strategy && M.strategy.active) M.strategy.suspendInput();
    previousFocus = focus; selected = null; $('bag-message').textContent = '';
    M.controls.stopSteering(); M.controls.suspendLook(); M.controls.noteActivity();
    const help = $('controls-help'); if (help) help.open = false;
    render(); dialog.showModal(); $('bag-close').focus();
  }
  function init() {
    dialog = $('bag-menu');
    $('bag-open').addEventListener('click', open); $('bag-close').addEventListener('click', function () { close(); });
    $('bag-to-upgrades').addEventListener('click', function () { M.upgradeMenu.open(); });
    $('bag-to-strategy').addEventListener('click', function () { close(true); M.strategy.setActive(true); });
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); close(); });
    dialog.addEventListener('close', function () {
      if (skipClose) { skipClose--; return; }
      M.controls.stopSteering(); M.controls.noteActivity();
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      M.controls.resumeLook();
    });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) close(); });
  }
  M.inventoryMenu = { init: init, open: open, close: close, trade: trade, offers: offers,
    toggle: function () { if (dialog && dialog.open) close(); else open(); },
    get returnFocus() { return previousFocus; }, get isOpen() { return !!dialog && dialog.open; } };
})(window.Meadow = window.Meadow || {});
