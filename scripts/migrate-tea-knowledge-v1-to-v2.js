'use strict';

var fs = require('fs');
var path = require('path');
var contract = require('../data/tea-knowledge.contract.json');

function completeness(profile) {
  var known = 0;
  var total = 0;
  Object.keys(contract.sections).forEach(function(sectionName) {
    Object.keys(contract.sections[sectionName]).forEach(function(fieldName) {
      total += 1;
      if (profile[sectionName][fieldName].value !== null) known += 1;
    });
  });
  return Number((known / total).toFixed(4));
}

function migrate(catalog) {
  if (catalog.schemaVersion !== 1) throw new Error('input catalog must use schemaVersion 1');
  catalog.schemaVersion = 2;
  (catalog.teas || []).forEach(function(profile) {
    if (profile.identity) delete profile.identity.netWeightGrams;
    if (profile.research) profile.research.completeness = completeness(profile);
  });
  return catalog;
}

function writeAtomic(target, value) {
  var temporary = target + '.tmp-' + process.pid;
  var backup = target + '.v1.bak';
  if (fs.existsSync(backup)) throw new Error('backup already exists: ' + backup);
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(target, backup);
    fs.renameSync(temporary, target);
  } catch (err) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (!fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw err;
  }
}

function main() {
  var fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node scripts/migrate-tea-knowledge-v1-to-v2.js <catalog.json>');
    process.exitCode = 2;
    return;
  }
  try {
    var target = path.resolve(process.cwd(), fileArg);
    var catalog = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
    migrate(catalog);
    writeAtomic(target, catalog);
    console.log('Migrated ' + target + ' to schemaVersion 2.');
  } catch (err) {
    console.error('Migration failed: ' + err.message);
    process.exitCode = 1;
  }
}

module.exports = migrate;

if (require.main === module) main();
