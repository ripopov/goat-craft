(function (M) {
  'use strict';
  let active = false, camera, canvas, scene, panel, toggleButton;
  let inventoryMode = false, inventoryHome;
  let selected = null, inspected = null, ghost, range, grid, target = null, pointer = null, drag = null;
  let zoom = 52, hudTime = 0, messageTime = 0, lastHud = '';
  let yaw = 0, yawTarget = 0, turnStart = 0, turnTime = .2;
  const TURN_DURATION = .2;
  const focus = new THREE.Vector3(0, 14, 7), keys = new Set(), cards = [];
  const raycaster = new THREE.Raycaster();
  const names = { coins: 'Gold', log: 'Wood', stone: 'Stone', dirt: 'Soil', coal: 'Coal', copper: 'Copper', iron: 'Iron' };
  function costText(cost) { return Object.entries(cost).map(([kind, count]) => count + ' ' + names[kind]).join(' · '); }
  function announce(text) {
    const el = document.getElementById('rts-message');
    if (el) el.textContent = text;
    messageTime = 3;
  }
  function disposeGhost() {
    if (!ghost) return;
    scene.remove(ghost);
    ghost.traverse(node => {
      if (!node.isMesh) return;
      node.material.dispose();
      if (node.userData.inventoryPreview) node.geometry.dispose();
    });
    ghost = null;
  }
  function select(id) {
    if (!M.towers.byId[id]) return;
    inventoryMode = false;
    document.body.classList.remove('rts-inventory-mode');
    selected = id; inspected = null; disposeGhost();
    ghost = M.towers.model(id);
    ghost.traverse(node => {
      if (!node.isMesh) return;
      node.material = new THREE.MeshBasicMaterial({ color: 0x8ee6c1, transparent: true, opacity: .48, depthWrite: false });
      node.castShadow = node.receiveShadow = false;
    });
    ghost.visible = false; scene.add(ghost);
    document.getElementById('rts-pack').hidden = true;
    refresh(true);
  }
  function cancel() {
    inventoryMode = false;
    document.body.classList.remove('rts-inventory-mode');
    selected = null; inspected = null; target = null;
    disposeGhost(); range.visible = false;
    document.getElementById('rts-pack').hidden = true;
    refresh(true);
  }
  function useInventory() {
    cancel(); inventoryMode = true;
    document.body.classList.add('rts-inventory-mode');
    ghost = new THREE.Mesh(new THREE.BoxGeometry(2.02, 2.02, 2.02), new THREE.MeshBasicMaterial({ color: 0x8ee6c1, transparent: true, opacity: .35, depthWrite: false }));
    ghost.userData.inventoryPreview = true; ghost.visible = false; scene.add(ghost);
    const item = M.items.slots[M.items.selectedSlot];
    announce(item ? item.name + (item.kind === 'tool' ? ' · Click a block to mine or pack a tower' : ' · Click to place repeatedly · Right-click to cancel') : 'Empty slot · Open inventory (I) to equip items');
  }
  function suspendInput() {
    keys.clear(); pointer = drag = null;
    if (ghost) ghost.visible = false;
  }
  function setActive(value) {
    if (!camera || active === value) return;
    active = value;
    if (M.upgradeMenu.isOpen) M.upgradeMenu.close(true);
    if (M.inventoryMenu && M.inventoryMenu.isOpen) M.inventoryMenu.close(true);
    keys.clear(); pointer = drag = null; M.controls.stopSteering();
    document.body.classList.toggle('rts-active', active);
    const inventory = document.getElementById('inventory');
    if (active) { inventoryHome = inventory.parentNode; document.getElementById('rts-item-bar').appendChild(inventory); }
    else if (inventoryHome) inventoryHome.appendChild(inventory);
    panel.hidden = !active; toggleButton.setAttribute('aria-pressed', String(active));
    toggleButton.querySelector('span').textContent = active ? 'Return to goat' : 'Strategic view';
    if (active) {
      M.controls.suspendLook();
      const p = M.goat.group.position;
      focus.set(M.utils.clamp(p.x, -210, 210), 14, M.utils.clamp(p.z, -210, 210));
      camera.fov = 48; camera.updateProjectionMatrix();
      M.goat.group.visible = true;
      Object.assign(M.goat.state, { manualHold: 0, wait: .2, mode: 'idle', headbutt: -1, stomp: -1 });
      announce('Goat on autopilot · The battle continues');
      refresh(true);
    } else {
      yaw = yawTarget; turnTime = TURN_DURATION;
      cancel(); M.controls.resumeCamera();
      M.goat.state.manualHold = 3;
      M.controls.resumeLook();
    }
    grid.visible = active;
  }
  function refresh(force) {
    if (!panel) return;
    const counts = Object.keys(names).map(kind => kind === 'coins' ? M.enemies.getState().coins : M.items.count(kind));
    const owned = M.towers.definitions.map(def => M.towers.inventoryCount(def.id));
    const y = inspected ? inspected.position.y : target ? target.by * 2 : 14;
    const key = counts.join('/') + ':' + owned.join('/') + ':' + selected + ':' + M.towers.list.length + ':' + (inspected && inspected.kills) + ':' + y;
    if (!force && key === lastHud) return;
    lastHud = key;
    const resources = document.getElementById('rts-resources');
    resources.innerHTML = Object.keys(names).map((kind, i) => '<span data-resource="' + kind + '"><small>' + names[kind] + '</small><b>' + counts[i] + '</b></span>').join('');
    cards.forEach(({ button, ownedEl, def }, i) => {
      const affordable = M.towers.available(def);
      button.classList.toggle('chosen', selected === def.id);
      button.classList.toggle('unaffordable', !affordable);
      button.classList.toggle('packed', !!owned[i]);
      button.setAttribute('aria-pressed', String(selected === def.id));
      const label = def.name + '. ' + def.role + '. ' + (owned[i] ? owned[i] + ' packed in inventory. Free to redeploy.' : costText(def.cost)) + (affordable ? '' : '. Not enough resources.');
      button.setAttribute('aria-label', label); button.title = label;
      ownedEl.hidden = !owned[i];
      ownedEl.textContent = owned[i] ? 'Packed ×' + owned[i] : '';
    });
    const def = inspected ? inspected.def : M.towers.byId[selected];
    document.getElementById('rts-detail').hidden = !def;
    document.getElementById('rts-count').textContent = M.towers.list.length + ' / ' + M.towers.maxTowers + ' deployed';
    document.getElementById('rts-detail-title').textContent = def ? def.name : 'Build your defense';
    document.getElementById('rts-detail-role').textContent = def ? def.role : 'Ten towers. One living Hearth.';
    const img = document.getElementById('rts-detail-icon'); img.hidden = !def;
    if (def) img.src = 'assets/towers/' + def.id + '.png';
    const reach = def && M.towers.rangeAt(def, y), bonus = def && Math.round((reach / def.range - 1) * 100);
    const stats = document.getElementById('rts-detail-stats');
    stats.textContent = def ? def.damage + ' damage  /  ' + def.interval + 's  /  ' + Number(reach.toFixed(1)) + 'm range' +
      (bonus > 0 ? ' (+' + bonus + '% height)' : '') : 'Select a blueprint below, then click dry ground.';
    stats.title = 'Elevation adds 20% of base range per 2 Y: +20% at Y 16, +40% at Y 18, +60% at Y 20.';
    document.getElementById('rts-detail-cost').textContent = inspected ? inspected.kills + ' kills · Pack into a collectible item' : def ?
      (M.towers.inventoryCount(def.id) ? 'From inventory · No resources needed' : costText(def.cost)) : 'Mine wood, stone and soil. Defeat enemies for gold.';
  }
  function pick(x, y) {
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1), camera);
    return M.targeting.trace(raycaster.ray.origin, raycaster.ray.direction, 220);
  }
  function updateTarget() {
    if (inventoryMode && pointer) {
      const hit = pick(pointer.x, pointer.y), item = M.items.slots[M.items.selectedSlot];
      target = null; range.visible = false; ghost.visible = false;
      if (!hit || !item) return;
      if (item.kind === 'tool') {
        target = { bx: hit.bx, by: hit.by, bz: hit.bz, valid: true, hit };
      } else {
        const placement = M.items.placementTarget(hit);
        if (!placement) return;
        target = Object.assign({}, placement, { hit });
      }
      ghost.visible = true;
      ghost.position.set((target.bx + .5) * 2, (target.by + .5) * 2, (target.bz + .5) * 2);
      ghost.material.color.setHex(item.kind === 'tool' ? 0xf2cf7a : target.valid ? 0x8ee6c1 : 0xef8873);
      return;
    }
    if (!selected || !pointer) { if (ghost) ghost.visible = false; if (!inspected) range.visible = false; target = null; return; }
    const hit = pick(pointer.x, pointer.y);
    if (!hit) { ghost.visible = false; range.visible = false; target = null; return; }
    const bx = hit.bx, by = hit.by + 1, bz = hit.bz;
    const state = M.towers.site(selected, bx, by, bz), def = M.towers.byId[selected];
    target = { bx, by, bz, valid: state.valid && M.towers.available(def) };
    ghost.visible = true; ghost.position.set((bx + .5) * 2, by * 2, (bz + .5) * 2);
    ghost.traverse(node => { if (node.isMesh) node.material.color.setHex(target.valid ? 0x8ee6c1 : 0xef8873); });
    showRange(ghost.position, M.towers.rangeAt(def, ghost.position.y), target.valid);
    if (messageTime <= 0) document.getElementById('rts-message').textContent = !state.valid ? state.reason :
      !M.towers.available(def) ? 'Gather resources: ' + costText(def.cost) : state.reason;
  }
  function showRange(p, radius, valid) {
    range.visible = true; range.position.set(p.x, p.y + .06, p.z); range.scale.setScalar(radius);
    range.material.color.setHex(valid ? 0x9bd7bc : 0xef8873);
  }
  function click(e) {
    if (inventoryMode) {
      pointer = { x: e.clientX, y: e.clientY }; updateTarget();
      const item = M.items.slots[M.items.selectedSlot];
      if (!target || !item) { announce('Aim at terrain to use this slot.'); return; }
      const success = item.kind === 'tool' ? M.world.breakBlockAt(target.bx, target.by, target.bz) : M.items.placeSelectedBlock(target.hit);
      if (!success) { announce('Cannot use this item here. Check the ground and occupied cells.'); return; }
      announce(item.name + (item.kind === 'tool' ? ' · Block mined or tower packed' : ' placed'));
      if (item.kind !== 'tool' && !M.items.slots[M.items.selectedSlot]) cancel();
      else { updateTarget(); refresh(true); }
      return;
    }
    if (selected) {
      pointer = { x: e.clientX, y: e.clientY }; updateTarget();
      if (!target || !target.valid) { announce('Cannot deploy here. Check the ground and resource cost.'); return; }
      if (M.towers.place(selected, target.bx, target.by, target.bz)) {
        announce(M.towers.byId[selected].name + ' deployed');
        updateTarget(); refresh(true);
      }
      return;
    }
    const hit = pick(e.clientX, e.clientY), tower = hit && M.towers.atCell(hit.bx, hit.by, hit.bz);
    inspected = tower || null;
    document.getElementById('rts-pack').hidden = !tower;
    if (tower) showRange(tower.position, M.towers.rangeAt(tower.def, tower.position.y), true); else range.visible = false;
    refresh(true);
  }
  function recenter(goat) {
    const p = goat ? M.goat.group.position : M.hearthTree.position;
    focus.x = M.utils.clamp(p.x, -210, 210); focus.z = M.utils.clamp(p.z, -210, 210);
  }
  function turnTo(angle) {
    turnStart = yaw; yawTarget = angle; turnTime = 0;
    if (M.config.reducedMotion) { yaw = yawTarget; turnTime = TURN_DURATION; }
  }
  function turnBy(angle) { turnTo(yawTarget + angle); }
  function resetNorth() { turnTo(yaw - Math.atan2(Math.sin(yaw), Math.cos(yaw))); }
  function init(sceneValue, cameraValue) {
    scene = sceneValue; camera = cameraValue; canvas = document.getElementById('scene');
    panel = document.getElementById('rts-hud'); toggleButton = document.getElementById('strategy-toggle');
    grid = new THREE.GridHelper(440, 220, 0xb5d2a0, 0x94bfa4); grid.position.y = 14.035;
    grid.material.transparent = true; grid.material.opacity = .12; grid.material.depthWrite = false; grid.visible = false; scene.add(grid);
    range = new THREE.Mesh(new THREE.RingGeometry(.99, 1, 96), new THREE.MeshBasicMaterial({ color: 0x9bd7bc, side: THREE.DoubleSide, transparent: true, opacity: .65, depthWrite: false }));
    range.rotation.x = -Math.PI / 2; range.visible = false; scene.add(range);
    const animals = document.getElementById('rts-animals');
    M.animals.list.forEach(animal => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'rts-animal';
      button.setAttribute('aria-label', 'Upgrade ' + animal.name + ', ' + animal.species + ' ' + animal.role);
      button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'upgrade-menu');
      button.title = 'Upgrade ' + animal.name;
      const icon = document.createElement('img');
      icon.src = 'assets/animals/' + animal.name.toLowerCase() + '.svg'; icon.alt = ''; icon.draggable = false;
      icon.width = icon.height = 44;
      const label = document.createElement('span'), name = document.createElement('strong'), role = document.createElement('small');
      name.textContent = animal.name; role.textContent = animal.role;
      label.appendChild(name); label.appendChild(role); button.appendChild(icon); button.appendChild(label);
      button.addEventListener('click', () => {
        keys.clear(); pointer = drag = null;
        if (ghost) ghost.visible = false;
        M.upgradeMenu.open(animal);
      });
      animals.appendChild(button);
    });
    const roster = document.getElementById('rts-roster');
    M.towers.definitions.forEach((def, i) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tower-card';
      button.innerHTML = '<span class="tower-art"><img src="assets/towers/' + def.id + '.png" alt="" draggable="false"><kbd>⇧' + ((i + 1) % 10) + '</kbd></span><strong>' + def.name + '</strong><span class="tower-price">' + costText(def.cost) + '</span><span class="tower-owned"></span>';
      button.addEventListener('click', () => select(def.id)); roster.appendChild(button);
      cards.push({ button, def, ownedEl: button.querySelector('.tower-owned') });
    });
    document.getElementById('rts-inspect').addEventListener('click', cancel);
    toggleButton.addEventListener('click', () => setActive(!active));
    document.getElementById('rts-close').addEventListener('click', () => setActive(false));
    document.getElementById('rts-inventory').addEventListener('click', () => M.inventoryMenu.open());
    document.getElementById('rts-upgrades').addEventListener('click', () => M.upgradeMenu.open());
    document.getElementById('rts-hearth').addEventListener('click', () => recenter(false));
    document.getElementById('rts-goat').addEventListener('click', () => recenter(true));
    document.getElementById('rts-rotate-left').addEventListener('click', () => turnBy(-Math.PI / 2));
    document.getElementById('rts-rotate-right').addEventListener('click', () => turnBy(Math.PI / 2));
    document.getElementById('rts-compass').addEventListener('click', resetNorth);
    document.getElementById('rts-pack').addEventListener('click', () => {
      if (inspected && M.towers.dismantle(inspected)) { cancel(); announce('Packed on the ground · Walk your goat over it to collect'); }
    });
    window.addEventListener('keydown', e => {
      if (e.metaKey || e.altKey || e.ctrlKey) return;
      if (M.devConsole && M.devConsole.isOpen) return;
      if (e.code === 'KeyT' || e.key.toLowerCase() === 't') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!e.repeat) {
          const modal = M.upgradeMenu.isOpen || (M.inventoryMenu && M.inventoryMenu.isOpen);
          if (modal) {
            if (M.upgradeMenu.isOpen) M.upgradeMenu.close(true);
            if (M.inventoryMenu && M.inventoryMenu.isOpen) M.inventoryMenu.close(true);
            if (!active) setActive(true);
          } else setActive(!active);
        }
        return;
      }
      if (!active || M.upgradeMenu.isOpen || (M.inventoryMenu && M.inventoryMenu.isOpen)) return;
      const key = e.key.toLowerCase();
      // Let focused controls receive Space as their native activation key.
      if ((e.code === 'Space' || key === ' ') && e.target && e.target.closest && e.target.closest('button')) return;
      if (key === 'escape') { e.preventDefault(); e.stopImmediatePropagation(); if (selected || inspected || inventoryMode) cancel(); else setActive(false); return; }
      const leftTurn = e.code === 'KeyZ' || key === 'z', rightTurn = e.code === 'KeyX' || key === 'x';
      if (leftTurn || rightTurn) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!e.repeat) turnBy((leftTurn ? -1 : 1) * Math.PI / 2);
        return;
      }
      if ('wasd'.includes(key) || key.startsWith('arrow') || key === 'shift') keys.add(key);
      const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
      if (digit && !e.repeat) {
        const index = digit[1] === '0' ? 9 : +digit[1] - 1;
        if (e.shiftKey) select(M.towers.definitions[index].id);
        else M.items.selectSlot(index);
      }
      if (key === ' ' && !e.repeat) recenter(false);
      if (['w', 'a', 's', 'd', 'shift', ' ', 'p', 'e', 'f'].includes(key) || key.startsWith('arrow') || digit) {
        e.preventDefault(); e.stopImmediatePropagation();
      }
    }, true);
    window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()), true);
    window.addEventListener('blur', () => { keys.clear(); pointer = drag = null; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); pointer = drag = null; } });
    canvas.addEventListener('pointerdown', e => {
      if (!active) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (drag) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: 0, dragging: false, button: e.button };
      pointer = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId);
    }, true);
    canvas.addEventListener('pointermove', e => {
      if (!active) return;
      e.stopImmediatePropagation(); pointer = { x: e.clientX, y: e.clientY };
      if (drag && drag.id === e.pointerId) {
        let dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
        if (drag.moved > 8) {
          if (!drag.dragging) { dx = e.clientX - drag.startX; dy = e.clientY - drag.startY; drag.dragging = true; }
          if (drag.button === 2) {
            yaw += dx * .006; yawTarget = yaw; turnTime = TURN_DURATION;
          } else if (drag.button === 0) {
            const side = -dx * zoom * .0018, forward = dy * zoom * .0025;
            focus.x += side * Math.cos(yaw) - forward * Math.sin(yaw);
            focus.z += -side * Math.sin(yaw) - forward * Math.cos(yaw);
          }
        }
      }
    }, true);
    canvas.addEventListener('pointerup', e => {
      if (!active) return;
      e.stopImmediatePropagation();
      if (drag && drag.id === e.pointerId) {
        if (drag.moved <= 8 && e.button === 0) click(e);
        if (drag.moved <= 8 && e.button === 2) cancel();
        drag = null;
      }
    }, true);
    canvas.addEventListener('pointercancel', () => { drag = null; pointer = null; }, true);
    canvas.addEventListener('pointerleave', () => { if (!drag) pointer = null; });
    canvas.addEventListener('wheel', e => {
      if (!active) return;
      e.preventDefault(); e.stopImmediatePropagation(); zoom = M.utils.clamp(zoom * Math.exp(e.deltaY * .001), 28, 76);
    }, { capture: true, passive: false });
  }
  function update(dt) {
    if (!active) return;
    messageTime -= dt;
    if (inspected && !M.towers.list.includes(inspected)) cancel();
    if (turnTime < TURN_DURATION) {
      turnTime = Math.min(TURN_DURATION, turnTime + dt);
      const t = turnTime / TURN_DURATION, smooth = t * t * (3 - 2 * t);
      yaw = turnStart + (yawTarget - turnStart) * smooth;
    }
    const speed = zoom * .65 * dt * (keys.has('shift') ? 1.8 : 1);
    const side = ((keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0)) * speed;
    const forward = ((keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0)) * speed;
    focus.x += side * Math.cos(yaw) - forward * Math.sin(yaw);
    focus.z += -side * Math.sin(yaw) - forward * Math.cos(yaw);
    focus.x = M.utils.clamp(focus.x, -210, 210); focus.z = M.utils.clamp(focus.z, -210, 210);
    // Keep the command camera above tall trees and hills, independent of the goat.
    focus.y = M.utils.damp(focus.y, Math.max(14, M.world.surfaceHeight(focus.x, focus.z)), 5, dt);
    camera.position.set(focus.x + Math.sin(yaw) * zoom * .72, focus.y + zoom, focus.z + Math.cos(yaw) * zoom * .72); camera.lookAt(focus); camera.updateMatrixWorld();
    document.getElementById('rts-compass-needle').setAttribute('style', 'transform: rotate(' + yaw + 'rad)');
    M.goat.group.visible = true;
    updateTarget();
    hudTime -= dt; if (hudTime <= 0) { hudTime = .15; refresh(false); }
  }
  M.strategy = { useInventory, init, update, select, setActive, suspendInput, get active() { return active; }, get selected() { return selected; }, get focus() { return focus; } };
})(window.Meadow = window.Meadow || {});
