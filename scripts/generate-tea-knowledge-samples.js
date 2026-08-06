'use strict';

var fs = require('fs');
var path = require('path');
var contract = require('../data/tea-knowledge.contract.json');
var teaData = require('../utils/teaData');

var UPDATED_AT = Date.parse('2026-07-31T00:00:00+08:00');

function field(value, status, sourceType, confidence, evidence, sourceRefs) {
  var result = {
    value: value,
    status: status,
    sourceType: sourceType,
    confidence: confidence,
    updatedAt: UPDATED_AT
  };
  if (evidence) result.evidence = evidence;
  if (sourceRefs && sourceRefs.length) result.sourceRefs = sourceRefs;
  return result;
}

function unknown() {
  return field(null, 'unknown', 'unknown', 0);
}

function confirmed(value, evidence) {
  return field(value, 'confirmed', 'user', 1, evidence);
}

function inferred(value, confidence, evidence) {
  return field(value, 'inferred', 'llm', confidence, evidence);
}

function inherited(value, confidence, evidence) {
  return field(value, 'inherited', 'category_default', confidence, evidence);
}

function blankProfile(teaId) {
  var profile = {
    teaId: teaId,
    profileVersion: 1,
    lifecycle: 'sample',
    research: { completeness: 0, conflicts: [], notes: [] }
  };
  Object.keys(contract.sections).forEach(function(sectionName) {
    profile[sectionName] = {};
    Object.keys(contract.sections[sectionName]).forEach(function(fieldName) {
      profile[sectionName][fieldName] = unknown();
    });
  });
  return profile;
}

function setIdentity(profile, displayName, brand, category, year) {
  profile.identity.displayName = confirmed(displayName, '用户确认的茶库名称');
  profile.identity.brand = confirmed(brand, '用户现有茶库记录');
  profile.identity.category = confirmed(category, '用户现有茶库分类');
  profile.identity.year = confirmed(year, '用户现有茶库年份');
}

function updateCompleteness(profile) {
  var known = 0;
  var total = 0;
  Object.keys(contract.sections).forEach(function(sectionName) {
    Object.keys(contract.sections[sectionName]).forEach(function(fieldName) {
      total += 1;
      if (profile[sectionName][fieldName].value !== null) known += 1;
    });
  });
  profile.research.completeness = Number((known / total).toFixed(4));
}

function makeMaBing() {
  var profile = blankProfile(14);
  setIdentity(profile, '紧压寿眉·马饼', '品品香', 'white', 2024);
  profile.identity.packagingVariant = confirmed('马饼', '用户确认“品品香马饼”是寿眉，旧名称中的白牡丹为误写');
  profile.identity.form = inferred('紧压饼茶', 0.9, '由“马饼”和用户确认的寿眉判断，仅作为待查证初稿');
  profile.origin.materialGrade = confirmed('寿眉', '用户明确纠正为寿眉');
  profile.craft.processTags = inherited(['萎凋', '干燥', '紧压'], 0.55, '白茶紧压饼的类别默认工艺，尚未核实该批次产品资料');
  profile.craft.compression = inferred('tight', 0.75, '由紧压饼茶形态推测，尚未实测');
  profile.context.bestSeasons = inherited(['春', '夏', '秋'], 0.6, '沿用当前茶库白茶类别默认季节');
  profile.research.notes.push('故意保留产地、香气、滋味、体感和冲泡参数等未知字段，供后续联网补全。');
  updateCompleteness(profile);
  return profile;
}

function makeAt102() {
  var profile = blankProfile(35);
  setIdentity(profile, '黄罐老枞水仙（足火）', '海堤', 'oolong_wuyi', 2020);
  profile.identity.productCode = confirmed('AT102', '用户确认旧黄罐老枞水仙对应 AT102；AT102A 是库内另一款新黄罐');
  profile.identity.packagingVariant = confirmed('旧黄罐', '用户用旧黄罐与新黄罐区分两款产品');
  profile.identity.form = inferred('罐装散茶', 0.8, '由黄罐产品名称推测，包装净重和规格仍需查证');
  profile.origin.cultivar = inferred('水仙', 0.95, '产品名称直接包含水仙，但仍需以包装或官方资料确认品种描述');
  profile.craft.processTags = inferred(['足火烘焙'], 0.95, '产品名称明确标注足火');
  profile.craft.roastLevel = inferred('high', 0.9, '将名称中的足火映射为标准化高焙火等级');
  profile.craft.compression = inferred('loose', 0.8, '罐装岩茶通常为散茶，仍需实物或商品资料确认');
  profile.context.bestSeasons = inherited(['秋', '冬'], 0.6, '沿用当前茶库武夷岩茶类别默认季节');
  profile.research.notes.push('AT102 与 AT102A 必须作为两个 teaId 分别检索，禁止按名称相似自动合并。');
  updateCompleteness(profile);
  return profile;
}

function makeYiWu() {
  var profile = blankProfile(51);
  setIdentity(profile, '易武正山饼茶', '八角亭', 'puerh_raw', 2023);
  profile.identity.form = inferred('紧压饼茶', 0.95, '产品名称直接包含饼茶');
  profile.origin.region = inferred('易武茶区', 0.8, '由产品名称中的易武正山推测，具体山头与原料范围待查证');
  profile.craft.processTags = inherited(['晒青', '蒸压'], 0.55, '普洱生茶饼的类别默认工艺，尚未核实产品批次资料');
  profile.craft.compression = inferred('tight', 0.8, '由饼茶形态推测，尚未实测紧压程度');
  profile.context.bestSeasons = inherited(['夏'], 0.6, '沿用当前茶库普洱生茶类别默认季节');
  profile.research.notes.push('名称只能支持茶区级初步判断，不应据此补写山头、树龄或古树等级。');
  updateCompleteness(profile);
  return profile;
}

var profiles = [makeAt102(), makeYiWu(), makeMaBing()].sort(function(a, b) { return a.teaId - b.teaId; });
var catalog = {
  schemaVersion: contract.schemaVersion,
  documentation: 'docs/tea-knowledge-field-guide.md',
  purpose: 'sample',
  catalogVersion: 'sample-v1',
  generatedAt: UPDATED_AT,
  expectedTeaCount: teaData.TEAS.length,
  withheldTeaIds: [],
  batches: [
    {
      batchId: 'codex-conservative-draft-v1',
      model: 'codex-initial-draft',
      teaIds: profiles.map(function(profile) { return profile.teaId; })
    }
  ],
  teas: profiles
};

var target = path.join(__dirname, '..', 'data', 'tea-knowledge.samples.json');
fs.writeFileSync(target, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
console.log('Generated ' + target + ' with ' + profiles.length + ' sample profiles.');
