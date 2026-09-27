// Plumb regression suite. Run from the repo root:  node demos/plumb/test/suite.mjs
// Two buildings drawn in opposite styles (the shipped sample, and Lakeview Court from
// fixtures.mjs as one file and as one file per floor) must give exactly their planted issues,
// plus unit checks on level parsing, text anchoring and the markups DXF.

import { readFileSync } from 'node:fs';

const base = new URL('../js/', import.meta.url).href;
const { analyse, analyseFiles, levelFromName } = await import(base + 'pipeline.js');
const { parseLevel, textAnchor } = await import(base + 'recognize.js');
const { parseDXF } = await import(base + 'dxf.js');
const { pack } = await import(base + 'pack.js');
const { markupsDXF, issuesCSV } = await import(base + 'export.js');
const { lakeviewSingle, lakeviewFiles } = await import(new URL('./fixtures.mjs', import.meta.url).href);
const { massFloor } = await import(base + 'massing.js');

let fails = 0, n = 0;
const check = (name, ok, got = '') => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || got === '' ? '' : `   → got ${got}`}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const sig = (r) => r.issues.map((i) => `${i.kind}:${i.lower}>${i.upper}:${i.severity}`).sort().join(' ');

// ------------------------------------------------------------------ the sample (mm, AIA layers, side by side)
{
  const text = readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8');
  const t0 = Date.now();
  const r = analyse(text);
  const ms = Date.now() - t0;
  check('sample: units from door swings (mm)', r.unit.mm === 1 && /door/.test(r.unit.source), JSON.stringify(r.unit));
  check('sample: 4 floors bottom → top, title block ignored', r.floors.map((f) => f.level).join() === '0,1,2,3', r.floors.map((f) => f.title).join('|'));
  check('sample: aligned on columns', r.aligns.slice(1).every((a) => a.method === 'columns' && a.matched >= 30), r.aligns.slice(1).map((a) => a.method + a.matched).join());
  const want = [
    'floating-column:0>1:high', 'column-offset:1>2:high', 'column-offset:2>3:high', 'duct-offset:1>2:high', 'duct-offset:2>3:high',
    'wet-over-dry:2>3:high', 'cantilever:0>1:medium', 'cantilever:0>1:medium', 'cantilever:2>3:low',
  ].sort().join(' ');
  check('sample: exactly the 9 planted issues', sig(r) === want, sig(r));
  const off = r.issues.find((i) => i.kind === 'column-offset');
  check('sample: column offset measured as 150 mm', off && near(off.value, 0.15, 0.01), off && off.value);
  const duct = r.issues.find((i) => i.kind === 'duct-offset');
  check('sample: duct shift measured ~300 mm', duct && near(duct.value, 0.3, 0.05), duct && duct.value);
  check(`sample: analysed in ${ms} ms (< 4000)`, ms < 4000);

  // markups go back to the drawing's own coordinates and units
  const p = pack(r);
  p.issues.forEach((i, k) => { i.n = k + 1; });
  const back = parseDXF(markupsDXF(p, new Set(), { file: 'x.dxf', date: '2026-01-01' }));
  const fc = p.issues.find((i) => i.kind === 'floating-column');
  const ring = back.circles.find((c) => c.layer === 'PLUMB-HIGH' && near(c.cx, 35700, 1) && near(c.cy, 4800, 1));
  check('markups: floating column ringed at 35700,4800 (mm) on PLUMB-HIGH', !!ring && fc.n === 1, JSON.stringify(back.circles[0]));
  const both = p.issues.every((i) => back.texts.some((t) => t.text.startsWith(`P${i.n}  `)) && back.texts.some((t) => t.text.startsWith(`P${i.n} (from`)));
  check('markups: every issue tagged on its floor and on the floor below', both);
  const csv = issuesCSV(p, new Set()).trim().split('\r\n');
  check('csv: header + one row per issue', csv.length === p.issues.length + 1, csv.length);
}

// ------------------------------------------------------------------ Lakeview: metres, stacked vertically, blocks, MTEXT
{
  const r = analyse(lakeviewSingle());
  check('lakeview: units from $INSUNITS (m)', r.unit.mm === 1000 && r.unit.source === 'header', JSON.stringify(r.unit));
  check('lakeview: generic layer "L-01" read as walls from its content', r.roles.get('L-01').role === 'wall', r.roles.get('L-01').role);
  check('lakeview: 3 floors from MTEXT titles above the plans', r.floors.map((f) => f.level).join() === '0,1,2', r.floors.map((f) => f.title).join('|'));
  const a1 = r.aligns[1];
  check('lakeview: off-grid 1st floor aligned (−0.35, −20.2)', a1.method === 'columns' && near(a1.tx, -0.35, 0.01) && near(a1.ty, -20.2, 0.01), `${a1.tx},${a1.ty}`);
  const names = r.an[0].rooms.map((q) => q.name);
  check('lakeview: multi-line MTEXT tags give clean names', names.includes('Master Bed') && names.includes('Bedroom 2') && names.includes('T&B'), names.join(','));
  check('lakeview: open-plan living/dining split by its labels', names.includes('Living') && names.includes('Dining'));
  check('lakeview: doors (mirrored/rotated block inserts) found', r.an[0].doors.length >= 9, r.an[0].doors.length);
  const want = ['floating-column:0>1:high', 'cantilever:0>1:high', 'lift-offset:1>2:high', 'wet-over-dry:1>2:high', 'wet-over-dry:1>2:low'].sort().join(' ');
  check('lakeview: exactly the 5 planted issues', sig(r) === want, sig(r));
}
{
  const r = analyseFiles(lakeviewFiles());
  check('lakeview files: floors ordered by file name (ground, first-floor, L2)', r.floors.map((f) => f.file).join() === 'ground.dxf,first-floor.dxf,L2.dxf', r.floors.map((f) => f.file).join());
  const want = ['floating-column:0>1:high', 'cantilever:0>1:high', 'lift-offset:1>2:high', 'wet-over-dry:1>2:high', 'wet-over-dry:1>2:low'].sort().join(' ');
  check('lakeview files: same 5 issues as the single file', sig(r) === want, sig(r));
  const p = pack(r);
  p.issues.forEach((i, k) => { i.n = k + 1; });
  const back = parseDXF(markupsDXF(p, new Set(), {}));
  // the 2nd-floor lift (plan 15.2, 3.6) lives at (−34.8, 33.6) in L2.dxf, whose plan origin is (−50, 30)
  const ring = back.circles.find((c) => c.layer === 'PLUMB-L2-HIGH' && near(c.cx, -34.8, 0.1) && near(c.cy, 33.6, 0.1));
  check('lakeview files: markups on per-floor layers, in each file\'s own coordinates', !!ring, JSON.stringify(back.circles.filter((c) => /L2/.test(c.layer))));
}

// ------------------------------------------------------------------ dimensions + binary DXF
{
  const text = readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8');
  const p = pack(analyse(text));
  const d0 = p.geometry[0].dims;
  const labels = d0.texts.map((t) => t.text).sort().join(' ');
  check('dimensions: sample DIMENSIONs drawn from their *D blocks, 13 per floor', p.geometry.every((g) => g.dims.count === 13), p.geometry.map((g) => g.dims.count).join());
  check('dimensions: grid chain + overall read as drawn (2700 … 21000)', /2700/.test(labels) && /21000/.test(labels) && /12000/.test(labels), labels);
  check('dimensions: never mistaken for walls (issues unchanged)', p.issues.length === 9, p.issues.length);
  const lv = pack(analyse(lakeviewSingle()));
  const t = lv.geometry[1].dims.texts;
  check('dimensions: block-less DIMENSIONs rebuilt from definition points (metres)', lv.geometry[1].dims.count === 6 && t.filter((q) => q.text === '4.50').length === 4 && t.some((q) => q.text === '5.50' && q.rot === 90), t.map((q) => q.text + '@' + q.rot).join());

  // binary DXF: same drawing, same answer
  const bin = toBinaryDXF(text);
  const a = parseDXF(text), b = parseDXF(bin);
  check('binary DXF: same entities as the ASCII file', a.segs.length === b.segs.length && a.texts.length === b.texts.length && a.dims.length === b.dims.length && a.fills.length === b.fills.length, `${b.segs.length}/${a.segs.length} segs`);
  const rb = analyse(bin);
  check('binary DXF: same 9 issues', rb.issues.length === 9, rb.issues.length);
}

// ------------------------------------------------------------------ 3D model parts
{
  const text = readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8');
  const r = analyse(text);
  const m = massFloor(r.dx, r.roles, r.an[1]);
  const wallArea = m.walls.reduce((a, w) => a + Math.abs(area(w.outer)) - w.holes.reduce((b, h) => b + Math.abs(area(h)), 0), 0);
  check('model: sample first floor → 12 door openings, 15 windows, 2 balcony parapets', m.doors.length === 12 && m.windows.length === 15 && m.parapets.length === 2, `${m.doors.length} doors, ${m.windows.length} windows, ${m.parapets.length} parapets`);
  check('model: windows all on the outside walls (x = 0/21 m, y = 0/12 m)', m.windows.every((w) => near(w.cx - 33, 0, 0.2) || near(w.cx - 33, 21, 0.2) || near(w.cy, 0, 0.2) || near(w.cy, 12, 0.2)));
  check(`model: wall footprint is solid, not two lines (${wallArea.toFixed(1)} m²)`, wallArea > 20 && wallArea < 45, wallArea.toFixed(1));
  const doorW = m.doors.map((d) => Math.hypot(d.x1 - d.x0, d.y1 - d.y0));
  check('model: door openings as wide as their leaves (0.75–1.0 m)', doorW.every((w) => w > 0.7 && w < 1.05), doorW.map((w) => w.toFixed(2)).join());
  const lv = analyse(lakeviewSingle());
  const ml = massFloor(lv.dx, lv.roles, lv.an[1]);
  check('model: Lakeview first floor (mirrored/rotated door blocks) → 10 doors, 7 windows, 1 parapet', ml.doors.length === 10 && ml.windows.length === 7 && ml.parapets.length === 1, `${ml.doors.length} doors, ${ml.windows.length} windows, ${ml.parapets.length} parapets`);
}
function area(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return a / 2; }

/** ASCII DXF → binary DXF (R13+ layout: 2-byte group codes), for the round-trip test. */
function toBinaryDXF(text) {
  const lines = text.split(/\r?\n/);
  const chunks = [Buffer.from('AutoCAD Binary DXF\r\n\x1a\x00', 'latin1')];
  const R = (c, rs) => rs.some(([a, z]) => c >= a && c <= z);
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10), v = lines[i + 1];
    if (Number.isNaN(code)) continue;
    const head = Buffer.alloc(2); head.writeUInt16LE(code);
    let body;
    if (R(code, [[10, 59], [110, 149], [210, 239], [460, 469], [1010, 1059]])) { body = Buffer.alloc(8); body.writeDoubleLE(parseFloat(v)); }
    else if (R(code, [[60, 79], [170, 179], [270, 289], [370, 389], [400, 409], [1060, 1070]])) { body = Buffer.alloc(2); body.writeInt16LE(parseInt(v, 10)); }
    else if (R(code, [[90, 99], [420, 429], [440, 449], [1071, 1071]])) { body = Buffer.alloc(4); body.writeInt32LE(parseInt(v, 10)); }
    else if (R(code, [[290, 299]])) { body = Buffer.from([parseInt(v, 10) ? 1 : 0]); }
    else body = Buffer.concat([Buffer.from(v, 'utf8'), Buffer.from([0])]);
    chunks.push(head, body);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

// ------------------------------------------------------------------ units
{
  const L = (s) => { const v = parseLevel(s); return v ? v.level : null; };
  check('parseLevel: ordinals, words, basements, levels', L('SECOND FLOOR PLAN') === 2 && L('2ND FLOOR PLAN') === 2 && L('Stilt floor plan') === 0 && L('B2 PLAN') === -2 && L('LEVEL 5') === 5 && L('TERRACE PLAN') === 99 && L('TYPICAL FLOOR PLAN (3RD-7TH)') === 3);
  check('parseLevel: ignores sections, elevations, site plans', L('SECTION A-A') === null && L('FRONT ELEVATION') === null && L('SITE PLAN') === null);
  const F = (s) => { const v = levelFromName(s); return v ? v.level : null; };
  check('levelFromName: ground / first-floor / L2 / B1 / 03 / rev3', F('ground.dxf') === 0 && F('first-floor.dxf') === 1 && F('L2.dxf') === 2 && F('B1_plan.dxf') === -1 && F('03.dxf') === 3 && F('project-rev3.dxf') === null);
  const mid = textAnchor({ x: 5, y: 5, h: 0.2, text: 'BED ROOM', ha: 4, va: 0, rot: 0 });
  const left = textAnchor({ x: 5, y: 5, h: 0.2, text: 'BED ROOM', ha: 0, va: 0, rot: 0 });
  const mt = textAnchor({ x: 5, y: 5, h: 0.2, text: 'BED ROOM', mtext: true, attach: 1, rot: 0 });
  check('textAnchor: middle / left-baseline / MTEXT top-left', mid[0] === 5 && mid[1] === 5 && left[0] > 5.4 && left[1] > 5 && mt[0] > 5.4 && mt[1] < 5);
}

console.log(fails ? `\n${fails} of ${n} FAILED` : `\nALL ${n} PASS`);
process.exit(fails ? 1 : 0);
