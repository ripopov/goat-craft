(function (M) {
  'use strict';
  const CELL = 48;
  const starter = { bx: 10, bz: 16, x: 21, z: 33 };
  function hash(x, z, seed) {
    let n = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ seed;
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b);
    return (n ^ (n >>> 13)) >>> 0;
  }
  function entrance(gx, gz) {
    if (gx === 0 && gz === 0) return starter;
    const n = hash(gx, gz, 0x43a9d17);
    return { bx: gx * CELL + 10 + n % 22, bz: gz * CELL + 10 + (n >>> 8) % 22 };
  }
  function entranceClearance(bx, bz) {
    const entry = entrance(Math.floor(bx / CELL), Math.floor(bz / CELL));
    return Math.abs(bx - entry.bx) <= 3 && bz >= entry.bz - 4 && bz <= entry.bz + 5;
  }
  function profile(bx, bz, height, wet, clearing) {
    const home = M.config.startingArea;
    if (height < 5 || Math.hypot(bx + .5 - home.x / 2, bz + .5 - home.z / 2) < 6) return null;
    const entry = entrance(Math.floor(bx / CELL), Math.floor(bz / CELL));
    const along = bz - entry.bz;
    const mouth = !wet && !clearing && Math.abs(bx - entry.bx) <= 1 && along >= -2 && along <= 4;
    if (mouth) {
      const floor = Math.max(1, Math.min(height - 1, 6 - along));
      return { floor: floor, roof: along < 3 ? height : floor + 2, entrance: true };
    }
    // Intersecting winding corridors and chambers are sampled in world space,
    // so neither chunk boundaries nor streaming can change their shape.
    const corridorX = Math.abs(Math.sin(bx * .14 + Math.sin(bz * .09) * 1.8));
    const corridorZ = Math.abs(Math.sin(bz * .13 + Math.sin(bx * .08 + 2) * 1.7));
    const chamber = Math.hypot(bx - entry.bx, bz - (entry.bz + 6)) < 5.6;
    if (!chamber && corridorX > .22 && corridorZ > .22) return null;
    const floor = Math.min(2, height - 4);
    return { floor: floor, roof: floor + 2, entrance: false };
  }
  function material(bx, by, bz, height) {
    const depth = height - by;
    if (depth === 1) return 'grass';
    if (depth === 2) return 'dirt';
    if (depth === 3) return 'stone';
    // Visible starter veins in the chamber floor make every mineral obtainable
    // without depending on luck. These coordinates are outside the foundation.
    if (by === 1) {
      if (bx >= 7 && bx <= 9 && bz >= 19 && bz <= 21) return 'coal';
      if (bx >= 12 && bx <= 14 && bz >= 20 && bz <= 22) return 'copper';
      if (bx >= 9 && bx <= 11 && bz >= 24 && bz <= 26) return 'iron';
    }
    const vein = hash(Math.floor(bx / 3), Math.floor(bz / 3), 0x61c298a ^ Math.imul(Math.floor(by / 2), 0x165667b1)) % 100;
    if (vein < 9) return 'coal';
    if (vein < 17) return 'copper';
    if (vein < 24 && depth >= 4) return 'iron';
    return 'stone';
  }
  M.caves = { profile: profile, material: material, entranceClearance: entranceClearance, starter: starter };
})(window.Meadow = window.Meadow || {});
