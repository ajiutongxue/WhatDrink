/**
 * syncData cloud function
 * Merges uploaded client data with existing cloud data.
 * Uses openid from WeChat context to identify users.
 *
 * Merge strategy:
 * - history: union deduplicated by date+teaId+type key
 * - profile: prefer incoming (local)
 * - settings: prefer incoming (local)
 * - llm: prefer incoming (local)
 * - teaLibrary: prefer incoming (local)
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
  // History: union by date+teaId+type dedup key
  var historyMap = new Map();

  var cloudHistory = (cloud && Array.isArray(cloud.history)) ? cloud.history : [];
  var localHistory = (local && Array.isArray(local.history)) ? local.history : [];

  // Add cloud entries first
  for (var i = 0; i < cloudHistory.length; i++) {
    var h = cloudHistory[i];
    if (h && h.date) {
      var key = h.date + '_' + (h.teaId || 0) + '_' + (h.type || 'unknown');
      historyMap.set(key, h);
    }
  }

  // Add local entries (overwrites cloud if same key, which is correct - local is preferred)
  for (var j = 0; j < localHistory.length; j++) {
    var lh = localHistory[j];
    if (lh && lh.date) {
      var lkey = lh.date + '_' + (lh.teaId || 0) + '_' + (lh.type || 'unknown');
      historyMap.set(lkey, lh);
    }
  }

  var mergedHistory = [];
  historyMap.forEach(function(val) {
    mergedHistory.push(val);
  });

  // Sort by date descending
  mergedHistory.sort(function(a, b) {
    return (b.date || '').localeCompare(a.date || '');
  });

  // Other fields: prefer incoming (local), fall back to cloud
  return {
    history: mergedHistory,
    profile: (local && local.profile && Object.keys(local.profile).length > 0)
      ? local.profile
      : (cloud.profile || {}),
    settings: (local && local.settings && Object.keys(local.settings).length > 0)
      ? local.settings
      : (cloud.settings || {}),
    llm: (local && local.llm && Object.keys(local.llm).length > 0)
      ? local.llm
      : (cloud.llm || {}),
    teaLibrary: (local && Array.isArray(local.teaLibrary) && local.teaLibrary.length > 0)
      ? local.teaLibrary
      : (cloud.teaLibrary || [])
  };
}
