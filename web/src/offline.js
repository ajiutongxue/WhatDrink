const DATABASE_NAME = 'tea-pwa-offline';
const DATABASE_VERSION = 1;
const SNAPSHOT_KEY = 'latest';

let databasePromise;

function openDatabase() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('此浏览器不支持本地离线存储。'));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('snapshots')) database.createObjectStore('snapshots', { keyPath: 'key' });
        if (!database.objectStoreNames.contains('outbox')) {
          const outbox = database.createObjectStore('outbox', { keyPath: 'sequence', autoIncrement: true });
          outbox.createIndex('mutationId', 'mutationId', { unique: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本地离线存储。'));
      request.onblocked = () => reject(new Error('本地离线存储正在升级，请关闭其他应用页面后重试。'));
    }).catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本地离线存储操作失败。'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('本地离线存储事务已取消。'));
    transaction.onerror = () => reject(transaction.error || new Error('本地离线存储事务失败。'));
  });
}

export async function loadOfflineData() {
  const database = await openDatabase();
  const transaction = database.transaction(['snapshots', 'outbox'], 'readonly');
  const done = transactionDone(transaction);
  const snapshotRequest = transaction.objectStore('snapshots').get(SNAPSHOT_KEY);
  const outboxRequest = transaction.objectStore('outbox').getAll();
  const [snapshot, outbox] = await Promise.all([requestResult(snapshotRequest), requestResult(outboxRequest)]);
  await done;
  return { snapshot: snapshot || null, outbox: outbox.sort((a, b) => a.sequence - b.sequence) };
}

export async function saveRemoteSnapshot(snapshot) {
  const database = await openDatabase();
  const transaction = database.transaction('snapshots', 'readwrite');
  transaction.objectStore('snapshots').put({ ...snapshot, key: SNAPSHOT_KEY });
  await transactionDone(transaction);
}

export async function enqueueMutation(mutation) {
  const database = await openDatabase();
  const transaction = database.transaction('outbox', 'readwrite');
  const done = transactionDone(transaction);
  const request = transaction.objectStore('outbox').add({
    mutationId: mutation.mutationId,
    mutation,
    createdAt: Date.now(),
    failure: '',
  });
  const [sequence] = await Promise.all([requestResult(request), done]);
  return sequence;
}

export async function acknowledgeMutation(sequence, snapshot) {
  const database = await openDatabase();
  const transaction = database.transaction(['snapshots', 'outbox'], 'readwrite');
  transaction.objectStore('snapshots').put({ ...snapshot, key: SNAPSHOT_KEY });
  transaction.objectStore('outbox').delete(sequence);
  await transactionDone(transaction);
}

export async function markMutationFailed(sequence, failure) {
  const database = await openDatabase();
  const transaction = database.transaction('outbox', 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore('outbox');
  const request = store.get(sequence);
  request.onsuccess = () => {
    if (request.result) store.put({ ...request.result, failure });
  };
  await done;
}

export async function clearMutationFailure(sequence) {
  const database = await openDatabase();
  const transaction = database.transaction('outbox', 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore('outbox');
  const request = store.get(sequence);
  request.onsuccess = () => {
    if (request.result) store.put({ ...request.result, failure: '' });
  };
  await done;
}

export async function clearRemoteSnapshot() {
  const database = await openDatabase();
  const transaction = database.transaction('snapshots', 'readwrite');
  transaction.objectStore('snapshots').delete(SNAPSHOT_KEY);
  await transactionDone(transaction);
}

export function applyQueuedMutations(source, entries) {
  const state = JSON.parse(JSON.stringify(source));
  for (const entry of entries) {
    const mutation = entry.mutation || entry;
    if (mutation.type === 'upsert_history' && mutation.value && typeof mutation.value === 'object') {
      const existing = state.history.find((item) => item.id === mutation.entityId);
      const value = { ...mutation.value };
      if (!('imageFileIDs' in value) && existing && 'imageFileIDs' in existing) value.imageFileIDs = existing.imageFileIDs;
      state.history = state.history.filter((item) => item.id !== mutation.entityId);
      state.history.push(value);
    } else if (mutation.type === 'set_avoid' && mutation.value && typeof mutation.value === 'object') {
      state.temporaryAvoids[mutation.entityId] = mutation.value;
    }
  }
  return state;
}
