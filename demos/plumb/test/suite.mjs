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

// ------------------------------------------------------------------ real-world sheets (freecadfloorplans.com)
{
  const { casaSheet } = await import(new URL('./fixtures.mjs', import.meta.url).href);
  const { roomType, wallGaps } = await import(base + 'recognize.js');
  check('room names in Spanish and Chinese', roomType('Dormitorio') === 'bedroom' && roomType('Cocina') === 'kitchen' && roomType('卧室') === 'bedroom' && roomType('厨房') === 'kitchen' && roomType('客厅') === 'living' && roomType('卫生间') === 'toilet' && roomType('Baño') === 'toilet', ['卧室', '厨房', '客厅'].map(roomType).join());
  const gaps = wallGaps([[0, 0, 3, 0, 'W'], [4.2, 0, 8, 0, 'W'], [3, 0.2, 3, 3, 'W'], [0, 5, 2, 5, 'W'], [6, 5.5, 8, 5.5, 'W']]);
  check('wall openings: a wall line that carries on 1.2 m further along is bridged; offset or distant lines are not', gaps.length === 1 && Math.abs(gaps[0][0] - 3) < 1e-9 && Math.abs(gaps[0][2] - 4.2) < 1e-9, JSON.stringify(gaps));
  const r = analyse(casaSheet(0.6, { elevation: true }));
  check('an elevation drawn beside the plans is not a floor', r.floors.length === 2 && r.floors.every((f) => f.box[2] < 22.5), r.floors.map((f) => f.title + ' ' + f.box.map((v) => v.toFixed(1))).join(' | '));
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
  check('apartments: stair and lift are common areas outside the flats\' carpet; balconies stated apart', typ.common > 30 && typ.carpet > 150 && typ.balcony > 5 && typ.rooms.filter((r) => r.use === 'stair').every((r) => r.rera === 'none'), `carpet ${typ.carpet.toFixed(1)}, common ${typ.common.toFixed(1)}`);
  // landings (6.3.2(6), (7)): the lobby off the stair and lift is left out, up to 2x·x for the stair and 2x·2x for the lift
  const L1 = typ.landings, lob = typ.rooms.find((r) => /lobby/i.test(r.name));
  const st15 = L1.cores.find((c) => c.use === 'stair'), lf = L1.cores.find((c) => c.use === 'lift');
  check('landings: stair 1.5 m wide → 4.5 m² allowed, the lift ≈ 2 m well → ≈ 16 m²; the lobby is the landing, left out up to that', st15 && near(st15.allow, 4.5, 0.01) && st15.measured && lf && lf.allow > 12 && lf.allow < 20 && L1.spaces.length === 1 && lob && L1.spaces[0] === lob.i && near(L1.exempt, Math.min(lob.area, L1.allowance), 1e-9) && typ.exempt.some((e) => e.use === 'landing' && near(e.area, L1.exempt, 1e-9)), `${st15 && st15.allow.toFixed(2)} + ${lf && lf.allow.toFixed(1)} vs lobby ${lob && lob.area.toFixed(1)}`);
  check('landings: the stair and the lift are left out with their walls', typ.exempt.filter((e) => e.use === 'stair' || e.use === 'lift').every((e) => e.walls > 0.3 && e.area > e.walls), typ.exempt.map((e) => `${e.use} ${e.area.toFixed(1)}`).join(', '));
  const ghouse = st.floors[1];
  check('landings: in a house the landing upstairs is allowed for; the stair open to the living room downstairs gets none', near(ghouse.landings.exempt, 4.5, 0.05) && st.floors[0].landings.exempt === 0, `${ghouse.landings.exempt.toFixed(2)} / ${st.floors[0].landings.exempt}`);
  const withNote = pack(analyse(casaSheet(0.6, { loft: true })));
  const bedL = withNote.an[1].rooms.find((r) => r.name === 'Bedroom');
  const stL = areaStatement(withNote, { building: 'house', plot: 250 });
  check('lofts: “LOFT ABOVE” in a room marks it (not its name); the statement asks for the loft\'s area', bedL && bedL.loft && !withNote.an[1].rooms.some((r) => /loft/i.test(r.name)) && stL.floors[1].lofts.length === 1 && stL.floors[1].lofts[0].area === null, bedL && `${bedL.name} ${bedL.loft}`);
  // lofts (6.3.2(5)): up to 30% of the room below is free, the rest counts
  const bed = typ.rooms.find((r) => r.type === 'bedroom');
  const withLoft = (a) => areaStatement(pack(analyse(readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8'))), { building: 'apartments', plot: 600, lofts: { [bed.key]: { area: a } } }).floors[1];
  const small = withLoft(0.2 * bed.area), big = withLoft(0.5 * bed.area);
  check('lofts: 20% of the room is built-up but not in FSI; at 50%, the 20% over 30% counts', near(small.builtUp - typ.builtUp, 0.2 * bed.area, 1e-6) && near(small.fsiArea, typ.fsiArea, 1e-6) && near(big.fsiArea - typ.fsiArea, 0.2 * bed.area, 1e-6) && big.lofts[0].excess > 0, `${(small.fsiArea - typ.fsiArea).toFixed(3)} / ${(big.fsiArea - typ.fsiArea).toFixed(2)}`);
  const { checkBuilding: cb, ruleSetup: rs } = await import(base + 'rules.js');
  const flatsR = pack(analyse(readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8')));
  const loftRule = (a) => cb(flatsR, rs({ areas: { building: 'apartments' } }), { areas: { building: 'apartments', plot: 600, lofts: { [bed.key]: a } }, heights: {} }).groups.flatMap((g) => g.rules).find((r) => r.id === 'loft').status;
  check('bye-laws: a loft over 30% of its room fails 13.1.9; a loft marked without an area asks for it', loftRule({ area: 0.5 * bed.area }) === 'fail' && loftRule({ area: 0.25 * bed.area }) === 'pass' && loftRule({ area: null }) === 'need', [loftRule({ area: 0.5 * bed.area }), loftRule({ area: null })].join());

  // mezzanines (Part I 2.70, Part III 13.1.8): counted in FSI in full, carpet inside a flat, 30% at most
  const liv = typ.rooms.find((r) => r.type === 'living' && r.flat);
  const sampleR = pack(analyse(readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8')));
  const withMezz = areaStatement(sampleR, { building: 'apartments', plot: 600, mezz: { [liv.key]: { area: 5 } } }).floors[1];
  const flatM = withMezz.flats.find((q) => q.rooms.includes(liv.i)), flat0 = typ.flats.find((q) => q.rooms.includes(liv.i));
  check('mezzanines: 5 m² over a living room adds 5 m² to built-up, FSI area, the floor\'s carpet and its flat\'s', near(withMezz.builtUp - typ.builtUp, 5, 1e-6) && near(withMezz.fsiArea - typ.fsiArea, 5, 1e-6) && near(withMezz.carpet - typ.carpet, 5, 1e-6) && near(flatM.carpet - flat0.carpet, 5, 1e-6) && flatM.mezz === 5, `${(withMezz.fsiArea - typ.fsiArea).toFixed(2)} ${(flatM.carpet - flat0.carpet).toFixed(2)}`);
  const mezzRule = (a, floor) => cb(sampleR, rs({ areas: { building: 'apartments' } }), { areas: { building: 'apartments', plot: 600, mezz: { [liv.key]: a } }, heights: { floor } }).groups.flatMap((g) => g.rules).find((r) => r.id === 'mezzanine').status;
  check('bye-laws: a mezzanine needs 2.1 m above and below (a 3 m storey is flagged, 4.5 m passes) and ≤ 30% of its room', mezzRule({ area: 5 }, 3) === 'warn' && mezzRule({ area: 5 }, 4.5) === 'pass' && mezzRule({ area: 0.5 * liv.area }, 4.5) === 'fail' && mezzRule({ area: null }, 4.5) === 'need', [mezzRule({ area: 5 }, 3), mezzRule({ area: 5 }, 4.5), mezzRule({ area: 0.5 * liv.area }, 4.5)].join());
  const s0 = analyse(readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8'));
  const asMezz = pack(analyse(readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8'), { floors: s0.floors.map((f, k) => (k === 1 ? { ...f, title: 'MEZZANINE FLOOR PLAN', level: 0.5 } : f)) }));
  const stM = areaStatement(asMezz, { building: 'apartments', plot: 600 }), mf = stM.floors[1];
  const factsM = cb(asMezz, rs({ areas: { building: 'apartments' } }), { areas: { building: 'apartments', plot: 600 }, heights: {} });
  check('a mezzanine drawn as a plan: measured like a floor, set against the floor it overlooks, not a storey of the building\'s height', mf.mezzFloor && mf.overlooks && mf.overlooks.k === 0 && mf.overlooks.share > 0.3 && factsM.facts.storeys === 3 && factsM.groups.flatMap((g) => g.rules).find((r) => r.id === 'mezzanine').status === 'fail', `${mf.overlooks && mf.overlooks.share.toFixed(2)} · ${factsM.facts.storeys} storeys`);
  const mezzNote = pack(analyse(casaSheet(0.6, { mezz: true })));
  const master = mezzNote.an[1].rooms.find((r) => /master/i.test(r.name));
  check('mezzanines: “MEZZANINE ABOVE” in a room marks it and doesn\'t rename it', master && master.mezz && areaStatement(mezzNote, { building: 'house' }).floors[1].mezz.length === 1, master && `${master.name} ${master.mezz}`);

  // flat by flat: two 2 BHK flats a floor, each ≈100 m² of carpet; the planted top-floor differences show
  const fl = flats.floors.slice(1).map((f) => f.flats);
  check('flats: two a floor, grouped round their kitchens through their own doors (the lobby between them is common)', fl.every((x) => x.length === 2 && x.every((q) => q.kind === '2 BHK' && q.carpet > 90 && q.carpet < 110)), fl.map((x) => x.map((q) => `${q.name} ${q.kind} ${q.carpet.toFixed(1)}`).join(' / ')).join(' | '));
  check('flats: numbered by floor (101, 102, 201…); carpet = rooms + only the walls inside the flat; floor carpet = its flats', fl[0][0].name === 'Flat 101' && fl[2][1].name === 'Flat 302' && fl.every((x, k) => near(x[0].carpet + x[1].carpet, flats.floors[k + 1].carpet, 1e-6) && x.every((q) => near(q.carpet, q.carpetRooms + q.partitions, 1e-9) && q.partitions > 3 && q.partitions < 9)), fl[0].map((q) => `${q.carpetRooms.toFixed(1)}+${q.partitions.toFixed(1)}`).join(' '));
  check('flats: each keeps its own balcony; the deeper balcony on the top floor goes to its flat', fl.every((x) => x.every((q) => q.balcony > 5)) && fl[2].some((q) => q.balcony > 8) && fl[0].every((q) => q.balcony < 6), fl[2].map((q) => q.balcony.toFixed(1)).join());
  const typ1 = flats.floors[1], store = typ1.rooms.find((r) => /store/i.test(r.name) && r.flat === typ1.flats[0].key);
  const moved = areaStatement(pack(analyse(readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8'))), { building: 'apartments', plot: 600, flatOf: { [store.key]: typ1.flats[1].key }, flatNames: { [typ1.flats[0].key]: 'A-101' } }).floors[1].flats;
  check('flats: a room you move goes with its area; a name you give is kept', moved[0].name === 'A-101' && moved[0].carpet < typ1.flats[0].carpet - store.area + 0.01 && moved[1].carpet > typ1.flats[1].carpet + store.area - 0.01, `${moved[0].carpet.toFixed(2)} / ${moved[1].carpet.toFixed(2)}`);
  const csv = statementCSV(flats, { project: 'Riverside', rev: 'Rev A' }).split('\r\n');
  check('CSV: a row per flat with its carpet area', csv.filter((l) => /^"[^"]+",1,"Flat \d{3}","2 BHK",/.test(l)).length === 6, csv.find((l) => /Flat 101/.test(l)));
  check('CSV: floors, total, FSI and every room', csv.some((l) => l.startsWith('"Total"')) && csv.some((l) => l.startsWith('"FSI consumed"')) && csv.filter((l) => /"(Parking|Lift|Toilet)"/.test(l)).length >= 3, csv.length);
}

// ------------------------------------------------------------------ floors drawn turned or mirrored
{
  const { OPS, ALL, compose, isIdentity, orientText, sheetPoint } = await import(base + 'orient.js');
  const { casaSheet } = await import(new URL('./fixtures.mjs', import.meta.url).href);
  const { whereOf } = await import(base + 'shell/model.js');
  const { toDrawing } = await import(base + 'export.js');
  const k4 = compose(OPS.rotr, compose(OPS.rotr, compose(OPS.rotr, OPS.rotr)));
  check('orientation: four quarter turns and two mirrors are nothing; eight orientations in all', isIdentity(k4) && isIdentity(compose(OPS.flipx, OPS.flipx)) && new Set(ALL.map(String)).size === 8 && orientText(OPS.flipx) === 'Mirrored left ↔ right' && orientText(OPS.flipy) === 'Mirrored top ↔ bottom' && orientText(OPS.rotr) === 'Turned 90° clockwise', orientText(compose(OPS.rotr, OPS.flipx)));
  const straight = sig(analyse(casaSheet()));
  const drawn = analyse(casaSheet(0.6, { mirrorUpper: true }));
  const fit = drawn.floors[1].fit;
  check('a floor drawn mirrored: read as drawn it gives a false overhang; Plumb suggests mirroring it back', sig(drawn) !== straight && fit && String(fit.orient) === String(OPS.flipx) && fit.fit > 0.7 && fit.now < 0.5, `${sig(drawn)} · ${fit && `${fit.orient} ${fit.fit.toFixed(2)}/${fit.now.toFixed(2)}`}`);
  const floors = drawn.floors.map((f, k) => (k === 1 ? { ...f, orient: fit.orient } : f));
  const fixed = analyse(casaSheet(0.6, { mirrorUpper: true }), { floors });
  check('…mirrored back, it reads like the sheet drawn the right way round (the bathroom over the dining)', sig(fixed) === straight && !fixed.floors[1].fit && fixed.floors[1].place, sig(fixed));
  const again = analyse(casaSheet(0.6, { mirrorUpper: true }), { floors: fixed.floors });
  check('…and a result\'s floors handed back read the same again (the sheet box is kept, the turn not applied twice)', sig(again) === straight && String(again.floors[1].sheetBox) === String(fixed.floors[1].sheetBox), String(again.floors[1].box));
  const p = pack(fixed, { sheet: true }), plain = pack(drawn, { sheet: true });
  check('the sheet view shows the drawing as drawn, not the turned copy', p.sheet.segs.length === plain.sheet.segs.length && p.sheet.w === plain.sheet.w, `${p.sheet.segs.length} vs ${plain.sheet.segs.length}`);
  const iss = fixed.issues[0], sb = fixed.floors[1].sheetBox;
  const back = sheetPoint(fixed.floors[1], iss.at[0], iss.at[1]), dwg = toDrawing(fixed, 1, iss.at[0], iss.at[1]);
  check('markups and issue history go back to where the floor is drawn on the sheet', back[0] > sb[0] && back[0] < sb[2] && back[1] > sb[1] && back[1] < sb[3] && near(dwg[0] * fixed.unit.mm / 1000, back[0], 1e-6) && near(whereOf(iss, fixed).at[0], back[0], 1e-9), `${back.map((v) => v.toFixed(2))} in ${sb.map((v) => v.toFixed(1))}`);
  const mirroredAt = sheetPoint({ place: { m: OPS.flipx, c: [5, 5], o: [100, 5] } }, 101, 6);
  check('sheetPoint: the way back undoes the mirror', near(mirroredAt[0], 4, 1e-9) && near(mirroredAt[1], 6, 1e-9), mirroredAt);
  // one plan that's two mirrored halves (the sample's typical floor: two flats round the core)
  const sampleText = readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8');
  const s0 = analyse(sampleText);
  const one = analyse(sampleText, { floors: [s0.floors[1]] });
  const box = s0.floors[1].box;
  check('two flats mirrored round a core: seen as two matching halves, with the axis through the middle', one.twin && one.twin.axis === 'x' && one.twin.at > box[0] + 0.4 * (box[2] - box[0]) && one.twin.at < box[0] + 0.6 * (box[2] - box[0]), JSON.stringify(one.twin));
  check('no false suggestions: the sample\'s floors (drawn the right way round) and a house that isn\'t symmetric', s0.floors.every((f) => !f.fit) && !s0.twin && !analyse(casaSheet(), { floors: [analyse(casaSheet()).floors[0]] }).twin);
}

// ------------------------------------------------------------------ bye-law checks (CGDCR 2017, Ahmedabad)
{
  const { heightForRoad, roadMargin, sideRear, stairRule, housePark, ruleSetup, checkBuilding, checksCSV } = await import(base + 'rules.js');
  const { casaSheet } = await import(new URL('./fixtures.mjs', import.meta.url).href);
  check('Table 6.23 (D1): height by road — 10 / 16.5 / 30 / 45 / 70 m', [7.5, 9, 12, 18, 36].map(heightForRoad).join() === '10,16.5,30,45,70' && heightForRoad(null) === null, [7.5, 9, 12, 18, 36].map(heightForRoad).join());
  check('Table 6.24 (D1): road-side margin — 2.5 up to 9 m, 3.0 to 15, 4.5 below 18, 6.0, 7.5, 9.0', [7.5, 9, 12, 15, 16, 18, 30, 45].map(roadMargin).join() === '2.5,2.5,3,3,4.5,6,7.5,9', [7.5, 9, 12, 15, 16, 18, 30, 45].map(roadMargin).join());
  const sr = (u, p, h) => { const q = sideRear(u, p, h); return q && `${q.rear}/${q.side}/${q.sides}`; };
  check('Table 6.26: houses by plot size, others by height (3.0 m to 16.5 m, 4.0 to 25, 3.0 on small plots)', sr('DW1', 60) === '0/1/any' && sr('DW1', 250) === '2/1.5/one' && sr('DW2', 400) === '3/2/both' && sr('DW3', 1000, 15) === '3/3/both' && sr('DW3', 1000, 20) === '4/4/both' && sr('DW3', 600, 20) === '3/3/both' && sr('M', 1000, 30) === '6/6/both', [sr('DW1', 250), sr('DW3', 1000, 20)].join());
  check('Table 13.2: stair widths 1.0 house, 1.2 / 1.5 / 2.0 flats by height, 1.5 others', stairRule('DW1', 9).width === 1 && stairRule('DW3', 10).width === 1.2 && stairRule('DW3', 20).width === 1.5 && stairRule('DW3', 30).width === 2 && stairRule('M', 10).tread === 0.3);
  check('Table 6.44: house parking — none to 100 m², 1 to 300 m², then 1 more per 100 m² or part', [90, 150, 300, 301, 400, 401].map(housePark).join() === '0,1,1,2,2,3', [90, 150, 300, 301, 400, 401].map(housePark).join());

  // the sample: flats on a stilt floor
  const flats = pack(analyse(readFileSync(new URL('../samples/riverside-residency.dxf', import.meta.url), 'utf8')));
  const f1 = flats.an[1];
  const kit = f1.rooms.find((r) => r.type === 'kitchen');
  check('rooms: clear width is wall face to wall face (the 2.4 m kitchen)', kit && near(kit.width, 2.45, 0.12), kit && kit.width);
  const bedWin = f1.openings.filter((o) => o.kind === 'window' && (o.a === -1 || o.b === -1) && [o.a, o.b].some((v) => v >= 0 && f1.rooms[v].type === 'bedroom'));
  check('openings: windows found in the wall gaps, with the bedroom on one side and outside on the other', bedWin.length >= 4 && f1.openings.some((o) => o.kind === 'door' && o.w > 0.7 && o.w < 1.1), `${bedWin.length} bedroom windows`);
  check('stairs: the flight measured from its treads (1.5 m wide, 250 mm going)', flats.an.every((a) => a.stairs.length === 1 && near(a.stairs[0].width, 1.5, 0.05) && near(a.stairs[0].going, 0.25, 0.01)), flats.an.map((a) => a.stairs.map((s) => `${s.width}/${s.going}`).join()).join(' '));
  const P = { areas: { building: 'apartments', plot: 600 }, rules: { road: 12, margins: { road: 3, side: 2.5, rear: 3 } } };
  const res = checkBuilding(flats, ruleSetup(P), { areas: P.areas, heights: { floor: 3 } });
  const rule = (id) => res.groups.flatMap((g) => g.rules).find((r) => r.id === id);
  check('checks: flats are Dwelling-3; 4 storeys × 3 m = 12 m, within 30 m on a 12 m road', res.facts.use === 'DW3' && res.facts.height === 12 && rule('height-road').status === 'pass', `${res.facts.use} ${res.facts.height}`);
  check('checks: side margin 2.5 m < 3.0 m fails; the road-side 3.0 m passes', rule('margin-side').status === 'fail' && rule('margin-road').status === 'pass', `${rule('margin-side').status} ${rule('margin-road').status}`);
  check('checks: parking ≥ 20% of FSI area for flats (the stilt floor has it); a lift above 10 m (it has one)', rule('parking').status === 'pass' && rule('lift').status === 'pass' && /20%/.test(rule('parking').need), rule('parking').value);
  check('checks: stair 1.5 m ≥ 1.2 m for flats up to 12 m; the stilt 3.0 m is within 3.0–3.5 m', rule('stair-width').status === 'pass' && rule('hollow-plinth').status === 'pass', rule('stair-width').value);
  const small = rule('nbc-habitable').items.filter((i) => i.status === 'warn');
  check('NBC room sizes: the bedroom the planted toilet squeezed (L3) is the one that\'s too small', small.length === 1 && flats.floors[small[0].k].level === 3 && rule('nbc-habitable').status === 'warn', small.map((i) => `${i.name} ${i.value}`).join());
  check('checks: dining rooms with no window of their own are flagged (13.4.1(1)), as a warning — fans are allowed', rule('vent-open').status === 'warn' && rule('vent-open').items.filter((i) => i.status === 'warn').every((i) => /dining|bed/i.test(i.name)), rule('vent-open').value);
  const hot = checkBuilding(flats, ruleSetup({ ...P, rules: { ...P.rules, height: 26 } }), { areas: P.areas, heights: { floor: 2.8 } });
  const hr = (id) => hot.groups.flatMap((g) => g.rules).find((r) => r.id === id);
  check('checks: at 26 m, two lifts and a 2.0 m stair are needed; 2.8 m storeys are below 2.9 m', hr('lift').status === 'fail' && /2 lifts/.test(hr('lift').need) && hr('stair-width').status === 'fail' && hr('storey-height').status === 'fail' && hr('height-road').status === 'pass', `${hr('lift').need} · ${hr('stair-width').need}`);
  const need = checkBuilding(flats, ruleSetup({ areas: { building: 'apartments' } }), { areas: {}, heights: {} });
  const nr = (id) => need.groups.flatMap((g) => g.rules).find((r) => r.id === id);
  check('checks: without the road, plot and margins those rules ask for them instead of guessing', ['height-road', 'margin-road', 'margin-side', 'fsi'].every((id) => nr(id).status === 'need'), ['height-road', 'margin-road', 'margin-side', 'fsi'].map((id) => nr(id).status).join());
  const lines = checksCSV(res, { project: 'Riverside', rev: 'Rev A' }).split('\r\n');
  check('checks CSV: a row per rule with its clause, and the spaces that need a look', lines.some((l) => /"CGDCR III 13.1.13/.test(l)) && lines.some((l) => /"Habitable room size","Bed Room"/.test(l)), lines.length);

  // a house: the casa sheet
  const house = pack(analyse(casaSheet()));
  const hres = checkBuilding(house, ruleSetup({ areas: { building: 'house', plot: 250 }, rules: { road: 9, cars: 1 } }), { areas: { plot: 250 }, heights: {} });
  const h = (id) => hres.groups.flatMap((g) => g.rules).find((r) => r.id === id);
  check('house: Dwelling-1 — 1.0 m stair passes, no lift or entrance rule, one car for its plinth', hres.facts.use === 'DW1' && h('stair-width').status === 'pass' && h('lift').status === 'na' && h('entrance').status === 'na' && h('parking').status === 'pass', `${h('stair-width').value} · ${h('parking').need}`);
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
