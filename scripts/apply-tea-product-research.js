'use strict';

var fs = require('fs');
var path = require('path');
var observations = require('../data/teaProductResearchObservations');

var UPDATED_AT = Date.parse('2026-08-04T00:00:00+08:00');

function getField(profile, fieldPath) {
  return fieldPath.split('.').reduce(function(value, key) {
    return value && value[key];
  }, profile);
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

    (observation.fields || []).forEach(function(fact) {
      var field = getField(profile, fact.path);
      if (!field) throw new Error('Unknown profile field ' + fact.path + ' for teaId ' + observation.teaId);
      field.value = fact.value;
      field.status = 'researched';
      field.sourceType = fact.sourceType || observation.sourceType || 'retailer';
      field.confidence = fact.confidence;
      field.updatedAt = UPDATED_AT;
      field.evidence = fact.evidence;
      field.sourceRefs = [observation.sourceUrl];
    });

    (observation.clearFields || []).forEach(function(fieldPath) {
      var field = getField(profile, fieldPath);
      if (!field) throw new Error('Unknown profile field ' + fieldPath + ' for teaId ' + observation.teaId);
      field.value = null;
      field.status = 'unknown';
      field.sourceType = 'unknown';
      field.confidence = 0;
      field.updatedAt = UPDATED_AT;
      delete field.evidence;
      delete field.sourceRefs;
    });

    (observation.removeConflicts || []).forEach(function(conflict) {
      profile.research.conflicts = profile.research.conflicts.filter(function(existing) {
        return existing !== conflict;
      });
    });
    (observation.removeNotes || []).forEach(function(note) {
      profile.research.notes = profile.research.notes.filter(function(existing) {
        return existing !== note;
      });
    });
    (observation.conflicts || []).forEach(function(conflict) {
      if (profile.research.conflicts.indexOf(conflict) < 0) profile.research.conflicts.push(conflict);
    });
    profile.research.completeness = completeness(profile);
  });
  return catalog;
}

function main() {
  var fileArg = process.argv[2];
  if (!fileArg) {
    console.error('Usage: node scripts/apply-tea-product-research.js <catalog.json>');
    process.exitCode = 2;
    return;
  }
  try {
    var target = path.resolve(process.cwd(), fileArg);
    var catalog = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
    apply(catalog);
    fs.writeFileSync(target, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
    console.log('Applied product research observations to ' + target + '.');
  } catch (err) {
    console.error('Apply failed: ' + err.message);
    process.exitCode = 1;
  }
}

module.exports = apply;

if (require.main === module) main();
