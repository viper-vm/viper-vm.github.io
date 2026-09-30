// Plumb — talks to the analysis worker for a project's revision and caches what comes back,
// so a project reopens instantly and only re-reads its drawings when something changed.

import { getFileBytes, getCache, putCache } from './store.js';

/** Bump when the analysis output changes shape or meaning: old caches are then ignored. */
export const ENGINE = 'e11';

let worker = null, broken = false, seq = 0;
function makeWorker() {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('error', () => { broken = true; worker = null; });
  } catch { broken = true; worker = null; }
  return worker;
}

/** Stable short hash of anything JSON-able (cache keys). */
export function hashOf(v) {
  const s = JSON.stringify(v ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export const optsKey = (opts) => hashOf({ r: opts.roles || [], t: opts.types || [], n: opts.nudges || {}, u: opts.unitMM || null, f: opts.floors || null });

/** Drawing files of a revision, ready for the worker. */
async function filesOf(rev) {
  return Promise.all(rev.files.map(async (f) => {
    const bytes = await getFileBytes(f.id);
    if (f.kind === 'dwg') return { name: f.name, dwg: true, bin: bytes.buffer, stamp: f.id };
    if (f.kind === 'dxfb') return { name: f.name, text: bytes };
    return { name: f.name, text: decodeText(bytes) };
  }));
}

/** DXF text is UTF-8 from AutoCAD 2007 on, the Windows codepage before that. */
export function decodeText(bytes) {
  const t = new TextDecoder('utf-8').decode(bytes);
  return t.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : t;
}

/** What kind of drawing a file is, from its bytes. */
export function kindOf(name, bytes) {
  if (bytes.length > 6 && bytes[0] === 0x41 && bytes[1] === 0x43 && bytes[2] === 0x31 && bytes[3] === 0x30) return 'dwg'; // "AC10…"
  const sig = 'AutoCAD Binary DXF';
  if (bytes.length > sig.length && [...sig].every((c, i) => bytes[i] === c.charCodeAt(0))) return 'dxfb';
  if (/\.dwg$/i.test(name)) return 'dwg';
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 20000));
  return /SECTION|EOF/.test(head) ? 'dxf' : null;
}

function ask(msg, onStage) {
  const w = makeWorker();
  if (!w) return inline(msg, onStage);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      if (e.data.type === 'progress') { onStage && onStage(e.data.stage); return; }
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      if (e.data.type === 'error') reject(new Error(e.data.message)); else resolve(e.data);
    };
    const onErr = () => { w.removeEventListener('message', onMsg); broken = true; worker = null; inline(msg, onStage).then(resolve, reject); };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr, { once: true });
    w.postMessage({ id, ...msg });
  });
}

/** Same work on the page's own thread (browsers without module workers). */
let inlineLast = null;
async function inline(msg, onStage) {
  const [{ analyse, analyseFiles }, { pack }, { dwgToDxf }, { massFloor }] = await Promise.all([import('../pipeline.js'), import('../pack.js'), import('../dwg.js'), import('../massing.js')]);
  await new Promise((r) => setTimeout(r, 20));
  if (!inlineLast || inlineLast.key !== msg.key) {
    const files = [];
    for (const f of msg.files) files.push(f.dwg ? { name: f.name, text: await dwgToDxf(new Uint8Array(f.bin), onStage) } : f);
    const opts = { ...msg.opts, onStage };
    const r = files.length === 1 ? analyse(files[0].text, opts) : analyseFiles(files, opts);
    inlineLast = { key: msg.key, r };
  }
  const r = inlineLast.r;
  if (msg.type === 'mass') return { type: 'mass', mass: r.an.map((a) => massFloor(r.dx, r.roles, a)) };
  return { type: 'result', result: pack(r, { sheet: !!msg.sheet }) };
}

const serial = (opts) => ({
  roles: opts.roles || [], types: opts.types || [], nudges: opts.nudges || {},
  unitMM: opts.unitMM || undefined, floors: opts.floors || undefined,
});

/** The packed analysis of a revision (cached per options). */
export async function analyseRevision(project, rev, { onStage, force = false } = {}) {
  const key = `${project.id}:${rev.id}:a:${ENGINE}:${optsKey(rev.opts || {})}`;
  if (!force) { const hit = await getCache(key).catch(() => null); if (hit) return hit; }
  onStage && onStage('Opening the drawings…');
  const files = await filesOf(rev);
  const out = await ask({ type: 'analyse', key, files, opts: serial(rev.opts || {}) }, onStage);
  putCache(key, out.result).catch(() => {}); // a full disk shouldn't stop the work
  return out.result;
}

/** The 3D parts (walls, openings…) of every floor of a revision (cached per options). */
export async function massRevision(project, rev, { onStage } = {}) {
  const akey = `${project.id}:${rev.id}:a:${ENGINE}:${optsKey(rev.opts || {})}`;
  const key = `${project.id}:${rev.id}:m:${ENGINE}:${optsKey(rev.opts || {})}`;
  const hit = await getCache(key).catch(() => null);
  if (hit) return hit;
  onStage && onStage('Building the 3D model…');
  const files = await filesOf(rev);
  const out = await ask({ type: 'mass', key: akey, files, opts: serial(rev.opts || {}) }, onStage);
  putCache(key, out.mass).catch(() => {});
  return out.mass;
}

/** Analyse files that aren't in a project yet (the import wizard's previews). */
export async function analyseLoose(files, opts, onStage, { sheet = false } = {}) {
  const key = 'loose:' + hashOf({ n: files.map((f) => [f.name, f.size]), o: optsKey(opts) });
  const out = await ask({ type: 'analyse', key, files, opts: serial(opts), sheet }, onStage);
  return out.result;
}

export const SAMPLE_URL = new URL('../../samples/riverside-residency.dxf', import.meta.url).href;
