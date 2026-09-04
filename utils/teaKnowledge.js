'use strict';

/**
 * Tea knowledge catalog validation helpers.
 * This module validates model-produced JSON before any runtime import exists.
 */

var contract = require('../data/teaKnowledgeContract');

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && isFinite(value);
}

function push(errors, path, message) {
  errors.push(path + ': ' + message);
}

function validatePrimitive(value, definition, path, errors) {
  var type = definition.type;
  if (type === 'string') {
    if (typeof value !== 'string' || !value.trim()) push(errors, path, 'must be a non-empty string');
    return;
  }
  if (type === 'integer') {
    if (!Number.isInteger(value)) push(errors, path, 'must be an integer');
  } else if (type === 'number') {
    if (!isFiniteNumber(value)) push(errors, path, 'must be a finite number');
  } else if (type === 'scale_0_5') {
    if (!isFiniteNumber(value) || value < 0 || value > 5) push(errors, path, 'must be between 0 and 5');
  } else if (type === 'string_array') {
    if (!Array.isArray(value) || value.some(function(item) { return typeof item !== 'string' || !item.trim(); })) {
      push(errors, path, 'must be an array of non-empty strings');
    }
    return;
  } else if (type === 'enum') {
    if (definition.values.indexOf(value) < 0) push(errors, path, 'must be one of ' + definition.values.join(', '));
    return;
  } else if (type === 'number_range') {
    if (!isObject(value) || !isFiniteNumber(value.min) || !isFiniteNumber(value.max)) {
      push(errors, path, 'must be { min, max } numbers');
      return;
    }
    if (value.min > value.max) push(errors, path, 'min must not exceed max');
    if (typeof definition.min === 'number' && value.min < definition.min) push(errors, path, 'min is below ' + definition.min);
    if (typeof definition.max === 'number' && value.max > definition.max) push(errors, path, 'max exceeds ' + definition.max);
    return;
  }

  if ((type === 'integer' || type === 'number') && isFiniteNumber(value)) {
    if (typeof definition.min === 'number' && value < definition.min) push(errors, path, 'must be >= ' + definition.min);
    if (typeof definition.max === 'number' && value > definition.max) push(errors, path, 'must be <= ' + definition.max);
  }
}

function validateKnowledgeField(field, definition, path, errors) {
  if (!isObject(field)) {
    push(errors, path, 'must be a knowledge field object');
    return;
  }

  if (contract.knowledgeStatuses.indexOf(field.status) < 0) push(errors, path + '.status', 'unknown knowledge status');
  if (contract.sourceTypes.indexOf(field.sourceType) < 0) push(errors, path + '.sourceType', 'unknown source type');
  if (!isFiniteNumber(field.confidence) || field.confidence < 0 || field.confidence > 1) {
    push(errors, path + '.confidence', 'must be between 0 and 1');
  }
  if (!isFiniteNumber(field.updatedAt) || field.updatedAt <= 0) push(errors, path + '.updatedAt', 'must be a positive timestamp');
  if (field.sourceRefs !== undefined && (!Array.isArray(field.sourceRefs) || field.sourceRefs.some(function(ref) { return typeof ref !== 'string' || !ref.trim(); }))) {
    push(errors, path + '.sourceRefs', 'must be an array of non-empty strings');
  }
  if (field.evidence !== undefined && typeof field.evidence !== 'string') push(errors, path + '.evidence', 'must be a string');
  var allowedKeys = ['value', 'status', 'sourceType', 'confidence', 'updatedAt', 'sourceRefs', 'evidence'];
  Object.keys(field).forEach(function(key) {
    if (allowedKeys.indexOf(key) < 0) push(errors, path + '.' + key, 'is not allowed');
  });

  if (field.value === null) {
    if (definition.requiredValue) push(errors, path + '.value', 'is required');
    if (field.status !== 'unknown' && field.status !== 'conflicted') {
      push(errors, path + '.status', 'null value requires unknown or conflicted status');
    }
    if (field.status === 'unknown' && field.sourceType !== 'unknown') {
      push(errors, path + '.sourceType', 'unknown field must use unknown source');
    }
    if (field.status === 'unknown' && field.confidence !== 0) {
      push(errors, path + '.confidence', 'unknown field must use zero confidence');
    }
    return;
  }

  if (field.status === 'unknown') push(errors, path + '.status', 'unknown status requires null value');
  if (field.status === 'confirmed' && ['user', 'package', 'purchase'].indexOf(field.sourceType) < 0) {
    push(errors, path + '.sourceType', 'confirmed field must use user, package, or purchase source');
  }
  if (field.status === 'personal' && field.sourceType !== 'user') push(errors, path + '.sourceType', 'personal field must use user source');
  if (field.status === 'inferred' && field.sourceType !== 'llm') push(errors, path + '.sourceType', 'inferred field must use llm source');
  if (field.status === 'inherited' && field.sourceType !== 'category_default') push(errors, path + '.sourceType', 'inherited field must use category_default source');
  if (field.status === 'researched') {
    if (['package', 'purchase', 'official', 'retailer', 'community'].indexOf(field.sourceType) < 0) {
      push(errors, path + '.sourceType', 'researched field must use an evidence source');
    }
    if (!Array.isArray(field.sourceRefs) || !field.sourceRefs.length) push(errors, path + '.sourceRefs', 'researched field requires source references');
    if (typeof field.evidence !== 'string' || !field.evidence.trim()) push(errors, path + '.evidence', 'researched field requires evidence');
  }
  if ((field.status === 'inferred' || field.status === 'inherited') && (typeof field.evidence !== 'string' || !field.evidence.trim())) {
    push(errors, path + '.evidence', field.status + ' field requires evidence');
  }
  validatePrimitive(field.value, definition, path + '.value', errors);
}

function validateTeaProfile(profile, path, errors) {
  if (!isObject(profile)) {
    push(errors, path, 'must be an object');
    return;
  }
  if (!Number.isInteger(profile.teaId) || profile.teaId < 0) push(errors, path + '.teaId', 'must be a non-negative integer');
  if (!Number.isInteger(profile.profileVersion) || profile.profileVersion < 1) push(errors, path + '.profileVersion', 'must be a positive integer');
  if (contract.profileLifecycles.indexOf(profile.lifecycle) < 0) push(errors, path + '.lifecycle', 'unknown lifecycle');

  var knownFieldCount = 0;
  var totalFieldCount = 0;
  Object.keys(contract.sections).forEach(function(sectionName) {
    var section = profile[sectionName];
    var sectionPath = path + '.' + sectionName;
    if (!isObject(section)) {
      push(errors, sectionPath, 'must be an object');
      return;
    }
    var definitions = contract.sections[sectionName];
    Object.keys(definitions).forEach(function(fieldName) {
      totalFieldCount += 1;
      if (!Object.prototype.hasOwnProperty.call(section, fieldName)) {
        push(errors, sectionPath + '.' + fieldName, 'is missing');
        return;
      }
      if (section[fieldName] && section[fieldName].value !== null) knownFieldCount += 1;
      validateKnowledgeField(section[fieldName], definitions[fieldName], sectionPath + '.' + fieldName, errors);
    });
    Object.keys(section).forEach(function(fieldName) {
      if (!Object.prototype.hasOwnProperty.call(definitions, fieldName)) push(errors, sectionPath + '.' + fieldName, 'is not declared in the contract');
    });
  });

  if (!isObject(profile.research)) {
    push(errors, path + '.research', 'must be an object');
  } else {
    if (!isFiniteNumber(profile.research.completeness) || profile.research.completeness < 0 || profile.research.completeness > 1) {
      push(errors, path + '.research.completeness', 'must be between 0 and 1');
    } else {
      var expectedCompleteness = Number((knownFieldCount / totalFieldCount).toFixed(4));
      if (profile.research.completeness !== expectedCompleteness) {
        push(errors, path + '.research.completeness', 'must equal calculated value ' + expectedCompleteness);
      }
    }
    if (!Array.isArray(profile.research.conflicts) || profile.research.conflicts.some(function(item) { return typeof item !== 'string'; })) {
      push(errors, path + '.research.conflicts', 'must be an array of strings');
    }
    if (!Array.isArray(profile.research.notes) || profile.research.notes.some(function(item) { return typeof item !== 'string'; })) {
      push(errors, path + '.research.notes', 'must be an array of strings');
    }
  }
}

function validateCatalog(catalog, options) {
  var errors = [];
  var opts = options || {};
  if (!isObject(catalog)) return { ok: false, errors: ['catalog: must be an object'] };

  if (catalog.schemaVersion !== contract.schemaVersion) push(errors, 'schemaVersion', 'must equal ' + contract.schemaVersion);
  if (contract.catalogPurposes.indexOf(catalog.purpose) < 0) push(errors, 'purpose', 'unknown catalog purpose');
  if (typeof catalog.catalogVersion !== 'string' || !catalog.catalogVersion.trim()) push(errors, 'catalogVersion', 'must be a non-empty string');
  if (!isFiniteNumber(catalog.generatedAt) || catalog.generatedAt <= 0) push(errors, 'generatedAt', 'must be a positive timestamp');
  if (!Number.isInteger(catalog.expectedTeaCount) || catalog.expectedTeaCount < 1) push(errors, 'expectedTeaCount', 'must be a positive integer');
  if (!Array.isArray(catalog.withheldTeaIds)) push(errors, 'withheldTeaIds', 'must be an array');
  if (!Array.isArray(catalog.batches)) push(errors, 'batches', 'must be an array');
  if (!Array.isArray(catalog.teas)) {
    push(errors, 'teas', 'must be an array');
    return { ok: false, errors: errors };
  }

  var seen = {};
  catalog.teas.forEach(function(profile, index) {
    validateTeaProfile(profile, 'teas[' + index + ']', errors);
    if (profile && Number.isInteger(profile.teaId)) {
      if (seen[profile.teaId]) push(errors, 'teas[' + index + '].teaId', 'duplicate teaId ' + profile.teaId);
      seen[profile.teaId] = true;
    }
  });

  var withheldSeen = {};
  (catalog.withheldTeaIds || []).forEach(function(teaId, index) {
    if (!Number.isInteger(teaId) || teaId < 0) push(errors, 'withheldTeaIds[' + index + ']', 'must be a non-negative integer');
    if (withheldSeen[teaId]) push(errors, 'withheldTeaIds[' + index + ']', 'duplicate teaId ' + teaId);
    withheldSeen[teaId] = true;
  });

  (catalog.batches || []).forEach(function(batch, index) {
    var batchPath = 'batches[' + index + ']';
    if (!isObject(batch)) {
      push(errors, batchPath, 'must be an object');
      return;
    }
    if (typeof batch.batchId !== 'string' || !batch.batchId.trim()) push(errors, batchPath + '.batchId', 'must be a non-empty string');
    if (batch.model !== undefined && (typeof batch.model !== 'string' || !batch.model.trim())) push(errors, batchPath + '.model', 'must be a non-empty string');
    if (!Array.isArray(batch.teaIds)) {
      push(errors, batchPath + '.teaIds', 'must be an array');
    } else {
      var batchSeen = {};
      batch.teaIds.forEach(function(teaId, teaIndex) {
        if (!Number.isInteger(teaId) || teaId < 0) push(errors, batchPath + '.teaIds[' + teaIndex + ']', 'must be a non-negative integer');
        if (batchSeen[teaId]) push(errors, batchPath + '.teaIds[' + teaIndex + ']', 'duplicate teaId ' + teaId);
        batchSeen[teaId] = true;
      });
    }
  });

  var batchMembership = {};
  (catalog.batches || []).forEach(function(batch, batchIndex) {
    (batch && Array.isArray(batch.teaIds) ? batch.teaIds : []).forEach(function(teaId) {
      if (batchMembership[teaId] !== undefined) {
        push(errors, 'batches[' + batchIndex + '].teaIds', 'teaId ' + teaId + ' is already assigned to another batch');
      }
      batchMembership[teaId] = batchIndex;
    });
  });
  Object.keys(seen).forEach(function(key) {
    if (batchMembership[key] === undefined) push(errors, 'batches', 'does not declare profile teaId ' + key);
  });
  Object.keys(batchMembership).forEach(function(key) {
    if (!seen[key]) push(errors, 'batches', 'declares teaId ' + key + ' without a profile');
  });

  if (Array.isArray(opts.expectedTeaIds)) {
    var expected = {};
    opts.expectedTeaIds.forEach(function(teaId) { expected[teaId] = true; });
    if (catalog.expectedTeaCount !== opts.expectedTeaIds.length) {
      push(errors, 'expectedTeaCount', 'must equal current tea library count ' + opts.expectedTeaIds.length);
    }
    Object.keys(seen).forEach(function(key) {
      if (!expected[key]) push(errors, 'teas', 'contains unknown teaId ' + key);
    });
    Object.keys(withheldSeen).forEach(function(key) {
      if (!expected[key]) push(errors, 'withheldTeaIds', 'contains unknown teaId ' + key);
      if (seen[key]) push(errors, 'withheldTeaIds', 'teaId ' + key + ' cannot also have an imported profile');
    });
    if (opts.requireComplete) {
      opts.expectedTeaIds.forEach(function(teaId) {
        if (!seen[teaId] && !withheldSeen[teaId]) push(errors, 'teas', 'missing non-withheld teaId ' + teaId);
      });
    }
  }

  return { ok: errors.length === 0, errors: errors };
}

function validateKnowledgeFieldByPath(path, field) {
  var errors = [];
  var parts = typeof path === 'string' ? path.split('.') : [];
  var definition = parts.length === 2 && contract.sections[parts[0]] && contract.sections[parts[0]][parts[1]];
  if (!definition) return { ok: false, errors: ['field: unknown knowledge path ' + path] };
  validateKnowledgeField(field, definition, path, errors);
  return { ok: errors.length === 0, errors: errors, definition: definition };
}
function getTeaLibraryIdentityField(tea, fieldName, updatedAt) {
  if (!tea || typeof tea !== 'object') return null;
  var mapping = { displayName: 'name', brand: 'brand', category: 'cat', year: 'year' };
  var teaKey = mapping[fieldName];
  if (!teaKey) return null;
  var value = tea[teaKey];
  if (value === null || value === undefined || value === '') return null;
  return {
    value: value,
    status: 'confirmed',
    sourceType: 'user',
    confidence: 1,
    updatedAt: isFiniteNumber(updatedAt) && updatedAt > 0 ? updatedAt : 1,
    evidence: '来自当前茶库基础信息；不是联网查证结果'
  };
}

function validateInventoryItem(item) {
  var errors = [];
  var path = 'inventory';
  var definition = contract.inventoryRecord;
  if (!isObject(item)) return { ok: false, errors: [path + ': must be an object'] };

  Object.keys(definition.fields).forEach(function(fieldName) {
    var fieldDefinition = definition.fields[fieldName];
    if (item[fieldName] === undefined) {
      if (fieldDefinition.requiredValue) push(errors, path + '.' + fieldName, 'is required');
      return;
    }
    validatePrimitive(item[fieldName], fieldDefinition, path + '.' + fieldName, errors);
  });
  Object.keys(item).forEach(function(fieldName) {
    if (!Object.prototype.hasOwnProperty.call(definition.fields, fieldName)) push(errors, path + '.' + fieldName, 'is not declared in the contract');
  });

  if (item.purchaseUrl !== undefined && !/^https?:\/\//.test(item.purchaseUrl)) {
    push(errors, path + '.purchaseUrl', 'must be an http or https URL');
  }
  if ((item.status === 'opened' || item.status === 'finished') && item.quantity !== 1) {
    push(errors, path + '.quantity', 'opened or finished inventory must represent one physical package');
  }
  if (item.status === 'sealed' && item.openedAt !== undefined) push(errors, path + '.openedAt', 'sealed inventory cannot have openedAt');
  if (isFiniteNumber(item.remainingWeight) && isFiniteNumber(item.netWeightPerUnit) && item.remainingWeight > item.netWeightPerUnit) {
    push(errors, path + '.remainingWeight', 'cannot exceed netWeightPerUnit');
  }
  if (item.status === 'finished' && isFiniteNumber(item.remainingWeight) && item.remainingWeight !== 0) {
    push(errors, path + '.remainingWeight', 'finished inventory must have zero remaining weight');
  }
  if (item.status === 'finished' && Number.isInteger(item.remainingSessions) && item.remainingSessions !== 0) {
    push(errors, path + '.remainingSessions', 'finished inventory must have zero remaining sessions');
  }

  return { ok: errors.length === 0, errors: errors };
}

module.exports = {
  contract: contract,
  validateCatalog: validateCatalog,
  validateKnowledgeField: validateKnowledgeFieldByPath,
  getTeaLibraryIdentityField: getTeaLibraryIdentityField,
  validateInventoryItem: validateInventoryItem,
  validateTeaProfile: function(profile) {
    var errors = [];
    validateTeaProfile(profile, 'profile', errors);
    return { ok: errors.length === 0, errors: errors };
  }
};
