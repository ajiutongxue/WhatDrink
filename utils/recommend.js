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
function filterEligible(teaLibrary, parsed, history) {
  var safeParsed = parsed || {};
  var safeAvoidCats = Array.isArray(safeParsed.avoidCats) ? safeParsed.avoidCats : [];
  var safeHistory = Array.isArray(history) ? history : [];
  var today = _formatDate(new Date());

  var todayTeaIds = {};
  for (var i = 0; i < safeHistory.length; i++) {
    if (safeHistory[i].date === today && safeHistory[i].teaId >= 0) {
      todayTeaIds[safeHistory[i].teaId] = true;
    }
  }

  var eligible = [];
  for (var j = 0; j < teaLibrary.length; j++) {
    var tea = teaLibrary[j];
    if (!tea || !tea.name) continue;
    if (tea.disabled) continue;
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
 * @param {number} avoidDays - anti-repetition window (default 5)
 * @param {string|null} constitution
 * @returns {Object} { primary, alt, candidates, filteredCount }
 */
function recommend(teaLibrary, parsed, weather, history, avoidDays, constitution) {
  if (!teaLibrary || !teaLibrary.length) {
    return { primary: null, alt: null, candidates: [], filteredCount: 0 };
  }

  var safeAvoidDays = (typeof avoidDays === 'number' && avoidDays > 0) ? avoidDays : 5;
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

  // Graded anti-repetition stats
  var recentStats = _getRecentTeaStats(safeHistory, safeAvoidDays);

  // Category frequency (last 3 days) for rotation
  var catFreq = _getCatFrequency(safeHistory, 3);

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
      catFreq: catFreq
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

  eligible.sort(function(a, b) { return b.score - a.score; });

  var primary = eligible.length > 0 ? eligible[0] : null;
  var alt = null;
  if (primary && eligible.length > 1) {
    for (var k = 1; k < eligible.length; k++) {
      if (eligible[k].tea.cat !== primary.tea.cat) {
        alt = eligible[k];
        break;
      }
    }
    if (!alt) alt = eligible[1];
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

  // --- Graded anti-repetition (not hard filter) ---
  if (ctx.recentStats && ctx.recentStats[tea.id]) {
    var stats = ctx.recentStats[tea.id];
    if (stats.recent2 && !stats.today) {
      score -= 15;
    } else if (stats.recent5 && !stats.today) {
      score -= 5;
    }
  }

  // --- Category rotation (last 3 days) ---
  if (ctx.catFreq && ctx.catFreq[tea.cat] >= 2) {
    score -= 10;
    if (avoids.length < 2) avoids.push('近3天已多次饮用同类');
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
 * Graded anti-repetition: returns per-tea stats with today/recent2/recent5 flags.
 */
function _getRecentTeaStats(history, avoidDays) {
  var result = {};
  if (!history || !history.length) return result;

  var now = new Date();
  var today = _formatDate(now);
  var cutoff2 = _formatDate(new Date(now.getTime() - 2 * 86400000));
  var cutoff5 = _formatDate(new Date(now.getTime() - avoidDays * 86400000));

  for (var i = 0; i < history.length; i++) {
    var entry = history[i];
    if (!entry || !entry.date || entry.teaId == null || entry.teaId < 0) continue;
    if (!result[entry.teaId]) result[entry.teaId] = { today: false, recent2: false, recent5: false };
    if (entry.date === today) result[entry.teaId].today = true;
    if (entry.date >= cutoff2) result[entry.teaId].recent2 = true;
    if (entry.date >= cutoff5) result[entry.teaId].recent5 = true;
  }
  return result;
}

/**
 * Category frequency in last N days (for rotation incentive).
 */
function _getCatFrequency(history, days) {
  var result = {};
  if (!history || !history.length) return result;
  var cutoff = _formatDate(new Date(Date.now() - days * 86400000));

  for (var i = 0; i < history.length; i++) {
    var entry = history[i];
    if (!entry || !entry.date || entry.date < cutoff) continue;
    if (entry.type === 'skip') continue;
    var cat = entry.teaCat || 'unknown';
    result[cat] = (result[cat] || 0) + 1;
  }
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

// ============================================================
// Exports
// ============================================================

module.exports = {
  recommend: recommend,
  filterEligible: filterEligible,
  getIdealNature: getIdealNature,
  getTimeSlot: _getTimeSlot,
  adjustNature: teaData.adjustNature
};
