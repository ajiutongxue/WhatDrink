/**
 * recommend.js - Tea recommendation scoring engine
 * Enhanced: time-slot awareness, graded anti-repetition, category rotation,
 *           reaction feedback loop, today's nature balance.
 * LLM acts as primary recommender; this engine serves as offline fallback.
 * CommonJS module for WeChat Mini Program
 */

var teaData = require('./teaData');

// ============================================================
// Nature scale: 寒=-2, 凉=-1, 平=0, 温=+1, 热=+2
// ============================================================
var NATURE_MAP = { '寒': -2, '凉': -1, '平': 0, '温': 1, '热': 2 };
var NATURE_NAMES = { '-2': '寒', '-1': '凉', '0': '平', '1': '温', '2': '热' };

// ============================================================
// Time slot configuration
// ============================================================
var TIME_SLOTS = [
  { name: '早晨', start: 6,  end: 10, caffeinePref: '高', natureShift: 0.3,  desc: '升阳提神' },
  { name: '午间', start: 10, end: 14, caffeinePref: '中', natureShift: 0,    desc: '正常' },
  { name: '下午', start: 14, end: 18, caffeinePref: '中', natureShift: -0.1, desc: '渐降咖啡因' },
  { name: '晚间', start: 18, end: 24, caffeinePref: '低', natureShift: -0.3, desc: '安神护胃' },
  { name: '深夜', start: 0,  end: 6,  caffeinePref: '低', natureShift: -0.3, desc: '安神' }
];

function _getTimeSlot(hour) {
  for (var i = 0; i < TIME_SLOTS.length; i++) {
    if (hour >= TIME_SLOTS[i].start && hour < TIME_SLOTS[i].end) return TIME_SLOTS[i];
  }
  return TIME_SLOTS[3];
}

// ============================================================
// getIdealNature - Compute ideal tea nature value
// ============================================================

/**
 * @param {string} season - '春'|'夏'|'秋'|'冬'
 * @param {Object|null} weather
 * @param {string[]} states - body states
 * @param {string|null} constitution
 * @param {number} [hour] - current hour (0-23), adds time-slot shift
 * @param {number} [todayNatureShift] - accumulated nature shift from today's drinks
 * @returns {number} ideal nature (-2 to 2)
 */
function getIdealNature(season, weather, states, constitution, hour, todayNatureShift) {
  var seasonBase = { '春': -0.5, '夏': -1.2, '秋': 0.3, '冬': 1.2 };
  var base = seasonBase[season] || 0;

  // Time-slot shift
  if (typeof hour === 'number') {
    base += _getTimeSlot(hour).natureShift;
  }

  // Today's accumulated nature balance
  if (typeof todayNatureShift === 'number') {
    base += todayNatureShift;
  }

  // Temperature correction
  if (weather) {
    var temp = weather.temp;
    if (temp >= 33) base -= 0.6;
    else if (temp >= 28) base -= 0.3;
    else if (temp <= 0) base += 0.6;
    else if (temp <= 8) base += 0.3;

    var humidity = weather.humidity;
    if (humidity >= 75) base += 0.3;
    else if (humidity <= 25) base -= 0.2;
  }

  // Body state corrections
  if (states && Array.isArray(states)) {
    for (var i = 0; i < states.length; i++) {
      switch (states[i]) {
        case '热证':   base -= 1.0; break;
        case '脾胃寒': base += 1.0; break;
        case '阳虚':   base += 0.8; break;
        case '感冒':   base += 0.3; break;
        case '燥':     base -= 0.3; break;
        case '湿重':   base += 0.3; break;
        case '经期':   base += 1.0; break;
        default: break;
      }
    }
  }

  // Constitution
  if (constitution === '偏寒') base += 0.5;
  else if (constitution === '偏热') base -= 0.5;

  return Math.max(-2, Math.min(2, base));
}

// ============================================================
// filterEligible - Hard filter for both LLM and rule engine
// ============================================================

/**
 * Filter tea library: remove disabled / today-drunk / avoidCats / quality concern.
 * Returns Tea[] without scoring or sorting.
 */
function filterEligible(teaLibrary, parsed, history, avoidDays, temporaryAvoids, excludedTeaIds) {
  var safeParsed = parsed || {};
  var safeAvoidCats = Array.isArray(safeParsed.avoidCats) ? safeParsed.avoidCats : [];
  var safeHistory = Array.isArray(history) ? history : [];
  var today = _formatDate(new Date());
  var consecutiveBlocked = _getConsecutiveBlockedTeaIds(safeHistory, avoidDays);
  var temporarilyBlocked = _getActiveTemporaryAvoidTeaIds(temporaryAvoids);
  var rerollBlocked = {};
  (Array.isArray(excludedTeaIds) ? excludedTeaIds : []).forEach(function(id) {
    var numericId = Number(id);
    if (Number.isInteger(numericId)) rerollBlocked[numericId] = true;
  });

  var todayTeaIds = {};
  for (var i = 0; i < safeHistory.length; i++) {
    if (safeHistory[i].date === today && safeHistory[i].type !== 'skip' && safeHistory[i].teaId >= 0) {
      todayTeaIds[safeHistory[i].teaId] = true;
    }
  }

  var eligible = [];
  for (var j = 0; j < teaLibrary.length; j++) {
    var tea = teaLibrary[j];
    if (!tea || !tea.name) continue;
    if (tea.disabled) continue;
    if (consecutiveBlocked[tea.id]) continue;
    if (temporarilyBlocked[tea.id]) continue;
    if (rerollBlocked[tea.id]) continue;
    if (todayTeaIds[tea.id]) continue;
    if (safeAvoidCats.indexOf(tea.cat) >= 0) continue;
    if (tea.note && tea.note.indexOf('疑似假货') >= 0) continue;
    eligible.push(tea);
  }
  return eligible;
}

// ============================================================
// Main recommendation function (offline fallback)
// ============================================================

/**
 * @param {Array} teaLibrary
 * @param {Object} parsed - ParsedInput
 * @param {Object|null} weather
 * @param {Array} history - HistoryEntry[]
 * @param {number} avoidDays - max consecutive drinking days before next-day block
 * @param {string|null} constitution
 * @returns {Object} { primary, alt, candidates, filteredCount }
 */
function recommend(teaLibrary, parsed, weather, history, avoidDays, constitution, temporaryAvoids, noteAnalysisEnabled, excludedTeaIds) {
  if (!teaLibrary || !teaLibrary.length) {
    return { primary: null, alt: null, candidates: [], filteredCount: 0 };
  }

  var safeAvoidDays = (typeof avoidDays === 'number' && avoidDays >= 2) ? avoidDays : 5;
  var safeParsed = parsed || {};
  var safeStates = Array.isArray(safeParsed.states) ? safeParsed.states : [];
  var safeAvoidCats = Array.isArray(safeParsed.avoidCats) ? safeParsed.avoidCats : [];
  var safePreferCats = Array.isArray(safeParsed.preferCats) ? safeParsed.preferCats : [];
  var safeMood = safeParsed.mood || null;
  var safeHistory = Array.isArray(history) ? history : [];

  var season = _getCurrentSeason();
  var hour = new Date().getHours();
  var slot = _getTimeSlot(hour);

  // Today's accumulated nature shift (balance)
  var todayNatureShift = _getTodayNatureShift(safeHistory, teaLibrary);
  var idealNature = getIdealNature(season, weather, safeStates, constitution, hour, todayNatureShift);

  // Today and the consecutive-day ceiling remain hard filters. Recent drinking
  // contributes positive, decaying preference momentum instead of a repetition penalty.
  var recentStats = _getTodayTeaStats(safeHistory);
  var consecutiveBlocked = _getConsecutiveBlockedTeaIds(safeHistory, safeAvoidDays);
  var temporarilyBlocked = _getActiveTemporaryAvoidTeaIds(temporaryAvoids);
  var preference = buildPreferenceContext(safeHistory, teaLibrary, noteAnalysisEnabled !== false);
  var rerollBlocked = {};
  (Array.isArray(excludedTeaIds) ? excludedTeaIds : []).forEach(function(id) {
    var numericId = Number(id);
    if (Number.isInteger(numericId)) rerollBlocked[numericId] = true;
  });

  // Score all eligible teas
  var candidates = [];
  for (var i = 0; i < teaLibrary.length; i++) {
    var tea = teaLibrary[i];
    if (!tea || !tea.name) continue;
    if (tea.disabled) continue;

    var scored = _scoreTea(tea, {
      idealNature: idealNature,
      season: season,
      states: safeStates,
      avoidCats: safeAvoidCats,
      preferCats: safePreferCats,
      mood: safeMood,
      hour: hour,
      slot: slot,
      recentStats: recentStats,
      consecutiveBlocked: consecutiveBlocked,
      temporarilyBlocked: temporarilyBlocked,
      rerollBlocked: rerollBlocked,
      preferenceScore: _preferenceScoreForTea(tea, preference)
    });

    candidates.push(scored);
  }

  // Separate hard-filtered from eligible
  var eligible = [];
  for (var j = 0; j < candidates.length; j++) {
    if (!candidates[j].hardFiltered) {
      eligible.push(candidates[j]);
    }
  }

  eligible.forEach(function(item) {
    item.baseScore = item.score;
    item.preferenceScore = item.preferenceScore || 0;
    item.score = item.baseScore + item.preferenceScore;
  });
  eligible.sort(function(a, b) { return b.score - a.score; });

  var primary = eligible.length > 0 ? eligible[0] : null;
  var alt = null;
  if (primary && eligible.length > 1) {
    var bestBase = eligible.reduce(function(best, item) { return Math.max(best, item.baseScore); }, -Infinity);
    var explorationPool = eligible.filter(function(item) {
      return item.tea.id !== primary.tea.id && item.baseScore >= bestBase - 20;
    });
    explorationPool.forEach(function(item) {
      item.explorationScore = item.baseScore + 0.25 * item.preferenceScore;
      if (!preference.recent14TeaIds[item.tea.id]) item.explorationScore += 6;
      if (item.tea.cat !== primary.tea.cat) item.explorationScore += 3;
    });
    explorationPool.sort(function(a, b) { return b.explorationScore - a.explorationScore; });
    alt = explorationPool[0] || null;
  }

  return {
    primary: primary,
    alt: alt,
    candidates: eligible,
    filteredCount: eligible.length
  };
}

// ============================================================
// Individual tea scoring
// ============================================================

function _scoreTea(tea, ctx) {
  var score = 50;
  var reasons = [];
  var avoids = [];
  var hardFiltered = false;

  var nature = tea.nature || tea.baseNature || '平';
  var natureVal = NATURE_MAP[nature] || 0;

  // --- Hard filter: quality concern ---
  if (tea.note && tea.note.indexOf('疑似假货') >= 0) {
    score -= 30;
    hardFiltered = true;
    avoids.push('品质存疑');
  }

  // --- Hard filter: reached consecutive drinking limit ---
  if (ctx.consecutiveBlocked && ctx.consecutiveBlocked[tea.id]) {
    score -= 80;
    hardFiltered = true;
    avoids.push('已连续喝满上限');
  }

  // --- Hard filter: temporarily avoided ---
  if (ctx.temporarilyBlocked && ctx.temporarilyBlocked[tea.id]) {
    score -= 80;
    hardFiltered = true;
    avoids.push('暂时不想喝');
  }

  // --- Hard filter: excluded only for the current re-recommendation ---
  if (ctx.rerollBlocked && ctx.rerollBlocked[tea.id]) {
    score -= 80;
    hardFiltered = true;
    avoids.push('上一轮已推荐');
  }

  // --- Hard filter: today already drunk ---
  if (ctx.recentStats && ctx.recentStats[tea.id] && ctx.recentStats[tea.id].today) {
    score -= 80;
    hardFiltered = true;
    avoids.push('今天已饮用');
  }

  // --- Hard filter: user avoid ---
  if (ctx.avoidCats && ctx.avoidCats.indexOf(tea.cat) >= 0) {
    score -= 60;
    hardFiltered = true;
    avoids.push('用户指定不想喝');
  }

  // --- Nature match (0 ~ +30) ---
  var natureDiff = Math.abs(natureVal - ctx.idealNature);
  var natureDiffRounded = Math.round(natureDiff);
  if (natureDiffRounded === 0) {
    score += 30;
    reasons.push('茶性非常契合当前需求');
  } else if (natureDiffRounded === 1) {
    score += 15;
  } else {
    score -= (natureDiffRounded - 1) * 15;
    if (natureDiffRounded >= 3) avoids.push('茶性与需求偏差较大');
  }

  // --- Season match (-12 ~ +15) ---
  if (tea.seasons && tea.seasons.indexOf(ctx.season) >= 0) {
    score += 15;
    if (reasons.length < 3) reasons.push('当季适宜饮用');
  }
  if (tea.avoidSeasons && tea.avoidSeasons.indexOf(ctx.season) >= 0) {
    score -= 12;
    if (avoids.length < 2) avoids.push('非当季推荐');
  }

  // --- User prefer (+20) ---
  if (ctx.preferCats && ctx.preferCats.indexOf(tea.cat) >= 0) {
    score += 20;
    if (reasons.length < 3) reasons.push('符合你的口味偏好');
  }

  // --- Mood (+8) ---
  if (ctx.mood) {
    if (ctx.mood === 'light' && tea.caffeine === '低' && natureVal <= 0) {
      score += 8;
    } else if (ctx.mood === 'strong' && tea.caffeine === '高') {
      score += 8;
    } else if (ctx.mood === 'sweet' && (tea.cat === 'white' || tea.cat === 'flavored_jasmine' || tea.cat === 'puerh_ripe')) {
      score += 8;
    }
  }

  // --- Body state rules (12 categories) ---
  _applyBodyStateRules(tea, ctx.states, score, reasons, avoids, function(s, r, a) {
    score = s; reasons = r; avoids = a;
  });

  // --- Time-slot scoring ---
  if (ctx.slot) {
    var caf = tea.caffeine || '中';
    if (ctx.slot.caffeinePref === '高' && caf === '高') {
      score += 8;
      if (reasons.length < 3) reasons.push(ctx.slot.name + '宜提神');
    } else if (ctx.slot.caffeinePref === '低') {
      if (caf === '低') {
        score += 10;
        if (reasons.length < 3) reasons.push(ctx.slot.name + '宜低咖啡因');
      } else if (caf === '高') {
        score -= 15;
        if (avoids.length < 2) avoids.push(ctx.slot.name + '不宜高咖啡因');
      }
    }
  }

  reasons = reasons.slice(0, 3);
  avoids = avoids.slice(0, 2);

  return {
    tea: tea,
    score: score,
    preferenceScore: ctx.preferenceScore || 0,
    reasons: reasons,
    avoids: avoids,
    hardFiltered: hardFiltered
  };
}

/**
 * Apply body state scoring rules (12 categories).
 */
function _applyBodyStateRules(tea, states, score, reasons, avoids, callback) {
  if (!states || !states.length) {
    callback(score, reasons, avoids);
    return;
  }

  var nature = tea.nature || tea.baseNature || '平';
  var cat = tea.cat || '';
  var caffeine = tea.caffeine || '中';

  for (var i = 0; i < states.length; i++) {
    var state = states[i];

    switch (state) {
      case '热证':
        if (nature === '寒' || nature === '凉') {
          score += 18;
          if (reasons.length < 3) reasons.push('寒凉性茶可清热降火');
        } else if (nature === '温' || nature === '热') {
          score -= 25;
          if (avoids.length < 2) avoids.push('温热性茶可能加重上火');
        }
        break;

      case '脾胃寒':
        if (nature === '温' || nature === '平') {
          score += 12;
          if (reasons.length < 3) reasons.push('温平性茶温和不刺激肠胃');
        } else if (nature === '寒' || nature === '凉') {
          score -= 22;
          if (avoids.length < 2) avoids.push('寒凉性茶可能刺激肠胃');
        }
        break;

      case '阳虚':
        if (nature === '温' || nature === '热') {
          score += 15;
          if (reasons.length < 3) reasons.push('温热性茶有助于温阳暖身');
        } else if (nature === '寒' || nature === '凉') {
          score -= 18;
          if (avoids.length < 2) avoids.push('寒凉性茶不适合阳虚体质');
        }
        break;

      case '感冒':
        if (nature === '温' || nature === '平') {
          score += 8;
        }
        if (caffeine === '高') {
          score -= 10;
          if (avoids.length < 2) avoids.push('感冒期间不宜高咖啡因');
        }
        break;

      case '失眠':
      case '疲劳':
        if (caffeine === '低') {
          score += 10;
          if (reasons.length < 3) reasons.push('低咖啡因茶不影响休息');
        } else if (caffeine === '高') {
          score -= 15;
          if (avoids.length < 2) avoids.push('高咖啡因可能影响睡眠');
        }
        break;

      case '积食':
        if (cat === 'puerh_ripe') {
          score += 20;
          if (reasons.length < 3) reasons.push('熟普助消化，缓解积食');
        } else if (cat === 'oolong_wuyi') {
          score += 10;
          if (reasons.length < 3) reasons.push('岩茶有助于消食解腻');
        }
        break;

      case '湿重':
        if (cat === 'puerh_ripe') {
          score += 12;
          if (reasons.length < 3) reasons.push('熟普有助于祛湿');
        } else if (cat === 'puerh_raw' && (nature === '凉' || nature === '寒')) {
          score -= 8;
          if (avoids.length < 2) avoids.push('凉性生普不适合湿重');
        }
        break;

      case '燥':
        if (cat === 'white') {
          score += 12;
          if (reasons.length < 3) reasons.push('白茶润燥生津');
        } else if (nature === '温' || nature === '热') {
          score -= 12;
          if (avoids.length < 2) avoids.push('温热性茶可能加重干燥');
        }
        break;

      case '压力':
        if (cat === 'oolong_dancong' || cat === 'oolong_tieguanyin' || cat === 'flavored_jasmine') {
          score += 12;
          if (reasons.length < 3) reasons.push('香气茶类有助于舒缓心情');
        }
        break;

      case '经期':
        if (nature === '温' && caffeine === '低') {
          score += 15;
          if (reasons.length < 3) reasons.push('温性低咖啡因茶适合经期');
        } else if (nature === '寒' || nature === '凉') {
          score -= 20;
          if (avoids.length < 2) avoids.push('经期不宜寒凉性茶');
        }
        break;

      case '酒后':
        if (nature === '平' || nature === '凉') {
          score += 8;
          if (reasons.length < 3) reasons.push('平凉性茶适合酒后饮用');
        }
        if (caffeine === '高') {
          score -= 10;
          if (avoids.length < 2) avoids.push('酒后不宜高咖啡因');
        }
        break;

      default:
        break;
    }
  }

  callback(score, reasons, avoids);
}

// ============================================================
// Helper functions
// ============================================================

function _getCurrentSeason() {
  var month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return '春';
  if (month >= 6 && month <= 8) return '夏';
  if (month >= 9 && month <= 11) return '秋';
  return '冬';
}

/**
 * Return tea IDs that were actually drunk on each of the previous limit
 * completed calendar days. With limit=5 a tea may still be recommended and
 * drunk on day five, then is blocked on day six. A gap on any day resets the
 * streak. Multiple drinks and skip entries on the same day do not change the
 * one-day-per-tea aggregation.
 */
function _getConsecutiveBlockedTeaIds(history, limit) {
  var threshold = Math.floor(Number(limit));
  if (!isFinite(threshold) || threshold < 2) threshold = 2;
  var byDate = {};
  var entries = Array.isArray(history) ? history : [];

  entries.forEach(function(entry) {
    if (!entry || !entry.date || entry.type === 'skip') return;
    if (typeof entry.teaId !== 'number' || entry.teaId < 0) return;
    if (!byDate[entry.date]) byDate[entry.date] = {};
    byDate[entry.date][entry.teaId] = true;
  });

  var blocked = {};
  var candidates = null;
  for (var offset = 1; offset <= threshold; offset++) {
    var date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    var dayIds = byDate[_formatDate(date)] || {};

    if (candidates === null) {
      candidates = {};
      Object.keys(dayIds).forEach(function(id) { candidates[id] = true; });
    } else {
      Object.keys(candidates).forEach(function(id) {
        if (!dayIds[id]) delete candidates[id];
      });
    }
    if (Object.keys(candidates).length === 0) break;
  }

  Object.keys(candidates || {}).forEach(function(id) { blocked[id] = true; });
  return blocked;
}

function _getActiveTemporaryAvoidTeaIds(temporaryAvoids, now) {
  var result = {};
  var source = temporaryAvoids && typeof temporaryAvoids === 'object' ? temporaryAvoids : {};
  var current = typeof now === 'number' ? now : Date.now();
  Object.keys(source).forEach(function(id) {
    var state = source[id];
    if (state && state.active === true && Number(state.expiresAt) > current) result[id] = true;
  });
  return result;
}

function _entryAgeDays(entry, now) {
  if (!entry || !entry.date) return 9999;
  var parts = entry.date.split('-').map(Number);
  if (parts.length !== 3) return 9999;
  var day = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0).getTime();
  return Math.max(0, ((now || Date.now()) - day) / 86400000);
}

function buildPreferenceContext(history, teaLibrary, noteAnalysisEnabled, now) {
  var teaSignals = {};
  var categorySignals = {};
  var noteSignals = {};
  var recent14TeaIds = {};
  var libMap = {};
  (teaLibrary || []).forEach(function(tea) { if (tea && tea.id != null) libMap[tea.id] = tea; });
  (history || []).forEach(function(entry) {
    if (!entry || entry.type === 'skip' || typeof entry.teaId !== 'number' || entry.teaId < 0) return;
    var tea = libMap[entry.teaId];
    if (!tea) return;
    var age = _entryAgeDays(entry, now);
    var decay = Math.pow(0.5, age / 30);
    var weight = entry.type === 'custom' ? 1 : 0.7;
    teaSignals[tea.id] = (teaSignals[tea.id] || 0) + weight * decay;
    categorySignals[tea.cat] = (categorySignals[tea.cat] || 0) + weight * decay;
    if (age <= 14) recent14TeaIds[tea.id] = true;
    var analysisCurrent = !entry.notesUpdatedAt || Number(entry.noteAnalysis && entry.noteAnalysis.sourceUpdatedAt) === Number(entry.notesUpdatedAt);
    if (noteAnalysisEnabled !== false && analysisCurrent && entry.noteAnalysis && Number(entry.noteAnalysis.confidence) >= 0.8) {
      var sentiment = entry.noteAnalysis.explicitSentiment;
      if (sentiment === 'positive') noteSignals[tea.id] = (noteSignals[tea.id] || 0) + 8 * decay;
      if (sentiment === 'negative') noteSignals[tea.id] = (noteSignals[tea.id] || 0) - 12 * decay;
    }
  });
  var topTeas = Object.keys(teaSignals).sort(function(a,b){ return teaSignals[b]-teaSignals[a]; }).slice(0,3).map(function(id){ return libMap[id] && libMap[id].name; }).filter(Boolean);
  var topCats = Object.keys(categorySignals).sort(function(a,b){ return categorySignals[b]-categorySignals[a]; }).slice(0,2).map(function(cat){ return teaData.CAT_NAMES[cat] || cat; });
  var explicit = Object.keys(noteSignals).sort(function(a,b){ return Math.abs(noteSignals[b])-Math.abs(noteSignals[a]); }).slice(0,3).map(function(id){
    return (libMap[id] ? libMap[id].name : id) + (noteSignals[id] > 0 ? '：近期明确喜欢' : '：近期明确不喜欢');
  });
  return {
    teaSignals: teaSignals, categorySignals: categorySignals, noteSignals: noteSignals, recent14TeaIds: recent14TeaIds,
    summary: { recentFavorites: topTeas, recentCategories: topCats, explicitSignals: explicit, halfLifeDays: 30 }
  };
}

function _preferenceScoreForTea(tea, context) {
  var drinkTea = Math.min(12, (context.teaSignals[tea.id] || 0) * 4);
  var drinkCat = Math.min(6, (context.categorySignals[tea.cat] || 0) * 1.5);
  var note = Math.max(-15, Math.min(10, context.noteSignals[tea.id] || 0));
  return Math.max(-15, Math.min(18, drinkTea + drinkCat + note));
}

/** Return actual tea IDs already drunk today. */
function _getTodayTeaStats(history) {
  var result = {};
  var today = _formatDate(new Date());
  (history || []).forEach(function(entry) {
    if (!entry || entry.type === 'skip' || entry.date !== today || typeof entry.teaId !== 'number' || entry.teaId < 0) return;
    result[entry.teaId] = { today: true };
  });
  return result;
}

/**
 * Today's accumulated nature shift for balance.
 * Each drink shifts idealNature by 0.15 * natureVal, clamped to [-0.6, 0.6].
 */
function _getTodayNatureShift(history, teaLibrary) {
  if (!history || !history.length) return 0;
  var today = _formatDate(new Date());

  var libMap = {};
  if (teaLibrary) {
    for (var k = 0; k < teaLibrary.length; k++) {
      if (teaLibrary[k] && teaLibrary[k].id != null) libMap[teaLibrary[k].id] = teaLibrary[k];
    }
  }

  var shift = 0;
  for (var i = 0; i < history.length; i++) {
    var entry = history[i];
    if (!entry || entry.date !== today || entry.type === 'skip') continue;
    var tea = libMap[entry.teaId];
    if (!tea) continue;
    var nature = tea.nature || tea.baseNature || '平';
    shift += (NATURE_MAP[nature] || 0) * 0.15;
  }
  return Math.max(-0.6, Math.min(0.6, shift));
}

function _formatDate(d) {
  if (!d || typeof d.getFullYear !== 'function') return '';
  return d.getFullYear() + '-' +
    ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
    ('0' + d.getDate()).slice(-2);
}

/**
 * Rebuild the fine-stage pool from coarse LLM choices plus local rule and
 * insurance candidates. The pool remains a subset of eligibleTeas.
 */
function buildTwoStageCandidatePool(eligibleTeas, coarseRows, ruleCandidates, options) {
  var eligible = Array.isArray(eligibleTeas) ? eligibleTeas.filter(Boolean) : [];
  if (!eligible.length) return [];
  var byId = {};
  eligible.forEach(function(tea) { byId[tea.id] = tea; });
  var ordered = [];
  var seen = {};
  function addTea(tea) {
    if (!tea || !byId[tea.id] || seen[tea.id]) return;
    ordered.push(byId[tea.id]); seen[tea.id] = true;
  }
  (Array.isArray(coarseRows) ? coarseRows.slice() : []).sort(function(a,b) {
    return (Number(b && b.score) || 0) - (Number(a && a.score) || 0);
  }).forEach(function(row) { addTea(row && row.tea); });
  (Array.isArray(ruleCandidates) ? ruleCandidates : []).forEach(function(row) { addTea(row && (row.tea || row)); });
  eligible.forEach(addTea);

  var opts = options || {};
  var target = Math.min(18, eligible.length);
  if (eligible.length >= 12) target = Math.max(12, target);
  var cap = Math.max(1, Math.floor(target * 0.4));
  var result = [], counts = {}, deferred = [];
  ordered.forEach(function(tea) {
    if (result.length >= target) return;
    var cat = tea.cat || 'unknown';
    if ((counts[cat] || 0) >= cap && !opts.relaxCategoryCap) { deferred.push(tea); return; }
    result.push(tea); counts[cat] = (counts[cat] || 0) + 1;
  });
  deferred.forEach(function(tea) { if (result.length < target) result.push(tea); });
  return result;
}
// ============================================================
// Exports
// ============================================================

module.exports = {
  recommend: recommend,
  filterEligible: filterEligible,
  getIdealNature: getIdealNature,
  getTimeSlot: _getTimeSlot,
  getConsecutiveBlockedTeaIds: _getConsecutiveBlockedTeaIds,
  getActiveTemporaryAvoidTeaIds: _getActiveTemporaryAvoidTeaIds,
  buildPreferenceContext: buildPreferenceContext,
  preferenceScoreForTea: _preferenceScoreForTea,
  buildTwoStageCandidatePool: buildTwoStageCandidatePool,
  adjustNature: teaData.adjustNature
};
