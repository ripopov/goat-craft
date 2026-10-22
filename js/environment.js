(function (M) {
  'use strict';

  const { rand } = M.utils;
  let sceneRef = null;
  let hemi = null;
  let sun = null;
  let skyDome = null;
  let cloudLayer = null;
  const clouds = [];

  function init(scene, coarsePointer) {
    sceneRef = scene;
    scene.fog = new THREE.Fog(0xe2ecd6, coarsePointer ? 40 : 60, coarsePointer ? 112 : 145);

    hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6c8a4f, 0.55);
    scene.add(hemi);

    sun = new THREE.DirectionalLight(0xffefca, 1.8);
    sun.position.set(10, 18, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(coarsePointer ? 1024 : 2048, coarsePointer ? 1024 : 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 60;
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun);
    scene.add(sun.target);

    makeSky();
    makeClouds();
  }

  function makeSky() {
    const geo = new THREE.SphereGeometry(180, 32, 20);
    const pos = geo.attributes.position;
    const colors = [];
    const horizon = new THREE.Color(0xe2ecd6);
    const low = new THREE.Color(0xc3e2ef);
    const mid = new THREE.Color(0x8ac6e9);
    const top = new THREE.Color(0x6cb1df);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / 180;
      if (h <= 0.02) {
        c.copy(horizon);
      } else if (h < 0.12) {
        c.copy(horizon).lerp(low, (h - 0.02) / 0.1);
      } else if (h < 0.32) {
        c.copy(low).lerp(mid, (h - 0.12) / 0.2);
      } else {
        c.copy(mid).lerp(top, Math.min(1, (h - 0.32) / 0.45));
      }
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      toneMapped: false
    });
    skyDome = new THREE.Mesh(geo, mat);
    skyDome.renderOrder = -10;
    sceneRef.add(skyDome);
  }

  function makeClouds() {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, metalness: 0, flatShading: true,
      emissive: 0xa8b8bd, emissiveIntensity: 0.28
    });

    cloudLayer = new THREE.Group();
    sceneRef.add(cloudLayer);

    function addCloud(x, y, z, scale) {
      const g = new THREE.Group();
      const puffs = 4 + Math.floor(Math.random() * 3);
      for (let j = 0; j < puffs; j++) {
        const puff = new THREE.Mesh(geo, mat);
        puff.scale.set(rand(1.1, 2.0), rand(0.55, 1.05), rand(0.85, 1.35));
        puff.position.set((j - puffs / 2) * 1.15 + rand(-0.4, 0.4), rand(-0.2, 0.5), rand(-0.6, 0.6));
        g.add(puff);
      }
      g.position.set(x, y, z);
      g.scale.setScalar(scale);
      g.userData.baseY = y;
      g.userData.phase = Math.random() * Math.PI * 2;
      cloudLayer.add(g);
      clouds.push(g);
    }

    const specs = [
      [-30, 7.8, -42, 1.0],
      [-6, 9.8, -56, 0.9],
      [24, 8.4, -44, 0.95],
      [-52, 9.8, -8, 0.85],
      [34, 11.2, 26, 0.95],
      [-18, 9.0, 52, 0.85],
      [56, 10.2, -16, 0.85],
      [-64, 10.6, 34, 0.9],
      [6, 8.2, -62, 1.0],
      [44, 9.2, -54, 0.9]
    ];
    for (let i = 0; i < specs.length; i++) {
      const sp = specs[i];
      addCloud(sp[0], sp[1], sp[2], sp[3]);
    }
  }

  function update(camera, goat, dt, t) {
    for (let i = 0; i < clouds.length; i++) {
      const cloud = clouds[i];
      cloud.position.x += dt * (0.16 + (i % 3) * 0.05);
      if (cloud.position.x > 70) cloud.position.x = -70;
      cloud.position.y = cloud.userData.baseY + Math.sin(t * 0.25 + cloud.userData.phase) * 0.25;
    }

    sun.position.set(goat.position.x + 10, goat.position.y + 18, goat.position.z + 9);
    sun.target.position.set(goat.position.x, goat.position.y + 0.5, goat.position.z);
    sun.target.updateMatrixWorld();

    if (skyDome) skyDome.position.copy(camera.position);
    cloudLayer.position.set(goat.position.x, goat.position.y, goat.position.z);
  }

  M.environment = {
    init: init,
    update: update
  };
})(window.Meadow = window.Meadow || {});
