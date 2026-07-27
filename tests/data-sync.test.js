'use strict';

var assert = require('assert');
var Module = require('module');

function loadCloudMerge() {
  var originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init: function() {}
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../cloudfunctions/syncData/index')];
    return require('../cloudfunctions/syncData/index')._test;
  } finally {
    Module._load = originalLoad;
  }
}

function baseData(library, updatedAt) {
  return {
    profile: {},
    history: [],
    temporaryAvoids: {},
    settings: {},
    llm: {},
    teaLibrary: library,
    teaLibraryUpdatedAt: updatedAt
  };
}

async function run() {
  var cloudMerge = loadCloudMerge();
  var cloudLibrary = [{ id: 1, name: 'cloud' }, { id: 2, name: 'cloud-2' }];
  var localLibrary = [{ id: 2, name: 'local-2' }];

  var localWins = cloudMerge.mergeData(
    baseData(cloudLibrary, 100),
    baseData(localLibrary, 200)
  );
  assert.deepStrictEqual(localWins.teaLibrary, localLibrary, 'newer local edit/deletion/order must win');
  assert.strictEqual(localWins.teaLibraryUpdatedAt, 200);

  var cloudWins = cloudMerge.mergeData(
    baseData(cloudLibrary, 300),
    baseData(localLibrary, 200)
  );
  assert.deepStrictEqual(cloudWins.teaLibrary, cloudLibrary, 'newer cloud snapshot must restore locally');
  assert.strictEqual(cloudWins.teaLibraryUpdatedAt, 300);

  var tieRestoresCloud = cloudMerge.mergeData(
    baseData(cloudLibrary, 0),
    baseData(localLibrary, 0)
  );
  assert.deepStrictEqual(tieRestoresCloud.teaLibrary, cloudLibrary, 'fresh/legacy tie must prefer cloud');

  var cloudProfileState = baseData(cloudLibrary, 100);
  cloudProfileState.profile = { city: '杭州', quizAnswers: {} };
  cloudProfileState.profileUpdatedAt = 300;
  cloudProfileState.settings = { avoidDays: 3 };
  cloudProfileState.settingsUpdatedAt = 100;
  var localProfileState = baseData(localLibrary, 200);
  localProfileState.profile = { city: '上海', quizAnswers: {} };
  localProfileState.profileUpdatedAt = 200;
  localProfileState.settings = { avoidDays: 9 };
  localProfileState.settingsUpdatedAt = 400;

  var versionedObjects = cloudMerge.mergeData(cloudProfileState, localProfileState);
  assert.strictEqual(versionedObjects.profile.city, '杭州', 'newer cloud profile must win');
  assert.strictEqual(versionedObjects.profileUpdatedAt, 300);
  assert.strictEqual(versionedObjects.settings.avoidDays, 9, 'newer local settings must win');
  assert.strictEqual(versionedObjects.settingsUpdatedAt, 400);

  var profileTie = cloudMerge.mergeVersionedObject(
    { city: '云端' }, 0,
    { city: '本地默认' }, 0
  );
  assert.strictEqual(profileTie.value.city, '云端', 'profile/settings ties must prefer cloud');

  var historyCloud = baseData(cloudLibrary, 100);
  historyCloud.history = [{ id: 'a', date: '2026-07-27', teaId: 1, type: 'primary', updatedAt: 100, tastingNotes: 'old' }];
  historyCloud.temporaryAvoids = { '1': { active: true, expiresAt: 9999, updatedAt: 100 } };
  var historyLocal = baseData(localLibrary, 200);
  historyLocal.history = [
    { id: 'a', date: '2026-07-27', teaId: 1, type: 'primary', updatedAt: 200, tastingNotes: 'new', noteAnalysis: { explicitSentiment: 'positive' } },
    { id: 'b', date: '2026-07-27', teaId: 1, type: 'primary', updatedAt: 150 }
  ];
  historyLocal.temporaryAvoids = { '1': { active: false, updatedAt: 300 } };
  var eventMerge = cloudMerge.mergeData(historyCloud, historyLocal);
  assert.strictEqual(eventMerge.history.length, 2, 'stable IDs must preserve multiple same-day sessions of the same tea and type');
  assert.strictEqual(eventMerge.history.filter(function(h){ return h.id === 'a'; })[0].tastingNotes, 'new', 'newer history entry including analysis must win as a unit');
  assert.strictEqual(eventMerge.temporaryAvoids['1'].active, false, 'newer cancellation tombstone must restore recommendation across devices');

  var stored = null;
  var rawLocal = baseData(localLibrary, 500);
  rawLocal.profile = { city: '客户端旧档案', quizAnswers: {} };
  rawLocal.profileUpdatedAt = 600;
  rawLocal.settings = { avoidDays: 9 };
  rawLocal.settingsUpdatedAt = 800;
  global.wx = {
    getStorageSync: function() { return rawLocal; },
    setStorageSync: function(key, value) { if (key === 'tea_doctor_v1') stored = value; },
    cloud: {
      database: function() { return {}; },
      callFunction: function(options) {
        var serverData = baseData(cloudLibrary, 400);
        serverData.profile = { city: '服务端新档案', quizAnswers: {} };
        serverData.profileUpdatedAt = 700;
        serverData.settings = { avoidDays: 3 };
        serverData.settingsUpdatedAt = 700;
        options.success({ result: { success: true, data: serverData } });
      }
    }
  };

  delete require.cache[require.resolve('../utils/data')];
  var clientData = require('../utils/data');
  var clientMerged = await clientData.sync();
  assert.deepStrictEqual(clientMerged.teaLibrary, localLibrary, 'client merge must preserve newer local snapshot');
  assert.strictEqual(clientMerged.teaLibraryUpdatedAt, 500);
  assert.strictEqual(clientMerged.profile.city, '服务端新档案', 'client must accept newer cloud profile');
  assert.strictEqual(clientMerged.profileUpdatedAt, 700);
  assert.strictEqual(clientMerged.settings.avoidDays, 9, 'client must preserve newer local settings');
  assert.strictEqual(clientMerged.settingsUpdatedAt, 800);
  assert.deepStrictEqual(stored.teaLibrary, localLibrary, 'persisted client data must match merged snapshot');
  assert.strictEqual(stored.profile.city, '服务端新档案', 'persisted profile must match merged snapshot');

  var defaults = clientData.getDefaultData();
  rawLocal = defaults;
  var loadedDefaults = clientData.load();
  assert.strictEqual(loadedDefaults.profileUpdatedAt, 0, 'untouched profile must not claim a local edit');
  assert.strictEqual(loadedDefaults.settingsUpdatedAt, 0, 'untouched settings must not claim a local edit');
  assert.strictEqual(loadedDefaults.teaLibraryUpdatedAt, 0, 'untouched defaults must not claim a local edit');

  rawLocal = clientData.getDefaultData();
  rawLocal.profile.city = 'legacy city';
  assert.strictEqual(clientData.load().profileUpdatedAt, 0, 'legacy profile must defer to cloud on first versioned sync');

  rawLocal = clientData.getDefaultData();
  rawLocal.settings.avoidDays = 8;
  assert.strictEqual(clientData.load().settingsUpdatedAt, 0, 'legacy settings must defer to cloud on first versioned sync');

  rawLocal = clientData.getDefaultData();
  rawLocal.teaLibrary[0].name = 'legacy local edit';
  assert.ok(clientData.load().teaLibraryUpdatedAt > 0, 'legacy customized library must be migrated');

  console.log('data-sync tests passed');
}

module.exports = run;

if (require.main === module) {
  run().catch(function(err) {
    console.error(err);
    process.exitCode = 1;
  });
}