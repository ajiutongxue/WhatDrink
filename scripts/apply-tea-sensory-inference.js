'use strict';

var fs = require('fs');
var path = require('path');
var drafts = require('../data/teaSensoryInferenceDrafts');

var UPDATED_AT = Date.parse('2026-08-04T00:00:00+08:00');
var DEFAULT_CONFIDENCE = 0.38;

function completeness(profile) {
  var filled = 0;
  var total = 0;
  ['identity', 'origin', 'craft', 'sensory', 'effects', 'context', 'brew'].forEach(function(section) {
    Object.keys(profile[section]).forEach(function(fieldName) {
      total += 1;
      if (profile[section][fieldName].value !== null) filled += 1;
    });
  });
  return Number((filled / total).toFixed(4));
}

function apply(catalog) {
  drafts.forEach(function(draft) {
    var profile = (catalog.teas || []).find(function(tea) { return tea.teaId === draft.teaId; });
    if (!profile) return;

    Object.keys(draft.values).forEach(function(fieldName) {
      var field = profile.sensory[fieldName];
      if (!field) throw new Error('Unknown sensory field ' + fieldName + ' for teaId ' + draft.teaId);
      if (field.value !== null) return;
      field.value = draft.values[fieldName];
      field.status = 'inferred';
      field.sourceType = 'llm';
      field.confidence = draft.confidence === undefined ? DEFAULT_CONFIDENCE : draft.confidence;
      field.updatedAt = UPDATED_AT;
      field.evidence = '低置信度感官初稿：基于' + draft.basis + '的保守推测，未引用具体产品品评；应由实饮记录或产品资料覆盖。';
    });

    var note = '感官字段已按低置信度 LLM 初稿补充；仅用于推荐起点，优先等待实饮记录或产品资料覆盖。';
    if (profile.research.notes.indexOf(note) < 0) profile.research.notes.push(note);
    profile.research.completeness = completeness(profile);
  });
  return catalog;
}

function main() {
  var fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node scripts/apply-tea-sensory-inference.js <catalog.json>');
    process.exitCode = 2;
    return;
  }
  try {
    var target = path.resolve(process.cwd(), fileArg);
    var catalog = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
    apply(catalog);
    fs.writeFileSync(target, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
    console.log('Applied low-confidence sensory inference to ' + target + '.');
  } catch (err) {
    console.error('Apply failed: ' + err.message);
    process.exitCode = 1;
  }
}

module.exports = apply;

if (require.main === module) main();
