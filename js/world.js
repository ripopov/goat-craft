(function (M) {
  'use strict';

  const { clamp, rand } = M.utils;
  const std = M.std;

  let sceneRef = null;
  let rendererRef = null;
  let blockTex = null;
  let blockAtlasCanvas = null;
  let blockMat = null;
  let plantTex = null;
  let plantMat = null;
  const wind = { value: 0 };


  // ------------------------------------------------------------------ world
  const BLOCK = 2;
  const CHUNK_BLOCKS = 16;
  const CHUNK_SIZE = CHUNK_BLOCKS * BLOCK;
  const RENDER_RADIUS = M.config.renderRadius;
  const WORLD_SEED = 1337;

  function hashInt(x, z, seed) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function hash01(x, z) {
    return hashInt(x, z, WORLD_SEED) / 4294967296;
  }

  function valueNoise(x, z) {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const tx = x - xi;
    const tz = z - zi;
    const u = tx * tx * (3 - 2 * tx);
    const v = tz * tz * (3 - 2 * tz);
    const a = hash01(xi, zi);
    const b = hash01(xi + 1, zi);
    const c = hash01(xi, zi + 1);
    const d = hash01(xi + 1, zi + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }

  function heightBlocks(bx, bz) {
    const n1 = valueNoise(bx * 0.045 + 11.3, bz * 0.045 - 7.1);
    const n2 = valueNoise(bx * 0.13 - 31.7, bz * 0.13 + 18.4);
    const n3 = valueNoise(bx * 0.31 + 101.2, bz * 0.31 - 73.5);
    return Math.max(0, Math.floor(1.0 + n1 * 4.2 + n2 * 0.7 + n3 * 0.2));
  }

  const removedBlocks = new Set();
  const removedPropBlocks = new Set();
  const placedBlocks = new Map();

  function blockKey(bx, by, bz) {
    return bx + ',' + by + ',' + bz;
  }

  function isRemoved(bx, by, bz) {
    return removedBlocks.size > 0 && removedBlocks.has(blockKey(bx, by, bz));
  }

  function topSolidY(bx, bz) {
    let y = heightBlocks(bx, bz) - 1;
    if (removedBlocks.size > 0) {
      while (y >= 0 && removedBlocks.has(blockKey(bx, y, bz))) y--;
    }
    return y;
  }

  function surfaceHeight(x, z) {
    const y = topSolidY(Math.floor(x / BLOCK), Math.floor(z / BLOCK));
    return Math.max(0, (y + 1) * BLOCK);
  }

  function isSolidBlock(bx, by, bz) {
    if (by < 0) return true;
    if (by >= heightBlocks(bx, bz)) return false;
    return !isRemoved(bx, by, bz);
  }

  function chunkForBlock(bx, bz) {
    return chunks.get(Math.floor(bx / CHUNK_BLOCKS) + ',' + Math.floor(bz / CHUNK_BLOCKS)) || null;
  }

  function propKindAt(bx, by, bz) {
    if (by < 0) return null;
    const ch = chunkForBlock(bx, bz);
    if (!ch || !ch.propBlocks) return null;
    return ch.propBlocks.get(blockKey(bx, by, bz)) || null;
  }

  function solidKindAt(bx, by, bz) {
    return propKindAt(bx, by, bz) || (isSolidBlock(bx, by, bz) ? 'terrain' : null);
  }

  // Does any solid terrain or prop block intersect the vertical slice from minY
  // to maxY at this point? Props above the goat (canopies) are ignored.
  function blockedAt(x, z, minY, maxY) {
    const bx = Math.floor(x / BLOCK);
    const bz = Math.floor(z / BLOCK);

    if (surfaceHeight(x, z) > minY) return true;

    const ch = chunkForBlock(bx, bz);
    if (!ch || !ch.propBlocks || ch.propBlocks.size === 0) return false;

    const firstBy = Math.max(0, Math.floor(minY / BLOCK) - 1);
    const lastBy = Math.floor(maxY / BLOCK);
    for (let by = firstBy; by <= lastBy; by++) {
      const bottom = by * BLOCK;
      const top = bottom + BLOCK;
      if (top <= minY) continue;
      if (bottom >= maxY) break;
      if (ch.propBlocks.has(blockKey(bx, by, bz))) return true;
    }
    return false;
  }

  // Highest solid top at or below maxY. Leaving the ceiling below a canopy
  // keeps the goat on the ground while it walks under the tree.
  function supportHeight(x, z, maxY) {
    const bx = Math.floor(x / BLOCK);
    const bz = Math.floor(z / BLOCK);
    let best = surfaceHeight(x, z);
    if (best > maxY + 0.001) return best;

    const ch = chunkForBlock(bx, bz);
    if (!ch || !ch.propBlocks || ch.propBlocks.size === 0) return best;

    const topBy = Math.floor(maxY / BLOCK) - 1;
    for (let by = topBy; by >= 0; by--) {
      if (ch.propBlocks.has(blockKey(bx, by, bz))) {
        const top = (by + 1) * BLOCK;
        if (top > best) best = top;
        break;
      }
    }
    return best;
  }

  // Highest actual solid top at or below maxY, including blocks inside a
  // cavity. Item drops use this instead of supportHeight because a drop can
  // sit in a hole cut into a taller terrain column.
  function landingHeight(x, z, maxY) {
    const bx = Math.floor(x / BLOCK);
    const bz = Math.floor(z / BLOCK);
    const ch = chunkForBlock(bx, bz);
    const topBy = Math.floor(maxY / BLOCK) - 1;

    for (let by = topBy; by >= 0; by--) {
      if (ch && ch.propBlocks && ch.propBlocks.has(blockKey(bx, by, bz))) {
        return (by + 1) * BLOCK;
      }
      if (isSolidBlock(bx, by, bz)) {
        return (by + 1) * BLOCK;
      }
    }
    return 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }


  // ---- pixel block textures ----
  const ATLAS_GRID = 4;
  const TILE = 16;
  const TILE_PAD = 8;
  const CELL = TILE + TILE_PAD * 2;
  const ATLAS_SIZE = CELL * ATLAS_GRID;
  const T_GRASS = 0;
  const T_DIRT = 1;
  const T_GRASS_SIDE = 2;
  const T_STONE = 3;
  const T_LOG = 4;
  const T_LOG_TOP = 5;
  const T_LEAVES = 6;

  function makeBlockAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ATLAS_SIZE;
    const ctx = canvas.getContext('2d');

    const cellAt = function (index) {
      return {
        x: (index % ATLAS_GRID) * CELL,
        y: Math.floor(index / ATLAS_GRID) * CELL
      };
    };

    const begin = function (index, base) {
      const c = cellAt(index);
      ctx.fillStyle = base;
      ctx.fillRect(c.x, c.y, CELL, CELL);
      ctx.fillRect(c.x + TILE_PAD, c.y + TILE_PAD, TILE, TILE);
      return { x: c.x + TILE_PAD, y: c.y + TILE_PAD };
    };

    const speckle = function (x, y, colors, count) {
      for (let i = 0; i < count; i++) {
        ctx.fillStyle = colors[(Math.random() * colors.length) | 0];
        ctx.fillRect(x + ((Math.random() * TILE) | 0), y + ((Math.random() * TILE) | 0), 1, 1);
      }
    };

    const grass = begin(T_GRASS, '#74a948');
    speckle(grass.x, grass.y, ['#63983c', '#83ba56', '#6da43f', '#8bc95b', '#5b8f35'], 130);
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = 'rgba(70, 120, 40, 0.55)';
      ctx.fillRect(grass.x + ((Math.random() * 15) | 0), grass.y + ((Math.random() * 15) | 0), 2, 1);
    }

    const dirt = begin(T_DIRT, '#8b5a36');
    speckle(dirt.x, dirt.y, ['#75482a', '#9a6841', '#6b4026', '#a1724a'], 120);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = 'rgba(60, 38, 22, 0.5)';
      ctx.fillRect(dirt.x + ((Math.random() * 14) | 0), dirt.y + ((Math.random() * 14) | 0), 2, 1);
    }

    const side = begin(T_GRASS_SIDE, '#8b5a36');
    speckle(side.x, side.y, ['#75482a', '#9a6841', '#a1724a'], 100);
    for (let px = 0; px < TILE; px++) {
      const h = 3 + Math.floor(Math.random() * 4);
      ctx.fillStyle = px % 3 === 0 ? '#63983c' : '#74a948';
      ctx.fillRect(side.x + px, side.y, 1, h);
      if (Math.random() < 0.25) {
        ctx.fillStyle = '#6aa63f';
        ctx.fillRect(side.x + px, side.y + h, 1, 1 + ((Math.random() * 2) | 0));
      }
    }

    const stone = begin(T_STONE, '#93938c');
    speckle(stone.x, stone.y, ['#84847d', '#a3a39b', '#77776f', '#b0afa6'], 95);
    ctx.strokeStyle = 'rgba(90, 90, 85, 0.65)';
    ctx.beginPath();
    ctx.moveTo(stone.x + 3, stone.y + 5);
    ctx.lineTo(stone.x + 8, stone.y + 9);
    ctx.lineTo(stone.x + 7, stone.y + 14);
    ctx.stroke();

    const log = begin(T_LOG, '#69472a');
    for (let px = 0; px < TILE; px += 3) {
      ctx.fillStyle = px % 2 ? '#5a3c22' : '#7a5531';
      ctx.fillRect(log.x + px, log.y, 1, TILE);
    }
    speckle(log.x, log.y, ['#50351e', '#825c36', '#4a311b'], 40);

    const logTop = begin(T_LOG_TOP, '#7a5531');
    ctx.fillStyle = '#69472a';
    for (let r = 1; r < 8; r += 2) {
      ctx.fillRect(logTop.x + r, logTop.y + r, TILE - r * 2, 1);
      ctx.fillRect(logTop.x + r, logTop.y + TILE - r - 1, TILE - r * 2, 1);
      ctx.fillRect(logTop.x + r, logTop.y + r, 1, TILE - r * 2);
      ctx.fillRect(logTop.x + TILE - r - 1, logTop.y + r, 1, TILE - r * 2);
    }
    ctx.fillStyle = '#5a3c22';
    ctx.fillRect(logTop.x + 7, logTop.y + 7, 2, 2);

    const leaves = begin(T_LEAVES, '#4f7d2d');
    speckle(leaves.x, leaves.y, ['#416b24', '#5f9338', '#37601f', '#6ba63f', '#4a762a'], 150);
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = 'rgba(30, 55, 18, 0.55)';
      ctx.fillRect(leaves.x + ((Math.random() * 15) | 0), leaves.y + ((Math.random() * 15) | 0), 1, 2);
    }

    // copy tile edges into the padding so distant mipmaps stay clean
    for (let i = 0; i <= 6; i++) {
      const c = cellAt(i);
      const x = c.x + TILE_PAD;
      const y = c.y + TILE_PAD;
      ctx.drawImage(canvas, x, y, TILE, 1, c.x, c.y, CELL, TILE_PAD);
      ctx.drawImage(canvas, x, y + TILE - 1, TILE, 1, c.x, y + TILE, CELL, TILE_PAD);
      ctx.drawImage(canvas, x, y, 1, TILE, c.x, y, TILE_PAD, TILE);
      ctx.drawImage(canvas, x + TILE - 1, y, 1, TILE, x + TILE, y, TILE_PAD, TILE);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.anisotropy = Math.min(8, rendererRef.capabilities.getMaxAnisotropy());
    blockAtlasCanvas = canvas;
    return tex;
  }

  // ---- plant sprites ----
  const PLANT_GRID = 2;
  const PLANT_TILE = 32;
  const PLANT_PAD = 16;
  const PLANT_CELL = PLANT_TILE + PLANT_PAD * 2;
  const PLANT_SIZE = PLANT_CELL * PLANT_GRID;
  const P_GRASS = 0;
  const P_POPPY = 1;
  const P_DANDELION = 2;
  const P_DAISY = 3;

  function makePlantAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PLANT_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, PLANT_SIZE, PLANT_SIZE);

    const tileAt = function (index) {
      return {
        x: (index % PLANT_GRID) * PLANT_CELL + PLANT_PAD,
        y: Math.floor(index / PLANT_GRID) * PLANT_CELL + PLANT_PAD
      };
    };

    const grass = tileAt(P_GRASS);
    ctx.save();
    ctx.translate(grass.x, grass.y);
    for (let i = 0; i < 10; i++) {
      const bx = 5 + Math.random() * 22;
      const bh = 10 + Math.random() * 18;
      const bend = (Math.random() - 0.5) * 9;
      ctx.strokeStyle = ['#5b9637', '#6aa842', '#79b84c', '#4e862e'][i % 4];
      ctx.lineWidth = Math.random() < 0.35 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(bx, 31);
      ctx.quadraticCurveTo(bx + bend * 0.4, 31 - bh * 0.55, bx + bend, 31 - bh);
      ctx.stroke();
    }
    ctx.restore();

    const flower = function (index, petal, center) {
      const t = tileAt(index);
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.strokeStyle = '#4c7f2e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(16, 31);
      ctx.lineTo(16, 16);
      ctx.stroke();
      ctx.fillStyle = '#5b9236';
      ctx.fillRect(10, 23, 6, 2);
      ctx.fillRect(16, 19, 5, 2);
      ctx.fillStyle = petal;
      if (index === P_DAISY) {
        ctx.fillRect(9, 10, 5, 4);
        ctx.fillRect(18, 10, 5, 4);
        ctx.fillRect(12, 6, 8, 5);
        ctx.fillRect(12, 14, 8, 4);
        ctx.fillRect(6, 8, 4, 5);
        ctx.fillRect(22, 8, 4, 5);
      } else {
        ctx.fillRect(11, 7, 10, 9);
        ctx.fillRect(8, 10, 4, 4);
        ctx.fillRect(20, 10, 4, 4);
      }
      ctx.fillStyle = center;
      ctx.fillRect(13, 10, 6, 3);
      if (index === P_POPPY) {
        ctx.fillStyle = '#3b2416';
        ctx.fillRect(14, 10, 4, 2);
      }
      ctx.restore();
    };

    flower(P_POPPY, '#d64545', '#3b2416');
    flower(P_DANDELION, '#f2c53d', '#b8841f');
    flower(P_DAISY, '#fbfaf2', '#e8b93e');

    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = Math.min(8, rendererRef.capabilities.getMaxAnisotropy());
    return tex;
  }

  // ---- geometry helpers ----
  function tileUV(tile, u, v) {
    const col = tile % ATLAS_GRID;
    const row = Math.floor(tile / ATLAS_GRID);
    const x = col * CELL + TILE_PAD;
    const y = row * CELL + TILE_PAD;
    const inset = 0.35;
    return [
      (x + inset + u * (TILE - inset * 2)) / ATLAS_SIZE,
      1 - (y + inset + (1 - v) * (TILE - inset * 2)) / ATLAS_SIZE
    ];
  }

  function plantUV(type, u, v) {
    const col = type % PLANT_GRID;
    const row = Math.floor(type / PLANT_GRID);
    const x = col * PLANT_CELL + PLANT_PAD;
    const y = row * PLANT_CELL + PLANT_PAD;
    const inset = 0.5;
    return [
      (x + inset + u * (PLANT_TILE - inset * 2)) / PLANT_SIZE,
      1 - (y + inset + (1 - v) * (PLANT_TILE - inset * 2)) / PLANT_SIZE
    ];
  }

  function quadTileUVs(tile) {
    return [
      tileUV(tile, 0, 0),
      tileUV(tile, 1, 0),
      tileUV(tile, 1, 1),
      tileUV(tile, 0, 1)
    ];
  }

  function pushQuad(data, verts, normal, uvs, shade) {
    const base = data.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      data.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      data.nor.push(normal[0], normal[1], normal[2]);
      data.uv.push(uvs[i][0], uvs[i][1]);
      if (data.col) data.col.push(shade, shade, shade);
    }
    data.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  function pushTop(data, x, y, z, tile, shade) {
    pushQuad(
      data,
      [[x, y, z], [x, y, z + BLOCK], [x + BLOCK, y, z + BLOCK], [x + BLOCK, y, z]],
      [0, 1, 0],
      quadTileUVs(tile),
      shade
    );
  }

  function pushBottom(data, x, y, z, tile, shade) {
    pushQuad(
      data,
      [[x, y, z], [x + BLOCK, y, z], [x + BLOCK, y, z + BLOCK], [x, y, z + BLOCK]],
      [0, -1, 0],
      quadTileUVs(tile),
      shade
    );
  }

  function pushSide(data, dir, x, z, y0, y1, tile, shade) {
    const x1 = x + BLOCK;
    const z1 = z + BLOCK;
    const uvs = quadTileUVs(tile);
    if (dir === 0) {
      pushQuad(data, [[x, y0, z], [x, y0, z1], [x, y1, z1], [x, y1, z]], [-1, 0, 0], uvs, shade);
    } else if (dir === 1) {
      pushQuad(data, [[x1, y0, z1], [x1, y0, z], [x1, y1, z], [x1, y1, z1]], [1, 0, 0], uvs, shade);
    } else if (dir === 2) {
      pushQuad(data, [[x1, y0, z], [x, y0, z], [x, y1, z], [x1, y1, z]], [0, 0, -1], uvs, shade);
    } else {
      pushQuad(data, [[x, y0, z1], [x1, y0, z1], [x1, y1, z1], [x, y1, z1]], [0, 0, 1], uvs, shade);
    }
  }

  function pushBlock(data, x, y, z, topTile, sideTile, bottomTile, shadeTop, shadeSide) {
    pushTop(data, x, y + BLOCK, z, topTile, shadeTop);
    pushBottom(data, x, y, z, bottomTile, shadeSide);
    for (let dir = 0; dir < 4; dir++) {
      pushSide(data, dir, x, z, y, y + BLOCK, sideTile, shadeSide);
    }
  }

  function dataToGeometry(data, withBend) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(data.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(data.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
    if (data.col) {
      geo.setAttribute('color', new THREE.Float32BufferAttribute(data.col, 3));
    }
    if (withBend) {
      geo.setAttribute('aBend', new THREE.Float32BufferAttribute(data.bend, 1));
    }
    geo.setIndex(data.idx);
    geo.computeBoundingSphere();
    return geo;
  }

  // ---- block item art ----
  // Terrain and prop blocks share the atlas, so drops and hotbar icons can use
  // exactly the same wood, stone, leaf and soil textures as the world.
  const ITEM_TILES = {
    grass: { top: T_GRASS, side: T_GRASS_SIDE, bottom: T_DIRT },
    dirt: { top: T_DIRT, side: T_DIRT, bottom: T_DIRT },
    stone: { top: T_STONE, side: T_STONE, bottom: T_STONE },
    log: { top: T_LOG_TOP, side: T_LOG, bottom: T_LOG_TOP },
    leaves: { top: T_LEAVES, side: T_LEAVES, bottom: T_LEAVES }
  };
  const iconCache = Object.create(null);
  const dropMeshGeometries = Object.create(null);

  function atlasTileRect(tile) {
    const col = tile % ATLAS_GRID;
    const row = Math.floor(tile / ATLAS_GRID);
    return { x: col * CELL + TILE_PAD, y: row * CELL + TILE_PAD };
  }

  function drawIconFace(ctx, tile, a, u, v, shade) {
    const src = atlasTileRect(tile);

    function facePath() {
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(a[0] + u[0], a[1] + u[1]);
      ctx.lineTo(a[0] + u[0] + v[0], a[1] + u[1] + v[1]);
      ctx.lineTo(a[0] + v[0], a[1] + v[1]);
      ctx.closePath();
    }

    ctx.save();
    facePath();
    ctx.clip();
    ctx.setTransform(u[0] / TILE, u[1] / TILE, v[0] / TILE, v[1] / TILE, a[0], a[1]);
    ctx.drawImage(blockAtlasCanvas, src.x, src.y, TILE, TILE, 0, 0, TILE, TILE);
    ctx.restore();

    ctx.save();
    facePath();
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.restore();

    ctx.save();
    facePath();
    ctx.strokeStyle = 'rgba(35, 46, 28, .32)';
    ctx.lineWidth = Math.max(1, ctx.canvas.width / 80);
    ctx.stroke();
    ctx.restore();
  }

  function blockIcon(kind, size) {
    if (!blockAtlasCanvas) return '';
    const px = Math.max(32, Math.round(size || 64));
    const key = kind + ':' + px;
    if (iconCache[key]) return iconCache[key];

    const def = ITEM_TILES[kind] || ITEM_TILES.dirt;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const s = px / 64;

    // isometric cube: top diamond, left face, right face
    const top = [32 * s, 4 * s];
    const topU = [28 * s, 16 * s];
    const topV = [-28 * s, 16 * s];
    const left = [4 * s, 20 * s];
    const leftU = [28 * s, 16 * s];
    const faceV = [0, 26 * s];
    const right = [32 * s, 36 * s];
    const rightU = [28 * s, -16 * s];

    drawIconFace(ctx, def.side, left, leftU, faceV, 'rgba(22, 31, 17, .18)');
    drawIconFace(ctx, def.side, right, rightU, faceV, 'rgba(255, 255, 255, .03)');
    drawIconFace(ctx, def.top, top, topU, topV, 'rgba(255, 255, 255, .05)');

    const url = canvas.toDataURL('image/png');
    iconCache[key] = url;
    return url;
  }

  function makeBlockMesh(kind) {
    const def = ITEM_TILES[kind] || ITEM_TILES.dirt;
    let geo = dropMeshGeometries[kind];
    if (!geo) {
      const data = { pos: [], nor: [], uv: [], col: [], idx: [] };
      pushBlock(data, -BLOCK / 2, -BLOCK / 2, -BLOCK / 2, def.top, def.side, def.bottom, 1.0, 0.82);
      geo = dataToGeometry(data, false);
      dropMeshGeometries[kind] = geo;
    }
    return new THREE.Mesh(geo, blockMat);
  }

  // ---- terrain mesh ----
  function buildTerrainGeometry(cx, cz) {
    const data = { pos: [], nor: [], uv: [], col: [], idx: [] };
    const HS = CHUNK_BLOCKS + 2;
    const heights = new Int16Array(HS * HS);
    const originBX = cx * CHUNK_BLOCKS;
    const originBZ = cz * CHUNK_BLOCKS;

    for (let z = -1; z <= CHUNK_BLOCKS; z++) {
      for (let x = -1; x <= CHUNK_BLOCKS; x++) {
        heights[(z + 1) * HS + (x + 1)] = heightBlocks(originBX + x, originBZ + z);
      }
    }

    const hAt = function (lx, lz) {
      return heights[(lz + 1) * HS + (lx + 1)];
    };

    for (let bz = 0; bz < CHUNK_BLOCKS; bz++) {
      for (let bx = 0; bx < CHUNK_BLOCKS; bx++) {
        const h = hAt(bx, bz);
        const x = bx * BLOCK;
        const z = bz * BLOCK;
        const worldBX = originBX + bx;
        const worldBZ = originBZ + bz;
        const nhW = hAt(bx - 1, bz);
        const nhE = hAt(bx + 1, bz);
        const nhN = hAt(bx, bz - 1);
        const nhS = hAt(bx, bz + 1);

        for (let by = 0; by < h; by++) {
          if (isRemoved(worldBX, by, worldBZ)) continue;

          const y = by * BLOCK;
          const isTop = by === h - 1;
          const shade = (isTop ? 0.95 : 0.86) + hash01(worldBX, worldBZ) * 0.05;
          const solidAbove = by + 1 < h && !isRemoved(worldBX, by + 1, worldBZ);

          if (!solidAbove) {
            pushTop(data, x, y + BLOCK, z, isTop ? T_GRASS : T_DIRT, shade);
          }

          if (by > 0 && isRemoved(worldBX, by - 1, worldBZ)) {
            pushBottom(data, x, y, z, T_DIRT, shade * 0.7);
          }

          if (!(by < nhW && !isRemoved(worldBX - 1, by, worldBZ))) {
            pushSide(data, 0, x, z, y, y + BLOCK, isTop ? T_GRASS_SIDE : T_DIRT, shade * 0.72);
          }
          if (!(by < nhE && !isRemoved(worldBX + 1, by, worldBZ))) {
            pushSide(data, 1, x, z, y, y + BLOCK, isTop ? T_GRASS_SIDE : T_DIRT, shade * 0.72);
          }
          if (!(by < nhN && !isRemoved(worldBX, by, worldBZ - 1))) {
            pushSide(data, 2, x, z, y, y + BLOCK, isTop ? T_GRASS_SIDE : T_DIRT, shade * 0.7);
          }
          if (!(by < nhS && !isRemoved(worldBX, by, worldBZ + 1))) {
            pushSide(data, 3, x, z, y, y + BLOCK, isTop ? T_GRASS_SIDE : T_DIRT, shade * 0.7);
          }
        }
      }
    }

    return dataToGeometry(data, false);
  }

  // ---- trees, rocks ----
  function addTree(addBlock, cx, cz, bx, bz, rnd) {
    const worldBX = cx * CHUNK_BLOCKS + bx;
    const worldBZ = cz * CHUNK_BLOCKS + bz;
    const baseY = heightBlocks(worldBX, worldBZ) * BLOCK;
    const x = bx * BLOCK;
    const z = bz * BLOCK;
    const trunkH = 5 + Math.floor(rnd() * 3);

    for (let i = 0; i < trunkH; i++) {
      addBlock(x, baseY + i * BLOCK, z, T_LOG_TOP, T_LOG, T_LOG, 0.94, 0.84, 'log');
    }

    const start = trunkH - 3;
    const leafSet = new Set();
    for (let dy = 0; dy < 4; dy++) {
      const ly = start + dy;
      const radius = dy < 2 ? 2 : 1;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0 && ly < trunkH) continue;
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && rnd() < 0.72) continue;
          if (rnd() < 0.14) continue;
          leafSet.add(dx + ',' + ly + ',' + dz);
        }
      }
    }
    leafSet.add('0,' + (trunkH + 1) + ',0');

    leafSet.forEach(function (key) {
      const p = key.split(',');
      const dx = +p[0];
      const ly = +p[1];
      const dz = +p[2];
      const shade = 0.82 + rnd() * 0.12;
      addBlock(
        x + dx * BLOCK,
        baseY + ly * BLOCK,
        z + dz * BLOCK,
        T_LEAVES, T_LEAVES, T_LEAVES,
        shade, shade,
        'leaves'
      );
    });
  }

  function buildPropsGeometry(cx, cz) {
    const data = { pos: [], nor: [], uv: [], col: [], idx: [] };
    const blocks = new Map();
    const rnd = mulberry32(hashInt(cx, cz, 0x51ed270b));
    const trees = [];

    function addBlock(x, y, z, topTile, sideTile, bottomTile, shadeTop, shadeSide, kind, force) {
      const bx = cx * CHUNK_BLOCKS + Math.round(x / BLOCK);
      const bz = cz * CHUNK_BLOCKS + Math.round(z / BLOCK);
      const by = Math.round(y / BLOCK);
      const key = blockKey(bx, by, bz);
      if (!force && removedPropBlocks.has(key)) return;
      blocks.set(key, kind);
      pushBlock(data, x, y, z, topTile, sideTile, bottomTile, shadeTop, shadeSide);
    }

    let treeCount = rnd() < 0.72 ? 1 : 0;
    if (rnd() < 0.18) treeCount++;

    for (let t = 0; t < treeCount; t++) {
      let bx = 0;
      let bz = 0;
      let ok = false;
      for (let attempt = 0; attempt < 14; attempt++) {
        bx = 3 + Math.floor(rnd() * 11);
        bz = 3 + Math.floor(rnd() * 11);
        const wx = (cx * CHUNK_BLOCKS + bx) * BLOCK + BLOCK / 2;
        const wz = (cz * CHUNK_BLOCKS + bz) * BLOCK + BLOCK / 2;
        if (wx * wx + wz * wz < 225) continue;
        if (trees.some(function (o) { return Math.abs(o.bx - bx) < 5 && Math.abs(o.bz - bz) < 5; })) continue;
        ok = true;
        break;
      }
      if (!ok) continue;
      trees.push({ bx: bx, bz: bz });
      addTree(addBlock, cx, cz, bx, bz, rnd);
    }

    if (rnd() < 0.28) {
      const rx = 2 + Math.floor(rnd() * 12);
      const rz = 2 + Math.floor(rnd() * 12);
      const wx = (cx * CHUNK_BLOCKS + rx) * BLOCK + BLOCK / 2;
      const wz = (cz * CHUNK_BLOCKS + rz) * BLOCK + BLOCK / 2;
      if (wx * wx + wz * wz > 100) {
        const baseY = heightBlocks(cx * CHUNK_BLOCKS + rx, cz * CHUNK_BLOCKS + rz) * BLOCK;
        const count = 1 + Math.floor(rnd() * 3);
        for (let i = 0; i < count; i++) {
          const ox = Math.floor(rnd() * 2);
          const oz = Math.floor(rnd() * 2);
          addBlock(
            rx * BLOCK + ox * BLOCK,
            baseY,
            rz * BLOCK + oz * BLOCK,
            T_STONE, T_STONE, T_STONE,
            0.95, 0.8,
            'stone'
          );
        }
      }
    }

    // Player-placed blocks are kept separately from procedural props, but they
    // render and collide through the same per-chunk prop map.
    placedBlocks.forEach(function (kind, key) {
      const parts = key.split(',');
      const bx = +parts[0];
      const by = +parts[1];
      const bz = +parts[2];
      if (Math.floor(bx / CHUNK_BLOCKS) !== cx || Math.floor(bz / CHUNK_BLOCKS) !== cz) return;

      const def = ITEM_TILES[kind] || ITEM_TILES.dirt;
      addBlock(
        (bx - cx * CHUNK_BLOCKS) * BLOCK,
        by * BLOCK,
        (bz - cz * CHUNK_BLOCKS) * BLOCK,
        def.top, def.side, def.bottom,
        0.96, 0.84,
        kind,
        true
      );
    });

    if (data.idx.length === 0) return null;
    return { geometry: dataToGeometry(data, false), blocks: blocks };
  }

  // ---- flowers and grass tufts ----
  function pushPlant(data, x, z, y, w, h, angle, type) {
    const hw = w / 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const nx = -s;
    const nz = c;
    const uvs = [
      plantUV(type, 0, 0),
      plantUV(type, 1, 0),
      plantUV(type, 1, 1),
      plantUV(type, 0, 1)
    ];
    const verts = [
      [x + c * hw, y, z + s * hw],
      [x - c * hw, y, z - s * hw],
      [x - c * hw, y + h, z - s * hw],
      [x + c * hw, y + h, z + s * hw]
    ];
    const bends = [0, 0, 1, 1];
    const base = data.pos.length / 3;

    for (let i = 0; i < 4; i++) {
      data.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      data.nor.push(nx, 0, nz);
      data.uv.push(uvs[i][0], uvs[i][1]);
      data.bend.push(bends[i]);
    }
    data.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  function buildPlantsGeometry(cx, cz) {
    const data = { pos: [], nor: [], uv: [], bend: [], idx: [] };
    const rnd = mulberry32(hashInt(cx, cz, 0x2c1b3c6d));
    const count = 14 + Math.floor(rnd() * 10);

    for (let i = 0; i < count; i++) {
      const bx = Math.floor(rnd() * CHUNK_BLOCKS);
      const bz = Math.floor(rnd() * CHUNK_BLOCKS);
      const worldBX = cx * CHUNK_BLOCKS + bx;
      const worldBZ = cz * CHUNK_BLOCKS + bz;
      const y = heightBlocks(worldBX, worldBZ) * BLOCK + 0.02;
      const x = bx * BLOCK + BLOCK * 0.5 + (rnd() - 0.5) * BLOCK * 0.7;
      const z = bz * BLOCK + BLOCK * 0.5 + (rnd() - 0.5) * BLOCK * 0.7;
      const roll = rnd();
      const type = roll < 0.55 ? P_GRASS : roll < 0.75 ? P_POPPY : roll < 0.88 ? P_DANDELION : P_DAISY;
      const w = 0.75 + rnd() * 0.35;
      const h = type === P_GRASS ? 0.9 + rnd() * 0.3 : 0.9 + rnd() * 0.3;
      const angle = rnd() * Math.PI;

      pushPlant(data, x, z, y, w, h, angle, type);
      pushPlant(data, x, z, y, w, h, angle + Math.PI / 2, type);
    }

    if (data.idx.length === 0) return null;
    return dataToGeometry(data, true);
  }

  // ---- chunk streaming ----
  const chunks = new Map();
  const worldGroup = new THREE.Group();

  function buildChunk(cx, cz) {
    const key = cx + ',' + cz;
    if (chunks.has(key)) return;

    const group = new THREE.Group();
    group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

    const terrain = new THREE.Mesh(buildTerrainGeometry(cx, cz), blockMat);
    terrain.receiveShadow = true;
    group.add(terrain);

    const propsInfo = buildPropsGeometry(cx, cz);
    let props = null;
    let propBlocks = new Map();
    if (propsInfo) {
      props = new THREE.Mesh(propsInfo.geometry, blockMat);
      props.castShadow = true;
      props.receiveShadow = true;
      group.add(props);
      propBlocks = propsInfo.blocks;
    }

    const plantsGeo = buildPlantsGeometry(cx, cz);
    let plants = null;
    if (plantsGeo) {
      plants = new THREE.Mesh(plantsGeo, plantMat);
      group.add(plants);
    }

    worldGroup.add(group);
    chunks.set(key, {
      group: group,
      terrain: terrain,
      props: props,
      propBlocks: propBlocks,
      plants: plants,
      cx: cx,
      cz: cz
    });
  }

  const chunkOffsets = [];
  for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
    for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
      chunkOffsets.push([dx, dz]);
    }
  }
  chunkOffsets.sort(function (a, b) {
    return (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]);
  });


  function updateChunks(player) {
    const pcx = Math.floor(player.x / CHUNK_SIZE);
    const pcz = Math.floor(player.z / CHUNK_SIZE);
    let built = 0;

    for (let i = 0; i < chunkOffsets.length && built < 2; i++) {
      const cx = pcx + chunkOffsets[i][0];
      const cz = pcz + chunkOffsets[i][1];
      if (!chunks.has(cx + ',' + cz)) {
        buildChunk(cx, cz);
        built++;
      }
    }

    chunks.forEach(function (ch, key) {
      if (Math.abs(ch.cx - pcx) > RENDER_RADIUS + 1 || Math.abs(ch.cz - pcz) > RENDER_RADIUS + 1) {
        worldGroup.remove(ch.group);
        ch.terrain.geometry.dispose();
        if (ch.props) ch.props.geometry.dispose();
        if (ch.plants) ch.plants.geometry.dispose();
        chunks.delete(key);
      }
    });
  }

  function rebuildChunkTerrain(cx, cz) {
    const ch = chunks.get(cx + ',' + cz);
    if (!ch) return;
    ch.terrain.geometry.dispose();
    ch.terrain.geometry = buildTerrainGeometry(cx, cz);
  }

  function rebuildChunkProps(cx, cz) {
    const ch = chunks.get(cx + ',' + cz);
    if (!ch) return;

    if (ch.props) {
      ch.group.remove(ch.props);
      ch.props.geometry.dispose();
      ch.props = null;
    }

    const info = buildPropsGeometry(cx, cz);
    if (!info) {
      ch.propBlocks = new Map();
      return;
    }

    ch.props = new THREE.Mesh(info.geometry, blockMat);
    ch.props.castShadow = true;
    ch.props.receiveShadow = true;
    ch.group.add(ch.props);
    ch.propBlocks = info.blocks;
  }

  function rebuildTerrainAround(bx, bz) {
    const cx = Math.floor(bx / CHUNK_BLOCKS);
    const cz = Math.floor(bz / CHUNK_BLOCKS);
    const lx = bx - cx * CHUNK_BLOCKS;
    const lz = bz - cz * CHUNK_BLOCKS;
    const xs = [cx];
    const zs = [cz];

    if (lx === 0) xs.push(cx - 1);
    else if (lx === CHUNK_BLOCKS - 1) xs.push(cx + 1);
    if (lz === 0) zs.push(cz - 1);
    else if (lz === CHUNK_BLOCKS - 1) zs.push(cz + 1);

    for (let i = 0; i < xs.length; i++) {
      for (let j = 0; j < zs.length; j++) {
        rebuildChunkTerrain(xs[i], zs[j]);
      }
    }
  }

  function removePropBlock(bx, by, bz) {
    const key = blockKey(bx, by, bz);
    if (placedBlocks.has(key)) {
      placedBlocks.delete(key);
    } else {
      removedPropBlocks.add(key);
    }
  }

  function placeBlock(kind, bx, by, bz) {
    if (!ITEM_TILES[kind] || !Number.isInteger(bx) || !Number.isInteger(by) || !Number.isInteger(bz)) return false;
    if (by < 0) return false;
    if (!chunkForBlock(bx, bz)) return false;
    if (isSolidBlock(bx, by, bz)) return false;
    if (propKindAt(bx, by, bz)) return false;

    const key = blockKey(bx, by, bz);
    if (placedBlocks.has(key)) return false;
    placedBlocks.set(key, kind);
    rebuildChunkProps(
      Math.floor(bx / CHUNK_BLOCKS),
      Math.floor(bz / CHUNK_BLOCKS)
    );
    return true;
  }

  // ---- headbutt / block smashing ----
  const debris = [];
  const debrisGeo = new THREE.BoxGeometry(0.24, 0.24, 0.24);
  const debrisGrassMat = std(0x74a948, 1);
  const debrisDirtMat = std(0x8b5a36, 1);
  const debrisStoneMat = std(0x93938c, 1);
  const debrisLogMat = std(0x6e5233, 1);
  const debrisLeafMat = std(0x4f7a35, 1);

  function spawnBlockDrop(bx, by, bz, kind) {
    if (M.items && M.items.dropBlock) {
      M.items.dropBlock(
        kind,
        bx * BLOCK + BLOCK / 2,
        by * BLOCK + BLOCK / 2,
        bz * BLOCK + BLOCK / 2
      );
    }
  }

  function spawnBlockDebris(bx, by, bz, kind) {
    const cx = bx * BLOCK + BLOCK / 2;
    const cy = by * BLOCK + BLOCK / 2;
    const cz = bz * BLOCK + BLOCK / 2;

    for (let i = 0; i < 8; i++) {
      let mat = debrisDirtMat;
      if (kind === 'stone') mat = debrisStoneMat;
      else if (kind === 'log') mat = debrisLogMat;
      else if (kind === 'leaves') mat = debrisLeafMat;
      else if (kind === 'grass' && i < 5) mat = debrisGrassMat;
      const mesh = new THREE.Mesh(debrisGeo, mat);
      mesh.position.set(cx + rand(-0.7, 0.7), cy + rand(-0.7, 0.7), cz + rand(-0.7, 0.7));
      const scale = rand(0.6, 1.25);
      mesh.scale.setScalar(scale);
      mesh.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      mesh.userData = {
        baseScale: scale,
        life: rand(0.55, 0.85),
        vel: new THREE.Vector3(rand(-2.2, 2.2), rand(1.8, 4.8), rand(-2.2, 2.2)),
        spin: new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8))
      };
      sceneRef.add(mesh);
      debris.push(mesh);
    }
  }

  function updateDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
      const mesh = debris[i];
      const u = mesh.userData;
      u.vel.y -= 18 * dt;
      mesh.position.addScaledVector(u.vel, dt);
      mesh.rotation.x += u.spin.x * dt;
      mesh.rotation.y += u.spin.y * dt;
      mesh.rotation.z += u.spin.z * dt;
      u.life -= dt;

      if (u.life <= 0) {
        sceneRef.remove(mesh);
        debris.splice(i, 1);
      } else {
        const k = clamp(u.life / 0.7, 0, 1);
        mesh.scale.setScalar(u.baseScale * (0.35 + k * 0.65));
      }
    }
  }

  const HEADBUTT_CONTACT = 0.3;
  const headSamplePoints = [
    [0, -0.03, 0.55],   // muzzle / nose
    [0, 0.16, 0.34],    // forehead
    [0.095, 0.48, -0.36], // horn tips
    [-0.095, 0.48, -0.36]
  ];
  const headSampleWorld = new THREE.Vector3();

  function findHeadbuttTarget(headPivot) {
    headPivot.updateWorldMatrix(true, false);
    let best = null;
    let bestDist = HEADBUTT_CONTACT;

    for (let i = 0; i < headSamplePoints.length; i++) {
      const point = headSamplePoints[i];
      headSampleWorld.set(point[0], point[1], point[2]);
      headPivot.localToWorld(headSampleWorld);

      const bx0 = Math.floor(headSampleWorld.x / BLOCK);
      const by0 = Math.floor(headSampleWorld.y / BLOCK);
      const bz0 = Math.floor(headSampleWorld.z / BLOCK);

      for (let bx = bx0 - 1; bx <= bx0 + 1; bx++) {
        for (let bz = bz0 - 1; bz <= bz0 + 1; bz++) {
          for (let by = by0 - 1; by <= by0 + 1; by++) {
            if (by < 0) continue;
            const kind = solidKindAt(bx, by, bz);
            if (!kind) continue;
            const qx = clamp(headSampleWorld.x, bx * BLOCK, bx * BLOCK + BLOCK);
            const qy = clamp(headSampleWorld.y, by * BLOCK, by * BLOCK + BLOCK);
            const qz = clamp(headSampleWorld.z, bz * BLOCK, bz * BLOCK + BLOCK);
            const d = Math.hypot(headSampleWorld.x - qx, headSampleWorld.y - qy, headSampleWorld.z - qz);
            if (d < bestDist) {
              bestDist = d;
              best = { bx: bx, by: by, bz: bz, kind: kind };
            }
          }
        }
      }
    }
    return best;
  }

  function breakBlockInFront(headPivot) {
    const target = findHeadbuttTarget(headPivot);
    if (!target) return false;

    if (target.kind !== 'terrain') {
      removePropBlock(target.bx, target.by, target.bz);
      rebuildChunkProps(
        Math.floor(target.bx / CHUNK_BLOCKS),
        Math.floor(target.bz / CHUNK_BLOCKS)
      );
      spawnBlockDebris(target.bx, target.by, target.bz, target.kind);
      spawnBlockDrop(target.bx, target.by, target.bz, target.kind);
      return true;
    }

    const wasTop = target.by === heightBlocks(target.bx, target.bz) - 1;
    const kind = wasTop ? 'grass' : 'dirt';
    removedBlocks.add(blockKey(target.bx, target.by, target.bz));
    rebuildTerrainAround(target.bx, target.bz);
    spawnBlockDebris(target.bx, target.by, target.bz, kind);
    spawnBlockDrop(target.bx, target.by, target.bz, kind);
    return true;
  }

  function breakBlockBelow(x, z, feetY) {
    const bx = Math.floor(x / BLOCK);
    const bz = Math.floor(z / BLOCK);
    const ch = chunkForBlock(bx, bz);

    let propBy = -1;
    let propKind = null;
    if (ch && ch.propBlocks && ch.propBlocks.size > 0) {
      const topBy = Math.floor((feetY + 0.02) / BLOCK) - 1;
      for (let by = topBy; by >= 0; by--) {
        propKind = ch.propBlocks.get(blockKey(bx, by, bz));
        if (propKind) {
          propBy = by;
          break;
        }
      }
    }

    const terrainBy = topSolidY(bx, bz);
    const terrainTop = (terrainBy + 1) * BLOCK;
    const propTop = propBy >= 0 ? (propBy + 1) * BLOCK : -1;

    if (propBy >= 0 && propTop >= terrainTop - 0.001) {
      removePropBlock(bx, propBy, bz);
      rebuildChunkProps(
        Math.floor(bx / CHUNK_BLOCKS),
        Math.floor(bz / CHUNK_BLOCKS)
      );
      spawnBlockDebris(bx, propBy, bz, propKind);
      spawnBlockDrop(bx, propBy, bz, propKind);
      return true;
    }

    const by = terrainBy;
    if (by < 0 || !isSolidBlock(bx, by, bz)) return false;

    const wasTop = by === heightBlocks(bx, bz) - 1;
    const kind = wasTop ? 'grass' : 'dirt';
    removedBlocks.add(blockKey(bx, by, bz));
    rebuildTerrainAround(bx, bz);
    spawnBlockDebris(bx, by, bz, kind);
    spawnBlockDrop(bx, by, bz, kind);
    return true;
  }


  function init(scene, renderer) {
    sceneRef = scene;
    rendererRef = renderer;

    blockTex = makeBlockAtlas();
    blockMat = new THREE.MeshStandardMaterial({
      map: blockTex,
      roughness: 0.95,
      metalness: 0,
      vertexColors: true
    });

    plantTex = makePlantAtlas();
    plantMat = new THREE.MeshBasicMaterial({
      map: plantTex,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      toneMapped: true,
      fog: true
    });
    plantMat.onBeforeCompile = function (shader) {
      shader.uniforms.uWindTime = wind;
      shader.vertexShader = 'attribute float aBend;\nuniform float uWindTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float swayPhase = position.x * 0.22 + position.z * 0.31;
         transformed.x += sin(uWindTime * 1.8 + swayPhase) * 0.12 * aBend;
         transformed.z += cos(uWindTime * 1.45 + swayPhase * 0.8) * 0.06 * aBend;`
      );
    };
    plantMat.customProgramCacheKey = function () { return 'meadow-plants-wind'; };

    sceneRef.add(worldGroup);
    for (let i = 0; i < chunkOffsets.length; i++) {
      buildChunk(chunkOffsets[i][0], chunkOffsets[i][1]);
    }
  }

  function update(player, dt, t) {
    updateChunks(player);
    updateDebris(dt);
    wind.value = t;
  }

  M.world = {
    init: init,
    update: update,
    surfaceHeight: surfaceHeight,
    blockedAt: blockedAt,
    supportHeight: supportHeight,
    landingHeight: landingHeight,
    breakBlockInFront: breakBlockInFront,
    breakBlockBelow: breakBlockBelow,
    placeBlock: placeBlock,
    blockIcon: blockIcon,
    makeBlockMesh: makeBlockMesh,
    blockSize: BLOCK
  };
})(window.Meadow = window.Meadow || {});
