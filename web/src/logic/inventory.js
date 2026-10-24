function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function invalid(errors) {
  return { ok: false, error: errors.join('; ') };
}

const INVENTORY_FIELDS = {
  id: { type: 'string', required: true },
  teaId: { type: 'integer', min: 0, required: true },
  packageType: { type: 'enum', values: ['sample', 'retail', 'split', 'gift', 'custom', 'unknown'], required: true },
  packageLabel: { type: 'string' },
  sku: { type: 'string' },
  purchaseUrl: { type: 'string' },
  status: { type: 'enum', values: ['sealed', 'opened', 'finished', 'unknown'], required: true },
  quantity: { type: 'integer', min: 1, required: true },
  netWeightPerUnit: { type: 'number', min: 0 },
  remainingWeight: { type: 'number', min: 0 },
  remainingSessions: { type: 'integer', min: 0 },
  openedAt: { type: 'number', min: 0 },
  note: { type: 'string' },
  updatedAt: { type: 'number', min: 1, required: true },
  deletedAt: { type: 'number', min: 1 },
};

export function validateInventoryItem(item) {
  const errors = [];
  const path = 'inventory';
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, errors: [`${path}: must be an object`] };
  Object.keys(INVENTORY_FIELDS).forEach((key) => {
    const definition = INVENTORY_FIELDS[key];
    const value = item[key];
    if (value === undefined) {
      if (definition.required) errors.push(`${path}.${key}: is required`);
      return;
    }
    if (definition.type === 'string') {
      if (typeof value !== 'string' || !value.trim()) errors.push(`${path}.${key}: must be a non-empty string`);
      return;
    }
    if (definition.type === 'enum') {
      if (!definition.values.includes(value)) errors.push(`${path}.${key}: must be one of ${definition.values.join(', ')}`);
      return;
    }
    if (definition.type === 'integer' && !Number.isInteger(value)) errors.push(`${path}.${key}: must be an integer`);
    else if (definition.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) errors.push(`${path}.${key}: must be a finite number`);
    if ((definition.type === 'integer' || definition.type === 'number') && typeof value === 'number' && Number.isFinite(value)) {
      if (definition.min !== undefined && value < definition.min) errors.push(`${path}.${key}: must be >= ${definition.min}`);
      if (definition.max !== undefined && value > definition.max) errors.push(`${path}.${key}: must be <= ${definition.max}`);
    }
  });
  Object.keys(item).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(INVENTORY_FIELDS, key)) errors.push(`${path}.${key}: is not declared in the contract`);
  });
  if (item.purchaseUrl !== undefined && !/^https?:\/\//.test(item.purchaseUrl)) errors.push(`${path}.purchaseUrl: must be an http or https URL`);
  if ((item.status === 'opened' || item.status === 'finished') && item.quantity !== 1) errors.push(`${path}.quantity: opened or finished inventory must represent one physical package`);
  if (item.status === 'sealed' && item.openedAt !== undefined) errors.push(`${path}.openedAt: sealed inventory cannot have openedAt`);
  if (Number.isFinite(item.remainingWeight) && Number.isFinite(item.netWeightPerUnit) && item.remainingWeight > item.netWeightPerUnit) errors.push(`${path}.remainingWeight: cannot exceed netWeightPerUnit`);
  if (item.status === 'finished' && Number.isFinite(item.remainingWeight) && item.remainingWeight !== 0) errors.push(`${path}.remainingWeight: finished inventory must have zero remaining weight`);
  if (item.status === 'finished' && Number.isInteger(item.remainingSessions) && item.remainingSessions !== 0) errors.push(`${path}.remainingSessions: finished inventory must have zero remaining sessions`);
  return { ok: errors.length === 0, errors };
}

function validate(item) {
  const result = validateInventoryItem(item);
  return result.ok ? null : result.errors;
}

function findLive(items, id) {
  return items.findIndex((item) => item.id === id && !item.deletedAt);
}

/** Pure equivalents of utils/data.js inventory transitions. */
export function openInventoryItem(inventory, id, options = {}) {
  const next = clone(Array.isArray(inventory) ? inventory : []);
  const index = findLive(next, id);
  if (index < 0) return { inventory: next, result: { ok: false, error: 'Inventory item not found' } };
  const sealed = next[index];
  if (sealed.status !== 'sealed') return { inventory: next, result: { ok: false, error: 'Only sealed inventory can be opened' } };

  const now = options.now ?? Date.now();
  const split = sealed.quantity > 1;
  const opened = clone(sealed);
  opened.status = 'opened';
  opened.quantity = 1;
  opened.openedAt = now;
  opened.updatedAt = now;
  delete opened.deletedAt;
  if (opened.remainingWeight === undefined && typeof opened.netWeightPerUnit === 'number') {
    opened.remainingWeight = opened.netWeightPerUnit;
  }
  if (split) {
    sealed.quantity -= 1;
    sealed.updatedAt = now;
    opened.id = options.createId ? options.createId(now) : `inv_${now}_${Math.random().toString(36).slice(2, 8)}`;
    next.push(opened);
  } else {
    opened.id = sealed.id;
    next[index] = opened;
  }

  const errors = [...(validate(opened) || []), ...(split ? validate(sealed) || [] : [])];
  if (errors.length) return { inventory: clone(inventory || []), result: invalid(errors) };
  return { inventory: next, result: { ok: true, item: clone(opened), split } };
}

export function consumeInventorySession(inventory, id, options = {}) {
  const next = clone(Array.isArray(inventory) ? inventory : []);
  const index = findLive(next, id);
  if (index < 0) return { inventory: next, result: { ok: false, error: 'Inventory item not found' } };
  const item = next[index];
  if (item.status !== 'opened') return { inventory: next, result: { ok: false, error: 'Only opened inventory can be consumed' } };
  if (!Number.isInteger(item.remainingSessions) || item.remainingSessions <= 0) {
    return { inventory: next, result: { ok: false, error: 'Remaining sessions are not available' } };
  }
  item.remainingSessions -= 1;
  item.updatedAt = options.now ?? Date.now();
  if (item.remainingSessions === 0) {
    item.status = 'finished';
    if (typeof item.remainingWeight === 'number') item.remainingWeight = 0;
  }
  const errors = validate(item);
  if (errors) return { inventory: clone(inventory || []), result: invalid(errors) };
  return { inventory: next, result: { ok: true, item: clone(item) } };
}

export function finishInventoryItem(inventory, id, options = {}) {
  const next = clone(Array.isArray(inventory) ? inventory : []);
  const index = findLive(next, id);
  if (index < 0) return { inventory: next, result: { ok: false, error: 'Inventory item not found' } };
  const item = next[index];
  if (item.status !== 'opened') return { inventory: next, result: { ok: false, error: 'Only opened inventory can be finished' } };
  item.status = 'finished';
  item.quantity = 1;
  item.updatedAt = options.now ?? Date.now();
  if (typeof item.remainingWeight === 'number') item.remainingWeight = 0;
  if (typeof item.remainingSessions === 'number') item.remainingSessions = 0;
  const errors = validate(item);
  if (errors) return { inventory: clone(inventory || []), result: invalid(errors) };
  return { inventory: next, result: { ok: true, item: clone(item) } };
}

export function deleteInventoryItem(inventory, id, options = {}) {
  const next = clone(Array.isArray(inventory) ? inventory : []);
  const index = next.findIndex((item) => item.id === id);
  if (index < 0) return { inventory: next, result: false };
  const deletedAt = options.now ?? Date.now();
  next[index].deletedAt = deletedAt;
  next[index].updatedAt = deletedAt;
  return { inventory: next, result: true };
}

export function listInventory(inventory, teaId) {
  return (Array.isArray(inventory) ? inventory : [])
    .filter((item) => !item.deletedAt && (teaId === undefined || item.teaId === teaId))
    .map(clone);
}
