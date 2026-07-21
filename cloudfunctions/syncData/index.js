/**
 * syncData cloud function
 * Merges uploaded client data with existing cloud data.
 * Uses openid from WeChat context to identify users.
 *
 * Merge strategy:
 * - history: union by date+teaId+type, local wins for same key (newer tastingNotes)
 * - profile: field-level merge, incoming (local) preferred for non-empty values
 * - settings: field-level merge, incoming (local) preferred
 * - llm: field-level merge, incoming (local) preferred for non-empty strings and booleans
 * - teaLibrary: union by id, cloud wins for duplicates
 */

var cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async function(event, context) {
  var wxContext = cloud.getWXContext();
  var openid = wxContext.OPENID;

  if (!openid) {
    return { success: false, error: 'No openid in context' };
  }

  var incomingData = event.data;
  if (!incomingData || typeof incomingData !== 'object') {
    return { success: false, error: 'No data provided' };
  }

  var db = cloud.database();
  var collection = db.collection('tea_doctor');

  // Ensure collection exists — createCollection is idempotent-safe via try/catch
  // (errors when collection already exists, which we ignore)
  try {
    await db.createCollection('tea_doctor');
  } catch (e) {
    // Already exists or no permission — proceed, the get below will surface real errors
  }

  try {
    // Find existing document for this user
    var existing = await collection.where({ _openid: openid }).get();

    if (!existing.data || existing.data.length === 0) {
      // First sync: create new document
      var newDoc = {
        _openid: openid,
        profile: incomingData.profile || {},
        history: Array.isArray(incomingData.history) ? incomingData.history : [],
        settings: incomingData.settings || {},
        llm: incomingData.llm || {},
        teaLibrary: Array.isArray(incomingData.teaLibrary) ? incomingData.teaLibrary : [],
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      };

      var addResult = await collection.add({ data: newDoc });
      return { success: true, data: newDoc, docId: addResult._id };
    }

    // Existing document: merge
    var cloudDoc = existing.data[0];
    var cloudData = {
      profile: cloudDoc.profile || {},
      history: Array.isArray(cloudDoc.history) ? cloudDoc.history : [],
      settings: cloudDoc.settings || {},
      llm: cloudDoc.llm || {},
      teaLibrary: Array.isArray(cloudDoc.teaLibrary) ? cloudDoc.teaLibrary : []
    };

    var merged = mergeData(cloudData, incomingData);

    // Update the document
    await collection.doc(cloudDoc._id).update({
      data: {
        profile: merged.profile,
        history: merged.history,
        settings: merged.settings,
        llm: merged.llm,
        teaLibrary: merged.teaLibrary,
        updatedAt: db.serverDate()
      }
    });

    return { success: true, data: merged };
  } catch (err) {
    console.error('[syncData] Error:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
};

/**
 * Merge cloud data with incoming local data.
 *
 * Strategy:
 * - history: union deduplicated by date+teaId+type
 * - profile/settings/llm/teaLibrary: prefer incoming (local) if present
 *
 * @param {Object} cloud - Existing cloud data
 * @param {Object} local - Incoming local data
 * @returns {Object} Merged data
 */
function mergeData(cloud, local) {
  // History: union by date+teaId+type, local wins for same key
  // (local may carry newer tastingNotes just edited by user)
  var historyMap = new Map();

  var cloudHistory = (cloud && Array.isArray(cloud.history)) ? cloud.history : [];
  var localHistory = (local && Array.isArray(local.history)) ? local.history : [];

  cloudHistory.forEach(function(h) {
    if (h && h.date) {
      var key = h.date + '_' + (h.teaId || 0) + '_' + (h.type || 'unknown');
      historyMap.set(key, h);
    }
  });
  localHistory.forEach(function(h) {
    if (h && h.date) {
      var key = h.date + '_' + (h.teaId || 0) + '_' + (h.type || 'unknown');
      var existing = historyMap.get(key);
      if (existing) {
        // Keep cloud tastingNotes if local doesn't have one
        if (!h.tastingNotes && existing.tastingNotes) {
          h.tastingNotes = existing.tastingNotes;
        }
        // Keep cloud imageFileIDs if local doesn't have any
        if ((!h.imageFileIDs || h.imageFileIDs.length === 0) && existing.imageFileIDs && existing.imageFileIDs.length > 0) {
          h.imageFileIDs = existing.imageFileIDs;
        }
      }
      historyMap.set(key, h);
    }
  });

  var mergedHistory = [];
  historyMap.forEach(function(val) { mergedHistory.push(val); });
  mergedHistory.sort(function(a, b) {
    return (b.date || '').localeCompare(a.date || '');
  });

  return {
    history: mergedHistory,
    profile: mergeProfile(cloud.profile || {}, local.profile || {}),
    settings: mergeSettings(cloud.settings || {}, local.settings || {}),
    llm: mergeLLM(cloud.llm || {}, local.llm || {}),
    teaLibrary: mergeTeaLibrary(cloud.teaLibrary || [], local.teaLibrary || [])
  };
}

// Field-level profile merge: incoming (local) preferred.
// Non-empty incoming value overrides cloud; empty incoming falls back to cloud.
function mergeProfile(cloud, local) {
  var result = {};
  var keys = ['gender', 'age', 'city', 'constitution'];
  keys.forEach(function(k) {
    if (local[k] !== undefined && local[k] !== null && local[k] !== '') {
      result[k] = local[k];
    } else if (cloud[k] !== undefined && cloud[k] !== null && cloud[k] !== '') {
      result[k] = cloud[k];
    } else {
      result[k] = local[k] !== undefined ? local[k] : cloud[k];
    }
  });
  var cqa = cloud.quizAnswers || {}, lqa = local.quizAnswers || {};
  result.quizAnswers = {};
  for (var lk in lqa) if (lqa.hasOwnProperty(lk)) result.quizAnswers[lk] = lqa[lk];
  for (var ck in cqa) if (cqa.hasOwnProperty(ck) && result.quizAnswers[ck] === undefined) {
    result.quizAnswers[ck] = cqa[ck];
  }
  return result;
}

function mergeSettings(cloud, local) {
  var avoidDays = (typeof local.avoidDays === 'number' && local.avoidDays > 0)
    ? local.avoidDays
    : ((typeof cloud.avoidDays === 'number' && cloud.avoidDays > 0) ? cloud.avoidDays : 5);
  return { avoidDays: avoidDays };
}

function mergeLLM(cloud, local) {
  var result = {};
  // 本地优先：客户端推上来的非空值覆盖云端旧值（为空时回落到云端，避免空值误清）
  var strKeys = ['apiKey', 'endpoint', 'recModel', 'parserModel'];
  strKeys.forEach(function(k) {
    if (local[k]) result[k] = local[k];
    else if (cloud[k]) result[k] = cloud[k];
    else result[k] = local[k] !== undefined ? local[k] : cloud[k];
  });
  result.enabled = (typeof local.enabled === 'boolean')
    ? local.enabled
    : ((typeof cloud.enabled === 'boolean') ? cloud.enabled : false);
  result.parserEnabled = (typeof local.parserEnabled === 'boolean')
    ? local.parserEnabled
    : ((typeof cloud.parserEnabled === 'boolean') ? cloud.parserEnabled : false);
  return result;
}

// Tea library: union by id, cloud wins for duplicates.
function mergeTeaLibrary(cloud, local) {
  var map = {};
  var order = [];
  cloud.forEach(function(t) {
    if (t && t.id !== undefined && map[t.id] === undefined) {
      map[t.id] = t;
      order.push(t.id);
    }
  });
  local.forEach(function(t) {
    if (t && t.id !== undefined && map[t.id] === undefined) {
      map[t.id] = t;
      order.push(t.id);
    }
  });
  var result = [];
  order.forEach(function(id) { result.push(map[id]); });
  return result.length > 0 ? result : local;
}
