(function (M) {
  'use strict';
  const RANGE = 80;
  let canvas, context, cooldown = 0;
  function project(position, player) {
    const x = (position.x - player.x) / RANGE, y = (position.z - player.z) / RANGE;
    const distance = Math.hypot(x, y), factor = 0.91 / Math.max(1, distance);
    return { x: x * factor, y: y * factor, outside: distance > 1 };
  }
  function draw() {
    if (!context || !M.goat.group) return;
    const size = canvas.clientWidth, ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (size <= 10) return; // Strategic view hides the minimap on compact screens.
    if (canvas.width !== Math.round(size * ratio)) canvas.width = canvas.height = Math.round(size * ratio);
    const ctx = context, center = size / 2, radius = center - 5, player = M.goat.group.position;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, size, size);
    ctx.save(); ctx.translate(center, center);
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#172b23ed'; ctx.fillRect(-center, -center, size, size);
    ctx.strokeStyle = '#b4c8a421'; ctx.lineWidth = 1;
    [0.5, 1].forEach(function (scale) { ctx.beginPath(); ctx.arc(0, 0, radius * scale, 0, Math.PI * 2); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(-radius, 0); ctx.lineTo(radius, 0); ctx.moveTo(0, -radius); ctx.lineTo(0, radius); ctx.stroke();
    function marker(position, color, kind) {
      const p = project(position, player), x = p.x * radius, y = p.y * radius;
      ctx.save(); ctx.translate(x, y); ctx.fillStyle = color; ctx.strokeStyle = '#102218'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (kind === 'approach') { ctx.moveTo(0, -6); ctx.lineTo(6, 5); ctx.lineTo(-6, 5); ctx.closePath(); }
      else if (kind === 'cave') { ctx.moveTo(-5, 4); ctx.lineTo(-5, -2); ctx.lineTo(0, -6); ctx.lineTo(5, -2); ctx.lineTo(5, 4); ctx.closePath(); }
      else if (kind === 'tree') { ctx.moveTo(0, -6); ctx.lineTo(5, 0); ctx.lineTo(0, 6); ctx.lineTo(-5, 0); ctx.closePath(); }
      else ctx.arc(0, 0, kind === 'npc' ? 3.5 : kind === 'coin' ? 2.6 : 2.8, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (kind === 'approach') {
        ctx.fillStyle = '#172b23'; ctx.font = 'bold 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', 0, 3);
      }
      if (p.outside) { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, kind === 'tree' ? 7.5 : 5, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }
    let coinStacks = 0;
    const defense = M.enemies.getState ? M.enemies.getState() : null;
    const approaches = defense && !defense.defeated && (defense.pending > 0 || defense.phase !== 'combat') ? defense.spawnLanes : [];
    if (approaches) approaches.forEach(function (lane) { marker(lane, '#ffc36a', 'approach'); });
    if (M.items && M.items.drops) M.items.drops.forEach(function (drop) {
      if (drop.userData.drop.kind !== 'coin') return;
      marker(drop.position, '#ffd45f', 'coin'); coinStacks++;
    });
    M.enemies.zombies.forEach(function (enemy) { marker(enemy.position, '#f58a72', 'enemy'); });
    M.animals.list.forEach(function (animal) { marker(animal.group.position, '#9dd9a8', 'npc'); });
    marker(M.hearthTree.position, '#f3d17d', 'tree');
    if (M.caves) marker(M.caves.starter, '#7cd7db', 'cave');
    ctx.save(); ctx.rotate(Math.PI - M.goat.state.yaw);
    ctx.fillStyle = '#fff7dc'; ctx.strokeStyle = '#153025'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = '#dce6cb'; ctx.font = '600 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', 0, -radius + 13);
    ctx.fillStyle = '#afc4a5'; ctx.font = '9px system-ui, sans-serif'; ctx.fillText(RANGE + 'm', 0, radius - 8);
    ctx.restore();
    ctx.strokeStyle = '#d4c58999'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(center, center, radius, 0, Math.PI * 2); ctx.stroke();
    canvas.setAttribute('aria-label', 'Minimap, north up, player centered. ' + M.enemies.zombies.length + ' enemies in red, ' + M.animals.list.length + ' animals in green, ' + coinStacks + ' coin stacks as gold dots, Hearth as a gold diamond, starter cave in cyan. Amber warning triangles mark incoming enemy approaches. Rings at the edge mark locations outside the 80 meter range.');
  }
  function init() { canvas = document.getElementById('minimap'); context = canvas && canvas.getContext('2d'); draw(); }
  function update(dt) { cooldown -= dt; if (cooldown > 0) return; cooldown = 0.1; draw(); }
  M.minimap = { init: init, update: update, project: project, range: RANGE };
})(window.Meadow = window.Meadow || {});
