(function (M) {
  'use strict';

  const { rand } = M.utils;

  const SLOT_COUNT = 10;
  const DROP_SCALE = 0.24;
  const DROP_HALF = DROP_SCALE;
  const PICKUP_RADIUS = 1.4;
  const PICKUP_HEIGHT = 1.8;
  const MAX_DROPS = 160;

  const ITEM_NAMES = {
    grass: 'Grass Block',
    dirt: 'Dirt',
    stone: 'Stone',
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

  function itemName(kind) {
    return ITEM_NAMES[kind] || (kind.charAt(0).toUpperCase() + kind.slice(1));
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
    selectedSlot = index;
    renderSelection();
  }

  function addItem(kind) {
    let target = -1;

    // A matching stack always wins over opening a new slot.
    for (let i = 1; i < SLOT_COUNT; i++) {
      if (slots[i] && slots[i].kind === kind) {
        target = i;
        break;
      }
    }

    if (target >= 0) {
      slots[target].count++;
    } else {
      for (let i = 1; i < SLOT_COUNT; i++) {
        if (!slots[i]) {
          target = i;
          break;
        }
      }
      if (target < 0) return -1;
      slots[target] = { kind: kind, name: itemName(kind), count: 1 };
    }

    renderSlot(target);
    renderSelection();
    flashSlot(target);
    return target;
  }

  // ------------------------------------------------------------------- drops
  function dropBlock(kind, x, y, z) {
    if (!dropGroup || !M.world || !M.world.makeBlockMesh) return;
    const mesh = M.world.makeBlockMesh(kind);
    mesh.scale.setScalar(DROP_SCALE);
    mesh.position.set(x + rand(-0.16, 0.16), y, z + rand(-0.16, 0.16));
    mesh.rotation.y = rand(0, Math.PI * 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    mesh.userData.drop = {
      kind: kind,
      vy: rand(1.7, 3.3),
      landed: false,
      baseY: y,
      phase: rand(0, Math.PI * 2)
    };

    dropGroup.add(mesh);
    drops.push(mesh);

    if (drops.length > MAX_DROPS) {
      const oldest = drops.shift();
      dropGroup.remove(oldest);
    }
  }

  function collect(mesh, index) {
    const kind = mesh.userData.drop.kind;
    const slot = addItem(kind);
    if (slot < 0) return false;

    dropGroup.remove(mesh);
    drops.splice(index, 1);
    if (M.audio && M.audio.pickup) M.audio.pickup();
    return true;
  }

  function update(dt, t, goat) {
    if (!dropGroup || !goat) return;

    const gx = goat.position.x;
    const gy = goat.position.y + 0.9;
    const gz = goat.position.z;

    for (let i = drops.length - 1; i >= 0; i--) {
      const mesh = drops[i];
      const u = mesh.userData.drop;
      const dx = gx - mesh.position.x;
      const dy = gy - mesh.position.y;
      const dz = gz - mesh.position.z;
      const horiz = Math.hypot(dx, dz);

      // Pull nearby drops toward the goat's chest so they are easy to collect.
      if (horiz < PICKUP_RADIUS && Math.abs(dy) < PICKUP_HEIGHT) {
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

      if (!u.landed) {
        u.vy -= 22 * dt;
        const prevY = mesh.position.y;
        mesh.position.y += u.vy * dt;
        const floor = M.world.landingHeight(
          mesh.position.x,
          mesh.position.z,
          Math.max(prevY, mesh.position.y)
        ) + DROP_HALF;

        if (u.vy <= 0 && mesh.position.y <= floor) {
          mesh.position.y = floor;
          u.baseY = floor;
          u.vy = 0;
          u.landed = true;
        }
      } else {
        mesh.position.y = u.baseY + Math.sin(t * 2.6 + u.phase) * 0.07 + 0.035;
      }

      mesh.rotation.y += dt * 1.2;

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
    init: init,
    update: update,
    dropBlock: dropBlock,
    addItem: addItem,
    selectSlot: selectSlot,
    itemName: itemName,
    slots: slots,
    get selectedSlot() { return selectedSlot; },
    get drops() { return drops; }
  };
})(window.Meadow = window.Meadow || {});
