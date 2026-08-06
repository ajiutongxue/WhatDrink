'use strict';

var fs = require('fs');
var path = require('path');
var observations = require('../data/teaPackageObservations');

var confirmedProductNames = {
  31: '山语系列·铁罗汉（中火）',
  33: '喜上眉梢·水晶龟（足火）',
  38: '乐享肉桂（中火）'
};

function describe(observation) {
  var parts = ['用户确认实际商品或包装'];
  if (observation.sku) parts.push('SKU ' + observation.sku);
  if (observation.packageType === 'sample') parts.push('品鉴装');
  if (observation.packageType === 'retail') parts.push('正装');
  if (observation.status === 'opened') parts.push('已拆');
  if (observation.status === 'sealed') parts.push('未拆');
  if (observation.quantity) parts.push(observation.quantity + '盒');
  if (observation.quantityNote) parts.push(observation.quantityNote);
  if (observation.netWeightPerUnit) parts.push(observation.netWeightPerUnit + 'g');
  if (observation.note) parts.push(observation.note);
  return parts.join('；') + '。包装事实留在库存层。';
}

function completeness(profile) {
  var filled = 0;
  var total = 0;
  ['identity', 'origin', 'craft', 'sensory', 'effects', 'context', 'brew'].forEach(function(section) {
    Object.keys(profile[section]).forEach(function(fieldName) {
      total += 1;
      if (profile[section][fieldName].value !== null) filled += 1;
    });
  });
  return Number((filled / total).toFixed(4));
}

function apply(catalog) {
  observations.forEach(function(observation) {
    var profile = (catalog.teas || []).find(function(tea) { return tea.teaId === observation.teaId; });
    if (!profile) return;
    if (confirmedProductNames[observation.teaId]) observation.productNameOverride = confirmedProductNames[observation.teaId];
    var identity = profile.identity.displayName;
    if (observation.productNameOverride) identity.value = observation.productNameOverride;
    identity.status = 'confirmed';
    identity.sourceType = 'user';
    identity.confidence = 1;
    identity.updatedAt = Date.now();
    identity.evidence = observation.productNameOverride
      ? '用户根据实际购买记录确认商品名称为' + observation.productNameOverride + '。'
      : '用户提供实际商品或购买记录，确认该链接对应当前茶款。';
    [
      ['productCode', observation.productCode],
      ['packagingVariant', observation.packagingVariant],
      ['year', observation.year],
      ['roastLevel', observation.roastLevel]
    ].forEach(function(entry) {
      var fieldName = entry[0];
      var value = entry[1];
      if (value === undefined || value === null) return;
      var target = fieldName === 'roastLevel' ? profile.craft[fieldName] : profile.identity[fieldName];
      target.value = value;
      target.status = 'confirmed';
      target.sourceType = 'user';
      target.confidence = 1;
      target.updatedAt = Date.now();
      target.evidence = '用户在第二批补充文档中确认该字段。';
      delete target.sourceRefs;
    });
    if (observation.replacesUrls && identity.sourceRefs) {
      identity.sourceRefs = identity.sourceRefs.filter(function(url) {
        return observation.replacesUrls.indexOf(url) < 0;
      });
    }
    if (observation.replacesSkus) {
      profile.research.notes = profile.research.notes.filter(function(existingNote) {
        return !observation.replacesSkus.some(function(sku) {
          return existingNote.indexOf('SKU ' + sku) >= 0;
        });
      });
    }
    if (observation.note) {
      profile.research.notes = profile.research.notes.filter(function(existingNote) {
        return existingNote.indexOf(observation.note) < 0;
      });
    }
    if (observation.url) {
      identity.sourceRefs = identity.sourceRefs || [];
      if (identity.sourceRefs.indexOf(observation.url) < 0) identity.sourceRefs.push(observation.url);
    }
    var note = describe(observation);
    if (profile.research.notes.indexOf(note) < 0) profile.research.notes.push(note);
    profile.research.completeness = completeness(profile);
  });
  return catalog;
}

function main() {
  var fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node scripts/apply-tea-package-observations.js <catalog.json>');
    process.exitCode = 2;
    return;
  }
  try {
    var target = path.resolve(process.cwd(), fileArg);
    var catalog = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
    apply(catalog);
    fs.writeFileSync(target, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
    console.log('Applied user package observations to ' + target + '.');
  } catch (err) {
    console.error('Apply failed: ' + err.message);
    process.exitCode = 1;
  }
}

module.exports = apply;

if (require.main === module) main();
