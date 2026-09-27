// Plumb — understanding a drawing: units, layer roles, floors (islands + titles), and per
// floor: rooms (with names and types), columns, ducts, cores and the footprint.

import { Grid, label, distanceTransform, allContours, polyArea } from './raster.js';

// ---------------------------------------------------------------------------
// Units

/** Millimetres per drawing unit: from $INSUNITS, else guessed from door swings and plan size. */
export function inferUnitMM(dxf) {
  if (dxf.unitMM) return { mm: dxf.unitMM, source: 'header' };
  const radii = dxf.arcs.filter((a) => {
    let sw = a.a1 - a.a0;
    while (sw < 0) sw += Math.PI * 2;
    return sw > 1.2 && sw < 1.95;
  }).map((a) => a.r).sort((p, q) => p - q);
  if (radii.length >= 3) {
    const med = radii[Math.floor(radii.length / 2)];
    // a door leaf is ~0.7–1.0 m
    const cands = [[1, 'mm'], [10, 'cm'], [1000, 'm'], [25.4, 'in'], [304.8, 'ft']];
    let best = cands[0], bestErr = Infinity;
    for (const c of cands) {
      const m = (med * c[0]) / 1000;
      const err = Math.abs(Math.log(m / 0.85));
      if (err < bestErr) { bestErr = err; best = c; }
    }
    if (bestErr < 0.6) return { mm: best[0], source: `door swings (${best[1]})` };
  }
  // fall back to overall size: a plan set is typically 10–300 m across
  const b = dxf.bounds, span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  if (span > 5000) return { mm: 1, source: 'drawing size (mm)' };
  if (span > 500) return { mm: 10, source: 'drawing size (cm)' };
  return { mm: 1000, source: 'drawing size (m)' };
}

/** Scale the parsed drawing to metres (new object; the original is left alone). */
export function toMetres(dxf, mm) {
  const k = mm / 1000;
  const S = (v) => v * k;
  return {
    ...dxf,
    k,
    segs: dxf.segs.map((s) => [S(s[0]), S(s[1]), S(s[2]), S(s[3]), s[4]]),
    arcs: dxf.arcs.map((a) => ({ ...a, cx: S(a.cx), cy: S(a.cy), r: S(a.r) })),
    circles: dxf.circles.map((c) => ({ ...c, cx: S(c.cx), cy: S(c.cy), r: S(c.r) })),
    texts: dxf.texts.map((t) => ({ ...t, x: S(t.x), y: S(t.y), h: S(t.h) })),
    fills: dxf.fills.map((f) => ({ ...f, pts: f.pts.map((p) => [S(p[0]), S(p[1])]) })),
    inserts: dxf.inserts.map((i) => ({ ...i, x: S(i.x), y: S(i.y) })),
    dims: (dxf.dims || []).map((d) => {
      const P = (q) => (q ? [S(q[0]), S(q[1])] : null);
      return { ...d, p10: P(d.p10), p11: P(d.p11), p13: P(d.p13), p14: P(d.p14), p15: P(d.p15), p16: P(d.p16), mm };
    }),
    dimSegs: (dxf.dimSegs || []).map((s) => [S(s[0]), S(s[1]), S(s[2]), S(s[3]), s[4]]),
    dimTexts: (dxf.dimTexts || []).map((t) => ({ ...t, x: S(t.x), y: S(t.y), h: S(t.h) })),
    dimFills: (dxf.dimFills || []).map((f) => ({ ...f, pts: f.pts.map((p) => [S(p[0]), S(p[1])]) })),
    bounds: { x0: S(dxf.bounds.x0), y0: S(dxf.bounds.y0), x1: S(dxf.bounds.x1), y1: S(dxf.bounds.y1) },
  };
}

// ---------------------------------------------------------------------------
// Layer roles

export const ROLES = ['wall', 'column', 'door', 'window', 'outline', 'stair', 'lift', 'duct', 'furniture', 'text', 'dim', 'hatch', 'grid', 'other'];
export const BOUNDARY_ROLES = new Set(['wall', 'column', 'window', 'outline']);

const NAME_RULES = [
  ['column', /(^|[^a-z])(s-col|col|cols|column|columns|pillar|pier|stanchion)([^a-z]|$)/i],
  ['wall', /(wall|wand|mur|brick|masonry|partition|block ?work|a-wall|^w$)/i],
  ['door', /(door|dr|shutter|a-door|gate)/i],
  ['window', /(window|win|glaz|glass|vent|ventilator|a-glaz|curtain)/i],
  ['outline', /(slab|outline|above|plinth|footprint|balcony edge|chajja|projection|bldg|building line)/i],
  ['stair', /(stair|strs|step|tread|ramp)/i],
  ['lift', /(lift|elev|elevator)/i],
  ['duct', /(duct|shaft|p-|plumb|ots|drain|sanitary|san-)/i],
  ['furniture', /(furn|furniture|fixture|sofa|bed|kitchen eq|equip|fitting|cars?$|prkg|parking|tree|plant|landscape)/i],
  ['dim', /(dim|dimension)/i],
  ['text', /(text|txt|anno|name|label|title|ttlb|note|room)/i],
  ['hatch', /(hatch|patt|fill|poche)/i],
  ['grid', /(grid|axis|centre ?line|center ?line)/i],
];

/** Classify every layer by its name, then by what is drawn on it. */
export function layerRoles(dx) {
  const stats = new Map();
  const st = (l) => {
    if (!stats.has(l)) stats.set(l, { segs: 0, len: 0, arcs: 0, doorArcs: 0, texts: 0, fills: 0, colFills: 0, axis: 0 });
    return stats.get(l);
  };
  for (const s of dx.segs) {
    const o = st(s[4]); o.segs++;
    const L = Math.hypot(s[2] - s[0], s[3] - s[1]);
    o.len += L;
    if (Math.abs(s[0] - s[2]) < 1e-6 || Math.abs(s[1] - s[3]) < 1e-6) o.axis++;
  }
  for (const a of dx.arcs) {
    const o = st(a.layer); o.arcs++;
    const sw = a.a1 - a.a0;
    if (a.r > 0.55 && a.r < 1.3 && sw > 1.2 && sw < 1.95) o.doorArcs++;
  }
  for (const t of dx.texts) st(t.layer).texts++;
  for (const f of dx.fills) {
    const o = st(f.layer); o.fills++;
    const bb = bboxOf(f.pts), w = bb[2] - bb[0], h = bb[3] - bb[1];
    if (w > 0.12 && h > 0.12 && w < 1.6 && h < 1.6) o.colFills++;
  }
  const roles = new Map();
  for (const [name] of dx.layers) {
    const o = stats.get(name) || { segs: 0, len: 0, arcs: 0, doorArcs: 0, texts: 0, fills: 0, colFills: 0, axis: 0 };
    let role = null;
    for (const [r, re] of NAME_RULES) if (re.test(name)) { role = r; break; }
    // content overrides for generic names
    if (!role) {
      if (o.colFills >= 3 && o.colFills >= o.fills * 0.6) role = 'column';
      else if (o.doorArcs >= 2 && o.doorArcs >= o.arcs * 0.5) role = 'door';
      else if (o.texts > 0 && o.segs < 5) role = 'text';
      else if (o.segs > 20 && o.axis / Math.max(1, o.segs) > 0.6) role = 'wall';
      else role = 'other';
    }
    roles.set(name, { role, stats: o, auto: true });
  }
  return roles;
}

function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
}

// ---------------------------------------------------------------------------
// Floors: islands of geometry, each with a title under it

const LEVEL_WORDS = {
  basement: -1, cellar: -1, 'lower ground': -0.5, stilt: 0, ground: 0, parking: 0, podium: 0,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, mezzanine: 0.5, terrace: 99, roof: 99, 'upper roof': 100,
};

/** Parse a title like "SECOND FLOOR PLAN", "TYPICAL FLOOR (3RD–7TH)", "L5", "B2 PLAN". */
export function parseLevel(text) {
  const t = text.toLowerCase().replace(/[’']/g, '');
  if (!/(plan|floor|level|storey|story|basement|stilt|terrace|roof|parking)/.test(t)) return null;
  if (/(section|elevation|site plan|location|key plan|detail|roof plan of|area statement)/.test(t)) return null;
  let m = t.match(/\b(\d+)\s*(st|nd|rd|th)\b/);
  if (m) return { level: parseInt(m[1], 10), typical: /typical|typ\b/.test(t), text };
  m = t.match(/\blevel\s*[-–]?\s*(\d+)\b|\bl\s*(\d+)\b/);
  if (m) return { level: parseInt(m[1] || m[2], 10), typical: /typical/.test(t), text };
  m = t.match(/\bb\s*(\d)\b|\bbasement\s*(\d)\b/);
  if (m) return { level: -parseInt(m[1] || m[2], 10), typical: false, text };
  // longest keyword match wins ("upper roof" over "roof")
  let best = null;
  for (const [w, v] of Object.entries(LEVEL_WORDS)) if (t.includes(w) && (!best || w.length > best[0].length)) best = [w, v];
  if (best) return { level: best[1], typical: /typical/.test(t), text };
  if (/typical/.test(t)) return { level: 1, typical: true, text };
  return null;
}

/**
 * Split the drawing into islands and find the floor plans among them.
 * Returns floors sorted bottom → top: {id, title, level, typical, box:[x0,y0,x1,y1]}.
 */
export function findFloors(dx, roles) {
  const b = dx.bounds;
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const res = Math.max(0.25, span / 1600);
  const g = new Grid(b.x0 - 2, b.y0 - 2, b.x1 + 2, b.y1 + 2, res);
  const skip = new Set(['text', 'dim', 'grid']);
  for (const s of dx.segs) {
    const r = roles.get(s[4]);
    if (r && skip.has(r.role)) continue;
    g.seg(s[0], s[1], s[2], s[3], Math.ceil(1.2 / res));
  }
  const lab = label(g.data, g.w, g.h, 1);
  const islands = [];
  for (let id = 0; id < lab.count; id++) {
    if (lab.sizes[id] < 4) continue;
    const [i0, j0, i1, j1] = lab.bbox[id];
    islands.push({ id, box: [g.x0 + i0 * res + 1.2, g.y0 + j0 * res + 1.2, g.x0 + (i1 + 1) * res - 1.2, g.y0 + (j1 + 1) * res - 1.2] });
  }
  // titles: level-like texts just below (or above) an island, overlapping it horizontally
  for (const isl of islands) {
    const [x0, y0, x1, y1] = isl.box;
    const w = x1 - x0, h = y1 - y0;
    let best = null;
    for (const t of dx.texts) {
      const lv = parseLevel(t.text);
      if (!lv) continue;
      const tx = t.x, ty = t.y;
      const horiz = tx >= x0 - w * 0.2 && tx <= x1 + w * 0.2;
      const below = ty < y0 && ty > y0 - Math.max(8, h * 0.6);
      const above = ty > y1 && ty < y1 + Math.max(6, h * 0.4);
      const inside = tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1;
      if (!horiz || !(below || above || inside)) continue;
      const score = t.h * 10 - (below ? y0 - ty : above ? ty - y1 : h) * 0.2 + (/plan/i.test(t.text) ? 5 : 0);
      if (!best || score > best.score) best = { score, t, lv };
    }
    if (best) { isl.title = best.t.text; isl.level = best.lv.level; isl.typical = best.lv.typical; isl.titleText = best.t; }
  }
  let floors = islands.filter((i) => i.title !== undefined);
  // no titles at all: take the big islands, left to right
  if (!floors.length) {
    const area = (i) => (i.box[2] - i.box[0]) * (i.box[3] - i.box[1]);
    const maxA = Math.max(...islands.map(area));
    floors = islands.filter((i) => area(i) > maxA * 0.25).sort((p, q) => p.box[0] - q.box[0]).map((i, k) => ({ ...i, title: `Plan ${k + 1}`, level: k }));
  }
  floors.sort((p, q) => p.level - q.level || p.box[0] - q.box[0]);
  return floors.map((f, k) => ({ id: k, title: f.title, level: f.level, typical: !!f.typical, box: f.box }));
}

// ---------------------------------------------------------------------------
// Per-floor analysis

const TYPE_RULES = [
  ['toilet', /(toilet|\bw\.?\s?c\.?\b|bath|wash ?room|powder|lav(atory)?|shower|restroom|\bt\s*[/&]\s*b\b|\bttl\b|\bw\/c\b)/i],
  ['kitchen', /(kitchen|kitch|pantry|utility|wash ?area|dish|scullery)/i],
  ['bedroom', /(bed|master|guest room|kids|children|nursery|\bm\.?\s?b\.?\s?r\b|\bbr\b)/i],
  ['living', /(living|drawing|lounge|family|hall\b|dining|study|office|library|home ?theat|media|puja|pooja|prayer|reading)/i],
  ['stair', /(stair|staircase|steps)/i],
  ['lift', /(lift|elevator)/i],
  ['duct', /(duct|shaft|\bots\b|open to sky|plumbing|\bp\.?s\.?\b)/i],
  ['balcony', /(balcony|terrace|deck|sit ?out|veranda|verandah|patio|porch|chajja|projection)/i],
  ['circulation', /(passage|corridor|lobby|foyer|entrance|entry|hallway|vestibule|landing|gallery)/i],
  ['parking', /(parking|stilt|driveway|garage|car ?port|drive ?way)/i],
  ['service', /(store|storage|electric|elec|meter|pump|guard|security|driver|servant|dress|wardrobe|laundry|room\b)/i],
];
export const ROOM_TYPES = ['toilet', 'kitchen', 'bedroom', 'living', 'circulation', 'balcony', 'stair', 'lift', 'duct', 'service', 'parking', 'unknown'];
export const WET = new Set(['toilet', 'kitchen']);
export const DRY_HABITABLE = new Set(['bedroom', 'living']);

export function roomType(name) {
  if (!name) return 'unknown';
  for (const [t, re] of TYPE_RULES) if (re.test(name)) return t;
  return 'unknown';
}

const SIZE_TEXT = /^\s*[\d.,'"′″\s]+[x×*]\s*[\d.,'"′″\s]+\s*$|^\s*\d+(\.\d+)?\s*(sq\.?\s?(m|ft)|m2|m²|sft)\s*$/i;

/**
 * Analyse one floor island. Returns
 * { rooms, columns, grid, labels, footprint, outline, box, res, stats }.
 */
export function analyseFloor(dx, roles, box, opts = {}) {
  const res = opts.res ?? 0.04;
  const margin = 1.0;
  const [bx0, by0, bx1, by1] = box;
  const g = new Grid(bx0 - margin, by0 - margin, bx1 + margin, by1 + margin, res);
  const inBox = (x, y) => x >= bx0 - margin && x <= bx1 + margin && y >= by0 - margin && y <= by1 + margin;
  const roleOf = (layer) => (roles.get(layer) || { role: 'other' }).role;
  const brush = opts.brush ?? 1;
  const types = opts.types ? new Map(opts.types) : null; // normalised room name → type (your overrides)

  // 1. boundaries
  for (const s of dx.segs) {
    if (!inBox(s[0], s[1]) && !inBox(s[2], s[3])) continue;
    if (!BOUNDARY_ROLES.has(roleOf(s[4]))) continue;
    g.seg(s[0], s[1], s[2], s[3], brush);
  }
  const columns = [];
  for (const f of dx.fills) {
    const c = centroid(f.pts);
    if (!inBox(c[0], c[1])) continue;
    const r = roleOf(f.layer);
    if (r === 'column' || r === 'wall') g.poly(f.pts, 1);
    if (r === 'column') {
      const bb = bboxOf(f.pts);
      const w = bb[2] - bb[0], h = bb[3] - bb[1];
      if (w > 0.1 && h > 0.1 && w < 2 && h < 2) columns.push({ x: (bb[0] + bb[2]) / 2, y: (bb[1] + bb[3]) / 2, w, h, box: bb });
    }
  }
  // columns drawn as outlines / circles only
  for (const c of dx.circles) {
    if (!inBox(c.cx, c.cy) || roleOf(c.layer) !== 'column' || c.r < 0.08 || c.r > 1) continue;
    columns.push({ x: c.cx, y: c.cy, w: 2 * c.r, h: 2 * c.r, box: [c.cx - c.r, c.cy - c.r, c.cx + c.r, c.cy + c.r], round: true });
    g.poly(circlePts(c.cx, c.cy, c.r), 1);
  }
  if (!columns.length) {
    for (const rect of rectanglesOn(dx, (l) => roleOf(l) === 'column', inBox)) {
      columns.push(rect);
      g.poly([[rect.box[0], rect.box[1]], [rect.box[2], rect.box[1]], [rect.box[2], rect.box[3]], [rect.box[0], rect.box[3]]], 1);
    }
  }
  const cols = dedupeColumns(columns);

  // 2. door swings close their openings: draw both radii of every door-like arc
  const doors = [];
  for (const a of dx.arcs) {
    if (!inBox(a.cx, a.cy)) continue;
    const sw = a.a1 - a.a0;
    const r = roleOf(a.layer);
    const doorish = a.r > 0.45 && a.r < 1.4 && sw > 1.1 && sw < 2.05;
    if (!doorish || (r !== 'door' && r !== 'other' && r !== 'wall' && r !== 'window')) continue;
    const p0 = [a.cx + a.r * Math.cos(a.a0), a.cy + a.r * Math.sin(a.a0)];
    const p1 = [a.cx + a.r * Math.cos(a.a1), a.cy + a.r * Math.sin(a.a1)];
    g.seg(a.cx, a.cy, p0[0], p0[1], brush);
    g.seg(a.cx, a.cy, p1[0], p1[1], brush);
    doors.push({ x: a.cx, y: a.cy, w: a.r });
  }

  // 3. free space → regions
  const W = g.w, H = g.h;
  const lab = label(g.data, W, H, 0);
  const dist = distanceTransform(g.data, W, H); // distance (cells) to the nearest boundary
  const maxDT = new Float64Array(lab.count);
  for (let k = 0; k < W * H; k++) { const id = lab.labels[k]; if (id >= 0 && dist[k] > maxDT[id]) maxDT[id] = dist[k]; }

  const regions = [];
  for (let id = 0; id < lab.count; id++) {
    const area = lab.sizes[id] * res * res;
    const outside = lab.touchesBorder[id];
    const cavity = !outside && maxDT[id] * res < 0.13;
    regions.push({ id, area, outside, cavity, texts: [], bbox: lab.bbox[id] });
  }

  // 4. texts → regions (remember the cell each text lands in)
  for (const t of dx.texts) {
    if (!inBox(t.x, t.y)) continue;
    if (roleOf(t.layer) === 'dim') continue;
    const at = textAnchor(t);
    const cell = cellAt(lab.labels, W, H, g, at[0], at[1], regions);
    if (cell < 0) continue;
    // a multi-line MTEXT ("MASTER BED" / "3.6 x 4.2") is a name plus its size
    for (const line of String(t.text).split('\n').map((q) => q.trim()).filter(Boolean)) regions[lab.labels[cell]].texts.push({ ...t, text: line, cell });
  }

  // 5. rooms: one per region, or one per named zone when a region holds several names
  //    (open-plan living/dining/kitchen, a lobby that runs into the stair and lift)
  const roomAt = new Int32Array(W * H).fill(-1);
  const draft = [];
  const isName = (s) => !SIZE_TEXT.test(s) && /[a-z]/i.test(s) && s.length <= 40 && !/scale|plan\b/i.test(s);
  const queue = new Int32Array(W * H);
  for (const rg of regions) {
    if (rg.outside || rg.cavity) continue;
    const seenCell = new Set();
    const names = rg.texts.filter((t) => isName(t.text)).filter((t) => (seenCell.has(t.cell) ? false : (seenCell.add(t.cell), true)));
    const [i0, j0, i1, j1] = rg.bbox;
    if (names.length <= 1) {
      const idx = draft.length;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * W + i; if (lab.labels[k] === rg.id) roomAt[k] = idx; }
      draft.push({ region: rg.id, nameText: names[0] ? names[0].text : '', texts: rg.texts, bbox: rg.bbox });
    } else {
      // multi-source flood from each name: every cell joins the name it can walk to first
      let head = 0, tail = 0;
      names.forEach((t, s) => { roomAt[t.cell] = draft.length + s; queue[tail++] = t.cell; });
      while (head < tail) {
        const c = queue[head++], v = roomAt[c];
        const i = c % W, j = (c - i) / W;
        const nb = [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, j > 0 ? c - W : -1, j < H - 1 ? c + W : -1];
        for (const n of nb) if (n >= 0 && roomAt[n] === -1 && lab.labels[n] === rg.id) { roomAt[n] = v; queue[tail++] = n; }
      }
      names.forEach((t) => {
        // size texts belong to the nearest name in the same region
        draft.push({ region: rg.id, nameText: t.text, texts: [t, ...rg.texts.filter((u) => !isName(u.text) && roomAt[u.cell] === roomAt[t.cell])], bbox: rg.bbox });
      });
    }
  }
  // per-room cell stats: count, centroid, bbox, perimeter against walls
  const nD = draft.length;
  const cnt = new Float64Array(nD), sx = new Float64Array(nD), sy = new Float64Array(nD), per = new Float64Array(nD);
  const rb = Array.from({ length: nD }, () => [W, H, -1, -1]);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, v = roomAt[k];
    if (v < 0) continue;
    cnt[v]++; sx[v] += i; sy[v] += j;
    const b = rb[v];
    if (i < b[0]) b[0] = i; if (j < b[1]) b[1] = j; if (i > b[2]) b[2] = i; if (j > b[3]) b[3] = j;
    if (i > 0 && g.data[k - 1]) per[v]++;
    if (i < W - 1 && g.data[k + 1]) per[v]++;
    if (j > 0 && g.data[k - W]) per[v]++;
    if (j < H - 1 && g.data[k + W]) per[v]++;
  }
  // symbols inside rooms: duct crosses, lift crosses, stair treads
  const hits = { duct: new Float64Array(nD), lift: new Float64Array(nD), stair: new Float64Array(nD) };
  for (const s of dx.segs) {
    const r = roleOf(s[4]);
    if (r !== 'duct' && r !== 'lift' && r !== 'stair') continue;
    const mx = (s[0] + s[2]) / 2, my = (s[1] + s[3]) / 2;
    if (!inBox(mx, my)) continue;
    const cell = cellAt(lab.labels, W, H, g, mx, my, regions, 2);
    if (cell >= 0 && roomAt[cell] >= 0) hits[r][roomAt[cell]]++;
  }
  // the brush that seals gaps also eats a strip along every wall: give it back
  const erode = (brush + 0.75) * res;
  let rooms = draft.map((d, v) => {
    const area = cnt[v] * res * res + per[v] * res * erode;
    let name = d.nameText;
    const forced = types && types.get(normName(name));
    let type = forced || roomType(d.nameText || d.texts.map((t) => t.text).join(' '));
    if (!forced && (type === 'unknown' || type === 'service')) {
      if (hits.duct[v] >= 2 && area < 5) { type = 'duct'; name = name || 'Duct'; }
      else if (hits.lift[v] >= 2 && area < 14) { type = 'lift'; name = name || 'Lift'; }
      else if (hits.stair[v] >= 6) { type = 'stair'; name = name || 'Staircase'; }
    }
    if (!forced && type === 'unknown' && !name && area < 1.6) { type = 'duct'; name = 'Shaft?'; }
    const sizeText = d.texts.map((t) => t.text).find((x) => SIZE_TEXT.test(x)) || '';
    return {
      idx: v, region: d.region, name: tidyName(name) || (type === 'unknown' ? 'Unnamed space' : cap(type)), label: d.nameText || '', type, area, cellArea: cnt[v] * res * res, sizeText,
      bbox: rb[v], cx: g.x0 + (sx[v] / Math.max(1, cnt[v]) + 0.5) * res, cy: g.y0 + (sy[v] / Math.max(1, cnt[v]) + 0.5) * res,
    };
  });
  const keep = rooms.filter((r) => r.area >= (r.type === 'duct' || r.type === 'lift' ? 0.05 : 0.45) && !(r.type === 'unknown' && r.area < 0.8));
  const remap = new Int32Array(nD).fill(-1);
  keep.forEach((r, k) => { remap[r.idx] = k; r.id = k; });
  for (let k = 0; k < W * H; k++) if (roomAt[k] >= 0) roomAt[k] = remap[roomAt[k]];
  rooms = keep;

  // 6. outline of each room (cell corners → metres)
  for (const rm of rooms) {
    const [i0, j0, i1, j1] = rm.bbox;
    const ww = i1 - i0 + 3, hh = j1 - j0 + 3;
    const pred = (k) => {
      const li = (k % ww) + i0 - 1, lj = Math.floor(k / ww) + j0 - 1;
      return li >= 0 && lj >= 0 && li < W && lj < H && roomAt[lj * W + li] === rm.id;
    };
    const loops = allContours(pred, ww, hh, 1.0);
    let bestLoop = null, bestA = 0;
    for (const L of loops) { const A = Math.abs(polyArea(L)); if (A > bestA) { bestA = A; bestLoop = L; } }
    rm.poly = bestLoop ? bestLoop.map(([i, j]) => [g.x0 + (i + i0 - 1) * res, g.y0 + (j + j0 - 1) * res]) : [];
  }

  // 8. footprint = everything that is not outside (rooms, walls, cavities)
  const inside = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const id = lab.labels[k];
    inside[k] = id < 0 ? 1 : regions[id].outside ? 0 : 1;
  }
  const outlines = allContours((k) => inside[k] === 1, W, H, 1.5).filter((L) => polyArea(L) < 0).map((L) => L.map(([i, j]) => [g.x0 + i * res, g.y0 + j * res]));
  let fpArea = 0;
  for (let k = 0; k < W * H; k++) if (inside[k]) fpArea++;

  return {
    box, res,
    grid: { x0: g.x0, y0: g.y0, w: W, h: H, res },
    labels: lab.labels, roomAt, regions, rooms, columns: cols, doors,
    inside, outlines, footprintArea: fpArea * res * res,
    stats: { boundaryCells: g.data.reduce((a, v) => a + v, 0), regions: lab.count },
  };
}

/** Where a text actually sits: the middle of its box, from its justification and rotation. */
export function textAnchor(t) {
  const lines = String(t.text).split('\n');
  const len = Math.max(...lines.map((l) => l.length));
  const w = len * t.h * 0.62, hh = t.h * (lines.length * 1.45 - 0.45);
  let dx = 0, dy = 0; // insertion point → centre, in the text's own frame
  if (t.mtext) {
    const a = t.attach || 1, col = (a - 1) % 3, row = Math.floor((a - 1) / 3);
    dx = col === 0 ? w / 2 : col === 2 ? -w / 2 : 0;
    dy = row === 0 ? -hh / 2 : row === 2 ? hh / 2 : 0;
  } else {
    const ha = t.ha || 0, va = t.va || 0;
    if (ha === 4) { dx = 0; dy = 0; }                        // "middle"
    else {
      dx = ha === 0 ? w / 2 : ha === 2 ? -w / 2 : 0;         // left / right / centre, aligned, fit
      dy = va === 3 ? -t.h / 2 : va === 2 ? 0 : t.h / 2;     // top / middle / baseline+bottom
    }
  }
  const r = ((t.rot || 0) * Math.PI) / 180;
  return [t.x + dx * Math.cos(r) - dy * Math.sin(r), t.y + dx * Math.sin(r) + dy * Math.cos(r)];
}

function cellAt(labels, W, H, g, x, y, regions, maxR = 6) {
  const i0 = Math.floor(g.cx(x)), j0 = Math.floor(g.cy(y));
  for (let r = 0; r <= maxR; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const id = labels[j * W + i];
      if (id >= 0 && !regions[id].cavity && !regions[id].outside) return j * W + i;
    }
  }
  return -1;
}

function regionAt(labels, W, H, g, x, y, regions, maxR = 6) {
  const i0 = Math.floor(g.cx(x)), j0 = Math.floor(g.cy(y));
  for (let r = 0; r <= maxR; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const id = labels[j * W + i];
      if (id >= 0 && !regions[id].cavity && !regions[id].outside) return id;
    }
  }
  return -1;
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

function circlePts(cx, cy, r) {
  const out = [];
  for (let k = 0; k < 24; k++) out.push([cx + r * Math.cos((k / 24) * Math.PI * 2), cy + r * Math.sin((k / 24) * Math.PI * 2)]);
  return out;
}

/** Small axis-aligned rectangles formed by four segments on the given layers. */
function rectanglesOn(dx, layerPred, inBox) {
  const segs = dx.segs.filter((s) => layerPred(s[4]) && inBox(s[0], s[1]));
  const key = (x, y) => `${Math.round(x * 50)},${Math.round(y * 50)}`;
  const byPt = new Map();
  for (const s of segs) {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) { if (!byPt.has(k)) byPt.set(k, []); byPt.get(k).push(s); }
  }
  const out = [];
  const seen = new Set();
  for (const s of segs) {
    const xs = [s[0], s[2]], ys = [s[1], s[3]];
    // try to grow a rectangle from this segment using the bbox of connected segments
    const stack = [s], comp = new Set([s]);
    while (stack.length && comp.size < 12) {
      const c = stack.pop();
      for (const k of [key(c[0], c[1]), key(c[2], c[3])]) for (const n of byPt.get(k) || []) if (!comp.has(n)) { comp.add(n); stack.push(n); }
    }
    if (comp.size < 4 || comp.size > 8) continue;
    const bb = bboxOf([...comp].flatMap((c) => [[c[0], c[1]], [c[2], c[3]]]));
    const id = bb.map((v) => v.toFixed(2)).join('|');
    if (seen.has(id)) continue;
    seen.add(id);
    const w = bb[2] - bb[0], h = bb[3] - bb[1];
    if (w > 0.12 && h > 0.12 && w < 1.6 && h < 1.6) out.push({ x: (bb[0] + bb[2]) / 2, y: (bb[1] + bb[3]) / 2, w, h, box: bb });
    void xs; void ys;
  }
  return out;
}

function dedupeColumns(cols) {
  const out = [];
  for (const c of cols.sort((p, q) => q.w * q.h - p.w * p.h)) {
    if (out.some((o) => Math.abs(o.x - c.x) < Math.max(0.05, Math.min(o.w, c.w) / 3) && Math.abs(o.y - c.y) < Math.max(0.05, Math.min(o.h, c.h) / 3))) continue;
    out.push(c);
  }
  return out;
}

function tidyName(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().replace(/\b([A-Z])([A-Z]+)\b/g, (m, a, b) => a + b.toLowerCase());
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
/** Key for per-name overrides: "BED ROOM " and "Bed  room" are the same room name. */
export const normName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
