import assert from 'node:assert/strict';
import test from 'node:test';
import { classicModules } from './helpers/animal-game.mjs';

// Real THREE stays inside the isolated classic-script fixture.
function model(species) {
  const { M, THREE, load } = classicModules(); load('js/animal-style.js'); load('js/animal-models.js');
  const p = M.animalModels.create(species);
  return { M, THREE, p, ctx: { rig: p.rig, torso: p.torso, head: p.headPivot, neck: p.neck, legs: p.legs,
    horns: p.horns, tail: p.tailPivot, ears: p.ears, species } };
}
function modules(root) { const nodes = []; root.traverse(n => { if (n.userData.upgrade) nodes.push(n); }); return nodes; }

test('each branch transforms only its assigned region on every species', () => {
  for (const species of ['sheep', 'cow', 'stag']) for (const branch of ['move', 'cadence', 'reach', 'power', 'craft']) {
    const { M, THREE, p, ctx } = model(species), fx = M.styleFx.makeModuleStyle(THREE, branch);
    const originalCount = p.rig.children.length;
    for (const tier of [1, 2, 3, 1, 3]) {
      fx.apply(tier, ctx);
      assert.ok(modules(p.group).every(n => n.userData.upgrade === branch));
      assert.equal(p.torso.visible, !(['power', 'craft'].includes(branch) && tier === 3));
      assert.equal(p.horns[0].mesh.visible, branch !== 'reach');
      if (branch !== 'move') assert.equal(p.group.getObjectByName('cyber-foot-0'), undefined);
      if (branch !== 'cadence') assert.equal(p.group.getObjectByName('reflex-neck-' + tier), undefined);
      if (branch !== 'reach') assert.equal(p.group.getObjectByName('arc-antlers-' + tier), undefined);
      p.group.updateMatrixWorld(true);
      p.group.traverse(n => assert.ok(Array.from(n.matrixWorld.elements).every(Number.isFinite)));
    }
    fx.dispose(); assert.equal(p.rig.children.length, originalCount);
    assert.equal(p.torso.visible, true); assert.equal(p.horns[0].mesh.visible, true);
  }
});

test('mixed loadouts preserve other attachments and restore all natural surfaces in either purchase order', () => {
  for (const order of [['move', 'cadence', 'reach', 'power'], ['power', 'reach', 'cadence', 'move']]) {
    const { M, THREE, p, ctx } = model('stag'), fx = M.styleFx.makeLoadout(THREE), levels = {};
    let previous = [];
    for (const branch of order) {
      for (let tier = 1; tier <= 3; tier++) {
        levels[branch] = tier; fx.apply(levels, ctx);
        for (const node of previous) assert.ok(node.parent, 'other branch retained its original object');
      }
      previous = modules(p.group);
    }
    const count = modules(p.group).length;
    for (let frame = 0; frame < 120; frame++) { fx.apply(levels, ctx); fx.animate(frame / 60, 1, .7, false); }
    assert.equal(modules(p.group).length, count, 'animation and repeated apply never allocate attachments');
    fx.animate(1, 1, .7, true);
    p.group.traverse(n => { if (n.geometry?.type === 'RingGeometry') assert.equal(n.visible, false); });
    fx.dispose(); assert.equal(modules(p.group).length, 0); assert.equal(p.torso.visible, true);
    assert.ok(p.horns.every(h => h.mesh.visible));
  }
});

test('module materials and geometries are released on replacement', () => {
  const { M, THREE, p, ctx } = model('sheep'), fx = M.styleFx.makeModuleStyle(THREE, 'power');
  fx.apply(2, ctx); let owned = 0, disposed = 0;
  for (const root of modules(p.group)) root.traverse(n => {
    for (const resource of [n.geometry, n.material].filter(Boolean)) { owned++; resource.addEventListener('dispose', () => disposed++); }
  });
  fx.apply(3, ctx); assert.equal(disposed, owned); assert.ok(owned > 0);
});


test('NPC identities keep distinct geometry and finishes through upgrades without leaking into another animal', () => {
  // Use the same sheep rig to prove equipment differs independently of body size.
  const variants = ['mallow', 'clover', 'bramble', 'poppy'].map(equipmentStyle => {
    const fixture = model('sheep'); fixture.ctx.equipmentStyle = equipmentStyle;
    return { ...fixture, fx: fixture.M.styleFx.makeLoadout(fixture.THREE) };
  });
  function signature(p) {
    const colors = new Set(), geometry = [];
    for (const root of modules(p.group)) root.traverse(n => {
      if (!n.isMesh) return;
      colors.add(n.material.color.getHex());
      n.geometry.computeBoundingBox();
      const b = n.geometry.boundingBox;
      geometry.push([n.geometry.attributes.position.count, ...b.min.toArray(), ...b.max.toArray()]);
    });
    return { colors: [...colors].sort().join(','), geometry: JSON.stringify(geometry) };
  }
  for (const tier of [1, 2, 3]) {
    for (const v of variants) v.fx.apply({ move: tier, cadence: tier, reach: tier, power: tier }, v.ctx);
    const looks = variants.map(v => signature(v.p));
    assert.equal(new Set(looks.map(v => v.colors)).size, 4, 'each NPC has its own palette at every tier');
    assert.equal(new Set(looks.map(v => v.geometry)).size, 4, 'silhouettes differ even on identical base rigs');
    const unchanged = signature(variants[1].p);
    variants[0].fx.apply({ move: tier, craft: tier }, variants[0].ctx);
    assert.deepEqual(signature(variants[1].p), unchanged, 'training another NPC cannot recolor or reshape this one');
    for (const v of variants) {
      const roots = modules(v.p.group);
      v.fx.animate(1, 1, .8, true);
      v.p.group.updateMatrixWorld(true);
      v.p.group.traverse(n => assert.ok(Array.from(n.matrixWorld.elements).every(Number.isFinite)));
      assert.ok(roots.every(n => n.userData.equipmentStyle === v.ctx.equipmentStyle));
    }
  }
  variants.forEach(v => v.fx.dispose());
});
