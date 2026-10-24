const assert = require('node:assert/strict');
const legacyParser = require('../../utils/parser');
const legacyRecommendation = require('../../utils/recommend');
const legacyTeaData = require('../../utils/teaData');
const legacyTeaMatch = require('../../utils/teaMatch');
const legacyHistoryOrder = require('../../utils/historyOrder');

function dateDaysAgo(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function run() {
  const logic = await loadPwaLogicForNode();
  testCatalogAndRecommendation(logic);
  await testKeywordParser(logic);
  testMatchingAndHistory(logic);
  testLunar(logic);
  testStatistics(logic);
  testInventoryLifecycle(logic);
  console.log('PWA logic parity tests passed');
}

async function loadPwaLogicForNode() {
  const pwaInventory = await import('../src/logic/inventory.js');
  const pwaStats = await import('../src/logic/historyStats.js');
  const pwaLunarSummary = await import('../src/logic/lunarSummary.js');
  const pwaKeywordParser = require('../src/logic/legacy/keywordParser.cjs');
  const lunar = require('../../utils/lunar');
  return {
    ...legacyRecommendation,
    TEAS: legacyTeaData.TEAS,
    parseInput: pwaKeywordParser.parseInput,
    matchTeaInput: legacyTeaMatch.matchTeaInput,
    repairCustomHistoryLinks: legacyTeaMatch.repairCustomHistoryLinks,
    sortHistoryForDisplay: legacyHistoryOrder.sortHistoryForDisplay,
    ...pwaInventory,
    getHistoryStats: (history, library, now) => pwaStats.getHistoryStats(history, library, now, legacyTeaData.CAT_NAMES),
    lunarCalendar: lunar,
    getLunarSummary: (date) => pwaLunarSummary.getLunarSummary(date, lunar),
  };
}

function testCatalogAndRecommendation(logic) {
  assert.equal(logic.TEAS.length, 89);
  assert.deepEqual(logic.TEAS, legacyTeaData.TEAS);
  const library = [
    { id: 1, name: '可选绿茶', cat: 'green', nature: '寒', baseNature: '寒', caffeine: '中' },
    { id: 2, name: '已停用红茶', cat: 'black', nature: '温', baseNature: '温', caffeine: '中', disabled: true },
    { id: 3, name: '今日已喝白茶', cat: 'white', nature: '凉', baseNature: '凉', caffeine: '低' },
    { id: 4, name: '品质存疑茶', cat: 'oolong_wuyi', nature: '平', baseNature: '平', caffeine: '中', note: '疑似假货' },
    { id: 5, name: '被回避熟普', cat: 'puerh_ripe', nature: '温', baseNature: '温', caffeine: '低' },
  ];
  const history = [{ date: dateDaysAgo(0), teaId: 3, type: 'primary' }];
  const expected = legacyRecommendation.filterEligible(library, { avoidCats: ['puerh_ripe'] }, history);
  assert.deepEqual(logic.filterEligible(library, { avoidCats: ['puerh_ripe'] }, history), expected);
  assert.deepEqual(expected.map((tea) => tea.id), [1], 'disabled, same-day, quality, and user-category hard filters stay in force');

  const rerollTeas = [
    { id: 21, name: '上一轮主推', cat: 'green', nature: '平', baseNature: '平', caffeine: '中' },
    { id: 22, name: '上一轮备选', cat: 'white', nature: '平', baseNature: '平', caffeine: '中' },
    { id: 23, name: '新候选', cat: 'black', nature: '平', baseNature: '平', caffeine: '中' },
  ];
  assert.deepEqual(logic.recommend(rerollTeas, {}, null, [], 5, null, {}, true, [21, 22]),
    legacyRecommendation.recommend(rerollTeas, {}, null, [], 5, null, {}, true, [21, 22]));
  assert.equal(logic.recommend(rerollTeas, {}, null, [], 5, null, {}, true, [21, 22]).primary.tea.id, 23);

  const preferenceLibrary = [
    { id: 11, name: '近期喜欢', cat: 'green', nature: '平', baseNature: '平', caffeine: '中' },
    { id: 12, name: '同类探索', cat: 'green', nature: '平', baseNature: '平', caffeine: '中' },
    { id: 13, name: '相邻探索', cat: 'white', nature: '平', baseNature: '平', caffeine: '中' },
  ];
  const recentHistory = [{ date: dateDaysAgo(1), teaId: 11, teaCat: 'green', type: 'custom', noteAnalysis: { explicitSentiment: 'positive', confidence: 0.9 } }];
  const realNow = Date.now;
  Date.now = () => new Date(dateDaysAgo(0) + 'T12:00:00').getTime();
  const oldResult = legacyRecommendation.recommend(preferenceLibrary, {}, null, recentHistory, 5, null, {}, true);
  const pwaResult = logic.recommend(preferenceLibrary, {}, null, recentHistory, 5, null, {}, true);
  Date.now = realNow;
  assert.deepEqual(pwaResult, oldResult, 'recommendation order and scores must match the wx implementation');
  assert.equal(pwaResult.primary.tea.id, 11);
  assert.equal(pwaResult.alt.tea.id, 13);

  [1, 2, 3, 4].forEach((days) => {
    const streak = [1, 2, 3, 4].map((ago, index) => ({ date: dateDaysAgo(ago), teaId: 1, type: index % 2 ? 'alt' : 'primary' }));
    assert.deepEqual(logic.getConsecutiveBlockedTeaIds(streak, 5), legacyRecommendation.getConsecutiveBlockedTeaIds(streak, 5));
  });
  const active = { '1': { active: true, expiresAt: Date.now() + 86400000 } };
  assert.deepEqual(logic.getActiveTemporaryAvoidTeaIds(active), legacyRecommendation.getActiveTemporaryAvoidTeaIds(active));
  assert.deepEqual(logic.buildTwoStageCandidatePool(preferenceLibrary, [], preferenceLibrary, {}),
    legacyRecommendation.buildTwoStageCandidatePool(preferenceLibrary, [], preferenceLibrary, {}));
}

async function testKeywordParser(logic) {
  for (const text of [
    '今天只喝绿茶', '今天想喝绿茶', '在长沙，有点上火，不想喝普洱，想喝绿茶，口味清淡',
    '昨晚没睡好，今天不想喝红茶', '今天来点茉莉花茶，想要清淡', '去北京，怕冷，想喝熟普',
  ]) {
    assert.deepEqual(await logic.parseInput(text), await legacyParser.parseInput(text, {}), `keyword parser parity: ${text}`);
  }
  assert.deepEqual((await logic.parseInput('今天只喝绿茶')).strongPreferCats, ['green']);
  assert.deepEqual((await logic.parseInput('今天想喝绿茶')).strongPreferCats, []);
}

function testMatchingAndHistory(logic) {
  for (const input of ['2022晒白金紧压寿眉', '2022年 晒白金·紧压寿眉', '2022 紧压寿眉 晒白金', '紧压寿眉·晒白金', '2099不存在的茶']) {
    assert.deepEqual(logic.matchTeaInput(input, logic.TEAS), legacyTeaMatch.matchTeaInput(input, legacyTeaData.TEAS));
  }
  const repairFixture = [
    { id: 'h_1000000000000_fixed', date: '2026-07-28', checkinTime: '16:20', teaId: -1, teaName: '2022晒白金紧压寿眉', teaCat: 'unknown', teaBrand: '', type: 'custom', updatedAt: 100 },
    { id: 'skip', date: '2026-07-28', teaId: -1, teaName: '2022晒白金紧压寿眉', type: 'skip' },
    { id: 'valid', date: '2026-07-28', teaId: 11, teaName: '紧压寿眉·晒白金', type: 'custom' },
    { id: 'ambiguous', date: '2026-07-28', teaId: -1, teaName: '紧压寿眉·晒白金', type: 'custom' },
    { id: 'unknown', date: '2026-07-28', teaId: -1, teaName: '不存在的茶', type: 'custom' },
  ];
  const oldRepairFixture = structuredClone(repairFixture);
  assert.equal(logic.repairCustomHistoryLinks(repairFixture, logic.TEAS, 999),
    legacyTeaMatch.repairCustomHistoryLinks(oldRepairFixture, legacyTeaData.TEAS, 999));
  assert.deepEqual(repairFixture, oldRepairFixture, 'history repair must preserve all non-link user fields');
  assert.equal(repairFixture[0].teaId, 12);
  assert.equal(repairFixture[0].teaYear, 2022);
  const history = [
    { id: 'h_1900000000000_edit', date: '2026-07-27', checkinTime: '23:00', updatedAt: 9999999999999 },
    { id: 'h_1800000000000_morning', date: '2026-07-28', checkinTime: '09:10' },
    { id: 'h_1700000000000_evening', date: '2026-07-28', checkinTime: '20:30' },
    { id: 'h_1600000000000_missing', date: '2026-07-28' },
    { id: 'h_1750000000000_same', date: '2026-07-28', checkinTime: '20:30' },
    { date: '2026-07-28' },
  ];
  const snapshot = structuredClone(history);
  assert.deepEqual(logic.sortHistoryForDisplay(history), legacyHistoryOrder.sortHistoryForDisplay(history));
  assert.deepEqual(logic.sortHistoryForDisplay(history).map((row) => row.index), [4, 2, 1, 3, 5, 0]);
  assert.deepEqual(history, snapshot, 'display sorting must not mutate stored order');
}

function testLunar(logic) {
  const original = require('../../utils/lunar');
  for (const date of [new Date(2026, 1, 4, 12), new Date(2026, 6, 28, 12), new Date(2026, 11, 21, 12)]) {
    const expected = original.Lunar.fromDate(date);
    const actual = logic.lunarCalendar.Lunar.fromDate(date);
    assert.equal(actual.toString(), expected.toString());
    assert.equal(actual.getJieQi(), expected.getJieQi());
    const summary = logic.getLunarSummary(date);
    assert.equal(summary.lunarText, expected.toString());
    assert.equal(summary.jieQi, expected.getJieQi() || null);
    assert.equal(summary.solarDate, expected.getSolar().toYmd());
  }
}

function testStatistics(logic) {
  const library = [
    { id: 1, name: '绿茶甲', cat: 'green', nature: '寒' },
    { id: 2, name: '红茶乙', cat: 'black', nature: '温' },
    { id: 3, name: '白茶丙', cat: 'white', nature: '凉' },
  ];
  const history = [
    { date: '2026-07-28', teaId: 1, teaName: '绿茶甲', teaCat: 'green', type: 'primary' },
    { date: '2026-07-28', teaId: 1, teaName: '绿茶甲', teaCat: 'green', type: 'alt' },
    { date: '2026-07-28', teaId: 2, teaName: '红茶乙', teaCat: 'black', type: 'primary' },
    { date: '2026-07-28', teaId: -1, teaName: '自选丁', teaCat: 'unknown', type: 'custom' },
    { date: '2026-07-27', teaId: 3, teaName: '白茶丙', teaCat: 'white', type: 'primary' },
    { date: '2026-07-27', teaId: 3, teaName: '白茶丙', teaCat: 'white', type: 'alt' },
    { date: '2026-07-28', teaId: 99, teaName: '略过记录', teaCat: 'unknown', type: 'skip' },
    { date: '2026-06-30', teaId: 1, teaName: '旧记录甲', teaCat: 'green', type: 'custom' },
    { date: '2026-07-01', teaId: 1, teaName: '旧记录乙', teaCat: 'green', type: 'custom' },
  ];
  const now = new Date(2026, 6, 28, 12);
  const actual = logic.getHistoryStats(history, library, now);
  const expected = runLegacyStatsCompute(history, library, now);
  assert.deepEqual(actual, expected, 'PWA statistics must match the old stats page _compute data');
  assert.equal(actual.monthLabel, '2026年7月');
  assert.equal(actual.monthTotal, 7);
  assert.deepEqual(actual.catDist, [
    { key: 'green', name: '绿茶', value: 3, pct: 43 },
    { key: 'white', name: '白茶', value: 2, pct: 29 },
    { key: 'black', name: '红茶', value: 1, pct: 14 },
    { key: 'unknown', name: '自选', value: 1, pct: 14 },
  ], 'equal counts retain the legacy insertion order');
  assert.deepEqual(actual.natureDist.map(({ name, value, pct }) => ({ name, value, pct })), [
    { name: '寒', value: 3, pct: 43 }, { name: '凉', value: 2, pct: 29 },
    { name: '平', value: 0, pct: 0 }, { name: '温', value: 1, pct: 14 },
    { name: '热', value: 0, pct: 0 }, { name: '未知', value: 1, pct: 14 },
  ]);
  assert.deepEqual(actual.top5, [
    { name: '绿茶甲', value: 2, pct: 100 }, { name: '白茶丙', value: 2, pct: 100 },
    { name: '红茶乙', value: 1, pct: 50 }, { name: '自选丁', value: 1, pct: 50 },
    { name: '旧记录甲', value: 1, pct: 50 },
  ]);
  assert.equal(actual.freq.length, 30);
  assert.deepEqual(actual.freq.slice(0, 3).map(({ date, count, height }) => ({ date, count, height })), [
    { date: '2026-06-29', count: 0, height: 8 },
    { date: '2026-06-30', count: 1, height: 55 },
    { date: '2026-07-01', count: 1, height: 55 },
  ]);
  assert.deepEqual(actual.freq.slice(-2).map(({ date, count, height }) => ({ date, count, height })), [
    { date: '2026-07-27', count: 2, height: 90 },
    { date: '2026-07-28', count: 4, height: 120 },
  ]);
  assert.equal(actual.freqDays, 4);
  assert.equal(actual.freqTotal, 8);
}

function runLegacyStatsCompute(history, library, fixedNow) {
  const realDate = global.Date;
  const realPage = global.Page;
  const realWx = global.wx;
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const timestamp = fixedNow.getTime();
  class FixedDate extends realDate {
    constructor(...args) { super(...(args.length ? args : [timestamp])); }
    static now() { return timestamp; }
  }
  const storage = {};
  let pageDefinition;
  global.Date = FixedDate;
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = structuredClone(value); },
  };
  global.setTimeout = () => 1;
  global.clearTimeout = () => {};
  try {
    delete require.cache[require.resolve('../../utils/data')];
    const data = require('../../utils/data');
    const appData = data.getDefaultData();
    appData.history = structuredClone(history);
    appData.teaLibrary = structuredClone(library);
    data.save(appData);
    delete require.cache[require.resolve('../../pages/stats/stats')];
    require('../../pages/stats/stats');
    const captured = {};
    pageDefinition._compute.call({
      setData: (value, callback) => { Object.assign(captured, value); if (callback) callback(); },
      _drawDonut: () => {},
    });
    const { catDist, natureDist, ...withoutVisualFields } = captured;
    return {
      ...withoutVisualFields,
      catDist: catDist.map(({ color, ...item }) => item),
      natureDist: natureDist.map(({ color, ...item }) => item),
    };
  } finally {
    global.Date = realDate;
    global.Page = realPage;
    global.wx = realWx;
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
}

function testInventoryLifecycle(logic) {
  const storage = {};
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = structuredClone(value); },
  };
  const savedTimeout = global.setTimeout;
  const savedClearTimeout = global.clearTimeout;
  global.setTimeout = () => 1;
  global.clearTimeout = () => {};
  delete require.cache[require.resolve('../../utils/data')];
  const legacyData = require('../../utils/data');
  legacyData.save(legacyData.getDefaultData());
  const created = legacyData.upsertInventoryItem({
    teaId: 1, packageType: 'retail', packageLabel: '100g袋装', status: 'sealed', quantity: 2,
    netWeightPerUnit: 100, remainingSessions: 10,
  });
  assert.equal(created.ok, true, created.error);
  const legacyKnowledge = require('../../utils/teaKnowledge');
  const invalidInventoryFixtures = [
    { ...created.item, quantity: 0 },
    { ...created.item, status: 'opened', quantity: 2 },
    { ...created.item, remainingWeight: 120 },
    { ...created.item, purchaseUrl: 'not-a-url' },
    { ...created.item, extraField: true },
  ];
  invalidInventoryFixtures.forEach((item) => {
    assert.deepEqual(logic.validateInventoryItem(item), legacyKnowledge.validateInventoryItem(item));
  });
  let inventory = legacyData.load().inventory;
  const now = 1780000000000;
  const random = Math.random;
  const dateNow = Date.now;
  Math.random = () => 0.5;
  Date.now = () => now;
  try {
    assert.deepEqual(logic.openInventoryItem(inventory, 'missing', { now }).result,
      legacyData.openInventoryItem('missing'));
    const opened = legacyData.openInventoryItem(created.item.id);
    const pwaOpened = logic.openInventoryItem(inventory, created.item.id, {
      now, createId: (timestamp) => `inv_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    });
    assert.deepEqual(pwaOpened.result, opened);
    assert.deepEqual(pwaOpened.inventory, legacyData.load().inventory);
    assert.equal(opened.split, true);
    inventory = pwaOpened.inventory;

    assert.deepEqual(logic.consumeInventorySession(inventory, created.item.id, { now }).result,
      legacyData.consumeInventorySession(created.item.id), 'sealed stock cannot be consumed');

    Date.now = () => now + 1;
    const consumed = legacyData.consumeInventorySession(opened.item.id);
    const pwaConsumed = logic.consumeInventorySession(inventory, opened.item.id, { now: now + 1 });
    assert.deepEqual(pwaConsumed.result, consumed);
    assert.deepEqual(pwaConsumed.inventory, legacyData.load().inventory);
    assert.equal(consumed.item.remainingSessions, 9);
    inventory = pwaConsumed.inventory;

    Date.now = () => now + 2;
    const finished = legacyData.finishInventoryItem(opened.item.id);
    const pwaFinished = logic.finishInventoryItem(inventory, opened.item.id, { now: now + 2 });
    assert.deepEqual(pwaFinished.result, finished);
    assert.deepEqual(pwaFinished.inventory, legacyData.load().inventory);
    inventory = pwaFinished.inventory;

    Date.now = () => now + 3;
    const deleted = legacyData.deleteInventoryItem(opened.item.id);
    const pwaDeleted = logic.deleteInventoryItem(inventory, opened.item.id, { now: now + 3 });
    assert.equal(pwaDeleted.result, deleted);
    assert.deepEqual(pwaDeleted.inventory, legacyData.load().inventory);
    assert.deepEqual(logic.listInventory(pwaDeleted.inventory, 1), legacyData.listInventory(1));
  } finally {
    Math.random = random;
    Date.now = dateNow;
    global.setTimeout = savedTimeout;
    global.clearTimeout = savedClearTimeout;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
