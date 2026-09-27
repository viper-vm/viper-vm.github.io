// Plumb — DWG support. DWG is a closed format; LibreDWG (GPL-3.0, via the libredwg-web
// WebAssembly build) reads it and writes it back out as DXF, which Plumb already understands.
// Loaded from jsDelivr only when someone opens a .dwg (~3 MB compressed), then cached.

const LRW = 'https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.14';
let lib = null;

/** DWG bytes → DXF bytes. */
export async function dwgToDxf(bytes, onStage = () => {}) {
  if (!lib) {
    onStage('Loading the DWG reader (first time only)…');
    lib = import(`${LRW}/dist/libredwg-web.js`).then((m) => m.LibreDwg.create(`${LRW}/wasm`));
  }
  let dwg;
  try { dwg = await lib; } catch (e) { lib = null; throw new Error('DWG_LOAD'); }
  onStage('Converting the DWG…');
  let out = null;
  try { out = dwg.dwg_write_dxf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); } catch (e) { out = null; }
  if (!out || !out.length) throw new Error('DWG_READ');
  return out;
}

export const isDWG = (name, bytes) => /\.dwg$/i.test(name) || (bytes && bytes.length > 6 && String.fromCharCode(...bytes.subarray(0, 4)) === 'AC10');
