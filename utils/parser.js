/**
 * parser.js - Free-text input parser
 * Two-stage: LLM semantic parsing (if enabled) + keyword matching fallback
 * CommonJS module for WeChat Mini Program
 */

var llm = require('./llm');
var tracker = require('./tracker');

// ============================================================
// Body state keyword tables (12 categories)
// ============================================================

var STATE_KEYWORDS = {
  '热证': ['上火', '长包', '长痘', '口腔溃疡', '喉咙痛', '嗓子疼', '咽痛', '牙疼', '牙龈肿', '嘴破', '口干', '口苦'],
  '脾胃寒': ['腹泻', '拉肚子', '拉稀', '肠胃不好', '胃不舒服', '胃寒', '胃凉', '肚子凉', '肚子疼', '着凉'],
  '感冒': ['感冒', '鼻塞', '流涕', '发烧', '咳嗽', '伤风', '头疼', '头痛'],
  '失眠': ['失眠', '没睡好', '睡不着', '熬夜', '昨晚没睡', '睡不好'],
  '疲劳': ['累', '疲劳', '犯困', '困', '加班', '辛苦', '疲惫', '乏力', '没精神'],
  '燥': ['燥', '干燥', '上火干燥', '口干舌燥', '皮肤干'],
  '湿重': ['湿气', '湿重', '身体沉', '困重', '舌苔厚', '痰多'],
  '积食': ['吃撑', '吃多了', '吃太油', '油腻', '胀气', '积食', '消化不好'],
  '压力': ['压力大', '焦虑', '紧张', '烦躁', '心烦', '心情不好'],
  '经期': ['经期', '姨妈', '例假', '月经', '痛经'],
  '阳虚': ['手脚冷', '怕冷', '畏寒', '手脚冰凉'],
  '酒后': ['喝多了', '宿醉', '酒']
};

// ============================================================
// Tea category keyword mapping
// ============================================================

var CAT_KEYWORDS = {
  '绿茶': ['green'],
  '红茶': ['black'],
  '白茶': ['white'],
  '铁观音': ['oolong_tieguanyin'],
  '武夷岩茶': ['oolong_wuyi'],
  '凤凰单枞': ['oolong_dancong'],
  '普洱生茶': ['puerh_raw'],
  '普洱熟茶': ['puerh_ripe'],
  '茉莉花茶': ['flavored_jasmine'],
  '茉莉': ['flavored_jasmine'],
  '调味茶': ['flavored_other'],
  // Ambiguous shortcuts
  '普洱': ['puerh_raw', 'puerh_ripe'],
  '生普': ['puerh_raw'],
  '熟普': ['puerh_ripe'],
  '乌龙': ['oolong_tieguanyin', 'oolong_wuyi', 'oolong_dancong'],
  '岩茶': ['oolong_wuyi'],
  '单枞': ['oolong_dancong'],
  '大红袍': ['oolong_wuyi'],
  '肉桂': ['oolong_wuyi'],
  '水仙': ['oolong_wuyi'],
  '鸭屎香': ['oolong_dancong'],
  '金骏眉': ['black'],
  '银骏眉': ['black'],
  '龙井': ['green'],
  '碧潭飘雪': ['flavored_jasmine'],
  '小青柑': ['flavored_other']
};

// ============================================================
// Regex patterns
// ============================================================

// City extraction: matches patterns like "在长沙", "去北京", "到了上海市"
var CITY_REGEX = /(?:在|去|到了?)([\u4e00-\u9fa5]{2,4}(?:市|县|区|镇)?)/;

// Avoid patterns
var AVOID_PATTERNS = /不想喝|不喝|不要|别喝|避开/;
// Prefer patterns
var PREFER_PATTERNS = /想喝|来点|来个|喝点/;

// ============================================================
// Main parser function
// ============================================================

/**
 * Parse free-text user input into structured ParsedInput.
 * Two-stage: LLM first (if enabled and API key available), keyword fallback.
 *
 * @param {string} text - User's free-text input
 * @param {Object} llmConfig - LLM configuration
 * @returns {Promise<Object>} ParsedInput
 *
 * ParsedInput: {
 *   city: string|null,
 *   states: string[],
 *   avoidCats: string[],
 *   avoidTeas: number[],
 *   preferCats: string[],
 *   mood: 'light'|'strong'|'sweet'|null
 * }
 */
function parseInput(text, llmConfig) {
  return new Promise(function(resolve) {
    if (!text || typeof text !== 'string') {
      resolve(_emptyResult());
      return;
    }

    var trimmed = text.trim();
    if (!trimmed) {
      resolve(_emptyResult());
      return;
    }

    // Stage 1: Try LLM parsing if enabled
    var useLLM = llmConfig &&
      llmConfig.parserEnabled &&
      llmConfig.apiKey &&
      llmConfig.endpoint &&
      llmConfig.parserModel;

    if (useLLM) {
      var t0 = Date.now();
      llm.parseWithLLM(trimmed, llmConfig).then(function(llmResult) {
        if (llmResult) {
          // LLM succeeded, merge with keyword-detected city (LLM city takes priority)
          var keywordResult = _parseKeywords(trimmed);
          var result = {
            city: llmResult.city || keywordResult.city || null,
            states: llmResult.states.length > 0 ? llmResult.states : keywordResult.states,
            avoidCats: llmResult.avoidCats.length > 0 ? llmResult.avoidCats : keywordResult.avoidCats,
            avoidTeas: keywordResult.avoidTeas,
            preferCats: llmResult.preferCats.length > 0 ? llmResult.preferCats : keywordResult.preferCats,
            mood: llmResult.mood || keywordResult.mood || null
          };
          tracker.track('parse', { mode: 'llm', ok: true, ms: Date.now() - t0, city: !!result.city, states: result.states.length });
          resolve(result);
        } else {
          // LLM failed, fall back to keyword matching
          tracker.track('parse', { mode: 'llm', ok: false, ms: Date.now() - t0, fallback: 'keyword', err: llm.getLastError() || '' });
          resolve(_parseKeywords(trimmed));
        }
      });
    } else {
      // Stage 2 only: keyword matching
      resolve(_parseKeywords(trimmed));
    }
  });
}

// ============================================================
// Keyword matching parser (Stage 2 / fallback)
// ============================================================

/**
 * Parse input using keyword matching only.
 * @param {string} text
 * @returns {Object} ParsedInput
 */
function _parseKeywords(text) {
  if (!text) return _emptyResult();

  var result = {
    city: null,
    states: [],
    avoidCats: [],
    avoidTeas: [],
    preferCats: [],
    mood: null
  };

  // --- City extraction ---
  var cityMatch = text.match(CITY_REGEX);
  if (cityMatch && cityMatch[1]) {
    // Strip trailing administrative suffix for cleaner city name
    var city = cityMatch[1];
    // Keep the suffix as part of the name for better wttr.in matching
    result.city = city;
  }

  // --- Body state detection ---
  var stateKeys = Object.keys(STATE_KEYWORDS);
  for (var si = 0; si < stateKeys.length; si++) {
    var state = stateKeys[si];
    var keywords = STATE_KEYWORDS[state];
    for (var ki = 0; ki < keywords.length; ki++) {
      if (text.indexOf(keywords[ki]) >= 0) {
        if (result.states.indexOf(state) < 0) {
          result.states.push(state);
        }
        break; // One keyword match is enough for this state
      }
    }
  }

  // --- Avoid/Prefer detection ---
  // Strategy: find all cat keywords in text, check nearby context for avoid/prefer patterns.
  // Key rule: if an avoid pattern is detected, do NOT also treat it as a prefer pattern
  // (e.g., "不想喝普洱" should only match avoid, not prefer).
  var catKeys = Object.keys(CAT_KEYWORDS);

  for (var ci = 0; ci < catKeys.length; ci++) {
    var catName = catKeys[ci];
    if (text.indexOf(catName) < 0) continue;

    var catPos = text.indexOf(catName);
    // Use a short window (5 chars) so avoid keywords for one cat don't bleed into the next
    var contextBefore = text.substring(Math.max(0, catPos - 5), catPos);

    var isAvoid = AVOID_PATTERNS.test(contextBefore);
    var isPrefer = false;

    if (!isAvoid) {
      // Only check prefer if avoid was NOT detected in immediate context
      isPrefer = PREFER_PATTERNS.test(contextBefore);
    }

    if (isAvoid) {
      var avoidKeys = CAT_KEYWORDS[catName];
      for (var ai = 0; ai < avoidKeys.length; ai++) {
        if (result.avoidCats.indexOf(avoidKeys[ai]) < 0) {
          result.avoidCats.push(avoidKeys[ai]);
        }
      }
    }

    if (isPrefer) {
      var preferKeys = CAT_KEYWORDS[catName];
      for (var pi = 0; pi < preferKeys.length; pi++) {
        if (result.preferCats.indexOf(preferKeys[pi]) < 0) {
          result.preferCats.push(preferKeys[pi]);
        }
      }
    }
  }

  // Also scan for avoid/prefer keywords followed by cat names
  // Use a tight window to avoid capturing cats from unrelated clauses
  var avoidMatch = text.match(AVOID_PATTERNS);
  if (avoidMatch) {
    var avoidIdx = text.indexOf(avoidMatch[0]);
    var afterAvoid = text.substring(avoidIdx + avoidMatch[0].length, avoidIdx + avoidMatch[0].length + 8);
    for (var ci2 = 0; ci2 < catKeys.length; ci2++) {
      var cn = catKeys[ci2];
      if (afterAvoid.indexOf(cn) >= 0) {
        // Cross-check: make sure this cat isn't in a prefer context
        var cnPos = text.indexOf(cn);
        var cnContext = text.substring(Math.max(0, cnPos - 5), cnPos);
        if (!PREFER_PATTERNS.test(cnContext)) {
          var ks = CAT_KEYWORDS[cn];
          for (var ki2 = 0; ki2 < ks.length; ki2++) {
            if (result.avoidCats.indexOf(ks[ki2]) < 0) {
              result.avoidCats.push(ks[ki2]);
            }
          }
        }
      }
    }
  }

  var preferMatch = text.match(PREFER_PATTERNS);
  if (preferMatch) {
    var preferIdx = text.indexOf(preferMatch[0]);
    // Check this prefer match is not negated (preceded by 不/没/别)
    var beforePrefer = preferIdx > 0 ? text.charAt(preferIdx - 1) : '';
    var isNegated = (beforePrefer === '不' || beforePrefer === '没' || beforePrefer === '别');

    if (!isNegated) {
      var afterPrefer = text.substring(preferIdx + preferMatch[0].length, preferIdx + preferMatch[0].length + 10);
      for (var ci3 = 0; ci3 < catKeys.length; ci3++) {
        var cn2 = catKeys[ci3];
        if (afterPrefer.indexOf(cn2) >= 0) {
          var ks2 = CAT_KEYWORDS[cn2];
          for (var ki3 = 0; ki3 < ks2.length; ki3++) {
            if (result.preferCats.indexOf(ks2[ki3]) < 0) {
              result.preferCats.push(ks2[ki3]);
            }
          }
        }
      }
    }
  }

  // Final dedup: remove from preferCats any cats that are also in avoidCats (avoid takes priority)
  result.preferCats = result.preferCats.filter(function(cat) {
    return result.avoidCats.indexOf(cat) < 0;
  });

  // --- Mood detection ---
  if (/清淡|清爽|淡/.test(text)) {
    result.mood = 'light';
  } else if (/浓|浓郁|重口|劲大/.test(text)) {
    result.mood = 'strong';
  } else if (/甜|甘甜|回甘|蜜/.test(text)) {
    result.mood = 'sweet';
  }

  return result;
}

/**
 * Check if there's an avoid keyword within 10 characters before the given position.
 */
function _hasAvoidBefore(text, pos) {
  var start = Math.max(0, pos - 15);
  var segment = text.substring(start, pos);
  return AVOID_PATTERNS.test(segment);
}

/**
 * Check if there's a prefer keyword within 10 characters before the given position.
 */
function _hasPreferBefore(text, pos) {
  var start = Math.max(0, pos - 15);
  var segment = text.substring(start, pos);
  return PREFER_PATTERNS.test(segment);
}

/**
 * Returns an empty ParsedInput result.
 */
function _emptyResult() {
  return {
    city: null,
    states: [],
    avoidCats: [],
    avoidTeas: [],
    preferCats: [],
    mood: null
  };
}

module.exports = {
  parseInput: parseInput
};
