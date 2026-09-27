// Plumb — turn an analysis into what the page draws (small, transferable, no parser state).

import { floorDims } from './dims.js';

/** Only what the page needs (the parsed entity lists are large; keep the metric ones). */
export function pack(r) {
  const dims = floorDims(r.dx, r.roles, r.floors.map((f) => f.box), r.unit.mm);
  return {
    unit: r.unit,
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
    geometry: r.floors.map((f, k) => ({ ...floorGeometry(r.dx, r.roles, f.box), dims: dims[k] })),
    an: r.an.map((a) => ({
      box: a.box, res: a.res, grid: a.grid, rooms: a.rooms, columns: a.columns, doors: a.doors, outlines: a.outlines,
      footprintArea: a.footprintArea, roomAt: a.roomAt, inside: a.inside,
    })),
  };
}

/** Line work of one floor, grouped by role, as flat Float64Arrays [x1,y1,x2,y2,…] (fast to draw). */
function floorGeometry(dx, roles, box) {
  const [x0, y0, x1, y1] = box;
  const m = 1.2;
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
