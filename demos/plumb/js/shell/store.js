// Plumb — local-first storage. Projects, the original drawing files, cached analyses and the
// office's settings all live in this browser's IndexedDB; nothing is uploaded anywhere.

const DB_NAME = 'plumb';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) { reject(new Error('This browser can’t store projects (IndexedDB is off).')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Close other Plumb tabs and reload.'));
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage write was cancelled (disk full?)'));
  });
}
const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ------------------------------------------------------------------ projects
export async function listProjects() {
  const all = await tx('projects', 'readonly', (s) => req(s.getAll()));
  return all.sort((a, b) => (b.openedAt || b.updatedAt || 0) - (a.openedAt || a.updatedAt || 0));
}
export const getProject = (id) => tx('projects', 'readonly', (s) => req(s.get(id)));
export async function saveProject(p) {
  p.updatedAt = Date.now();
  await tx('projects', 'readwrite', (s) => req(s.put(p)));
  return p;
}
export async function deleteProject(id) {
  const p = await getProject(id);
  if (!p) return;
  const fileIds = p.revisions.flatMap((r) => r.files.map((f) => f.id));
  await tx('files', 'readwrite', (s) => Promise.all(fileIds.map((f) => req(s.delete(f)))));
  await tx('cache', 'readwrite', async (s) => {
    const keys = await req(s.getAllKeys());
    await Promise.all(keys.filter((k) => String(k).startsWith(id + ':')).map((k) => req(s.delete(k))));
  });
  await tx('projects', 'readwrite', (s) => req(s.delete(id)));
}

// ------------------------------------------------------------------ original drawing files
/** Keep the bytes of an uploaded drawing. */
export async function putFile({ name, bytes, kind }) {
  const id = uid('f');
  await tx('files', 'readwrite', (s) => req(s.put({ id, name, kind, size: bytes.byteLength, bytes: new Blob([bytes]), savedAt: Date.now() })));
  return { id, name, kind, size: bytes.byteLength };
}
export async function getFileBytes(id) {
  const rec = await tx('files', 'readonly', (s) => req(s.get(id)));
  if (!rec) throw new Error('A drawing file is missing from this device’s storage.');
  return new Uint8Array(await rec.bytes.arrayBuffer());
}

// ------------------------------------------------------------------ cached results (analysis, 3D parts, thumbnails)
export const getCache = (key) => tx('cache', 'readonly', (s) => req(s.get(key))).then((r) => (r ? r.value : null));
export const putCache = (key, value) => tx('cache', 'readwrite', (s) => req(s.put({ key, value, at: Date.now() })));
export async function dropCache(prefix) {
  await tx('cache', 'readwrite', async (s) => {
    const keys = await req(s.getAllKeys());
    await Promise.all(keys.filter((k) => String(k).startsWith(prefix)).map((k) => req(s.delete(k))));
  });
}

// ------------------------------------------------------------------ settings and small state
export const getKV = (key, dflt = null) => tx('kv', 'readonly', (s) => req(s.get(key))).then((r) => (r ? r.value : dflt));
export const putKV = (key, value) => tx('kv', 'readwrite', (s) => req(s.put({ key, value })));

export const DEFAULT_SETTINGS = {
  region: 'IN-AMD',                 // India · Ahmedabad (Gujarat CGDCR 2017)
  lengthUnit: 'mm',                 // how lengths are shown: mm | m | ftin
  areaUnit: 'both',                 // m2 | ft2 | both
  heights: { floor: 3.0, slab: 0.15, door: 2.1, sill: 0.9, head: 2.1, parapet: 1.05 },
  layerRoles: {},                   // the office's own layer → role map, learnt on import
  roomTypes: {},                    // the office's own room label → type map
  ai: { enabled: false, remember: false, key: '' },
  theme: null,
};
export async function getSettings() {
  const s = await getKV('settings', {});
  // until Sept 2026 every import remembered Plumb's own guesses as office layer standards; forget
  // those once (from now on only roles you change are remembered)
  if (s.layerRoles && Object.keys(s.layerRoles).length && !s.rolesYours) { s.layerRoles = {}; s.rolesYours = true; await putKV('settings', s); }
  return { ...DEFAULT_SETTINGS, ...s, heights: { ...DEFAULT_SETTINGS.heights, ...(s.heights || {}) }, ai: { ...DEFAULT_SETTINGS.ai, ...(s.ai || {}) } };
}
export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  if ('layerRoles' in patch) next.rolesYours = true; // roles saved from now on are yours
  await putKV('settings', next);
  return next;
}

/** Something handed over from the landing page (a dropped file) for the app to pick up. */
export const setPending = (files) => putKV('pending', { files, at: Date.now() });
export async function takePending() {
  const p = await getKV('pending');
  if (p) await tx('kv', 'readwrite', (s) => req(s.delete('pending')));
  return p && Date.now() - p.at < 10 * 60 * 1000 ? p.files : null;
}
/** Hand dropped or chosen drawings to the import page. Keeps the DWG and DXF files; returns how many. */
export async function pendDrawings(files) {
  const ok = [...files].filter((f) => /\.(dwg|dxf)$/i.test(f.name));
  if (ok.length) await setPending(await Promise.all(ok.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
  return ok.length;
}

// ------------------------------------------------------------------ device storage
export async function usage() {
  try {
    const e = await navigator.storage.estimate();
    return { used: e.usage || 0, quota: e.quota || 0, persisted: navigator.storage.persisted ? await navigator.storage.persisted() : false };
  } catch { return { used: 0, quota: 0, persisted: false }; }
}
export async function askPersist() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
export async function wipeAll() {
  const db = await open();
  db.close();
  dbp = null;
  await new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = resolve; r.onerror = () => reject(r.error); r.onblocked = resolve; });
}
