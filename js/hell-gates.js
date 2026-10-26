(function (M) {
  'use strict';

  const gates = [], sites = [], cells = [], plannedCells = [], roads = [], roadCells = [], roadColumns = new Map();
  let worldRef, treeRef, destroyed = 0, lastTime = 0;
  const clearance = [], cleared = new Set(), reserved = new Set();
  const time = { value: 0 }, reducedMotion = M.config.reducedMotion;
  function key(bx, by, bz) { return bx + ',' + by + ',' + bz; }
  function isReserved(bx, by, bz) { return reserved.has(key(bx, by, bz)); }

  function buildRoads(world, tree) {
    // The lightweight navigation fixtures have no terrain to pave.
    if (!world.addPermanentBlocks || !world.surfaceHeight) return;
    const columns = new Map(), gateBlocks = new Set(plannedCells.map(c => key(c.bx, c.by, c.bz)));
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    function column(bx, bz) {
      const id = bx + ',' + bz;
      if (!columns.has(id)) {
        const x = bx * 2 + 1, z = bz * 2 + 1;
        const water = world.waterLevelAt(x, z);
        columns.set(id, { bx, bz, top: Math.max(1, Math.ceil(Math.max(world.surfaceHeight(x, z), water ? water + .15 : 0) / 2)) });
      }
      return columns.get(id);
    }
    sites.forEach(gate => {
      const dx = tree.position.x - gate.x, dz = tree.position.z - gate.z, length = Math.hypot(dx, dz);
      const first = gate.stage === 2 ? sites[gate.id - 5] : null;
      const endX = first ? first.x : tree.position.x - dx / length * 8;
      const endZ = first ? first.z : tree.position.z - dz / length * 8;
      const path = [], seen = new Set();
      let bx = gate.bx, bz = gate.bz;
      function append() {
        const id = bx + ',' + bz;
        if (seen.has(id)) return;
        seen.add(id); path.push(column(bx, bz));
        // A six-unit lane gives even the largest enemy room at the bends.
        for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) column(bx + x, bz + z);
      }
      append();
      for (let i = 1; i <= Math.ceil(length * 2); i++) {
        const t = i / Math.ceil(length * 2);
        const bend = Math.sin(t * Math.PI * 2) * Math.sin(t * Math.PI) * 12;
        const x = gate.x + (endX - gate.x) * t - dz / length * bend;
        const z = gate.z + (endZ - gate.z) * t + dx / length * bend;
        const tx = Math.floor(x / 2), tz = Math.floor(z / 2);
        while (bx !== tx || bz !== tz) {
          if (bx !== tx && (bz === tz || Math.abs(tx - bx) >= Math.abs(tz - bz))) bx += Math.sign(tx - bx);
          else bz += Math.sign(tz - bz);
          append();
        }
      }
      if (first) path.push(...roads.find(road => road.gateId === first.id).path.slice(1));
      roads.push({ gateId: gate.id, path });
    });
    // Grade adjacent paving by at most one voxel. Cut high ground rather than
    // leaving a cliff; the endpoint anchors keep portal thresholds unchanged.
    const queue = Array.from(columns.values());
    for (let i = 0; i < queue.length; i++) {
      const a = queue[i];
      directions.forEach(d => {
        const b = columns.get((a.bx + d[0]) + ',' + (a.bz + d[1]));
        if (b && b.top > a.top + 1) { b.top = a.top + 1; queue.push(b); }
      });
    }
    const anchors = [];
    sites.forEach(gate => {
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
        const c = columns.get((gate.bx + x) + ',' + (gate.bz + z));
        if (c) { c.top = gate.by; anchors.push(c); }
      }
    });
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      directions.forEach(d => {
        const b = columns.get((a.bx + d[0]) + ',' + (a.bz + d[1]));
        if (b && b.top < a.top - 1) { b.top = a.top - 1; anchors.push(b); }
      });
    }
    columns.forEach(c => {
      const cell = { bx: c.bx, by: c.top - 1, bz: c.bz, kind: 'roadstone' };
      // The Hearth's roots and the portal plinth retain ownership of their cells.
      if (gateBlocks.has(key(cell.bx, cell.by, cell.bz)) || tree.intersectsBlock(cell.bx, cell.by, cell.bz)) return;
      roadColumns.set(c.bx + ',' + c.bz, c.top * 2);
      roadCells.push(cell);
      const roof = Math.max(c.top + 3, Math.ceil(world.surfaceHeight(c.bx * 2 + 1, c.bz * 2 + 1) / 2) + 3);
      for (let by = c.top - 1; by <= roof; by++) clearance.push({ bx: c.bx, by, bz: c.bz, excavate: by >= c.top });
    });
  }

  function init(scene, world, tree) {
    if (sites.length) return;
    worldRef = world; treeRef = tree;
    // Search dry forest ground well beyond the clearing. Keep a mix of near
    // and far entrances, all at least 64 world units from the Hearth.
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2, radius = [70, 90, 76, 86][i];
      const tx = Math.abs(Math.round(Math.cos(angle))) ? 1 : 0, tz = tx ? 0 : 1;
      const targetX = tree.position.x + Math.sin(angle) * radius;
      const targetZ = tree.position.z + Math.cos(angle) * radius;
      const pool = [];
      for (let dz = -9; dz <= 9; dz++) for (let dx = -9; dx <= 9; dx++) {
        const bx = Math.floor(targetX / 2) + dx, bz = Math.floor(targetZ / 2) + dz;
        const x = bx * 2 + 1, z = bz * 2 + 1, distance = Math.hypot(x - tree.position.x, z - tree.position.z);
        if (distance < 64 || distance > 96) continue;
        pool.push({ bx: bx, bz: bz, x: x, z: z, score: Math.hypot(x - targetX, z - targetZ) });
      }
      pool.sort((a, b) => a.score - b.score);
      const node = pool.find(node => {
        const y = world.surfaceHeight ? world.surfaceHeight(node.x, node.z) : world.navigationSurfaces(node.bx, node.bz)[0];
        if (!Number.isFinite(y) || y < 2 && world.surfaceHeight) return false;
        node.y = y;
        const by = Math.round(y / 2);
        for (let u = -3; u <= 3; u++) for (let v = -1; v <= 1; v++) {
          const x = node.bx + u * tx + v * tz, z = node.bz + u * tz + v * tx;
          if (world.waterDepthAt(x * 2 + 1, z * 2 + 1) > .1) return false;
          if (!world.blockInfoAt(x, by - 2, z)) return false;
          const first = Math.abs(u) <= 1 && v === 0 ? by : by + 1;
          for (let y = first; y <= by + 6; y++) {
            const info = world.blockInfoAt(x, y, z);
            if (info && info.type !== 'prop') return false;
          }
        }
        return true;
      });
      if (!node) throw new Error('No clear forest site for hell gate ' + (i + 1));
      const gate = { id: i + 1, x: node.x, y: node.y, z: node.z, tx: tx, tz: tz,
        bx: Math.floor(node.x / 2), by: Math.round(node.y / 2), bz: Math.floor(node.z / 2) };
      gates.push(gate); sites.push(gate);
    }
    // Plan the second line now, so its graded approach already connects to the
    // Hearth. One voxel is two world units: each successor retreats 50 blocks.
    gates.forEach(first => {
      const dx = first.x - tree.position.x, dz = first.z - tree.position.z, length = Math.hypot(dx, dz);
      const bx = first.bx + Math.round(dx / length * 50), bz = first.bz + Math.round(dz / length * 50);
      const x = bx * 2 + 1, z = bz * 2 + 1;
      const water = world.waterLevelAt ? world.waterLevelAt(x, z) : 0;
      const y = Math.ceil(Math.max(world.surfaceHeight ? world.surfaceHeight(x, z) : first.y, water ? water + .2 : 0) / 2) * 2;
      const next = { id: first.id + 4, x, y, z, bx, by: y / 2, bz, tx: first.tx, tz: first.tz, stage: 2 };
      first.successor = next; sites.push(next);
    });
    const bossHp = M.enemyRules.healthForWave('boss', M.enemyRules.types.boss.unlock);
    sites.forEach(gate => {
      gate.stage = gate.stage || 1; gate.isGate = true; gate.active = gate.stage === 1;
      gate.position = new THREE.Vector3(gate.x, gate.y, gate.z);
      gate.body = { radius: 7, height: 14 }; gate.hp = gate.maxHp = bossHp * (gate.stage === 1 ? 100 : 200);
      gate.blocks = []; gate.foundation = []; gate.flash = 0;
      for (let u = -3; u <= 3; u++) for (let v = -1; v <= 1; v++) {
        for (let y = -1; y <= 7; y++) clearance.push({ bx: gate.bx + u * gate.tx + v * gate.tz,
          by: gate.by + y, bz: gate.bz + u * gate.tz + v * gate.tx, excavate: y >= 0 });
      }
      function cell(u, y, v) {
        const block = { bx: gate.bx + u * gate.tx + v * gate.tz, by: gate.by + y, bz: gate.bz + u * gate.tz + v * gate.tx };
        plannedCells.push(block); (y < 0 ? gate.foundation : gate.blocks).push(block);
        if (y >= 0) reserved.add(key(block.bx, block.by, block.bz));
      }
      for (let u = -3; u <= 3; u++) for (let v = -1; v <= 1; v++) cell(u, -1, v);
      for (const side of [-1, 1]) {
        for (let y = 0; y <= 3; y++) cell(side * 2, y, 0);
        cell(side, 4, 0); cell(side * 2, 4, 0);
        cell(side * 2, 5, 0); cell(side * 3, 5, 0); cell(side * 3, 6, 0);
      }
      for (let u = -1; u <= 1; u++) for (let y = 0; y < 4; y++)
        reserved.add(key(gate.bx + u * gate.tx, gate.by + y, gate.bz + u * gate.tz));
    });
    buildRoads(world, tree);
    cells.push(...sites.flatMap(g => g.foundation.concat(g.active ? g.blocks : [])));
    clearance.forEach(cell => cleared.add(key(cell.bx, cell.by, cell.bz)));
    if (world.addPermanentBlocks) world.addPermanentBlocks(sites.flatMap(g => g.foundation.concat(g.active ? g.blocks : [])).concat(roadCells), 'hellstone', clearance);

    // One static batch, with warm worn paving distinct from the dark gates.
    const pavingCells = roadCells.concat(sites.flatMap(g => g.foundation));
    if (pavingCells.length) {
      const paving = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), M.std(0xffffff, .96), pavingCells.length);
      const transform = new THREE.Matrix4();
      paving.name = 'Unbreakable winding gate roads'; paving.frustumCulled = false;
      paving.castShadow = paving.receiveShadow = true;
      pavingCells.forEach((c, i) => {
        transform.makeTranslation(c.bx * 2 + 1, c.by * 2 + 1, c.bz * 2 + 1); paving.setMatrixAt(i, transform);
        const shade = Math.abs(c.bx * 17 + c.bz * 31) % 5;
        paving.setColorAt(i, new THREE.Color([0x8d8175, 0x9e9281, 0x746d68, 0xa29583, 0x847b71][shade]));
      });
      scene.add(paving);
    }

    const portalMaterial = new THREE.ShaderMaterial({
      uniforms: { time: time }, side: THREE.DoubleSide, transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float time;
        void main(){
          vec2 p=vUv*2.0-1.0;
          float edge=1.0-abs(p.x)-.34*pow(max(0.0,p.y),3.0);
          if(edge<0.0) discard;
          float flow=sin(p.y*16.0-time*2.6+sin(p.x*11.0+time)*2.5);
          float veins=pow(.5+.5*sin(p.x*23.0+sin(p.y*9.0-time*1.7)*3.0),9.0);
          float rim=pow(1.0-clamp(edge*3.0,0.0,1.0),3.0);
          vec3 fire=mix(vec3(.32,.008,.018),vec3(1.0,.15,.015),.32+.25*flow+.35*veins);
          fire+=vec3(1.0,.5,.06)*(rim*.9+veins*.35);
          gl_FragColor=vec4(fire,.92);
        }`
    });
    const geometry = new THREE.BoxGeometry(2, 2, 2), matrix = new THREE.Matrix4();
    const seamMaterial = new THREE.MeshBasicMaterial({ color: 0xff681c, toneMapped: false });
    const barGeometry = new THREE.PlaneGeometry(1, 1);
    sites.forEach(gate => {
      const group = new THREE.Group(); group.position.copy(gate.position); group.visible = gate.active;
      group.name = 'Hell gate ' + gate.id; gate.group = group; scene.add(group);
      gate.frameMaterial = M.std(0xffffff, .88, { emissive: 0xff6f32, emissiveIntensity: 0 });
      const frame = new THREE.InstancedMesh(geometry, gate.frameMaterial, gate.blocks.length);
      frame.frustumCulled = false;
      frame.name = 'Destructible hell gate frame'; frame.castShadow = frame.receiveShadow = true;
      gate.blocks.forEach((cell, i) => {
        matrix.makeTranslation(cell.bx * 2 + 1 - gate.x, cell.by * 2 + 1 - gate.y, cell.bz * 2 + 1 - gate.z);
        frame.setMatrixAt(i, matrix);
        frame.setColorAt(i, new THREE.Color(i % 4 === 0 ? 0x49343c : i % 3 === 0 ? 0x302c38 : 0x211f29));
      });
      group.add(frame);
      const portal = new THREE.Mesh(new THREE.PlaneGeometry(6, 8), portalMaterial);
      portal.name = 'Living hell gate portal'; portal.position.y = 4; portal.rotation.y = gate.tx ? 0 : Math.PI / 2;
      group.add(portal); gate.portal = portal;
      const seams = new THREE.InstancedMesh(new THREE.BoxGeometry(.12, 1.3, 2.03), seamMaterial, 10);
      seams.frustumCulled = false;
      for (let j = 0; j < 10; j++) {
        const u = (j % 2 ? 1 : -1) * (j < 8 ? 4 : 2);
        matrix.makeRotationY(gate.tx ? 0 : Math.PI / 2);
        matrix.setPosition(u * gate.tx, 1 + Math.floor(j / 2) * 2, u * gate.tz); seams.setMatrixAt(j, matrix);
      }
      group.add(seams);
      const health = new THREE.Group(); health.position.set(gate.x, gate.y + 15.5, gate.z); health.visible = gate.active;
      health.name = 'Gate health ' + gate.id; gate.healthBar = health;
      const back = new THREE.Mesh(barGeometry, new THREE.MeshBasicMaterial({ color: 0x1d1725, side: THREE.DoubleSide }));
      back.scale.set(8.4, .65, 1); health.add(back);
      const fill = new THREE.Mesh(barGeometry, new THREE.MeshBasicMaterial({ color: gate.stage === 1 ? 0xff643e : 0xd38cff, side: THREE.DoubleSide }));
      fill.position.z = .02; health.add(fill); gate.healthFill = fill; scene.add(health);
      const shock = new THREE.Mesh(new THREE.RingGeometry(.9, 1, 40), new THREE.MeshBasicMaterial({
        color: 0xffc277, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      shock.position.set(gate.x, gate.y + .12, gate.z); shock.rotation.x = -Math.PI / 2;
      shock.visible = false; scene.add(shock); gate.shock = shock;
    });
  }

  function damage(gate, amount, point) {
    if (!gate || !gate.active || !Number.isFinite(amount) || amount <= 0 || treeRef.health <= 0 || destroyed === 8) return false;
    gate.hp = Math.max(0, gate.hp - amount);
    if (point) {
      gate.flash = .3;
      if (M.audio && M.audio.towerImpact) M.audio.towerImpact(point, 'earth');
    }
    if (gate.hp > 0) return false;
    gate.active = false; gate.destroyedAt = lastTime; destroyed++;
    gate.healthBar.visible = false; gate.shock.visible = true;
    worldRef.removePermanentBlocks?.(gate.blocks);
    gate.blocks.forEach(block => { cells.splice(cells.indexOf(block), 1); reserved.delete(key(block.bx, block.by, block.bz)); });
    for (let u = -1; u <= 1; u++) for (let y = 0; y < 4; y++)
      reserved.delete(key(gate.bx + u * gate.tx, gate.by + y, gate.bz + u * gate.tz));
    gates.splice(gates.indexOf(gate), 1);
    if (gate.successor) {
      const next = gate.successor; next.active = true; next.bornAt = lastTime; gates.push(next);
      next.group.visible = next.healthBar.visible = true;
      worldRef.addPermanentBlocks?.(next.blocks, 'hellstone');
      cells.push(...next.blocks);
      if (M.ui) M.ui.showBubble('Gate shattered! Its final form has retreated 50 blocks. ' + destroyed + ' / 8 destroyed.');
    } else if (M.ui) M.ui.showBubble('Gate sealed forever! ' + destroyed + ' / 8 destroyed.');
    if (M.audio && M.audio.cue) M.audio.cue('clear');
    return true;
  }

  function update(elapsed) {
    const dt = Math.max(0, elapsed - lastTime); lastTime = elapsed;
    time.value = reducedMotion ? 0 : elapsed;
    sites.forEach(gate => {
      gate.flash = Math.max(0, gate.flash - dt);
      gate.frameMaterial.emissiveIntensity = gate.flash * 4;
      if (gate.active) {
        const health = gate.hp / gate.maxHp;
        gate.healthFill.scale.set(8 * health, .35, 1); gate.healthFill.position.x = -4 * (1 - health);
        const camera = M.goat && M.goat.aimCamera;
        if (camera) gate.healthBar.quaternion.copy(camera.quaternion);
        const birth = gate.bornAt === undefined ? 1 : Math.min(1, (elapsed - gate.bornAt) / 1.4);
        gate.group.scale.setScalar(reducedMotion ? 1 : Math.max(.001, birth));
        gate.group.position.y = gate.y;
        if (!reducedMotion && gate.flash > 0) gate.portal.scale.setScalar(1 + Math.sin(gate.flash * 60) * gate.flash * .12);
        else gate.portal.scale.setScalar(1);
      } else if (gate.destroyedAt !== undefined) {
        const k = Math.min(1, (elapsed - gate.destroyedAt) / 2.2);
        gate.group.visible = k < 1; gate.group.scale.setScalar(Math.max(.001, 1 - k * k));
        gate.group.position.y = gate.y - (reducedMotion ? 0 : k * 8);
        gate.group.rotation.y = reducedMotion ? 0 : k * .35;
        gate.shock.visible = k < 1; gate.shock.scale.setScalar(2 + k * 24);
        gate.shock.material.opacity = (1 - k) * .65;
      }
    });
  }
  M.hellGates = { init, damage, update, gates, sites, cells, roads, roadCells, isReserved,
    get destroyed() { return destroyed; }, get won() { return destroyed === 8; },
    isRoad: function (bx, bz, y) { return roadColumns.get(bx + ',' + bz) === y; },
    roadHeightAt: function (bx, bz) { return roadColumns.get(bx + ',' + bz) || 0; },
    isCleared: function (bx, by, bz) { return cleared.has(key(bx, by, bz)); } };
})(window.Meadow = window.Meadow || {});
