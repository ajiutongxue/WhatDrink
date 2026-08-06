'use strict';

// Generates reviewable, low-confidence initial profiles for batches that have
// not yet gone through product-level online research.  It deliberately uses
// only the tea-library record and facts explicit in the display name.

var fs = require('fs');
var path = require('path');
var contract = require('../data/tea-knowledge.contract.json');
var teaData = require('../utils/teaData');

var UPDATED_AT = Date.parse('2026-08-04T00:00:00+08:00');
var outputDirectory = path.join(__dirname, '..', 'data', 'tea-knowledge-model-outputs');
var batchInput = require('../data/tea-knowledge.batch-input.json');

function field(value, status, sourceType, confidence, evidence) {
  var result = { value: value, status: status, sourceType: sourceType, confidence: confidence, updatedAt: UPDATED_AT };
  if (evidence) result.evidence = evidence;
  return result;
}
function unknown() { return field(null, 'unknown', 'unknown', 0); }
function confirmed(value, evidence) { return field(value, 'confirmed', 'user', 1, evidence); }
function inferred(value, confidence, evidence) { return field(value, 'inferred', 'llm', confidence, evidence); }
function inherited(value, confidence, evidence) { return field(value, 'inherited', 'category_default', confidence, evidence); }

function blankProfile(teaId) {
  var profile = { teaId: teaId, profileVersion: 1, lifecycle: 'complete', research: { completeness: 0, conflicts: [], notes: [] } };
  Object.keys(contract.sections).forEach(function(sectionName) {
    profile[sectionName] = {};
    Object.keys(contract.sections[sectionName]).forEach(function(fieldName) { profile[sectionName][fieldName] = unknown(); });
  });
  return profile;
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

var categoryDefaults = {
  white: {
    process: ['萎凋', '干燥'], effects: [2, 3, 2], seasons: ['春', '秋', '冬'], times: ['上午', '下午', '饭后'],
    brew: [['盖碗', '煮茶壶'], { min: 90, max: 100 }, 3.5, { min: 30, max: 60 }, 2.5],
    sensory: [['毫香', '甜香'], ['清甜', '柔和'], [2.5, 3.5, 1, 1.5, 2.5, 3.5, 3, 3]]
  },
  oolong_dancong: {
    process: ['萎凋', '做青', '烘焙'], effects: [3.5, 2, 3.5], seasons: ['春', '秋'], times: ['上午', '下午'],
    brew: [['盖碗'], { min: 95, max: 100 }, 6.5, { min: 15, max: 20 }, 3.5],
    sensory: [['花香', '蜜香'], ['鲜爽', '回甘'], [4, 3, 2, 3, 3, 2.5, 3.5, 4]]
  },
  oolong_tieguanyin: {
    process: ['萎凋', '做青', '包揉', '烘焙'], effects: [3.5, 2, 3.5], seasons: ['春', '秋'], times: ['上午', '下午'],
    brew: [['盖碗', '紫砂壶'], { min: 95, max: 100 }, 6.5, { min: 20, max: 30 }, 3],
    sensory: [['兰花香'], ['鲜爽', '回甘'], [3.5, 3, 2, 2.5, 3, 3, 3.5, 4]]
  },
  oolong_wuyi: {
    process: ['萎凋', '做青', '烘焙'], effects: [3.5, 2, 3.5], seasons: ['秋', '冬'], times: ['上午', '下午', '饭后'],
    brew: [['盖碗', '紫砂壶'], { min: 98, max: 100 }, 6.5, { min: 15, max: 25 }, 3.5],
    sensory: [['焙火香', '花果香'], ['醇厚', '回甘'], [3.5, 3, 2, 2.5, 3.5, 3, 3.5, 4]]
  },
  puerh_raw: {
    process: ['晒青', '蒸压'], effects: [3, 2, 3], seasons: ['春', '夏'], times: ['上午', '下午'],
    brew: [['盖碗', '紫砂壶'], { min: 95, max: 100 }, 6.5, { min: 10, max: 20 }, 3.5],
    sensory: [['花香', '蜜香'], ['鲜爽', '回甘'], [3, 3, 3, 3, 3, 2.5, 3.5, 4]]
  },
  puerh_ripe: {
    process: ['渥堆', '蒸压'], effects: [2, 3.5, 2], seasons: ['秋', '冬'], times: ['上午', '饭后', '晚间'],
    brew: [['紫砂壶', '盖碗'], { min: 100, max: 100 }, 6.5, { min: 10, max: 15 }, 3],
    sensory: [['陈香', '木香'], ['醇厚', '甜润'], [3, 3.5, 1, 1.5, 4, 4, 3, 4]]
  },
  flavored_jasmine: {
    process: ['窨制'], effects: [2.5, 2.5, 2.5], seasons: ['春', '夏'], times: ['上午', '下午'],
    brew: [['玻璃杯', '盖碗'], { min: 85, max: 90 }, 2.5, { min: 60, max: 120 }, 2],
    sensory: [['茉莉花香'], ['鲜爽', '清甜'], [4, 3, 1.5, 2, 2, 3, 2.5, 2.5]]
  },
  flavored_other: {
    process: [], effects: [2, 3, 2], seasons: ['秋', '冬'], times: ['上午', '饭后'],
    brew: [['盖碗', '煮茶壶'], { min: 90, max: 100 }, 3.5, { min: 60, max: 180 }, 2],
    sensory: [['复合香气'], ['甜润'], [3, 3, 1, 1, 2.5, 3, 2.5, 2.5]]
  }
};

function directNameValue(name, mapping) {
  for (var i = 0; i < mapping.length; i += 1) if (name.indexOf(mapping[i][0]) >= 0) return mapping[i][1];
  return null;
}

function applyExplicitNameFacts(profile, tea) {
  var name = tea.name;
  var form = directNameValue(name, [['解散茶', '散茶'], ['散茶', '散茶'], ['茶砖', '紧压砖茶'], ['小茶砖', '紧压砖茶'], ['饼', '紧压饼茶'], ['龙珠', '紧压龙珠'], ['方片', '紧压方片'], ['沱', '紧压沱茶']]);
  if (form) {
    profile.identity.form = inferred(form, 0.88, '名称直接包含成品形态词，仍待产品资料核验。');
    profile.craft.compression = inferred(form === '散茶' ? 'loose' : (name.indexOf('薄饼') >= 0 ? 'light' : 'tight'), 0.78, '由名称中的成品形态推测紧压程度，尚未实测。');
  }
  var cultivar = directNameValue(name, [['老枞水仙', '水仙'], ['水仙', '水仙'], ['肉桂', '肉桂'], ['铁罗汉', '铁罗汉'], ['铁观音', '铁观音'], ['寿眉', '寿眉'], ['白牡丹', '白牡丹'], ['鸭屎香', '鸭屎香'], ['蜜兰香', '蜜兰香']]);
  if (cultivar) profile.origin.cultivar = inferred(cultivar, 0.88, '名称直接包含品种或原料等级词，待包装或官方资料核验。');
  var grade = directNameValue(name, [['寿眉', '寿眉'], ['特级', '特级'], ['一级', '一级']]);
  if (grade) profile.origin.materialGrade = inferred(grade, 0.82, '名称直接包含等级或原料等级词，待产品资料核验。');
  var region = directNameValue(name, [['易武', '易武茶区'], ['忙麓山', '忙麓山'], ['班盆', '班盆'], ['那卡', '那卡'], ['冰岛', '冰岛茶区'], ['班章', '班章茶区'], ['景迈', '景迈茶区'], ['昔归', '昔归茶区'], ['大雪山', '大雪山茶区']]);
  if (region) profile.origin.region = inferred(region, 0.76, '名称直接包含产区或山头词；不能据此补充更细的原料范围。');
  var roast = directNameValue(name, [['中足火', 'medium_high'], ['中轻火', 'light'], ['足火', 'high'], ['轻火', 'light'], ['中火', 'medium']]);
  if (roast) {
    profile.craft.roastLevel = inferred(roast, 0.9, '名称直接标注焙火程度，映射为标准化等级。');
    profile.craft.processTags = inferred(['烘焙'], 0.82, '名称直接标注焙火，初稿仅记录一般烘焙工艺。');
  }
  if (name.indexOf('陈韵') >= 0 || name.indexOf('老茶') >= 0) profile.craft.agingState = inferred('陈化中', 0.5, '名称含陈化暗示，未核验实际仓储与年份。');
  if (tea.id === 34 || tea.id === 35) {
    profile.identity.productCode = confirmed(tea.id === 34 ? 'AT102A' : 'AT102', tea.id === 34 ? '用户确认新黄罐老枞水仙对应 AT102A。' : '用户确认黄罐老枞水仙对应 AT102。');
    profile.identity.packagingVariant = confirmed(tea.id === 34 ? '新黄罐' : '旧黄罐', '用户明确要求与另一黄罐水仙作为不同 teaId 区分。');
  }
}

function applyCategoryDefaults(profile, tea) {
  var preset = categoryDefaults[tea.cat];
  if (!preset) throw new Error('Missing conservative draft preset for ' + tea.cat);
  if (preset.process.length && profile.craft.processTags.value === null) profile.craft.processTags = inherited(preset.process, 0.45, '茶类通用工艺初稿，并非该商品已查证的独有特征。');
  var labels = ['stimulation', 'emptyStomachFriendliness', 'sleepImpact'];
  labels.forEach(function(label, index) { profile.effects[label] = inherited(preset.effects[index], 0.4, '茶类通用体感倾向；不是医学结论，也需被个人记录覆盖。'); });
  profile.context.bestSeasons = inherited(preset.seasons, 0.45, '茶类通用饮用季节初稿。');
  profile.context.bestTimes = inherited(preset.times, 0.45, '茶类通用饮用时段初稿。');
  profile.brew.vessels = inherited(preset.brew[0], 0.55, '沿用茶库现有茶类冲泡指引，待实物试泡调整。');
  profile.brew.waterTempC = inherited(preset.brew[1], 0.55, '沿用茶库现有茶类冲泡指引，待实物试泡调整。');
  profile.brew.gramsPer100ml = inherited(preset.brew[2], 0.55, '沿用茶库现有茶类冲泡指引，待实物试泡调整。');
  profile.brew.firstSteepSeconds = inherited(preset.brew[3], 0.55, '沿用茶库现有茶类冲泡指引，待实物试泡调整。');
  profile.brew.difficulty = inherited(preset.brew[4], 0.45, '按茶类功夫泡容错度估计，待实物试泡调整。');
  var sensory = preset.sensory;
  profile.sensory.aromaTags = inferred(sensory[0], 0.35, '低置信度 LLM 茶类感官初稿，不代表该具体批次。');
  profile.sensory.flavorTags = inferred(sensory[1], 0.35, '低置信度 LLM 茶类感官初稿，不代表该具体批次。');
  ['aromaIntensity', 'sweetness', 'bitterness', 'astringency', 'body', 'smoothness', 'aftertaste', 'durability'].forEach(function(label, index) {
    profile.sensory[label] = inferred(sensory[2][index], 0.35, '低置信度 LLM 茶类感官初稿，不代表该具体批次。');
  });
}

function makeProfile(tea) {
  var profile = blankProfile(tea.id);
  profile.identity.displayName = confirmed(tea.name, '用户现有茶库名称。');
  profile.identity.brand = confirmed(tea.brand, '用户现有茶库品牌记录。');
  profile.identity.category = confirmed(tea.cat, '用户现有茶库分类。');
  if (tea.year !== null && tea.year !== undefined) profile.identity.year = confirmed(tea.year, '用户现有茶库年份记录。');
  applyExplicitNameFacts(profile, tea);
  applyCategoryDefaults(profile, tea);
  profile.research.notes.push('这是未联网核验的保守初稿：仅使用茶库记录、名称显式信息和茶类默认值；商品级事实仍需外部资料或实物包装补充。');
  updateCompleteness(profile);
  return profile;
}

var force = process.argv.indexOf('--force') >= 0;
var selectedBatches = batchInput.batches.filter(function(batch) { return batch.batchId !== 'research-01'; });
var catalogTeaById = teaData.TEAS.reduce(function(result, tea) { result[tea.id] = tea; return result; }, {});

selectedBatches.forEach(function(batch) {
  var target = path.join(outputDirectory, batch.batchId + '.output.json');
  if (fs.existsSync(target) && !force) throw new Error('Refusing to overwrite ' + target + '; use --force only after review.');
  var teas = batch.teaIds.map(function(teaId) {
    if (!catalogTeaById[teaId]) throw new Error('Tea not found in teaData: ' + teaId);
    return makeProfile(catalogTeaById[teaId]);
  });
  var output = {
    schemaVersion: contract.schemaVersion,
    documentation: 'docs/tea-knowledge-field-guide.md',
    purpose: 'import',
    catalogVersion: 'conservative-draft-v1-' + batch.batchId,
    generatedAt: UPDATED_AT,
    expectedTeaCount: teaData.TEAS.length,
    withheldTeaIds: batchInput.withheldTeaIds,
    batches: [{ batchId: batch.batchId, model: 'codex-conservative-draft-v1', teaIds: batch.teaIds }],
    teas: teas
  };
  fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log('Generated ' + target + ' with ' + teas.length + ' conservative draft profile(s).');
});
