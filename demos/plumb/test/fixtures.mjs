// Plumb — test drawings in a different drafting style from the sample, so the checks aren't
// tuned to one office's habits: metres ($INSUNITS 6), floors stacked vertically with MTEXT titles
// above them, walls as closed LWPOLYLINEs on a layer with a meaningless name ("L-01"), doors as
// a BLOCK inserted rotated and mirrored, hatched columns, multi-line MTEXT room tags with
// formatting codes, and the first floor drawn 350 mm / 200 mm off the ground floor's grid.
//
// Planted (single file): floating column on the 1st floor, a 2 m balcony over nothing, the
// 2nd-floor lift 200 mm east, a 2nd-floor bath over a bedroom, a 2nd-floor kitchen over the living.

import { Grid, allContours } from '../js/raster.js';

// ---------------------------------------------------------------------------- a modern-entity DXF writer
export class ModernDxf {
  constructor(insunits = 6) { this.insunits = insunits; this.layers = new Map([['0', 7]]); this.blocks = []; this.ents = []; }
  layer(n, c = 7) { if (!this.layers.has(n)) this.layers.set(n, c); return this; }
  block(name, ents) { this.blocks.push({ name, ents }); return this; }
  add(e) { this.ents.push(e); return this; }
  toString() {
    const o = [];
    const put = (pairs) => { for (const [c, v] of pairs) o.push(String(c), typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v)); };
    put([[0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1027'], [9, '$INSUNITS'], [70, this.insunits], [0, 'ENDSEC']]);
    put([[0, 'SECTION'], [2, 'TABLES'], [0, 'TABLE'], [2, 'LAYER'], [70, this.layers.size]]);
    for (const [n, c] of this.layers) put([[0, 'LAYER'], [2, n], [70, 0], [62, c], [6, 'CONTINUOUS']]);
    put([[0, 'ENDTAB'], [0, 'ENDSEC'], [0, 'SECTION'], [2, 'BLOCKS']]);
    for (const b of this.blocks) {
      put([[0, 'BLOCK'], [8, '0'], [2, b.name], [70, 0], [10, 0], [20, 0], [30, 0], [3, b.name]]);
      for (const e of b.ents) put(e);
      put([[0, 'ENDBLK'], [8, '0']]);
    }
    put([[0, 'ENDSEC'], [0, 'SECTION'], [2, 'ENTITIES']]);
    for (const e of this.ents) put(e);
    put([[0, 'ENDSEC'], [0, 'EOF']]);
    return o.join('\n') + '\n';
  }
}
export const LINE = (x1, y1, x2, y2, l) => [[0, 'LINE'], [8, l], [10, x1], [20, y1], [30, 0], [11, x2], [21, y2], [31, 0]];
export const LWPOLY = (pts, closed, l) => [[0, 'LWPOLYLINE'], [8, l], [90, pts.length], [70, closed ? 1 : 0], ...pts.flatMap((p) => [[10, p[0]], [20, p[1]]])];
export const ARC = (cx, cy, r, a0, a1, l) => [[0, 'ARC'], [8, l], [10, cx], [20, cy], [30, 0], [40, r], [50, a0], [51, a1]];
export const INSERT = (name, x, y, sx, sy, rot, l) => [[0, 'INSERT'], [8, l], [2, name], [10, x], [20, y], [30, 0], [41, sx], [42, sy], [43, 1], [50, rot]];
export const MTEXT = (x, y, h, text, l, attach = 5) => [[0, 'MTEXT'], [8, l], [10, x], [20, y], [30, 0], [40, h], [71, attach], [1, text]];
export const HATCH = (pts, l) => [[0, 'HATCH'], [8, l], [10, 0], [20, 0], [30, 0], [2, 'SOLID'], [70, 1], [71, 0], [91, 1], [92, 2], [72, 0], [73, 1], [93, pts.length], ...pts.flatMap((p) => [[10, p[0]], [20, p[1]]]), [97, 0], [75, 0], [76, 1], [98, 0]];
/** A DIMENSION with no *D block (some exporters write none): only definition points + measurement. */
export const DIM = (p1, p2, at, rot, value, l) => {
  const r = (rot * Math.PI) / 180, d = [Math.cos(r), Math.sin(r)];
  const t2 = (p2[0] - at[0]) * d[0] + (p2[1] - at[1]) * d[1];
  const f2 = [at[0] + d[0] * t2, at[1] + d[1] * t2];
  const t1 = (p1[0] - at[0]) * d[0] + (p1[1] - at[1]) * d[1];
  const mid = [at[0] + d[0] * (t1 + t2) / 2 - d[1] * 0.25, at[1] + d[1] * (t1 + t2) / 2 + d[0] * 0.25];
  return [[0, 'DIMENSION'], [8, l], [100, 'AcDbEntity'], [100, 'AcDbDimension'], [2, ''], [10, f2[0]], [20, f2[1]], [30, 0], [11, mid[0]], [21, mid[1]], [31, 0],
    [70, 0], [1, ''], [42, value], [100, 'AcDbAlignedDimension'], [13, p1[0]], [23, p1[1]], [33, 0], [14, p2[0]], [24, p2[1]], [34, 0], [50, rot], [100, 'AcDbRotatedDimension']];
};
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

// ---------------------------------------------------------------------------- Lakeview Court
const EXT = 0.25, INT = 0.12;
const GX = [0, 4.5, 9, 13.5, 18], GY = [0, 5.5, 11];

function plan(level) {
  const f = { walls: [], opens: [], doors: [], windows: [], tags: [], cols: [], ducts: [], lift: null, stair: null };
  const W = (x0, y0, x1, y1, t = INT) => f.walls.push({ x0, y0, x1, y1, t });
  // shell + core
  W(0, 0, 18, 0, EXT); W(18, 0, 18, 11, EXT); W(18, 11, 0, 11, EXT); W(0, 11, 0, 0, EXT);
  W(13.5, 0, 13.5, 11);                      // flat | core
  W(13.5, 5.5, 18, 5.5);                     // lobby | stair
  const lx = level === 2 ? 14.2 : 14;        // the 2nd-floor lift is drawn 200 mm east
  f.lift = [lx, 2.5, lx + 2, 4.7];
  W(lx, 2.5, lx + 2, 2.5); W(lx + 2, 2.5, lx + 2, 4.7); W(lx + 2, 4.7, lx, 4.7); W(lx, 4.7, lx, 2.5);
  f.stair = [13.5, 5.5, 18, 11];
  // flat
  W(0, 5.5, 13.5, 5.5);                      // day | night
  W(9, 0, 9, 5.5);                           // living/dining | kitchen block
  W(9, 3, 13.5, 3);                          // kitchen | utility + passage
  W(11, 3, 11, 5.5);                         // utility | passage
  W(4.5, 5.5, 4.5, 11);                      // master | dress/bath
  W(11, 5.5, 11, 11);                        // bedroom 2 | wc/study
  W(11, 8, 13.5, 8);                         // wc | study
  const bath = level === 2 ? [6.5, 8, 8.5, 11] : [4.5, 8, 6.5, 11];
  if (level === 2) { W(6.5, 5.5, 6.5, 11); W(8.5, 5.5, 8.5, 11); W(6.5, 8, 8.5, 8); W(4.5, 8, 6.5, 8, 0); }
  else { W(6.5, 5.5, 6.5, 11); W(4.5, 8, 6.5, 8); }
  // shaft by the bath (continues on every floor)
  f.ducts.push([4.6, 10.3, 5.2, 10.9]);
  W(4.6, 10.3, 5.2, 10.3); W(5.2, 10.3, 5.2, 10.9);
  // open-plan: living + dining in one space on G/1; on the 2nd floor a kitchen takes the west bay
  if (level === 2) W(4.5, 0, 4.5, 5.5);
  // openings without doors: the utility opens into the passage through an arch
  f.opens.push([11 - 0.2, 3.6, 11 + 0.2, 4.8]);
  // doors: hinge, wall ('h' runs along x, 'v' along y), swing side (+1 = +y / +x)
  const D = (x, y, wall, swing) => f.doors.push({ x, y, wall, swing });
  D(13.5, 3.8, 'v', -1);  // flat entrance, lobby → passage
  D(9, 0.8, 'v', -1);     // kitchen ↔ dining (2nd: dining ↔ living)
  D(9.6, 3, 'h', -1);     // utility ↔ kitchen (2nd: dining)
  D(11.5, 5.5, 'h', 1);   // passage → w.c.
  D(11, 8.8, 'v', 1);     // study
  D(1.5, 5.5, 'h', 1);    // master bed
  D(5.0, 5.5, 'h', 1);    // dress
  D(16.5, 5.5, 'h', 1);   // lobby → stair
  if (level === 2) { D(7.0, 8, 'h', 1); D(9.5, 5.5, 'h', 1); D(7.0, 5.5, 'h', 1); D(4.5, 1, 'v', 1); } // bath, bedroom 2, store, kitchen
  else { D(5.0, 8, 'h', 1); D(7.5, 5.5, 'h', 1); } // bath, bedroom 2
  // windows: [x0, y0, x1, y1] on the shell
  f.windows.push([1, 0, 3.5, 0], [5.5, 0, 8, 0], [10, 0, 12, 0], [0, 7, 0, 9.5], [1, 11, 3.5, 11], [8.8, 11, 10.6, 11], [18, 1, 18, 2]);
  // room tags (MTEXT, middle-centre, with formatting codes and a size line)
  const T = (name, x, y, size) => f.tags.push({ name, x, y, size });
  if (level === 2) {
    T('KITCHEN', 2.25, 2.75, '4.4 x 5.4'); T('LIVING', 6.75, 2.75, '4.4 x 5.4'); T('DINING', 11.25, 1.5);
  } else {
    T('LIVING', 2.5, 2.75, '9.0 x 5.4'); T('DINING', 7, 2.75); T('KITCHEN', 11.25, 1.5, '4.4 x 2.9');
  }
  T('UTILITY', 10, 4.25); T('PASSAGE', 12.25, 4.25); T('LOBBY', 15.75, 1.2); T('LIFT', lx + 1, 3.6); T('STAIR', 15.75, 8.25);
  T('MASTER BED', 2.25, 8.25, '4.4 x 5.4');
  T('T&B', (bath[0] + bath[2]) / 2, 9.2);
  if (level === 2) { T('DRESS', 5.5, 6.75); T('STORE', 7.5, 6.75); T('BEDROOM 2', 9.75, 8.25, '2.4 x 5.4'); }
  else { T('DRESS', 5.5, 6.75); T('BEDROOM 2', 8.75, 8.25, '4.4 x 5.4'); }
  T('W.C.', 12.25, 6.75); T('STUDY', 12.25, 9.5);
  // columns (the 1st floor has one at 4.5,5.5 that the ground floor doesn't — floating)
  for (const x of GX) for (const y of GY) {
    if (level === 0 && x === 4.5 && y === 5.5) continue;
    if (level > 0 || !(x === 4.5 && y === 5.5)) f.cols.push([x - 0.15, y - 0.225, x + 0.15, y + 0.225]);
  }
  if (level === 1) { f.balcony = [0.3, -2.0, 4.8, 0]; T('BALCONY', 2.55, -1, null); }
  return f;
}

function emit(dx, f, ox, oy, title) {
  // walls: union of wall rectangles minus openings, traced at 1 cm
  const R = 0.01;
  const g = new Grid(-1.5, -3, 19.5, 12.5, R);
  for (const w of f.walls) {
    if (!w.t) continue;
    const h = w.t / 2;
    g.poly(rect(Math.min(w.x0, w.x1) - h, Math.min(w.y0, w.y1) - h, Math.max(w.x0, w.x1) + h, Math.max(w.y0, w.y1) + h), 1);
  }
  if (f.balcony) { // parapet
    const [x0, y0, x1] = f.balcony;
    for (const r of [[x0, y0, x0 + 0.1, 0], [x1 - 0.1, y0, x1, 0], [x0, y0, x1, y0 + 0.1]]) g.poly(rect(...r), 1);
  }
  const cut = (x0, y0, x1, y1) => g.poly(rect(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)), 0);
  for (const o of f.opens) cut(...o);
  for (const d of f.doors) d.wall === 'v' ? cut(d.x - 0.2, d.y, d.x + 0.2, d.y + 0.9) : cut(d.x, d.y - 0.2, d.x + 0.9, d.y + 0.2);
  for (const w of f.windows) w[0] === w[2] ? cut(w[0] - 0.2, w[1], w[0] + 0.2, w[3]) : cut(w[0], w[1] - 0.2, w[2], w[1] + 0.2);
  for (const loop of allContours((k) => g.data[k] === 1, g.w, g.h, 0)) dx.add(LWPOLY(loop.map(([i, j]) => [ox + g.x0 + i * R, oy + g.y0 + j * R]), true, 'L-01'));
  // windows: three lines in the opening
  for (const w of f.windows) for (const o of [-0.12, 0, 0.12]) {
    if (w[0] === w[2]) dx.add(LINE(ox + w[0] + o, oy + w[1], ox + w[0] + o, oy + w[3], 'GLAZING'));
    else dx.add(LINE(ox + w[0], oy + w[1] + o, ox + w[2], oy + w[1] + o, 'GLAZING'));
  }
  // doors as block inserts (block: hinge at origin, closed along +x, opens towards +y)
  for (const d of f.doors) {
    if (d.wall === 'h') dx.add(INSERT('DR900', ox + d.x, oy + d.y, 1, d.swing, 0, 'DOORS'));
    else dx.add(INSERT('DR900', ox + d.x, oy + d.y, 1, -d.swing, 90, 'DOORS'));
  }
  // columns: outline + solid hatch
  for (const c of f.cols) { const p = rect(ox + c[0], oy + c[1], ox + c[2], oy + c[3]); dx.add(LWPOLY(p, true, 'COL')); dx.add(HATCH(p, 'COL')); }
  // shaft cross, lift cross, stair treads
  for (const d of f.ducts) { dx.add(LINE(ox + d[0] + 0.05, oy + d[1] + 0.05, ox + d[2] - 0.05, oy + d[3] - 0.05, 'SHAFT')); dx.add(LINE(ox + d[0] + 0.05, oy + d[3] - 0.05, ox + d[2] - 0.05, oy + d[1] + 0.05, 'SHAFT')); }
  const L = f.lift;
  dx.add(LINE(ox + L[0] + 0.15, oy + L[1] + 0.15, ox + L[2] - 0.15, oy + L[3] - 0.15, 'LIFT')).add(LINE(ox + L[0] + 0.15, oy + L[3] - 0.15, ox + L[2] - 0.15, oy + L[1] + 0.15, 'LIFT'));
  for (let y = 6.6; y <= 10.2; y += 0.28) { dx.add(LINE(ox + 13.8, oy + y, ox + 15.6, oy + y, 'STAIR')); dx.add(LINE(ox + 15.9, oy + y, ox + 17.7, oy + y, 'STAIR')); }
  // grid dimensions, block-less (rebuilt by Plumb from their definition points)
  for (let i = 0; i + 1 < GX.length; i++) dx.add(DIM([ox + GX[i], oy + 11], [ox + GX[i + 1], oy + 11], [ox, oy + 12], 0, GX[i + 1] - GX[i], 'DIMS'));
  for (let i = 0; i + 1 < GY.length; i++) dx.add(DIM([ox, oy + GY[i]], [ox, oy + GY[i + 1]], [ox - 1.2, oy], 90, GY[i + 1] - GY[i], 'DIMS'));
  // tags: "{\fArial|b1;NAME}\P4.4 x 5.4"
  for (const t of f.tags) dx.add(MTEXT(ox + t.x, oy + t.y, 0.2, `{\\fArial|b1|i0|c0|p34;${t.name}}${t.size ? `\\P${t.size}` : ''}`, 'ROOM-TAGS', 5));
  if (title) dx.add(MTEXT(ox, oy + 12.8, 0.5, title, 'TITLES', 7)).add(MTEXT(ox, oy + 12.2, 0.25, 'SCALE 1:100', 'TITLES', 7));
}

function base() {
  const dx = new ModernDxf(6);
  for (const [n, c] of [['L-01', 7], ['GLAZING', 4], ['DOORS', 3], ['COL', 1], ['SHAFT', 5], ['LIFT', 8], ['STAIR', 8], ['ROOM-TAGS', 2], ['TITLES', 7], ['DIMS', 6]]) dx.layer(n, c);
  dx.block('DR900', [LINE(0, 0, 0, 0.9, '0'), ARC(0, 0, 0.9, 0, 90, '0')]);
  return dx;
}

/** One DXF, three floors stacked in y, titles above; the 1st floor drawn off the grid. */
export function lakeviewSingle() {
  const dx = base();
  emit(dx, plan(0), 0, 0, 'GROUND FLOOR PLAN');
  emit(dx, plan(1), 0.35, 20.2, '1ST FLOOR PLAN');
  emit(dx, plan(2), 0, 40, '2ND FLOOR PLAN');
  return dx.toString();
}

/** One DXF per floor, levels only in the file names, each at its own origin. */
export function lakeviewFiles() {
  const origins = [[1000, 500], [0, 0], [-50, 30]];
  const names = ['ground.dxf', 'first-floor.dxf', 'L2.dxf'];
  return [0, 1, 2].map((lv) => { const dx = base(); emit(dx, plan(lv), ...origins[lv], null); return { name: names[lv], text: dx.toString() }; }).reverse();
}
