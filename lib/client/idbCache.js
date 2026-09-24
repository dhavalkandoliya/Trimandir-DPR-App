// Tiny IndexedDB key/value cache — the storage half of the old index.html
// DataStore. Lets the app repaint instantly from the last session's data
// (full DPR history + consumption entries don't fit localStorage's quota).
// Every call degrades silently to "no cache": a failed read/write must
// never break the app.

const DB_NAME = 'dpr_cache_db'; // same name as before, so existing caches keep working
const STORE = 'kv';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => {
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const t = db.transaction(STORE, mode);
        const result = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
        t.onerror = () => resolve(undefined);
        t.onabort = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

export const cacheGet = (key) => tx('readonly', (s) => s.get(key));
export const cacheSet = (key, value) => tx('readwrite', (s) => { s.put(value, key); });
// On sign-out: this device may be a shared site-office machine.
export const cacheClear = () => tx('readwrite', (s) => { s.clear(); });
