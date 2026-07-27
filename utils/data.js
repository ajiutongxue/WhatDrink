/**
 * data.js - Unified data layer
 * Local cache (wx.setStorageSync) + cloud sync (wx.cloud.database)
 * CommonJS module for WeChat Mini Program
 */

var teaData = require('./teaData');

var STORAGE_KEY = 'tea_doctor_v1';
var CLOUD_COLLECTION = 'tea_doctor';
var DEBOUNCE_MS = 2000;

var _saveTimer = null;

// ============================================================
// Default data factory
// ============================================================

/**
 * Returns a fresh default AppData object with initial tea library.
 * @returns {Object} AppData
 */
function getDefaultData() {
  // Deep clone teas so each default is independent
  var teas = [];
  for (var i = 0; i < teaData.TEAS.length; i++) {
    var t = teaData.TEAS[i];
    teas.push({
      id: t.id,
      name: t.name,
      brand: t.brand,
      cat: t.cat,
      year: t.year,
      nature: t.nature,
      baseNature: t.baseNature,
      caffeine: t.caffeine,
      seasons: t.seasons.slice(),
      avoidSeasons: t.avoidSeasons ? t.avoidSeasons.slice() : [],
      note: t.note || ''
    });
  }

  return {
    profile: {
      gender: '',
      age: '',
      city: '',
      constitution: null,
      quizAnswers: {}
    },
    profileUpdatedAt: 0,
    history: [],
    temporaryAvoids: {},
    settings: {
      avoidDays: 5
    },
    settingsUpdatedAt: 0,
    llm: {
      enabled: false,
      apiKey: '',
      endpoint: '',
      recModel: 'deepseek-v4-pro',
      parserModel: 'deepseek-v4-pro',
      parserEnabled: false,
      noteAnalysisEnabled: true
    },
    teaLibrary: teas,
    // Whole-library last-write-wins version. Keeping this at 0 for a fresh
    // install prevents the built-in defaults from overwriting a restored
    // cloud library.
    teaLibraryUpdatedAt: 0
  };
}

// ============================================================
// Core API
// ============================================================

/**
 * Load data synchronously from local cache.
 * Returns default data if nothing is cached.
 * @returns {Object} AppData
 */
function load() {
  try {
    var raw = wx.getStorageSync(STORAGE_KEY);
    if (raw && typeof raw === 'object' && raw.teaLibrary) {
      // Ensure all expected top-level keys exist
      var defaults = getDefaultData();
      var library = Array.isArray(raw.teaLibrary) && raw.teaLibrary.length > 0
        ? raw.teaLibrary
        : defaults.teaLibrary;
      var profile = _merge(defaults.profile, raw.profile);
      var settings = _merge(defaults.settings, raw.settings);
      var profileUpdatedAt = _validTimestamp(raw.profileUpdatedAt);
      var settingsUpdatedAt = _validTimestamp(raw.settingsUpdatedAt);
      var libraryUpdatedAt = _validTimestamp(raw.teaLibraryUpdatedAt);


      // Migration for data created before teaLibraryUpdatedAt existed.
      // Only a library that differs from the built-in defaults is considered
      // a local edit. An untouched default library stays at version 0 so a
      // custom cloud library can still restore onto a new device.
      if (!libraryUpdatedAt && !_isDefaultTeaLibrary(library)) {
        libraryUpdatedAt = Date.now();
      }

      return {
        profile: profile,
        profileUpdatedAt: profileUpdatedAt,
        history: Array.isArray(raw.history) ? raw.history : [],
        temporaryAvoids: raw.temporaryAvoids && typeof raw.temporaryAvoids === 'object' ? raw.temporaryAvoids : {},
        settings: settings,
        settingsUpdatedAt: settingsUpdatedAt,
        llm: _merge(defaults.llm, raw.llm),
        teaLibrary: library,
        teaLibraryUpdatedAt: libraryUpdatedAt
      };
    }
  } catch (e) {
    console.warn('[data] load error:', e);
  }
  return getDefaultData();
}

/**
 * Save data: writes to local cache immediately,
 * then debounces a cloud push (2 seconds).
 * @param {Object} data - AppData to persist
 */
function save(data) {
  if (!data || typeof data !== 'object') return;

  try {
    wx.setStorageSync(STORAGE_KEY, data);
  } catch (e) {
    console.error('[data] local save error:', e);
    return;
  }

  // Debounced cloud push
  if (_saveTimer) {
    clearTimeout(_saveTimer);
  }
  _saveTimer = setTimeout(function() {
    _pushToCloud(data);
    _saveTimer = null;
  }, DEBOUNCE_MS);
}

/**
 * Async sync: pull cloud data, merge with local, save merged result.
 * Call on app launch.
 * @returns {Promise<Object>} Merged AppData
 */
function sync() {
  return new Promise(function(resolve, reject) {
    var local = load();

    if (!_cloudAvailable()) {
      reject(new Error('云开发不可用'));
      return;
    }

    var db;
    try {
      db = wx.cloud.database();
    } catch (e) {
      reject(new Error('云数据库初始化失败'));
      return;
    }

    // Call cloud function to merge
    wx.cloud.callFunction({
      name: 'syncData',
      data: { data: local },
      success: function(res) {
        if (res && res.result && res.result.success && res.result.data) {
          var merged = _mergeData(res.result.data, local);
          save(merged);
          _setLastSyncTime(Date.now());
          resolve(merged);
        } else {
          var msg = (res && res.result && res.result.error) || '云函数返回失败';
          reject(new Error(msg));
        }
      },
      fail: function(err) {
        console.warn('[data] sync cloud function failed:', err);
        reject(new Error(err.errMsg || '云函数调用失败'));
      }
    });
  });
}

/**
 * Export current data as a JSON string.
 * @returns {string}
 */
function exportJSON() {
  try {
    var data = load();
    return JSON.stringify(data, null, 2);
  } catch (e) {
    console.error('[data] export error:', e);
    return '{}';
  }
}

/**
 * Import data from a JSON string.
 * Validates basic structure before writing.
 * @param {string} json
 * @returns {boolean} true if import succeeded
 */
function importJSON(json) {
  if (!json || typeof json !== 'string') return false;

  try {
    var parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return false;

    // Validate minimum structure: must have teaLibrary or history
    if (!Array.isArray(parsed.teaLibrary) && !Array.isArray(parsed.history)) {
      console.warn('[data] import: invalid structure');
      return false;
    }

    // Merge with defaults to fill missing fields
    var defaults = getDefaultData();
    var data = {
      profile: _merge(defaults.profile, parsed.profile),
      profileUpdatedAt: parsed.profile && typeof parsed.profile === 'object' ? Date.now() : 0,
      history: Array.isArray(parsed.history) ? parsed.history : [],
      temporaryAvoids: parsed.temporaryAvoids && typeof parsed.temporaryAvoids === 'object' ? parsed.temporaryAvoids : {},
      settings: _merge(defaults.settings, parsed.settings),
      settingsUpdatedAt: parsed.settings && typeof parsed.settings === 'object' ? Date.now() : 0,
      llm: _merge(defaults.llm, parsed.llm),
      teaLibrary: Array.isArray(parsed.teaLibrary) && parsed.teaLibrary.length > 0
        ? parsed.teaLibrary
        : defaults.teaLibrary,
      // Importing a library is an explicit local replacement and must win
      // over an older cloud snapshot on the next sync.
      teaLibraryUpdatedAt: Array.isArray(parsed.teaLibrary) && parsed.teaLibrary.length > 0
        ? Date.now()
        : 0
    };

    save(data);
    return true;
  } catch (e) {
    console.error('[data] import error:', e);
    return false;
  }
}

/**
 * Reset all data to defaults.
 */
function reset() {
  var defaults = getDefaultData();
  // Reset is an intentional change, not a fresh-install default.
  var now = Date.now();
  defaults.profileUpdatedAt = now;
  defaults.settingsUpdatedAt = now;
  defaults.teaLibraryUpdatedAt = now;
  save(defaults);
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Simple shallow merge: target properties overridden by source (if defined).
 * @param {Object} target
 * @param {Object} source
 * @returns {Object}
 */
function _merge(target, source) {
  if (!source || typeof source !== 'object') return _clone(target);
  if (!target || typeof target !== 'object') return _clone(source);

  var result = {};
  var key;
  for (key in target) {
    if (target.hasOwnProperty(key)) {
      result[key] = target[key];
    }
  }
  for (key in source) {
    if (source.hasOwnProperty(key) && source[key] !== undefined && source[key] !== null) {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Shallow clone a plain object.
 */
function _clone(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.slice();
  var result = {};
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Check if cloud development is available.
 */
function _cloudAvailable() {
  try {
    return !!(wx.cloud && wx.cloud.database);
  } catch (e) {
    return false;
  }
}

/**
 * Push data to cloud via the syncData cloud function.
 * Fire-and-forget; errors are logged but not surfaced.
 * @param {Object} data
 */
function _pushToCloud(data) {
  if (!_cloudAvailable()) return;

  wx.cloud.callFunction({
    name: 'syncData',
    data: { data: data },
    success: function() {
      // Cloud push succeeded, nothing else to do
    },
    fail: function(err) {
      console.warn('[data] cloud push failed:', err);
    }
  });
}

/**
 * Merge cloud data with local data (client-side merge for sync).
 * History: union deduplicated by date+teaId+type.
 * Other fields: prefer cloud (incoming).
 * @param {Object} cloudData
 * @param {Object} localData
 * @returns {Object}
 */
function _mergeData(cloudData, localData) {
  if (!cloudData) return localData;
  if (!localData) return cloudData;

  var mergedHistory = _mergeHistory(cloudData.history, localData.history);
  var mergedTemporaryAvoids = _mergeTemporaryAvoids(cloudData.temporaryAvoids, localData.temporaryAvoids);

  var profileVersion = _mergeVersionedObject(
    cloudData.profile,
    cloudData.profileUpdatedAt,
    localData.profile,
    localData.profileUpdatedAt
  );
  var settingsVersion = _mergeVersionedObject(
    cloudData.settings,
    cloudData.settingsUpdatedAt,
    localData.settings,
    localData.settingsUpdatedAt
  );
  var libraryVersion = _mergeTeaLibrary(
    cloudData.teaLibrary,
    cloudData.teaLibraryUpdatedAt,
    localData.teaLibrary,
    localData.teaLibraryUpdatedAt
  );

  return {
    profile: profileVersion.value,
    profileUpdatedAt: profileVersion.updatedAt,
    history: mergedHistory,
    temporaryAvoids: mergedTemporaryAvoids,
    settings: settingsVersion.value,
    settingsUpdatedAt: settingsVersion.updatedAt,
    llm: _mergeLLM(cloudData.llm, localData.llm),
    teaLibrary: libraryVersion.library,
    teaLibraryUpdatedAt: libraryVersion.updatedAt
  };
}

function _historyKey(h) {
  if (h && h.id) return 'id_' + h.id;
  return 'legacy_' + ((h && h.date) || '') + '_' + ((h && h.teaId) || 0) + '_' + ((h && h.type) || 'unknown');
}

function _mergeHistory(cloud, local) {
  var map = {};
  var cloudList = Array.isArray(cloud) ? cloud : [];
  var localList = Array.isArray(local) ? local : [];
  cloudList.forEach(function(h) {
    if (h && h.date) map[_historyKey(h)] = h;
  });
  localList.forEach(function(h) {
    if (!h || !h.date) return;
    var key = _historyKey(h);
    var existing = map[key];
    if (!existing) { map[key] = h; return; }
    var cloudTs = _validTimestamp(existing.updatedAt);
    var localTs = _validTimestamp(h.updatedAt);
    if (cloudTs || localTs) {
      map[key] = localTs >= cloudTs ? h : existing;
      return;
    }
    if (!h.tastingNotes && existing.tastingNotes) h.tastingNotes = existing.tastingNotes;
    if ((!h.imageFileIDs || h.imageFileIDs.length === 0) && existing.imageFileIDs && existing.imageFileIDs.length > 0) {
      h.imageFileIDs = existing.imageFileIDs;
    }
    map[key] = h;
  });
  return Object.keys(map).map(function(key) { return map[key]; }).sort(function(a, b) {
    var dateCmp = (b.date || '').localeCompare(a.date || '');
    if (dateCmp) return dateCmp;
    return (_validTimestamp(b.updatedAt) - _validTimestamp(a.updatedAt));
  });
}

function _mergeTemporaryAvoids(cloud, local) {
  var result = {};
  var c = cloud && typeof cloud === 'object' ? cloud : {};
  var l = local && typeof local === 'object' ? local : {};
  Object.keys(c).forEach(function(key) { result[key] = c[key]; });
  Object.keys(l).forEach(function(key) {
    var cv = result[key] || {};
    var lv = l[key] || {};
    if (_validTimestamp(lv.updatedAt) >= _validTimestamp(cv.updatedAt)) result[key] = lv;
  });
  return result;
}

/**
 * Select a complete object snapshot by version. Cloud wins a tie so an
 * untouched fresh-device default cannot overwrite previously synced data.
 */
function _mergeVersionedObject(cloud, cloudUpdatedAt, local, localUpdatedAt) {
  var c = cloud && typeof cloud === 'object' ? cloud : {};
  var l = local && typeof local === 'object' ? local : {};
  var cloudTs = _validTimestamp(cloudUpdatedAt);
  var localTs = _validTimestamp(localUpdatedAt);

  if (Object.keys(c).length === 0 && Object.keys(l).length > 0) {
    return { value: l, updatedAt: localTs };
  }
  if (Object.keys(l).length === 0 && Object.keys(c).length > 0) {
    return { value: c, updatedAt: cloudTs };
  }
  if (localTs > cloudTs) {
    return { value: l, updatedAt: localTs };
  }
  return { value: c, updatedAt: cloudTs };
}

function _mergeLLM(cloud, local) {
  var c = cloud || {}, l = local || {};
  var result = {};
  // 本地优先：非空的本地值覆盖云端（本地为空时回落到云端，避免空值误清）
  var strKeys = ['apiKey', 'endpoint', 'recModel', 'parserModel'];
  strKeys.forEach(function(k) {
    if (l[k]) result[k] = l[k];
    else if (c[k]) result[k] = c[k];
    else result[k] = l[k] !== undefined ? l[k] : c[k];
  });
  result.enabled = (typeof l.enabled === 'boolean')
    ? l.enabled
    : ((typeof c.enabled === 'boolean') ? c.enabled : false);
  result.parserEnabled = (typeof l.parserEnabled === 'boolean')
    ? l.parserEnabled
    : ((typeof c.parserEnabled === 'boolean') ? c.parserEnabled : false);
  result.noteAnalysisEnabled = (typeof l.noteAnalysisEnabled === 'boolean')
    ? l.noteAnalysisEnabled
    : ((typeof c.noteAnalysisEnabled === 'boolean') ? c.noteAnalysisEnabled : true);
  return result;
}

/**
 * Tea library is an ordered, editable snapshot. Merge it as a whole using a
 * last-write-wins timestamp so edits, deletions and ordering stay consistent.
 * On equal/missing versions cloud wins, which lets a fresh device restore.
 */
function _mergeTeaLibrary(cloud, cloudUpdatedAt, local, localUpdatedAt) {
  var cl = Array.isArray(cloud) ? cloud : [];
  var ll = Array.isArray(local) ? local : [];
  var cloudTs = _validTimestamp(cloudUpdatedAt);
  var localTs = _validTimestamp(localUpdatedAt);

  if (cl.length === 0 && ll.length > 0) {
    return { library: ll, updatedAt: localTs };
  }
  if (ll.length === 0 && cl.length > 0) {
    return { library: cl, updatedAt: cloudTs };
  }
  if (localTs > cloudTs) {
    return { library: ll, updatedAt: localTs };
  }
  return { library: cl, updatedAt: cloudTs };
}

function _validTimestamp(value) {
  return (typeof value === 'number' && isFinite(value) && value > 0)
    ? value
    : 0;
}


/**
 * Compare legacy local data with the bundled library without relying on
 * object key order. A disabled tea or changed field/order counts as an edit.
 */
function _isDefaultTeaLibrary(library) {
  if (!Array.isArray(library) || library.length !== teaData.TEAS.length) return false;
  for (var i = 0; i < library.length; i++) {
    var actual = library[i] || {};
    var expected = teaData.TEAS[i] || {};
    var fields = [
      'id', 'name', 'brand', 'cat', 'year', 'nature',
      'baseNature', 'caffeine', 'note'
    ];
    for (var f = 0; f < fields.length; f++) {
      var key = fields[f];
      if ((actual[key] || '') !== (expected[key] || '')) return false;
    }
    if (!!actual.disabled) return false;
    if (!_sameArray(actual.seasons, expected.seasons)) return false;
    if (!_sameArray(actual.avoidSeasons, expected.avoidSeasons)) return false;
  }
  return true;
}

function _sameArray(a, b) {
  var left = Array.isArray(a) ? a : [];
  var right = Array.isArray(b) ? b : [];
  if (left.length !== right.length) return false;
  for (var i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

/**
 * Persist last successful sync time in a dedicated storage key.
 * Kept separate from AppData so it survives reset() and isn't synced itself.
 */
var LAST_SYNC_KEY = 'tea_doctor_last_sync';

function _getLastSyncTime() {
  try { return wx.getStorageSync(LAST_SYNC_KEY) || 0; } catch (e) { return 0; }
}

function _setLastSyncTime(t) {
  try { wx.setStorageSync(LAST_SYNC_KEY, t); } catch (e) {}
}

module.exports = {
  load: load,
  save: save,
  sync: sync,
  exportJSON: exportJSON,
  importJSON: importJSON,
  reset: reset,
  getDefaultData: getDefaultData,
  getLastSyncTime: function() { return _getLastSyncTime(); }
};
