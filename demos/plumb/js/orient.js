// Plumb — floors drawn turned or mirrored on the sheet. A floor can carry an orientation (a 2×2
// matrix of 0/±1: flips and quarter turns); its linework is then copied, turned, into free space
// beside the sheet and read from there, while the sheet itself stays as drawn (so a wall shared with
// the plan next door still belongs to both). Points go back to the sheet with sheetPoint().
// Also: which orientation of a floor best fits the floor below, and whether one plan is two mirrored
// halves (two flats round a stair, usually — not two floors).

export const IDENTITY = [1, 0, 0, 1];
export const OPS = {
  rotl: [0, -1, 1, 0],   // a quarter turn anticlockwise
  rotr: [0, 1, -1, 0],   // a quarter turn clockwise
  flipx: [-1, 0, 0, 1],  // mirror left ↔ right
  flipy: [1, 0, 0, -1],  // mirror top ↔ bottom
};
/** Every orientation: four quarter turns, each plain and mirrored. */
export const ALL = [[1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0], [-1, 0, 0, 1], [0, 1, 1, 0], [1, 0, 0, -1], [0, -1, -1, 0]];

/** a·b (apply b, then a) */
export const compose = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];
export const isIdentity = (m) => !m || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1);
const det = (m) => m[0] * m[3] - m[1] * m[2];

/** In words, for the page: “Turned 90° clockwise, mirrored”. */
export function orientText(m) {
  if (isIdentity(m)) return '';
  const mir = det(m) < 0;
  // with a mirror, read it as “mirrored left ↔ right, then turned”
  const r = mir ? compose(m, OPS.flipx) : m;
  const turn = r[0] === 1 ? 0 : r[0] === -1 ? 180 : r[2] === 1 ? 90 : 270;
  if (mir && turn === 180) return 'Mirrored top ↔ bottom';
  const t = turn === 0 ? '' : turn === 180 ? 'Turned 180°' : turn === 90 ? 'Turned 90° anticlockwise' : 'Turned 90° clockwise';
  return mir ? (t ? `Mirrored left ↔ right, ${t.toLowerCase()}` : 'Mirrored left ↔ right') : t;
}

const ap = (m, x, y) => [m[0] * x + m[1] * y, m[2] * x + m[3] * y];
const angDeg = (m, deg) => { const r = (deg * Math.PI) / 180, v = ap(m, Math.cos(r), Math.sin(r)); return (Math.atan2(v[1], v[0]) * 180) / Math.PI; };

/**
 * Copy each oriented floor's linework, turned, beside the sheet; returns the floors to read (an
 * oriented one gets its new box and `place`, the way back to the sheet). dx gains the copies; what
 * was on the sheet before is remembered in dx.sheetN so the sheet view leaves them out.
 */
export function orientFloors(dx, floors, margins) {
  if (!floors.some((f) => !isIdentity(f.orient))) return floors;
  dx.sheetN ||= { segs: dx.segs.length, texts: dx.texts.length, bounds: { ...dx.bounds } };
  let freeX = dx.bounds.x1 + 40;
  const src = { segs: dx.segs.slice(), arcs: dx.arcs.slice(), circles: dx.circles.slice(), texts: dx.texts.slice(), fills: dx.fills.slice(), inserts: (dx.inserts || []).slice(), dims: (dx.dims || []).slice() };
  return floors.map((f, k) => {
    if (isIdentity(f.orient)) return f;
    const M = f.orient, m = margins[k] ?? 1;
    const [x0, y0, x1, y1] = f.box;
    const inb = (x, y) => x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m;
    const c = [(x0 + x1) / 2, (y0 + y1) / 2];
    const [hw, hh] = ap(M, (x1 - x0) / 2, (y1 - y0) / 2).map(Math.abs);
    const o = [freeX + hw + m, c[1]];
    freeX += 2 * hw + 2 * m + 40;
    const T = (x, y) => { const v = ap(M, x - c[0], y - c[1]); return [o[0] + v[0], o[1] + v[1]]; };
    const mir = det(M) < 0;
    // text reads the right way round whatever the turn: mirrored text isn't mirrored letters
    const textRot = (rot) => { let a = angDeg(M, rot || 0); if (mir) { a = ((a % 360) + 360) % 360; if (a > 90 && a <= 270) a -= 180; } return a; };
    for (const s of src.segs) if (inb((s[0] + s[2]) / 2, (s[1] + s[3]) / 2)) { const p = T(s[0], s[1]), q = T(s[2], s[3]); dx.segs.push([p[0], p[1], q[0], q[1], s[4]]); }
    for (const a of src.arcs) if (inb(a.cx, a.cy)) {
      const p = T(a.cx, a.cy), d0 = (angDeg(M, (a.a0 * 180) / Math.PI) * Math.PI) / 180, d1 = (angDeg(M, (a.a1 * 180) / Math.PI) * Math.PI) / 180;
      let b0 = mir ? d1 : d0, b1 = mir ? d0 : d1;
      while (b1 < b0) b1 += 2 * Math.PI;
      dx.arcs.push({ ...a, cx: p[0], cy: p[1], a0: b0, a1: b1 });
    }
    for (const q of src.circles) if (inb(q.cx, q.cy)) { const p = T(q.cx, q.cy); dx.circles.push({ ...q, cx: p[0], cy: p[1] }); }
    for (const t of src.texts) if (inb(t.x, t.y)) { const p = T(t.x, t.y); dx.texts.push({ ...t, x: p[0], y: p[1], rot: textRot(t.rot) }); }
    for (const fl of src.fills) { const n = fl.pts.length; if (!n) continue; const cx = fl.pts.reduce((s, q) => s + q[0], 0) / n, cy = fl.pts.reduce((s, q) => s + q[1], 0) / n; if (inb(cx, cy)) dx.fills.push({ ...fl, pts: fl.pts.map((q) => T(q[0], q[1])) }); }
    for (const i of src.inserts) if (inb(i.x, i.y)) { const p = T(i.x, i.y); dx.inserts.push({ ...i, x: p[0], y: p[1], rot: angDeg(M, i.rot || 0) }); }
    for (const d of src.dims) {
      const at = d.p11 || d.p10 || d.p13;
      if (!at || !inb(at[0], at[1])) continue;
      const P = (q) => (q ? T(q[0], q[1]) : null);
      const base = [dx.dimSegs.length, dx.dimTexts.length, dx.dimFills.length];
      const [[s0, s1], [t0, t1], [f0, f1]] = d.ranges;
      for (let i = s0; i < s1; i++) { const q = dx.dimSegs[i], p = T(q[0], q[1]), r = T(q[2], q[3]); dx.dimSegs.push([p[0], p[1], r[0], r[1], q[4]]); }
      for (let i = t0; i < t1; i++) { const t = dx.dimTexts[i], p = T(t.x, t.y); dx.dimTexts.push({ ...t, x: p[0], y: p[1], rot: textRot(t.rot) }); }
      for (let i = f0; i < f1; i++) dx.dimFills.push({ ...dx.dimFills[i], pts: dx.dimFills[i].pts.map((q) => T(q[0], q[1])) });
      dx.dims.push({ ...d, p10: P(d.p10), p11: P(d.p11), p13: P(d.p13), p14: P(d.p14), p15: P(d.p15), p16: P(d.p16), rot: angDeg(M, d.rot || 0), ranges: [[base[0], dx.dimSegs.length], [base[1], dx.dimTexts.length], [base[2], dx.dimFills.length]] });
    }
    return { ...f, box: [o[0] - hw, o[1] - hh, o[0] + hw, o[1] + hh], sheetBox: f.box, place: { m: M, c, o } };
  });
}

/** A point of an oriented floor back where it is on the sheet (other floors: unchanged). */
export function sheetPoint(f, x, y) {
  if (!f || !f.place) return [x, y];
  const { m, c, o } = f.place;
  // the inverse of a flip-and-quarter-turn is its transpose
  return [c[0] + m[0] * (x - o[0]) + m[2] * (y - o[1]), c[1] + m[1] * (x - o[0]) + m[3] * (y - o[1])];
}

// ------------------------------------------------------------------ fitting footprints

/** The floor's footprint as points (cell centres, every `step` m) about its centroid, and its core (stairs, lifts, ducts). */
function footprint(an, step = 0.25) {
  const g = an.grid, inside = an.inside;
  if (!g || !inside) return null;
  const every = Math.max(1, Math.round(step / g.res)), pts = [], core = [];
  const isCore = new Set((an.rooms || []).filter((r) => r.type === 'stair' || r.type === 'lift' || (r.type === 'duct' && r.name !== 'Shaft?')).map((r) => r.id));
  for (let j = 0; j < g.h; j += every) for (let i = 0; i < g.w; i += every) {
    const k = j * g.w + i;
    if (!inside[k]) continue;
    const p = [g.x0 + (i + 0.5) * g.res, g.y0 + (j + 0.5) * g.res];
    pts.push(p);
    if (an.roomAt && isCore.has(an.roomAt[k])) core.push(p);
  }
  if (pts.length < 20) return null;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const rel = (p) => [p[0] - cx, p[1] - cy];
  return { pts: pts.map(rel), core: core.map(rel), step: every * g.res };
}
/** How well two floors overlap (intersection over union of the footprints, and of the cores when both have one), the second turned by m, nudged a little. */
function overlap(A, B, m, step) {
  const key = (x, y) => Math.round(x / step) + ',' + Math.round(y / step);
  const setA = new Set(A.pts.map((p) => key(p[0], p[1]))), coreA = new Set(A.core.map((p) => key(p[0], p[1])));
  const useCore = coreA.size >= 4 && B.core.length >= 4;
  const iou = (set, list, sx, sy) => {
    let hit = 0;
    const seen = new Set();
    for (const p of list) { const v = ap(m, p[0], p[1]), k = key(v[0] + sx, v[1] + sy); if (seen.has(k)) continue; seen.add(k); if (set.has(k)) hit++; }
    return hit / (set.size + seen.size - hit || 1);
  };
  let best = 0;
  for (const dx of [-2, -1, 0, 1, 2]) for (const dy of [-2, -1, 0, 1, 2]) {
    const sx = dx * step, sy = dy * step, f = iou(setA, B.pts, sx, sy);
    const s = useCore ? 0.5 * f + 0.5 * iou(coreA, B.core, sx, sy) : f;
    if (s > best) best = s;
  }
  return best;
}

/**
 * Does floor `upper` fit the floor below better turned or mirrored? Returns { orient, fit, now } when
 * some other orientation overlaps clearly better than it does as drawn, else null. `orient` is the
 * extra turn to apply to the floor as it's read now.
 */
export function fitOrientation(below, upper) {
  const A = footprint(below), B = footprint(upper);
  if (!A || !B) return null;
  const step = Math.max(A.step, B.step);
  const now = overlap(A, B, IDENTITY, step);
  let best = null;
  for (const m of ALL.slice(1)) { const s = overlap(A, B, m, step); if (!best || s > best.fit) best = { orient: m, fit: s }; }
  return best && best.fit >= 0.55 && best.fit > now + 0.15 ? { ...best, now } : null;
}

/**
 * Is this one plan two mirrored halves, side by side (left ↔ right) or one above the other? That's
 * how a floor of two flats round a stair is usually drawn. Returns { axis: 'x'|'y', at, fit } or null.
 */
export function mirroredHalves(an) {
  const F = footprint(an, 0.3);
  if (!F) return null;
  const xs = F.pts.map((p) => p[0]), ys = F.pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  let best = null;
  for (const [axis, m, long] of [['x', OPS.flipx, w >= h], ['y', OPS.flipy, h > w]]) {
    const fit = overlap({ pts: F.pts, core: [] }, { pts: F.pts, core: [] }, m, F.step);
    if (fit >= 0.93 && long && (!best || fit > best.fit)) best = { axis, fit };
  }
  if (!best) return null;
  // the axis in drawing coordinates: the footprint's centroid
  const g = an.grid, inside = an.inside;
  let sx = 0, sy = 0, n = 0;
  for (let j = 0; j < g.h; j += 2) for (let i = 0; i < g.w; i += 2) if (inside[j * g.w + i]) { sx += i; sy += j; n++; }
  return { ...best, at: best.axis === 'x' ? g.x0 + (sx / n + 0.5) * g.res : g.y0 + (sy / n + 0.5) * g.res };
}
