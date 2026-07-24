'use strict';

var checkProject = require('./check-project');
var runTests = require('../tests/run');

async function verify() {
  if (!checkProject()) throw new Error('Static project check failed.');
  await runTests();
  console.log('Verification passed.');
}

verify().catch(function(err) {
  console.error(err.message || err);
  process.exitCode = 1;
});