// Plumb — analysis worker: keeps big drawings (and DWG conversion) off the page's thread.
import { analyse, analyseFiles } from './pipeline.js';
import { pack } from './pack.js';
import { massFloor } from './massing.js';
import { dwgToDxf } from './dwg.js';

const converted = new Map(); // DWG key → DXF bytes, so re-checks don't convert again
let last = null;             // the last full analysis, for building the 3D model on demand

self.onmessage = async (e) => {
  const { id, type = 'analyse', files, opts } = e.data;
  const post = (stage) => self.postMessage({ id, type: 'progress', stage });
  try {
    if (type === 'mass') {
      if (!last) throw new Error('Nothing analysed yet');
      const mass = last.an.map((a, k) => { post(`Building the 3D model (${k + 1}/${last.an.length})…`); return massFloor(last.dx, last.roles, a); });
      self.postMessage({ id, type: 'mass', mass });
      return;
    }
    const ready = [];
    for (const f of files) {
      if (!f.dwg) { ready.push(f); continue; }
      const key = `${f.name}:${f.bin.byteLength}:${f.stamp || ''}`;
      if (!converted.has(key)) converted.set(key, await dwgToDxf(new Uint8Array(f.bin), post));
      ready.push({ name: f.name, text: converted.get(key) });
    }
    post('Reading the drawing…');
    const r = ready.length === 1 ? analyse(ready[0].text, { ...opts, onStage: post }) : analyseFiles(ready, { ...opts, onStage: post });
    last = r;
    self.postMessage({ id, type: 'result', result: pack(r) });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String((err && err.message) || err), stack: String((err && err.stack) || '') });
  }
};
