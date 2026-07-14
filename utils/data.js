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
    history: [],
    settings: {
      avoidDays: 5
    },
    llm: {
      enabled: false,
      apiKey: '',
      endpoint: '',
      recModel: 'deepseek-v4-pro',
      parserModel: 'deepseek-v3',
      parserEnabled: false
    },
    teaLibrary: teas
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
      return {
        profile: _merge(defaults.profile, raw.profile),
        history: Array.isArray(raw.history) ? raw.history : [],
        settings: _merge(defaults.settings, raw.settings),
        llm: _merge(defaults.llm, raw.llm),
        teaLibrary: Array.isArray(raw.teaLibrary) && raw.teaLibrary.length > 0
          ? raw.teaLibrary
          : defaults.teaLibrary
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
  return new Promise(function(resolve) {
    var local = load();

    if (!_cloudAvailable()) {
      resolve(local);
      return;
    }

    var db;
    try {
      db = wx.cloud.database();
    } catch (e) {
      console.warn('[data] cloud db init failed:', e);
      resolve(local);
      return;
    }

    var collection = db.collection(CLOUD_COLLECTION);

    // Call cloud function to merge
    wx.cloud.callFunction({
      name: 'syncData',
      data: { data: local },
      success: function(res) {
        if (res && res.result && res.result.success && res.result.data) {
          var merged = _mergeData(res.result.data, local);
          save(merged);
          resolve(merged);
        } else {
          // Cloud function returned no usable data, just keep local
          resolve(local);
        }
      },
      fail: function(err) {
        console.warn('[data] sync cloud function failed:', err);
        resolve(local);
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
      history: Array.isArray(parsed.history) ? parsed.history : [],
      settings: _merge(defaults.settings, parsed.settings),
      llm: _merge(defaults.llm, parsed.llm),
      teaLibrary: Array.isArray(parsed.teaLibrary) && parsed.teaLibrary.length > 0
        ? parsed.teaLibrary
        : defaults.teaLibrary
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

  // History union
  var historyMap = {};
  var cloudHistory = Array.isArray(cloudData.history) ? cloudData.history : [];
  var localHistory = Array.isArray(localData.history) ? localData.history : [];
  var allHistory = cloudHistory.concat(localHistory);

  allHistory.forEach(function(h) {
    if (h && h.date) {
      var key = h.date + '_' + (h.teaId || 0) + '_' + (h.type || 'unknown');
      historyMap[key] = h;
    }
  });

  var mergedHistory = [];
  for (var k in historyMap) {
    if (historyMap.hasOwnProperty(k)) {
      mergedHistory.push(historyMap[k]);
    }
  }

  // Sort history by date descending
  mergedHistory.sort(function(a, b) {
    return (b.date || '').localeCompare(a.date || '');
  });

  return {
    profile: cloudData.profile || localData.profile,
    history: mergedHistory,
    settings: cloudData.settings || localData.settings,
    llm: cloudData.llm || localData.llm,
    teaLibrary: (Array.isArray(cloudData.teaLibrary) && cloudData.teaLibrary.length > 0)
      ? cloudData.teaLibrary
      : localData.teaLibrary
  };
}

module.exports = {
  load: load,
  save: save,
  sync: sync,
  exportJSON: exportJSON,
  importJSON: importJSON,
  reset: reset,
  getDefaultData: getDefaultData
};
