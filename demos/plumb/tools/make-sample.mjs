// Generates samples/riverside-residency.dxf — a G+3 residential building drawn the way
// architects draw it: every floor plan side by side in model space, walls as clean double
// lines, hatched columns, door swings, windows, room names with sizes, a title under each
// plan. Several coordination problems are planted on purpose (see PLANTED below).
//
//   node demos/plumb/tools/make-sample.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { DxfWriter } from '../js/dxfwrite.js';
import { Grid, allContours } from '../js/raster.js';

const OUT = new URL('../samples/riverside-residency.dxf', import.meta.url);
const EXT = 230, INT = 115; // wall thicknesses (mm): brick external / half-brick internal
const PLATE_W = 21000, PLATE_H = 12000, MID = PLATE_W / 2;

// ---------------------------------------------------------------------------
// One apartment (west unit, local coords = building coords). Walls are centre-lines.

function westUnit(v) {
  const walls = [], opens = [], doors = [], windows = [], labels = [], ducts = [], furn = [];
  const W = (x0, y0, x1, y1, t = INT) => walls.push({ x0, y0, x1, y1, t });
  // internal partitions
  W(0, 4800, 8700, 4800);            // living row | middle row
  W(0, 8400, 8700, 8400);            // middle row | bedroom row
  W(2700, 4800, 2700, 8400);         // kitchen | dining
  W(6300, 4800, 6300, 12000);        // dining/passage | toilet 2/store/bedroom 2
  W(3900, 8400, 3900, 12000);        // bedroom 1 | passage/toilet 1
  W(3900, 9600, 6300, 9600);         // passage | toilet 1
  W(6300, 6000, 8700, 6000);         // store | toilet 2
  W(5400, 0, 5400, 4800);            // living | foyer (mostly open)
  // ducts (enclosed plumbing shafts) — the second floor's duct 1 is shifted 300 mm west
  const d1x = v.duct1Shift || 0;
  ducts.push({ x0: 5700 + d1x, y0: 11400, x1: 6300 + d1x, y1: 12000, name: 'DUCT' });
  ducts.push({ x0: 7800, y0: 7800, x1: 8700, y1: 8400, name: 'DUCT' });
  for (const d of ducts) {
    W(d.x0, d.y0, d.x1, d.y0); W(d.x0, d.y0, d.x0, d.y1); W(d.x1, d.y0, d.x1, d.y1); W(d.x0, d.y1, d.x1, d.y1);
  }
  // openings (cut through walls): [x0,y0,x1,y1]
  opens.push([5400 - 200, 1200, 5400 + 200, 3800]);   // living ↔ foyer
  opens.push([3000, 4800 - 200, 6000, 4800 + 200]);   // living ↔ dining
  opens.push([2700 - 200, 5400, 2700 + 200, 6300]);   // kitchen ↔ dining
  opens.push([4200, 8400 - 200, 6000, 8400 + 200]);   // dining ↔ passage
  // doors: hinge point, width, wall orientation ('v' wall along y, 'h' along x), swing side
  doors.push({ x: 3900, y: 8700, w: 850, wall: 'v', open: -1, dir: 1 });  // bedroom 1
  doors.push({ x: 4200, y: 9600, w: 750, wall: 'h', open: 1, dir: 1 });   // toilet 1
  doors.push({ x: 6300, y: 8700, w: 850, wall: 'v', open: 1, dir: 1 });   // bedroom 2
  doors.push({ x: 6300, y: 6600, w: 750, wall: 'v', open: 1, dir: 1 });   // toilet 2
  doors.push({ x: 7600, y: 4800, w: 750, wall: 'h', open: 1, dir: 1 });   // store
  doors.push({ x: 8700, y: 2000, w: 1000, wall: 'v', open: -1, dir: 1 }); // main door (from lobby)
  // windows on external walls: [x0,y0,x1,y1] along the wall centre-line
  windows.push([0, 1200, 0, 3600], [0, 6000, 0, 7200], [0, 9600, 0, 11100]);
  windows.push([1200, 12000, 2700, 12000], [4500, 12000, 5100, 12000], [7200, 12000, 8400, 12000]);
  windows.push([1500, 0, 4500, 0]); // living → balcony (sliding door drawn as a window)
  // balcony (cantilevered slab + parapet)
  const bd = v.balconyDepth || 1500;
  const balcony = { x0: 600, y0: -bd, x1: 5100, y1: 0 };
  // labels: [name, x0, y0, x1, y1]
  const L = (name, x0, y0, x1, y1) => labels.push({ name, x0, y0, x1, y1 });
  L('LIVING', 0, 0, 5400, 4800);
  L('FOYER', 5400, 0, 8700, 4800);
  L('KITCHEN', 0, 4800, 2700, 8400);
  L('DINING', 2700, 4800, 6300, 8400);
  L('TOILET', 6300, 6000, 8700, 8400);
  L('STORE', 6300, 4800, 8700, 6000);
  L('BED ROOM', 0, 8400, 3900, 12000);
  L('PASSAGE', 3900, 8400, 6300, 9600);
  L('TOILET', 3900, 9600, 6300, 12000);
  L('BED ROOM', 6300, 8400, 8700, 12000);
  L('BALCONY', balcony.x0, balcony.y0, balcony.x1, balcony.y1);
  // a toilet squeezed into bedroom 2 (the planted wet-over-dry problem on the top floor)
  if (v.extraToilet) {
    W(6300, 10200, 8100, 10200); W(8100, 10200, 8100, 12000);
    doors.push({ x: 6600, y: 10200, w: 700, wall: 'h', open: -1, dir: 1 });
    labels.pop(); labels.pop();
    L('BED ROOM', 6300, 8400, 8700, 10200);
    L('TOILET', 6300, 10200, 8100, 12000);
    L('BALCONY', balcony.x0, balcony.y0, balcony.x1, balcony.y1);
  }
  // furniture (for realism; not walls)
  furn.push(['rect', 600, 9000, 2400, 11100], ['rect', 800, 10700, 2200, 11000]);   // bed + pillows
  furn.push(['rect', 6700, 9000, 8300, 11100]);                                    // bed 2
  furn.push(['rect', 600, 600, 3000, 1500], ['rect', 600, 1500, 1500, 3300]);      // sofa L
  furn.push(['rect', 3600, 6000, 5400, 7200]);                                     // dining table
  furn.push(['rect', 300, 5100, 900, 8100]);                                       // kitchen counter
  return { walls, opens, doors, windows, labels, ducts, furn, balcony };
}

function mirror(u) {
  const mx = (x) => PLATE_W - x;
  const box = (b) => ({ ...b, x0: mx(b.x1), x1: mx(b.x0) });
  return {
    walls: u.walls.map((w) => ({ ...w, x0: mx(w.x1), x1: mx(w.x0), y0: w.y0, y1: w.y1 })),
    opens: u.opens.map((o) => [mx(o[2]), o[1], mx(o[0]), o[3]]),
    doors: u.doors.map((d) => ({ ...d, x: mx(d.x), w: d.w, mirrored: true })),
    windows: u.windows.map((w) => [mx(w[2]), w[1], mx(w[0]), w[3]]),
    labels: u.labels.map(box),
    ducts: u.ducts.map(box),
    furn: u.furn.map((f) => [f[0], mx(f[3]), f[2], mx(f[1]), f[4]]),
    balcony: box(u.balcony),
  };
}

// ---------------------------------------------------------------------------
// A floor = two units + the core + external walls + columns

const COLS_X = [0, 2700, 6300, 8700, 12300, 14700, 18300, 21000];
const COLS_Y = [0, 4800, 8400, 12000];

function floor(level) {
  const upper = level >= 1;
  const west = westUnit({ duct1Shift: level === 2 ? -300 : 0, balconyDepth: level === 3 ? 2100 : 1500 });
  const east = mirror(westUnit({ extraToilet: level === 3 }));
  const units = upper ? [west, east] : [];
  const walls = [], opens = [], doors = [], windows = [], labels = [], ducts = [], furn = [], extras = [];
  for (const u of units) {
    walls.push(...u.walls); opens.push(...u.opens); doors.push(...u.doors); windows.push(...u.windows);
    labels.push(...u.labels); ducts.push(...u.ducts); furn.push(...u.furn);
  }
  const W = (x0, y0, x1, y1, t) => walls.push({ x0, y0, x1, y1, t });
  // core: stair + lift + lobby (the same on every floor)
  W(8700, 0, 8700, 12000, EXT); W(12300, 0, 12300, 12000, EXT);
  W(8700, 7200, 12300, 7200, INT);                                  // lobby | stair
  W(9600, 5100, 11400, 5100, EXT); W(9600, 6900, 11400, 6900, EXT); // lift box
  W(9600, 5100, 9600, 6900, EXT); W(11400, 5100, 11400, 6900, EXT);
  opens.push([9000, 7200 - 200, 12000, 7200 + 200]);               // lobby ↔ stair (open)
  opens.push([10050, 5100 - 200, 10950, 5100 + 200]);              // lift door
  labels.push({ name: 'STAIRCASE', x0: 8700, y0: 7200, x1: 12300, y1: 12000 });
  labels.push({ name: 'LIFT', x0: 9600, y0: 5100, x1: 11400, y1: 6900 });
  labels.push({ name: 'LOBBY', x0: 8700, y0: 0, x1: 12300, y1: 5100 });
  if (upper) {
    // external walls around the plate
    W(0, 0, PLATE_W, 0, EXT); W(0, PLATE_H, PLATE_W, PLATE_H, EXT);
    W(0, 0, 0, PLATE_H, EXT); W(PLATE_W, 0, PLATE_W, PLATE_H, EXT);
    // balconies: parapet walls (thin) around each slab edge
    for (const u of units) {
      const b = u.balcony;
      W(b.x0, b.y0, b.x1, b.y0, 150); W(b.x0, b.y0, b.x0, 0, 150); W(b.x1, b.y0, b.x1, 0, 150);
    }
    windows.push([9900, 0, 11100, 0]); // lobby window
  } else {
    // stilt floor: open parking, ducts continue down, a guard room and an electrical room
    W(8700, 0, 12300, 0, EXT); W(8700, PLATE_H, 12300, PLATE_H, EXT);
    opens.push([9900, -200, 11100, 200]); // lobby entrance
    for (const d of westUnit({}).ducts.concat(mirror(westUnit({})).ducts)) {
      ducts.push(d);
      W(d.x0, d.y0, d.x1, d.y0, INT); W(d.x0, d.y0, d.x0, d.y1, INT); W(d.x1, d.y0, d.x1, d.y1, INT); W(d.x0, d.y1, d.x1, d.y1, INT);
    }
    W(0, 9600, 2700, 9600, INT); W(2700, 9600, 2700, 12000, INT); W(0, 9600, 0, 12000, EXT); W(0, 12000, 2700, 12000, EXT);
    doors.push({ x: 2700, y: 9900, w: 800, wall: 'v', open: 1, dir: 1 });
    labels.push({ name: 'GUARD ROOM', x0: 0, y0: 9600, x1: 2700, y1: 12000 });
    W(18300, 9600, 21000, 9600, INT); W(18300, 9600, 18300, 12000, INT); W(21000, 9600, 21000, 12000, EXT); W(18300, 12000, 21000, 12000, EXT);
    doors.push({ x: 18300, y: 9900, w: 800, wall: 'v', open: -1, dir: 1 });
    labels.push({ name: 'ELECTRICAL ROOM', x0: 18300, y0: 9600, x1: 21000, y1: 12000 });
    labels.push({ name: 'PARKING', x0: 0, y0: 0, x1: 8700, y1: 9600 });
    labels.push({ name: 'PARKING', x0: 12300, y0: 0, x1: 21000, y1: 9600 });
    // parking stalls
    for (const x of [300, 2800, 5300, 13000, 15500, 18000]) extras.push(['stall', x, 700, x + 2500, 5700]);
    // outline of the slab above
    extras.push(['outline', 0, 0, PLATE_W, PLATE_H]);
  }
  // columns (230 × 450) — the stilt floor drops one to make a parking bay wider,
  // and the second floor has one column nudged 150 mm off the grid
  const columns = [];
  for (const x of COLS_X) for (const y of COLS_Y) {
    if (level === 0 && x === 2700 && y === 4800) continue; // PLANTED: floating column above
    let cx = x, cy = y;
    if (level === 2 && x === 6300 && y === 12000) cx += 150; // PLANTED: offset column
    const alongX = y === 0 || y === PLATE_H;
    columns.push(alongX ? [cx - 225, cy - 115, cx + 225, cy + 115] : [cx - 115, cy - 225, cx + 115, cy + 225]);
  }
  return { walls, opens, doors, windows, labels, ducts, furn, columns, extras, level };
}

// ---------------------------------------------------------------------------
// Emit a floor into the DXF at offset (ox, oy)

function emitFloor(dw, fl, ox, oy, title) {
  // clean wall outlines: rasterise the wall union at 10 mm, cut openings, trace every loop
  const R = 10, pad = 3000;
  const g = new Grid(-pad, -pad - 2500, PLATE_W + pad, PLATE_H + pad, R);
  for (const w of fl.walls) {
    const h = w.t / 2;
    const x0 = Math.min(w.x0, w.x1) - h, x1 = Math.max(w.x0, w.x1) + h, y0 = Math.min(w.y0, w.y1) - h, y1 = Math.max(w.y0, w.y1) + h;
    g.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 1);
  }
  const cut = (x0, y0, x1, y1) => g.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 0);
  for (const o of fl.opens) cut(Math.min(o[0], o[2]), Math.min(o[1], o[3]), Math.max(o[0], o[2]), Math.max(o[1], o[3]));
  // door openings
  for (const d of fl.doors) {
    const span = d.mirrored ? [d.x - d.w, d.x] : [d.x, d.x + d.w];
    if (d.wall === 'v') cut(d.x - 200, d.y, d.x + 200, d.y + d.w);
    else cut(Math.min(...span), d.y - 200, Math.max(...span), d.y + 200);
  }
  // window openings
  for (const w of fl.windows) {
    if (w[0] === w[2]) cut(w[0] - 200, Math.min(w[1], w[3]), w[0] + 200, Math.max(w[1], w[3]));
    else cut(Math.min(w[0], w[2]), w[1] - 200, Math.max(w[0], w[2]), w[1] + 200);
  }
  const loops = allContours((k) => g.data[k] === 1, g.w, g.h, 0);
  for (const loop of loops) {
    dw.poly(loop.map(([i, j]) => [ox + g.x0 + i * R, oy + g.y0 + j * R]), true, 'A-WALL');
  }
  // windows: frame lines + glass
  for (const w of fl.windows) {
    const vert = w[0] === w[2];
    const t = (w[1] === 0 || w[1] === PLATE_H || w[0] === 0 || w[0] === PLATE_W || (vert && (w[0] === 0 || w[0] === PLATE_W))) ? EXT : INT;
    const a = vert ? Math.min(w[1], w[3]) : Math.min(w[0], w[2]), b = vert ? Math.max(w[1], w[3]) : Math.max(w[0], w[2]);
    for (const off of [-t / 2, -25, 25, t / 2]) {
      if (vert) dw.line(ox + w[0] + off, oy + a, ox + w[0] + off, oy + b, 'A-GLAZ');
      else dw.line(ox + a, oy + w[1] + off, ox + b, oy + w[1] + off, 'A-GLAZ');
    }
  }
  // doors: leaf + swing arc (hinge at the opening edge)
  for (const d of fl.doors) {
    const s = d.mirrored ? -1 : 1;
    if (d.wall === 'v') {
      // opening from (x, y) to (x, y + w); leaf swings into +x (open=1) or -x
      const dirX = d.open * (d.mirrored ? -1 : 1);
      const hx = ox + d.x, hy = oy + d.y;
      dw.line(hx, hy, hx + dirX * d.w, hy, 'A-DOOR');
      const a0 = dirX > 0 ? 0 : 90, a1 = dirX > 0 ? 90 : 180;
      dw.arc(hx, hy, d.w, a0, a1, 'A-DOOR');
    } else {
      const hx = ox + d.x, hy = oy + d.y;
      const dirY = d.open;
      const along = s; // mirrored doors run towards -x
      dw.line(hx, hy, hx, hy + dirY * d.w, 'A-DOOR');
      // arc from the leaf (vertical) to the closed position along the wall
      let a0, a1;
      if (along > 0) { a0 = dirY > 0 ? 0 : 270; a1 = dirY > 0 ? 90 : 360; }
      else { a0 = dirY > 0 ? 90 : 180; a1 = dirY > 0 ? 180 : 270; }
      dw.arc(hx, hy, d.w, a0, a1, 'A-DOOR');
    }
  }
  // columns: hatched solid + outline
  for (const c of fl.columns) {
    dw.solidRect(ox + c[0], oy + c[1], ox + c[2], oy + c[3], 'S-COLS');
    dw.rect(ox + c[0], oy + c[1], ox + c[2], oy + c[3], 'S-COLS');
  }
  // ducts: diagonal cross (the usual symbol)
  for (const d of fl.ducts) {
    dw.line(ox + d.x0 + 60, oy + d.y0 + 60, ox + d.x1 - 60, oy + d.y1 - 60, 'P-DUCT');
    dw.line(ox + d.x0 + 60, oy + d.y1 - 60, ox + d.x1 - 60, oy + d.y0 + 60, 'P-DUCT');
  }
  // stair treads + break line
  const st = { x0: 8700, x1: 12300, y0: 7200, y1: 12000 };
  for (let y = 8400; y <= 11400; y += 250) {
    dw.line(ox + st.x0 + 250, oy + y, ox + (st.x0 + st.x1) / 2 - 50, oy + y, 'A-STRS');
    dw.line(ox + (st.x0 + st.x1) / 2 + 50, oy + y, ox + st.x1 - 250, oy + y, 'A-STRS');
  }
  dw.line(ox + (st.x0 + st.x1) / 2 - 50, oy + 8400, ox + (st.x0 + st.x1) / 2 - 50, oy + 11400, 'A-STRS');
  dw.line(ox + (st.x0 + st.x1) / 2 + 50, oy + 8400, ox + (st.x0 + st.x1) / 2 + 50, oy + 11400, 'A-STRS');
  // lift car cross
  dw.line(ox + 9800, oy + 5300, ox + 11200, oy + 6700, 'A-LIFT');
  dw.line(ox + 9800, oy + 6700, ox + 11200, oy + 5300, 'A-LIFT');
  // furniture
  for (const f of fl.furn) if (f[0] === 'rect') dw.rect(ox + f[1], oy + f[2], ox + f[3], oy + f[4], 'A-FURN');
  // extras
  for (const e of fl.extras) {
    if (e[0] === 'stall') dw.rect(ox + e[1], oy + e[2], ox + e[3], oy + e[4], 'A-PRKG');
    if (e[0] === 'outline') dw.rect(ox + e[1], oy + e[2], ox + e[3], oy + e[4], 'A-SLAB-ABOVE');
  }
  // room names + sizes (feet-inches, as is common on Indian drawings)
  for (const l of fl.labels) {
    const cx = ox + (l.x0 + l.x1) / 2, cy = oy + (l.y0 + l.y1) / 2;
    const small = (l.x1 - l.x0) < 1500 || (l.y1 - l.y0) < 1500;
    dw.text(cx, cy + (small ? 0 : 130), small ? 150 : 200, l.name, 'A-ANNO-ROOM', 'middle');
    if (!small && !/PARKING|LOBBY|STAIR|BALCONY/.test(l.name)) {
      dw.text(cx, cy - 170, 150, `${ftin(l.x1 - l.x0 - INT)} X ${ftin(l.y1 - l.y0 - INT)}`, 'A-ANNO-ROOM', 'middle');
    }
  }
  // overall dimensions (lines + text on a dim layer)
  dw.line(ox, oy - 3000, ox + PLATE_W, oy - 3000, 'A-DIMS');
  for (const x of [0, PLATE_W]) dw.line(ox + x, oy - 3200, ox + x, oy - 2800, 'A-DIMS');
  dw.text(ox + PLATE_W / 2, oy - 2850, 180, `${PLATE_W}`, 'A-DIMS', 'center');
  dw.line(ox - 1500, oy, ox - 1500, oy + PLATE_H, 'A-DIMS');
  dw.text(ox - 1650, oy + PLATE_H / 2, 180, `${PLATE_H}`, 'A-DIMS', 'center', 90);
  // title under the plan
  dw.text(ox + PLATE_W / 2, oy - 4700, 450, title, 'A-ANNO-TTLB', 'center');
  dw.text(ox + PLATE_W / 2, oy - 5400, 250, 'SCALE 1:100', 'A-ANNO-TTLB', 'center');
}

function ftin(mm) {
  const inches = Math.round(mm / 25.4);
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

// ---------------------------------------------------------------------------

const dw = new DxfWriter();
for (const [name, color] of [['A-WALL', 7], ['A-GLAZ', 4], ['A-DOOR', 3], ['S-COLS', 1], ['P-DUCT', 5], ['A-STRS', 8], ['A-LIFT', 8], ['A-FURN', 9], ['A-PRKG', 8], ['A-SLAB-ABOVE', 8], ['A-ANNO-ROOM', 2], ['A-DIMS', 6], ['A-ANNO-TTLB', 7]]) dw.layer(name, color);
const TITLES = ['STILT FLOOR PLAN', 'FIRST FLOOR PLAN', 'SECOND FLOOR PLAN', 'THIRD FLOOR PLAN'];
const GAP = 33000;
for (let level = 0; level < 4; level++) emitFloor(dw, floor(level), level * GAP, 0, TITLES[level]);
// a title block frame far to the right (not a floor plan — should be ignored)
const tbx = 4 * GAP;
dw.rect(tbx, -6000, tbx + 12000, 14000, 'A-ANNO-TTLB');
dw.text(tbx + 600, 12800, 400, 'RIVERSIDE RESIDENCY', 'A-ANNO-TTLB');
dw.text(tbx + 600, 12100, 250, 'PROPOSED G+3 RESIDENTIAL BUILDING', 'A-ANNO-TTLB');
dw.text(tbx + 600, 11500, 250, 'FLOOR PLANS — FOR COORDINATION', 'A-ANNO-TTLB');
dw.text(tbx + 600, 10900, 200, 'DRG. NO. A-101   REV. B', 'A-ANNO-TTLB');

mkdirSync(new URL('../samples/', import.meta.url), { recursive: true });
writeFileSync(OUT, dw.toString());
console.log('wrote', OUT.pathname, (dw.toString().length / 1024).toFixed(0) + ' KB');

// PLANTED problems (what Plumb should find):
//  1. Floating column: grid (2700, 4800) exists on floors 1–3 but not on the stilt floor.
//  2. Offset column: grid (6300, 12000) on the second floor is 150 mm off the first floor's.
//  3. Shaft misaligned: the west unit's toilet duct on the second floor is 300 mm west.
//  4. Wet over dry: a toilet added inside the east unit's bedroom 2 on the third floor sits
//     above the second floor's bedroom 2.
//  5. Cantilevers: 1.5 m balconies over the stilt floor; the third floor's west balcony is 2.1 m.
