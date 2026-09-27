// Plumb — analysis worker: keeps big drawings from freezing the page.
import { analyse, analyseFiles } from './pipeline.js';
import { pack, transferables } from './pack.js';

self.onmessage = (e) => {
  const { id, files, opts } = e.data;
  try {
    const post = (stage) => self.postMessage({ id, type: 'progress', stage });
    post('Reading the drawing…');
    const r = files.length === 1 ? analyse(files[0].text, { ...opts, onStage: post }) : analyseFiles(files, { ...opts, onStage: post });
    self.postMessage({ id, type: 'result', result: pack(r) }, transferables(r));
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String((err && err.stack) || err) });
  }
};
