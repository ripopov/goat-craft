(function (M) {
  'use strict';
  const REACH = 5.5;
  function trace(origin, direction, limit) {
    const size = M.world.blockSize;
    const cell = { x: Math.floor(origin.x / size), y: Math.floor(origin.y / size), z: Math.floor(origin.z / size) };
    const step = {}, next = {}, delta = {};
    for (const axis of ['x', 'y', 'z']) {
      step[axis] = Math.sign(direction[axis]);
      delta[axis] = step[axis] ? size / Math.abs(direction[axis]) : Infinity;
      next[axis] = step[axis] ? ((cell[axis] + (step[axis] > 0 ? 1 : 0)) * size - origin[axis]) / direction[axis] : Infinity;
    }
    let distance = 0, normal = { x: 0, y: 0, z: 0 };
    for (let visited = 0; visited < 256 && distance <= limit; visited++) {
      const block = M.world.blockInfoAt(cell.x, cell.y, cell.z);
      if (block) return Object.assign({}, block, { distance: distance, normal: normal,
        point: new THREE.Vector3(origin.x + direction.x * distance, origin.y + direction.y * distance, origin.z + direction.z * distance) });
      distance = Math.min(next.x, next.y, next.z);
      if (!Number.isFinite(distance)) return null;
      normal = { x: 0, y: 0, z: 0 };
      let face = false;
      for (const axis of ['x', 'y', 'z']) if (next[axis] <= distance + 1e-9) {
        next[axis] += delta[axis]; cell[axis] += step[axis];
        if (!face) { normal[axis] = -step[axis]; face = true; }
      }
    }
    return null;
  }
  function aim(camera, player) {
    if (!camera || !player) return null;
    const direction = new THREE.Vector3(); camera.getWorldDirection(direction);
    const hit = trace(camera.position, direction, camera.position.distanceTo(player) + REACH + 3);
    if (!hit || M.world.isProtectedArea(hit.bx, hit.bz)) return null;
    const head = new THREE.Vector3(player.x, player.y + 1.2, player.z);
    const line = hit.point.clone().sub(head), length = line.length();
    if (length > REACH || length < .001) return null;
    line.normalize();
    const obstruction = trace(head, line, length + .02);
    if (!obstruction || obstruction.bx !== hit.bx || obstruction.by !== hit.by || obstruction.bz !== hit.bz) return null;
    // The landmark has fine voxels outside the terrain grid; keep it opaque
    // to reach tests too, rather than mining through protected roots or wood.
    if (M.hearthTree) for (let t = 0; t < length; t += .15) {
      const y = head.y + line.y * t;
      if (M.hearthTree.blockedAt(head.x + line.x * t, head.z + line.z * t, y, y + .03)) return null;
    }
    return hit;
  }
  M.targeting = { trace: trace, aim: aim, reach: REACH };
})(window.Meadow = window.Meadow || {});
