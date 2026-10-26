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
  let waterMat = null;
  const wind = { value: 0 };
  const waterTime = { value: 0 };


  // ------------------------------------------------------------------ world
  const BLOCK = 2;
  const CHUNK_BLOCKS = 16;
  const CHUNK_SIZE = CHUNK_BLOCKS * BLOCK;
  const RENDER_RADIUS = M.config.renderRadius;
  const WORLD_SEED = 1337;
  const START = M.config.startingArea;

  function clearingDistance(bx, bz) {
    return Math.hypot(bx + 0.5 - START.x / BLOCK, bz + 0.5 - START.z / BLOCK);
  }

  // Include cells touching the circular perimeter so no corner of the
  // buildable meadow hides a height change, rock or water column.
  function isStartingClearing(bx, bz) {
    return clearingDistance(bx, bz) <= START.radiusBlocks + Math.SQRT1_2;
  }

  // Ponds are seeded on a 64-block lattice, with shallow banks and a deeper
  // swimming basin. Rivers and seas share one waterline, including estuaries.
  // A nearby pond sits beyond the western edge of the starting clearing.
  const POND_CELL = 64;
  const POND_PAD = 14;
  const POND_DENSITY = 0.58;
  const POND_MIN_RADIUS = 8;
  const POND_MAX_RADIUS = 13;
  const POND_SEED = 0x51a7c0de;
  const POND_WATER_GAP = 0.55;
  const POND_EDGE = 1.08;
  const POND_INNER = 0.70;
  const STARTER_PONDS = [
    { id: 'pond-starter', cx: -27, cz: 3, r: 10, phase: 0.8, rimBlock: 7 }
  ];

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

  function rawHeightBlocks(bx, bz) {
    const n1 = valueNoise(bx * 0.045 + 11.3, bz * 0.045 - 7.1);
    const n2 = valueNoise(bx * 0.13 - 31.7, bz * 0.13 + 18.4);
    const n3 = valueNoise(bx * 0.31 + 101.2, bz * 0.31 - 73.5);
    // Keep enough terrain below the sea floor for a real, editable bed.
    return Math.max(3, Math.floor(4.0 + n1 * 4.2 + n2 * 0.7 + n3 * 0.2));
  }

  const WATER_RIM = 7;
  const SEA_LEVEL = WATER_RIM * BLOCK - POND_WATER_GAP;
  const SEA_PLAN = { id: 'sea', type: 'sea', waterLevel: SEA_LEVEL };
  const RIVER_PLAN = { id: 'river', type: 'river', waterLevel: SEA_LEVEL };

  // Absolute block coordinates, never chunk-local randomness: channels stay
  // continuous across chunk seams, negative coordinates and streaming reloads.
  function regionalWaterAt(bx, bz) {
    const ocean = M.config.ocean;
    const extent = Math.max(Math.abs(bx * BLOCK - START.x), Math.abs(bz * BLOCK - START.z));
    if (extent >= ocean.boundary) return { plan: SEA_PLAN, height: 1 };
    let result = null;
    if (extent >= ocean.boundary - ocean.shoreWidth) {
      // Slope the outer shore down, preserving deeper rivers/estuaries below.
      // Beyond the boundary there are no continents, islands or raised pond bowls.
      const shelf = clamp((extent - ocean.boundary + ocean.shoreWidth) / ocean.shoreWidth, 0, 1);
      result = { plan: SEA_PLAN, height: Math.max(1, Math.round(WATER_RIM - shelf * 6)) };
    }
    // Leave forest and room to build around both outer gate sites. The outer
    // ocean already bounds the island, so no repeating continents are needed.
    const coast = 132 + Math.sin(bz * 0.016) * 19 + Math.sin(bz * 0.041 + 0.8) * 8;
    const offshore = Math.abs(bx - START.x / BLOCK) - coast;
    const riverZ = 28 + Math.sin(bx * 0.028) * 10 + Math.sin(bx * 0.011) * 8;
    const channelZ = bz - riverZ;
    const riverDistance = Math.abs(channelZ - Math.round(channelZ / 180) * 180);
    const width = 4.5 + Math.sin(bx * 0.037 + 1.4) * 1.2;
    if (offshore > -9) {
      // Broad terraces form beaches, a shallow shelf, then a 10m+ sea bed.
      const height = Math.max(1, Math.round(WATER_RIM - (offshore + 9) * 0.19));
      if (!result || height < result.height) result = { plan: SEA_PLAN, height: height };
    }
    if (riverDistance < width + 4) {
      const bank = clamp((riverDistance - width * 0.45) / (width * 0.55 + 4), 0, 1);
      // A narrow bend can otherwise round its last bank cell down to six
      // blocks beside low, dry terrain, leaking the river across the forest.
      // Keep a continuous dry rim, wide enough for diagonal voxel steps too.
      const height = riverDistance >= width + 2.5 ? WATER_RIM : Math.round(4 + bank * 3);
      if (!result || height < result.height) result = { plan: RIVER_PLAN, height: height };
    }
    return result;
  }

  const pondPlanCache = new Map();
  let starterPondPlans = null;

  function makePondPlan(cx, cz, r, id, phase, seed, starter, rimOverride) {
    // The waterline sits below the lowest raw rim block, so it normally
    // cannot spill over the surrounding meadow. A starter pond may explicitly
    // raise the rim one block to sit on a visible terrace; the radial bank
    // shaping below keeps even that basin enclosed.
    let rimBlock = 99;
    for (let i = 0; i < 32; i++) {
      const angle = i / 32 * Math.PI * 2;
      const bx = Math.floor(cx + Math.cos(angle) * r * 1.02);
      const bz = Math.floor(cz + Math.sin(angle) * r * 1.02);
      rimBlock = Math.min(rimBlock, rawHeightBlocks(bx, bz));
    }
    rimBlock = Math.max(5, rimBlock);
    if (rimOverride) rimBlock = Math.max(rimBlock, rimOverride);
    const floorBlock = Math.max(1, rimBlock - 2);
    return {
      type: 'pond',
      id: id,
      cx: cx,
      cz: cz,
      r: r,
      phase: phase,
      seed: seed,
      starter: !!starter,
      rimBlock: rimBlock,
      floorBlock: floorBlock,
      waterLevel: rimBlock * BLOCK - POND_WATER_GAP
    };
  }

  function getStarterPondPlans() {
    if (starterPondPlans) return starterPondPlans;
    starterPondPlans = STARTER_PONDS.map(function (spec) {
      return makePondPlan(spec.cx, spec.cz, spec.r, spec.id, spec.phase, 0x51a7c0de, true, spec.rimBlock);
    });
    return starterPondPlans;
  }

  function pondPlanForCell(gx, gz) {
    const key = gx + ',' + gz;
    if (pondPlanCache.has(key)) return pondPlanCache.get(key);

    const rnd = mulberry32(hashInt(gx, gz, POND_SEED));
    let plan = null;
    if (rnd() <= POND_DENSITY) {
      const cx = gx * POND_CELL + POND_PAD + rnd() * (POND_CELL - POND_PAD * 2);
      const cz = gz * POND_CELL + POND_PAD + rnd() * (POND_CELL - POND_PAD * 2);
      const r = POND_MIN_RADIUS + rnd() * (POND_MAX_RADIUS - POND_MIN_RADIUS);
      const phase = rnd() * Math.PI * 2;
      const seed = hashInt(gx, gz, POND_SEED ^ 0x9e3779b9);
      const clearOfSpawn = Math.hypot(cx - START.x / BLOCK, cz - START.z / BLOCK) >=
        START.radiusBlocks + Math.SQRT1_2 + r * 1.18 + 2;
      let clearOfStarter = true;
      const starters = getStarterPondPlans();
      for (let i = 0; i < starters.length; i++) {
        if (Math.hypot(cx - starters[i].cx, cz - starters[i].cz) < r + starters[i].r + 4) {
          clearOfStarter = false;
          break;
        }
      }
      // Keep elevated pond bowls away from rivers/coasts: no mismatched
      // water levels or raised circular islands cutting a channel in two.
      let clearOfRegionalWater = !regionalWaterAt(cx, cz);
      for (let i = 0; i < 12 && clearOfRegionalWater; i++) {
        const angle = i / 12 * Math.PI * 2;
        clearOfRegionalWater = !regionalWaterAt(cx + Math.cos(angle) * (r + 4), cz + Math.sin(angle) * (r + 4));
      }
      if (clearOfSpawn && clearOfStarter && clearOfRegionalWater) {
        plan = makePondPlan(cx, cz, r, 'pond-' + gx + ',' + gz, phase, seed, false);
      }
    }

    if (pondPlanCache.size >= 1024) pondPlanCache.delete(pondPlanCache.keys().next().value);
    pondPlanCache.set(key, plan);
    return plan;
  }

  function pondShape(plan, bx, bz) {
    const dx = bx + 0.5 - plan.cx;
    const dz = bz + 0.5 - plan.cz;
    const angle = Math.atan2(dz, dx);
    const limit = plan.r * (
      1 +
      Math.sin(angle * 3 + plan.phase) * 0.06 +
      Math.sin(angle * 5 - plan.phase * 0.7) * 0.025
    );
    const dist = Math.hypot(dx, dz);
    return { dist: dist, limit: limit, score: dist / limit };
  }

  function pondInfluenceAtBlock(bx, bz) {
    const gx = Math.floor(bx / POND_CELL);
    const gz = Math.floor(bz / POND_CELL);
    let best = null;

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const plan = pondPlanForCell(gx + dx, gz + dz);
        if (!plan) continue;
        const shape = pondShape(plan, bx, bz);
        if (shape.dist > shape.limit * POND_EDGE) continue;
        if (!best || shape.score < best.score) {
          best = {
            plan: plan,
            dist: shape.dist,
            limit: shape.limit,
            score: shape.score
          };
        }
      }
    }

    const starters = getStarterPondPlans();
    for (let i = 0; i < starters.length; i++) {
      const plan = starters[i];
      const shape = pondShape(plan, bx, bz);
      if (shape.dist > shape.limit * POND_EDGE) continue;
      if (!best || shape.score < best.score) {
        best = {
          plan: plan,
          dist: shape.dist,
          limit: shape.limit,
          score: shape.score
        };
      }
    }
    return best;
  }

  function pondHeightAt(bx, bz, base, info) {
    const inner = info.limit * POND_INNER;
    const outer = info.limit * POND_EDGE;
    const floor = info.plan.floorBlock;
    if (info.dist <= inner) return floor;

    // Outside the water the bank rises back to the meadow, and to the pond's
    // rim block where the original ground was lower. This keeps every pond
    // from leaking across its shoreline.
    const bank = Math.max(base, info.plan.rimBlock);
    const t = clamp((info.dist - inner) / (outer - inner), 0, 1);
    const smooth = t * t * (3 - 2 * t);
    return Math.max(0, Math.round(floor + (bank - floor) * smooth));
  }

  // Cache immutable generation only; block edits are always read live below.
  // Bound the cache so walking through the endless world cannot grow it forever.
  const columnCache = new Map();
  function generatedColumn(bx, bz) {
    const key = bx + ',' + bz;
    if (columnCache.has(key)) return columnCache.get(key);
    let column;
    if (isStartingClearing(bx, bz)) {
      column = { height: START.heightBlocks, plan: null };
    } else {
      const base = rawHeightBlocks(bx, bz);
      const regional = regionalWaterAt(bx + 0.5, bz + 0.5);
      const pond = regional ? null : pondInfluenceAtBlock(bx, bz);
      const natural = regional ? regional.height : pond ? pondHeightAt(bx, bz, base, pond) : base;
      const edge = START.radiusBlocks + Math.SQRT1_2;
      const t = clamp((clearingDistance(bx, bz) - edge) / START.transitionBlocks, 0, 1);
      const blend = t * t * (3 - 2 * t);
      column = {
        height: Math.round(START.heightBlocks + (natural - START.heightBlocks) * blend),
        plan: regional ? regional.plan : pond ? pond.plan : null
      };
    }
    column.cave = M.caves.profile(bx, bz, column.height, !!column.plan, isStartingClearing(bx, bz));
    if (columnCache.size >= 65536) columnCache.delete(columnCache.keys().next().value);
    columnCache.set(key, column);
    return column;
  }

  function heightBlocks(bx, bz) {
    return generatedColumn(bx, bz).height;
  }

  const dirtyWaterChunks = new Set();
  const dirtyTerrainChunks = new Set(), dirtyPropChunks = new Set();
  const waterSpanCache = new Map();
  const fluid = M.voxelWater.create({
    source: naturalWaterCell,
    blocked: function (bx, by, bz) {
      return !!solidKindAt(bx, by, bz) || !!(M.hearthTree && M.hearthTree.intersectsBlock(bx, by, bz));
    },
    active: function (bx, bz) { return !!chunkForBlock(bx, bz); },
    changed: function (bx, by, bz) { markWaterDirty(bx, bz); }
  });

  function naturalWaterCell(bx, by, bz) {
    const column = generatedColumn(bx, bz);
    if (!column.plan || by < column.height || by * BLOCK >= column.plan.waterLevel) return null;
    if (!column.waterCells) column.waterCells = [];
    if (!column.waterCells[by]) column.waterCells[by] = {
      fill: Math.min(1, column.plan.waterLevel / BLOCK - by), source: true, plan: column.plan
    };
    return column.waterCells[by];
  }

  // Separate spans allow water below bridges and in mined tunnels. Solid
  // blocks displace water immediately; only the opened space fills on ticks.
  function waterSpansAtBlock(bx, bz) {
    const id = bx + ',' + bz;
    if (waterSpanCache.has(id)) return waterSpanCache.get(id);
    const column = generatedColumn(bx, bz);
    let highest = column.plan ? Math.ceil(column.plan.waterLevel / BLOCK) - 1 : -1;
    const heights = fluid.heights(bx, bz);
    if (heights) heights.forEach(function (y) { highest = Math.max(highest, y); });
    const spans = [];
    let span = null;
    for (let by = 0; by <= highest; by++) {
      const cell = fluid.get(bx, by, bz);
      if (!cell) { span = null; continue; }
      const bottom = by * BLOCK, level = bottom + cell.fill * BLOCK;
      if (span && Math.abs(span.level - bottom) < 0.002) {
        span.level = level; span.depth = level - span.top;
      } else {
        const plan = cell.plan || column.plan;
        span = { plan: plan, type: plan ? plan.type : 'flow', level: level,
          top: bottom, depth: level - bottom, bx: bx, bz: bz, flowing: !cell.source };
        spans.push(span);
      }
    }
    if (waterSpanCache.size >= 65536) waterSpanCache.delete(waterSpanCache.keys().next().value);
    waterSpanCache.set(id, spans);
    return spans;
  }

  function waterInfoAtBlock(bx, bz, feetY) {
    const spans = waterSpansAtBlock(bx, bz);
    for (let i = spans.length - 1; i >= 0; i--) {
      if (feetY === undefined || (feetY >= spans[i].top - 0.1 && feetY < spans[i].level)) return spans[i];
    }
    return null;
  }

  function markWaterDirty(bx, bz) {
    waterSpanCache.delete(bx + ',' + bz);
    const cx = Math.floor(bx / CHUNK_BLOCKS), cz = Math.floor(bz / CHUNK_BLOCKS);
    dirtyWaterChunks.add(cx + ',' + cz);
    if (bx % CHUNK_BLOCKS === 0) dirtyWaterChunks.add((cx - 1) + ',' + cz);
    if ((bx + 1) % CHUNK_BLOCKS === 0) dirtyWaterChunks.add((cx + 1) + ',' + cz);
    if (bz % CHUNK_BLOCKS === 0) dirtyWaterChunks.add(cx + ',' + (cz - 1));
    if ((bz + 1) % CHUNK_BLOCKS === 0) dirtyWaterChunks.add(cx + ',' + (cz + 1));
  }

  function wakeWater(bx, by, bz) {
    fluid.wake(bx, by, bz);
    markWaterDirty(bx, bz);
  }

  function activateChunkWater(cx, cz) {
    for (let z = cz * CHUNK_BLOCKS; z < (cz + 1) * CHUNK_BLOCKS; z++) {
      for (let x = cx * CHUNK_BLOCKS; x < (cx + 1) * CHUNK_BLOCKS; x++) {
        const column = generatedColumn(x, z);
        const heights = fluid.heights(x, z);
        if (heights) heights.forEach(function (y) { fluid.wake(x, y, z); });
        // Only shorelines and chunk seams need waking, not every sea cell.
        const max = column.plan ? Math.ceil(column.plan.waterLevel / BLOCK) - 1 : -1;
        for (let y = column.height; y <= max; y++) {
          if (!fluid.get(x, y, z)) continue;
          const neighbours = [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]];
          for (let i = 0; i < 4; i++) {
            const n = neighbours[i];
            if (!naturalWaterCell(n[0], y, n[1]) && !solidKindAt(n[0], y, n[1])) fluid.enqueue(n[0], y, n[1]);
          }
        }
        if (x % CHUNK_BLOCKS === 0 || (x + 1) % CHUNK_BLOCKS === 0 ||
            z % CHUNK_BLOCKS === 0 || (z + 1) % CHUNK_BLOCKS === 0) {
          const neighbours = [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]];
          for (let y = 0; y <= Math.max(max, 7); y++) {
            if (solidKindAt(x, y, z) || fluid.get(x, y, z)) continue;
            if (neighbours.some(function (n) { return !!fluid.get(n[0], y, n[1]); })) fluid.wake(x, y, z);
          }
        }
      }
    }
  }

  function isWaterColumn(bx, bz) {
    return !!waterInfoAtBlock(bx, bz);
  }

  // Also protects river banks and coasts from trees and herd construction.
  function isPondArea(bx, bz) {
    return !!generatedColumn(bx, bz).plan;
  }

  function isProtectedArea(bx, bz) {
    return !!(M.hearthTree && M.hearthTree.isReserved((bx + 0.5) * BLOCK, (bz + 0.5) * BLOCK, BLOCK * 0.71));
  }

  function waterAt(x, y, z) {
    const info = waterInfoAtBlock(Math.floor(x / BLOCK), Math.floor(z / BLOCK), y);
    return info && y >= info.top && y < info.level ? info : null;
  }

  function waterDepthAt(x, z) {
    const info = waterInfoAtBlock(Math.floor(x / BLOCK), Math.floor(z / BLOCK));
    return info ? info.depth : 0;
  }

  function waterLevelAt(x, z) {
    const info = waterInfoAtBlock(Math.floor(x / BLOCK), Math.floor(z / BLOCK));
    return info ? info.level : 0;
  }

  // Pond plans in the neighbourhood of a world-space point. Fish use this to
  // generate and cull their shoals without depending on chunk streaming.
  function pondsNear(x, z, radius) {
    const reach = Math.max(0, radius || 0);
    const bx0 = Math.floor((x - reach) / BLOCK);
    const bx1 = Math.floor((x + reach) / BLOCK);
    const bz0 = Math.floor((z - reach) / BLOCK);
    const bz1 = Math.floor((z + reach) / BLOCK);
    const gx0 = Math.floor(bx0 / POND_CELL) - 1;
    const gx1 = Math.floor(bx1 / POND_CELL) + 1;
    const gz0 = Math.floor(bz0 / POND_CELL) - 1;
    const gz1 = Math.floor(bz1 / POND_CELL) + 1;
    const found = new Map();

    function consider(plan) {
      if (!plan || found.has(plan.id)) return;
      const wx = plan.cx * BLOCK;
      const wz = plan.cz * BLOCK;
      const dist = Math.hypot(wx - x, wz - z);
      if (dist > reach + plan.r * BLOCK * 0.8) return;
      found.set(plan.id, {
        id: plan.id,
        cx: plan.cx,
        cz: plan.cz,
        x: wx,
        z: wz,
        r: plan.r,
        phase: plan.phase,
        seed: plan.seed,
        starter: plan.starter,
        rimBlock: plan.rimBlock,
        floorBlock: plan.floorBlock,
        waterLevel: plan.waterLevel,
        waterRadius: plan.r * BLOCK * 0.72,
        distance: dist
      });
    }

    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        consider(pondPlanForCell(gx, gz));
      }
    }
    const starters = getStarterPondPlans();
    for (let i = 0; i < starters.length; i++) consider(starters[i]);

    return Array.from(found.values()).sort(function (a, b) {
      return a.distance - b.distance;
    });
  }

  const removedBlocks = new Set();
  const removedPropBlocks = new Set();
  const placedBlocks = new Map(), placedByChunk = new Map();
  let revision = 0;
  const navigationChanges = [];
  function recordChange(bx, bz) {
    revision++;
    navigationChanges.push({ revision: revision, bx: bx, bz: bz });
    if (navigationChanges.length > 256) navigationChanges.shift();
  }
  function navigationChangesSince(since) {
    if (since === revision) return [];
    if (!navigationChanges.length || since < navigationChanges[0].revision - 1) return null;
    return navigationChanges.filter(function (change) { return change.revision > since; });
  }

  function blockKey(bx, by, bz) {
    return bx + ',' + by + ',' + bz;
  }

  function isRemoved(bx, by, bz) {
    return removedBlocks.size > 0 && removedBlocks.has(blockKey(bx, by, bz));
  }

  function topSolidY(bx, bz) {
    let y = heightBlocks(bx, bz) - 1;
    while (y >= 0 && !isSolidBlock(bx, y, bz)) y--;
    return y;
  }

  function surfaceHeight(x, z) {
    const y = topSolidY(Math.floor(x / BLOCK), Math.floor(z / BLOCK));
    return Math.max(0, (y + 1) * BLOCK);
  }

  function isSolidBlock(bx, by, bz) {
    if (by < 0) return false;
    const column = generatedColumn(bx, bz);
    if (by >= column.height) return false;
    const cave = column.cave;
    return !(cave && by >= cave.floor && by < cave.roof) && !isRemoved(bx, by, bz);
  }

  function chunkForBlock(bx, bz) {
    return chunks.get(Math.floor(bx / CHUNK_BLOCKS) + ',' + Math.floor(bz / CHUNK_BLOCKS)) || null;
  }

  const permanentBlocks = new Map(), permanentChunks = new Set();
  function addPermanentBlocks(cells, kind, clearance) {
    const affected = new Set(), waterColumns = new Set();
    (clearance || []).forEach(function (cell) {
      if (cell.excavate && isSolidBlock(cell.bx, cell.by, cell.bz)) {
        removedBlocks.add(blockKey(cell.bx, cell.by, cell.bz));
        affected.add(Math.floor(cell.bx / CHUNK_BLOCKS) + ',' + Math.floor(cell.bz / CHUNK_BLOCKS));
        recordChange(cell.bx, cell.bz);
        waterColumns.add(cell.bx + ',' + cell.bz);
      }
      const info = blockInfoAt(cell.bx, cell.by, cell.bz);
      if (!info || info.type !== 'prop') return;
      removePropBlock(cell.bx, cell.by, cell.bz);
      dirtyPropChunks.add(Math.floor(cell.bx / CHUNK_BLOCKS) + ',' + Math.floor(cell.bz / CHUNK_BLOCKS));
    });
    cells.forEach(function (cell) {
      const id = Math.floor(cell.bx / CHUNK_BLOCKS) + ',' + Math.floor(cell.bz / CHUNK_BLOCKS);
      affected.add(id); permanentChunks.add(id);
      permanentBlocks.set(blockKey(cell.bx, cell.by, cell.bz), cell.kind || kind);
      recordChange(cell.bx, cell.bz);
      waterColumns.add(cell.bx + ',' + cell.bz);
    });
    waterColumns.forEach(function (id) {
      const [bx, bz] = id.split(',').map(Number);
      markWaterDirty(bx, bz);
    });
    // Terrain yields ownership of these voxels to permanent paving/plinths. Rebuild
    // before the first draw so no coplanar soil caps can flicker through it.
    affected.forEach(function (id) {
      const [cx, cz] = id.split(',').map(Number);
      dirtyPropChunks.delete(id);
      rebuildChunkTerrain(cx, cz);
    });
  }

  // Objective structures own their collision until their combat controller
  // destroys them. Mining still cannot remove permanent roads or plinths.
  function removePermanentBlocks(cells) {
    cells.forEach(function (cell) {
      if (permanentBlocks.delete(blockKey(cell.bx, cell.by, cell.bz))) recordChange(cell.bx, cell.bz);
    });
  }

  function propKindAt(bx, by, bz) {
    if (by < 0) return null;
    const permanent = permanentBlocks.get(blockKey(bx, by, bz));
    if (permanent) return permanent;
    const placed = placedBlocks.get(blockKey(bx, by, bz));
    if (placed) return placed;
    const ch = chunkForBlock(bx, bz);
    if (!ch || !ch.propBlocks) return null;
    return ch.propBlocks.get(blockKey(bx, by, bz)) || null;
  }

  function solidKindAt(bx, by, bz) {
    return propKindAt(bx, by, bz) || (isSolidBlock(bx, by, bz) ? 'terrain' : null);
  }

  // Detailed block lookup used by the herd's construction AI. Player-placed
  // props are distinguished from natural ones so animals never quarry or
  // dismantle something the player built.
  function blockInfoAt(bx, by, bz) {
    if (!Number.isInteger(bx) || !Number.isInteger(by) || !Number.isInteger(bz) || by < 0) return null;
    const key = blockKey(bx, by, bz);
    const prop = propKindAt(bx, by, bz);
    if (prop) {
      const placed = placedBlocks.has(key);
      return { bx: bx, by: by, bz: bz, kind: prop, type: permanentBlocks.has(key) ? (prop === 'roadstone' ? 'road' : 'gate') : placed ? 'placed' : 'prop', placed: placed, unbreakable: permanentBlocks.has(key) };
    }
    if (!isSolidBlock(bx, by, bz)) return null;
    return {
      bx: bx,
      by: by,
      bz: bz,
      kind: M.caves.material(bx, by, bz, heightBlocks(bx, bz)),
      type: 'terrain',
      placed: false
    };
  }

  // The highest natural soil block in a column. Props and player blocks above
  // it are intentionally ignored; callers can test the cell above before
  // quarrying so they do not mine underneath a tree or a build.
  function topSoilInfo(bx, bz) {
    if (isProtectedArea(bx, bz) || isStartingClearing(bx, bz)) return null;
    const by = topSolidY(bx, bz);
    if (by < 0 || permanentBlocks.has(blockKey(bx, by, bz)) || permanentBlocks.has(blockKey(bx, by + 1, bz))) return null;
    return {
      bx: bx,
      by: by,
      bz: bz,
      kind: M.caves.material(bx, by, bz, heightBlocks(bx, bz)),
      top: (by + 1) * BLOCK
    };
  }

  function isPlacedBlock(bx, by, bz) {
    return placedBlocks.has(blockKey(bx, by, bz));
  }

  // Collision uses actual occupied cells, including cavities below terrain.
  function blockedAt(x, z, minY, maxY) {
    return !!navigationBlockedAt(x, z, minY, maxY);
  }

  // A ceiling is never a floor. Search only below the actor's swept feet.
  function supportHeight(x, z, maxY) {
    return landingHeight(x, z, maxY);
  }

  function landingHeight(x, z, maxY, includeTree) {
    const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK);
    const treeTop = includeTree !== false && M.hearthTree ? M.hearthTree.supportHeight(x, z, maxY) : 0;
    const landmarkTop = treeTop > 0 ? treeTop : -Infinity;
    for (let by = Math.floor((maxY + 0.001) / BLOCK) - 1; by >= 0; by--) {
      if (solidKindAt(bx, by, bz)) return Math.max(landmarkTop, (by + 1) * BLOCK);
    }
    return landmarkTop;
  }

  // Shared exact voxel collision for actors, navigation and the camera.
  function navigationBlockedAt(x, z, minY, maxY, includeTree) {
    const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK);
    const first = Math.floor((minY + 0.001) / BLOCK);
    const last = Math.floor((maxY - 0.001) / BLOCK);
    for (let by = first; by <= last; by++) {
      if (solidKindAt(bx, by, bz)) return true;
    }
    return includeTree !== false && M.hearthTree && M.hearthTree.blockedAt(x, z, minY, maxY);
  }

  // Half-open bounds: touching a block face or corner is not penetration.
  // Iterate occupied voxels instead of inflating the box with nose probes.
  function bodyBlockedAt(x, z, minY, maxY, radius, includeTree, excavated) {
    const epsilon = 0.00001;
    const x0 = Math.floor((x - radius + epsilon) / BLOCK), x1 = Math.floor((x + radius - epsilon) / BLOCK);
    const z0 = Math.floor((z - radius + epsilon) / BLOCK), z1 = Math.floor((z + radius - epsilon) / BLOCK);
    const y0 = Math.floor((minY + epsilon) / BLOCK), y1 = Math.floor((maxY - epsilon) / BLOCK);
    for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) for (let by = y0; by <= y1; by++) {
      if (solidKindAt(bx, by, bz) && (!excavated || !excavated.has(blockKey(bx, by, bz)))) return true;
    }
    return includeTree !== false && !!(M.hearthTree && M.hearthTree.intersectsBox(x, z, radius, minY, maxY));
  }

  function bodySupportHeight(x, z, maxY, radius) {
    const epsilon = 0.00001;
    const x0 = Math.floor((x - radius + epsilon) / BLOCK), x1 = Math.floor((x + radius - epsilon) / BLOCK);
    const z0 = Math.floor((z - radius + epsilon) / BLOCK), z1 = Math.floor((z + radius - epsilon) / BLOCK);
    let floor = -Infinity;
    for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) {
      floor = Math.max(floor, landingHeight((bx + 0.5) * BLOCK, (bz + 0.5) * BLOCK, maxY, false));
    }
    if (M.hearthTree) {
      const treeTop = M.hearthTree.boxSupportHeight(x, z, radius, maxY);
      if (treeTop > 0) floor = Math.max(floor, treeTop);
    }
    return floor;
  }

  function navigationSurfaces(bx, bz) {
    const floors = [];
    const ground = heightBlocks(bx, bz) * BLOCK;
    // Includes placed walls, natural props and any exposed floors in tunnels.
    for (let by = 0; by <= ground / BLOCK + 16; by++) {
      if (solidKindAt(bx, by, bz) && !solidKindAt(bx, by + 1, bz)) floors.push((by + 1) * BLOCK);
    }
    if (M.hearthTree) {
      const x = (bx + 0.5) * BLOCK, z = (bz + 0.5) * BLOCK;
      for (let y = ground; y <= ground + 6; y += 0.5) {
        const top = M.hearthTree.supportHeight(x, z, y);
        if (top > 0 && floors.indexOf(top) < 0) floors.push(top);
      }
    }
    return floors;
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
  const T_COAL = 7, T_COPPER = 8, T_IRON = 9;

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

    [[T_COAL, '#303735', '#4b514c'], [T_COPPER, '#c07c45', '#68a393'], [T_IRON, '#d5b59a', '#a68066']].forEach(function (ore) {
      const tile = begin(ore[0], '#858882');
      speckle(tile.x, tile.y, ['#747b75', '#9ba095', '#6f766e'], 65);
      [[3, 4], [10, 3], [7, 10], [12, 12]].forEach(function (p, i) {
        ctx.fillStyle = ore[1]; ctx.fillRect(tile.x + p[0], tile.y + p[1], 3, 3);
        ctx.fillStyle = ore[2]; ctx.fillRect(tile.x + p[0], tile.y + p[1], 2, 1 + i % 2);
      });
    });

    // copy tile edges into the padding so distant mipmaps stay clean
    for (let i = 0; i <= 9; i++) {
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

  // ---- water surfaces ----
  // Water is built from the same coarse block columns as the terrain. A top
  // quad covers every flooded cell and thin side quads close the volume at
  // the shoreline, so the pond reads as water with depth rather than a blue
  // decal floating over a hole.
  function pushWaterTop(data, x, y, z, shade) {
    pushQuad(
      data,
      [[x, y, z], [x, y, z + BLOCK], [x + BLOCK, y, z + BLOCK], [x + BLOCK, y, z]],
      [0, 1, 0],
      [[0, 0], [1, 0], [1, 1], [0, 1]],
      shade
    );
  }

  function pushWaterSide(data, dir, x, z, y0, y1, shade) {
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    if (dir === 0) {
      pushQuad(data, [[x, y0, z], [x, y0, z + BLOCK], [x, y1, z + BLOCK], [x, y1, z]], [-1, 0, 0], uvs, shade);
    } else if (dir === 1) {
      pushQuad(data, [[x + BLOCK, y0, z + BLOCK], [x + BLOCK, y0, z], [x + BLOCK, y1, z], [x + BLOCK, y1, z + BLOCK]], [1, 0, 0], uvs, shade);
    } else if (dir === 2) {
      pushQuad(data, [[x + BLOCK, y0, z], [x, y0, z], [x, y1, z], [x + BLOCK, y1, z]], [0, 0, -1], uvs, shade);
    } else {
      pushQuad(data, [[x, y0, z + BLOCK], [x + BLOCK, y0, z + BLOCK], [x + BLOCK, y1, z + BLOCK], [x, y1, z + BLOCK]], [0, 0, 1], uvs, shade);
    }
  }

  function buildWaterGeometry(cx, cz) {
    const data = { pos: [], nor: [], uv: [], col: [], idx: [] };
    for (let bz = 0; bz < CHUNK_BLOCKS; bz++) {
      for (let bx = 0; bx < CHUNK_BLOCKS; bx++) {
        const wx = cx * CHUNK_BLOCKS + bx, wz = cz * CHUNK_BLOCKS + bz;
        const spans = waterSpansAtBlock(wx, wz);
        for (let i = 0; i < spans.length; i++) {
          const water = spans[i], x = bx * BLOCK, z = bz * BLOCK;
          const shade = 0.97 - clamp(water.depth / 12, 0, 1) * 0.2 + hash01(wx, wz) * 0.035;
          if (!solidKindAt(wx, Math.floor((water.level + 0.001) / BLOCK), wz)) pushWaterTop(data, x, water.level, z, shade);
          const neighbours = [[wx - 1, wz], [wx + 1, wz], [wx, wz - 1], [wx, wz + 1]];
          for (let by = Math.floor(water.top / BLOCK); by * BLOCK < water.level; by++) {
            const bottom = by * BLOCK, top = Math.min(water.level, bottom + BLOCK);
            for (let dir = 0; dir < 4; dir++) {
              const n = neighbours[dir];
              if (solidKindAt(n[0], by, n[1])) continue;
              const other = fluid.get(n[0], by, n[1]);
              const low = other ? Math.max(bottom, bottom + other.fill * BLOCK) : bottom;
              if (top > low + 0.002) pushWaterSide(data, dir, x, z, low, top, shade * 0.78);
            }
          }
        }
      }
    }
    return data.idx.length ? dataToGeometry(data, false) : null;
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
    coal: { top: T_COAL, side: T_COAL, bottom: T_COAL },
    copper: { top: T_COPPER, side: T_COPPER, bottom: T_COPPER },
    iron: { top: T_IRON, side: T_IRON, bottom: T_IRON },
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
    if (M.towers && M.towers.itemDefinition(kind)) {
      const def = M.towers.itemDefinition(kind);
      return 'assets/towers/' + (def.baseId || def.id) + '.png';
    }
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
    if (M.towers && M.towers.itemDefinition(kind)) {
      const tower = M.towers.model(M.towers.itemDefinition(kind).id);
      tower.scale.setScalar(1 / M.towers.itemDefinition(kind).height);
      return tower;
    }
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
    const occupied = (x, y, z) => isSolidBlock(x, y, z) || permanentBlocks.has(blockKey(x, y, z));
    const data = { pos: [], nor: [], uv: [], col: [], idx: [] };
    const originBX = cx * CHUNK_BLOCKS, originBZ = cz * CHUNK_BLOCKS;
    for (let bz = 0; bz < CHUNK_BLOCKS; bz++) for (let bx = 0; bx < CHUNK_BLOCKS; bx++) {
      const wx = originBX + bx, wz = originBZ + bz, h = heightBlocks(wx, wz);
      const water = waterInfoAtBlock(wx, wz), level = water ? water.level : -1;
      for (let by = 0; by < h; by++) {
        if (!isSolidBlock(wx, by, wz) || permanentBlocks.has(blockKey(wx, by, wz))) continue;
        const x = bx * BLOCK, y = by * BLOCK, z = bz * BLOCK;
        const kind = M.caves.material(wx, by, wz, h), tiles = ITEM_TILES[kind];
        const grassy = kind === 'grass' && level <= y + .02;
        const top = kind === 'grass' ? grassy ? T_GRASS : T_DIRT : tiles.top;
        const side = kind === 'grass' ? grassy ? T_GRASS_SIDE : T_DIRT : tiles.side;
        const shade = (grassy ? .95 : .86) + hash01(wx, wz) * .05;
        if (!occupied(wx, by + 1, wz)) pushTop(data, x, y + BLOCK, z, top, shade);
        if (!occupied(wx, by - 1, wz)) pushBottom(data, x, y, z, tiles.bottom, shade * .7);
        if (!occupied(wx - 1, by, wz)) pushSide(data, 0, x, z, y, y + BLOCK, side, shade * .72);
        if (!occupied(wx + 1, by, wz)) pushSide(data, 1, x, z, y, y + BLOCK, side, shade * .72);
        if (!occupied(wx, by, wz - 1)) pushSide(data, 2, x, z, y, y + BLOCK, side, shade * .7);
        if (!occupied(wx, by, wz + 1)) pushSide(data, 3, x, z, y, y + BLOCK, side, shade * .7);
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
    const blocks = new Map(), faces = new Map();
    const rnd = mulberry32(hashInt(cx, cz, 0x51ed270b));
    const trees = [];

    function addBlock(x, y, z, topTile, sideTile, bottomTile, shadeTop, shadeSide, kind, force) {
      const bx = cx * CHUNK_BLOCKS + Math.round(x / BLOCK);
      const bz = cz * CHUNK_BLOCKS + Math.round(z / BLOCK);
      const by = Math.round(y / BLOCK);
      const key = blockKey(bx, by, bz);
      if (!force && (permanentBlocks.has(key) || M.hellGates && M.hellGates.isCleared(bx, by, bz))) return;
      if (!force && (removedPropBlocks.has(key) || isStartingClearing(bx, bz) || M.caves.entranceClearance(bx, bz))) return;
      blocks.set(key, kind);
      faces.set(key, { bx: bx, by: by, bz: bz, x: x, y: y, z: z,
        top: topTile, side: sideTile, bottom: bottomTile, shadeTop: shadeTop, shadeSide: shadeSide });
    }

    let treeCount = rnd() < 0.72 ? 1 : 0;
    if (rnd() < 0.18) treeCount++;
    // A denser woodland borders the open meadow; farther out the original
    // seeded wilderness continues indefinitely.
    const chunkDistance = clearingDistance(cx * CHUNK_BLOCKS + 7.5, cz * CHUNK_BLOCKS + 7.5);
    if (chunkDistance > START.radiusBlocks - 10 && chunkDistance < START.radiusBlocks + 32) {
      treeCount = 3 + Math.floor(rnd() * 2);
    }

    for (let t = 0; t < treeCount; t++) {
      let bx = 0;
      let bz = 0;
      let ok = false;
      for (let attempt = 0; attempt < 14; attempt++) {
        bx = 3 + Math.floor(rnd() * 11);
        bz = 3 + Math.floor(rnd() * 11);
        const worldBX = cx * CHUNK_BLOCKS + bx;
        const worldBZ = cz * CHUNK_BLOCKS + bz;
        const wx = worldBX * BLOCK + BLOCK / 2;
        const wz = worldBZ * BLOCK + BLOCK / 2;
        // Leave room for the whole canopy outside the 15-block lawn.
        if (Math.hypot(wx - START.x, wz - START.z) < (START.radiusBlocks + 3) * BLOCK) continue;
        if (M.hearthTree && M.hearthTree.isReserved(wx, wz, 11)) continue;
        // Reserve the full canopy footprint around roads and portals, including
        // raised approaches whose surface differs from the original terrain.
        // Cutting individual leaves or trunks leaves floating treetops behind.
        let overlapsApproach = false;
        if (M.hellGates) for (let dx = -2; dx <= 2 && !overlapsApproach; dx++) for (let dz = -2; dz <= 2; dz++) {
          if (M.hellGates.isClearedColumn(worldBX + dx, worldBZ + dz)) { overlapsApproach = true; break; }
        }
        if (overlapsApproach) continue;
        if (M.caves.entranceClearance(worldBX, worldBZ) || isPondArea(worldBX, worldBZ) || topSolidY(worldBX, worldBZ) !== heightBlocks(worldBX, worldBZ) - 1) continue;
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
      const stoneWorldBX = cx * CHUNK_BLOCKS + rx;
      const stoneWorldBZ = cz * CHUNK_BLOCKS + rz;
      if (!isStartingClearing(stoneWorldBX, stoneWorldBZ) && !isPondArea(stoneWorldBX, stoneWorldBZ) &&
          !(M.hearthTree && M.hearthTree.isReserved(wx, wz, 3))) {
        const baseY = heightBlocks(stoneWorldBX, stoneWorldBZ) * BLOCK;
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
    const localPlaced = placedByChunk.get(cx + ',' + cz);
    if (localPlaced) localPlaced.forEach(function (kind, key) {
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

    faces.forEach(function (b) {
      if (M.towers && M.towers.atCell(b.bx, b.by, b.bz)) return;
      // A rock or canopy can extend into a higher terrain step. The terrain
      // owns that voxel; drawing the prop too duplicates its exposed faces.
      if (isSolidBlock(b.bx, b.by, b.bz) || permanentBlocks.has(blockKey(b.bx, b.by, b.bz))) return;
      function occupied(dx, dy, dz) {
        return blocks.has(blockKey(b.bx + dx, b.by + dy, b.bz + dz)) || permanentBlocks.has(blockKey(b.bx + dx, b.by + dy, b.bz + dz)) || isSolidBlock(b.bx + dx, b.by + dy, b.bz + dz);
      }
      if (!occupied(0, 1, 0)) pushTop(data, b.x, b.y + BLOCK, b.z, b.top, b.shadeTop);
      if (!occupied(0, -1, 0)) pushBottom(data, b.x, b.y, b.z, b.bottom, b.shadeSide);
      if (!occupied(-1, 0, 0)) pushSide(data, 0, b.x, b.z, b.y, b.y + BLOCK, b.side, b.shadeSide);
      if (!occupied(1, 0, 0)) pushSide(data, 1, b.x, b.z, b.y, b.y + BLOCK, b.side, b.shadeSide);
      if (!occupied(0, 0, -1)) pushSide(data, 2, b.x, b.z, b.y, b.y + BLOCK, b.side, b.shadeSide);
      if (!occupied(0, 0, 1)) pushSide(data, 3, b.x, b.z, b.y, b.y + BLOCK, b.side, b.shadeSide);
    });
    if (!blocks.size) return null;
    return { geometry: dataToGeometry(data, false), blocks: blocks };
  }

  // ---- flowers and grass tufts ----
  function pushPlant(data, x, z, y, w, h, angle, type) {
    const hw = w / 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
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
      // Crossed billboards get a sky-facing normal so grass and flowers
      // catch the daylight instead of staying unlit after dark.
      data.nor.push(0, 1, 0);
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

      if (waterInfoAtBlock(worldBX, worldBZ) || topSolidY(worldBX, worldBZ) !== heightBlocks(worldBX, worldBZ) - 1 ||
          propKindAt(worldBX, heightBlocks(worldBX, worldBZ), worldBZ) ||
          permanentBlocks.has(blockKey(worldBX, heightBlocks(worldBX, worldBZ) - 1, worldBZ))) continue;
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
      plants.receiveShadow = true;
      group.add(plants);
    }

    const waterGeo = buildWaterGeometry(cx, cz);
    let water = null;
    if (waterGeo) {
      water = new THREE.Mesh(waterGeo, waterMat);
      water.receiveShadow = true;
      water.renderOrder = 3;
      group.add(water);
    }

    worldGroup.add(group);
    chunks.set(key, {
      group: group,
      terrain: terrain,
      props: props,
      propBlocks: propBlocks,
      plants: plants,
      water: water,
      cx: cx,
      cz: cz
    });
    activateChunkWater(cx, cz);
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


  let streamX = NaN, streamZ = NaN, streamQueue = [], streamHead = 0;
  function updateChunks(player) {
    const pcx = Math.floor(player.x / CHUNK_SIZE), pcz = Math.floor(player.z / CHUNK_SIZE);
    if (pcx !== streamX || pcz !== streamZ) {
      streamX = pcx; streamZ = pcz; streamHead = 0;
      streamQueue = chunkOffsets.map(function (offset) { return [pcx + offset[0], pcz + offset[1]]; });
      chunks.forEach(function (ch, key) {
        const home = M.hearthTree && M.hearthTree.position;
        const gateNearby = M.hellGates && M.hellGates.gates.some(gate => Math.abs(ch.cx - Math.floor(gate.x / CHUNK_SIZE)) <= 1 && Math.abs(ch.cz - Math.floor(gate.z / CHUNK_SIZE)) <= 1);
        const towerNearby = M.towers && M.towers.list.some(tower => Math.abs(ch.cx - Math.floor(tower.position.x / CHUNK_SIZE)) <= 1 && Math.abs(ch.cz - Math.floor(tower.position.z / CHUNK_SIZE)) <= 1);
        const retained = gateNearby || towerNearby || permanentChunks.has(key) || home && Math.abs(ch.cx - Math.floor(home.x / CHUNK_SIZE)) <= 2 &&
          Math.abs(ch.cz - Math.floor(home.z / CHUNK_SIZE)) <= 2;
        if (!retained && (Math.abs(ch.cx - pcx) > RENDER_RADIUS + 1 || Math.abs(ch.cz - pcz) > RENDER_RADIUS + 1)) {
          worldGroup.remove(ch.group);
          ch.terrain.geometry.dispose();
          if (ch.props) ch.props.geometry.dispose();
          if (ch.plants) ch.plants.geometry.dispose();
          if (ch.water) ch.water.geometry.dispose();
          chunks.delete(key);
          for (let x = ch.cx * CHUNK_BLOCKS; x < (ch.cx + 1) * CHUNK_BLOCKS; x++) {
            for (let z = ch.cz * CHUNK_BLOCKS; z < (ch.cz + 1) * CHUNK_BLOCKS; z++) fluid.forgetColumn(x, z);
          }
        }
      });
    }
    while (streamHead < streamQueue.length) {
      const next = streamQueue[streamHead++];
      if (chunks.has(next[0] + ',' + next[1])) continue;
      buildChunk(next[0], next[1]);
      break;
    }
  }

  function rebuildChunkWater(cx, cz) {
    const ch = chunks.get(cx + ',' + cz);
    if (!ch) return;
    if (ch.water) {
      ch.group.remove(ch.water);
      ch.water.geometry.dispose();
      ch.water = null;
    }
    const geo = buildWaterGeometry(cx, cz);
    rebuildChunkPlants(ch);
    if (!geo) return;
    ch.water = new THREE.Mesh(geo, waterMat);
    ch.water.receiveShadow = true;
    ch.water.renderOrder = 3;
    ch.group.add(ch.water);
  }

  function rebuildChunkPlants(ch) {
    if (ch.plants) { ch.group.remove(ch.plants); ch.plants.geometry.dispose(); ch.plants = null; }
    const geometry = buildPlantsGeometry(ch.cx, ch.cz);
    if (geometry) { ch.plants = new THREE.Mesh(geometry, plantMat); ch.plants.receiveShadow = true; ch.group.add(ch.plants); }
  }

  function rebuildChunkTerrain(cx, cz) {
    const ch = chunks.get(cx + ',' + cz);
    if (!ch) return;
    ch.terrain.geometry.dispose();
    ch.terrain.geometry = buildTerrainGeometry(cx, cz);
    // Removing terrain can expose a previously hidden placed-block face.
    if (!dirtyPropChunks.has(cx + ',' + cz)) rebuildChunkProps(cx, cz);
    rebuildChunkPlants(ch);
    dirtyWaterChunks.add(cx + ',' + cz);
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
      rebuildChunkPlants(ch);
      return;
    }

    ch.props = new THREE.Mesh(info.geometry, blockMat);
    ch.props.castShadow = true;
    ch.props.receiveShadow = true;
    ch.group.add(ch.props);
    ch.propBlocks = info.blocks;
    rebuildChunkPlants(ch);
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
        dirtyTerrainChunks.add(xs[i] + ',' + zs[j]);
      }
    }
  }

  function removePropBlock(bx, by, bz) {
    const key = blockKey(bx, by, bz);
    const ch = chunkForBlock(bx, bz);
    if (ch) ch.propBlocks.delete(key);
    wakeWater(bx, by, bz);
    recordChange(bx, bz);
    if (placedBlocks.has(key)) {
      placedBlocks.delete(key);
      const id = Math.floor(bx / CHUNK_BLOCKS) + ',' + Math.floor(bz / CHUNK_BLOCKS);
      const local = placedByChunk.get(id);
      if (local) { local.delete(key); if (!local.size) placedByChunk.delete(id); }
    } else {
      removedPropBlocks.add(key);
    }
  }

  function canPlaceBlock(bx, by, bz) {
    if (!Number.isInteger(bx) || !Number.isInteger(by) || !Number.isInteger(bz)) return false;
    if (by < 0 || by > 127) return false;
    if (M.hellGates && M.hellGates.isReserved(bx, by, bz)) return false;
    if (M.goat && M.goat.intersectsBlock && M.goat.intersectsBlock(bx, by, bz)) return false;
    if (M.animals && M.animals.intersectsBlock && M.animals.intersectsBlock(bx, by, bz)) return false;
    if (M.enemies && M.enemies.zombies.some(function (zombie) {
      return M.actorPhysics.intersectsBlock(zombie.position, zombie.body || M.enemies.body, bx, by, bz, BLOCK);
    })) return false;
    if (M.hearthTree && M.hearthTree.intersectsBlock(bx, by, bz)) return false;
    if (!chunkForBlock(bx, bz)) return false;
    if (isSolidBlock(bx, by, bz)) return false;
    if (propKindAt(bx, by, bz)) return false;
    return !placedBlocks.has(blockKey(bx, by, bz));
  }

  function placeBlock(kind, bx, by, bz) {
    if (!ITEM_TILES[kind] || !canPlaceBlock(bx, by, bz)) return false;

    const key = blockKey(bx, by, bz);
    placedBlocks.set(key, kind);
    const id = Math.floor(bx / CHUNK_BLOCKS) + ',' + Math.floor(bz / CHUNK_BLOCKS);
    if (!placedByChunk.has(id)) placedByChunk.set(id, new Map());
    placedByChunk.get(id).set(key, kind);
    chunkForBlock(bx, bz).propBlocks.set(key, kind);
    recordChange(bx, bz);
    wakeWater(bx, by, bz);
    dirtyPropChunks.add(Math.floor(bx / CHUNK_BLOCKS) + ',' + Math.floor(bz / CHUNK_BLOCKS));
    if (M.audio && M.audio.block) M.audio.block('place', { x: (bx + 0.5) * BLOCK, y: (by + 0.5) * BLOCK, z: (bz + 0.5) * BLOCK }, kind);
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

  function spawnBlockDrop(bx, by, bz, kind, persistent) {
    if (M.items && M.items.dropBlock) {
      M.items.dropBlock(
        kind,
        bx * BLOCK + BLOCK / 2,
        by * BLOCK + BLOCK / 2,
        bz * BLOCK + BLOCK / 2,
        { persistent: !!persistent }
      );
    }
  }

  function spawnBlockDebris(bx, by, bz, kind) {
    if (M.audio && M.audio.block) M.audio.block('break', { x: (bx + 0.5) * BLOCK, y: (by + 0.5) * BLOCK, z: (bz + 0.5) * BLOCK }, kind);
    const cx = bx * BLOCK + BLOCK / 2;
    const cy = by * BLOCK + BLOCK / 2;
    const cz = bz * BLOCK + BLOCK / 2;

    for (let i = 0; i < 8; i++) {
      let mat = debrisDirtMat;
      if (kind === 'stone' || kind === 'coal' || kind === 'copper' || kind === 'iron') mat = debrisStoneMat;
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
      if (debris.length >= 128) sceneRef.remove(debris.shift());
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

  // Break one block cell no matter whether it belongs to the terrain or to a
  // prop (tree, stone, player-placed block). Returns the broken kind, or null.
  // Animals use this with drop: false so the block can go straight onto their
  // horns instead of competing with the player's item drops.
  function breakBlockAt(bx, by, bz, options) {
    if (!Number.isInteger(bx) || !Number.isInteger(by) || !Number.isInteger(bz) || by < 0) return null;
    if (permanentBlocks.has(blockKey(bx, by, bz))) return null;
    const opts = options || {};
    const tower = M.towers && M.towers.atCell(bx, by, bz);
    if (tower && !opts.towerInternal) {
      if (opts.protectPlaced) return null;
      return M.towers.dismantle(tower) ? 'tower_' + tower.id : null;
    }
    const key = blockKey(bx, by, bz);
    const propKind = propKindAt(bx, by, bz);

    if (propKind) {
      if (opts.protectPlaced && placedBlocks.has(key)) return null;
      removePropBlock(bx, by, bz);
      dirtyPropChunks.add(Math.floor(bx / CHUNK_BLOCKS) + ',' + Math.floor(bz / CHUNK_BLOCKS));
      spawnBlockDebris(bx, by, bz, propKind);
      if (opts.drop !== false) spawnBlockDrop(bx, by, bz, propKind, opts.persistentDrop);
      return propKind;
    }

    if (isProtectedArea(bx, bz) || !isSolidBlock(bx, by, bz)) return null;
    const kind = M.caves.material(bx, by, bz, heightBlocks(bx, bz));
    removedBlocks.add(key);
    recordChange(bx, bz);
    wakeWater(bx, by, bz);
    rebuildTerrainAround(bx, bz);
    spawnBlockDebris(bx, by, bz, kind);
    if (opts.drop !== false) spawnBlockDrop(bx, by, bz, kind, opts.persistentDrop);
    return kind;
  }

  // Find a nearby natural block an animal could nibble loose. Props such as
  // low logs and stones are preferred; when none exist, a topsoil block is a
  // reliable fallback. Player-placed blocks are protected by default.
  function findBreakableNear(x, z, feetY, radius, options) {
    const opts = options || {};
    const maxDist2 = radius * radius;
    let best = null;
    let bestScore = Infinity;

    chunks.forEach(function (ch) {
      if (x + radius < ch.cx * CHUNK_SIZE || x - radius > (ch.cx + 1) * CHUNK_SIZE ||
          z + radius < ch.cz * CHUNK_SIZE || z - radius > (ch.cz + 1) * CHUNK_SIZE) return;
      if (!ch.propBlocks || ch.propBlocks.size === 0) return;
      ch.propBlocks.forEach(function (kind, key) {
        if (kind === 'leaves') return;
        if (opts.protectPlaced !== false && placedBlocks.has(key)) return;
        const parts = key.split(',');
        const bx = +parts[0];
        const by = +parts[1];
        const bz = +parts[2];
        if (isProtectedArea(bx, bz)) return;
        const cx = (bx + 0.5) * BLOCK;
        const cy = (by + 0.5) * BLOCK;
        const cz = (bz + 0.5) * BLOCK;
        if (opts.avoid && Math.hypot(cx - opts.avoid.x, cz - opts.avoid.z) < (opts.avoid.radius || 3)) return;
        if (cy < feetY + 0.25 || cy > feetY + 2.55) return;
        const dx = cx - x;
        const dz = cz - z;
        const dist2 = dx * dx + dz * dz;
        if (dist2 > maxDist2 || dist2 < 1.8) return;

        let score = dist2;
        if (kind === 'stone') score -= 2.5;
        if (kind === 'log') score += 3.5;
        if (score < bestScore) {
          bestScore = score;
          best = { type: 'prop', bx: bx, by: by, bz: bz, kind: kind, x: cx, y: cy, z: cz };
        }
      });
    });

    if (best || opts.allowTerrain === false) return best;

    const bx0 = Math.floor(x / BLOCK);
    const bz0 = Math.floor(z / BLOCK);
    const r = Math.ceil(radius / BLOCK);
    for (let bx = bx0 - r; bx <= bx0 + r; bx++) {
      for (let bz = bz0 - r; bz <= bz0 + r; bz++) {
        const by = topSolidY(bx, bz);
        if (isProtectedArea(bx, bz) || isStartingClearing(bx, bz)) continue;
        if (by < 0) continue;
        const cx = (bx + 0.5) * BLOCK;
        const cz = (bz + 0.5) * BLOCK;
        if (opts.avoid && Math.hypot(cx - opts.avoid.x, cz - opts.avoid.z) < (opts.avoid.radius || 3)) continue;
        const top = (by + 1) * BLOCK;
        if (top < feetY - 0.1 || top > feetY + 1.6) continue;
        const dx = cx - x;
        const dz = cz - z;
        const dist2 = dx * dx + dz * dz;
        if (dist2 > maxDist2 || dist2 < 1.8) continue;
        const kind = M.caves.material(bx, by, bz, heightBlocks(bx, bz));
        if (dist2 < bestScore) {
          bestScore = dist2;
          best = { type: 'terrain', bx: bx, by: by, bz: bz, kind: kind, x: cx, y: top, z: cz };
        }
      }
    }

    return best;
  }

  function breakBlockInFront(headPivot) {
    const target = findHeadbuttTarget(headPivot);
    if (!target) return false;
    return !!breakBlockAt(target.bx, target.by, target.bz);
  }

  function breakBlockBelow(x, z, feetY) {
    const bx = Math.floor(x / BLOCK), bz = Math.floor(z / BLOCK);
    const by = Math.floor((feetY + 0.02) / BLOCK) - 1;
    if (Math.abs(feetY - (by + 1) * BLOCK) > 0.12) return false;
    return !!breakBlockAt(bx, by, bz);
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

    waterMat = new THREE.MeshStandardMaterial({
      color: 0x358ba7,
      roughness: 0.2,
      metalness: 0.04,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexColors: true,
      emissive: 0x0a2b38,
      emissiveIntensity: 0.2
    });
    waterMat.onBeforeCompile = function (shader) {
      shader.uniforms.uWaterTime = waterTime;
      shader.vertexShader = 'uniform float uWaterTime;\nvarying vec3 vWaterWorld;\nvarying float vWaterSurface;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec3 waterWorld = (modelMatrix * vec4(position, 1.0)).xyz;
         vWaterWorld = waterWorld;
         vWaterSurface = step(0.5, normal.y);
         float waterWave = sin(waterWorld.x * 0.72 + uWaterTime * 1.4) * 0.018
                         + cos(waterWorld.z * 0.63 - uWaterTime * 1.05) * 0.016;
         transformed.y += waterWave;`
      );
      shader.fragmentShader = 'uniform float uWaterTime;\nvarying vec3 vWaterWorld;\nvarying float vWaterSurface;\n' + shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         vec3 waveSlope = vec3(
           -cos(vWaterWorld.x * 0.72 + uWaterTime * 1.4) * 0.045,
           0.0,
           sin(vWaterWorld.z * 0.63 - uWaterTime * 1.05) * 0.035
         );
         normal = normalize(normal + mat3(viewMatrix) * waveSlope * vWaterSurface * (gl_FrontFacing ? 1.0 : -1.0));`
      );
    };
    waterMat.customProgramCacheKey = function () { return 'meadow-water-waves-v2'; };

    plantTex = makePlantAtlas();
    plantMat = new THREE.MeshStandardMaterial({
      map: plantTex,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
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
    fluid.update(dt);
    let solidRebuilt = 0;
    for (const id of new Set([...dirtyTerrainChunks, ...dirtyPropChunks])) {
      const parts = id.split(','), ch = chunks.get(id);
      if (dirtyPropChunks.delete(id)) rebuildChunkProps(+parts[0], +parts[1]);
      if (dirtyTerrainChunks.delete(id)) rebuildChunkTerrain(+parts[0], +parts[1]);
      if (ch && ++solidRebuilt >= 2) break;
    }
    let waterRebuilt = 0;
    for (const id of dirtyWaterChunks) {
      dirtyWaterChunks.delete(id);
      const parts = id.split(',');
      rebuildChunkWater(+parts[0], +parts[1]);
      if (++waterRebuilt >= 2) break;
    }
    updateDebris(dt);
    wind.value = t;
    waterTime.value = t;
  }

  M.world = {
    init: init,
    update: update,
    surfaceHeight: surfaceHeight,
    // Original terrain level lets burrowers keep a covered tunnel even when
    // an earlier tunnel entrance has lowered the currently exposed surface.
    terrainHeight: function (x, z) { return heightBlocks(Math.floor(x / BLOCK), Math.floor(z / BLOCK)) * BLOCK; },
    blockedAt: blockedAt,
    supportHeight: supportHeight,
    landingHeight: landingHeight,
    breakBlockInFront: breakBlockInFront,
    breakBlockBelow: breakBlockBelow,
    breakBlockAt: breakBlockAt,
    findBreakableNear: findBreakableNear,
    blockInfoAt: blockInfoAt,
    addPermanentBlocks: addPermanentBlocks,
    removePermanentBlocks: removePermanentBlocks,
    topSoilInfo: topSoilInfo,
    isPlacedBlock: isPlacedBlock,
    isWaterColumn: isWaterColumn,
    isPondArea: isPondArea,
    isProtectedArea: isProtectedArea,
    isStartingClearing: isStartingClearing,
    waterDepthAt: waterDepthAt,
    waterLevelAt: waterLevelAt,
    // Include the dry rim of a basin: cutting it below this level would flood
    // the surrounding low ground, even though the rim itself has no water.
    naturalWaterLevelAt: function (x, z) {
      const plan = generatedColumn(Math.floor(x / BLOCK), Math.floor(z / BLOCK)).plan;
      return plan ? plan.waterLevel : 0;
    },
    waterInfoAtBlock: waterInfoAtBlock,
    waterAt: waterAt,
    waterSpansAtBlock: waterSpansAtBlock,
    fluid: fluid,
    pondsNear: pondsNear,
    canPlaceBlock: canPlaceBlock,
    placeBlock: placeBlock,
    blockIcon: blockIcon,
    makeBlockMesh: makeBlockMesh,
    navigationChangesSince: navigationChangesSince,
    navigationBlockedAt: navigationBlockedAt,
    bodyBlockedAt: bodyBlockedAt,
    bodySupportHeight: bodySupportHeight,
    navigationSurfaces: navigationSurfaces,
    get revision() { return revision; },
    blockSize: BLOCK
  };
})(window.Meadow = window.Meadow || {});
