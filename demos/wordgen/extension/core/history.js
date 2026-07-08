// core/history.js — storage-agnostic transform history shared by the web app and the extension.

export const HISTORY_KEY = 'wordgen.history.v2';

const MAX_ENTRIES = 100;

/**
 * Create a history store on top of any async key-value adapter.
 * `storage` must provide `get(key) -> Promise<any>` and `set(key, value) -> Promise<void>`.
 * Entries: { id, ts, mode, instruction, input, outputs: [{text, note}], source: 'web'|'extension', url? }
 */
export function createHistory(storage) {
  if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
    throw new Error('createHistory needs a storage adapter with async get(key) and set(key, value).');
  }

  // Serialize read-modify-write cycles so concurrent add/remove calls cannot clobber each other.
  const enqueue = makeQueue();

  async function readAll() {
    const raw = await storage.get(HISTORY_KEY);
    return Array.isArray(raw) ? raw : [];
  }

  return {
    add(entry) {
      return enqueue(async () => {
        const entries = await readAll();
        const full = normalizeEntry(entry);
        entries.unshift(full);
        if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
        await storage.set(HISTORY_KEY, entries);
        return full;
      });
    },

    list(limit = 100) {
      return enqueue(async () => (await readAll()).slice(0, Math.max(0, limit)));
    },

    clear() {
      return enqueue(() => storage.set(HISTORY_KEY, []));
    },

    remove(id) {
      return enqueue(async () => {
        const entries = await readAll();
        const next = entries.filter((e) => e && e.id !== id);
        if (next.length !== entries.length) {
          await storage.set(HISTORY_KEY, next);
          return true;
        }
        return false;
      });
    },

    search(q) {
      return enqueue(async () => {
        const query = String(q || '').trim().toLowerCase();
        const entries = await readAll();
        if (!query) return entries;
        return entries.filter((e) => entryMatches(e, query));
      });
    },
  };
}

/** localStorage-backed adapter for the web app. */
export const webStorage = {
  async get(key) {
    if (typeof localStorage === 'undefined') return undefined;
    const raw = localStorage.getItem(key);
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  },
  async set(key, value) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  },
};

function normalizeEntry(entry = {}) {
  const full = {
    id: entry.id || makeId(),
    ts: typeof entry.ts === 'number' ? entry.ts : Date.now(),
    mode: entry.mode || '',
    instruction: entry.instruction || '',
    input: entry.input || '',
    outputs: Array.isArray(entry.outputs)
      ? entry.outputs
          .filter((o) => o && typeof o.text === 'string')
          .map((o) => ({ text: o.text, note: typeof o.note === 'string' ? o.note : '' }))
      : [],
    source: entry.source === 'extension' ? 'extension' : 'web',
  };
  if (entry.url) full.url = String(entry.url);
  return full;
}

function entryMatches(entry, query) {
  if (!entry) return false;
  if (String(entry.input || '').toLowerCase().includes(query)) return true;
  if (String(entry.mode || '').toLowerCase().includes(query)) return true;
  if (String(entry.instruction || '').toLowerCase().includes(query)) return true;
  return (entry.outputs || []).some(
    (o) =>
      String((o && o.text) || '').toLowerCase().includes(query) ||
      String((o && o.note) || '').toLowerCase().includes(query),
  );
}

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `wg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeQueue() {
  let tail = Promise.resolve();
  const noop = () => {};
  return (task) => {
    const run = tail.then(task, task);
    tail = run.then(noop, noop);
    return run;
  };
}
