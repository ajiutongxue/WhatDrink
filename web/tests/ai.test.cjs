const assert = require('node:assert/strict');
const keywordParser = require('../src/logic/legacy/keywordParser.cjs');

async function run() {
  const ai = await import('../src/ai/index.js');
  const originalFetch = global.fetch;
  try {
    await testRequestContractAndParseFallback(ai);
    await testRecommendationCandidateBounds(ai);
    await testCoarseCandidateBounds(ai);
    await testQuoteAndNotePrompts(ai);
    testNoteNormalization(ai);
    await testAbort(ai);
    console.log('PWA AI client tests passed');
  } finally {
    global.fetch = originalFetch;
  }
}

function completion(content) {
  return { ok: true, status: 200, json: async () => ({ content }) };
}

function setResponse(content) {
  global.fetch = async () => completion(content);
}

async function testRequestContractAndParseFallback(ai) {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return completion(JSON.stringify({
      city: '北京', states: ['疲劳', '未知状态'], avoidCats: ['普洱'],
      preferCats: ['乌龙'], mood: 'light',
    }));
  };
  const input = '在长沙，有点上火，不想喝普洱，想喝绿茶，口味清淡';
  const result = await ai.parseInputWithAI(input, await keywordParser.parseInput(input));
  assert.equal(request.url, '/api/ai/chat');
  assert.equal(request.options.method, 'POST');
  const body = JSON.parse(request.options.body);
  assert.deepEqual(Object.keys(body).sort(), ['maxTokens', 'messages', 'purpose']);
  assert.equal(body.purpose, 'parse');
  assert.equal(body.maxTokens, 300);
  assert.deepEqual(body.messages.map(({ role }) => role), ['system', 'user']);
  assert.match(body.messages[0].content, /严格按照JSON/);
  assert.match(body.messages[1].content, /热证、脾胃寒、感冒/);
  assert.match(body.messages[1].content, /普洱生茶、普洱熟茶/);
  assert.equal(Object.hasOwn(body, 'apiKey'), false);
  assert.equal(result.city, '北京', 'AI city takes priority, like the previous parser');
  assert.deepEqual(result.states, ['疲劳']);
  assert.deepEqual(result.avoidCats, ['puerh_raw', 'puerh_ripe']);
  assert.deepEqual(result.preferCats, ['oolong_tieguanyin', 'oolong_wuyi', 'oolong_dancong']);
  assert.equal(result.mood, 'light');
  assert.ok(Array.isArray(result.avoidTeas));
  assert.ok(Array.isArray(result.strongPreferCats));

  const keywordResult = await keywordParser.parseInput(input);
  let reportedError;
  global.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const fallback = await ai.parseInputWithAI(input, keywordResult, { onError: (error) => { reportedError = error; } });
  assert.deepEqual(fallback, keywordResult, 'network failure keeps all local keyword fields');
  assert.equal(reportedError.name, 'AIRequestError');
  assert.equal(reportedError.code, 'network');

  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({ detail: { code: 'ai_purpose_disabled' } }) });
  const recommendationFallback = await ai.recommendWithAI([{ id: 1, name: '茶甲' }], {}, {
    onError: (error) => { reportedError = error; },
  });
  assert.equal(recommendationFallback, null);
  assert.equal(reportedError.code, 'http');
  assert.equal(reportedError.status, 503);
  assert.match(reportedError.message, /AI 功能当前已关闭/);
}

async function testRecommendationCandidateBounds(ai) {
  const pool = [
    { id: 1, name: '候选甲', brand: '甲牌', cat: 'green', nature: '寒', caffeine: '中', _knowledgeDetail: { aroma: '花香' } },
    { id: 2, name: '候选乙', brand: '乙牌', cat: 'white', nature: '凉', caffeine: '低' },
  ];
  let reportedError;
  setResponse(JSON.stringify({ primary: { teaId: 99, name: '茶库外的茶' } }));
  assert.equal(await ai.recommendWithAI(pool, {}, { onError: (error) => { reportedError = error; } }), null);
  assert.equal(reportedError.code, 'out-of-pool');

  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return completion(JSON.stringify({
      primary: { teaId: 1, name: '候选甲', narrative: '今天适合慢慢喝。', reasons: ['午后温和'], taste_note: '清甜' },
      alternative: { teaId: 99, name: '不在候选池', why_different: '外部茶' },
      today_avoid_note: '今天少喝寒凉茶',
    }));
  };
  const result = await ai.recommendWithAI(pool, {
    timeSlot: '下午', hour: 15, season: '秋', solarTerm: '白露',
    weather: { city: '杭州', temp: 22, desc: '阴', humidity: 70 },
    states: ['疲劳'], constitution: '偏寒', todayDrunk: [{ name: '已喝茶', nature: '凉' }],
    preferenceSummary: { recentFavorites: ['候选甲'], explicitSignals: ['明确喜欢'] },
    profile: { gender: 'female', age: '35', city: '杭州' }, fine: true,
  });
  assert.equal(requestBody.purpose, 'recommend');
  assert.equal(requestBody.maxTokens, 2000);
  const prompt = requestBody.messages[1].content;
  for (const text of ['【当前时段】', '【天气】', '【身体状况】', '【今日已饮】', '【近期偏好】', '库存状态只作说明', '[id:1]', '白露', '画像']) {
    assert.ok(prompt.includes(text), `recommend prompt keeps ${text}`);
  }
  assert.equal(result.primary._teaId, 1);
  assert.equal(result.primary.name, '候选甲');
  assert.equal(result.alternative.name, '', 'out-of-pool alternatives are discarded');
  assert.equal(result.today_avoid_note, '今天少喝寒凉茶');
}

async function testCoarseCandidateBounds(ai) {
  const pool = [
    { id: 11, name: '茶甲', cat: 'green' },
    { id: 12, name: '茶乙', cat: 'white' },
  ];
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return completion(JSON.stringify({ candidates: [
      { teaId: 12, score: 1.5, group: 'exploration' },
      { teaId: 99, score: 1, group: 'preference' },
      { teaId: 12, score: 0.2, group: 'preference' },
      { teaId: '11', score: -2, group: 'invalid' },
    ] }));
  };
  const result = await ai.selectCandidatesWithAI(pool, { timeSlot: '上午' });
  assert.equal(requestBody.purpose, 'coarse');
  assert.deepEqual(result.candidates.map(({ teaId }) => teaId), [12, 11]);
  assert.deepEqual(result.candidates.map(({ tea }) => tea), [pool[1], pool[0]]);
  assert.deepEqual(result.candidates.map(({ score }) => score), [1, 0]);
  assert.deepEqual(result.candidates.map(({ group }) => group), ['exploration', 'current_fit']);
  assert.ok(requestBody.messages[1].content.includes('不得返回候选范围外 ID'));
  assert.ok(requestBody.messages[1].content.includes('不要给最终主推'));
}

async function testQuoteAndNotePrompts(ai) {
  let calls = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    if (body.purpose === 'quote') return completion('“秋风微凉，茶汤正暖。”\n');
    return completion(JSON.stringify({
      explicitSentiment: 'positive', confidence: 0.6,
      likedTraits: ['花香', '虚构特征', '鲜爽'], dislikedTraits: [],
      observations: ['香气清楚'], brewingNote: '盖碗冲泡', contextNotes: '午后', summary: '闻起来有花香',
    }));
  };
  const quote = await ai.generateDailyQuote({
    date: '2026-09-24', weekday: '星期四', solarTerm: '秋分', season: '秋',
    weather: { city: '杭州', temp: 20, desc: '小雨', humidity: 80 },
  });
  assert.equal(quote, '秋风微凉，茶汤正暖。');
  assert.equal(calls[0].purpose, 'quote');
  assert.equal(calls[0].maxTokens, 80);
  assert.match(calls[0].messages[0].content, /不超过25个字/);
  assert.match(calls[0].messages[1].content, /秋分/);
  assert.match(calls[0].messages[1].content, /小雨/);

  const tooLong = '中性品饮描述'.repeat(100);
  const noteResult = await ai.analyzeTastingNote(tooLong, { name: '白茶' }, { sourceUpdatedAt: 123 });
  const noteCall = calls[1];
  assert.equal(noteCall.purpose, 'note');
  assert.equal(noteCall.maxTokens, 700);
  assert.equal(noteCall.messages[1].content.match(/品饮笔记：([\s\S]*?)\n\n/)[1].length, 500);
  assert.match(noteCall.messages[1].content, /confidence 才可达到 0\.8/);
  assert.match(noteCall.messages[1].content, /不要推断健康、体质、季节原因/);
  assert.equal(noteResult.explicitSentiment, 'unknown', 'low-confidence sentiment is not inferred');
  assert.deepEqual(noteResult.likedTraits, ['花香', '鲜爽']);
  assert.equal(noteResult.sourceUpdatedAt, 123);
}

function testNoteNormalization(ai) {
  const result = ai.normalizeNoteAnalysis({
    explicitSentiment: 'negative', confidence: 0.9,
    likedTraits: ['花香', '花香', 'invalid', '果香', '蜜香', '陈香', '焙火香', '青味', '甜润', '鲜爽'],
    dislikedTraits: ['涩'], observations: ['  ' + '观察'.repeat(30), 10],
    brewingNote: '冲泡'.repeat(50), contextNotes: '午后', summary: '总结'.repeat(80),
  }, 456, 789);
  assert.equal(result.explicitSentiment, 'negative');
  assert.equal(result.confidence, 0.9);
  assert.equal(result.analyzedAt, 789);
  assert.equal(result.likedTraits.length, 6);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].length, 40);
  assert.equal(result.brewingNote.length, 80);
  assert.equal(result.summary.length, 100);
}

async function testAbort(ai) {
  const controller = new AbortController();
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  const pending = ai.generateDailyQuote({}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
