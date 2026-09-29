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
  check('levelFromName: ground / first-floor / L2 / B1 / 03 / rev3, .dxf or .dwg', F('ground.dxf') === 0 && F('first-floor.dxf') === 1 && F('L2.dxf') === 2 && F('B1_plan.dxf') === -1 && F('03.dxf') === 3 && F('project-rev3.dxf') === null && F('L2.dwg') === 2 && F('First-Floor.DWG') === 1);
  check('levelFromName: office shorthand GF / FF / SF / TF, 4F, after the project name', F('GF.dxf') === 0 && F('Riverside FF.dwg') === 1 && F('SF plan.dxf') === 2 && F('TF.dxf') === 3 && F('4F.dxf') === 4 && F('Tower-2-B1.dwg') === -1 && levelFromName('L2.dxf').text === 'SECOND FLOOR' && levelFromName('12.dxf').text === '12TH FLOOR');
  const mid = textAnchor({ x: 5, y: 5, h: 0.2, text: 'BED ROOM', ha: 4, va: 0, rot: 0 });
  const left = textAnchor({ x: 5, y: 5, h: 0.2, text: 'BED ROOM', ha: 0, va: 0, rot: 0 });
  const mt = textAnchor({ x: 5, y: 5, h: 0.2, text: 'BED ROOM', mtext: true, attach: 1, rot: 0 });
  check('textAnchor: middle / left-baseline / MTEXT top-left', mid[0] === 5 && mid[1] === 5 && left[0] > 5.4 && left[1] > 5 && mt[0] > 5.4 && mt[1] < 5);
}

// ------------------------------------------------------------------ a real-world sheet: both storeys side by side
{
  const { casaSheet } = await import(new URL('./fixtures.mjs', import.meta.url).href);
  const text = casaSheet();
  const frames = parseDXF(text).segs.filter((s) => s[4] === 'casa');
  check('OCS: a mirrored block (extrusion 0,0,−1) lands where AutoCAD draws it', frames.length === 10 && frames.every((s) => Math.min(s[0], s[2]) >= 2.99 && Math.max(s[0], s[2]) <= 6.01), JSON.stringify(frames.map((s) => s.slice(0, 4))));
  const r = analyse(text);
  check('units: the file says inches, the door swings say metres', r.unit.mm === 1000 && /inches/.test(r.unit.source), JSON.stringify(r.unit));
  check('floors: two plans 0.6 m apart inside a sheet border → 2 floors', r.floors.length === 2, r.floors.map((f) => f.title + ' ' + f.box.map((v) => v.toFixed(1))).join(' | '));
  check('floors: no titles → ordered by the stairs (UP on the ground floor), "COVERED TERRACE" not a title', r.floors[0].guessed === 'stairs' && r.floors[0].box[0] < 0 && r.floors[1].box[0] > 12 && r.floors.every((f) => !/terrace/i.test(f.title)), r.floors.map((f) => `${f.title}:${f.guessed}`).join(' '));
  const role = (l) => r.roles.get(l).role;
  check('layers by content: glazing (sliding doors; windows + pergola), door swings on "TEXTURA", treads on a code name', role('casa') === 'window' && role('inne_gulv') === 'window' && role('TEXTURA') === 'door' && role('A-SECTMBM') === 'stair', ['casa', 'inne_gulv', 'TEXTURA', 'A-SECTMBM'].map((l) => l + ':' + role(l)).join(' '));
  const g = r.an[0].rooms;
  check('rooms: open plan split by its names, the stair from its UP arrow; notes and slats are not rooms', ['Kitchen', 'Dining', 'Living'].every((n) => g.some((q) => q.name === n)) && g.some((q) => q.type === 'stair') && !g.some((q) => /sliding|^up$/i.test(q.name) || q.type === 'duct'), g.map((q) => q.name + ':' + q.type).join(','));
  check('issues: the bathroom over the dining room', r.issues.some((i) => i.kind === 'wet-over-dry' && /dining/i.test(i.title)), sig(r));
  check('each floor reads only its own plan (margin under half the 0.6 m gap)', r.an.every((a) => a.margin < 0.3), r.an.map((a) => a.margin).join());
}

// ------------------------------------------------------------------ floors marked by hand on the sheet
{
  const { casaSheet } = await import(new URL('./fixtures.mjs', import.meta.url).href);
  const tight = casaSheet(0.2); // the plans 20 cm apart: too close to tell apart by themselves
  const auto = analyse(tight);
  check('mark floors: plans 0.2 m apart read as one floor on their own', auto.floors.length === 1, auto.floors.length);
  const floors = [
    { id: 0, title: 'GROUND FLOOR', level: 0, typical: false, box: [-3.1, -0.1, 12.08, 12.1] },
    { id: 1, title: 'FIRST FLOOR', level: 1, typical: false, box: [12.14, -0.1, 21.3, 12.1], marked: true },
  ];
  const marked = analyse(tight, { floors });
  check('mark floors: two boxes drawn by hand → two floors and the bathroom over the dining room', marked.floors.length === 2 && marked.issues.some((i) => i.kind === 'wet-over-dry' && /dining/i.test(i.title)), sig(marked));
  check('mark floors: each box reads only its own plan', marked.an.every((a) => a.margin <= 0.1) && !marked.an[1].rooms.some((q) => /kitchen|dining|living/i.test(q.name)), marked.an.map((a) => a.rooms.map((q) => q.name).join('/')).join(' | '));
  const sh = pack(marked, { sheet: true }).sheet;
  const xs = [...sh.segs].filter((_, i) => i % 2 === 0);
  check('sheet: the whole drawing for marking by hand, from its corner, with room names', sh && Math.min(...xs) >= -1e-3 && Math.max(...xs) <= sh.w + 1e-3 && sh.weight.length * 4 === sh.segs.length && sh.texts.some((t) => t.text === 'KITCHEN') && !('sheet' in pack(marked)), sh && `${sh.segs.length / 4} lines, ${sh.texts.length} texts`);
}

// ------------------------------------------------------------------ area statements (RERA carpet, CGDCR FSI)
{
  const { areaStatement, statementCSV, ZONES, zoneOf } = await import(base + 'areas.js');
  const { casaSheet } = await import(new URL('./fixtures.mjs', import.meta.url).href);
  const z = (c) => { const q = zoneOf(c); return `${q.base}/${q.chargeable}/${q.max}`; };
  check('FSI table 6.5 (D1 AUDA): R1 1.8/0.9/2.7, R2 1.2/0.6/1.8, CBD 1.8/3.6/5.4, TOZ up to 4.0', z('R1') === '1.8/0.9/2.7' && z('R2') === '1.2/0.6/1.8' && z('C5') === '1.8/3.6/5.4' && zoneOf('TOZ').max === 4 && ZONES.length >= 12, `${z('R1')} ${z('R2')} ${z('C5')}`);
  const house = pack(analyse(casaSheet()));
  const st = areaStatement(house, { building: 'house', plot: 250, zone: 'R1' });
  const [g, f1] = st.floors;
  check('walls: split by what they face (the first floor\'s partitions ≈ the 2.3 m² drawn)', f1.partitions > 1.6 && f1.partitions < 3.2 && g.partitions < 0.5, `${f1.partitions.toFixed(2)} / ${g.partitions.toFixed(2)}`);
  check('carpet area (RERA): rooms + partitions; the house\'s own stair is in it, outer walls and the covered terrace are not', Math.abs(g.carpet - g.carpetRooms - g.partitions) < 1e-9 && g.rooms.some((r) => r.use === 'stair' && r.rera === 'carpet') && g.balcony > 15 && g.carpet < g.builtUp - g.balcony, `carpet ${g.carpet.toFixed(1)}, balcony ${g.balcony.toFixed(1)}, built-up ${g.builtUp.toFixed(1)}`);
  const stair = g.exempt.find((e) => e.use === 'stair');
  check('FSI: the stair (measured to its flight, not the open plan) is left out under 6.3.2(6); the pergola isn\'t built-up', stair && stair.area > 6 && stair.area < 13 && /6\.3\.2\(6\)/.test(stair.rule) && Math.abs(g.fsiArea - (g.builtUp - g.exemptArea)) < 1e-9 && g.pergola > 1, stair && `${stair.area.toFixed(1)} m² stair, pergola ${g.pergola.toFixed(1)}`);
  check('FSI consumed = FSI area ÷ plot; within the base FSI', Math.abs(st.fsi.consumed - st.totals.fsiArea / 250) < 1e-9 && st.fsi.status === 'base', st.fsi.consumed.toFixed(3));
  const unnamed = g.review[0];
  const st2 = areaStatement(house, { building: 'house', plot: 250, uses: { [unnamed.key]: 'terrace' } });
  check('a space you assign moves: unnamed → open terrace (stated apart, not built-up)', unnamed && st2.floors[0].terrace === unnamed.area && st2.floors[0].builtUp === g.builtUp && st2.floors[0].review.length === g.review.length - 1, unnamed && unnamed.name);
  const flats = areaStatement(pack(analyse(readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8'))), { building: 'apartments', plot: 600 });
  const stilt = flats.floors[0], typ = flats.floors[1];
  check('apartments: stilt parking, stair, lift and electric room exempt; the guard room is common, not a flat', ['parking', 'stair', 'lift', 'electric'].every((u) => stilt.exempt.some((e) => e.use === u)) && stilt.carpet < 1 && stilt.rooms.some((r) => /guard/i.test(r.name) && r.use === 'common'), stilt.exempt.map((e) => e.use).join());
  check('apartments: stair and lift are common areas outside the flats\' carpet; balconies stated apart', typ.common > typ.exemptArea && typ.carpet > 150 && typ.balcony > 5 && typ.rooms.filter((r) => r.use === 'stair').every((r) => r.rera === 'none'), `carpet ${typ.carpet.toFixed(1)}, common ${typ.common.toFixed(1)}`);
  const csv = statementCSV(flats, { project: 'Riverside', rev: 'Rev A' }).split('\r\n');
  check('CSV: floors, total, FSI and every room', csv.some((l) => l.startsWith('"Total"')) && csv.some((l) => l.startsWith('"FSI consumed"')) && csv.filter((l) => /"(Parking|Lift|Toilet)"/.test(l)).length >= 3, csv.length);
}

// ------------------------------------------------------------------ projects: revisions and issue history
{
  const { newProject, newRevision, nextLabel, storeys, reconcile, attachOrAdd, setStatus, summarize } = await import(base + 'shell/model.js');
  const p0 = pack(analyse(readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8')));
  const fresh = () => structuredClone(p0);
  const rev = (P) => { const r = newRevision(P, []); P.revisions.push(r); P.current = r.id; return r; };
  const P = newProject({ name: 'Test' });
  check('project: Ahmedabad (CGDCR) by default', P.city === 'Ahmedabad' && P.region === 'IN-AMD');
  check('storeys: G+3 / B+G+5 / B2+G', storeys(p0.floors) === 'G+3' && storeys([-1, 0, 1, 2, 3, 4, 5].map((level) => ({ level }))) === 'B+G+5' && storeys([{ level: -2 }, { level: -1 }, { level: 0 }]) === 'B2+G', storeys(p0.floors));

  const A = rev(P), r1 = fresh(), c1 = reconcile(P, A, r1);
  check('revisions: Rev A, then Rev B … Rev Z, Rev AA', A.label === 'Rev A' && nextLabel(P) === 'Rev B' && nextLabel({ revisions: new Array(26) }) === 'Rev AA', `${A.label} ${nextLabel(P)}`);
  check('history: first revision → all 9 issues new and open', c1.added.length === 9 && r1.issues.every((i) => P.issueState[i.stateId].status === 'open'), JSON.stringify(c1));
  const fc = r1.issues.find((i) => i.kind === 'floating-column');
  const cv = r1.issues.find((i) => i.kind === 'cantilever');
  setStatus(P, fc.stateId, 'accepted', 'transfer beam agreed', 'Rev A');
  setStatus(P, cv.stateId, 'review');

  const B = rev(P), r2 = fresh(), c2 = reconcile(P, B, r2);
  check('history: same drawing as Rev B → 9 kept, none added or resolved', c2.kept.length === 9 && !c2.added.length && !c2.resolved.length, JSON.stringify(c2));
  check('history: issues keep their ids, statuses and notes', r2.issues.find((i) => i.kind === 'floating-column').stateId === fc.stateId && P.issueState[fc.stateId].status === 'accepted' && /transfer beam/.test(P.issueState[fc.stateId].history.at(-1).text));

  // Rev C loses the floating column (accepted) and the cantilever (in review)
  const C = rev(P), r3 = fresh();
  r3.issues = r3.issues.filter((i) => i.kind !== 'floating-column' && !(i.kind === 'cantilever' && i.at[0] === cv.at[0] && i.at[1] === cv.at[1]));
  const c3 = reconcile(P, C, r3);
  check('history: fixed in Rev C → resolved in C; accepted stays accepted', c3.resolved.length === 1 && c3.resolved[0] === cv.stateId && P.issueState[cv.stateId].resolvedIn === C.id && P.issueState[fc.stateId].status === 'accepted', JSON.stringify(c3));
  check('summary: open counts leave out resolved and accepted', summarize(r3, P).issues.total === 7, summarize(r3, P).issues.total);

  // Rev D brings the cantilever back
  const D = rev(P), r4 = fresh(), c4 = reconcile(P, D, r4);
  check('history: back in Rev D → reopened, same id', c4.reopened.length === 1 && c4.reopened[0] === cv.stateId && P.issueState[cv.stateId].status === 'open' && !P.issueState[cv.stateId].resolvedIn, JSON.stringify(c4));

  // Rev E renames the floors ("FIRST FLOOR PLAN" → "1ST FLOOR"): same issues, matched by level
  const E = rev(P), r6 = fresh();
  r6.floors.forEach((f) => { f.title = `LEVEL ${f.level} (REVISED)`; });
  const c6 = reconcile(P, E, r6);
  check('history: floors renamed in Rev E → still the same 9 issues', c6.kept.length === 9 && !c6.added.length && !c6.resolved.length, JSON.stringify(c6));
  const D2 = E;
  // re-reading Rev E with other options: one finding moves, nothing gets resolved
  const r5 = fresh();
  const moved = r5.issues.find((i) => i.kind === 'duct-offset');
  moved.at = [moved.at[0] + 5, moved.at[1]];
  const before = Object.keys(P.issueState).length;
  attachOrAdd(P, D2, r5);
  check('re-read: new finding added as open; nothing marked resolved', Object.keys(P.issueState).length === before + 1 && P.issueState[moved.stateId].status === 'open' && Object.values(P.issueState).every((s) => s.status !== 'resolved'), Object.values(P.issueState).map((s) => s.status).join());
}

{
  const { newProject, newRevision, reconcile } = await import(base + 'shell/model.js');
  const P = newProject({ name: 'Lakeview' });
  const rev = () => { const r = newRevision(P, []); P.revisions.push(r); P.current = r.id; return r; };
  reconcile(P, rev(), pack(analyseFiles(lakeviewFiles())));
  const two = lakeviewFiles().filter((f) => f.name !== 'L2.dxf');
  const c = reconcile(P, rev(), pack(analyseFiles(two)));
  check('history: next revision without the L2 file → G→L1 issues kept, the 3 on L2 resolved', c.kept.length === 2 && c.resolved.length === 3 && !c.added.length, JSON.stringify(c));
  const r3 = pack(analyseFiles(two.reverse()));
  const c3 = reconcile(P, rev(), r3);
  check('history: same files in another order → nothing new, nothing resolved', c3.kept.length === 2 && !c3.added.length && !c3.resolved.length, JSON.stringify(c3));
  // a single-file drawing whose plans were moved in model space: matched from the plan's corner
  const Q = newProject({ name: 'Moved' });
  const revQ = () => { const r = newRevision(Q, []); Q.revisions.push(r); Q.current = r.id; return r; };
  const text = readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8');
  const a1 = pack(analyse(text));
  reconcile(Q, revQ(), a1);
  const a2 = structuredClone(a1);
  a2.floors.forEach((f) => { f.box = [f.box[0] + 40, f.box[1] - 25, f.box[2] + 40, f.box[3] - 25]; });
  a2.issues.forEach((i) => { i.at = [i.at[0] + 40, i.at[1] - 25]; delete i.stateId; });
  const cq = reconcile(Q, revQ(), a2);
  check('history: plans moved in the drawing → still the same 9 issues', cq.kept.length === 9 && !cq.added.length, JSON.stringify(cq));
}

console.log(fails ? `\n${fails} of ${n} FAILED` : `\nALL ${n} PASS`);
process.exit(fails ? 1 : 0);
