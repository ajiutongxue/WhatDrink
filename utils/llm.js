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
      timeout: 15000,
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
function callLLM(candidates, parsed, weather, config, profile) {
  return new Promise(function(resolve) {
    if (!candidates || !candidates.length || !config || !config.apiKey || !config.endpoint || !config.recModel) {
      resolve(null);
      return;
    }

    // Build candidate summary for the prompt
    var candidateList = [];
    var maxCandidates = Math.min(candidates.length, 15);
    for (var i = 0; i < maxCandidates; i++) {
      var c = candidates[i];
      if (!c || !c.tea) continue;
      candidateList.push(
        (i + 1) + '. ' + c.tea.name +
        '（' + c.tea.brand + '）' +
        ' - ' + _catName(c.tea.cat) +
        ', 茶性:' + c.tea.nature +
        ', 咖啡因:' + c.tea.caffeine +
        ', 评分:' + (c.score || 0) +
        (c.reasons && c.reasons.length ? ', 理由:' + c.reasons.join(';') : '')
      );
    }

    var weatherDesc = '无天气数据';
    if (weather) {
      weatherDesc = weather.city + '，' + weather.temp + '°C' +
        (weather.desc ? '，' + weather.desc : '') +
        '，湿度' + weather.humidity + '%';
    }

    var statesDesc = (parsed && parsed.states && parsed.states.length)
      ? parsed.states.join('、')
      : '无特殊状况';

    var avoidDesc = '';
    if (parsed && parsed.avoidCats && parsed.avoidCats.length) {
      avoidDesc = '不想喝：' + parsed.avoidCats.map(function(k) { return _catName(k); }).join('、');
    }

    var preferDesc = '';
    if (parsed && parsed.preferCats && parsed.preferCats.length) {
      preferDesc = '想喝：' + parsed.preferCats.map(function(k) { return _catName(k); }).join('、');
    }

    var moodDesc = '';
    if (parsed && parsed.mood) {
      var moodMap = { light: '清淡', strong: '浓郁', sweet: '甘甜' };
      moodDesc = '口味偏好：' + (moodMap[parsed.mood] || parsed.mood);
    }

    var profileDesc = '';
    if (profile) {
      var parts = [];
      if (profile.gender) parts.push(profile.gender === 'male' ? '男性' : '女性');
      if (profile.age) parts.push(profile.age + '岁');
      if (profile.city) parts.push('常驻' + profile.city);
      profileDesc = parts.length ? parts.join('，') : '未设置';
    }

    var systemPrompt =
      '你是一位专业的中医茶饮顾问。你需要根据用户的身体状况、天气情况和个人偏好，' +
      '从候选茶叶中选出最适合今天饮用的茶。你的推荐需要有中医茶疗的理论支撑。\n\n' +
      '茶性知识：\n' +
      '- 寒性茶：清热降火，适合夏季和热证体质\n' +
      '- 凉性茶：清凉解热，适合春夏和轻微上火\n' +
      '- 平性茶：温和不刺激，四季皆宜\n' +
      '- 温性茶：暖胃暖身，适合秋冬和寒性体质\n' +
      '- 热性茶：大热之品，适合严寒和阳虚';

    var userPrompt =
      '【用户档案】' + profileDesc + '\n' +
      '【天气】' + weatherDesc + '\n' +
      '【身体状况】' + statesDesc + '\n' +
      (avoidDesc ? '【回避】' + avoidDesc + '\n' : '') +
      (preferDesc ? '【偏好】' + preferDesc + '\n' : '') +
      (moodDesc ? '【口味】' + moodDesc + '\n' : '') +
      '\n【候选茶叶】（按规则引擎评分排序）：\n' + candidateList.join('\n') + '\n\n' +
      '请从以上候选中选出主推和备选各一款，并给出详细的推荐理由。' +
      '推荐理由需要包含茶性分析、身体状况适配说明和冲泡建议。\n\n' +
      '请严格按以下JSON返回：\n' +
      '{\n' +
      '  "primary": {\n' +
      '    "name": "茶叶名称（必须与候选列表中完全一致）",\n' +
      '    "reason": "详细推荐理由（100-200字，包含茶性分析和身体状况适配说明）"\n' +
      '  },\n' +
      '  "alternative": {\n' +
      '    "name": "备选茶叶名称（必须与候选列表中完全一致，尽量与主推不同茶类）",\n' +
      '    "reason": "备选推荐理由（50-100字）"\n' +
      '  },\n' +
      '  "excluded": "被排除的茶类及原因（简要说明，30字内）"\n' +
      '}';

    var url = _buildUrl(config.endpoint, '/chat/completions');

    wx.request({
      url: url,
      method: 'POST',
      timeout: 30000,
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
        temperature: 0.7,
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

          // Validate that the recommended names exist in candidates
          var candidateNames = {};
          candidates.forEach(function(c) {
            if (c && c.tea) candidateNames[c.tea.name] = true;
          });

          var result = {
            primary: {
              name: parsed.primary.name || '',
              reason: parsed.primary.reason || ''
            },
            alternative: {
              name: (parsed.alternative && parsed.alternative.name) ? parsed.alternative.name : '',
              reason: (parsed.alternative && parsed.alternative.reason) ? parsed.alternative.reason : ''
            },
            excluded: parsed.excluded || ''
          };

          // Warn if names don't match candidates
          if (!candidateNames[result.primary.name]) {
            console.warn('[llm] primary name not in candidates:', result.primary.name);
          }

          resolve(result);
        } catch (e) {
          console.warn('[llm] callLLM parse error:', e);
          resolve(null);
        }
      },
      fail: function(err) {
        console.warn('[llm] callLLM request failed:', err);
        resolve(null);
      }
    });
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
