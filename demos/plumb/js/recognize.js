// Plumb — understanding a drawing: units, layer roles, floors (islands + titles), and per
// floor: rooms (with names and types), columns, ducts, cores and the footprint.

import { Grid, label, distanceTransform, allContours, polyArea } from './raster.js';

// ---------------------------------------------------------------------------
// Units

const UNIT_CANDS = [[1, 'mm'], [10, 'cm'], [1000, 'm'], [25.4, 'in'], [304.8, 'ft']];
const UNIT_WORD = { 1: 'mm', 10: 'cm', 1000: 'm', 25.4: 'inches', 304.8: 'feet' };

/** The unit that makes the most door-swing arcs door-sized (0.6–1.1 m), if the drawing says so clearly. */
function unitFromDoors(dxf) {
  const radii = dxf.arcs.filter((a) => {
    let sw = a.a1 - a.a0;
    while (sw < 0) sw += Math.PI * 2;
    return sw > 1.2 && sw < 1.95;
  }).map((a) => a.r);
  let best = null;
  for (const [mm, name] of UNIT_CANDS) {
    const doors = radii.map((r) => (r * mm) / 1000).filter((m) => m > 0.6 && m < 1.1);
    if (doors.length < 3) continue;
    doors.sort((p, q) => p - q);
    const med = doors[Math.floor(doors.length / 2)];
    const err = Math.abs(Math.log(med / 0.85));
    if (!best || doors.length > best.n || (doors.length === best.n && err < best.err)) best = { mm, name, n: doors.length, err };
  }
  return best;
}

/**
 * Millimetres per drawing unit. $INSUNITS if the drawing agrees with it; files often carry the
 * wrong one (a house drawn in metres, saved as "inches"), so the door swings and the size of the
 * whole drawing get a say.
 */
export function inferUnitMM(dxf) {
  const b = dxf.bounds, span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const doors = unitFromDoors(dxf);
  if (dxf.unitMM) {
    const spanM = (span * dxf.unitMM) / 1000;
    const agrees = spanM >= 3 && spanM <= 5000 && (!doors || doors.mm === dxf.unitMM || doors.n < 3);
    if (agrees) return { mm: dxf.unitMM, source: 'header' };
    const said = UNIT_WORD[dxf.unitMM] ? `; the file says ${UNIT_WORD[dxf.unitMM]}` : '';
    if (doors) return { mm: doors.mm, source: `door swings (${doors.name})${said}` };
    const size = unitFromSize(span);
    return { ...size, source: size.source + said };
  }
  if (doors) return { mm: doors.mm, source: `door swings (${doors.name})` };
  return unitFromSize(span);
}

// a plan set is typically 10–300 m across
function unitFromSize(span) {
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
  ['other', /(hidden|ocult|proy(ecc)?|aereo|a[ée]rea proy)/i], // hidden and projected lines (roof above, beams): not boundaries
  ['column', /(^|[^a-z])(s-col|col|cols|column|columns|pillar|pier|stanchion|pilar|pilares|columna|poteau|stütze|stuetze|pilastro)([^a-z]|$)/i],
  ['wall', /(wall|wand|mur|mauer|brick|masonry|partition|block ?work|a-wall|^w$|pared|tabique|parete|parede|cloison)/i],
  ['door', /(door|(^|[^a-z])drs?([^a-z]|$)|shutter|gate|puert|porte\b|portes\b|\bt[üu]e?r(en)?\b|deur|porta\b)/i],
  ['window', /(window|(^|[^a-z])win([^a-z]|$)|glaz|glass|vent|curtain|fenetre|fenêtre|fenster|finestr|janela|carpinter)/i],
  ['outline', /(slab|outline|above|plinth|footprint|balcony edge|chajja|projection|bldg|building line|forjado|losa)/i],
  ['stair', /(stair|strs|step|tread|ramp|escaler|escalon|treppe|\bscala\b|escada|a-flor-?(strs?|stm|hr(a?l|m)))/i],
  ['lift', /(lift|elev|elevator|ascensor|aufzug|ascenseur|ascensore)/i],
  ['duct', /(duct|shaft|p-|plumb|ots|drain|sanitary|san-|ducto|schacht)/i],
  ['furniture', /(furn|furniture|fixture|sofa|bed|kitchen eq|equip|fitting|cars?$|prkg|parking|tree|plant|landscape|mobili|mueb|(^|[^a-z])mob[_-]|meuble|m[öo]bel|moebel|arredo|cocina|cucina|k[üu]che|(^|[^a-z])arte|deco|menu)/i],
  ['dim', /(dim|dimension|cota|acot|bema[ßs]|quota)/i],
  ['hatch', /(hatch|patt|fill|poche|textur|trama|sombread|schraff)/i],
  ['text', /(text|txt|anno|name|label|title|ttlb|note|room|texto|rotul|nombre|beschrift)/i],
  ['grid', /(grid|axis|centre ?line|center ?line|ejes?\b|achse)/i],
];

/** Classify every layer by its name, then by what is drawn on it. */
export function layerRoles(dx) {
  const stats = new Map();
  const treads = new Map(); // layer → short axis-aligned lines, to spot stair treads
  const lines = new Map();  // layer → axis-aligned lines over 30 cm, to see how they pair up
  const st = (l) => {
    if (!stats.has(l)) stats.set(l, { segs: 0, len: 0, arcs: 0, doorArcs: 0, texts: 0, fills: 0, colFills: 0, axis: 0 });
    return stats.get(l);
  };
  for (const s of dx.segs) {
    const o = st(s[4]); o.segs++;
    const L = Math.hypot(s[2] - s[0], s[3] - s[1]);
    o.len += L;
    const vert = Math.abs(s[0] - s[2]) < 1e-6, horiz = Math.abs(s[1] - s[3]) < 1e-6;
    if (vert || horiz) {
      o.axis++;
      if (L > 0.5 && L < 2.0) {
        const list = treads.get(s[4]) || (treads.set(s[4], []), treads.get(s[4]));
        if (list.length < 4000) list.push({ o: horiz ? 0 : 1, len: L, pos: horiz ? s[1] : s[0] });
      }
      if (L > 0.3) {
        const list = lines.get(s[4]) || (lines.set(s[4], []), lines.get(s[4]));
        if (list.length < 3000) list.push(horiz ? { h: 1, c: s[1], a0: Math.min(s[0], s[2]), a1: Math.max(s[0], s[2]) } : { h: 0, c: s[0], a0: Math.min(s[1], s[3]), a1: Math.max(s[1], s[3]) });
      }
    }
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
    // a name can mislead: "TEXTURA" (Spanish for texture) holds door swings, not text
    if (role === 'text' && !o.texts && o.segs + o.arcs > 0) role = null;
    if ((!role || role === 'hatch') && o.doorArcs >= 2 && o.doorArcs >= o.arcs * 0.5) role = 'door';
    // content decides for generic names
    if (!role) {
      if (o.colFills >= 3 && o.colFills >= o.fills * 0.6) role = 'column';
      else if (o.texts > 0 && o.segs < 5) role = 'text';
      else if (name !== '0' && looksLikeTreads(treads.get(name)) >= Math.max(6, 0.2 * o.segs)) role = 'stair';
      else if (name !== '0' && looksLikeGlazing(lines.get(name))) role = 'window'; // layer 0 holds a bit of everything
      else if (o.segs > 20 && o.axis / Math.max(1, o.segs) > 0.6) role = 'wall';
      else role = 'other';
    }
    roles.set(name, { role, stats: o, auto: true });
  }
  return roles;
}

/**
 * Most lines have a parallel twin a few centimetres away: glass and frames (a sliding door, a
 * window), not walls, whose two faces sit 10–45 cm apart.
 */
function looksLikeGlazing(list) {
  if (!list || list.length < 8) return false;
  const gaps = [];
  for (const o of [0, 1]) {
    const L = list.filter((q) => q.h === o).sort((p, q) => p.c - q.c);
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      let best = Infinity;
      for (const j of [-1, 1]) {
        for (let k = i + j; k >= 0 && k < L.length && Math.abs(L[k].c - a.c) <= 0.5; k += j) {
          const b = L[k], d = Math.abs(b.c - a.c);
          if (d < 1e-4 || d >= best) continue;
          if (Math.min(a.a1, b.a1) - Math.max(a.a0, b.a0) >= 0.5 * (a.a1 - a.a0)) best = d;
        }
      }
      if (best < 0.5) gaps.push(best);
    }
  }
  if (gaps.length < 0.6 * list.length) return false;
  gaps.sort((p, q) => p - q);
  return gaps[Math.floor(gaps.length / 2)] < 0.06;
}

/**
 * Gaps in walls: pairs of wall-line ends that face each other along the same line, 0.3–3.2 m apart
 * (each line's end points at the other, the lines parallel and within 5 cm of one line, one of them at
 * least half a metre long unless a door is hung there: the faces of two columns across a room are not
 * a wall). hinges: door-swing centres [x, y]. Returns the
 * bridging segments [x0, y0, x1, y1].
 */
export function wallGaps(segs, hinges = []) {
  const hinged = (e) => hinges.some((h) => Math.abs(h[0] - e.x) < 0.3 && Math.abs(h[1] - e.y) < 0.3);
  const ends = [];
  for (const s of segs) {
    const L = Math.hypot(s[2] - s[0], s[3] - s[1]);
    if (L < 0.05) continue;
    const ux = (s[2] - s[0]) / L, uy = (s[3] - s[1]) / L;
    ends.push({ x: s[0], y: s[1], ux: -ux, uy: -uy, L }, { x: s[2], y: s[3], ux, uy, L }); // u points out of the line at that end
  }
  const cell = new Map(), key = (x, y) => Math.floor(x) + ',' + Math.floor(y);
  ends.forEach((e, i) => { const k = key(e.x, e.y); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(i); });
  const out = [], used = new Set();
  ends.forEach((a, i) => {
    let best = -1, bd = 3.2;
    const cx = Math.floor(a.x), cy = Math.floor(a.y);
    for (let di = -4; di <= 4; di++) for (let dj = -4; dj <= 4; dj++) for (const j of cell.get((cx + di) + ',' + (cy + dj)) || []) {
      if (j === i || (j ^ 1) === i) continue;
      const b = ends[j], vx = b.x - a.x, vy = b.y - a.y;
      const along = vx * a.ux + vy * a.uy, off = Math.abs(vx * a.uy - vy * a.ux);
      if (along < 0.3 || along >= bd || off > 0.05) continue;
      if (Math.abs(a.ux * b.uy - a.uy * b.ux) > 0.04 || a.ux * b.ux + a.uy * b.uy > -0.99) continue; // parallel, facing back
      if (Math.max(a.L, b.L) < 0.5 && !hinged(a) && !hinged(b)) continue; // two column faces across a room aren't a wall with a gap (a door hung on a nib is)
      best = j; bd = along;
    }
    if (best < 0) return;
    const pair = i < best ? i + ':' + best : best + ':' + i;
    if (used.has(pair)) return;
    used.add(pair);
    out.push([a.x, a.y, ends[best].x, ends[best].y]);
  });
  return out;
}

/** How many lines sit in flights of stairs: six or more equal parallel lines, 18–38 cm apart one after the next. */
function looksLikeTreads(list) {
  if (!list || list.length < 6) return 0;
  let inFlights = 0;
  const groups = new Map();
  for (const q of list) {
    const k = q.o + ':' + Math.round(q.len / 0.05);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(q.pos);
  }
  for (const ps of groups.values()) {
    if (ps.length < 6) continue;
    ps.sort((p, q) => p - q);
    let run = 0;
    const end = () => { if (run >= 5) inFlights += run + 1; run = 0; };
    for (let i = 1; i < ps.length; i++) {
      const d = ps[i] - ps[i - 1];
      if (d < 0.005) continue; // the same line again (two flights side by side)
      if (d > 0.18 && d < 0.38) run++; else end();
    }
    end();
  }
  return inFlights;
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

const ORD = ['GROUND', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH'];
const nth = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] || 'TH');
/** "GROUND FLOOR", "SECOND FLOOR", "12TH FLOOR", "BASEMENT 1" */
export const storeyTitle = (n) => (n < 0 ? `BASEMENT ${-n}` : `${n < ORD.length ? ORD[n] : nth(n)} FLOOR`);

const STAIR_UP = /^\s*(up|upstairs|sube|monte|↑)\s*$/i, STAIR_DOWN = /^\s*(dn|down|downstairs|baja|descend|↓)\s*$/i;
const areaOf = (bx) => Math.max(0, bx[2] - bx[0]) * Math.max(0, bx[3] - bx[1]);
const inBox = (bx, x, y) => x >= bx[0] && x <= bx[2] && y >= bx[1] && y <= bx[3];

/**
 * Split the drawing into islands and find the floor plans among them.
 * Returns floors sorted bottom → top: {id, title, level, typical, box:[x0,y0,x1,y1], guessed?}.
 * guessed: 'stairs' when the order came from the stair arrows, 'order' when from left to right.
 */
export function findFloors(dx, roles) {
  const b = dx.bounds;
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const roleOf = (l) => (roles.get(l) || { role: 'other' }).role;
  const skip = new Set(['text', 'dim', 'grid']);
  const segs = dx.segs.filter((s) => !skip.has(roleOf(s[4])));
  const labels = dx.texts.filter((t) => roleOf(t.layer) !== 'dim' && /\p{L}{2,}/u.test(t.text) && !SIZE_TEXT.test(t.text) && !CODE.test(t.text));
  // what makes a drawing a floor plan rather than an elevation or a section: door swings, room
  // names, lines on wall layers
  const doorArcs = dx.arcs.filter((a) => { const sw = a.a1 - a.a0; return a.r > 0.55 && a.r < 1.3 && sw > 1.2 && sw < 1.95 && roleOf(a.layer) !== 'furniture'; });
  const wallSegs = segs.filter((s) => roleOf(s[4]) === 'wall');
  const ctx = { labels, planScore: (box) => {
    const inb = (x, y) => inBox(box, x, y);
    const doors = doorArcs.filter((a) => inb(a.cx, a.cy)).length;
    const names = labels.filter((t) => inb(t.x, t.y)).length;
    const walls = wallSegs.filter((s) => inb((s[0] + s[2]) / 2, (s[1] + s[3]) / 2)).length;
    return doors + 2 * names + (walls >= 20 ? 5 : walls / 4);
  } };
  // islands: a plan's pieces (a detached porch, a parked car) join up within ~2.4 m
  let islands = dropFrames(islandsOf(segs, [b.x0, b.y0, b.x1, b.y1], Math.max(0.25, span / 1600), 1.2));
  // plans drawn closer together than that (or beside their elevations) come out as one island:
  // split it where a finer look shows separate drawings
  islands = islands.flatMap((isl) => splitPlans(isl, segs, ctx));
  // titles: level-like texts just below (or above) an island, overlapping it horizontally; and
  // "FRONT ELEVATION", "SECTION A-A" mark a drawing that isn't a plan
  const titleNear = (isl, test) => {
    const [x0, y0, x1, y1] = isl.box;
    const w = x1 - x0, h = y1 - y0;
    let best = null;
    for (const t of dx.texts) {
      const v = test(t.text);
      if (!v) continue;
      const tx = t.x, ty = t.y;
      const horiz = tx >= x0 - w * 0.2 && tx <= x1 + w * 0.2;
      const below = ty < y0 && ty > y0 - Math.max(8, h * 0.6);
      const above = ty > y1 && ty < y1 + Math.max(6, h * 0.4);
      const inside = tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1;
      if (!horiz || !(below || above || inside)) continue;
      // inside a plan, "COVERED TERRACE" or "SECOND LEVEL HALL" names a room; a title says plan /
      // floor / level and isn't a room's name
      if (inside && !(below || above) && (!/(plan|floor|level|storey|story|planta|nivel|piso)/i.test(t.text) || (roomType(t.text) !== 'unknown' && !/plan/i.test(t.text)))) continue;
      const score = t.h * 10 - (below ? y0 - ty : above ? ty - y1 : h) * 0.2 + (/plan/i.test(t.text) ? 5 : 0);
      if (!best || score > best.score) best = { score, t, v };
    }
    return best;
  };
  for (const isl of islands) {
    const lv = titleNear(isl, parseLevel);
    if (lv) { isl.title = lv.t.text; isl.level = lv.v.level; isl.typical = lv.v.typical; }
    const el = titleNear(isl, (s) => ELEVATION.test(s));
    isl.score = ctx.planScore(isl.box);
    // an elevation's title closer than any level title, or no sign of a plan at all
    isl.notPlan = (el && (!lv || el.score > lv.score)) || isl.nonPlan;
  }
  // a plan shows much more of that than an elevation beside it: keep drawings scoring at least a
  // third of the best (a titled plan stays whatever it scores)
  const best = Math.max(0, ...islands.filter((i) => !i.notPlan).map((i) => i.score));
  const plansFound = best >= 4;
  const cands = islands.filter((i) => !i.notPlan && (i.title !== undefined || !plansFound || i.score >= Math.max(4, best / 3)));
  const maxA = Math.max(0, ...cands.map((i) => areaOf(i.box)));
  const titled = cands.filter((i) => i.title !== undefined);
  // untitled plans: big ones, in the order their stairs give (the lowest plan's stair only goes UP,
  // the top one only DOWN), else left to right, on the levels the titled plans leave free
  let untitled = cands.filter((i) => i.title === undefined && areaOf(i.box) > maxA * (titled.length ? 0.15 : 0.25));
  if (titled.length && !untitled.some((i) => i.score >= 4)) untitled = [];
  const says = (i, re) => dx.texts.some((t) => re.test(t.text) && inBox(i.box, t.x, t.y));
  const rank = (i) => { const up = says(i, STAIR_UP), dn = says(i, STAIR_DOWN); return up && !dn ? 0 : dn && !up ? 2 : 1; };
  const byStairs = untitled.length + titled.length > 1 && untitled.some((i) => rank(i) !== 1);
  untitled.sort((p, q) => (byStairs ? rank(p) - rank(q) : 0) || p.box[0] - q.box[0] || q.box[1] - p.box[1]);
  const taken = new Set(titled.map((i) => i.level));
  let next = 0;
  const floors = [...titled, ...untitled.map((i) => {
    while (taken.has(next)) next++;
    taken.add(next);
    return { ...i, title: storeyTitle(next), level: next, guessed: byStairs ? 'stairs' : 'order' };
  })];
  floors.sort((p, q) => p.level - q.level || p.box[0] - q.box[0]);
  return floors.map((f, k) => ({ id: k, title: f.title, level: f.level, typical: !!f.typical, box: f.box, ...(f.guessed ? { guessed: f.guessed } : {}) }));
}
const ELEVATION = /(elevation|section|elevaci[oó]n|fachada|alzado|corte|secci[oó]n|立面|剖面)/i;

/** Connected groups of linework, each line thickened by `reach` metres. */
function islandsOf(segs, box, res, reach) {
  const m = reach + 1;
  const g = new Grid(box[0] - m, box[1] - m, box[2] + m, box[3] + m, res);
  const r = Math.max(1, Math.round(reach / res)); // whole cells, not rounded up: two plans 0.6 m apart must stay apart
  for (const s of segs) g.seg(s[0], s[1], s[2], s[3], r);
  const lab = label(g.data, g.w, g.h, 1);
  const out = [];
  for (let id = 0; id < lab.count; id++) {
    if (lab.sizes[id] < 4) continue;
    const [i0, j0, i1, j1] = lab.bbox[id];
    out.push({ box: [g.x0 + i0 * res + reach, g.y0 + j0 * res + reach, g.x0 + (i1 + 1) * res - reach, g.y0 + (j1 + 1) * res - reach], fill: lab.sizes[id] * res * res, reach });
  }
  return out;
}

/** A sheet border or title-block frame drawn round other islands is not a plan. */
function dropFrames(islands) {
  return islands.filter((o) => {
    const A = areaOf(o.box), w = o.box[2] - o.box[0], h = o.box[3] - o.box[1];
    const innerA = islands.reduce((a, i) => a + (i !== o && i.box[0] >= o.box[0] && i.box[1] >= o.box[1] && i.box[2] <= o.box[2] && i.box[3] <= o.box[3] ? areaOf(i.box) : 0), 0);
    const ring = o.fill < 2 * (w + h) * 2 * o.reach * 1.6; // little more than its own edge
    return !(innerA > 0.15 * A && ring);
  });
}

/**
 * One island, or the drawings inside it when a finer grain pulls them apart: each plan (with the bits
 * beside it) and, apart from them, any big drawing that isn't a plan (an elevation drawn close by).
 */
function splitPlans(isl, segs, ctx) {
  const [x0, y0, x1, y1] = isl.box;
  const A = areaOf(isl.box);
  const res = Math.max(0.08, Math.max(x1 - x0, y1 - y0) / 1500);
  const near = (s) => { const mx = (s[0] + s[2]) / 2, my = (s[1] + s[3]) / 2; return mx >= x0 - 1 && mx <= x1 + 1 && my >= y0 - 1 && my <= y1 + 1; };
  const raw = islandsOf(segs.filter(near), isl.box, res, 0.2);
  const parts = dropFrames(raw);
  const named = (p) => ctx.labels.filter((t) => inBox(p.box, t.x, t.y)).length;
  const big = parts.filter((p) => areaOf(p.box) >= 0.1 * A && p.box[2] - p.box[0] > 3 && p.box[3] - p.box[1] > 3);
  big.forEach((p) => { p.score = ctx.planScore(p.box); });
  const plans = big.filter((p) => p.score >= 4 && (named(p) >= 2 || areaOf(p.box) >= 0.3 * A || p.score >= 8));
  const others = big.filter((p) => !plans.includes(p)); // elevations, sections, site plans drawn close by
  // one plan and nothing else big: the island as it was, unless a border round it was dropped
  if (!plans.length || (plans.length === 1 && !others.length && parts.length === raw.length)) return [isl];
  // plans that overlap are one plan in pieces (a wing, a courtyard): leave the island whole
  for (let a = 0; a < plans.length; a++) for (let c = a + 1; c < plans.length; c++) {
    const P = plans[a].box, Q = plans[c].box;
    const ov = Math.max(0, Math.min(P[2], Q[2]) - Math.max(P[0], Q[0])) * Math.max(0, Math.min(P[3], Q[3]) - Math.max(P[1], Q[1]));
    if (ov > 0.2 * Math.min(areaOf(P), areaOf(Q))) return [isl];
  }
  // every other small piece joins the plan it sits in or next to; the rest are notes, legends, keys
  const boxes = plans.map((p) => [...p.box]);
  for (const p of parts) {
    if (plans.includes(p) || others.includes(p)) continue;
    const cx = (p.box[0] + p.box[2]) / 2, cy = (p.box[1] + p.box[3]) / 2;
    let best = -1, bd = Infinity;
    plans.forEach((q, k) => { const d = Math.hypot(Math.max(q.box[0] - cx, 0, cx - q.box[2]), Math.max(q.box[1] - cy, 0, cy - q.box[3])); if (d < bd) { bd = d; best = k; } });
    if (best < 0 || bd > 2) continue;
    const bx = boxes[best];
    bx[0] = Math.min(bx[0], p.box[0]); bx[1] = Math.min(bx[1], p.box[1]); bx[2] = Math.max(bx[2], p.box[2]); bx[3] = Math.max(bx[3], p.box[3]);
  }
  return [...boxes.map((box) => ({ box, fill: 0, reach: 0 })), ...others.map((p) => ({ box: p.box, fill: 0, reach: 0, nonPlan: p.score < 4 }))];
}

// ---------------------------------------------------------------------------
// Per-floor analysis

const TYPE_RULES = [
  ['toilet', /(toilet|\bw\.?\s?c\.?\b|bath|wash ?room|powder|lav(atory)?|shower|restroom|\bt\s*[/&]\s*b\b|\bttl\b|\bw\/c\b|ba[ñn]o|aseo|sanitario|\bs\.\s?s\.|卫生间|厕所|浴室|洗手间|卫)/i],
  ['kitchen', /(kitchen|kitch|pantry|utility|wash ?area|dish|scullery|cocina|alacena|厨房|厨)/i],
  ['living', /\bplay ?(area|room|ground)?\b/i], // before 'children' makes it a bedroom
  ['bedroom', /(bed|master|guest room|kids|children|nursery|\bm\.?\s?b\.?\s?r\b|\bbr\b|dormitorio|rec[aá]mara|habitaci[oó]n|alcoba|卧室|卧)/i],
  ['living', /(living|drawing|lounge|family|hall\b|dining|study|office|library|home ?theat|media|puja|pooja|prayer|reading|sala|comedor|estar|estudio|oficina|客厅|起居|饭厅|餐厅|书房)/i],
  ['stair', /(stair|staircase|steps|escalera|楼梯)/i],
  ['lift', /(lift|elevator|ascensor|电梯)/i],
  ['duct', /(duct|shaft|\bots\b|open to sky|plumbing|\bp\.?s\.?\b|ducto|管井)/i],
  ['balcony', /(balcony|terrace|deck|sit ?out|veranda|verandah|patio|porch|chajja|projection|terraza|balc[oó]n|p[oó]rtico|阳台|露台)/i],
  ['circulation', /(passage|corridor|lobby|foyer|entrance|entry|hallway|vestibule|landing|gallery|pasillo|vest[ií]bulo|recibidor|acceso|走廊|过道|门厅|玄关)/i],
  ['parking', /(parking|stilt|driveway|garage|car ?port|drive ?way|cochera|estacionamiento|garaje|车库)/i],
  ['service', /(store|storage|electric|elec|meter|pump|guard|security|driver|servant|dress|wardrobe|closet|linen|walk-?in|laundry|room\b|bodega|lavander[ií]a|vestidor|cuarto|储藏|衣帽|工人房|洗衣)/i],
];
export const ROOM_TYPES = ['toilet', 'kitchen', 'bedroom', 'living', 'circulation', 'balcony', 'stair', 'lift', 'duct', 'service', 'parking', 'unknown'];
export const WET = new Set(['toilet', 'kitchen']);
export const DRY_HABITABLE = new Set(['bedroom', 'living']);

export function roomType(name) {
  if (!name) return 'unknown';
  for (const [t, re] of TYPE_RULES) if (re.test(name)) return t;
  return 'unknown';
}

// stair arrows, door and window notes and tags: on the plan, but not room names
const NOT_NAME = /^\s*(n|north|(sliding|folding|pocket)?\s*doors?|windows?|opening|ramp( up| down| dn)?|[dwv]\s?-?\d{1,2}[a-z]?|level|nivel|n\.?p\.?t\.?.*|[+-]?\d+([.,]\d+)?\s*(\(.*\))?|.*\bheight\b.*|\p{L}{1,3}#)\s*$/iu;
// room numbers, column and door tags: "C14", "110E", "0110-E0", "D-2", "W1A"
const CODE = /^\s*(?=[^\s]*\d)[A-Z0-9#]{1,4}([-./][A-Z0-9#]{1,6}){0,2}\s*$|^\s*(?=[^\s]*\d)[A-Z0-9]{5,12}\s*$/i;
// "UP" / "DN" still mark out the stair's own zone in an open plan
const STAIR_ARROW = /^\s*(up|dn|down|upstairs|downstairs|sube|baja|↑|↓)\s*$/i;
const SIZE_TEXT = /^\s*[\d.,'"′″\s]+[x×*]\s*[\d.,'"′″\s]+\s*$|^\s*[\d,]+(\.\d+)?\s*(sq\.?\s?(m|ft)|m2|m²|sft|sf|s\.f\.|ft2|ft²)\s*$/i;

/**
 * Analyse one floor island. Returns
 * { rooms, columns, grid, labels, footprint, outline, box, res, stats }.
 */
export function analyseFloor(dx, roles, box, opts = {}) {
  const res = opts.res ?? 0.04;
  const margin = opts.margin ?? 1.0;
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
  // openings: a wall line that stops and carries on along the same line within 3.2 m has a door,
  // window or opening between — close it, whatever layer (if any) the window is drawn on
  const hinges = dx.arcs.filter((a) => inBox(a.cx, a.cy) && a.r > 0.45 && a.r < 1.4 && a.a1 - a.a0 > 1.1 && a.a1 - a.a0 < 2.05).map((a) => [a.cx, a.cy]);
  const gaps = wallGaps(dx.segs.filter((s) => roleOf(s[4]) === 'wall' && (inBox(s[0], s[1]) || inBox(s[2], s[3]))), hinges);
  for (const [x0, y0, x1, y1] of gaps) g.seg(x0, y0, x1, y1, brush);
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
  const isName = (s) => !SIZE_TEXT.test(s) && !NOT_NAME.test(s) && !CODE.test(s) && /\p{L}/u.test(s) && s.length <= 40 && !/scale|plan\b/i.test(s);
  const queue = new Int32Array(W * H);
  // stair flights (clusters of stair-layer lines): a stair named only by its UP/DN arrow keeps to its
  // flight, and the rest of that space is a landing or goes to the rooms around it
  const flights = [];
  for (const s of dx.segs) {
    if (roleOf(s[4]) !== 'stair' || !inBox((s[0] + s[2]) / 2, (s[1] + s[3]) / 2)) continue;
    flights.push([Math.min(s[0], s[2]), Math.min(s[1], s[3]), Math.max(s[0], s[2]), Math.max(s[1], s[3])]);
  }
  for (let merged = true; merged;) {
    merged = false;
    for (let a = 0; a < flights.length && !merged; a++) for (let b = a + 1; b < flights.length; b++) {
      const A = flights[a], B = flights[b];
      if (B[0] <= A[2] + 0.6 && B[2] >= A[0] - 0.6 && B[1] <= A[3] + 0.6 && B[3] >= A[1] - 0.6) {
        flights[a] = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])];
        flights.splice(b, 1); merged = true; break;
      }
    }
  }
  const flightOf = (t) => {
    let best = null, bd = 1.5;
    for (const f of flights) { const d = Math.hypot(Math.max(f[0] - t.x, 0, t.x - f[2]), Math.max(f[1] - t.y, 0, t.y - f[3])); if (d < bd) { bd = d; best = f; } }
    return best ? [best[0] - 0.25, best[1] - 0.25, best[2] + 0.25, best[3] + 0.25] : null;
  };
  const cellIn = (c, b) => { const i = c % W, j = (c - i) / W, x = g.x0 + (i + 0.5) * res, y = g.y0 + (j + 0.5) * res; return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; };
  for (const rg of regions) {
    if (rg.outside || rg.cavity) continue;
    const seenCell = new Set();
    let names = rg.texts.filter((t) => isName(t.text)).filter((t) => (seenCell.has(t.cell) ? false : (seenCell.add(t.cell), true)));
    // no word names at all: a room number or tag ("110E") is better than nothing
    if (!names.length) { const tag = rg.texts.find((t) => CODE.test(t.text) && !SIZE_TEXT.test(t.text)); if (tag) names = [tag]; }
    const [i0, j0, i1, j1] = rg.bbox;
    const keep = names.map((t) => (STAIR_ARROW.test(t.text) ? flightOf(textAnchorXY(t)) : null));
    if (names.length === 1 && keep[0]) {
      // only an arrow: the flight is the stair, the rest of the space a landing (if there's much of it)
      let spare = -1, n = 0;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * W + i; if (lab.labels[k] === rg.id && !cellIn(k, keep[0])) { n++; if (spare < 0) spare = k; } }
      if (n * res * res >= 1.5) { names = [...names, { text: 'Landing', cell: spare, synthetic: true }]; keep.push(null); }
    }
    if (names.length <= 1) {
      const idx = draft.length;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * W + i; if (lab.labels[k] === rg.id) roomAt[k] = idx; }
      draft.push({ region: rg.id, nameText: names[0] ? names[0].text : '', texts: rg.texts, bbox: rg.bbox });
    } else {
      // multi-source flood from each name: every cell joins the name it can walk to first (an arrow's
      // zone only within its flight); anything cut off that way joins its nearest zone afterwards
      let head = 0, tail = 0;
      const base = draft.length;
      names.forEach((t, s) => { roomAt[t.cell] = base + s; queue[tail++] = t.cell; });
      for (let pass = 0; pass < 2; pass++) {
        if (pass === 1) { head = 0; tail = 0; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * W + i; if (lab.labels[k] === rg.id && roomAt[k] >= base) queue[tail++] = k; } }
        while (head < tail) {
          const c = queue[head++], v = roomAt[c], box = pass === 0 ? keep[v - base] : null;
          const i = c % W, j = (c - i) / W;
          const nb = [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, j > 0 ? c - W : -1, j < H - 1 ? c + W : -1];
          for (const n of nb) if (n >= 0 && roomAt[n] === -1 && lab.labels[n] === rg.id && (!box || cellIn(n, box))) { roomAt[n] = v; queue[tail++] = n; }
        }
      }
      names.forEach((t) => {
        // size texts belong to the nearest name in the same region
        draft.push({ region: rg.id, nameText: t.text, texts: t.synthetic ? [] : [t, ...rg.texts.filter((u) => !isName(u.text) && roomAt[u.cell] === roomAt[t.cell])], bbox: rg.bbox });
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
  // small unnamed spaces all the same size, five or more: the gaps in a pergola, deck or louvre
  const dims = draft.map((d, v) => [(rb[v][2] - rb[v][0] + 1) * res, (rb[v][3] - rb[v][1] + 1) * res]);
  const keyOf = (v) => `${Math.round(dims[v][0] / 0.05)}:${Math.round(dims[v][1] / 0.05)}`;
  const same = new Map();
  draft.forEach((d, v) => { if (cnt[v] * res * res < 3) same.set(keyOf(v), (same.get(keyOf(v)) || 0) + 1); }); // a labelled slat counts towards the pattern too
  let rooms = draft.map((d, v) => {
    const area = cnt[v] * res * res + per[v] * res * erode;
    const arrow = STAIR_ARROW.test(d.nameText || '');
    let name = arrow ? '' : d.nameText;
    const forced = types && types.get(normName(d.nameText));
    let type = forced || (arrow ? 'unknown' : roomType(d.nameText || d.texts.map((t) => t.text).join(' ')));
    if (!forced && (type === 'unknown' || type === 'service')) {
      if (hits.duct[v] >= 2 && area < 5) { type = 'duct'; name = name || 'Duct'; }
      else if (hits.lift[v] >= 2 && area < 14) { type = 'lift'; name = name || 'Lift'; }
      else if (hits.stair[v] >= (arrow ? 3 : 6) && area >= 2) { type = 'stair'; name = name || 'Staircase'; } // a flight is at least ~2 m²
    }
    const pattern = !d.nameText && cnt[v] * res * res < 3 && same.get(keyOf(v)) >= 5;
    const [bw, bh] = dims[v];
    const compact = Math.min(bw, bh) >= 0.3 && Math.max(bw, bh) <= 3 * Math.min(bw, bh);
    if (!forced && type === 'unknown' && !name && area < 1.6 && compact && !pattern) { type = 'duct'; name = 'Shaft?'; }
    const sizeText = d.texts.map((t) => t.text).find((x) => SIZE_TEXT.test(x)) || '';
    return {
      idx: v, region: d.region, name: tidyName(name) || (type === 'unknown' ? 'Unnamed space' : cap(type)), label: d.nameText || '', type, area, cellArea: cnt[v] * res * res, sizeText, pattern,
      bbox: rb[v], cx: g.x0 + (sx[v] / Math.max(1, cnt[v]) + 0.5) * res, cy: g.y0 + (sy[v] / Math.max(1, cnt[v]) + 0.5) * res,
    };
  });
  const keep = rooms.filter((r) => !r.pattern && r.area >= (r.type === 'duct' || r.type === 'lift' ? 0.05 : 0.45) && !(r.type === 'unknown' && r.area < 0.8));
  const patternArea = rooms.reduce((a, r) => a + (r.pattern ? r.area : 0), 0); // pergola / deck slats, for the area statement
  const remap = new Int32Array(nD).fill(-1);
  keep.forEach((r, k) => { remap[r.idx] = k; r.id = k; });
  for (let k = 0; k < W * H; k++) if (roomAt[k] >= 0) roomAt[k] = remap[roomAt[k]];
  rooms = keep;

  // clear width of each room: the widest circle that fits, wall face to wall face
  const wmax = new Float64Array(rooms.length);
  for (let k = 0; k < W * H; k++) { const v = roomAt[k]; if (v >= 0 && dist[k] > wmax[v]) wmax[v] = dist[k]; }
  rooms.forEach((rm, v) => { rm.width = Math.round((2 * (wmax[v] + brush) + 1) * res * 100) / 100; });

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

  // 9. walls: the footprint that is neither a room nor left-over space (drawn lines and the thin
  //    cavities between a wall's two faces). A wall cell within ~45 cm of the outside, on a wall
  //    that runs from the outside to a room, is external; the rest are partitions.
  const walls = measureWalls({ W, H, res, inside, roomAt, labels: lab.labels, regions, rooms });

  // 10. openings (what each room opens onto) and stair flights (how wide, how deep the treads)
  const sideAt = (x, y) => {
    const i = Math.floor((x - g.x0) / res), j = Math.floor((y - g.y0) / res);
    if (i < 0 || j < 0 || i >= W || j >= H) return -1;
    const k = j * W + i;
    return roomAt[k] >= 0 ? roomAt[k] : inside[k] ? -2 : -1;
  };
  const near = (s) => inBox((s[0] + s[2]) / 2, (s[1] + s[3]) / 2);
  const openings = openingsOf(gaps, doors, dx.segs.filter((s) => near(s) && roleOf(s[4]) !== 'wall' && roleOf(s[4]) !== 'dim' && roleOf(s[4]) !== 'text'), sideAt);
  const stairs = flights.map((f) => measureFlight(f, dx.segs.filter((s) => roleOf(s[4]) === 'stair' && near(s)), sideAt)).filter(Boolean);

  return {
    box, res, margin,
    grid: { x0: g.x0, y0: g.y0, w: W, h: H, res },
    labels: lab.labels, roomAt, regions, rooms, columns: cols, doors, openings, stairs,
    inside, outlines, footprintArea: fpArea * res * res, walls, patternArea,
    stats: { boundaryCells: g.data.reduce((a, v) => a + v, 0), regions: lab.count },
  };
}

/**
 * Openings in the walls: the gaps where a wall line stops and carries on (both faces of a wall
 * give one opening), each a door (a swing at its jamb), a window (lines drawn across it) or a plain
 * opening, with the spaces on its two sides: a room index, -1 for outside, -2 for neither (a wall,
 * a cavity). Layer-independent, so a window drawn on layer 0 still counts.
 */
function openingsOf(gaps, doors, across, sideAt) {
  const list = gaps.map(([x0, y0, x1, y1]) => {
    const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    return { x0, y0, x1, y1, L, ux, uy, mx: (x0 + x1) / 2, my: (y0 + y1) / 2 };
  });
  // the two faces of one wall: parallel, side by side, within 50 cm of each other
  const used = new Uint8Array(list.length), out = [];
  for (let i = 0; i < list.length; i++) {
    if (used[i]) continue;
    const a = list[i], grp = [a];
    used[i] = 1;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (used[j] || Math.abs(a.ux * b.uy - a.uy * b.ux) > 0.05) continue;
      const vx = b.mx - a.mx, vy = b.my - a.my, off = Math.abs(vx * a.uy - vy * a.ux), along = Math.abs(vx * a.ux + vy * a.uy);
      if (off <= 0.5 && along <= 0.25 * Math.max(a.L, b.L) + 0.05 && Math.abs(a.L - b.L) < 0.3) { grp.push(b); used[j] = 1; }
    }
    const mx = grp.reduce((s, q) => s + q.mx, 0) / grp.length, my = grp.reduce((s, q) => s + q.my, 0) / grp.length;
    const L = Math.max(...grp.map((q) => q.L)), nx = -a.uy, ny = a.ux;
    const offs = grp.map((q) => (q.mx - mx) * nx + (q.my - my) * ny);
    const t = Math.max(...offs) - Math.min(...offs);
    const inRect = (x, y, pad) => { const vx = x - mx, vy = y - my; return Math.abs(vx * a.ux + vy * a.uy) <= L / 2 + pad && Math.abs(vx * nx + vy * ny) <= t / 2 + pad; };
    const door = doors.some((d) => inRect(d.x, d.y, 0.3) && d.w <= L + 0.3);
    const glazed = !door && across.some((s) => {
      const sl = Math.hypot(s[2] - s[0], s[3] - s[1]);
      if (sl < 0.2 || Math.abs(((s[2] - s[0]) * a.uy - (s[3] - s[1]) * a.ux) / sl) > 0.1) return false;
      return inRect((s[0] + s[2]) / 2, (s[1] + s[3]) / 2, 0.06);
    });
    const side = (sg) => {
      for (const d of [0.2, 0.35, 0.5, 0.75]) { const v = sideAt(mx + sg * nx * (t / 2 + d), my + sg * ny * (t / 2 + d)); if (v !== -2) return v; }
      return -2;
    };
    const r3 = (v) => Math.round(v * 1000) / 1000;
    out.push({ x0: r3(mx - a.ux * L / 2), y0: r3(my - a.uy * L / 2), x1: r3(mx + a.ux * L / 2), y1: r3(my + a.uy * L / 2), w: r3(L), t: r3(t), kind: door ? 'door' : glazed ? 'window' : 'open', a: side(1), b: side(-1) });
  }
  return out.filter((o) => o.a !== o.b || o.a >= 0);
}

/** One flight of stairs: its treads (the most common direction of its lines), how wide and deep. */
function measureFlight(box, segs, sideAt) {
  const inb = (s) => { const x = (s[0] + s[2]) / 2, y = (s[1] + s[3]) / 2; return x >= box[0] - 0.01 && x <= box[2] + 0.01 && y >= box[1] - 0.01 && y <= box[3] + 0.01; };
  const lines = segs.filter(inb).map((s) => { const L = Math.hypot(s[2] - s[0], s[3] - s[1]); let th = Math.atan2(s[3] - s[1], s[2] - s[0]); if (th < 0) th += Math.PI; if (th >= Math.PI) th -= Math.PI; return { s, L, th }; }).filter((q) => q.L >= 0.5);
  if (lines.length < 5) return null;
  const bins = new Float64Array(36);
  for (const q of lines) bins[Math.round(q.th / (Math.PI / 36)) % 36]++;
  const th = bins.indexOf(Math.max(...bins)) * (Math.PI / 36);
  const tread = lines.filter((q) => { const d = Math.abs(q.th - th); return Math.min(d, Math.PI - d) < 0.07 && q.L <= 3.5; });
  if (tread.length < 5) return null;
  const nx = -Math.sin(th), ny = Math.cos(th);
  const pos = tread.map((q) => ((q.s[0] + q.s[2]) / 2) * nx + ((q.s[1] + q.s[3]) / 2) * ny).sort((p, q) => p - q);
  const goings = [];
  for (let i = 1; i < pos.length; i++) { const d = pos[i] - pos[i - 1]; if (d > 0.15 && d < 0.45) goings.push(d); }
  if (goings.length < 4) return null;
  const med = (v) => { const w = v.slice().sort((p, q) => p - q); return w[Math.floor(w.length / 2)]; };
  const votes = new Map();
  for (const q of tread) { const v = sideAt((q.s[0] + q.s[2]) / 2, (q.s[1] + q.s[3]) / 2); if (v >= 0) votes.set(v, (votes.get(v) || 0) + 1); }
  const room = votes.size ? [...votes].sort((p, q) => q[1] - p[1])[0][0] : -1;
  return { box, width: Math.round(med(tread.map((q) => q.L)) * 100) / 100, going: Math.round(med(goings) * 1000) / 1000, treads: goings.length + 1, room };
}

/**
 * Walls of one floor, owned room by room. Wall cells (drawn lines and the thin cavities between a
 * wall's faces, only where they bound a room) are split between the spaces on either side, each cell
 * going to the space it's nearest; where two owners meet inside a wall tells what that wall faces.
 * Returns { total, outside, owned: [{ area, faces: { [roomIndex | 'out']: fraction } }] } in m²,
 * so an area statement can decide what's a partition (carpet on both sides) and what's external.
 * Room areas already take back the strip the boundary brush eats, so it isn't counted twice.
 */
function measureWalls({ W, H, res, inside, roomAt, labels, regions, rooms }) {
  const N = W * H, wall = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    if (!inside[k] || roomAt[k] >= 0) continue;
    const id = labels[k];
    if (id < 0 || regions[id].cavity) wall[k] = 1;
  }
  // one wave through the walls from every room and from the outside: each cell joins the nearest
  const OUT = rooms.length, owner = new Int32Array(N).fill(-1), dist = new Int32Array(N), q = new Int32Array(N);
  let head = 0, tail = 0;
  const T = Math.max(2, Math.round(0.45 / res));
  for (let k = 0; k < N; k++) {
    if (!wall[k]) continue;
    const i = k % W;
    for (const n of [i > 0 ? k - 1 : -1, i < W - 1 ? k + 1 : -1, k >= W ? k - W : -1, k + W < N ? k + W : -1]) {
      if (n < 0) continue;
      const o = roomAt[n] >= 0 ? roomAt[n] : !inside[n] ? OUT : -1;
      if (o >= 0) { owner[k] = o; dist[k] = 1; q[tail++] = k; break; }
    }
  }
  while (head < tail) {
    const c = q[head++], i = c % W;
    if (dist[c] >= T) continue; // walls are at most ~45 cm thick: beyond that it's something else
    for (const n of [i > 0 ? c - 1 : -1, i < W - 1 ? c + 1 : -1, c >= W ? c - W : -1, c + W < N ? c + W : -1]) {
      if (n >= 0 && wall[n] && owner[n] < 0) { owner[n] = owner[c]; dist[n] = dist[c] + 1; q[tail++] = n; }
    }
  }
  const cells = new Float64Array(OUT + 1), meet = new Map(); // meet: "a,b" → cell edges where owners a and b touch
  const bump = (a, b) => { const key = a < b ? a + ',' + b : b + ',' + a; meet.set(key, (meet.get(key) || 0) + 1); };
  for (let k = 0; k < N; k++) {
    const o = owner[k];
    if (o < 0) continue;
    cells[o]++;
    if (k % W < W - 1 && owner[k + 1] >= 0 && owner[k + 1] !== o) bump(o, owner[k + 1]);
    if (k + W < N && owner[k + W] >= 0 && owner[k + W] !== o) bump(o, owner[k + W]);
  }
  const faces = Array.from({ length: OUT + 1 }, () => ({}));
  for (const [key, n] of meet) {
    const [a, b] = key.split(',').map(Number);
    faces[a][b === OUT ? 'out' : b] = (faces[a][b === OUT ? 'out' : b] || 0) + n;
    faces[b][a === OUT ? 'out' : a] = (faces[b][a === OUT ? 'out' : a] || 0) + n;
  }
  const owned = rooms.map((r, i) => {
    const f = faces[i], sum = Object.values(f).reduce((a, v) => a + v, 0);
    for (const k of Object.keys(f)) f[k] /= sum;
    return { area: Math.max(0, cells[i] * res * res - Math.max(0, r.area - r.cellArea)), faces: sum ? f : { [i]: 1 } };
  });
  const outside = cells[OUT] * res * res; // the outer half of external walls
  return { total: outside + owned.reduce((a, o) => a + o.area, 0), outside, owned };
}

const textAnchorXY = (t) => { const [x, y] = textAnchor(t); return { x, y }; };

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
