'use strict';

var assert = require('assert');
var teaData = require('../utils/teaData');
var teaMatch = require('../utils/teaMatch');
var historyOrder = require('../utils/historyOrder');

async function run() {
  testTeaMatching();
  testHistoryRepair();
  testHistoryOrdering();
  console.log('tea/history tests passed');
}

function testTeaMatching() {
  var library = teaData.TEAS;
  ['2022晒白金紧压寿眉', '2022年 晒白金·紧压寿眉', '2022 紧压寿眉 晒白金'].forEach(function(input) {
    var result = teaMatch.matchTeaInput(input, library);
    assert.strictEqual(result.status, 'matched', input + ' should match the library');
    assert.strictEqual(result.tea.id, 12, input + ' should resolve to the 2022 tea');
    assert.strictEqual(result.matchKind, 'strong');
  });

  var ambiguous = teaMatch.matchTeaInput('紧压寿眉·晒白金', library);
  assert.strictEqual(ambiguous.status, 'ambiguous', 'same-name years must require a year');
  assert.deepStrictEqual(ambiguous.candidates.map(function(tea) { return tea.id; }), [11, 12, 13]);

  var unknown = teaMatch.matchTeaInput('2099不存在的茶', library);
  assert.strictEqual(unknown.status, 'none', 'a nonexistent year/name must stay custom');
}

function testHistoryRepair() {
  var notes = { explicitSentiment: 'positive', confidence: 0.9 };
  var images = [{ fileID: 'cloud://image', caption: '汤色' }];
  var history = [
    {
      id: 'h_1000000000000_fixed', date: '2026-07-28', checkinTime: '16:20',
      teaId: -1, teaName: '2022晒白金紧压寿眉', teaCat: 'unknown', teaBrand: '', type: 'custom',
      tastingNotes: '枣香', noteAnalysis: notes, imageFileIDs: images, updatedAt: 100
    },
    { id: 'skip', date: '2026-07-28', teaId: -1, teaName: '2022晒白金紧压寿眉', type: 'skip' },
    { id: 'valid', date: '2026-07-28', teaId: 11, teaName: '紧压寿眉·晒白金', type: 'custom' },
    { id: 'ambiguous', date: '2026-07-28', teaId: -1, teaName: '紧压寿眉·晒白金', type: 'custom' },
    { id: 'unknown', date: '2026-07-28', teaId: -1, teaName: '不存在的茶', type: 'custom' }
  ];

  var repaired = teaMatch.repairCustomHistoryLinks(history, teaData.TEAS, 999);
  assert.strictEqual(repaired, 1, 'only a strong unique custom record should be repaired');
  assert.strictEqual(history[0].teaId, 12);
  assert.strictEqual(history[0].teaName, '紧压寿眉·晒白金');
  assert.strictEqual(history[0].teaCat, 'white');
  assert.strictEqual(history[0].teaBrand, '品品香');
  assert.strictEqual(history[0].teaYear, 2022, 'repaired history should keep a displayable year snapshot');
  assert.strictEqual(history[0].updatedAt, 999);
  assert.strictEqual(history[0].id, 'h_1000000000000_fixed');
  assert.strictEqual(history[0].checkinTime, '16:20');
  assert.strictEqual(history[0].tastingNotes, '枣香');
  assert.strictEqual(history[0].noteAnalysis, notes);
  assert.strictEqual(history[0].imageFileIDs, images);
  assert.deepStrictEqual(history.slice(1).map(function(entry) { return entry.teaId; }), [-1, 11, -1, -1]);
  assert.strictEqual(teaMatch.repairCustomHistoryLinks(history, teaData.TEAS, 1000), 0, 'repair must be idempotent');
}

function testHistoryOrdering() {
  var history = [
    { id: 'h_1900000000000_edit', date: '2026-07-27', checkinTime: '23:00', updatedAt: 9999999999999 },
    { id: 'h_1800000000000_morning', date: '2026-07-28', checkinTime: '09:10' },
    { id: 'h_1700000000000_evening', date: '2026-07-28', checkinTime: '20:30' },
    { id: 'h_1600000000000_missing', date: '2026-07-28' },
    { id: 'h_1750000000000_same', date: '2026-07-28', checkinTime: '20:30' },
    { date: '2026-07-28' }
  ];
  var snapshot = history.slice();
  var ordered = historyOrder.sortHistoryForDisplay(history);

  assert.deepStrictEqual(
    ordered.map(function(item) { return item.index; }),
    [4, 2, 1, 3, 5, 0],
    'display order must use date, time, stable creation time, then original index'
  );
  assert.deepStrictEqual(history, snapshot, 'display sorting must not reorder persisted history');
  assert.strictEqual(ordered[0].entry, history[4], 'display references must keep the original entry');
  assert.strictEqual(ordered[0].index, 4, 'display references must keep the original edit index');
}

module.exports = run;
