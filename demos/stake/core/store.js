// ============================================================
//  Storage layer
//  - KV: thin, namespaced wrapper over localStorage for small,
//        synchronous state (wallet, seeds, settings, strategies).
//  - BetStore: IndexedDB object store for the durable bet history
//        that analytics is rebuilt from. This is the app's
//        "database" — no backend needed (static GitHub Pages host).
// ============================================================

const NS = 'stake:';

export const KV = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (err) {
      console.warn('[KV] read failed', key, err);
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
    } catch (err) {
      console.warn('[KV] write failed', key, err);
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(NS + key);
    } catch (_) {}
  },
};

// ---------- IndexedDB bet history ----------

const DB_NAME = 'stake-db';
const DB_VERSION = 1;
const BETS = 'bets';
const LEDGER = 'ledger';

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BETS)) {
        const s = db.createObjectStore(BETS, { keyPath: 'id', autoIncrement: true });
        s.createIndex('ts', 'ts');
        s.createIndex('game', 'game');
      }
      if (!db.objectStoreNames.contains(LEDGER)) {
        const l = db.createObjectStore(LEDGER, { keyPath: 'id', autoIncrement: true });
        l.createIndex('ts', 'ts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// In-memory fallback if IndexedDB is blocked (private mode, etc.),
// so the simulator still runs — history just isn't persisted.
class MemoryStore {
  constructor() {
    this.bets = [];
    this.ledger = [];
    this._id = 1;
    this.degraded = true;
  }
  async addBet(bet) {
    const rec = { ...bet, id: this._id++ };
    this.bets.push(rec);
    return rec.id;
  }
  async addLedger(entry) {
    const rec = { ...entry, id: this._id++ };
    this.ledger.push(rec);
    return rec.id;
  }
  async allBets() {
    return [...this.bets];
  }
  async allLedger() {
    return [...this.ledger];
  }
  async clearAll() {
    this.bets = [];
    this.ledger = [];
  }
}

class IDBStore {
  constructor(db) {
    this.db = db;
    this.degraded = false;
  }
  _tx(store, mode) {
    return this.db.transaction(store, mode).objectStore(store);
  }
  addBet(bet) {
    return new Promise((resolve, reject) => {
      const req = this._tx(BETS, 'readwrite').add(bet);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  addLedger(entry) {
    return new Promise((resolve, reject) => {
      const req = this._tx(LEDGER, 'readwrite').add(entry);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  allBets() {
    return new Promise((resolve, reject) => {
      const req = this._tx(BETS, 'readonly').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  allLedger() {
    return new Promise((resolve, reject) => {
      const req = this._tx(LEDGER, 'readonly').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  clearAll() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([BETS, LEDGER], 'readwrite');
      tx.objectStore(BETS).clear();
      tx.objectStore(LEDGER).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Resolve a single store instance the rest of the app awaits once.
let _storePromise = null;
export function betStore() {
  if (!_storePromise) {
    _storePromise = openDB()
      .then((db) => new IDBStore(db))
      .catch((err) => {
        console.warn('[store] falling back to in-memory history:', err.message);
        return new MemoryStore();
      });
  }
  return _storePromise;
}
