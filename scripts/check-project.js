'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
var errors = [];
var warnings = [];
var counts = { js: 0, json: 0, pages: 0, handlers: 0, assets: 0 };

function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function exists(relativePath) { return fs.existsSync(path.join(root, relativePath)); }

function walk(dir, result) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function(entry) {
    // The PWA frontend and API have their own build/tests; this checker only
    // parses WeChat-program JavaScript (which is not ESM).
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'miniprogram_npm' ||
        entry.name === 'web' || entry.name === 'server') return;
    var full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, result);
    else result.push(full);
  });
  return result;
}

function readJSON(file) {
  try {
    counts.json++;
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    fail(rel(file) + ': invalid JSON: ' + err.message);
    return null;
  }
}

function checkJavaScript(files) {
  files.filter(function(file) { return path.extname(file) === '.js'; }).forEach(function(file) {
    counts.js++;
    var source = fs.readFileSync(file, 'utf8');
    try {
      new vm.Script(source, { filename: rel(file), displayErrors: true });
    } catch (err) {
      fail(rel(file) + ': JavaScript syntax error: ' + err.message);
    }

    var requireRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    var match;
    while ((match = requireRe.exec(source))) {
      var target = path.resolve(path.dirname(file), match[1]);
      if (!fs.existsSync(target) && !fs.existsSync(target + '.js') && !fs.existsSync(target + '.json') && !fs.existsSync(path.join(target, 'index.js'))) {
        fail(rel(file) + ': unresolved local require ' + match[1]);
      }
    }
  });
}

function checkPage(pagePath) {
  counts.pages++;
  var base = path.join(root, pagePath);
  ['.js', '.json', '.wxml', '.wxss'].forEach(function(ext) {
    if (!fs.existsSync(base + ext)) fail(pagePath + ext + ': missing page file');
  });
  if (!fs.existsSync(base + '.js') || !fs.existsSync(base + '.wxml')) return;

  var js = fs.readFileSync(base + '.js', 'utf8');
  var wxml = fs.readFileSync(base + '.wxml', 'utf8');
  var methods = {};
  var methodRe = /^\s{2}([A-Za-z_$][\w$]*):\s*function\b/gm;
  var methodMatch;
  while ((methodMatch = methodRe.exec(js))) methods[methodMatch[1]] = true;

  var handlerRe = /(?:bind|catch)(?::)?[a-zA-Z]+\s*=\s*"([^"]+)"/g;
  var handlerMatch;
  while ((handlerMatch = handlerRe.exec(wxml))) {
    var handler = handlerMatch[1].trim();
    if (!handler || handler.indexOf('{{') === 0) continue;
    counts.handlers++;
    if (!methods[handler]) fail(pagePath + '.wxml: handler "' + handler + '" is missing from page JS');
  }

  var assetRe = /(?:src|poster)\s*=\s*"(\/?(?:images|assets)\/[^"{]+)"/g;
  var assetMatch;
  while ((assetMatch = assetRe.exec(wxml))) {
    var asset = assetMatch[1].replace(/^\//, '');
    counts.assets++;
    if (!exists(asset)) fail(pagePath + '.wxml: missing static asset ' + asset);
  }
}

function checkProjectConfig() {
  var appPath = path.join(root, 'app.json');
  var app = readJSON(appPath);
  if (!app) return;

  if (!Array.isArray(app.pages) || app.pages.length === 0) fail('app.json: pages must be a non-empty array');
  else app.pages.forEach(checkPage);

  var tabs = app.tabBar && app.tabBar.list;
  if (!Array.isArray(tabs) || tabs.length !== 4) fail('app.json: expected four TabBar entries');
  else tabs.forEach(function(tab) {
    ['iconPath', 'selectedIconPath'].forEach(function(key) {
      if (!tab[key] || !exists(tab[key])) fail('app.json: missing TabBar asset ' + String(tab[key] || key));
      else counts.assets++;
    });
  });

  if (!app.sitemapLocation || !exists(app.sitemapLocation)) fail('app.json: referenced sitemapLocation is missing');

  var project = readJSON(path.join(root, 'project.config.json'));
  if (project && project.cloudfunctionRoot !== 'cloudfunctions/') {
    fail('project.config.json: cloudfunctionRoot must be "cloudfunctions/"');
  }
}

function checkCloudFunctions() {
  ['getWeather', 'syncData'].forEach(function(name) {
    var base = path.join(root, 'cloudfunctions', name);
    if (!fs.existsSync(path.join(base, 'index.js'))) fail('cloudfunctions/' + name + '/index.js is missing');
    var pkg = readJSON(path.join(base, 'package.json'));
    if (pkg && pkg.main !== 'index.js') fail('cloudfunctions/' + name + '/package.json: main must be index.js');
  });

  var examplePath = path.join(root, 'cloudfunctions', 'getWeather', 'config.example.json');
  var example = readJSON(examplePath);
  if (!example || !example.amapKey) fail('getWeather config.example.json must declare amapKey');

  var privatePath = path.join(root, 'cloudfunctions', 'getWeather', 'config.json');
  if (!fs.existsSync(privatePath)) {
    warn('cloudfunctions/getWeather/config.json is absent; copy config.example.json before deployment');
  } else {
    var privateConfig = readJSON(privatePath);
    if (!privateConfig || !privateConfig.amapKey || /YOUR_|PLACEHOLDER/i.test(privateConfig.amapKey)) {
      fail('cloudfunctions/getWeather/config.json must contain a real amapKey');
    }
  }
}

var MAIN_PACKAGE_LIMIT = 2 * 1024 * 1024;
var MAIN_PACKAGE_WARN = 1.8 * 1024 * 1024;

function isIgnored(relative, name, rules) {
  return rules.some(function(rule) {
    if (rule.type === 'file') return relative === rule.value;
    if (rule.type === 'folder') return relative === rule.value || relative.indexOf(rule.value + '/') === 0;
    if (rule.type === 'suffix') return name.slice(-rule.value.length) === rule.value;
    if (rule.type === 'prefix') return name.slice(0, rule.value.length) === rule.value;
    return false;
  });
}

function checkPackSize() {
  var project = readJSON(path.join(root, 'project.config.json'));
  var rules = (project && project.packOptions && Array.isArray(project.packOptions.ignore))
    ? project.packOptions.ignore.filter(function(rule) { return rule && rule.type && rule.value; })
    : [];

  var excluded = ['.git', 'node_modules', 'miniprogram_npm', 'cloudfunctions'];
  var total = 0;
  var largest = [];

  function walkPack(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function(entry) {
      var full = path.join(dir, entry.name);
      var relative = rel(full);
      if (entry.isDirectory()) {
        if (excluded.indexOf(entry.name) >= 0) return;
        if (isIgnored(relative, entry.name, rules)) return;
        walkPack(full);
        return;
      }
      if (isIgnored(relative, entry.name, rules)) return;
      var size = fs.statSync(full).size;
      total += size;
      largest.push({ size: size, path: relative });
    });
  }
  walkPack(root);

  largest.sort(function(a, b) { return b.size - a.size; });
  var mb = function(bytes) { return (bytes / 1024 / 1024).toFixed(2) + ' MB'; };

  if (total > MAIN_PACKAGE_LIMIT) {
    fail('Packed size ' + mb(total) + ' exceeds the 2 MB main package limit by ' + mb(total - MAIN_PACKAGE_LIMIT) +
      '. Add rules to project.config.json packOptions.ignore.');
    largest.slice(0, 5).forEach(function(item) {
      console.error('    ' + (item.size / 1024).toFixed(0) + ' KB  ' + item.path);
    });
  } else if (total > MAIN_PACKAGE_WARN) {
    warn('Packed size ' + mb(total) + ' is close to the 2 MB main package limit (' +
      mb(MAIN_PACKAGE_LIMIT - total) + ' remaining).');
  } else {
    console.log('Packed size ' + mb(total) + ' / 2 MB limit (' + mb(MAIN_PACKAGE_LIMIT - total) + ' remaining).');
  }
}

function main() {
  var required = ['README.md', 'SPEC.md', 'package.json', 'sitemap.json', '.gitignore'];
  required.forEach(function(file) { if (!exists(file)) fail(file + ': required project file is missing'); });

  var sceneAssets = [
    'images/base-dawn.svg', 'images/base-day.svg', 'images/base-dusk.svg', 'images/base-night.svg',
    'images/overlay-sun.svg', 'images/overlay-moon.svg', 'images/overlay-clouds-a.svg',
    'images/overlay-clouds-b.svg', 'images/overlay-overcast.svg', 'images/overlay-rain.svg',
    'images/overlay-snow.svg', 'images/overlay-thunder.svg', 'images/overlay-fog.svg'
  ];
  sceneAssets.forEach(function(asset) {
    if (!exists(asset)) fail(asset + ': required dynamic-scene asset is missing');
    else counts.assets++;
  });

  var files = walk(root, []);
  checkJavaScript(files);
  files.filter(function(file) { return path.extname(file) === '.json'; }).forEach(function(file) {
    // app/project/cloud package files are parsed again deliberately only when not already covered.
    var relative = rel(file);
    if (relative !== 'app.json' && relative !== 'project.config.json' &&
        relative !== 'cloudfunctions/getWeather/package.json' &&
        relative !== 'cloudfunctions/syncData/package.json' &&
        relative !== 'cloudfunctions/getWeather/config.example.json' &&
        relative !== 'cloudfunctions/getWeather/config.json') readJSON(file);
  });
  checkProjectConfig();
  checkCloudFunctions();
  checkPackSize();

  warnings.forEach(function(message) { console.warn('WARN: ' + message); });
  if (errors.length) {
    errors.forEach(function(message) { console.error('ERROR: ' + message); });
    console.error('\nProject check failed with ' + errors.length + ' error(s).');
    return false;
  }

  console.log('Project check passed: ' + counts.js + ' JS, ' + counts.json + ' JSON, ' + counts.pages + ' pages, ' + counts.handlers + ' handlers, ' + counts.assets + ' assets.');
  return true;
}

module.exports = main;

if (require.main === module && !main()) process.exitCode = 1;
