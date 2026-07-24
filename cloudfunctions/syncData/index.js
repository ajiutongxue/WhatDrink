/**
 * syncData cloud function
 * Merges uploaded client data with existing cloud data.
 * Uses openid from WeChat context to identify users.
 *
 * Merge strategy:
 * - history: union by date+teaId+type, local wins for same key (newer tastingNotes)
 * - profile: whole-object last-write-wins using profileUpdatedAt
 * - settings: whole-object last-write-wins using settingsUpdatedAt
 * - llm: field-level merge, incoming (local) preferred for non-empty strings and booleans
 * - teaLibrary: whole-library last-write-wins using teaLibraryUpdatedAt
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
        profileUpdatedAt: validTimestamp(incomingData.profileUpdatedAt),
        history: Array.isArray(incomingData.history) ? incomingData.history : [],
        settings: incomingData.settings || {},
        settingsUpdatedAt: validTimestamp(incomingData.settingsUpdatedAt),
        llm: incomingData.llm || {},
        teaLibrary: Array.isArray(incomingData.teaLibrary) ? incomingData.teaLibrary : [],
        teaLibraryUpdatedAt: validTimestamp(incomingData.teaLibraryUpdatedAt),
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
      profileUpdatedAt: validTimestamp(cloudDoc.profileUpdatedAt),
      history: Array.isArray(cloudDoc.history) ? cloudDoc.history : [],
      settings: cloudDoc.settings || {},
      settingsUpdatedAt: validTimestamp(cloudDoc.settingsUpdatedAt),
      llm: cloudDoc.llm || {},
      teaLibrary: Array.isArray(cloudDoc.teaLibrary) ? cloudDoc.teaLibrary : [],
      teaLibraryUpdatedAt: validTimestamp(cloudDoc.teaLibraryUpdatedAt)
    };

    var merged = mergeData(cloudData, incomingData);

    // Update the document
    await collection.doc(cloudDoc._id).update({
      data: {
        profile: merged.profile,
        profileUpdatedAt: merged.profileUpdatedAt,
        history: merged.history,
        settings: merged.settings,
        settingsUpdatedAt: merged.settingsUpdatedAt,
        llm: merged.llm,
        teaLibrary: merged.teaLibrary,
        teaLibraryUpdatedAt: merged.teaLibraryUpdatedAt,
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
 * - profile/settings: select the newer complete snapshot
 * - llm: prefer incoming (local) if present
 * - teaLibrary: select the newer ordered snapshot
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

  var profileVersion = mergeVersionedObject(
    cloud.profile,
    cloud.profileUpdatedAt,
    local.profile,
    local.profileUpdatedAt
  );
  var settingsVersion = mergeVersionedObject(
    cloud.settings,
    cloud.settingsUpdatedAt,
    local.settings,
    local.settingsUpdatedAt
  );
  var libraryVersion = mergeTeaLibrary(
    cloud.teaLibrary || [],
    cloud.teaLibraryUpdatedAt,
    local.teaLibrary || [],
    local.teaLibraryUpdatedAt
  );

  return {
    history: mergedHistory,
    profile: profileVersion.value,
    profileUpdatedAt: profileVersion.updatedAt,
    settings: settingsVersion.value,
    settingsUpdatedAt: settingsVersion.updatedAt,
    llm: mergeLLM(cloud.llm || {}, local.llm || {}),
    teaLibrary: libraryVersion.library,
    teaLibraryUpdatedAt: libraryVersion.updatedAt
  };
}

function mergeVersionedObject(cloud, cloudUpdatedAt, local, localUpdatedAt) {
  var c = cloud && typeof cloud === 'object' ? cloud : {};
  var l = local && typeof local === 'object' ? local : {};
  var cloudTs = validTimestamp(cloudUpdatedAt);
  var localTs = validTimestamp(localUpdatedAt);

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

// Tea library is an ordered snapshot. Newer timestamp wins as a whole so
// edits, deletions and ordering are all preserved. Cloud wins ties, allowing
// a fresh device (default timestamp 0) to restore an existing cloud library.
function mergeTeaLibrary(cloud, cloudUpdatedAt, local, localUpdatedAt) {
  var cl = Array.isArray(cloud) ? cloud : [];
  var ll = Array.isArray(local) ? local : [];
  var cloudTs = validTimestamp(cloudUpdatedAt);
  var localTs = validTimestamp(localUpdatedAt);

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

function validTimestamp(value) {
  return (typeof value === 'number' && isFinite(value) && value > 0)
    ? value
    : 0;
}

// Exposed for the repository's dependency-free Node regression test.
exports._test = {
  mergeData: mergeData,
  mergeVersionedObject: mergeVersionedObject,
  mergeTeaLibrary: mergeTeaLibrary
};
