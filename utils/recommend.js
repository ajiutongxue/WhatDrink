/**
 * recommend.js - Tea recommendation scoring engine
 * Full scoring engine with nature matching, season, body states, caffeine,
 * anti-repetition, and quality filtering.
 * CommonJS module for WeChat Mini Program
 */

var teaData = require('./teaData');

// ============================================================
// Nature scale: 寒=-2, 凉=-1, 平=0, 温=+1, 热=+2
// ============================================================
var NATURE_MAP = { '寒': -2, '凉': -1, '平': 0, '温': 1, '热': 2 };
var NATURE_NAMES = { '-2': '寒', '-1': '凉', '0': '平', '1': '温', '2': '热' };

// ============================================================
// getIdealNature - Compute ideal tea nature value
// ============================================================

/**
 * Calculate the ideal tea nature based on season, weather, and body states.
 * Returns a numeric value on the scale: 寒(-2), 凉(-1), 平(0), 温(+1), 热(+2).
 *
 * @param {string} season - Current season: '春'|'夏'|'秋'|'冬'
 * @param {Object|null} weather - WeatherData or null
 * @param {string[]} states - Detected body states
 * @returns {number} Ideal nature value (clamped -2 to 2)
 */
function getIdealNature(season, weather, states) {
  // Season base
  var seasonBase = { '春': -0.5, '夏': -1.2, '秋': 0.3, '冬': 1.2 };
  var base = seasonBase[season] || 0;

  // Temperature correction
  if (weather) {
    var temp = weather.temp;
    if (temp >= 33) base -= 0.6;
    else if (temp >= 28) base -= 0.3;
    else if (temp <= 0) base += 0.6;
    else if (temp <= 8) base += 0.3;

    // Humidity correction
    var humidity = weather.humidity;
    if (humidity >= 75) base += 0.3;
    else if (humidity <= 25) base -= 0.2;
  }

  // Body state corrections
  if (states && Array.isArray(states)) {
    for (var i = 0; i < states.length; i++) {
      var s = states[i];
      switch (s) {
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

  // Clamp to [-2, 2]
  return Math.max(-2, Math.min(2, base));
}

// ============================================================
// Main recommendation function
// ============================================================

/**
 * Score and rank teas for recommendation.
 *
 * @param {Array} teaLibrary - Full tea library (Tea[])
 * @param {Object} parsed - ParsedInput from parser
 * @param {Object|null} weather - WeatherData or null
 * @param {Array} history - HistoryEntry[] (drinking records)
 * @param {number} avoidDays - Anti-repetition window in days (default 5)
 * @returns {Object} RecommendResult { primary, alt, candidates }
 */
function recommend(teaLibrary, parsed, weather, history, avoidDays) {
  if (!teaLibrary || !teaLibrary.length) {
    return { primary: null, alt: null, candidates: [] };
  }

  var safeAvoidDays = (typeof avoidDays === 'number' && avoidDays > 0) ? avoidDays : 5;
  var safeParsed = parsed || {};
  var safeStates = Array.isArray(safeParsed.states) ? safeParsed.states : [];
  var safeAvoidCats = Array.isArray(safeParsed.avoidCats) ? safeParsed.avoidCats : [];
  var safePreferCats = Array.isArray(safeParsed.preferCats) ? safeParsed.preferCats : [];
  var safeMood = safeParsed.mood || null;
  var safeHistory = Array.isArray(history) ? history : [];

  // Determine current season
  var season = _getCurrentSeason();
  var idealNature = getIdealNature(season, weather, safeStates);

  // Get current hour for caffeine+time scoring
  var hour = new Date().getHours();

  // Build set of recently drunk tea IDs for anti-repetition
  var recentTeaIds = _getRecentTeaIds(safeHistory, safeAvoidDays);

  // Score all teas
  var candidates = [];
  for (var i = 0; i < teaLibrary.length; i++) {
    var tea = teaLibrary[i];
    if (!tea || !tea.name) continue;

    var scored = _scoreTea(tea, {
      idealNature: idealNature,
      season: season,
      states: safeStates,
      avoidCats: safeAvoidCats,
      preferCats: safePreferCats,
      mood: safeMood,
      hour: hour,
      recentTeaIds: recentTeaIds
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

  // Sort eligible by score descending
  eligible.sort(function(a, b) { return b.score - a.score; });

  // Select primary (highest score)
  var primary = eligible.length > 0 ? eligible[0] : null;

  // Select alt (first tea with different category from primary, or second-highest)
  var alt = null;
  if (primary && eligible.length > 1) {
    for (var k = 1; k < eligible.length; k++) {
      if (eligible[k].tea.cat !== primary.tea.cat) {
        alt = eligible[k];
        break;
      }
    }
    // If no different-category tea found, take second-highest
    if (!alt) {
      alt = eligible[1];
    }
  }

  return {
    primary: primary,
    alt: alt,
    candidates: eligible
  };
}

// ============================================================
// Individual tea scoring
// ============================================================

/**
 * Score a single tea against the current context.
 * @param {Object} tea - Tea object
 * @param {Object} ctx - Scoring context
 * @returns {Object} ScoredTea
 */
function _scoreTea(tea, ctx) {
  var score = 50; // base score
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

  // --- Hard filter: anti-repetition ---
  if (ctx.recentTeaIds && ctx.recentTeaIds[tea.id]) {
    score -= 80;
    hardFiltered = true;
    avoids.push('近期内已饮用');
  }

  // --- Hard filter: user avoid ---
  if (ctx.avoidCats && ctx.avoidCats.indexOf(tea.cat) >= 0) {
    score -= 60;
    hardFiltered = true;
    avoids.push('用户指定不想喝');
  }

  // --- Nature match (0 ~ +30) ---
  var natureDiff = Math.abs(natureVal - ctx.idealNature);
  // Round to nearest integer for comparison
  var natureDiffRounded = Math.round(natureDiff);
  if (natureDiffRounded === 0) {
    score += 30;
    reasons.push('茶性非常契合当前需求');
  } else if (natureDiffRounded === 1) {
    score += 15;
  } else {
    // diff >= 2
    score -= (natureDiffRounded - 1) * 15;
    if (natureDiffRounded >= 3) {
      avoids.push('茶性与需求偏差较大');
    }
  }

  // --- Season match (-12 ~ +15) ---
  if (tea.seasons && tea.seasons.indexOf(ctx.season) >= 0) {
    score += 15;
    if (reasons.length < 3) {
      reasons.push('当季适宜饮用');
    }
  }
  if (tea.avoidSeasons && tea.avoidSeasons.indexOf(ctx.season) >= 0) {
    score -= 12;
    if (avoids.length < 2) {
      avoids.push('非当季推荐');
    }
  }

  // --- User prefer (+20) ---
  if (ctx.preferCats && ctx.preferCats.indexOf(tea.cat) >= 0) {
    score += 20;
    if (reasons.length < 3) {
      reasons.push('符合你的口味偏好');
    }
  }

  // --- Mood (+8) ---
  if (ctx.mood) {
    if (ctx.mood === 'light') {
      // Prefer low caffeine + cold/cool/neutral nature
      if (tea.caffeine === '低' && (natureVal <= 0)) {
        score += 8;
      }
    } else if (ctx.mood === 'strong') {
      // Prefer high caffeine
      if (tea.caffeine === '高') {
        score += 8;
      }
    } else if (ctx.mood === 'sweet') {
      // Prefer white tea, jasmine, ripe puerh
      if (tea.cat === 'white' || tea.cat === 'flavored_jasmine' || tea.cat === 'puerh_ripe') {
        score += 8;
      }
    }
  }

  // --- Body state rules (12 categories) ---
  _applyBodyStateRules(tea, ctx.states, score, reasons, avoids, function(s, r, a) {
    score = s;
    reasons = r;
    avoids = a;
  });

  // --- Caffeine + time of day ---
  if (ctx.hour >= 18 || ctx.hour < 6) {
    // Evening/night
    if (tea.caffeine === '高') {
      score -= 10;
      if (avoids.length < 2) avoids.push('晚间不宜高咖啡因');
    } else if (tea.caffeine === '低') {
      score += 8;
    }
  } else if (tea.caffeine === '低') {
    // Daytime low caffeine mild bonus
    score += 2;
  }

  // Limit reasons and avoids
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
 * Uses callback pattern to update score/reasons/avoids.
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

/**
 * Get current season based on month.
 * @returns {string} '春'|'夏'|'秋'|'冬'
 */
function _getCurrentSeason() {
  var month = new Date().getMonth() + 1; // 1-12
  if (month >= 3 && month <= 5) return '春';
  if (month >= 6 && month <= 8) return '夏';
  if (month >= 9 && month <= 11) return '秋';
  return '冬';
}

/**
 * Get a set of tea IDs drunk within the avoid window.
 * @param {Array} history - HistoryEntry[]
 * @param {number} avoidDays - Number of days to look back
 * @returns {Object} Map of teaId -> true
 */
function _getRecentTeaIds(history, avoidDays) {
  var result = {};
  if (!history || !history.length) return result;

  var now = new Date();
  var cutoff = new Date(now.getTime() - avoidDays * 24 * 60 * 60 * 1000);
  var cutoffStr = _formatDate(cutoff);

  for (var i = 0; i < history.length; i++) {
    var entry = history[i];
    if (!entry || !entry.date) continue;

    if (entry.date >= cutoffStr && entry.teaId >= 0) {
      result[entry.teaId] = true;
    }
  }

  return result;
}

/**
 * Format a Date as YYYY-MM-DD.
 */
function _formatDate(d) {
  if (!d || typeof d.getFullYear !== 'function') return '';
  var year = d.getFullYear();
  var month = ('0' + (d.getMonth() + 1)).slice(-2);
  var day = ('0' + d.getDate()).slice(-2);
  return year + '-' + month + '-' + day;
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  recommend: recommend,
  getIdealNature: getIdealNature,
  adjustNature: teaData.adjustNature
};
