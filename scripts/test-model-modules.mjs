import assert from 'node:assert/strict';
import test from 'node:test';
import { classicModules } from './helpers/animal-game.mjs';

test('every configured enemy has a finite articulated model with valid parent joints and bounded render capacity', () => {
  const { M, load } = classicModules(); load('js/enemy-rules.js'); load('js/enemy-models.js');
  const { models, maxParts, maxJoints } = M.enemyModels.create(M.enemyRules.types);
  for (const type of [...Object.keys(M.enemyRules.types), 'parachute']) {
    const model = models[type]; assert.ok(model.parts.length > 0, type);
    assert.ok(model.parts.length + models.parachute.parts.length <= maxParts);
    assert.ok(model.joints.length <= maxJoints);
    for (const joint of model.joints) assert.ok(joint.parent >= 0 && joint.parent < joint.id, 'parents precede children');
    for (const part of model.parts) {
      assert.ok(part.joint <= model.joints.length);
      assert.ok(Array.from(part.matrix.elements).every(Number.isFinite));
      assert.ok(part.sx > 0 && part.sy > 0 && part.sz > 0);
    }
  }
  const another = M.enemyModels.create(M.enemyRules.types);
  assert.notEqual(another.models.worm.joints[0], models.worm.joints[0], 'posing one renderer cannot mutate another');
  const geometry = M.enemyModels.geometry();
  assert.ok(geometry.getAttribute('position').count > 0);
  assert.ok(geometry.getAttribute('normal').array.every(Number.isFinite));
});

test('animal and coin models work without initializing a game world or controllers', () => {
  const { M, THREE, load } = classicModules({ seed: 1 });
  load('js/animal-style.js'); load('js/animal-models.js'); load('js/coin-model.js');
  assert.equal(M.world, undefined); assert.equal(M.animals, undefined); assert.equal(M.enemies, undefined);
  for (const species of Object.keys(M.animalModels.species)) {
    const rig = M.animalModels.create(species);
    assert.equal(rig.legs.length, 4); assert.equal(rig.eyes.length, 2);
    assert.ok(rig.headPivot && rig.neck && rig.carryAnchor);
    const bounds = new THREE.Box3().setFromObject(rig.group);
    assert.ok(Number.isFinite(bounds.min.y + bounds.max.y)); assert.ok(bounds.max.y > bounds.min.y);
  }
  const coin = M.coinModel.create(), second = M.coinModel.create();
  assert.equal(coin.geometry, second.geometry); assert.equal(coin.material, second.material);
  M.coinModel.update(7, false); assert.equal(coin.material.userData.time.value, 7);
  M.coinModel.update(8, true); assert.equal(coin.material.userData.time.value, 0, 'reduced motion freezes the glint');
});
