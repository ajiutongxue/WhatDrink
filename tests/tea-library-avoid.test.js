'use strict';

var assert = require('assert');
var Module = require('module');
var teaData = require('../utils/teaData');

function loadTeaLibraryPage(dataStub) {
  var originalLoad = Module._load;
  var pageConfig = null;
  global.Page = function(config) { pageConfig = config; };
  Module._load = function(request, parent, isMain) {
    if (request === '../../utils/data') return dataStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve('../pages/teaLib/teaLib')];
    require('../pages/teaLib/teaLib');
  } finally {
    Module._load = originalLoad;
    delete global.Page;
  }
  return pageConfig;
}

function setByPath(target, path, value) {
  var parts = path.split('.');
  var current = target;
  for (var i = 0; i < parts.length - 1; i++) current = current[parts[i]];
  current[parts[parts.length - 1]] = value;
}

function testTeaLibraryAvoidToggle() {
  var tea = JSON.parse(JSON.stringify(teaData.TEAS.filter(function(item) { return item.id === 12; })[0]));
  var originalExpiry = Date.now() + 86400000;
  var appData = {
    teaLibrary: [tea], history: [],
    temporaryAvoids: { '12': { active: true, markedAt: 100, expiresAt: originalExpiry, updatedAt: 100 } },
    teaLibraryUpdatedAt: 0
  };
  var saved = null;
  var dataStub = {
    load: function() { return appData; },
    save: function(value) { saved = value; }
  };
  var config = loadTeaLibraryPage(dataStub);
  var page = Object.create(config);
  page.data = JSON.parse(JSON.stringify(config.data));
  page._appData = appData;
  page._allTeas = appData.teaLibrary;
  page._applyFilter = function() {};
  page._buildFlatList = function() {};
  page.setData = function(update) {
    var self = this;
    Object.keys(update).forEach(function(key) { setByPath(self.data, key, update[key]); });
  };
  global.wx = { showToast: function() {} };

  page.onEditTea({ currentTarget: { dataset: { id: 12 } } });
  assert.strictEqual(page.data.form.temporarilyAvoided, true, 'edit form should load the active shared avoid state');
  page.onFormSave();
  assert.strictEqual(appData.temporaryAvoids['12'].expiresAt, originalExpiry, 'ordinary tea edits must not extend an existing avoid');

  page.onEditTea({ currentTarget: { dataset: { id: 12 } } });
  page.onAvoidChange({ detail: { value: false } });
  assert.strictEqual(appData.temporaryAvoids['12'].active, true, 'toggle changes must wait for Save');
  page.onFormSave();
  assert.strictEqual(saved.temporaryAvoids['12'].active, false, 'Save should persist an inactive tombstone');

  delete global.wx;
}

module.exports = async function run() {
  testTeaLibraryAvoidToggle();
  console.log('tea library avoid tests passed');
};
