'use strict';

var fs = require('fs');
var path = require('path');

async function runAll() {
  var testDir = __dirname;
  var files = fs.readdirSync(testDir)
    .filter(function(file) { return /\.test\.js$/.test(file); })
    .sort();

  if (!files.length) throw new Error('No test files found.');

  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    console.log('> ' + file);
    var run = require(path.join(testDir, file));
    if (typeof run !== 'function') throw new Error(file + ' must export a test function');
    await run();
  }

  console.log('All ' + files.length + ' test files passed.');
}

module.exports = runAll;

if (require.main === module) {
  runAll().catch(function(err) {
    console.error(err);
    process.exitCode = 1;
  });
}