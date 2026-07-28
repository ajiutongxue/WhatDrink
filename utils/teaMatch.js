'use strict';

var YEAR_RE = /(?:19|20)\d{2}/;
var SEPARATOR_RE = /[\s\u3000\x22·•・,，.。:：;；'“”‘’（）()\[\]【】{}<>《》_\-—–/／\\]+/;

function compactText(value, stripYear) {
  var text = String(value || '').toLowerCase();
  if (stripYear) text = text.replace(/(?:19|20)\d{2}年?/g, '');
  return text.replace(SEPARATOR_RE, '');
}

function extractYear(value) {
  var match = String(value || '').match(YEAR_RE);
  return match ? Number(match[0]) : null;
}

function nameSegments(name) {
  return String(name || '').toLowerCase().split(SEPARATOR_RE).filter(function(segment) {
    return segment.length >= 2;
  });
}

function strongMatchLevel(inputCompact, tea) {
  var nameCompact = compactText(tea && tea.name, false);
  var brandCompact = compactText(tea && tea.brand, false);
  if (!nameCompact) return 0;
  if (inputCompact === nameCompact + brandCompact) return 4;
  if (inputCompact === nameCompact) return 3;

  var segments = nameSegments(tea.name);
  var allSegmentsPresent = segments.length > 0 && segments.every(function(segment) {
    return inputCompact.indexOf(compactText(segment, false)) >= 0;
  });
  if (!allSegmentsPresent) return 0;
  if (brandCompact && inputCompact.indexOf(brandCompact) >= 0) return 2;
  return 1;
}

function commonSubstringScore(query, target) {
  if (!query || !target) return 0;
  var matched = 0;
  var qLen = query.length;
  var tLen = target.length;
  var usedQ = [];
  var maxLen = Math.min(qLen, tLen);

  for (var len = maxLen; len >= 2; len--) {
    for (var qi = 0; qi <= qLen - len; qi++) {
      var overlaps = false;
      for (var u = 0; u < usedQ.length; u++) {
        if (qi < usedQ[u][1] && qi + len > usedQ[u][0]) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      var sub = query.substring(qi, qi + len);
      if (target.indexOf(sub) >= 0) {
        usedQ.push([qi, qi + len]);
        matched += len * len;
      }
    }
  }
  return (matched / (qLen * qLen)) * 100;
}

/** Resolve a free-form tea input against the user's current tea library. */
function matchTeaInput(input, teaLibrary) {
  var inputText = String(input || '').trim();
  var library = Array.isArray(teaLibrary) ? teaLibrary.filter(Boolean) : [];
  if (!inputText || library.length === 0) return { status: 'none', candidates: [] };

  var inputYear = extractYear(inputText);
  var candidates = library.filter(function(tea) {
    return inputYear === null || Number(tea.year) === inputYear;
  });
  if (candidates.length === 0) return { status: 'none', candidates: [] };

  var inputCompact = compactText(inputText, true);
  if (!inputCompact) return { status: 'none', candidates: [] };

  var strongestLevel = 0;
  var strongest = [];
  candidates.forEach(function(tea) {
    var level = strongMatchLevel(inputCompact, tea);
    if (level > strongestLevel) {
      strongestLevel = level;
      strongest = [tea];
    } else if (level > 0 && level === strongestLevel) {
      strongest.push(tea);
    }
  });

  if (strongest.length === 1) {
    return { status: 'matched', tea: strongest[0], candidates: strongest, matchKind: 'strong' };
  }
  if (strongest.length > 1) {
    return { status: 'ambiguous', candidates: strongest, matchKind: 'strong' };
  }

  return fuzzyMatch(inputCompact, candidates);
}

function fuzzyMatch(inputCompact, candidates) {
  var bestScore = 0;
  var best = [];
  candidates.forEach(function(tea) {
    var nameCompact = compactText(tea.name, false);
    var combinedCompact = nameCompact + compactText(tea.brand, false);
    var score = Math.max(
      commonSubstringScore(inputCompact, nameCompact),
      commonSubstringScore(inputCompact, combinedCompact)
    );
    if (score > bestScore) {
      bestScore = score;
      best = [tea];
    } else if (score > 0 && Math.abs(score - bestScore) < 0.000001) {
      best.push(tea);
    }
  });

  if (bestScore < 35) return { status: 'none', candidates: [] };
  if (best.length !== 1) return { status: 'ambiguous', candidates: best, matchKind: 'fuzzy' };
  return { status: 'matched', tea: best[0], candidates: best, matchKind: 'fuzzy' };
}

/** Relink only strong, unique custom-history matches in place. */
function repairCustomHistoryLinks(history, teaLibrary, repairedAt) {
  var records = Array.isArray(history) ? history : [];
  var timestamp = Number(repairedAt) > 0 ? Number(repairedAt) : Date.now();
  var repaired = 0;
  records.forEach(function(entry) {
    if (!entry || entry.type !== 'custom' || Number(entry.teaId) !== -1) return;
    var result = matchTeaInput(entry.teaName, teaLibrary);
    if (result.status !== 'matched' || result.matchKind !== 'strong' || !result.tea) return;
    entry.teaId = result.tea.id;
    entry.teaName = result.tea.name;
    entry.teaCat = result.tea.cat;
    entry.teaBrand = result.tea.brand || '';
    entry.teaYear = result.tea.year || null;
    entry.updatedAt = timestamp;
    repaired++;
  });
  return repaired;
}

module.exports = {
  matchTeaInput: matchTeaInput,
  repairCustomHistoryLinks: repairCustomHistoryLinks
};
