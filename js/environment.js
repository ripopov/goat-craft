(function (M) {
  'use strict';

  const { clamp, rand } = M.utils;
  const DEG = Math.PI / 180;

  // A full solar day lasts one minute. The meadow is the local tangent plane
  // of a planet at 50°N; the ground stays put while the celestial sphere turns.
  // Sun position comes from the local hour angle, observer latitude and solar
  // declination, so the arc is tilted like a real sky instead of being an
  // arbitrary circle around the goat.
  const DAY_SECONDS = 60;
  const START_PHASE = 0.30;
  const LATITUDE = 50 * DEG;
  const AXIAL_TILT = 23.44 * DEG;
  const SEASON_ANGLE = 0; // vernal equinox
  // Declination from the planet's axial tilt. At the equinox this is zero,
  // giving 12 hours of day and 12 hours of night at every latitude.
  const SOLAR_DECLINATION = Math.asin(Math.sin(AXIAL_TILT) * Math.sin(SEASON_ANGLE));
  const SKY_RADIUS = 180;
  const BODY_RADIUS = 158;
  const LIGHT_DISTANCE = 46;
  const SHADOW_EXTENT = 14;

  // Sky palettes sampled across the solar day. The stops are intentionally
  // warmer on the sunrise side and deeper on the sunset side.
  const SKY_STOPS = [
    { t: 0.00, top: 0x030814, mid: 0x071225, low: 0x0d1a2f, horizon: 0x16263c, fog: 0x0b1422, cloud: 0x7f8fae },
    { t: 0.18, top: 0x081226, mid: 0x101e39, low: 0x1b2a44, horizon: 0x33415a, fog: 0x1a2438, cloud: 0x6d7894 },
    { t: 0.22, top: 0x1a2b4d, mid: 0x3b3f5d, low: 0x7d5a68, horizon: 0xc47a6d, fog: 0x5a4a55, cloud: 0x9a7f88 },
    { t: 0.25, top: 0x2d4d78, mid: 0x6e6f93, low: 0xd08e83, horizon: 0xffb36e, fog: 0xba8f7b, cloud: 0xe2b4a4 },
    { t: 0.30, top: 0x3f7fb2, mid: 0x75afd6, low: 0xc8dde3, horizon: 0xf3e6ce, fog: 0xe0e6d7, cloud: 0xfff0df },
    { t: 0.40, top: 0x4f9dd2, mid: 0x7cc0e8, low: 0xbce0ec, horizon: 0xdde9d3, fog: 0xe2ecd6, cloud: 0xffffff },
    { t: 0.60, top: 0x53a1d4, mid: 0x82c2e8, low: 0xc2e1ec, horizon: 0xe1ead7, fog: 0xe6ecd8, cloud: 0xfffdf7 },
    { t: 0.70, top: 0x5b97c8, mid: 0x8fb6d5, low: 0xdfd8c7, horizon: 0xf4d5a0, fog: 0xe0d2b7, cloud: 0xfff0d9 },
    { t: 0.75, top: 0x36537f, mid: 0x807090, low: 0xe89a83, horizon: 0xff8f55, fog: 0xb17c6c, cloud: 0xeaa38f },
    { t: 0.79, top: 0x1b2d4d, mid: 0x373a58, low: 0x704d5c, horizon: 0xc06b5b, fog: 0x5b4a50, cloud: 0xa57b7e },
    { t: 0.86, top: 0x081226, mid: 0x111f38, low: 0x1d2a42, horizon: 0x34415a, fog: 0x151f30, cloud: 0x707d9a },
    { t: 1.00, top: 0x030814, mid: 0x071225, low: 0x0d1a2f, horizon: 0x16263c, fog: 0x0b1422, cloud: 0x7f8fae }
  ];

  const stops = SKY_STOPS.map(function (stop) {
    return {
      t: stop.t,
      top: new THREE.Color(stop.top),
      mid: new THREE.Color(stop.mid),
      low: new THREE.Color(stop.low),
      horizon: new THREE.Color(stop.horizon),
      fog: new THREE.Color(stop.fog),
      cloud: new THREE.Color(stop.cloud)
    };
  });

  const skyTop = new THREE.Color();
  const skyMid = new THREE.Color();
  const skyLow = new THREE.Color();
  const skyHorizon = new THREE.Color();
  const skyFog = new THREE.Color();
  const skyCloud = new THREE.Color();
  const belowHorizon = new THREE.Color();
  const hemiDay = new THREE.Color(0xcfe6ff);
  const groundDay = new THREE.Color(0x6c8a4f);
  const groundNight = new THREE.Color(0x10160f);
  const sunGlowWarm = new THREE.Color(0xff9b58);
  const sunGlowDay = new THREE.Color(0xfff0c4);
  const sunGlowColor = new THREE.Color();
  const moonGlowColor = new THREE.Color(0x8fb4ff);
  const sunDiscWarm = new THREE.Color(0xffa45c);
  const sunDiscDay = new THREE.Color(0xfffdf0);
  const sunColorWarm = new THREE.Color(0xff9d5c);
  const sunColorDay = new THREE.Color(0xfff4dc);
  const moonColor = new THREE.Color(0xb8ccff);
  const celestialPole = new THREE.Vector3(0, Math.sin(LATITUDE), -Math.cos(LATITUDE)).normalize();
  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  const scratchColor = new THREE.Color();

  let sceneRef = null;
  let rendererRef = null;
  let hemi = null;
  let nightFill = null;
  let sun = null;
  let moon = null;
  let skyDome = null;
  let skyDirs = null;
  let skyColorAttr = null;
  let sunSprite = null;
  let moonSprite = null;
  let celestial = null;
  let starGroup = null;
  let stars = null;
  let brightStars = null;
  let cloudLayer = null;
  const cloudMats = [];
  const clouds = [];
  let coarse = false;
  let phase = START_PHASE;
  let sunAltitude = 0;
  let moonAltitude = 0;
  let daylight = 0;
  let nightFactor = 0;
  let lastCamera = null;
  let lastGoat = null;
  let lastTime = 0;

  function smoothstep(edge0, edge1, value) {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function wrapPhase(value) {
    return ((value % 1) + 1) % 1;
  }

  function sampleSky(value) {
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (value >= stops[i].t && value <= stops[i + 1].t) {
        a = stops[i];
        b = stops[i + 1];
        break;
      }
    }
    const span = b.t - a.t || 1;
    const raw = clamp((value - a.t) / span, 0, 1);
    const u = raw * raw * (3 - 2 * raw);
    skyTop.copy(a.top).lerp(b.top, u);
    skyMid.copy(a.mid).lerp(b.mid, u);
    skyLow.copy(a.low).lerp(b.low, u);
    skyHorizon.copy(a.horizon).lerp(b.horizon, u);
    skyFog.copy(a.fog).lerp(b.fog, u);
    skyCloud.copy(a.cloud).lerp(b.cloud, u);
  }

  function solarDirection(value, out) {
    const hourAngle = (value - 0.5) * Math.PI * 2;
    const sinDec = Math.sin(SOLAR_DECLINATION);
    const cosDec = Math.cos(SOLAR_DECLINATION);
    const sinLat = Math.sin(LATITUDE);
    const cosLat = Math.cos(LATITUDE);
    const east = -cosDec * Math.sin(hourAngle);
    const north = sinDec * cosLat - cosDec * sinLat * Math.cos(hourAngle);
    const up = sinLat * sinDec + cosLat * cosDec * Math.cos(hourAngle);
    out.set(east, up, -north);
    return out.normalize();
  }

  function makeSky() {
    const geo = new THREE.SphereGeometry(SKY_RADIUS, coarse ? 32 : 48, coarse ? 20 : 28);
    const pos = geo.attributes.position;
    skyDirs = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      skyDirs[i * 3] = pos.getX(i) / SKY_RADIUS;
      skyDirs[i * 3 + 1] = pos.getY(i) / SKY_RADIUS;
      skyDirs[i * 3 + 2] = pos.getZ(i) / SKY_RADIUS;
    }

    const colors = new Float32Array(pos.count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    skyColorAttr = geo.attributes.color;

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

  function makeStarCloud(count, size, radiusBase) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < count; i++) {
      // Uniform over solid angle across the whole celestial sphere, not just
      // a northern cap. The star field only rotates around the celestial
      // pole, so stars generated with y >= 0 stayed pinned to the northern
      // sky forever and left the entire southern hemisphere starless. y is
      // uniform over [-1, 1] (uniform cos of the polar angle), which spreads
      // the points evenly per square degree.
      const y = -1 + 2 * Math.random();
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      const radius = radiusBase + Math.random() * 9;
      positions[i * 3] = Math.cos(angle) * r * radius;
      positions[i * 3 + 1] = y * radius;
      positions[i * 3 + 2] = Math.sin(angle) * r * radius;

      const tint = Math.random();
      if (tint < 0.16) c.setHex(0xffe2b8);
      else if (tint < 0.46) c.setHex(0xcfe0ff);
      else c.setHex(0xffffff);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: size,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geo, mat);
    points.renderOrder = -9;
    return points;
  }

  function makeSunTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;

    // The disc: a hot white punctum, a golden face and a long warm corona
    // that bleeds into the sky with no hard edge.
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.07, 'rgba(255, 255, 248, 1)');
    g.addColorStop(0.13, 'rgba(255, 248, 214, 1)');
    g.addColorStop(0.19, 'rgba(255, 232, 168, 0.9)');
    g.addColorStop(0.27, 'rgba(255, 216, 132, 0.45)');
    g.addColorStop(0.42, 'rgba(255, 192, 104, 0.16)');
    g.addColorStop(0.62, 'rgba(255, 168, 78, 0.05)');
    g.addColorStop(0.86, 'rgba(255, 152, 58, 0.015)');
    g.addColorStop(1, 'rgba(255, 146, 52, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function makeMoonTexture() {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;
    const disc = size * 0.21;

    // Cool silver-blue halo, soft and wide so the big disc floats instead of
    // pasting onto the night sky.
    const glow = ctx.createRadialGradient(c, c, disc * 0.62, c, c, c);
    glow.addColorStop(0, 'rgba(196, 218, 255, 0.34)');
    glow.addColorStop(0.3, 'rgba(168, 198, 255, 0.13)');
    glow.addColorStop(0.62, 'rgba(150, 185, 255, 0.035)');
    glow.addColorStop(0.85, 'rgba(140, 176, 255, 0.012)');
    glow.addColorStop(1, 'rgba(136, 172, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, disc, 0, Math.PI * 2);
    ctx.clip();

    // Moonlit surface washed by the sun from the upper-left.
    const surface = ctx.createRadialGradient(c - disc * 0.38, c - disc * 0.42, disc * 0.08, c, c, disc);
    surface.addColorStop(0, '#ffffff');
    surface.addColorStop(0.4, '#edf1fb');
    surface.addColorStop(0.72, '#ccd6ea');
    surface.addColorStop(1, '#aebdd8');
    ctx.fillStyle = surface;
    ctx.fillRect(c - disc, c - disc, disc * 2, disc * 2);

    // Maria: blurred dark volcanic plains swung toward the lower-right.
    const maria = [
      [0.1, 0.12, 0.30, 0.22],
      [-0.26, 0.22, 0.24, 0.18],
      [0.34, -0.18, 0.18, 0.14],
      [-0.08, -0.34, 0.15, 0.12],
      [0.02, 0.42, 0.13, 0.1]
    ];
    for (let i = 0; i < maria.length; i++) {
      const m = maria[i];
      const g = ctx.createRadialGradient(c + m[0] * disc, c + m[1] * disc, 0, c + m[0] * disc, c + m[1] * disc, m[2] * disc);
      g.addColorStop(0, 'rgba(118, 136, 168, ' + m[3] + ')');
      g.addColorStop(1, 'rgba(118, 136, 168, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(c - disc, c - disc, disc * 2, disc * 2);
    }

    // Craters with a lit rim on the sun side and a shaded bowl inside.
    const craters = [
      [-0.32, -0.08, 0.15, 0.16],
      [0.2, -0.32, 0.12, 0.13],
      [0.31, 0.18, 0.1, 0.12],
      [-0.1, 0.35, 0.14, 0.13],
      [-0.48, 0.28, 0.07, 0.08],
      [0.02, 0.02, 0.08, 0.08],
      [0.42, -0.02, 0.06, 0.07],
      [-0.18, -0.42, 0.05, 0.06]
    ];
    for (let i = 0; i < craters.length; i++) {
      const cr = craters[i];
      const x = c + cr[0] * disc, y = c + cr[1] * disc, r = cr[2] * disc;
      ctx.fillStyle = 'rgba(96, 116, 150, ' + (cr[3] * 1.05) + ')';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // Gentle crescent highlight hugging the upper-left rim.
      ctx.strokeStyle = 'rgba(255, 255, 255, ' + (cr[3] * 1.1) + ')';
      ctx.lineWidth = r * 0.34;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.82, Math.PI * 0.95, Math.PI * 1.75);
      ctx.stroke();
    }

    // Fine speckle for a rocky, non-plastic surface.
    for (let i = 0; i < 340; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * disc * 0.92;
      ctx.fillStyle = 'rgba(80, 100, 134, ' + (0.02 + Math.random() * 0.05) + ')';
      ctx.fillRect(c + Math.cos(a) * rr, c + Math.sin(a) * rr, 1 + Math.random() * 1.6, 1 + Math.random() * 1.6);
    }
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function makeCelestialBodies() {
    celestial = new THREE.Group();
    sceneRef.add(celestial);

    const sunMat = new THREE.SpriteMaterial({
      map: makeSunTexture(),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending
    });
    sunSprite = new THREE.Sprite(sunMat);
    sunSprite.scale.set(33, 33, 1);
    sunSprite.renderOrder = -8;
    celestial.add(sunSprite);

    const moonMat = new THREE.SpriteMaterial({
      map: makeMoonTexture(),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
      blending: THREE.NormalBlending
    });
    moonSprite = new THREE.Sprite(moonMat);
    moonSprite.scale.set(25.5, 25.5, 1);
    moonSprite.renderOrder = -8;
    celestial.add(moonSprite);

    starGroup = new THREE.Group();
    starGroup.renderOrder = -9;
    celestial.add(starGroup);
    // Extra points: roughly half the field now sits below the horizon at any
    // moment, so the same visible density needs more total stars.
    stars = makeStarCloud(coarse ? 950 : 1900, 1.7, 166);
    brightStars = makeStarCloud(coarse ? 140 : 280, 2.7, 170);
    starGroup.add(stars);
    starGroup.add(brightStars);
  }

  // A soft, organic cloud-sided blob used as a sprite texture: a wide
  // base, a doming center, surrounding bumps and faint wisps. Every blob is
  // a stack of smooth radial gradients that fade to zero alpha, so the
  // silhouette is round and cloudy at every angle instead of faceted or
  // rim-sharp. Each call rolls a unique shape.
  function makeCloudPuffTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;

    function blob(x, y, r, a) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255, 255, 255, ' + a + ')');
      g.addColorStop(0.45, 'rgba(255, 255, 255, ' + (a * 0.85).toFixed(3) + ')');
      g.addColorStop(0.72, 'rgba(255, 255, 255, ' + (a * 0.45).toFixed(3) + ')');
      g.addColorStop(0.9, 'rgba(255, 255, 255, ' + (a * 0.14).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // Broad soft base, then a doming heart, then irregular bumps and wisps.
    blob(c, c + size * 0.07, size * 0.44, 0.8);
    blob(c, c - size * 0.04, size * 0.33, 0.85);
    const bumps = 7 + Math.floor(Math.random() * 5);
    for (let i = 0; i < bumps; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = size * (0.15 + Math.random() * 0.18);
      blob(c + Math.cos(a) * d, c + Math.sin(a) * d - size * 0.03, size * (0.11 + Math.random() * 0.13), 0.45 + Math.random() * 0.3);
    }
    const wisps = 5 + Math.floor(Math.random() * 5);
    for (let i = 0; i < wisps; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = size * (0.26 + Math.random() * 0.16);
      blob(c + Math.cos(a) * d, c + Math.sin(a) * d - size * 0.02, size * (0.06 + Math.random() * 0.07), 0.18 + Math.random() * 0.16);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function makeClouds() {
    cloudLayer = new THREE.Group();
    sceneRef.add(cloudLayer);

    // A cloud is a cluster of camera-facing sprites that share one unique
    // per-cloud soft texture: a doming center puff, a rough ring of bumps, a
    // wide lower base and a few ragged wisps. Each cloud also picks its own
    // puff counts, spread, aspect and yaw, so the sky never repeats itself.
    function addCloud(x, y, z, scale) {
      const m = new THREE.SpriteMaterial({
        map: makeCloudPuffTexture(),
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        fog: true
      });
      cloudMats.push(m);

      const g = new THREE.Group();
      const center = new THREE.Sprite(m);
      center.scale.set(rand(2.9, 3.6), rand(2.4, 2.9), 1);
      center.position.set(0, 0.35, 0);
      g.add(center);

      const bumps = 5 + Math.floor(Math.random() * 4);
      for (let j = 0; j < bumps; j++) {
        const puff = new THREE.Sprite(m);
        const a = (j / bumps) * Math.PI * 2 + Math.random() * 0.8;
        const d = rand(0.62, 1.15);
        const s = rand(1.5, 2.4);
        puff.scale.set(s * rand(0.9, 1.35), s * rand(0.8, 1.05), 1);
        puff.position.set(Math.cos(a) * d, rand(0.25, 0.7), Math.sin(a) * d * 0.7);
        g.add(puff);
      }

      const base = new THREE.Sprite(m);
      base.scale.set(rand(4.4, 5.2), rand(1.2, 1.6), 1);
      base.position.set(0, rand(-0.1, 0.15), 0);
      g.add(base);

      const wisps = 2 + Math.floor(Math.random() * 3);
      for (let j = 0; j < wisps; j++) {
        const wisp = new THREE.Sprite(m);
        const a = Math.random() * Math.PI * 2;
        const d = rand(1.35, 2.1);
        const s = rand(0.8, 1.35);
        wisp.scale.set(s, s * 0.7, 1);
        wisp.position.set(Math.cos(a) * d, rand(-0.15, 0.6), Math.sin(a) * d * 0.7);
        g.add(wisp);
      }

      g.position.set(x, y, z);
      g.rotation.y = rand(0, Math.PI);
      g.scale.set(scale * rand(1.35, 1.8), scale * rand(1.05, 1.3), scale * rand(1.35, 1.8));
      g.userData.baseY = y;
      g.userData.phase = Math.random() * Math.PI * 2;
      cloudLayer.add(g);
      clouds.push(g);
    }

    const specs = [
      [-42, 23, -62, 1.4],
      [-12, 26, -76, 1.25],
      [34, 22, -60, 1.35],
      [-70, 24, -14, 1.2],
      [48, 27, 34, 1.3],
      [-24, 23, 66, 1.2],
      [74, 25, -24, 1.2],
      [-84, 25, 46, 1.25],
      [10, 22, -84, 1.35],
      [58, 24, -72, 1.25]
    ];
    for (let i = 0; i < specs.length; i++) {
      const sp = specs[i];
      addCloud(sp[0], sp[1], sp[2], sp[3]);
    }
  }

  function configureShadowLight(light, size) {
    light.castShadow = true;
    light.shadow.mapSize.set(size, size);
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 80;
    light.shadow.camera.left = -SHADOW_EXTENT;
    light.shadow.camera.right = SHADOW_EXTENT;
    light.shadow.camera.top = SHADOW_EXTENT;
    light.shadow.camera.bottom = -SHADOW_EXTENT;
    light.shadow.bias = -0.0006;
    light.shadow.normalBias = 0.03;
    light.shadow.camera.updateProjectionMatrix();
  }

  function init(scene, coarsePointer, renderer) {
    sceneRef = scene;
    rendererRef = renderer || null;
    coarse = !!coarsePointer;
    sceneRef.fog = new THREE.Fog(0xe2ecd6, coarse ? 40 : 60, coarse ? 112 : 145);

    hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6c8a4f, 0.55);
    scene.add(hemi);

    nightFill = new THREE.AmbientLight(0x2c3c63, 0);
    scene.add(nightFill);

    sun = new THREE.DirectionalLight(0xffefca, 1.8);
    configureShadowLight(sun, coarse ? 1024 : 2048);
    scene.add(sun);
    scene.add(sun.target);

    moon = new THREE.DirectionalLight(0xb8ccff, 0);
    configureShadowLight(moon, coarse ? 512 : 1024);
    moon.castShadow = false;
    scene.add(moon);
    scene.add(moon.target);

    phase = START_PHASE;
    solarDirection(phase, sunDir);
    moonDir.copy(sunDir).multiplyScalar(-1);
    sunAltitude = Math.asin(clamp(sunDir.y, -1, 1));
    moonAltitude = Math.asin(clamp(moonDir.y, -1, 1));
    daylight = smoothstep(-0.12, 0.10, sunAltitude);
    nightFactor = 1 - smoothstep(-0.28, -0.03, sunAltitude);

    makeSky();
    makeCelestialBodies();
    makeClouds();
    sampleSky(phase);
    writeSkyColors();
  }

  function writeSkyColors() {
    if (!skyDome || !skyColorAttr) return;

    const colors = skyColorAttr.array;
    const sunUp = smoothstep(-0.14, 0.01, sunAltitude);
    const twilight = Math.exp(-Math.pow(sunAltitude / 0.18, 2));
    const glowStrength = sunUp * (0.35 + 0.65 * twilight);
    const moonGlow = nightFactor * 0.22;

    sunGlowColor.copy(sunGlowWarm).lerp(sunGlowDay, smoothstep(0.02, 0.55, sunAltitude));
    belowHorizon.copy(skyHorizon).multiplyScalar(0.55);

    for (let i = 0; i < skyDirs.length / 3; i++) {
      const dx = skyDirs[i * 3];
      const dy = skyDirs[i * 3 + 1];
      const dz = skyDirs[i * 3 + 2];
      const c = scratchColor;

      if (dy <= 0.02) {
        c.copy(skyHorizon).lerp(belowHorizon, clamp((0.02 - dy) * 2.2, 0, 1));
      } else if (dy < 0.10) {
        c.copy(skyHorizon).lerp(skyLow, (dy - 0.02) / 0.08);
      } else if (dy < 0.26) {
        c.copy(skyLow).lerp(skyMid, (dy - 0.10) / 0.16);
      } else {
        c.copy(skyMid).lerp(skyTop, Math.min(1, (dy - 0.26) / 0.35));
      }

      const sunDot = Math.max(0, dx * sunDir.x + dy * sunDir.y + dz * sunDir.z);
      if (sunDot > 0) {
        const glow = (Math.pow(sunDot, 3) * 0.04 + Math.pow(sunDot, 12) * 0.30) * glowStrength;
        c.r += sunGlowColor.r * glow;
        c.g += sunGlowColor.g * glow;
        c.b += sunGlowColor.b * glow;
      }

      if (moonGlow > 0) {
        const moonDot = Math.max(0, dx * moonDir.x + dy * moonDir.y + dz * moonDir.z);
        const glow = (Math.pow(moonDot, 3) * 0.03 + Math.pow(moonDot, 12) * 0.25) * moonGlow;
        c.r += moonGlowColor.r * glow;
        c.g += moonGlowColor.g * glow;
        c.b += moonGlowColor.b * glow;
      }

      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    skyColorAttr.needsUpdate = true;
  }

  function apply(camera, goat, dt, t) {
    const hourAngle = (phase - 0.5) * Math.PI * 2;
    solarDirection(phase, sunDir);
    moonDir.copy(sunDir).multiplyScalar(-1);
    sunAltitude = Math.asin(clamp(sunDir.y, -1, 1));
    moonAltitude = Math.asin(clamp(moonDir.y, -1, 1));

    daylight = smoothstep(-0.12, 0.10, sunAltitude);
    nightFactor = 1 - smoothstep(-0.28, -0.03, sunAltitude);
    const twilight = Math.exp(-Math.pow(sunAltitude / 0.18, 2));

    sampleSky(phase);
    writeSkyColors();

    sceneRef.fog.color.copy(skyFog);
    sceneRef.fog.near = 42 + 18 * daylight;
    sceneRef.fog.far = 112 + 33 * daylight;

    if (rendererRef) {
      rendererRef.toneMappingExposure = 0.86 + 0.10 * daylight + 0.03 * twilight;
    }

    const sunUp = smoothstep(-0.05, 0.08, sunAltitude);
    const sunHeight = smoothstep(0.0, 0.62, sunAltitude);
    sun.intensity = sunUp * (0.50 + 1.20 * sunHeight);
    sun.color.copy(sunColorWarm).lerp(sunColorDay, smoothstep(0.02, 0.55, sunAltitude));
    sun.visible = sun.intensity > 0.01;
    sun.castShadow = sun.visible && sunAltitude > -0.04;

    const moonUp = smoothstep(-0.05, 0.08, moonAltitude);
    moon.intensity = moonUp * 0.45;
    moon.color.copy(moonColor);
    moon.visible = moon.intensity > 0.01;
    moon.castShadow = moon.visible && !sun.castShadow;

    hemi.color.copy(skyMid).lerp(hemiDay, daylight * 0.5).lerp(sunGlowWarm, twilight * 0.35);
    hemi.groundColor.copy(groundNight).lerp(groundDay, daylight);
    hemi.intensity = 0.21 + 0.31 * daylight + 0.26 * twilight;
    nightFill.intensity = nightFactor * 0.15;

    for (let i = 0; i < cloudMats.length; i++) {
      cloudMats[i].color.copy(skyCloud);
    }

    if (goat) {
      const target = goat.position;
      sun.position.set(
        target.x + sunDir.x * LIGHT_DISTANCE,
        target.y + 0.5 + sunDir.y * LIGHT_DISTANCE,
        target.z + sunDir.z * LIGHT_DISTANCE
      );
      sun.target.position.set(target.x, target.y + 0.5, target.z);
      sun.target.updateMatrixWorld();

      moon.position.set(
        target.x + moonDir.x * LIGHT_DISTANCE,
        target.y + 0.5 + moonDir.y * LIGHT_DISTANCE,
        target.z + moonDir.z * LIGHT_DISTANCE
      );
      moon.target.position.set(target.x, target.y + 0.5, target.z);
      moon.target.updateMatrixWorld();
    }

    if (sunSprite) {
      sunSprite.position.copy(sunDir).multiplyScalar(BODY_RADIUS);
      sunSprite.material.color.copy(sunDiscWarm).lerp(sunDiscDay, smoothstep(0.02, 0.55, sunAltitude));
      sunSprite.material.opacity = smoothstep(-0.02, 0.025, sunAltitude);
      sunSprite.visible = sunSprite.material.opacity > 0.01;
      const sunScale = (10.5 + 1.5 * (1 - smoothstep(0.05, 0.55, sunAltitude))) * 3 * (1 + 0.025 * Math.sin(t * 2.3));
      sunSprite.scale.set(sunScale, sunScale, 1);
    }

    if (moonSprite) {
      moonSprite.position.copy(moonDir).multiplyScalar(BODY_RADIUS);
      moonSprite.material.opacity = smoothstep(-0.02, 0.025, moonAltitude);
      moonSprite.visible = moonSprite.material.opacity > 0.01;
    }

    if (starGroup) {
      // The star field turns around the celestial pole at the same angular
      // rate as the planet, so the night sky shares the solar day's rotation.
      starGroup.quaternion.setFromAxisAngle(celestialPole, -hourAngle);
      starGroup.visible = nightFactor > 0.01;
      stars.material.opacity = nightFactor * 0.85;
      brightStars.material.opacity = nightFactor;
    }

    if (camera) {
      skyDome.position.copy(camera.position);
      celestial.position.copy(camera.position);
    }

    if (cloudLayer && goat) {
      for (let i = 0; i < clouds.length; i++) {
        const cloud = clouds[i];
        cloud.position.x += dt * (0.16 + (i % 3) * 0.05);
        if (cloud.position.x > 90) cloud.position.x = -90;
        cloud.position.y = cloud.userData.baseY + Math.sin(t * 0.25 + cloud.userData.phase) * 0.25;
      }
      cloudLayer.position.copy(goat.position);
    }
  }

  function update(camera, goat, dt, t) {
    lastCamera = camera;
    lastGoat = goat;
    lastTime = t;
    phase = wrapPhase(phase + dt / DAY_SECONDS);
    apply(camera, goat, dt, t);
  }

  function setPhase(value) {
    phase = wrapPhase(value);
    if (lastCamera && lastGoat) apply(lastCamera, lastGoat, 0, lastTime);
  }

  function phaseName(value) {
    if (value < 0.20 || value >= 0.86) return 'night';
    if (value < 0.28) return 'dawn';
    if (value < 0.38) return 'morning';
    if (value < 0.62) return 'day';
    if (value < 0.70) return 'afternoon';
    if (value < 0.80) return 'evening';
    return 'dusk';
  }

  function getState() {
    return {
      phase: phase,
      phaseName: phaseName(phase),
      dayLength: DAY_SECONDS,
      sunAltitude: sunAltitude,
      sunAltitudeDegrees: sunAltitude * 180 / Math.PI,
      sunDirection: { x: sunDir.x, y: sunDir.y, z: sunDir.z },
      moonDirection: { x: moonDir.x, y: moonDir.y, z: moonDir.z },
      daylight: daylight,
      night: nightFactor,
      sunLight: sun ? sun.intensity : 0,
      moonLight: moon ? moon.intensity : 0,
      hemiLight: hemi ? hemi.intensity : 0,
      sunCastsShadow: !!(sun && sun.castShadow),
      moonCastsShadow: !!(moon && moon.castShadow)
    };
  }

  M.environment = {
    init: init,
    update: update,
    setPhase: setPhase,
    getState: getState,
    DAY_LENGTH: DAY_SECONDS
  };
})(window.Meadow = window.Meadow || {});
