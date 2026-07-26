'use strict';

var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
var errors = [];

function rel(file) { return path.relative(root, file).replace(/\\/g, '/'); }
function fail(message) { errors.push(message); }
function read(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (err) { fail(rel(file) + ': cannot read file: ' + err.message); return ''; }
}
function loadManifest() {
  var file = path.join(root, 'ui-prototype', 'manifest.json');
  try { return JSON.parse(read(file).replace(/^\uFEFF/, '')); }
  catch (err) { fail('ui-prototype/manifest.json: invalid JSON: ' + err.message); return null; }
}
function checkPage(page) {
  if (!page || !page.id || !page.prototype || !page.miniProgram || !Array.isArray(page.states) || !page.states.length) {
    fail('ui-prototype/manifest.json: every page needs id, prototype, miniProgram and states');
    return;
  }
  var prototypeFile = path.join(root, page.prototype);
  if (!fs.existsSync(prototypeFile)) { fail(page.prototype + ': prototype page is missing'); return; }
  var html = read(prototypeFile);
  if (html.indexOf('data-page="' + page.id + '"') === -1) fail(page.prototype + ': missing data-page="' + page.id + '"');
  if (!/\bdata-section="[^"]+"/.test(html)) fail(page.prototype + ': expected at least one data-section marker');
  var seen = {};
  page.states.forEach(function(state) {
    if (seen[state]) fail(page.prototype + ': duplicate state in manifest: ' + state);
    seen[state] = true;
    if (html.indexOf('data-state="' + state + '"') === -1) fail(page.prototype + ': missing data-state="' + state + '"');
  });
  ['.js', '.json', '.wxml', '.wxss'].forEach(function(ext) {
    var miniFile = path.join(root, page.miniProgram + ext);
    if (!fs.existsSync(miniFile)) fail(rel(miniFile) + ': mapped mini-program page file is missing');
  });
}
function main() {
  var manifest = loadManifest();
  if (!manifest) return false;
  if (manifest.version !== 1) fail('ui-prototype/manifest.json: expected version 1');
  if (!Array.isArray(manifest.viewports) || manifest.viewports.length < 2) fail('ui-prototype/manifest.json: expected at least two target viewports');
  if (!Array.isArray(manifest.pages) || manifest.pages.length !== 5) {
    fail('ui-prototype/manifest.json: expected exactly five mapped pages');
  } else {
    var ids = {};
    manifest.pages.forEach(function(page) {
      if (ids[page.id]) fail('ui-prototype/manifest.json: duplicate page id ' + page.id);
      ids[page.id] = true;
      checkPage(page);
    });
  }
  ['ui-prototype/index.html', 'ui-prototype/styles/tokens.css', 'ui-prototype/styles/base.css',
    'ui-prototype/styles/components.css', 'ui-prototype/styles/pages.css', 'ui-prototype/scripts/fixtures.js',
    'ui-prototype/scripts/prototype.js', 'ui-prototype/README.md', 'docs/ui-prototype-plan.md'
  ].forEach(function(file) {
    if (!fs.existsSync(path.join(root, file))) fail(file + ': required UI prototype file is missing');
  });
  var hubHTML = read(path.join(root, 'ui-prototype', 'index.html'));
  ['hub-phase', 'hub-weather'].forEach(function(id) {
    if (hubHTML.indexOf('id="' + id + '"') === -1) fail('ui-prototype/index.html: missing scene control ' + id);
  });
  var recommendationHTML = read(path.join(root, 'ui-prototype', 'pages', 'recommendation.html'));
  ['scene-container', 'scene-base', 'scene-overlay', 'scene-tint'].forEach(function(className) {
    if (recommendationHTML.indexOf('class="' + className) === -1) fail('ui-prototype/pages/recommendation.html: missing scene layer ' + className);
  });
  var prototypeCSS = read(path.join(root, 'ui-prototype', 'styles', 'pages.css'));
  ['.recommendation-page.phase-night .solar-custom', '.recommendation-page.phase-night .hero-date-divider', '.recommendation-page.phase-night [data-state="input"] .field', '.recommendation-page.phase-night .recommendation-reason'].forEach(function(selector) {
    if (prototypeCSS.indexOf(selector) === -1) fail('ui-prototype/styles/pages.css: missing night palette selector ' + selector);
  });
  if (errors.length) {
    errors.forEach(function(message) { console.error('ERROR: ' + message); });
    console.error('\nUI prototype check failed with ' + errors.length + ' error(s).');
    return false;
  }
  var stateCount = manifest.pages.reduce(function(total, page) { return total + page.states.length; }, 0);
  console.log('UI prototype check passed: ' + manifest.pages.length + ' pages, ' + stateCount + ' states, ' + manifest.viewports.length + ' viewports.');
  return true;
}
module.exports = main;
if (require.main === module && !main()) process.exitCode = 1;
