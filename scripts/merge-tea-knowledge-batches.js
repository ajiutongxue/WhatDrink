'use strict';

var fs = require('fs');
var path = require('path');
var teaData = require('../utils/teaData');
var teaKnowledge = require('../utils/teaKnowledge');

function optionValue(args, name) {
  var index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function inputFiles(args) {
  var valuesToSkip = {};
  ['--out', '--catalog-version'].forEach(function(name) {
    var index = args.indexOf(name);
    if (index >= 0) {
      valuesToSkip[index] = true;
      valuesToSkip[index + 1] = true;
    }
  });
  return args.filter(function(value, index) {
    return index > 1 && !valuesToSkip[index] && value.indexOf('--') !== 0;
  });
}

function parseCatalog(file) {
  var target = path.resolve(process.cwd(), file);
  var catalog = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
  return { target: target, catalog: catalog };
}

function validateBatch(catalog, expectedTeaIds) {
  var result = teaKnowledge.validateCatalog(catalog, {
    expectedTeaIds: expectedTeaIds,
    requireComplete: false
  });
  if (catalog.purpose !== 'import') result.errors.push('purpose: batch output must use import');
  (catalog.teas || []).forEach(function(profile, index) {
    if (profile.lifecycle !== 'complete') result.errors.push('teas[' + index + '].lifecycle: batch output must use complete');
  });
  result.ok = result.errors.length === 0;
  return result;
}

function sameIds(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  var a = left.slice().sort(function(x, y) { return x - y; });
  var b = right.slice().sort(function(x, y) { return x - y; });
  return a.every(function(value, index) { return value === b[index]; });
}

function mergeCatalogs(entries, catalogVersion) {
  if (!entries.length) return { ok: false, errors: ['no batch files supplied'] };

  var expectedTeaIds = teaData.TEAS.map(function(tea) { return tea.id; });
  var errors = [];
  var profileById = {};
  var batchIds = {};
  var mergedBatches = [];
  var withheldTeaIds = entries[0].catalog.withheldTeaIds;

  entries.forEach(function(entry) {
    var result = validateBatch(entry.catalog, expectedTeaIds);
    result.errors.forEach(function(error) { errors.push(path.basename(entry.target) + ': ' + error); });

    if (!sameIds(entry.catalog.withheldTeaIds, withheldTeaIds)) {
      errors.push(path.basename(entry.target) + ': withheldTeaIds differs from the first batch');
    }

    (entry.catalog.teas || []).forEach(function(profile) {
      if (profileById[profile.teaId]) errors.push(path.basename(entry.target) + ': duplicate profile teaId ' + profile.teaId + ' across batches');
      else profileById[profile.teaId] = profile;
    });

    (entry.catalog.batches || []).forEach(function(batch) {
      if (batchIds[batch.batchId]) errors.push(path.basename(entry.target) + ': duplicate batchId ' + batch.batchId);
      else {
        batchIds[batch.batchId] = true;
        mergedBatches.push(batch);
      }
    });
  });

  if (errors.length) return { ok: false, errors: errors };

  var merged = {
    schemaVersion: teaKnowledge.contract.schemaVersion,
    documentation: 'docs/tea-knowledge-field-guide.md',
    purpose: 'import',
    catalogVersion: catalogVersion,
    generatedAt: Date.now(),
    expectedTeaCount: expectedTeaIds.length,
    withheldTeaIds: withheldTeaIds.slice().sort(function(a, b) { return a - b; }),
    batches: mergedBatches,
    teas: Object.keys(profileById).map(function(id) { return profileById[id]; })
      .sort(function(a, b) { return a.teaId - b.teaId; })
  };

  var finalResult = teaKnowledge.validateCatalog(merged, {
    expectedTeaIds: expectedTeaIds,
    requireComplete: true
  });
  return finalResult.ok ? { ok: true, errors: [], catalog: merged } : finalResult;
}

function writeAtomic(target, catalog) {
  if (fs.existsSync(target)) throw new Error('output already exists; choose a new --out path: ' + target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  var temporary = target + '.tmp-' + process.pid;
  try {
    fs.writeFileSync(temporary, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
    fs.renameSync(temporary, target);
  } catch (err) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw err;
  }
}

function main() {
  var args = process.argv;
  var files = inputFiles(args);
  var output = optionValue(args, '--out');
  var catalogVersion = optionValue(args, '--catalog-version');
  if (!files.length || !output || !catalogVersion) {
    console.error('Usage: node scripts/merge-tea-knowledge-batches.js <batch1.json> ... --out <import.json> --catalog-version <version>');
    process.exitCode = 2;
    return;
  }

  try {
    var entries = files.map(parseCatalog);
    var result = mergeCatalogs(entries, catalogVersion);
    if (!result.ok) {
      console.error('Merge rejected with ' + result.errors.length + ' error(s):');
      result.errors.forEach(function(error) { console.error('- ' + error); });
      process.exitCode = 1;
      return;
    }
    var target = path.resolve(process.cwd(), output);
    writeAtomic(target, result.catalog);
    console.log('Merged ' + files.length + ' batch file(s) into ' + target + ' with ' + result.catalog.teas.length + ' profiles.');
  } catch (err) {
    console.error('Merge failed: ' + err.message);
    process.exitCode = 1;
  }
}

module.exports = {
  mergeCatalogs: mergeCatalogs,
  validateBatch: validateBatch
};

if (require.main === module) main();
