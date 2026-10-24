const API_PATH = '/api/ai/chat';
const VALID_STATES = ['热证', '脾胃寒', '感冒', '失眠', '疲劳', '燥', '湿重', '积食', '压力', '经期', '阳虚', '酒后'];
const VALID_MOODS = ['light', 'strong', 'sweet'];
const NOTE_TRAITS = ['花香', '果香', '蜜香', '陈香', '焙火香', '青味', '甜润', '鲜爽', '醇厚', '清淡', '浓郁', '苦', '涩', '顺滑'];

const CAT_NAME_TO_KEYS = {
  绿茶: ['green'], 红茶: ['black'], 白茶: ['white'], 铁观音: ['oolong_tieguanyin'],
  武夷岩茶: ['oolong_wuyi'], 凤凰单枞: ['oolong_dancong'], 普洱生茶: ['puerh_raw'],
  普洱熟茶: ['puerh_ripe'], 茉莉花茶: ['flavored_jasmine'], 调味茶: ['flavored_other'],
  普洱: ['puerh_raw', 'puerh_ripe'], 乌龙: ['oolong_tieguanyin', 'oolong_wuyi', 'oolong_dancong'],
  生普: ['puerh_raw'], 熟普: ['puerh_ripe'], 岩茶: ['oolong_wuyi'], 单枞: ['oolong_dancong'], 茉莉: ['flavored_jasmine'],
};

const CAT_NAMES = {
  green: '绿茶', black: '红茶', white: '白茶', oolong_tieguanyin: '铁观音',
  oolong_wuyi: '武夷岩茶', oolong_dancong: '凤凰单枞', puerh_raw: '普洱生茶',
  puerh_ripe: '普洱熟茶', flavored_jasmine: '茉莉花茶', flavored_other: '调味茶',
};

/** A safe, user-facing error from the same-origin AI proxy. */
export class AIRequestError extends Error {
  constructor(message, { code = 'request', status = null, purpose = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AIRequestError';
    this.code = code;
    this.status = status;
    this.purpose = purpose;
  }
}

function abortError() {
  const error = new Error('AI 请求已取消');
  error.name = 'AbortError';
  error.code = 'aborted';
  return error;
}

function isAbortError(error, signal) {
  return Boolean(signal && signal.aborted) || Boolean(error && error.name === 'AbortError');
}

function notifyError(error, onError, signal) {
  if (isAbortError(error, signal)) return;
  if (typeof onError === 'function') {
    try { onError(error); } catch (_) { /* UI error handlers must not change fallback behavior. */ }
  }
}

function responseErrorMessage(status, body) {
  const detail = body && body.detail;
  const serverCode = detail && typeof detail === 'object' ? detail.code : null;
  const serverMessages = {
    ai_purpose_disabled: 'AI 功能当前已关闭，请在设置中开启',
    ai_endpoint_not_configured: '请先在设置中配置 AI 服务端点',
    ai_endpoint_invalid: 'AI 服务端点配置无效，请检查设置',
    ai_model_not_configured: '请先在设置中配置 AI 模型',
    ai_key_not_configured: '请先在设置中保存 AI Key',
    ai_key_unavailable: 'AI Key 不可用，请在设置中重新保存',
    ai_provider_timeout: 'AI 服务响应超时，请稍后重试',
    ai_provider_rate_limited: 'AI 服务请求过于频繁，请稍后再试',
    ai_provider_auth_failed: 'AI Key 无效或已过期，请检查设置',
    ai_provider_unavailable: 'AI 服务暂时不可用，请稍后重试',
    ai_provider_invalid_response: 'AI 服务返回格式异常，请稍后重试',
  };
  if (serverCode && serverMessages[serverCode]) return serverMessages[serverCode];
  if (status === 429) return 'AI 服务请求过于频繁，请稍后再试';
  if (status === 401 || status === 403) return 'AI 服务配置无效或暂不可用';
  if (status === 500 || status === 502 || status === 503 || status === 504) return 'AI 服务暂时不可用，请稍后重试';
  const fallbackDetail = body && (body.message || (body.error && body.error.message));
  const shortDetail = typeof detail === 'string' ? detail.trim().slice(0, 160)
    : (typeof fallbackDetail === 'string' ? fallbackDetail.trim().slice(0, 160) : '');
  return `AI 请求失败（HTTP ${status}）${shortDetail ? `：${shortDetail}` : ''}`;
}

async function requestAI(purpose, messages, { signal, maxTokens } = {}) {
  if (signal && signal.aborted) throw abortError();

  const requestBody = { purpose, messages };
  if (Number.isInteger(maxTokens) && maxTokens > 0) requestBody.maxTokens = maxTokens;

  let response;
  try {
    response = await fetch(API_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch (error) {
    if (isAbortError(error, signal)) throw abortError();
    throw new AIRequestError('网络连接失败，请检查网络后重试', { code: 'network', purpose, cause: error });
  }

  let body = null;
  try { body = await response.json(); } catch (_) { /* handled below as a protocol error */ }
  if (!response.ok) {
    throw new AIRequestError(responseErrorMessage(response.status, body), {
      code: 'http', status: response.status, purpose,
    });
  }
  const content = extractContent(body);
  if (typeof content !== 'string' || !content.trim()) {
    throw new AIRequestError('AI 返回内容为空或格式无法识别', { code: 'empty-response', status: response.status, purpose });
  }
  return content;
}

function extractContent(body) {
  if (!body || typeof body !== 'object') return null;
  const choice = Array.isArray(body.choices) ? body.choices[0] : null;
  const messageContent = choice && choice.message && choice.message.content;
  if (typeof messageContent === 'string') return messageContent;
  if (typeof (choice && choice.text) === 'string') return choice.text;
  // The proxy may expose a normalized content field while retaining the same contract.
  if (typeof body.content === 'string') return body.content;
  if (typeof body.output_text === 'string') return body.output_text;
  return null;
}

function parseJSON(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch (_) { return null; }
  }
}

function parseOrThrow(text, purpose) {
  const parsed = parseJSON(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AIRequestError('AI 返回格式异常，已使用本地规则', { code: 'invalid-response', purpose });
  }
  return parsed;
}

function mapCats(names) {
  if (!Array.isArray(names)) return [];
  const result = [];
  names.forEach((name) => {
    if (typeof name !== 'string') return;
    (CAT_NAME_TO_KEYS[name.trim()] || []).forEach((key) => {
      if (!result.includes(key)) result.push(key);
    });
  });
  return result;
}

function normalizeParsedInput(parsed) {
  return {
    city: typeof parsed.city === 'string' && parsed.city !== 'null' ? parsed.city : null,
    states: Array.isArray(parsed.states) ? parsed.states.filter((value) => VALID_STATES.includes(value)) : [],
    avoidCats: mapCats(parsed.avoidCats),
    preferCats: mapCats(parsed.preferCats),
    mood: VALID_MOODS.includes(parsed.mood) ? parsed.mood : null,
  };
}

/**
 * Enrich an already-parsed local keyword result with AI.
 * API failures report through onError and return the keyword result; cancellation rejects.
 * @param {string} input Free-form user input.
 * @param {object} keywordResult Result from the browser-safe local parser.
 * @param {{signal?: AbortSignal, onError?: (error: Error) => void}} options
 * @returns {Promise<object>} ParsedInput with city, states, avoidCats, avoidTeas, preferCats, strongPreferCats, and mood.
 */
export async function parseInputWithAI(input, keywordResult, { signal, onError } = {}) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!keywordResult || typeof keywordResult !== 'object') throw new TypeError('Local parsed input is required');
  if (!text) return keywordResult;

  let aiResult = null;
  try {
    const userPrompt =
      '分析以下用户输入，提取饮茶推荐相关的结构化信息。\n\n' +
      '【茶类列表】绿茶、红茶、白茶、铁观音、武夷岩茶、凤凰单枞、普洱生茶、普洱熟茶、茉莉花茶、调味茶\n\n' +
      '【身体状况可选值】热证、脾胃寒、感冒、失眠、疲劳、燥、湿重、积食、压力、经期、阳虚、酒后\n\n' +
      `用户输入：${JSON.stringify(text)}\n\n` +
      '请严格按以下JSON返回：\n' +
      '{\n' +
      '  "city": "城市名或null",\n' +
      '  "states": ["识别到的身体状况，可多个"],\n' +
      '  "avoidCats": ["不想喝的茶类中文名，可多个"],\n' +
      '  "preferCats": ["想喝的茶类中文名，可多个"],\n' +
      '  "mood": "light/strong/sweet或null"\n' +
      '}';
    const content = await requestAI('parse', [
      { role: 'system', content: '你是一个茶饮推荐助手的文本解析模块。请严格按照JSON格式返回结果，不要添加任何额外文字。' },
      { role: 'user', content: userPrompt },
    ], { signal, maxTokens: 300 });
    aiResult = normalizeParsedInput(parseOrThrow(content, 'parse'));
  } catch (error) {
    if (isAbortError(error, signal)) throw abortError();
    notifyError(error, onError, signal);
    return keywordResult;
  }

  return {
    city: aiResult.city || keywordResult.city || null,
    states: aiResult.states.length ? aiResult.states : keywordResult.states,
    avoidCats: aiResult.avoidCats.length ? aiResult.avoidCats : keywordResult.avoidCats,
    avoidTeas: keywordResult.avoidTeas,
    preferCats: aiResult.preferCats.length ? aiResult.preferCats : keywordResult.preferCats,
    strongPreferCats: keywordResult.strongPreferCats,
    mood: aiResult.mood || keywordResult.mood || null,
  };
}

function catName(key) { return CAT_NAMES[key] || key || ''; }

function candidateTeaText(tea) {
  const summary = tea._knowledgeSummary || {};
  const extra = [];
  if (Array.isArray(summary.aromaTags) && summary.aromaTags.length) extra.push(`香气:${summary.aromaTags.join('/')}`);
  if (typeof summary.completeness === 'number') extra.push(`画像:${Math.round(summary.completeness * 100)}%`);
  if (summary.opened) extra.push('已有开封包装');
  return `${tea.name}（${tea.brand || ''}） - ${catName(tea.cat)}, 茶性:${tea.nature || tea.baseNature || '平'}, 咖啡因:${tea.caffeine || '中'}` +
    `${tea.year ? `, ${tea.year}年` : ''}${extra.length ? `, ${extra.join('，')}` : ''}`;
}

function buildRecommendationPrompts(eligibleTeas, context = {}, coarse = false) {
  const candidateList = eligibleTeas.filter(Boolean).map((tea, index) => {
    let line = `${index + 1}. [id:${tea.id}] ${candidateTeaText(tea)}`;
    if (context.fine && tea._knowledgeDetail) line += `\n  完整画像:${JSON.stringify(tea._knowledgeDetail)}`;
    return line;
  });
  const timeDesc = `时段：${context.timeSlot || '未知'}${typeof context.hour === 'number' ? `（${context.hour}时）` : ''}`;
  let seasonDesc = context.season || '';
  if (context.solarTerm) seasonDesc += `，节气：${context.solarTerm}`;
  let weatherDesc = '无天气数据';
  if (context.weather) {
    weatherDesc = `${context.weather.city || ''}，${context.weather.temp}°C${context.weather.desc ? `，${context.weather.desc}` : ''}，湿度${context.weather.humidity}%`;
  }
  const statesDesc = context.states && context.states.length ? context.states.join('、') : '无特殊状况';
  const todayDesc = context.todayDrunk && context.todayDrunk.length
    ? context.todayDrunk.map((row) => `${row.name}(${row.nature})${row.checkinTime ? ` ${row.checkinTime}` : ''}`).join('、')
    : '今天尚未饮茶';
  const avoidDesc = context.avoidCats && context.avoidCats.length ? `不想喝：${context.avoidCats.map(catName).join('、')}` : '';
  const preferDesc = context.preferCats && context.preferCats.length ? `想喝：${context.preferCats.map(catName).join('、')}` : '';
  const moodMap = { light: '清淡', strong: '浓郁', sweet: '甘甜' };
  const moodDesc = context.mood ? `口味偏好：${moodMap[context.mood] || context.mood}` : '';

  let preferenceDesc = '暂无足够的近期偏好数据';
  if (context.preferenceSummary) {
    const parts = [];
    if (context.preferenceSummary.recentFavorites && context.preferenceSummary.recentFavorites.length) parts.push(`近期常喝：${context.preferenceSummary.recentFavorites.join('、')}`);
    if (context.preferenceSummary.recentCategories && context.preferenceSummary.recentCategories.length) parts.push(`近期茶类：${context.preferenceSummary.recentCategories.join('、')}`);
    if (context.preferenceSummary.explicitSignals && context.preferenceSummary.explicitSignals.length) parts.push(context.preferenceSummary.explicitSignals.join('；'));
    if (parts.length) preferenceDesc = parts.join('；');
  }
  let profileDesc = '未设置';
  if (context.profile) {
    const parts = [];
    if (context.profile.gender) parts.push(context.profile.gender === 'male' ? '男性' : '女性');
    if (context.profile.age) parts.push(`${context.profile.age}岁`);
    if (context.profile.city) parts.push(`常驻${context.profile.city}`);
    if (parts.length) profileDesc = parts.join('，');
  }

  const system = '你是一位专业的中医茶饮顾问。根据用户的当前时段、天气、身体状况、今日已饮茶等综合因素，从候选茶叶中选出最适合当下饮用的茶。推荐需有中医茶疗理论支撑。\n\n' +
    '茶性知识：寒清热降火/凉清凉解热/平温和四季宜/温暖胃暖身/热大热之品\n' +
    '时段原则：早晨宜提神(高咖啡因+温性升阳)/下午渐降咖啡因/晚间宜低咖啡因安神(避免寒凉伤胃)';

  if (coarse) {
    return {
      system,
      user: '从以下候选中粗选 12 到 18 个适合进一步比较的茶，不要给最终主推。' +
        '只返回 JSON：{"candidates":[{"teaId":数字,"score":0到1,"group":"current_fit|preference|exploration"}]}。' +
        '不得返回候选范围外 ID。库存状态只作说明，不因开封或未开封本身提高适配分。\n【候选摘要】\n' + candidateList.join('\n'),
    };
  }

  const user =
    `【用户档案】${profileDesc}\n` +
    `【当前时段】${timeDesc}\n` +
    (seasonDesc ? `【季节节气】${seasonDesc}\n` : '') +
    `【天气】${weatherDesc}\n` +
    `【身体状况】${statesDesc}\n` +
    `【体质】${context.constitution || '未知'}\n` +
    `【今日已饮】${todayDesc}（请避开这些茶，并注意今日茶性平衡）\n` +
    (avoidDesc ? `【回避】${avoidDesc}\n` : '') +
    (preferDesc ? `【偏好】${preferDesc}\n` : '') +
    (moodDesc ? `【口味】${moodDesc}\n` : '') +
    `【近期偏好】${preferenceDesc}（由近期饮用和明确态度汇总，不含原始笔记）\n` +
    `\n【候选茶叶】（已过滤今日已喝和不想喝的）：\n${candidateList.join('\n')}\n\n` +
    '请综合时段、天气、身体状况、今日已饮茶（注意茶性平衡），选出主推和备选各一款。主推应贴近近期偏好；备选应在仍适合当下的前提下探索相邻口味，不要只是重复主推。库存状态只作说明，不因开封或未开封本身提高适配分。' +
    '理由需包含时段分析和今日已饮茶的平衡考量。\n\n' +
    '请严格按JSON返回：\n' +
    '{\n' +
    '  "primary": {\n' +
    '    "teaId": "候选行中的数字 ID",\n' +
    '    "name": "只复制候选行中破折号前的茶名（品牌），不要包含序号、破折号及后续属性",\n' +
    '    "tagline": "一句话标签，比如「午后温中和胃之选」",\n' +
    '    "narrative": "把今天的天气、时段、身体状况和选这款茶的理由，编织成一段连贯温暖的话，像写给朋友的便签，自然流畅、有画面感，2-3句，60-100字，不要分点、不要加引号",\n' +
    '    "reasons": ["理由1，短句子", "理由2，短句子", "理由3，短句子"],\n' +
    '    "taste_note": "喝起来什么感觉，比如「焙火香明显，入口醇厚有回甘」",\n' +
    '    "brew_tip": "冲泡小建议，比如「沸水，15秒出汤，别闷」",\n' +
    '    "best_before": "最佳饮用时段提醒，比如「下午4点前喝比较好」",\n' +
    '    "pairing": "可选，搭配建议，比如「配点坚果不错」"\n' +
    '  },\n' +
    '  "alternative": {\n' +
    '    "teaId": "备选候选行中的数字 ID",\n' +
    '    "name": "只复制备选候选行中破折号前的茶名（品牌）",\n' +
    '    "why_different": "和主推的区别，比如「想喝清爽点的选这个」",\n' +
    '    "reasons": ["理由1", "理由2"],\n' +
    '    "brew_tip": "冲泡建议"\n' +
    '  },\n' +
    '  "today_avoid_note": "一句话说说为什么今天不推荐某类茶，比如「今天就别喝绿茶了，脾胃寒加上下雨容易不舒服」"\n' +
    '}';
  return { system, user };
}

function normalizeEligibleName(value) {
  if (value == null) return '';
  return String(value)
    .trim()
    .replace(/^(?:\d+|[一二三四五六七八九十]+)\s*[.、:：)]\s*/, '')
    .replace(/^[-*•]\s*/, '')
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
    .toLowerCase()
    .replace(/[（）()\[\]【】\s*_`]/g, '');
}

function findEligibleTeaById(value, eligibleTeas) {
  if (value === '' || value === null || value === undefined) return null;
  const id = Number(value);
  if (!Number.isInteger(id)) return null;
  return eligibleTeas.find((tea) => tea && tea.id === id) || null;
}

function resolveEligibleTea(value, eligibleTeas) {
  const normalized = normalizeEligibleName(value);
  if (!normalized) return null;
  return eligibleTeas.find((tea) => {
    if (!tea || !tea.name) return false;
    const keys = [tea.name, `${tea.name}${tea.brand ? `（${tea.brand}）` : ''}`, candidateTeaText(tea)];
    return keys.some((key) => normalized === normalizeEligibleName(key));
  }) || null;
}

function cleanString(value) { return typeof value === 'string' ? value : ''; }
function cleanStringArray(value) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []; }

/**
 * Ask AI for a deep recommendation using only the supplied eligible teas.
 * A missing or out-of-pool primary is rejected; invalid alternatives are dropped.
 * @param {object[]} eligibleTeas Candidates already filtered by local recommendation rules.
 * @param {object} context Weather, profile, time, preferences, and today's tea context.
 * @param {{signal?: AbortSignal, onError?: (error: Error) => void}} options
 * @returns {Promise<object|null>} Normalized recommendation or null for rule fallback.
 */
export async function recommendWithAI(eligibleTeas, context = {}, { signal, onError } = {}) {
  const candidates = Array.isArray(eligibleTeas) ? eligibleTeas.filter(Boolean) : [];
  if (!candidates.length) return null;
  try {
    const prompts = buildRecommendationPrompts(candidates, context || {}, false);
    const content = await requestAI('recommend', [
      { role: 'system', content: prompts.system },
      { role: 'user', content: prompts.user },
    ], { signal, maxTokens: 2000 });
    const parsed = parseOrThrow(content, 'recommend');
    if (!parsed.primary || (!Number.isInteger(Number(parsed.primary.teaId)) && !parsed.primary.name)) {
      throw new AIRequestError('AI 返回格式异常，已使用规则推荐', { code: 'invalid-response', purpose: 'recommend' });
    }
    const primaryData = parsed.primary;
    const primaryTea = findEligibleTeaById(primaryData.teaId, candidates) || resolveEligibleTea(primaryData.name, candidates);
    if (!primaryTea) {
      throw new AIRequestError('AI 推荐了候选范围外的茶，已使用规则推荐', { code: 'out-of-pool', purpose: 'recommend' });
    }

    const result = {
      primary: {
        name: primaryTea.name,
        tagline: cleanString(primaryData.tagline),
        narrative: cleanString(primaryData.narrative),
        reasons: cleanStringArray(primaryData.reasons),
        taste_note: cleanString(primaryData.taste_note),
        brew_tip: cleanString(primaryData.brew_tip),
        best_before: cleanString(primaryData.best_before),
        pairing: cleanString(primaryData.pairing),
        _teaId: primaryTea.id,
      },
      alternative: { name: '', why_different: '', reasons: [], brew_tip: '' },
      today_avoid_note: cleanString(parsed.today_avoid_note),
    };

    const alt = parsed.alternative || {};
    if (alt.name || (alt.teaId !== undefined && Number.isInteger(Number(alt.teaId)))) {
      const alternativeTea = findEligibleTeaById(alt.teaId, candidates) || resolveEligibleTea(alt.name, candidates);
      if (alternativeTea) {
        result.alternative = {
          name: alternativeTea.name,
          why_different: cleanString(alt.why_different),
          reasons: cleanStringArray(alt.reasons),
          brew_tip: cleanString(alt.brew_tip),
          _teaId: alternativeTea.id,
        };
      }
    }
    return result;
  } catch (error) {
    if (isAbortError(error, signal)) throw abortError();
    notifyError(error, onError, signal);
    return null;
  }
}

/**
 * Optional first-stage shortlist; every returned tea is taken from eligibleTeas.
 * @param {object[]} eligibleTeas Locally eligible candidates to summarize.
 * @param {object} context Recommendation context (retained for parity; coarse prompt is compact).
 * @param {{signal?: AbortSignal, onError?: (error: Error) => void}} options
 * @returns {Promise<{candidates: object[]}|null>} Coarse rows for buildTwoStageCandidatePool, or null to skip AI shortlist.
 */
export async function selectCandidatesWithAI(eligibleTeas, context = {}, { signal, onError } = {}) {
  const candidates = Array.isArray(eligibleTeas) ? eligibleTeas.filter(Boolean) : [];
  if (!candidates.length) return null;
  try {
    const prompts = buildRecommendationPrompts(candidates, context || {}, true);
    const content = await requestAI('coarse', [
      { role: 'system', content: prompts.system },
      { role: 'user', content: prompts.user },
    ], { signal, maxTokens: 2000 });
    const parsed = parseOrThrow(content, 'coarse');
    const rows = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    const selected = [];
    const seenIds = new Set();
    rows.forEach((row) => {
      const teaId = Number(row && row.teaId);
      const tea = Number.isInteger(teaId) ? candidates.find((candidate) => candidate.id === teaId) : null;
      if (!tea || seenIds.has(teaId)) return;
      const numericScore = Number(row.score);
      selected.push({
        tea,
        teaId,
        score: Math.max(0, Math.min(1, Number.isFinite(numericScore) ? numericScore : 0)),
        group: ['current_fit', 'preference', 'exploration'].includes(row.group) ? row.group : 'current_fit',
      });
      seenIds.add(teaId);
    });
    return selected.length ? { candidates: selected } : null;
  } catch (error) {
    if (isAbortError(error, signal)) throw abortError();
    notifyError(error, onError, signal);
    return null;
  }
}

/** Generate a short date- and weather-aware daily tea quote; null allows local fallback. */
export async function generateDailyQuote(context = {}, { signal, onError } = {}) {
  const ctx = context || {};
  let weatherDesc = '未知';
  if (ctx.weather) {
    weatherDesc = `${ctx.weather.city || ''} ${ctx.weather.temp}°C${ctx.weather.desc ? `，${ctx.weather.desc}` : ''}${ctx.weather.humidity ? `，湿度${ctx.weather.humidity}%` : ''}`;
  }
  const system = '你是一位懂茶、懂生活的文案作者。请根据今天的日期、节气与天气，写一句简短温暖的"每日茶语"，像朋友的一句问候，可以带一点诗意或小幽默，自然地呼应时令或天气。不超过25个字，直接返回这句话本身，不要加引号、序号、解释或任何额外文字。';
  const user = `日期：${ctx.date || ''}（${ctx.weekday || ''}）\n节气：${ctx.solarTerm || '—'}\n季节：${ctx.season || '—'}\n天气：${weatherDesc}\n\n请写一句今日茶语：`;
  try {
    const content = await requestAI('quote', [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { signal, maxTokens: 80 });
    const quote = content.replace(/["“”'‘’\n\r]/g, '').trim();
    return quote || null;
  } catch (error) {
    if (isAbortError(error, signal)) throw abortError();
    notifyError(error, onError, signal);
    return null;
  }
}

function shortText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function allowedTraits(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => NOTE_TRAITS.includes(item)))].slice(0, 6);
}

/** Normalize the conservative, versioned tasting-note analysis contract. */
export function normalizeNoteAnalysis(parsed, sourceUpdatedAt, now = Date.now()) {
  let sentiment = parsed && parsed.explicitSentiment;
  if (!['positive', 'negative', 'unknown'].includes(sentiment)) sentiment = 'unknown';
  const confidence = Math.max(0, Math.min(1, Number(parsed && parsed.confidence) || 0));
  if (sentiment !== 'unknown' && confidence < 0.8) sentiment = 'unknown';
  return {
    version: 1,
    sourceUpdatedAt: Number(sourceUpdatedAt) || now,
    analyzedAt: now,
    explicitSentiment: sentiment,
    confidence,
    likedTraits: allowedTraits(parsed && parsed.likedTraits),
    dislikedTraits: allowedTraits(parsed && parsed.dislikedTraits),
    observations: Array.isArray(parsed && parsed.observations) ? parsed.observations.map((value) => shortText(value, 40)).filter(Boolean).slice(0, 5) : [],
    brewingNote: shortText(parsed && parsed.brewingNote, 80),
    contextNotes: shortText(parsed && parsed.contextNotes, 80),
    summary: shortText(parsed && parsed.summary, 100),
  };
}

/** Analyze a newly saved free-form note; null leaves the original note untouched. */
export async function analyzeTastingNote(note, tea, context = {}, { signal, onError } = {}) {
  const text = shortText(note, 500);
  if (!text) return null;
  const sourceUpdatedAt = context && context.sourceUpdatedAt;
  const prompt = `茶款：${(tea && tea.name) || '未知'}\n品饮笔记：${text}\n\n` +
    '只分析文字中明确表达的内容。描述香气、滋味、冲泡过程或事实，不等于喜欢或不喜欢。' +
    '只有出现明确态度（如喜欢、好喝、想再喝、不喜欢、难喝、不想再喝）时，explicitSentiment 才能为 positive 或 negative，且 confidence 才可达到 0.8；否则必须为 unknown。' +
    '不要推断健康、体质、季节原因，也不要建议自动屏蔽茶。\n' +
    '严格返回JSON：{"explicitSentiment":"positive|negative|unknown","confidence":0到1,"likedTraits":[],"dislikedTraits":[],"observations":[],"brewingNote":"","contextNotes":"","summary":""}。' +
    `特征只能从以下列表选择：${NOTE_TRAITS.join('、')}`;
  try {
    const content = await requestAI('note', [
      { role: 'system', content: '你是保守的品饮笔记结构化助手。不得把中性描述猜成喜好。' },
      { role: 'user', content: prompt },
    ], { signal, maxTokens: 700 });
    return normalizeNoteAnalysis(parseOrThrow(content, 'note'), sourceUpdatedAt);
  } catch (error) {
    if (isAbortError(error, signal)) throw abortError();
    notifyError(error, onError, signal);
    return null;
  }
}
