// Plumb — turn an analysis into what the page draws (small, transferable, no parser state).

import { floorDims, dimChecks } from './dims.js';

/** Only what the page needs (the parsed entity lists are large; keep the metric ones). */
export function pack(r, { sheet = false } = {}) {
  const dims = floorDims(r.dx, r.roles, r.floors.map((f) => f.box), r.unit.mm);
  return {
    unit: r.unit,
    dimChecks: dimChecks(r.dx, r.unit.mm),
    ms: r.ms,
    bounds: r.dx.bounds,
    layers: [...r.dx.layers.values()].map((l) => {
      const ro = r.roles.get(l.name) || {};
      return { ...l, role: ro.role || 'other', auto: ro.auto !== false, autoRole: ro.autoRole || ro.role || 'other', stats: ro.stats };
    }),
    floors: r.floors,
    transforms: r.transforms,
    aligns: r.aligns,
    issues: r.issues,
    geometry: r.floors.map((f, k) => ({ ...floorGeometry(r.dx, r.roles, f.box, r.an[k] && r.an[k].margin), dims: dims[k] })),
    an: r.an.map((a) => ({
      box: a.box, res: a.res, margin: a.margin, grid: a.grid, rooms: a.rooms, columns: a.columns, doors: a.doors, openings: a.openings, stairs: a.stairs, outlines: a.outlines,
      footprintArea: a.footprintArea, roomAt: a.roomAt, inside: a.inside, walls: a.walls, patternArea: a.patternArea,
    })),
    ...(sheet ? { sheet: sheetOf(r.dx, r.roles) } : {}),
  };
}

const SHEET_WEIGHT = { wall: 3, column: 3, window: 2, door: 2, outline: 2, stair: 1, lift: 1, duct: 1, furniture: 0, hatch: 0, other: 0 };
const SHEET_CAP = 150000;

/**
 * The whole sheet, thinned, for marking floors by hand: lines relative to the sheet's corner (so
 * Float32 stays precise however far from the origin the drawing sits), how much each line matters
 * (walls most, furniture least), and the bigger texts (titles, room names).
 */
export function sheetOf(dx, roles) {
  const b = dx.bounds, W = b.x1 - b.x0, H = b.y1 - b.y0, span = Math.max(W, H) || 1;
  const roleOf = (l) => (roles.get(l) || { role: 'other' }).role;
  const tiny = span / 5000;
  const keep = [];
  for (const s of dx.segs) {
    const w = SHEET_WEIGHT[roleOf(s[4])];
    if (w === undefined || Math.abs(s[2] - s[0]) + Math.abs(s[3] - s[1]) < tiny) continue; // text, dimensions, grid, specks
    keep.push([s, w]);
  }
  let list = keep;
  if (list.length > SHEET_CAP) list = list.filter(([, w]) => w > 0);               // a huge sheet: drop furniture first
  if (list.length > SHEET_CAP) { const n = Math.ceil(list.length / SHEET_CAP); list = list.filter((_, i) => i % n === 0); }
  const segs = new Float32Array(list.length * 4), weight = new Uint8Array(list.length);
  list.forEach(([s, w], i) => { segs.set([s[0] - b.x0, s[1] - b.y0, s[2] - b.x0, s[3] - b.y0], i * 4); weight[i] = w; });
  const texts = dx.texts
    .filter((t) => roleOf(t.layer) !== 'dim' && t.h >= span / 600 && String(t.text).trim())
    .sort((p, q) => q.h - p.h).slice(0, 800)
    .map((t) => ({ x: t.x - b.x0, y: t.y - b.y0, h: t.h, rot: t.rot || 0, text: String(t.text).split('\n')[0].slice(0, 60) }));
  return { x0: b.x0, y0: b.y0, w: W, h: H, segs, weight, texts };
}

/** Line work of one floor, grouped by role, as flat Float64Arrays [x1,y1,x2,y2,…] (fast to draw). */
function floorGeometry(dx, roles, box, margin) {
  const [x0, y0, x1, y1] = box;
  const m = margin ?? 1.2;
  const inb = (x, y) => x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m;
  const groups = {};
  const roleOf = (layer) => (roles.get(layer) || { role: 'other' }).role;
  for (const s of dx.segs) {
    if (!inb(s[0], s[1]) && !inb(s[2], s[3])) continue;
    (groups[roleOf(s[4])] ||= []).push(s[0], s[1], s[2], s[3]);
  }
  // (arcs and circles are already in segs as short chords — the parser tessellates them)
  const fills = dx.fills.filter((f) => f.pts.some((p) => inb(p[0], p[1]))).map((f) => ({ pts: f.pts, role: (roles.get(f.layer) || { role: 'other' }).role, solid: f.solid }));
  const texts = dx.texts.filter((t) => inb(t.x, t.y)).map((t) => ({ x: t.x, y: t.y, h: t.h, rot: t.rot, text: t.text, role: (roles.get(t.layer) || { role: 'other' }).role }));
  const out = { lines: {}, fills, texts };
  for (const [k, v] of Object.entries(groups)) out.lines[k] = new Float64Array(v);
  return out;
}
