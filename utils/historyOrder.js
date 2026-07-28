'use strict';

function validTime(value) {
  var text = String(value || '');
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : '';
}

function createdAtFromId(id) {
  var match = String(id || '').match(/^h_(\d{10,})_/);
  if (!match) return 0;
  var value = Number(match[1]);
  return isFinite(value) && value > 0 ? value : 0;
}

/**
 * Return non-mutating display references in newest-first order.
 * Each item is { entry, index }, where index is the original persisted index.
 */
function sortHistoryForDisplay(history) {
  var list = Array.isArray(history) ? history : [];
  return list.map(function(entry, index) {
    return { entry: entry, index: index };
  }).sort(function(left, right) {
    var a = left.entry || {};
    var b = right.entry || {};
    var dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
    if (dateCmp) return dateCmp;
    var aTime = validTime(a.checkinTime);
    var bTime = validTime(b.checkinTime);
    if (aTime && bTime && aTime !== bTime) return bTime.localeCompare(aTime);
    if (aTime && !bTime) return -1;
    if (!aTime && bTime) return 1;
    var aCreatedAt = createdAtFromId(a.id);
    var bCreatedAt = createdAtFromId(b.id);
    if (aCreatedAt !== bCreatedAt) return bCreatedAt - aCreatedAt;
    return right.index - left.index;
  });
}

module.exports = {
  sortHistoryForDisplay: sortHistoryForDisplay
};
