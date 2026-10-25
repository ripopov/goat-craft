(function (M) {
  'use strict';

  const { rand, clamp } = M.utils;

  const SLOT_COUNT = 10;
  const DROP_SCALE = 0.24;
  const DROP_HALF = DROP_SCALE;
  const PICKUP_RADIUS = 1.4;
  const PICKUP_HEIGHT = 1.8;
  const MAX_DROPS = 160;
  const HELD_SCALE = 0.32;
  const HELD_POS = { x: 0, y: 0.70, z: -0.35 };

  const ITEM_NAMES = {
    coin: 'Coin',
    grass: 'Grass Block',
    dirt: 'Dirt',
    stone: 'Stone',
    coal: 'Coal Ore', copper: 'Copper Ore', iron: 'Iron Ore',
    log: 'Oak Log',
    leaves: 'Leaves'
  };

  // Slot 1 is the goat's built-in horns-and-hooves "item". The other nine
  // slots collect blocks broken out of the world.
  const slots = new Array(SLOT_COUNT).fill(null);
  slots[0] = { kind: 'tool', name: 'Horns & Hooves', count: 1 };

  let selectedSlot = 0;
  let sceneRef = null;
  let dropGroup = null;
  let itemNameEl = null;
  const drops = [];
  const slotEls = [];
  const iconCache = Object.create(null);
  let toolIcon = null;
  let lastFullNotice = -10;
  let heldMesh = null;
  let heldKind = null;

  function itemName(kind) {
    if (M.towers && M.towers.itemDefinition(kind)) return M.towers.itemDefinition(kind).name;
    return ITEM_NAMES[kind] || (kind.charAt(0).toUpperCase() + kind.slice(1));
  }

  function selectedBlockKind() {
    const item = slots[selectedSlot];
    return item && item.kind !== 'tool' ? item.kind : null;
  }

  function hasSelectedBlock() {
    return !!selectedBlockKind();
  }

  // The selected stack is carried impaled on the goat's horns.
  function updateHeldBlock() {
    const head = M.goat && M.goat.headPivot;
    if (!head) return;

    const kind = selectedBlockKind();
    if (heldKind === kind && heldMesh && heldMesh.parent === head) return;

    if (heldMesh) {
      if (heldMesh.parent) heldMesh.parent.remove(heldMesh);
      heldMesh = null;
    }
    heldKind = kind;

    if (!kind || !M.world || !M.world.makeBlockMesh) return;
    heldMesh = M.world.makeBlockMesh(kind);
    heldMesh.scale.setScalar(HELD_SCALE);
    heldMesh.position.set(HELD_POS.x, HELD_POS.y, HELD_POS.z);
    heldMesh.castShadow = true;
    heldMesh.receiveShadow = true;
    head.add(heldMesh);
  }

  function refreshHeld() {
    updateHeldBlock();
  }

  // Use the camera hit face for both the contour and the actual placement.
  // Occupied cells are rejected before consuming the carried block.
  function placementTarget() {
    const kind = selectedBlockKind();
    if (!kind || !M.world || !M.goat || !M.goat.group) return null;
    if (M.towers && M.towers.itemDefinition(kind)) return M.towers.localTarget(kind);
    const size = M.world.blockSize || 2;
    const hit = M.targeting && M.goat.aimCamera ? M.targeting.aim(M.goat.aimCamera, M.goat.group.position) : null;
    if (!hit) return null;
    const bx = hit.bx + hit.normal.x, by = hit.by + hit.normal.y, bz = hit.bz + hit.normal.z;
    return { kind: kind, bx: bx, by: by, bz: bz, x: (bx + .5) * size, y: (by + .5) * size, z: (bz + .5) * size,
      valid: M.world.canPlaceBlock(bx, by, bz) };
  }
  function placeSelectedBlock() {
    const target = placementTarget();
    if (target && M.towers && M.towers.itemDefinition(target.kind)) {
      return target.valid && !!M.towers.place(M.towers.itemDefinition(target.kind).id, target.bx, target.by, target.bz, true);
    }
    if (!target || !target.valid || !M.world.placeBlock(target.kind, target.bx, target.by, target.bz)) return false;

    const item = slots[selectedSlot];
    if (item) {
      item.count--;
      if (item.count <= 0) slots[selectedSlot] = null;
      renderSlot(selectedSlot);
      renderSelection();
      flashSlot(selectedSlot);
    }
    return true;
  }

  // ---------------------------------------------------------------- artwork
  function makeToolIcon(size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const s = size / 64;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // horns
    ctx.strokeStyle = '#cbb58a';
    ctx.lineWidth = 5.4 * s;
    ctx.beginPath();
    ctx.moveTo(24 * s, 34 * s);
    ctx.bezierCurveTo(14 * s, 27 * s, 8 * s, 15 * s, 17 * s, 7 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(40 * s, 34 * s);
    ctx.bezierCurveTo(50 * s, 27 * s, 56 * s, 15 * s, 47 * s, 7 * s);
    ctx.stroke();

    ctx.strokeStyle = '#f1e2bc';
    ctx.lineWidth = 2.4 * s;
    ctx.beginPath();
    ctx.moveTo(25 * s, 31 * s);
    ctx.bezierCurveTo(18 * s, 24 * s, 15 * s, 15 * s, 20 * s, 10 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(39 * s, 31 * s);
    ctx.bezierCurveTo(46 * s, 24 * s, 49 * s, 15 * s, 44 * s, 10 * s);
    ctx.stroke();

    // head
    ctx.fillStyle = '#efe2c9';
    ctx.strokeStyle = 'rgba(83, 63, 40, .55)';
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    ctx.ellipse(32 * s, 39 * s, 10.5 * s, 12.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // muzzle
    ctx.fillStyle = '#f8eeda';
    ctx.beginPath();
    ctx.ellipse(32 * s, 45 * s, 6.2 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // eyes and nostrils
    ctx.fillStyle = '#33412e';
    ctx.beginPath();
    ctx.arc(28 * s, 37 * s, 1.35 * s, 0, Math.PI * 2);
    ctx.arc(36 * s, 37 * s, 1.35 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(80, 56, 40, .7)';
    ctx.beginPath();
    ctx.arc(30 * s, 44 * s, 0.8 * s, 0, Math.PI * 2);
    ctx.arc(34 * s, 44 * s, 0.8 * s, 0, Math.PI * 2);
    ctx.fill();

    // beard
    ctx.fillStyle = '#d8bd92';
    ctx.beginPath();
    ctx.moveTo(29 * s, 50 * s);
    ctx.lineTo(35 * s, 50 * s);
    ctx.lineTo(32 * s, 58 * s);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
    return canvas.toDataURL('image/png');
  }

  function iconFor(item) {
    if (!item) return null;
    if (item.kind === 'tool') {
      if (!toolIcon) toolIcon = makeToolIcon(64);
      return toolIcon;
    }
    if (!iconCache[item.kind] && M.world && M.world.blockIcon) {
      iconCache[item.kind] = M.world.blockIcon(item.kind, 64);
    }
    return iconCache[item.kind] || null;
  }

  // ------------------------------------------------------------------ hotbar
  function makeSlot(index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slot';
    button.dataset.slot = String(index);
    button.setAttribute('aria-pressed', 'false');

    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = String((index + 1) % 10);

    const img = document.createElement('img');
    img.className = 'icon';
    img.alt = '';
    img.draggable = false;
    img.style.display = 'none';

    const count = document.createElement('span');
    count.className = 'count';

    button.appendChild(key);
    button.appendChild(img);
    button.appendChild(count);
    button.addEventListener('click', function () {
      selectSlot(index);
    });

    slotEls.push({ button: button, img: img, count: count });
    return button;
  }

  function renderSlot(index) {
    const el = slotEls[index];
    if (!el) return;
    const item = slots[index];
    const src = iconFor(item);

    el.button.classList.toggle('has-item', !!item);
    if (src) {
      if (el.img.getAttribute('src') !== src) el.img.src = src;
      el.img.style.display = '';
    } else {
      el.img.style.display = 'none';
    }

    const showCount = item && item.kind !== 'tool' && item.count > 1;
    el.count.textContent = showCount ? String(item.count) : '';

    const key = (index + 1) % 10;
    const label = item
      ? item.name + (item.kind !== 'tool' && item.count > 1 ? ' x' + item.count : '')
      : 'Empty';
    el.button.setAttribute('aria-label', 'Slot ' + key + ': ' + label);
    el.button.title = 'Slot ' + key + ': ' + label;
  }

  function renderSelection() {
    for (let i = 0; i < slotEls.length; i++) {
      const selected = i === selectedSlot;
      slotEls[i].button.classList.toggle('selected', selected);
      slotEls[i].button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }

    if (itemNameEl) {
      const item = slots[selectedSlot];
      itemNameEl.textContent = item
        ? item.name + (item.kind !== 'tool' && item.count > 1 ? ' × ' + item.count : '')
        : 'Empty Slot';
    }

    updateHeldBlock();
  }

  function flashSlot(index) {
    const el = slotEls[index];
    if (!el) return;
    el.button.classList.remove('pop');
    void el.button.offsetWidth;
    el.button.classList.add('pop');
  }

  function selectSlot(index) {
    if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return;
    if (index !== selectedSlot && M.audio && M.audio.select) M.audio.select();
    selectedSlot = index;
    renderSelection();
  }

  function addItem(kind, count) {
    count = Math.max(1, Math.floor(count || 1));
    let target = -1;

    // A matching stack always wins over opening a new slot.
    for (let i = 1; i < SLOT_COUNT; i++) {
      if (slots[i] && slots[i].kind === kind) {
        target = i;
        break;
      }
    }

    if (target >= 0) {
      slots[target].count += count;
    } else {
      for (let i = 1; i < SLOT_COUNT; i++) {
        if (!slots[i]) {
          target = i;
          break;
        }
      }
      if (target < 0) return -1;
      slots[target] = { kind: kind, name: itemName(kind), count: count };
    }

    renderSlot(target);
    renderSelection();
    flashSlot(target);
    return target;
  }

  function countItem(kind) {
    return slots.reduce(function (sum, item) { return sum + (item && item.kind === kind ? item.count : 0); }, 0);
  }
  function canSpend(cost) {
    return Object.keys(cost).filter(function (kind) { return kind !== 'coins'; }).every(function (kind) {
      return kind !== 'tool' && Number.isInteger(cost[kind]) && cost[kind] >= 0 && countItem(kind) >= cost[kind];
    });
  }
  function spend(cost) {
    if (!canSpend(cost)) return false;
    Object.keys(cost).forEach(function (kind) {
      if (kind === 'coins') return;
      let left = cost[kind];
      for (let i = 1; i < SLOT_COUNT && left > 0; i++) {
        if (!slots[i] || slots[i].kind !== kind) continue;
        const amount = Math.min(left, slots[i].count);
        slots[i].count -= amount; left -= amount;
        if (!slots[i].count) slots[i] = null;
        renderSlot(i);
      }
    });
    renderSelection();
    return true;
  }

  // ------------------------------------------------------------------- drops
  function dropCoins(position, amount) {
    if (!Number.isInteger(amount) || amount <= 0) return;
    dropBlock('coin', position.x, position.y + 0.65, position.z, { persistent: true, count: amount });
  }
  function lootPathClear(ax, ay, az, bx, by, bz) {
    if (!M.world.blockedAt) return true;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay, bz - az) / 0.2));
    for (let i = 1; i < steps; i++) {
      const k = i / steps, y = ay + (by - ay) * k;
      if (M.world.blockedAt(ax + (bx - ax) * k, az + (bz - az) * k, y - 0.03, y + 0.03)) return false;
    }
    return true;
  }
  function dropBlock(kind, x, y, z, options) {
    if (!dropGroup || !M.world || !M.world.makeBlockMesh) return;
    const persistent = !!(options && options.persistent);
    const amount = options && Number.isInteger(options.count) && options.count > 0 ? options.count : 1;
    // Chewed materials persist. Nearby matching drops stack to keep long
    // sieges inexpensive without discarding the player's building supplies.
    if (persistent) {
      const nearby = drops.find(function (drop) {
        return drop.userData.drop.kind === kind && Math.hypot(drop.position.x - x, drop.position.z - z) < 4 &&
          Math.abs(drop.position.y - y) < 5 && lootPathClear(x, y, z, drop.position.x, drop.position.y, drop.position.z);
      });
      if (nearby) { nearby.userData.drop.count += amount; nearby.userData.drop.persistent = true; return; }
    }
    // Keep valuable loot physical and bounded, even after very long sieges.
    if (drops.length >= MAX_DROPS) {
      const disposable = drops.findIndex(function (drop) { return !drop.userData.drop.persistent; });
      if (disposable >= 0) dropGroup.remove(drops.splice(disposable, 1)[0]);
      else {
        const matching = drops.filter(function (drop) { return drop.userData.drop.kind === kind; });
        matching.sort(function (a, b) { return Math.hypot(a.position.x - x, a.position.z - z) - Math.hypot(b.position.x - x, b.position.z - z); });
        if (matching.length) { matching[0].userData.drop.count += amount; return; }
        // Free one slot by consolidating two old stacks of the same material.
        const seen = new Map();
        for (let i = 0; i < drops.length; i++) {
          const oldKind = drops[i].userData.drop.kind;
          if (seen.has(oldKind)) {
            seen.get(oldKind).userData.drop.count += drops[i].userData.drop.count;
            dropGroup.remove(drops.splice(i, 1)[0]); break;
          }
          seen.set(oldKind, drops[i]);
        }
      }
    }
    const mesh = kind === 'coin' ? M.coinModel.create() : M.world.makeBlockMesh(kind);
    mesh.scale.setScalar(DROP_SCALE);
    mesh.position.set(x + rand(-0.16, 0.16), y, z + rand(-0.16, 0.16));
    mesh.rotation.y = rand(0, Math.PI * 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    mesh.userData.drop = {
      kind: kind,
      count: amount,
      persistent: persistent,
      vy: rand(1.7, 3.3),
      landed: false,
      baseY: y,
      phase: rand(0, Math.PI * 2),
      age: 0
    };

    dropGroup.add(mesh);
    drops.push(mesh);

    if (drops.length > MAX_DROPS) {
      const disposable = drops.findIndex(function (drop) { return !drop.userData.drop.persistent; });
      if (disposable >= 0) dropGroup.remove(drops.splice(disposable, 1)[0]);
    }
  }

  function collect(mesh, index) {
    const kind = mesh.userData.drop.kind;
    if (kind === 'coin') {
      if (!M.enemies || !M.enemies.addCoins(mesh.userData.drop.count)) return false;
    } else if (addItem(kind, mesh.userData.drop.count) < 0) return false;

    dropGroup.remove(mesh);
    drops.splice(index, 1);
    if (M.audio && M.audio.pickup) M.audio.pickup();
    return true;
  }

  // Builders have their own construction purse. Removing the physical stack
  // here keeps player attraction and two nearby builders from claiming it twice.
  function nearestCoin(position, range) {
    let best = null, distance = range;
    for (const mesh of drops) {
      if (mesh.userData.drop.kind !== 'coin' || Math.abs(mesh.position.y - position.y - .9) > PICKUP_HEIGHT) continue;
      const d = Math.hypot(mesh.position.x - position.x, mesh.position.z - position.z);
      if (d >= distance || !lootPathClear(mesh.position.x, mesh.position.y, mesh.position.z, position.x, position.y + .9, position.z)) continue;
      best = mesh; distance = d;
    }
    return best;
  }
  function takeCoins(position) {
    let amount = 0;
    for (let i = drops.length - 1; i >= 0; i--) {
      const mesh = drops[i], u = mesh.userData.drop;
      if (u.kind !== 'coin' || Math.hypot(mesh.position.x - position.x, mesh.position.z - position.z) > 1.8 ||
          Math.abs(mesh.position.y - position.y - .9) > PICKUP_HEIGHT ||
          !lootPathClear(mesh.position.x, mesh.position.y, mesh.position.z, position.x, position.y + .9, position.z)) continue;
      amount += u.count; dropGroup.remove(mesh); drops.splice(i, 1);
    }
    if (amount && M.audio && M.audio.pickup) M.audio.pickup();
    return amount;
  }

  function update(dt, t, goat) {
    if (!dropGroup || !goat) return;

    M.coinModel.update(t, M.config.reducedMotion);
    const gx = goat.position.x;
    const gy = goat.position.y + 0.9;
    const gz = goat.position.z;

    for (let i = drops.length - 1; i >= 0; i--) {
      const mesh = drops[i];
      const u = mesh.userData.drop;
      u.age = (u.age || 0) + dt;
      const appear = M.config.reducedMotion ? 1 : 1 - Math.pow(1 - clamp(u.age / 0.2, 0, 1), 3);
      mesh.scale.setScalar(DROP_SCALE * (0.35 + appear * 0.65) * (u.kind === 'coin' ? Math.min(1.6, 1 + Math.log2(u.count) * 0.1) : 1));
      const dx = gx - mesh.position.x;
      const dy = gy - mesh.position.y;
      const dz = gz - mesh.position.z;
      const horiz = Math.hypot(dx, dz);

      // Pull nearby drops toward the goat's chest so they are easy to collect.
      const reachable = horiz < PICKUP_RADIUS && Math.abs(dy) < PICKUP_HEIGHT &&
        lootPathClear(mesh.position.x, mesh.position.y, mesh.position.z, gx, gy, gz);
      if (reachable) {
        const dist = Math.hypot(dx, dy, dz);
        // If the goat moves away mid-pull, let the drop fall normally again.
        u.landed = false;
        u.vy = 0;
        if (dist > 0.52) {
          const k = 1 - Math.exp(-11 * dt);
          mesh.position.x += dx * k;
          mesh.position.y += dy * k;
          mesh.position.z += dz * k;
          mesh.rotation.y += dt * 8;
          mesh.rotation.x += dt * 2.5;
        } else if (!collect(mesh, i)) {
          if (t - lastFullNotice > 1.6) {
            lastFullNotice = t;
            if (M.ui) M.ui.showBubble('no room!');
          }
        }
        continue;
      }

      if (u.landed) {
        const floor = M.world.landingHeight(mesh.position.x, mesh.position.z, u.baseY - DROP_HALF + 0.03) + DROP_HALF;
        if (floor < u.baseY - 0.05) { u.landed = false; u.vy = 0; }
      }
      if (!u.landed) {
        u.vy -= 22 * dt;
        const prevY = mesh.position.y;
        mesh.position.y += u.vy * dt;
        const floor = M.world.landingHeight(
          mesh.position.x,
          mesh.position.z,
          Math.max(prevY, mesh.position.y) - DROP_HALF + 0.001
        ) + DROP_HALF;

        if (u.vy <= 0 && mesh.position.y <= floor) {
          mesh.position.y = floor;
          u.baseY = floor;
          u.vy = 0;
          u.landed = true;
        }
      } else {
        mesh.position.y += (u.baseY + (M.config.reducedMotion ? 0 : Math.sin(t * 2.6 + u.phase) * 0.07 + 0.035) - mesh.position.y) * (1 - Math.exp(-12 * dt));
      }

      if (!M.config.reducedMotion) mesh.rotation.y += dt * 1.2;

      if (mesh.position.y < -8) {
        dropGroup.remove(mesh);
        drops.splice(i, 1);
      }
    }
  }

  // -------------------------------------------------------------------- init
  function init(scene) {
    sceneRef = scene;
    dropGroup = new THREE.Group();
    sceneRef.add(dropGroup);

    itemNameEl = document.getElementById('item-name');
    const hotbar = document.getElementById('hotbar');
    if (hotbar) {
      for (let i = 0; i < SLOT_COUNT; i++) {
        hotbar.appendChild(makeSlot(i));
      }
    }

    for (let i = 0; i < SLOT_COUNT; i++) renderSlot(i);
    renderSelection();
  }

  M.items = {
    count: countItem, canSpend: canSpend, spend: spend,
    init: init,
    update: update,
    dropBlock: dropBlock,
    dropCoins: dropCoins,
    nearestCoin: nearestCoin, takeCoins: takeCoins,
    addItem: addItem,
    selectSlot: selectSlot,
    itemName: itemName,
    hasSelectedBlock: hasSelectedBlock,
    placeSelectedBlock: placeSelectedBlock,
    placementTarget: placementTarget,
    refreshHeld: refreshHeld,
    slots: slots,
    get selectedSlot() { return selectedSlot; },
    get heldMesh() { return heldMesh; },
    get heldKind() { return heldKind; },
    get drops() { return drops; }
  };
})(window.Meadow = window.Meadow || {});
