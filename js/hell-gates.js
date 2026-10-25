(function (M) {
  'use strict';

  const gates = [], cells = [], clearance = [], cleared = new Set(), reserved = new Set();
  const time = { value: 0 }, reducedMotion = M.config.reducedMotion;
  function key(bx, by, bz) { return bx + ',' + by + ',' + bz; }
  function isReserved(bx, by, bz) { return reserved.has(key(bx, by, bz)); }

  function init(scene, world, tree) {
    if (gates.length) return;
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
      gates.push(gate);
      for (let u = -3; u <= 3; u++) for (let v = -1; v <= 1; v++) {
        for (let y = -1; y <= 6; y++) clearance.push({ bx: gate.bx + u * tx + v * tz, by: gate.by + y, bz: gate.bz + u * tz + v * tx });
      }
      function cell(u, y, v) {
        const block = { bx: gate.bx + u * tx + v * tz, by: gate.by + y, bz: gate.bz + u * tz + v * tx };
        cells.push(block); return block;
      }
      // A solid basalt plinth cannot be undermined. The open center is kept
      // clear for arrivals; defenses can still be built outside the portal.
      for (let u = -3; u <= 3; u++) for (let v = -1; v <= 1; v++) cell(u, -1, v);
      for (const side of [-1, 1]) {
        for (let y = 0; y <= 3; y++) cell(side * 2, y, 0);
        cell(side, 4, 0); cell(side * 2, 4, 0);
        cell(side * 2, 5, 0); cell(side * 3, 5, 0);
        cell(side * 3, 6, 0);
      }
      for (let u = -1; u <= 1; u++) for (let y = 0; y < 4; y++) {
        reserved.add(key(gate.bx + u * tx, gate.by + y, gate.bz + u * tz));
      }
    }
    clearance.forEach(cell => cleared.add(key(cell.bx, cell.by, cell.bz)));
    if (world.addPermanentBlocks) world.addPermanentBlocks(cells, 'hellstone', clearance);

    const geometry = new THREE.BoxGeometry(2, 2, 2), matrix = new THREE.Matrix4();
    const frame = new THREE.InstancedMesh(geometry, M.std(0xffffff, .88), cells.length);
    frame.frustumCulled = false;
    frame.name = 'Unbreakable hell gate frames'; frame.castShadow = frame.receiveShadow = true;
    cells.forEach((cell, i) => {
      matrix.makeTranslation(cell.bx * 2 + 1, cell.by * 2 + 1, cell.bz * 2 + 1);
      frame.setMatrixAt(i, matrix);
      frame.setColorAt(i, new THREE.Color(i % 4 === 0 ? 0x49343c : i % 3 === 0 ? 0x302c38 : 0x211f29));
    });
    scene.add(frame);
    const material = new THREE.ShaderMaterial({
      uniforms: { time: time }, side: THREE.DoubleSide, transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0); }',
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
    const portals = new THREE.InstancedMesh(new THREE.PlaneGeometry(6, 8), material, gates.length);
    portals.frustumCulled = false;
    portals.name = 'Living hell gate portals';
    gates.forEach((gate, i) => {
      matrix.makeRotationY(gate.tx ? 0 : Math.PI / 2); matrix.setPosition(gate.x, gate.y + 4, gate.z);
      portals.setMatrixAt(i, matrix);
    });
    scene.add(portals);
    // Thin molten seams break up the stone without extra lights or textures.
    const seams = new THREE.InstancedMesh(new THREE.BoxGeometry(.12, 1.3, 2.03),
      new THREE.MeshBasicMaterial({ color: 0xff681c, toneMapped: false }), gates.length * 10);
    seams.frustumCulled = false;
    seams.name = 'Hell gate molten runes';
    gates.forEach((gate, i) => {
      for (let j = 0; j < 10; j++) {
        const u = (j % 2 ? 1 : -1) * (j < 8 ? 4 : 2);
        matrix.makeRotationY(gate.tx ? 0 : Math.PI / 2);
        matrix.setPosition(gate.x + u * gate.tx, gate.y + 1 + Math.floor(j / 2) * 2, gate.z + u * gate.tz);
        seams.setMatrixAt(i * 10 + j, matrix);
      }
    });
    scene.add(seams);
  }
  M.hellGates = { init: init, gates: gates, cells: cells, isReserved: isReserved,
    isCleared: function (bx, by, bz) { return cleared.has(key(bx, by, bz)); },
    update: function (elapsed) { time.value = reducedMotion ? 0 : elapsed; } };
})(window.Meadow = window.Meadow || {});
