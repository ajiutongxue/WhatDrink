'use strict';

var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var sourcePath = path.join(root, 'data', 'tea-knowledge.import-v1.json');
var outputPath = path.join(root, 'data', 'teaKnowledgeCatalog.js');
var catalog = JSON.parse(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''));

var output = "'use strict';\n\n// Generated from data/tea-knowledge.import-v1.json. Do not edit by hand.\nmodule.exports = " +
  JSON.stringify(catalog) + ';\n';

fs.writeFileSync(outputPath, output, 'utf8');
console.log('Generated ' + path.relative(root, outputPath) + ' (' + Buffer.byteLength(output) + ' bytes)');
