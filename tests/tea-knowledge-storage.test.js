'use strict';

var assert = require('assert');
var importPackage = require('../data/tea-knowledge.import-v1.json');
var runtimeCatalog = require('../data/teaKnowledgeCatalog');
assert.deepStrictEqual(runtimeCatalog, importPackage, 'generated runtime catalog must stay in sync with the import package');

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
  var defaults = data.getDefaultData();
  assert.strictEqual(defaults.knowledgeBase.catalogVersion, 'research-v1', 'fresh installs must include the built-in knowledge catalog');
  assert.strictEqual(Object.keys(defaults.knowledgeBase.profilesByTeaId).length, 86);
  storage.tea_doctor_v1 = clone(defaults);
  storage.tea_doctor_v1.knowledgeBase = { profilesByTeaId: {} };
  assert.strictEqual(Object.keys(data.load().knowledgeBase.profilesByTeaId).length, 86, 'legacy or cleared empty baselines must recover from the built-in catalog');

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
  assert.strictEqual(rolledBack.knowledgeBase.catalogVersion, 'research-v1');
  assert.strictEqual(Object.keys(rolledBack.knowledgeBase.profilesByTeaId).length, 86, 'rollback must never leave the app without its built-in baseline');

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
    teaId: 1, packageType: 'retail', packageLabel: '100g袋装', status: 'sealed', quantity: 2,
    netWeightPerUnit: 100, remainingSessions: 10
  });
  assert.strictEqual(inventory.ok, true, inventory.error);
  var opened = data.openInventoryItem(inventory.item.id);
  assert.strictEqual(opened.ok, true, opened.error);
  assert.strictEqual(opened.split, true, 'opening one package from an aggregate must split a new physical record');
  assert.strictEqual(opened.item.status, 'opened');
  assert.strictEqual(opened.item.quantity, 1);
  assert.strictEqual(opened.item.remainingWeight, 100);
  var afterOpen = data.listInventory(1);
  assert.strictEqual(afterOpen.length, 2);
  assert.strictEqual(afterOpen.filter(function(item) { return item.status === 'sealed'; })[0].quantity, 1);

  var consumed = data.consumeInventorySession(opened.item.id);
  assert.strictEqual(consumed.ok, true, consumed.error);
  assert.strictEqual(consumed.item.remainingSessions, 9);
  var finished = data.finishInventoryItem(opened.item.id);
  assert.strictEqual(finished.ok, true, finished.error);
  assert.strictEqual(finished.item.status, 'finished');
  assert.strictEqual(finished.item.remainingSessions, 0);
  assert.strictEqual(finished.item.remainingWeight, 0);
  assert.strictEqual(data.consumeInventorySession(opened.item.id).ok, false, 'finished packages cannot be consumed again');
  assert.strictEqual(data.deleteInventoryItem(opened.item.id), true);
  assert.strictEqual(data.listInventory(1).length, 1, 'deleted inventory must remain a tombstone, not an active package');
  assert.strictEqual(data.load().inventory.length, 2);

  failPrimaryWrite = true;
  var failed = data.importTeaKnowledgePackage(importPackage);
  failPrimaryWrite = false;
  assert.strictEqual(failed.ok, false, 'a failed target write must report failure');
  assert.strictEqual(data.load().knowledgeBase.catalogVersion, 'research-v1', 'failed import must retain the active baseline');

  var synced = await data.sync();
  assert.strictEqual(synced.knowledgeBase.catalogVersion, 'research-v1', 'user-data sync must retain the local-only knowledge baseline');
  assert.ok(synced.knowledgeOverrides['1'], 'user overrides must survive the current cloud sync');
  assert.strictEqual(synced.inventory.length, 2, 'inventory records and tombstones must survive the current cloud sync');

  data.reset();
  var resetData = data.load();
  assert.strictEqual(Object.keys(resetData.knowledgeBase.profilesByTeaId).length, 86, 'resetting personal data must restore the built-in baseline');
  assert.deepStrictEqual(resetData.knowledgeOverrides, {}, 'reset must still clear personal knowledge overrides');
  assert.deepStrictEqual(resetData.inventory, [], 'reset must still clear personal inventory');

  console.log('tea knowledge storage tests passed');
}

module.exports = run;