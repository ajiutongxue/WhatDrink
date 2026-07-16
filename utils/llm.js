/**
 * llm.js - LLM API wrapper
 * Two functions: parseWithLLM (lightweight parser) and callLLM (deep recommendation)
 * Both use OpenAI-compatible /chat/completions endpoint
 * CommonJS module for WeChat Mini Program
 */

// ============================================================
// Tea category Chinese name → key mapping
// ============================================================
var CAT_NAME_TO_KEY = {
  '绿茶':       ['green'],
  '红茶':       ['black'],
  '白茶':       ['white'],
  '铁观音':     ['oolong_tieguanyin'],
  '武夷岩茶':   ['oolong_wuyi'],
  '凤凰单枞':   ['oolong_dancong'],
  '普洱生茶':   ['puerh_raw'],
  '普洱熟茶':   ['puerh_ripe'],
  '茉莉花茶':   ['flavored_jasmine'],
  '调味茶':     ['flavored_other'],
  // Shortcuts / ambiguous terms map to multiple keys
  '普洱':       ['puerh_raw', 'puerh_ripe'],
  '乌龙':       ['oolong_tieguanyin', 'oolong_wuyi', 'oolong_dancong'],
  '生普':       ['puerh_raw'],
  '熟普':       ['puerh_ripe'],
  '岩茶':       ['oolong_wuyi'],
  '单枞':       ['oolong_dancong'],
  '茉莉':       ['flavored_jasmine']
};

// Valid body states
var VALID_STATES = ['热证', '脾胃寒', '感冒', '失眠', '疲劳', '燥', '湿重', '积食', '压力', '经期', '阳虚', '酒后'];

// Valid moods
var VALID_MOODS = ['light', 'strong', 'sweet'];

// ============================================================
// parseWithLLM - Lightweight parser model
// ============================================================

/**
 * Use a lightweight LLM to parse free-text input into structured data.
 * @param {string} input - User's free-text input
 * @param {Object} config - LLM config { apiKey, endpoint, parserModel, recModel }
 * @returns {Promise<Object|null>} ParsedLLMResult or null on failure
 *
 * ParsedLLMResult: {
 *   city: string|null,
 *   states: string[],
 *   avoidCats: string[],   // cat keys (already mapped)
 *   preferCats: string[],  // cat keys (already mapped)
 *   mood: 'light'|'strong'|'sweet'|null
 * }
 */
function parseWithLLM(input, config) {
  return new Promise(function(resolve) {
    if (!input || !config || !config.apiKey || !config.endpoint || !config.parserModel) {
      resolve(null);
      return;
    }

    var systemPrompt = '你是一个茶饮推荐助手的文本解析模块。请严格按照JSON格式返回结果，不要添加任何额外文字。';

    var userPrompt =
      '分析以下用户输入，提取饮茶推荐相关的结构化信息。\n\n' +
      '【茶类列表】绿茶、红茶、白茶、铁观音、武夷岩茶、凤凰单枞、普洱生茶、普洱熟茶、茉莉花茶、调味茶\n\n' +
      '【身体状况可选值】热证、脾胃寒、感冒、失眠、疲劳、燥、湿重、积食、压力、经期、阳虚、酒后\n\n' +
      '用户输入："' + input + '"\n\n' +
      '请严格按以下JSON返回：\n' +
      '{\n' +
      '  "city": "城市名或null",\n' +
      '  "states": ["识别到的身体状况，可多个"],\n' +
      '  "avoidCats": ["不想喝的茶类中文名，可多个"],\n' +
      '  "preferCats": ["想喝的茶类中文名，可多个"],\n' +
      '  "mood": "light/strong/sweet或null"\n' +
      '}';

    var url = _buildUrl(config.endpoint, '/chat/completions');

    wx.request({
      url: url,
      method: 'POST',
      timeout: 20000,
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.apiKey
      },
      data: {
        model: config.parserModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 300
      },
      success: function(res) {
        try {
          var content = _extractContent(res.data);
          if (!content) {
            resolve(null);
            return;
          }

          var parsed = _parseJSON(content);
          if (!parsed) {
            resolve(null);
            return;
          }

          // Post-process: map Chinese cat names to keys
          var result = {
            city: (typeof parsed.city === 'string' && parsed.city !== 'null') ? parsed.city : null,
            states: _filterStates(parsed.states),
            avoidCats: _mapCats(parsed.avoidCats),
            preferCats: _mapCats(parsed.preferCats),
            mood: (parsed.mood && VALID_MOODS.indexOf(parsed.mood) >= 0) ? parsed.mood : null
          };

          resolve(result);
        } catch (e) {
          console.warn('[llm] parseWithLLM parse error:', e);
          resolve(null);
        }
      },
      fail: function(err) {
        console.warn('[llm] parseWithLLM request failed:', err);
        resolve(null);
      }
    });
  });
}

// ============================================================
// callLLM - Deep recommendation model
// ============================================================

/**
 * Use a deep LLM to generate detailed tea recommendation.
 * @param {Array} candidates - ScoredTea[] from recommend engine (top candidates)
 * @param {Object} parsed - ParsedInput object
 * @param {Object|null} weather - WeatherData or null
 * @param {Object} config - LLM config
 * @param {Object} profile - User profile
 * @returns {Promise<Object|null>} LLMResult or null on failure
 *
 * LLMResult: {
 *   primary: { name: string, reason: string },
 *   alternative: { name: string, reason: string },
 *   excluded: string
 * }
 */
function callLLM(eligibleTeas, context, config) {
  return new Promise(function(resolve) {
    if (!eligibleTeas || !eligibleTeas.length || !config || !config.apiKey || !config.endpoint || !config.recModel) {
      resolve(null);
      return;
    }

    // Build candidate list from eligible teas (no scores, LLM decides freely)
    var candidateList = [];
    var maxCandidates = Math.min(eligibleTeas.length, 20);
    for (var i = 0; i < maxCandidates; i++) {
      var t = eligibleTeas[i];
      if (!t) continue;
      candidateList.push(
        (i + 1) + '. ' + t.name +
        '（' + (t.brand || '') + '）' +
        ' - ' + _catName(t.cat) +
        ', 茶性:' + (t.nature || t.baseNature || '平') +
        ', 咖啡因:' + (t.caffeine || '中') +
        (t.year ? ', ' + t.year + '年' : '')
      );
    }

    var ctx = context || {};

    var timeDesc = '时段：' + (ctx.timeSlot || '未知');
    if (typeof ctx.hour === 'number') timeDesc += '（' + ctx.hour + '时）';

    var seasonDesc = ctx.season || '';
    if (ctx.solarTerm) seasonDesc += '，节气：' + ctx.solarTerm;

    var weatherDesc = '无天气数据';
    if (ctx.weather) {
      weatherDesc = ctx.weather.city + '，' + ctx.weather.temp + '°C' +
        (ctx.weather.desc ? '，' + ctx.weather.desc : '') +
        '，湿度' + ctx.weather.humidity + '%';
    }

    var statesDesc = (ctx.states && ctx.states.length) ? ctx.states.join('、') : '无特殊状况';
    var constitutionDesc = ctx.constitution || '未知';

    var todayDesc = '今天尚未饮茶';
    if (ctx.todayDrunk && ctx.todayDrunk.length) {
      todayDesc = ctx.todayDrunk.map(function(d) {
        return d.name + '(' + d.nature + ')' + (d.checkinTime ? ' ' + d.checkinTime : '');
      }).join('、');
    }

    var avoidDesc = '';
    if (ctx.avoidCats && ctx.avoidCats.length) {
      avoidDesc = '不想喝：' + ctx.avoidCats.map(function(k) { return _catName(k); }).join('、');
    }
    var preferDesc = '';
    if (ctx.preferCats && ctx.preferCats.length) {
      preferDesc = '想喝：' + ctx.preferCats.map(function(k) { return _catName(k); }).join('、');
    }
    var moodDesc = '';
    if (ctx.mood) {
      var moodMap = { light: '清淡', strong: '浓郁', sweet: '甘甜' };
      moodDesc = '口味偏好：' + (moodMap[ctx.mood] || ctx.mood);
    }

    var profileDesc = '未设置';
    if (ctx.profile) {
      var parts = [];
      if (ctx.profile.gender) parts.push(ctx.profile.gender === 'male' ? '男性' : '女性');
      if (ctx.profile.age) parts.push(ctx.profile.age + '岁');
      if (ctx.profile.city) parts.push('常驻' + ctx.profile.city);
      if (parts.length) profileDesc = parts.join('，');
    }

    var systemPrompt =
      '你是一位专业的中医茶饮顾问。根据用户的当前时段、天气、身体状况、今日已饮茶等综合因素，' +
      '从候选茶叶中选出最适合当下饮用的茶。推荐需有中医茶疗理论支撑。\n\n' +
      '茶性知识：寒清热降火/凉清凉解热/平温和四季宜/温暖胃暖身/热大热之品\n' +
      '时段原则：早晨宜提神(高咖啡因+温性升阳)/下午渐降咖啡因/晚间宜低咖啡因安神(避免寒凉伤胃)';

    var userPrompt =
      '【用户档案】' + profileDesc + '\n' +
      '【当前时段】' + timeDesc + '\n' +
      (seasonDesc ? '【季节节气】' + seasonDesc + '\n' : '') +
      '【天气】' + weatherDesc + '\n' +
      '【身体状况】' + statesDesc + '\n' +
      '【体质】' + constitutionDesc + '\n' +
      '【今日已饮】' + todayDesc + '（请避开这些茶，并注意今日茶性平衡）\n' +
      (avoidDesc ? '【回避】' + avoidDesc + '\n' : '') +
      (preferDesc ? '【偏好】' + preferDesc + '\n' : '') +
      (moodDesc ? '【口味】' + moodDesc + '\n' : '') +
      '\n【候选茶叶】（已过滤今日已喝和不想喝的）：\n' + candidateList.join('\n') + '\n\n' +
      '请综合时段、天气、身体状况、今日已饮茶（注意茶性平衡），选出主推和备选各一款。' +
      '理由需包含时段分析和今日已饮茶的平衡考量。\n\n' +
      '请严格按JSON返回：\n' +
      '{\n' +
      '  "primary": {\n' +
      '    "name": "茶名，必须和候选里完全一致",\n' +
      '    "tagline": "一句话标签，比如「午后温中和胃之选」",\n' +
      '    "reasons": ["理由1，短句子", "理由2，短句子", "理由3，短句子"],\n' +
      '    "taste_note": "喝起来什么感觉，比如「焙火香明显，入口醇厚有回甘」",\n' +
      '    "brew_tip": "冲泡小建议，比如「沸水，15秒出汤，别闷」",\n' +
      '    "best_before": "最佳饮用时段提醒，比如「下午4点前喝比较好」",\n' +
      '    "pairing": "可选，搭配建议，比如「配点坚果不错」"\n' +
      '  },\n' +
      '  "alternative": {\n' +
      '    "name": "备选茶名",\n' +
      '    "why_different": "和主推的区别，比如「想喝清爽点的选这个」",\n' +
      '    "reasons": ["理由1", "理由2"],\n' +
      '    "brew_tip": "冲泡建议"\n' +
      '  },\n' +
      '  "today_avoid_note": "一句话说说为什么今天不推荐某类茶，比如「今天就别喝绿茶了，脾胃寒加上下雨容易不舒服」"\n' +
      '}';

    var url = _buildUrl(config.endpoint, '/chat/completions');

    var attempt = 0;
    var doRequest = function() {
    wx.request({
      url: url,
      method: 'POST',
      timeout: 45000,
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.apiKey
      },
      data: {
        model: config.recModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5,
        max_tokens: 2000
      },
      success: function(res) {
        try {
          var content = _extractContent(res.data);
          if (!content) {
            resolve(null);
            return;
          }

          var parsed = _parseJSON(content);
          if (!parsed || !parsed.primary || !parsed.primary.name) {
            resolve(null);
            return;
          }

          // Validate names exist in eligible teas
          var nameMap = {};
          eligibleTeas.forEach(function(t) { if (t && t.name) nameMap[t.name] = true; });

          var result = {
            primary: {
              name: parsed.primary.name || '',
              tagline: parsed.primary.tagline || '',
              reasons: Array.isArray(parsed.primary.reasons) ? parsed.primary.reasons : [],
              taste_note: parsed.primary.taste_note || '',
              brew_tip: parsed.primary.brew_tip || '',
              best_before: parsed.primary.best_before || '',
              pairing: parsed.primary.pairing || ''
            },
            alternative: {
              name: (parsed.alternative && parsed.alternative.name) ? parsed.alternative.name : '',
              why_different: (parsed.alternative && parsed.alternative.why_different) ? parsed.alternative.why_different : '',
              reasons: (parsed.alternative && Array.isArray(parsed.alternative.reasons)) ? parsed.alternative.reasons : [],
              brew_tip: (parsed.alternative && parsed.alternative.brew_tip) ? parsed.alternative.brew_tip : ''
            },
            today_avoid_note: parsed.today_avoid_note || ''
          };

          if (!nameMap[result.primary.name]) {
            console.warn('[llm] primary name not in eligible:', result.primary.name);
          }

          resolve(result);
        } catch (e) {
          console.warn('[llm] callLLM parse error:', e);
          resolve(null);
        }
      },
      fail: function(err) {
        attempt++;
        if (attempt <= 1) {
          console.warn('[llm] callLLM retry ' + attempt + ':', err);
          setTimeout(doRequest, 1000);
        } else {
          console.warn('[llm] callLLM failed after retry:', err);
          resolve(null);
        }
      }
    });
    };
    doRequest();
  });
}

// ============================================================
// Internal helpers
// ============================================================

/**
 * Build the full API URL from endpoint and path.
 * Handles trailing slashes in endpoint.
 */
function _buildUrl(endpoint, path) {
  if (!endpoint) return path;
  var base = endpoint.replace(/\/+$/, '');
  return base + path;
}

/**
 * Extract text content from OpenAI-compatible API response.
 */
function _extractContent(data) {
  if (!data) return null;
  if (data.choices && data.choices.length > 0) {
    var choice = data.choices[0];
    if (choice.message && choice.message.content) {
      return choice.message.content;
    }
    if (choice.text) {
      return choice.text;
    }
  }
  return null;
}

/**
 * Parse JSON from LLM response, handling markdown code blocks.
 */
function _parseJSON(text) {
  if (!text || typeof text !== 'string') return null;

  // Strip markdown code fences if present
  var cleaned = text;
  cleaned = cleaned.replace(/```json\s*/gi, '');
  cleaned = cleaned.replace(/```\s*/g, '');
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try to extract JSON object from text
    var match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        console.warn('[llm] JSON parse failed:', e2);
      }
    }
    return null;
  }
}

/**
 * Filter states array to only valid values.
 */
function _filterStates(states) {
  if (!Array.isArray(states)) return [];
  return states.filter(function(s) {
    return VALID_STATES.indexOf(s) >= 0;
  });
}

/**
 * Map Chinese cat names to cat keys.
 * Handles both exact matches and ambiguous shortcuts.
 */
function _mapCats(names) {
  if (!Array.isArray(names)) return [];
  var keys = [];
  names.forEach(function(name) {
    if (typeof name !== 'string') return;
    var trimmed = name.trim();
    // Try exact match first
    if (CAT_NAME_TO_KEY[trimmed]) {
      CAT_NAME_TO_KEY[trimmed].forEach(function(k) {
        if (keys.indexOf(k) < 0) keys.push(k);
      });
    }
  });
  return keys;
}

/**
 * Get Chinese name for a cat key.
 */
function _catName(key) {
  var CAT_NAMES = {
    green: '绿茶',
    black: '红茶',
    white: '白茶',
    oolong_tieguanyin: '铁观音',
    oolong_wuyi: '武夷岩茶',
    oolong_dancong: '凤凰单枞',
    puerh_raw: '普洱生茶',
    puerh_ripe: '普洱熟茶',
    flavored_jasmine: '茉莉花茶',
    flavored_other: '调味茶'
  };
  return CAT_NAMES[key] || key || '';
}

module.exports = {
  parseWithLLM: parseWithLLM,
  callLLM: callLLM
};
