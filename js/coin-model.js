(function (M) {
  'use strict';

  let coinGeometry, coinMaterial;
  function create() {
    if (!coinGeometry) {
      const positions = [], normals = [], colors = [];
      function add(geometry, tint) {
        const raw = geometry.index ? geometry.toNonIndexed() : geometry;
        const p = raw.getAttribute('position'), n = raw.getAttribute('normal'), color = new THREE.Color(tint);
        for (let i = 0; i < p.count; i++) {
          positions.push(p.getX(i), p.getY(i), p.getZ(i));
          normals.push(n.getX(i), n.getY(i), n.getZ(i));
          colors.push(color.r, color.g, color.b);
        }
        if (raw !== geometry) raw.dispose();
        geometry.dispose();
      }
      const profile = [[0, -.10], [.72, -.10], [.80, -.10], [.86, -.035], [.86, .035], [.80, .10], [0, .10]];
      const blank = new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), 24);
      blank.rotateX(Math.PI / 2); add(blank, 0xdfa32d);
      const flame = new THREE.Shape();
      flame.moveTo(0, -.39); flame.lineTo(.28, -.12); flame.lineTo(.26, .10);
      flame.lineTo(.09, .39); flame.lineTo(.03, .14); flame.lineTo(-.15, .25);
      flame.lineTo(-.26, -.10); flame.closePath();
      for (const side of [-1, 1]) {
        const face = new THREE.CircleGeometry(.68, 24);
        if (side < 0) face.rotateY(Math.PI);
        face.translate(0, 0, side * .105); add(face, 0x9b5b12);
        const rim = new THREE.TorusGeometry(.73, .047, 4, 24);
        rim.translate(0, 0, side * .105); add(rim, 0xffd46d);
        const emblem = new THREE.ExtrudeGeometry(flame, { depth: .025, bevelEnabled: true,
          bevelSegments: 1, steps: 1, bevelSize: .025, bevelThickness: .018 });
        if (side < 0) emblem.rotateY(Math.PI);
        emblem.translate(0, 0, side * .13); add(emblem, 0xffe29a);
        for (let i = 0; i < 12; i++) {
          const angle = i * Math.PI / 6;
          const stamp = new THREE.BoxGeometry(.035, .09, .025);
          stamp.translate(0, .57, side * .125); stamp.rotateZ(angle); add(stamp, 0xf5bc43);
        }
      }
      coinGeometry = new THREE.BufferGeometry();
      coinGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      coinGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      coinGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      coinGeometry.computeBoundingSphere();
      // One shared mesh/material per pickup: no per-coin lights or extra draws.
      coinMaterial = M.std(0xffffff, .28, { vertexColors: true, metalness: .65,
        emissive: 0xffb63d, emissiveIntensity: .65 });
      coinMaterial.userData.time = { value: 0 };
      coinMaterial.onBeforeCompile = function (shader) {
        shader.uniforms.coinTime = coinMaterial.userData.time;
        shader.vertexShader = 'varying vec3 vCoinPosition;\n' + shader.vertexShader.replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvCoinPosition = position;');
        shader.fragmentShader = 'uniform float coinTime; varying vec3 vCoinPosition;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n' +
          'totalEmissiveRadiance *= vColor;\n' +
          'float glint = pow(max(0.0, 1.0 - abs(vCoinPosition.x * .8 + vCoinPosition.y * .5 - sin(coinTime * .65) * 1.4) * 7.0), 3.0);\n' +
          'totalEmissiveRadiance += vec3(1.0, .72, .3) * glint * .5 * step(.09, abs(vCoinPosition.z));');
      };
    }
    const mesh = new THREE.Mesh(coinGeometry, coinMaterial);
    mesh.name = 'Minted Hearth gold';
    return mesh;
  }
  M.coinModel = { create: create, update: function (time, reducedMotion) {
    if (coinMaterial) coinMaterial.userData.time.value = reducedMotion ? 0 : time;
  } };
})(window.Meadow = window.Meadow || {});
