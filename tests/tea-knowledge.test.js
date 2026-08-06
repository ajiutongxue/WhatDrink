'use strict';

var assert = require('assert');
var teaData = require('../utils/teaData');
var teaKnowledge = require('../utils/teaKnowledge');
var batchMerger = require('../scripts/merge-tea-knowledge-batches');
var samples = require('../data/tea-knowledge.samples.json');
var batchInput = require('../data/tea-knowledge.batch-input.json');
var batchManifest = require('../data/tea-knowledge-research-batches/manifest.json');
var teaPackageObservations = require('../data/teaPackageObservations');
var teaProductResearchObservations = require('../data/teaProductResearchObservations');
var teaSensoryInferenceDrafts = require('../data/teaSensoryInferenceDrafts');
var research01Output = require('../data/tea-knowledge-model-outputs/research-01.output.json');
var research02Output = require('../data/tea-knowledge-model-outputs/research-02.output.json');
var research03Output = require('../data/tea-knowledge-model-outputs/research-03.output.json');
var research04Output = require('../data/tea-knowledge-model-outputs/research-04.output.json');
var research05Output = require('../data/tea-knowledge-model-outputs/research-05.output.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasError(result, fragment) {
  return result.errors.some(function(error) { return error.indexOf(fragment) >= 0; });
}

async function run() {
  var teaIds = teaData.TEAS.map(function(tea) { return tea.id; });
  var valid = teaKnowledge.validateCatalog(samples, { expectedTeaIds: teaIds });
  assert.deepStrictEqual(valid, { ok: true, errors: [] }, 'sample catalog should satisfy the shared contract');

  var stagedOutputs = [research01Output, research02Output, research03Output, research04Output, research05Output];
  var stagedProfiles = [].concat.apply([], stagedOutputs.map(function(output) { return output.teas; }));
  var expectedDraftIds = teaIds.filter(function(teaId) { return [0, 25, 68].indexOf(teaId) < 0; });
  assert.deepStrictEqual(stagedProfiles.map(function(profile) { return profile.teaId; }).sort(function(a, b) { return a - b; }), expectedDraftIds);
  assert.strictEqual(new Set(stagedProfiles.map(function(profile) { return profile.teaId; })).size, 86, 'staged drafts must not duplicate a tea across batches');
  stagedOutputs.forEach(function(output) {
    assert.strictEqual(output.purpose, 'import');
    assert.deepStrictEqual(output.withheldTeaIds, [0, 25, 68]);
    assert.deepStrictEqual(teaKnowledge.validateCatalog(output), { ok: true, errors: [] }, 'each staged output must satisfy the contract');
  });
  var researchedTea21 = research02Output.teas.filter(function(tea) { return tea.teaId === 21; })[0];
  assert.strictEqual(researchedTea21.identity.form.value, '紧压茶');
  assert.strictEqual(researchedTea21.identity.form.sourceType, 'retailer');
  var researchedTea26 = research02Output.teas.filter(function(tea) { return tea.teaId === 26; })[0];
  assert.strictEqual(researchedTea26.identity.displayName.value, '赛珍珠1000浓香铁观音');
  assert.strictEqual(researchedTea26.identity.packagingVariant.value, null);
  assert.strictEqual(researchedTea26.origin.cultivar.sourceType, 'official');

  assert.strictEqual(samples.expectedTeaCount, 89);
  assert.deepStrictEqual(samples.teas.map(function(profile) { return profile.teaId; }), [14, 35, 51]);
  assert.strictEqual(samples.teas[0].identity.displayName.value, '紧压寿眉·马饼');
  assert.strictEqual(samples.teas[0].origin.materialGrade.value, '寿眉');
  assert.strictEqual(samples.teas[1].identity.productCode.value, 'AT102');
  assert.strictEqual(samples.teas[2].identity.displayName.value, '易武正山饼茶');

  var fieldCount = Object.keys(teaKnowledge.contract.sections).reduce(function(total, sectionName) {
    return total + Object.keys(teaKnowledge.contract.sections[sectionName]).length;
  }, 0);
  assert.strictEqual(fieldCount, 35, 'package weight must not be counted as a tea knowledge field');
  assert.strictEqual(teaKnowledge.contract.schemaVersion, 2);
  assert.strictEqual(teaKnowledge.contract.sections.identity.netWeightGrams, undefined);
  assert.ok(teaKnowledge.contract.inventoryRecord.fields.netWeightPerUnit, 'actual package weight belongs to inventory records');

  var sampleInventory = {
    id: 'inv_sample_16', teaId: 16, packageType: 'sample', packageLabel: '试饮装',
    sku: '100327585866', purchaseUrl: 'https://item.jd.com/100327585866.html',
    status: 'opened', quantity: 1, netWeightPerUnit: 5, remainingWeight: 2,
    openedAt: samples.generatedAt, updatedAt: samples.generatedAt
  };
  assert.deepStrictEqual(teaKnowledge.validateInventoryItem(sampleInventory), { ok: true, errors: [] });

  var retailInventory = clone(sampleInventory);
  retailInventory.id = 'inv_retail_16';
  retailInventory.packageType = 'retail';
  retailInventory.packageLabel = '50g正装';
  retailInventory.status = 'sealed';
  retailInventory.quantity = 2;
  retailInventory.netWeightPerUnit = 50;
  delete retailInventory.remainingWeight;
  delete retailInventory.openedAt;
  assert.deepStrictEqual(teaKnowledge.validateInventoryItem(retailInventory), { ok: true, errors: [] }, 'the same tea may have separate retail inventory');

  var pendingInventory = clone(sampleInventory);
  pendingInventory.id = 'inv_pending_17';
  pendingInventory.teaId = 17;
  pendingInventory.packageType = 'unknown';
  pendingInventory.packageLabel = 'details pending';
  pendingInventory.status = 'unknown';
  delete pendingInventory.netWeightPerUnit;
  delete pendingInventory.remainingWeight;
  delete pendingInventory.openedAt;
  assert.deepStrictEqual(teaKnowledge.validateInventoryItem(pendingInventory), { ok: true, errors: [] }, 'partially confirmed packages may remain unknown');

  var invalidInventory = clone(sampleInventory);
  invalidInventory.quantity = 2;
  invalidInventory.remainingWeight = 6;
  var invalidInventoryResult = teaKnowledge.validateInventoryItem(invalidInventory);
  assert.ok(hasError(invalidInventoryResult, 'must represent one physical package'));
  assert.ok(hasError(invalidInventoryResult, 'cannot exceed netWeightPerUnit'));

  assert.strictEqual(batchInput.expectedTeaCount, 89);
  assert.strictEqual(batchInput.researchTeaCount, 86);
  assert.deepStrictEqual(batchInput.withheldTeaIds, [0, 25, 68]);
  assert.strictEqual(batchInput.batches.length, 5);
  assert.strictEqual(batchManifest.batchFiles.length, 5);
  assert.strictEqual(batchManifest.batchFiles[0], 'research-01.input.json');
  assert.strictEqual(teaPackageObservations.length, 31);
  assert.strictEqual(new Set(teaPackageObservations.map(function(item) { return item.teaId; })).size, 31);
  assert.strictEqual(teaProductResearchObservations.length, 21);
  assert.strictEqual(new Set(teaProductResearchObservations.map(function(item) { return item.teaId; })).size, 21);
  assert.strictEqual(teaSensoryInferenceDrafts.length, 20);
  assert.strictEqual(new Set(teaSensoryInferenceDrafts.map(function(item) { return item.teaId; })).size, 20);
  assert.strictEqual(teaPackageObservations.filter(function(item) { return item.teaId === 11; })[0].netWeightPerUnit, 20);
  var researchedTea2 = research01Output.teas.filter(function(tea) { return tea.teaId === 2; })[0];
  assert.strictEqual(researchedTea2.origin.materialGrade.value, '明前特级');
  assert.strictEqual(researchedTea2.origin.materialGrade.sourceType, 'retailer');
  var correctedTea18 = research01Output.teas.filter(function(tea) { return tea.teaId === 18; })[0];
  assert.strictEqual(correctedTea18.research.conflicts.join(' ').indexOf('云南白毫银针'), -1);
  assert.ok(correctedTea18.identity.displayName.sourceRefs[0].indexOf('1070897446954') >= 0);
  assert.strictEqual(teaData.TEAS.filter(function(tea) { return tea.id === 5; })[0].name, '\u7941\u95e8\u7ea2\u8336\u00b71985');
  var batchIds = [].concat.apply([], batchInput.batches.map(function(batch) { return batch.teaIds; }));
  assert.strictEqual(new Set(batchIds).size, 86, 'research batches must not repeat tea IDs');
  assert.strictEqual(batchIds.indexOf(0), -1, 'withheld teas must not appear in research batches');
  var tea5 = [].concat.apply([], batchInput.batches.map(function(batch) { return batch.teas; }))
    .filter(function(tea) { return tea.teaId === 5; })[0];
  assert.strictEqual(tea5.currentIdentity.displayName, '\u7941\u95e8\u7ea2\u8336\u00b71985');
  assert.strictEqual(tea5.confirmedPackageLinks[0].status, 'opened');
  var tea18 = [].concat.apply([], batchInput.batches.map(function(batch) { return batch.teas; }))
    .filter(function(tea) { return tea.teaId === 18; })[0];
  assert.strictEqual(tea18.confirmedPackageLinks[0].replacesUrls, undefined);
  assert.ok(tea18.confirmedPackageLinks[0].url.indexOf('1070897446954') >= 0);
  var tea20 = [].concat.apply([], batchInput.batches.map(function(batch) { return batch.teas; }))
    .filter(function(tea) { return tea.teaId === 20; })[0];
  assert.ok(tea20.confirmedPackageLinks[0].url.indexOf('663676941882') >= 0);
  assert.strictEqual(tea20.confirmedPackageLinks[0].replacesSkus, undefined);
  assert.strictEqual(tea20.currentIdentity.displayName, '陈韵寿眉');
  assert.strictEqual(tea20.confirmedPackageLinks[0].netWeightPerUnit, 120);
  var researchedTea20 = research01Output.teas.filter(function(tea) { return tea.teaId === 20; })[0];
  assert.strictEqual(researchedTea20.identity.displayName.value, '陈韵寿眉');
  assert.strictEqual(researchedTea20.origin.region.value, '福建福鼎太姥山');
  assert.deepStrictEqual(researchedTea20.sensory.aromaTags.value, ['枣香']);
  assert.strictEqual(researchedTea20.sensory.aromaTags.sourceType, 'retailer');
  assert.deepStrictEqual(researchedTea20.sensory.flavorTags.value, ['甜润', '醇厚']);
  assert.strictEqual(researchedTea20.sensory.flavorTags.sourceType, 'llm');
  assert.strictEqual(researchedTea20.research.conflicts.length, 0);
  var uncertainTea17 = research01Output.teas.filter(function(tea) { return tea.teaId === 17; })[0];
  assert.strictEqual(uncertainTea17.sensory.aromaTags.value, null);
  assert.strictEqual(uncertainTea17.sensory.flavorTags.value, null);
  assert.strictEqual(uncertainTea17.sensory.sweetness.confidence, 0.3);
  var at102a = [].concat.apply([], batchInput.batches.map(function(batch) { return batch.teas; }))
    .filter(function(tea) { return tea.teaId === 34; })[0];
  assert.ok(at102a.confirmedClarifications.join(' ').indexOf('AT102A') >= 0);

  var invalidScale = clone(samples);
  invalidScale.teas[0].sensory.sweetness = {
    value: 6, status: 'inferred', sourceType: 'llm', confidence: 0.8,
    updatedAt: samples.generatedAt, evidence: 'invalid test value'
  };
  assert.ok(hasError(teaKnowledge.validateCatalog(invalidScale), 'must be between 0 and 5'));

  var invalidInference = clone(samples);
  invalidInference.teas[0].identity.form.sourceType = 'official';
  assert.ok(hasError(teaKnowledge.validateCatalog(invalidInference), 'inferred field must use llm source'));

  var invalidUnknown = clone(samples);
  invalidUnknown.teas[0].origin.region.confidence = 0.4;
  assert.ok(hasError(teaKnowledge.validateCatalog(invalidUnknown), 'unknown field must use zero confidence'));

  var invalidResearch = clone(samples);
  invalidResearch.teas[0].origin.region = {
    value: '福鼎', status: 'researched', sourceType: 'official', confidence: 0.9,
    updatedAt: samples.generatedAt, evidence: 'missing source URL'
  };
  assert.ok(hasError(teaKnowledge.validateCatalog(invalidResearch), 'researched field requires source references'));

  var missingField = clone(samples);
  delete missingField.teas[1].craft.roastLevel;
  assert.ok(hasError(teaKnowledge.validateCatalog(missingField), 'craft.roastLevel: is missing'));

  var duplicate = clone(samples);
  duplicate.teas.push(clone(duplicate.teas[0]));
  assert.ok(hasError(teaKnowledge.validateCatalog(duplicate), 'duplicate teaId 14'));

  var wrongCompleteness = clone(samples);
  wrongCompleteness.teas[0].research.completeness = 1;
  assert.ok(hasError(teaKnowledge.validateCatalog(wrongCompleteness), 'must equal calculated value'));

  var fakeConfirmation = clone(samples);
  fakeConfirmation.teas[0].identity.brand.sourceType = 'llm';
  assert.ok(hasError(teaKnowledge.validateCatalog(fakeConfirmation), 'confirmed field must use user, package, or purchase source'));

  var missingBatchMembership = clone(samples);
  missingBatchMembership.batches[0].teaIds = [14, 35];
  assert.ok(hasError(teaKnowledge.validateCatalog(missingBatchMembership), 'does not declare profile teaId 51'));

  var importPackage = clone(samples);
  importPackage.purpose = 'import';
  importPackage.expectedTeaCount = 4;
  importPackage.withheldTeaIds = [88];
  importPackage.teas.forEach(function(profile) { profile.lifecycle = 'complete'; });
  var importResult = teaKnowledge.validateCatalog(importPackage, {
    expectedTeaIds: [14, 35, 51, 88],
    requireComplete: true
  });
  assert.deepStrictEqual(importResult, { ok: true, errors: [] }, 'declared withheld teas may be omitted from an atomic import');

  importPackage.withheldTeaIds = [];
  assert.ok(hasError(teaKnowledge.validateCatalog(importPackage, {
    expectedTeaIds: [14, 35, 51, 88],
    requireComplete: true
  }), 'missing non-withheld teaId 88'));

  var catalogCountMismatch = clone(samples);
  catalogCountMismatch.expectedTeaCount = 88;
  assert.ok(hasError(teaKnowledge.validateCatalog(catalogCountMismatch, { expectedTeaIds: teaIds }), 'current tea library count 89'));

  var retainedIds = [14, 35, 51];
  var mergeWithheld = teaIds.filter(function(teaId) { return retainedIds.indexOf(teaId) < 0; });
  var firstBatch = clone(samples);
  firstBatch.purpose = 'import';
  firstBatch.catalogVersion = 'batch-one';
  firstBatch.withheldTeaIds = mergeWithheld;
  firstBatch.teas = firstBatch.teas.slice(0, 2);
  firstBatch.teas.forEach(function(profile) { profile.lifecycle = 'complete'; });
  firstBatch.batches = [{ batchId: 'batch-one', model: 'test-model', teaIds: [14, 35] }];

  var secondBatch = clone(samples);
  secondBatch.purpose = 'import';
  secondBatch.catalogVersion = 'batch-two';
  secondBatch.withheldTeaIds = mergeWithheld;
  secondBatch.teas = secondBatch.teas.slice(2);
  secondBatch.teas.forEach(function(profile) { profile.lifecycle = 'complete'; });
  secondBatch.batches = [{ batchId: 'batch-two', model: 'test-model', teaIds: [51] }];

  var merged = batchMerger.mergeCatalogs([
    { target: 'batch-one.json', catalog: firstBatch },
    { target: 'batch-two.json', catalog: secondBatch }
  ], 'merged-test');
  assert.strictEqual(merged.ok, true, merged.errors && merged.errors.join('\n'));
  assert.deepStrictEqual(merged.catalog.teas.map(function(profile) { return profile.teaId; }), retainedIds);
  assert.strictEqual(merged.catalog.withheldTeaIds.length, 86);

  secondBatch.teas.push(clone(firstBatch.teas[0]));
  secondBatch.batches[0].teaIds.push(14);
  var duplicateMerge = batchMerger.mergeCatalogs([
    { target: 'batch-one.json', catalog: firstBatch },
    { target: 'batch-two.json', catalog: secondBatch }
  ], 'duplicate-test');
  assert.strictEqual(duplicateMerge.ok, false);
  assert.ok(hasError(duplicateMerge, 'duplicate profile teaId 14 across batches'));

  console.log('tea knowledge contract tests passed');
}

module.exports = run;
