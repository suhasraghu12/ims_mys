// Tiny IndexedDB wrapper. All app data lives on the phone.
const DB_NAME = 'shop-khata';
const VERSION = 1;
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('customers', { keyPath: 'id' });
        d.createObjectStore('entries', { keyPath: 'id' }).createIndex('customerId', 'customerId');
        d.createObjectStore('photos', { keyPath: 'id' });
        d.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    let result;
    const req = fn(t.objectStore(store));
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  all: store => tx(store, 'readonly', s => s.getAll()),
  keys: store => tx(store, 'readonly', s => s.getAllKeys()),
  put: (store, value) => tx(store, 'readwrite', s => s.put(value)),
  putMany: (store, values) => tx(store, 'readwrite', s => { values.forEach(v => s.put(v)); }),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  clear: store => tx(store, 'readwrite', s => s.clear()),
};
