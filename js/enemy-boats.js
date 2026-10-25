(function (M) {
  'use strict';

  const CREW = 4, MAX_BOATS = 64, SPEED = 8;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seats = [[-.78, -.95], [.78, -.95], [-.78, .95], [.78, .95]];
  const hullBody = { radius: 1.35, height: 3.9, skin: .002 };

  // Water-only delivery is separate from the walkers' shared flow field. The
  // ocean lies beyond that field; connected rivers bring crews into it.
  function create(scene, world, tree, navigation, spawnAt) {
    const boats = [], size = world.blockSize;
    let routes = null, mesh = null, launchCount = 0;
    const matrix = new THREE.Matrix4(), root = new THREE.Matrix4();
    const point = new THREE.Vector3(), scale = new THREE.Vector3();
    const rotation = new THREE.Euler(), quaternion = new THREE.Quaternion();
    const pieces = [];
    function piece(x, y, z, sx, sy, sz, tint, kind) {
      pieces.push({ x, y, z, sx, sy, sz, color: new THREE.Color(tint), kind });
    }
    for (let i = -2; i <= 2; i++) piece(i * .58, -.05, 0, .55, .25, 4.6 - Math.abs(i) * .35, i % 2 ? 0x805631 : 0x986c3e);
    for (const side of [-1, 1]) {
      piece(side * 1.5, .25, 0, .22, .65, 3.8, 0x62432c);
      piece(side * 1.52, .62, 0, .28, .15, 3.9, 0xc39a58);
      for (const z of [-1.4, 1.4]) piece(side * 1.55, .25, z, .26, .72, .16, 0x35464b);
      piece(side * 1.75, .28, -.3, .14, .13, 2.7, 0xa2814b, 'oar');
      piece(side * 1.75, .28, -1.65, .44, .12, .8, 0x805631, 'oar');
      piece(side * 1.8, -.16, -1, .18, .035, 2.8, 0x9cd8df, 'wake');
    }
    for (const z of [-1, 1]) {
      piece(0, .16, z * 2.05, 2.3, .55, .2, 0x805631);
      piece(0, .65, z * 2.26, .35, .55, .42, 0x35464b);
    }
    piece(0, .4, 0, 2.8, .19, .38, 0xc39a58);
    piece(0, 1.05, 2.25, .3, .28, .3, 0xffcb76);

    function waterAt(bx, bz) {
      return world.waterInfoAtBlock && world.waterInfoAtBlock(bx, bz);
    }
    function navigable(bx, bz) {
      const water = waterAt(bx, bz), x = (bx + .5) * size, z = (bz + .5) * size;
      if (!water || water.depth < .75 || !M.actorPhysics.clear(world, x, water.level + .18, z, hullBody)) return null;
      // Keep the whole hull afloat, including corners at bends.
      for (const dx of [-1.4, 1.4]) for (const dz of [-1.4, 1.4]) {
        const edge = waterAt(Math.floor((x + dx) / size), Math.floor((z + dz) / size));
        if (!edge || edge.depth < .45 || Math.abs(edge.level - water.level) > .1) return null;
      }
      return { bx, bz, x, y: water.level, z };
    }
    function discover() {
      const cache = new Map(), visited = new Map(), queue = [], found = [];
      const cx = Math.floor(tree.position.x / size), cz = Math.floor(tree.position.z / size);
      const key = (x, z) => x + ',' + z;
      function sample(bx, bz) {
        const id = key(bx, bz);
        if (!cache.has(id)) cache.set(id, navigable(bx, bz));
        return cache.get(id);
      }
      const dry = new Map();
      navigation.nodes.forEach(n => {
        if (n.swim || world.waterDepthAt(n.x, n.z) >= .3 || Math.hypot(n.x - tree.position.x, n.z - tree.position.z) < 22) return;
        const id = key(n.bx, n.bz);
        if (!dry.has(id)) dry.set(id, []);
        dry.get(id).push(n);
      });
      // A landing sits just off a real walkable bank, within the existing
      // navigation field. Four separate spots prevent overlapping arrivals.
      for (const node of navigation.nodes) {
        if (!node.swim || Math.hypot(node.x - tree.position.x, node.z - tree.position.z) > 68) continue;
        const water = sample(node.bx, node.bz);
        if (!water) continue;
        const nearby = [];
        for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) nearby.push(...(dry.get(key(node.bx + dx, node.bz + dz)) || []));
        const land = nearby.filter(n => Math.hypot(n.x - node.x, n.z - node.z) <= 6 &&
          n.y >= water.y - .2 && n.y <= water.y + size + .1 &&
          M.actorPhysics.clear(world, n.x, n.y, n.z, { radius: .46, height: 3.7, skin: .002 }))
          .sort((a, b) => (Number.isFinite(a.distance) ? 0 : 20) - (Number.isFinite(b.distance) ? 0 : 20) +
            Math.hypot(a.x - node.x, a.z - node.z) - Math.hypot(b.x - node.x, b.z - node.z));
        if (land.length < CREW) continue;
        const entry = { ...water, parent: null, land: land.slice(0, CREW) };
        queue.push(entry); visited.set(key(node.bx, node.bz), entry);
      }
      // A bounded multi-source flood connects landings to genuine sea water,
      // never ponds or dry ground. Discovery runs once, lazily on the first raid.
      const sides = new Set();
      for (let i = 0; i < queue.length && i < 20000; i++) {
        const node = queue[i], info = waterAt(node.bx, node.bz), side = Math.sign(node.x - tree.position.x);
        if (info.type === 'sea' && info.depth >= 4 && !sides.has(side)) {
          const path = []; let cursor = node;
          while (cursor) { path.push({ x: cursor.x, y: cursor.y, z: cursor.z }); if (!cursor.parent) break; cursor = cursor.parent; }
          if (path.length >= 12) {
            found.push({ path, land: cursor.land }); sides.add(side);
            if (sides.size === 2) break;
          }
        }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const bx = node.bx + dx, bz = node.bz + dz, id = key(bx, bz);
          if (Math.abs(bx - cx) > 160 || Math.abs(bz - cz) > 100 || visited.has(id)) continue;
          const next = sample(bx, bz);
          if (!next || Math.abs(next.y - node.y) > .1) continue;
          const entry = { ...next, parent: node }; visited.set(id, entry); queue.push(entry);
        }
      }
      return found;
    }
    function collapse(boat) {
      if (boat.collapse !== undefined) return;
      boat.collapse = 0;
      if (M.audio && M.audio.enemy) M.audio.enemy('boat', 'land', boat.position);
    }
    function launch(types) {
      if (types.length !== CREW || boats.length >= MAX_BOATS) return null;
      if (!routes) routes = discover();
      const available = routes.filter(route => !boats.some(b => b.collapse === undefined && b.position.distanceToSquared(route.path[0]) < 49));
      if (!available.length) return null;
      const route = available[launchCount++ % available.length], start = route.path[0];
      if (!navigable(Math.floor(start.x / size), Math.floor(start.z / size))) return null;
      const boat = { position: new THREE.Vector3(start.x, start.y, start.z), yaw: Math.atan2(route.path[1].x - start.x, route.path[1].z - start.z),
        path: route.path, land: route.land, cursor: 1, crew: [], age: 0 };
      for (let i = 0; i < CREW; i++) {
        const enemy = spawnAt({ x: start.x, y: start.y + .18, z: start.z }, types[i], { surface: true });
        if (!enemy) throw new Error('Boat crew capacity must be reserved before launch');
        enemy.boat = boat; enemy.boatSeat = i; enemy.mode = 'sail'; enemy.grounded = false;
        boat.crew.push(enemy);
      }
      boats.push(boat); placeCrew(boat);
      return boat.crew;
    }
    function placeCrew(boat) {
      const motion = !(M.config.reducedMotion || reducedMotion);
      const bob = motion ? Math.sin(boat.age * 2.8) * .055 : 0;
      boat.crew.forEach(enemy => {
        if (enemy.hp <= 0 || enemy.boat !== boat) return;
        const seat = seats[enemy.boatSeat], c = Math.cos(boat.yaw), s = Math.sin(boat.yaw);
        enemy.position.set(boat.position.x + seat[0] * c + seat[1] * s, boat.position.y + .18 + bob,
          boat.position.z - seat[0] * s + seat[1] * c);
        enemy.yaw = boat.yaw; enemy.mode = 'sail'; enemy.moving = false;
      });
    }
    function disembark(boat) {
      const occupied = [];
      for (const enemy of boat.crew) {
        if (enemy.hp <= 0 || enemy.boat !== boat) continue;
        const land = boat.land.find(n => !occupied.includes(n) && M.actorPhysics.clear(world, n.x, n.y, n.z, enemy.body));
        // An edited bank must not teleport a crew through the new wall. Drop
        // into navigable water and let ordinary swimming/breach AI take over.
        const to = land || { x: boat.position.x, y: boat.position.y - M.actorPhysics.swimDepth(enemy.body), z: boat.position.z };
        if (land) occupied.push(land);
        enemy.boatExit = { from: enemy.position.clone(), to: new THREE.Vector3(to.x, to.y, to.z), age: 0 };
        enemy.boat = null; enemy.mode = 'disembark'; enemy.target = null; enemy.path = null;
      }
      collapse(boat);
    }
    function update(dt) {
      for (let i = boats.length - 1; i >= 0; i--) {
        const boat = boats[i]; boat.age += dt;
        if (boat.collapse !== undefined) {
          boat.collapse += dt;
          if (boat.collapse >= .9) boats.splice(i, 1);
          continue;
        }
        if (!boat.crew.some(e => e.hp > 0 && e.boat === boat)) { collapse(boat); continue; }
        let remaining = SPEED * dt;
        while (remaining > 0 && boat.cursor < boat.path.length) {
          const target = boat.path[boat.cursor], dx = target.x - boat.position.x, dz = target.z - boat.position.z;
          const distance = Math.hypot(dx, dz), step = Math.min(distance, remaining);
          const x = boat.position.x + dx / (distance || 1) * step, z = boat.position.z + dz / (distance || 1) * step;
          if (!navigable(Math.floor(x / size), Math.floor(z / size)) ||
            !M.actorPhysics.clear(world, x, target.y + .18, z, hullBody)) break;
          boat.position.set(x, target.y, z); boat.yaw = Math.atan2(dx, dz); remaining -= step;
          if (distance <= step + .001) boat.cursor++; else break;
        }
        placeCrew(boat);
        if (boat.cursor >= boat.path.length) disembark(boat);
      }
    }
    function render() {
      if (!mesh && !boats.length) return;
      if (!mesh) {
        mesh = new THREE.InstancedMesh(M.enemyModels.geometry(), M.std(0xffffff, .92), MAX_BOATS * pieces.length);
        mesh.name = 'Enemy landing boats'; mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.setColorAt(0, new THREE.Color()); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); scene.add(mesh);
      }
      const motion = !(M.config.reducedMotion || reducedMotion);
      let index = 0;
      for (const boat of boats) {
        const t = boat.collapse === undefined ? 0 : Math.min(1, boat.collapse / .9);
        rotation.set(0, boat.yaw, motion ? Math.sin(boat.age * 2.2) * .025 : 0);
        quaternion.setFromEuler(rotation);
        point.copy(boat.position); point.y += motion ? Math.sin(boat.age * 2.8) * .055 : 0;
        root.compose(point, quaternion, scale.setScalar(1));
        pieces.forEach((p, j) => {
          if (p.kind === 'wake' && (!motion || t)) return;
          const stroke = motion && p.kind === 'oar' ? Math.sin(boat.age * 5) * .3 : 0;
          point.set(p.x * (1 + t * .6), p.y - t * t * 1.8 + (motion ? Math.sin(j * 2.4) * t * .4 : 0), p.z * (1 + t * .35));
          rotation.set(stroke, motion ? Math.sin(j * 1.7) * t : 0, motion ? Math.cos(j * 2.4) * t * .7 : 0);
          quaternion.setFromEuler(rotation); scale.set(p.sx, p.sy, p.sz).multiplyScalar(Math.max(.001, 1 - t * t));
          matrix.compose(point, quaternion, scale).premultiply(root);
          mesh.setMatrixAt(index, matrix); mesh.setColorAt(index++, p.color);
        });
      }
      mesh.count = index; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    }
    return { launch, update, render, boats, get routes() { if (!routes) routes = discover(); return routes; } };
  }
  M.enemyBoats = { create, crewSize: CREW };
})(window.Meadow = window.Meadow || {});
