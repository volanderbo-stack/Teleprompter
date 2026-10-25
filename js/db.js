// Мінімальна обгортка над IndexedDB: сценарії, репетиції, налаштування (kv).

const DB_NAME = 'smart-prompter';
const VERSION = 1;
let dbPromise = null;

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('scripts', { keyPath: 'id' });
      d.createObjectStore('rehearsals', { keyPath: 'id' }).createIndex('scriptId', 'scriptId');
      d.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export const db = {
  all: store => tx(store, 'readonly', s => s.getAll()),
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  put: (store, value, key) => tx(store, 'readwrite', s => s.put(value, key)),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  byIndex: (store, index, value) => tx(store, 'readonly', s => s.index(index).getAll(value)),
  delByIndex: (store, index, value) => tx(store, 'readwrite', s => {
    const req = s.index(index).openKeyCursor(IDBKeyRange.only(value));
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) { s.delete(cur.primaryKey); cur.continue(); }
    };
  }),
};

export const uid = () =>
  crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
