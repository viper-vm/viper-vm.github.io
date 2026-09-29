// Plumb — analysis worker: keeps big drawings (and DWG conversion) off the page's thread.
//   {type:'analyse', key, files, opts} → {type:'result', result}
//   {type:'mass',    key, files, opts} → {type:'mass', mass}     (3D parts of every floor)
// The last analysis is kept by key, so building the 3D model right after reading costs nothing extra.
import { analyse, analyseFiles } from './pipeline.js';
import { pack } from './pack.js';
import { massFloor } from './massing.js';
import { dwgToDxf } from './dwg.js';

const converted = new Map(); // DWG key → DXF bytes, so re-checks don't convert again
let last = null;             // { key, r }

async function analysed(key, files, opts, post) {
  if (last && key && last.key === key) return last.r;
  const ready = [];
  for (const f of files) {
    if (!f.dwg) { ready.push(f); continue; }
    const ck = `${f.name}:${f.bin.byteLength}:${f.stamp || ''}`;
    if (!converted.has(ck)) converted.set(ck, await dwgToDxf(new Uint8Array(f.bin), post));
    ready.push({ name: f.name, text: converted.get(ck) });
  }
  post('Reading the drawing…');
  const r = ready.length === 1 ? analyse(ready[0].text, { ...opts, onStage: post }) : analyseFiles(ready, { ...opts, onStage: post });
  last = { key, r };
  return r;
}

self.onmessage = async (e) => {
  const { id, type = 'analyse', key, files, opts, sheet } = e.data;
  const post = (stage) => self.postMessage({ id, type: 'progress', stage });
  try {
    if (type === 'mass') {
      const r = files ? await analysed(key, files, opts || {}, post) : last && last.r;
      if (!r) throw new Error('Nothing analysed yet');
      const mass = r.an.map((a, k) => { post(`Building the 3D model (${k + 1}/${r.an.length})…`); return massFloor(r.dx, r.roles, a); });
      self.postMessage({ id, type: 'mass', mass });
      return;
    }
    const r = await analysed(key || null, files, opts || {}, post);
    self.postMessage({ id, type: 'result', result: pack(r, { sheet: !!sheet }) });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String((err && err.message) || err), stack: String((err && err.stack) || '') });
  }
};
