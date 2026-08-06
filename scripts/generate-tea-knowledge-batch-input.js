'use strict';

var fs = require('fs');
var path = require('path');
var teaData = require('../utils/teaData');
var contract = require('../data/tea-knowledge.contract.json');
var packageObservations = require('../data/teaPackageObservations');

var DEFAULT_BATCH_SIZE = 20;
var DEFAULT_WITHHELD_IDS = [0, 25, 68];

function readOption(name) {
  var index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseWithheld(value) {
  if (value === undefined) return DEFAULT_WITHHELD_IDS.slice();
  if (value === 'none' || value === '') return [];
  var ids = value.split(',').map(function(item) { return Number(item.trim()); });
  if (ids.some(function(id) { return !Number.isInteger(id) || id < 0; })) {
    throw new Error('--withheld must be a comma-separated list of non-negative tea IDs, or none');
  }
  return ids.filter(function(id, index) { return ids.indexOf(id) === index; });
}

function parseBatchSize(value) {
  if (value === undefined) return DEFAULT_BATCH_SIZE;
  var size = Number(value);
  if (!Number.isInteger(size) || size < 1 || size > 89) throw new Error('--batch-size must be an integer from 1 to 89');
  return size;
}

function clarificationFor(teaId) {
  if (teaId === 14) return ['原料等级已由用户确认为寿眉，不是白牡丹。', '规范名称为紧压寿眉·马饼。'];
  if (teaId === 34) return ['产品型号已由用户确认为 AT102A。', '这是新黄罐，不得引用 AT102 旧黄罐资料。'];
  if (teaId === 35) return ['产品型号已由用户确认为 AT102。', '这是旧黄罐，不得引用 AT102A 新黄罐资料。'];
  return [];
}

function packageLinksFor(teaId) {
  return packageObservations
    .filter(function(item) { return item.teaId === teaId; })
    .map(function(item) {
      var result = Object.assign({}, item, { confirmedBy: 'user' });
      delete result.teaId;
      delete result.replacesUrls;
      delete result.replacesSkus;
      return result;
    });
}

function toResearchInput(tea) {
  return {
    teaId: tea.id,
    currentIdentity: {
      displayName: tea.name,
      brand: tea.brand,
      category: tea.cat,
      year: tea.year
    },
    confirmedClarifications: clarificationFor(tea.id),
    confirmedPackageLinks: packageLinksFor(tea.id)
  };
}

function makeBatches(teas, batchSize) {
  var batches = [];
  for (var start = 0; start < teas.length; start += batchSize) {
    var number = batches.length + 1;
    var batchTeas = teas.slice(start, start + batchSize);
    batches.push({
      batchId: 'research-' + String(number).padStart(2, '0'),
      teaIds: batchTeas.map(function(tea) { return tea.teaId; }),
      teas: batchTeas
    });
  }
  return batches;
}

var knownIds = teaData.TEAS.map(function(tea) { return tea.id; });
var withheldTeaIds = parseWithheld(readOption('--withheld'));
withheldTeaIds.forEach(function(id) {
  if (knownIds.indexOf(id) < 0) throw new Error('unknown withheld teaId ' + id);
});

var batchSize = parseBatchSize(readOption('--batch-size'));
var outputArg = readOption('--out') || 'data/tea-knowledge.batch-input.json';
var target = path.resolve(__dirname, '..', outputArg);
var batchDirArg = readOption('--batch-dir') || 'data/tea-knowledge-research-batches';
var batchDir = path.resolve(__dirname, '..', batchDirArg);
var researchTeas = teaData.TEAS
  .filter(function(tea) { return withheldTeaIds.indexOf(tea.id) < 0; })
  .map(toResearchInput);

var generatedAt = Date.now();
var result = {
  schemaVersion: contract.schemaVersion,
  purpose: 'research_input',
  generatedAt: generatedAt,
  expectedTeaCount: teaData.TEAS.length,
  researchTeaCount: researchTeas.length,
  withheldTeaIds: withheldTeaIds,
  contractFile: 'data/tea-knowledge.contract.json',
  sampleFile: 'data/tea-knowledge.samples.json',
  instructionFile: 'docs/tea-knowledge-batch-rules.md',
  outputRequirement: '每个批次单独输出一个符合契约的 JSON 目录，不要输出 Markdown 代码围栏。',
  batches: makeBatches(researchTeas, batchSize)
};

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(result, null, 2) + '\n', 'utf8');
fs.mkdirSync(batchDir, { recursive: true });

var batchFiles = result.batches.map(function(batch) {
  var fileName = batch.batchId + '.input.json';
  var batchPackage = {
    schemaVersion: contract.schemaVersion,
    purpose: 'research_batch_input',
    generatedAt: generatedAt,
    expectedTeaCount: teaData.TEAS.length,
    withheldTeaIds: withheldTeaIds,
    batchId: batch.batchId,
    teaIds: batch.teaIds,
    teas: batch.teas,
    sharedFiles: [
      'docs/tea-knowledge-batch-rules.md',
      'data/tea-knowledge.contract.json',
      'data/tea-knowledge.samples.json'
    ],
    outputRequirement: result.outputRequirement
  };
  fs.writeFileSync(path.join(batchDir, fileName), JSON.stringify(batchPackage, null, 2) + '\n', 'utf8');
  return fileName;
});

var manifest = {
  schemaVersion: contract.schemaVersion,
  generatedAt: generatedAt,
  expectedTeaCount: teaData.TEAS.length,
  researchTeaCount: researchTeas.length,
  withheldTeaIds: withheldTeaIds,
  batchFiles: batchFiles
};
fs.writeFileSync(path.join(batchDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('Generated ' + target + ': ' + researchTeas.length + ' teas in ' + result.batches.length + ' batches; withheld ' + withheldTeaIds.join(',') + '.');
console.log('Standalone batch files: ' + batchDir + '.');
