(function (M) {
  'use strict';
  let ghost, blockOutline, target = null;
  const animalShells = new WeakMap();
  const shellMaterial = new THREE.MeshBasicMaterial({ color: 0xf4d27f, side: THREE.BackSide, transparent: true, opacity: .65, depthWrite: false });
  function shells(animal) {
    if (animalShells.has(animal)) return animalShells.get(animal);
    const originals = [], outlines = [];
    animal.group.traverse(function (node) { if (node.isMesh) originals.push(node); });
    originals.forEach(function (node) {
      const shell = new THREE.Mesh(node.geometry, shellMaterial); shell.name = 'Q upgrade target'; shell.scale.setScalar(1.055);
      shell.visible = false; node.add(shell); outlines.push(shell);
    });
    animalShells.set(animal, outlines); return outlines;
  }
  function box(color) {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(M.world.blockSize + .015, M.world.blockSize + .015, M.world.blockSize + .015));
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: .7, depthWrite: false }));
    line.visible = false; return line;
  }
  function init(scene) {
    ghost = box(0x94e3cf); ghost.name = 'Block placement contour'; scene.add(ghost);
    blockOutline = box(0xf4d27f); blockOutline.name = 'Camera mining target'; scene.add(blockOutline);
  }
  function update() {
    if (M.strategy && M.strategy.active) {
      ghost.visible = blockOutline.visible = false;
      if (target) shells(target).forEach(function (shell) { shell.visible = false; });
      target = null; M.enemies.highlight(function () { return false; }); return;
    }
    const next = M.upgrades.nearest();
    if (next !== target) {
      if (target) shells(target).forEach(function (shell) { shell.visible = false; });
      target = next;
      if (target) shells(target).forEach(function (shell) { shell.visible = true; });
    }
    const player = M.goat.group.position, stats = M.upgrades.stats(), carrying = M.items.hasSelectedBlock();
    const levelOk = typeof M.upgrades.level === 'function';
    const reachLevel = levelOk ? M.upgrades.level(M.upgrades.player, 'reach') : 0;
    // Elemental tiers highlight every enemy the current strike would catch,
    // with no aiming cone; untrained tiers keep the melee arc highlight.
    const spellTargets = reachLevel >= 1 && M.enemies.spellTargets
      ? M.enemies.spellTargets(player, stats.reach, Infinity) : null;
    const direction = new THREE.Vector3(); M.goat.aimCamera.getWorldDirection(direction);
    const yaw = Math.atan2(direction.x, direction.z);
    M.enemies.highlight(function (enemy) {
      if (spellTargets) return spellTargets.includes(enemy);
      return (!carrying && M.enemies.canHit(enemy, player, yaw, false, 2.8)) ||
        (M.goat.state.grounded && M.enemies.canHit(enemy, player, yaw, true, 3.1));
    });
    const placement = carrying ? M.items.placementTarget() : null;
    ghost.visible = !!placement;
    if (placement) {
      const def = M.towers && M.towers.itemDefinition(placement.kind), height = def ? def.height : 1;
      ghost.scale.set(1, height, 1);
      ghost.position.set(placement.x, placement.y + (height - 1) * M.world.blockSize / 2, placement.z);
      ghost.material.color.setHex(placement.valid ? 0x94e3cf : 0xeb8e74);
    }
    const hit = carrying ? null : M.targeting.aim(M.goat.aimCamera, player);
    blockOutline.visible = !!hit;
    if (hit) { const size = M.world.blockSize; blockOutline.position.set((hit.bx + .5) * size, (hit.by + .5) * size, (hit.bz + .5) * size); }
    const reticle = document.getElementById('aim-reticle');
    if (reticle) reticle.classList.toggle('has-target', !!hit || !!(placement && placement.valid));
  }
  M.highlights = { init: init, update: update, get animal() { return target; }, get placement() { return ghost; }, get block() { return blockOutline; } };
})(window.Meadow = window.Meadow || {});
