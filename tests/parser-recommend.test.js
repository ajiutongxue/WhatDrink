'use strict';

var assert = require('assert');

// tracker.js only touches wx when an event is emitted; keep a minimal mock so
// the test remains robust if keyword parsing later gains tracking.
var storage = {};
global.wx = {
  getStorageSync: function(key) { return storage[key]; },
  setStorageSync: function(key, value) { storage[key] = value; }
};

var parser = require('../utils/parser');
var recommend = require('../utils/recommend');
var teaData = require('../utils/teaData');

function dateDaysAgo(days) {
  var d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - (days || 0));
  return d.getFullYear() + '-' +
    ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
    ('0' + d.getDate()).slice(-2);
}

function today() {
  return dateDaysAgo(0);
}

async function run() {
  assert.strictEqual(teaData.TEAS.length, 89, 'bundled tea count must stay explicit');
  var ids = {};
  teaData.TEAS.forEach(function(tea) {
    assert.ok(!ids[tea.id], 'tea IDs must be unique: ' + tea.id);
    ids[tea.id] = true;
    assert.ok(tea.nature, 'every tea must have computed nature');
  });

  var parsed = await parser.parseInput('在长沙，有点上火，不想喝普洱，想喝绿茶，口味清淡', {});
  assert.strictEqual(parsed.city, '长沙');
  assert.ok(parsed.states.indexOf('热证') >= 0, 'must detect heat symptoms');
  assert.ok(parsed.avoidCats.indexOf('puerh_raw') >= 0, 'must avoid raw puerh');
  assert.ok(parsed.avoidCats.indexOf('puerh_ripe') >= 0, 'must avoid ripe puerh');
  assert.ok(parsed.preferCats.indexOf('green') >= 0, 'must prefer green tea');
  assert.strictEqual(parsed.mood, 'light');

  var insomnia = await parser.parseInput('昨晚没睡好，今天不想喝红茶', null);
  assert.ok(insomnia.states.indexOf('失眠') >= 0, 'must detect insomnia');
  assert.ok(insomnia.avoidCats.indexOf('black') >= 0, 'must detect category avoidance');

  var library = [
    { id: 1, name: '可选绿茶', cat: 'green', nature: '寒', baseNature: '寒', caffeine: '中' },
    { id: 2, name: '已停用红茶', cat: 'black', nature: '温', baseNature: '温', caffeine: '中', disabled: true },
    { id: 3, name: '今日已喝白茶', cat: 'white', nature: '凉', baseNature: '凉', caffeine: '低' },
    { id: 4, name: '品质存疑茶', cat: 'oolong_wuyi', nature: '平', baseNature: '平', caffeine: '中', note: '疑似假货' },
    { id: 5, name: '被回避熟普', cat: 'puerh_ripe', nature: '温', baseNature: '温', caffeine: '低' }
  ];
  var eligible = recommend.filterEligible(
    library,
    { avoidCats: ['puerh_ripe'] },
    [{ date: today(), teaId: 3, type: 'primary' }]
  );
  assert.deepStrictEqual(eligible.map(function(tea) { return tea.id; }), [1], 'hard filters must exclude disabled/today/quality/avoided teas');
  var firstFourDrinkingDays = [1, 2, 3, 4].map(function(days, idx) {
    return { date: dateDaysAgo(days), teaId: 1, type: idx % 2 ? 'alt' : 'primary' };
  });
  assert.ok(!recommend.getConsecutiveBlockedTeaIds(firstFourDrinkingDays, 5)[1], 'tea must still be eligible after four consecutive drinking days');

  var firstFiveDrinkingDays = firstFourDrinkingDays.concat([
    { date: dateDaysAgo(5), teaId: 1, type: 'custom' }
  ]);
  assert.ok(recommend.getConsecutiveBlockedTeaIds(firstFiveDrinkingDays, 5)[1], 'tea must be blocked only after five completed drinking days');

  var multiSessionHistory = firstFiveDrinkingDays.concat([
    { date: dateDaysAgo(3), teaId: -1, type: 'skip' },
    { date: dateDaysAgo(3), teaId: 1, type: 'primary' },
    { date: dateDaysAgo(2), teaId: -1, type: 'custom' }
  ]);
  assert.ok(recommend.getConsecutiveBlockedTeaIds(multiSessionHistory, 5)[1], 'skip, duplicate, and unknown custom entries must not override actual drinks on the same day');

  var twoTeasPerDay = [];
  [1, 2, 3, 4, 5].forEach(function(days) {
    twoTeasPerDay.push({ date: dateDaysAgo(days), teaId: 1, type: 'primary' });
    twoTeasPerDay.push({ date: dateDaysAgo(days), teaId: 5, type: 'custom' });
  });
  var multiTeaBlocked = recommend.getConsecutiveBlockedTeaIds(twoTeasPerDay, 5);
  assert.ok(multiTeaBlocked[1] && multiTeaBlocked[5], 'multiple teas drunk per day must build independent streaks');

  var streakWithGap = [1, 2, 4, 5, 6].map(function(days) {
    return { date: dateDaysAgo(days), teaId: 1, type: 'primary' };
  });
  streakWithGap.push({ date: dateDaysAgo(3), teaId: 5, type: 'custom' });
  assert.ok(!recommend.getConsecutiveBlockedTeaIds(streakWithGap, 5)[1], 'drinking another tea must reset this tea streak even if it was recommended');

  var streakFiltered = recommend.filterEligible(library, {}, firstFiveDrinkingDays, 5);
  assert.ok(streakFiltered.every(function(tea) { return tea.id !== 1; }), 'day-six block must apply to the shared AI/rule candidate pool');

  var activeAvoid = { '1': { active: true, expiresAt: Date.now() + 86400000, updatedAt: Date.now() } };
  var temporaryFiltered = recommend.filterEligible(library, {}, [], 5, activeAvoid);
  assert.ok(temporaryFiltered.every(function(tea) { return tea.id !== 1; }), 'active temporary avoids must be a shared hard filter');
  var expiredFiltered = recommend.filterEligible(library, {}, [], 5, { '1': { active: true, expiresAt: Date.now() - 1 } });
  assert.ok(expiredFiltered.some(function(tea) { return tea.id === 1; }), 'expired temporary avoids must restore eligibility automatically');

  var preferenceLibrary = [
    { id: 11, name: '近期喜欢', cat: 'green', nature: '平', baseNature: '平', caffeine: '中' },
    { id: 12, name: '同类探索', cat: 'green', nature: '平', baseNature: '平', caffeine: '中' },
    { id: 13, name: '相邻探索', cat: 'white', nature: '平', baseNature: '平', caffeine: '中' }
  ];
  var recentPreferenceHistory = [{
    date: dateDaysAgo(1), teaId: 11, teaCat: 'green', type: 'custom',
    noteAnalysis: { explicitSentiment: 'positive', confidence: 0.9 }
  }];
  var pref = recommend.buildPreferenceContext(recentPreferenceHistory, preferenceLibrary, true);
  assert.ok(recommend.preferenceScoreForTea(preferenceLibrary[0], pref) > recommend.preferenceScoreForTea(preferenceLibrary[1], pref), 'recent actual drinking and explicit liking must raise tea preference');
  var notesOff = recommend.buildPreferenceContext(recentPreferenceHistory, preferenceLibrary, false);
  assert.ok(recommend.preferenceScoreForTea(preferenceLibrary[0], pref) > recommend.preferenceScoreForTea(preferenceLibrary[0], notesOff), 'disabling note analysis must stop stored analyses affecting preference');
  var dynamicResult = recommend.recommend(preferenceLibrary, {}, null, recentPreferenceHistory, 5, null, {}, true);
  assert.strictEqual(dynamicResult.primary.tea.id, 11, 'primary should follow recent taste momentum');
  assert.strictEqual(dynamicResult.alt.tea.id, 13, 'alternative should prefer adjacent exploration when base fitness is comparable');

  var coldConstitution = recommend.getIdealNature('春', null, [], '偏寒', 10, 0);
  var hotConstitution = recommend.getIdealNature('春', null, [], '偏热', 10, 0);
  assert.ok(coldConstitution > hotConstitution, 'constitution must shift ideal nature in opposite directions');
  assert.strictEqual(recommend.adjustNature('white', 2010, '凉'), '温');
  assert.strictEqual(recommend.adjustNature('puerh_raw', 2010, '寒'), '平');

  console.log('parser/recommend tests passed');
}

module.exports = run;

if (require.main === module) {
  run().catch(function(err) {
    console.error(err);
    process.exitCode = 1;
  });
}