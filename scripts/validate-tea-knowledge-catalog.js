'use strict';

var fs = require('fs');
var path = require('path');
var teaData = require('../utils/teaData');
var teaKnowledge = require('../utils/teaKnowledge');

var fileArg = process.argv[2];
var mode = process.argv.indexOf('--import') >= 0 ? 'import' : 'batch';

if (!fileArg) {
  console.error('Usage: node scripts/validate-tea-knowledge-catalog.js <json-file> [--import]');
  process.exitCode = 2;
} else {
  try {
    var target = path.resolve(process.cwd(), fileArg);
    var catalog = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
    var expectedTeaIds = teaData.TEAS.map(function(tea) { return tea.id; });
    var result = teaKnowledge.validateCatalog(catalog, {
      expectedTeaIds: expectedTeaIds,
      requireComplete: mode === 'import'
    });

    if (catalog.purpose !== 'import') result.errors.push('purpose: model output must use import');
    (catalog.teas || []).forEach(function(profile, index) {
      if (profile.lifecycle !== 'complete') result.errors.push('teas[' + index + '].lifecycle: model output must use complete');
    });
    result.ok = result.errors.length === 0;

    if (!result.ok) {
      console.error('Validation failed with ' + result.errors.length + ' error(s):');
      result.errors.forEach(function(error) { console.error('- ' + error); });
      process.exitCode = 1;
    } else {
      console.log('Validation passed for ' + path.basename(target) + ' in ' + mode + ' mode: ' + catalog.teas.length + ' profile(s).');
    }
  } catch (err) {
    console.error('Validation failed: ' + err.message);
    process.exitCode = 1;
  }
}
