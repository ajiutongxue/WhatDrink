'use strict';

var assert = require('assert');
var importPackage = require('../data/tea-knowledge.import-v1.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function run() {
  var storage = {};
  var failPrimaryWrite = false;
  global.wx = {
    getStorageSync: function(key) { return storage[key]; },
    setStorageSync: function(key, value) {
      if (failPrimaryWrite && key === 'tea_doctor_v1') throw new Error('simulated write failure');
      storage[key] = clone(value);
    },
    cloud: {
      database: function() { return {}; },
      callFunction: function(options) {
        ['knowledgeBase', 'knowledgeOverrides', 'inventory'].forEach(function(key) {
          assert.strictEqual(Object.prototype.hasOwnProperty.call(options.data.data, key), false,
            key + ' must not be sent to the current cloud snapshot');
        });
        options.success({ result: { success: true, data: clone(options.data.data) } });
      }
    }
  };

  delete require.cache[require.resolve('../utils/data')];
  var data = require('../utils/data');
  var installed = data.importTeaKnowledgePackage(importPackage);
  assert.strictEqual(installed.ok, true, installed.error);
  assert.strictEqual(installed.knowledgeBase.catalogVersion, 'research-v1');
  assert.strictEqual(Object.keys(installed.knowledgeBase.profilesByTeaId).length, 86);
  assert.deepStrictEqual(installed.knowledgeBase.withheldTeaIds, [0, 25, 68]);
  assert.deepStrictEqual(installed.knowledgeBase.validationSummary.profileCount, 86);
  assert.deepStrictEqual(installed.knowledgeBase.validationSummary.expectedTeaCount, 89);

  var invalid = clone(importPackage);
  invalid.teas[0].lifecycle = 'draft';
  var rejected = data.importTeaKnowledgePackage(invalid);
  assert.strictEqual(rejected.ok, false, 'a non-complete profile must never replace the baseline');
  assert.strictEqual(data.load().knowledgeBase.catalogVersion, 'research-v1');

  storage.tea_doctor_v1.profile.city = '杭州';
  assert.strictEqual(data.rollbackTeaKnowledgePackage(), true, 'the previous baseline should be restorable');
  var rolledBack = data.load();
  assert.strictEqual(rolledBack.profile.city, '杭州', 'rollback must not revert user profile data');
  assert.strictEqual(rolledBack.knowledgeBase.catalogVersion, '');
  assert.strictEqual(Object.keys(rolledBack.knowledgeBase.profilesByTeaId).length, 0);

  assert.strictEqual(data.importTeaKnowledgePackage(importPackage).ok, true);
  var baseProfile = data.load().knowledgeBase.profilesByTeaId[1];
  var personalAroma = {
    value: ['熟果香'], status: 'personal', sourceType: 'user', confidence: 0.9,
    updatedAt: Date.now(), evidence: '用户品饮记录'
  };
  var override = data.setKnowledgeOverride(1, 'sensory.aromaTags', personalAroma, { locked: true });
  assert.strictEqual(override.ok, true, override.error);
  assert.deepStrictEqual(data.load().knowledgeOverrides['1'].patch['sensory.aromaTags'], personalAroma);
  assert.deepStrictEqual(data.load().knowledgeOverrides['1'].lockedPaths, ['sensory.aromaTags']);
  assert.strictEqual(data.setKnowledgeOverride(1, 'missing.path', personalAroma).ok, false);
  assert.strictEqual(data.removeKnowledgeOverride(1, 'sensory.aromaTags'), true);
  assert.ok(data.load().knowledgeOverrides['1'].tombstones['sensory.aromaTags'] > 0);
  assert.strictEqual(baseProfile.teaId, 1, 'override operations must not mutate the base profile');

  assert.strictEqual(data.load().knowledgeBase.profilesByTeaId[0], undefined, 'withheld tea must start without a base profile');
  var personalOnly = data.setKnowledgeOverride(0, 'origin.region', {
    value: '用户实物确认产区', status: 'personal', sourceType: 'user', confidence: 1,
    updatedAt: Date.now(), evidence: '用户手动记录'
  }, { locked: true });
  assert.strictEqual(personalOnly.ok, true, personalOnly.error);
  assert.strictEqual(data.load().knowledgeOverrides['0'].patch['origin.region'].value, '用户实物确认产区', 'a withheld tea must accept contract-valid personal fields without inventing a base profile');
  assert.deepStrictEqual(data.load().knowledgeOverrides['0'].lockedPaths, ['origin.region']);
  assert.strictEqual(data.setKnowledgeOverride(0, 'sensory.sweetness', {
    value: 8, status: 'personal', sourceType: 'user', confidence: 1, updatedAt: Date.now()
  }).ok, false, 'generic personal fields must still obey contract ranges');
  assert.strictEqual(data.setKnowledgeOverride(0, 'identity.displayName', {
    value: null, status: 'unknown', sourceType: 'unknown', confidence: 0, updatedAt: Date.now()
  }).ok, false, 'required identity fields must not be cleared');

  var inventory = data.upsertInventoryItem({
    teaId: 1, packageType: 'sample', packageLabel: '5g试饮装', status: 'opened', quantity: 1,
    netWeightPerUnit: 5, remainingWeight: 3, openedAt: Date.now()
  });
  assert.strictEqual(inventory.ok, true, inventory.error);
  assert.strictEqual(data.listInventory(1).length, 1);
  assert.strictEqual(data.deleteInventoryItem(inventory.item.id), true);
  assert.strictEqual(data.listInventory(1).length, 0, 'deleted inventory must remain a tombstone, not an active package');
  assert.strictEqual(data.load().inventory.length, 1);

  failPrimaryWrite = true;
  var failed = data.importTeaKnowledgePackage(importPackage);
  failPrimaryWrite = false;
  assert.strictEqual(failed.ok, false, 'a failed target write must report failure');
  assert.strictEqual(data.load().knowledgeBase.catalogVersion, 'research-v1', 'failed import must retain the active baseline');

  var synced = await data.sync();
  assert.strictEqual(synced.knowledgeBase.catalogVersion, 'research-v1', 'user-data sync must retain the local-only knowledge baseline');
  assert.ok(synced.knowledgeOverrides['1'], 'user overrides must survive the current cloud sync');
  assert.strictEqual(synced.inventory.length, 1, 'inventory tombstones must survive the current cloud sync');

  console.log('tea knowledge storage tests passed');
}

module.exports = run;