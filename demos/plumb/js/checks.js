// Plumb — floor alignment and vertical-coordination checks.

import { WET, DRY_HABITABLE } from './recognize.js';
import { distanceTransform, label } from './raster.js';

/**
 * Find the translation that puts `upper` on top of `lower` (upper coords + t = lower coords).
 * Columns vote (RANSAC over column pairs); falls back to stair/lift cores, then bounding boxes.
 */
export function alignPair(lower, upper) {
  const A = lower.columns, B = upper.columns;
  if (A.length >= 3 && B.length >= 3) {
    const cell = 0.25, key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const hash = new Map();
    for (const a of A) { const k = key(a.x, a.y); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(a); }
    const near = (x, y, tol) => {
      const i = Math.floor(x / cell), j = Math.floor(y / cell);
      let best = null, bd = tol;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        for (const a of hash.get(`${i + di},${j + dj}`) || []) {
          const d = Math.hypot(a.x - x, a.y - y);
          if (d < bd) { bd = d; best = a; }
        }
      }
      return best;
    };
    let best = null;
    const tried = new Set();
    for (const a of A) for (const b of B) {
      const tx = a.x - b.x, ty = a.y - b.y;
      const tk = `${Math.round(tx * 20)},${Math.round(ty * 20)}`;
      if (tried.has(tk)) continue;
      tried.add(tk);
      let n = 0;
      for (const c of B) if (near(c.x + tx, c.y + ty, 0.08)) n++;
      if (!best || n > best.n) best = { n, tx, ty };
    }
    if (best && best.n >= Math.max(3, Math.min(A.length, B.length) * 0.35)) {
      // refine: mean residual of the inliers
      let sx = 0, sy = 0, m = 0;
      for (const c of B) {
        const a = near(c.x + best.tx, c.y + best.ty, 0.08);
        if (a) { sx += a.x - (c.x + best.tx); sy += a.y - (c.y + best.ty); m++; }
      }
      return { tx: best.tx + sx / m, ty: best.ty + sy / m, matched: best.n, of: B.length, method: 'columns' };
    }
  }
  const core = (f) => f.rooms.find((r) => r.type === 'lift') || f.rooms.find((r) => r.type === 'stair');
  const ca = core(lower), cb = core(upper);
  if (ca && cb) return { tx: ca.cx - cb.cx, ty: ca.cy - cb.cy, matched: 0, of: B.length, method: 'core' };
  const la = lower.box, ub = upper.box;
  return { tx: la[0] - ub[0], ty: la[1] - ub[1], matched: 0, of: B.length, method: 'bounds' };
}

// ---------------------------------------------------------------------------

const SEV = { high: 3, medium: 2, low: 1 };

/** Run every check across consecutive floors. transforms[k] maps floor k → floor 0 coords. */
export function runChecks(floors, an, transforms) {
  const issues = [];
  let n = 0;
  const push = (o) => { issues.push({ id: `i${++n}`, ...o }); };
  for (let k = 1; k < floors.length; k++) {
    const lo = an[k - 1], up = an[k];
    const tx = transforms[k].tx - transforms[k - 1].tx, ty = transforms[k].ty - transforms[k - 1].ty; // upper → lower
    const pair = { lower: k - 1, upper: k };
    const where = (x, y) => describePosition(up, x, y);

    // --- columns --------------------------------------------------------------
    for (const c of up.columns) {
      const x = c.x + tx, y = c.y + ty;
      let best = null, bestOv = 0, nearest = null, nd = Infinity;
      for (const d of lo.columns) {
        const ov = overlap(c.box, d.box, tx, ty);
        if (ov > bestOv) { bestOv = ov; best = d; }
        const dd = Math.hypot(d.x - x, d.y - y);
        if (dd < nd) { nd = dd; nearest = d; }
      }
      const ratio = bestOv / (c.w * c.h);
      if (ratio >= 0.8) {
        if (best && best.w * best.h < c.w * c.h * 0.85) {
          push({ ...pair, kind: 'column-grows', severity: 'medium', at: [c.x, c.y], atLower: [best.x, best.y],
            title: 'Column gets bigger going up',
            detail: `${mm(c.w)}×${mm(c.h)} on ${the(floors[k])} sits on a ${mm(best.w)}×${mm(best.h)} column below.`,
            where: where(c.x, c.y), value: c.w * c.h - best.w * best.h });
        }
        continue;
      }
      if (nearest && nd < 0.6) {
        const off = nd;
        push({ ...pair, kind: 'column-offset', severity: off > 0.1 ? 'high' : 'medium', at: [c.x, c.y], atLower: [nearest.x, nearest.y],
          title: `Column shifted ${mm(off)} mm between floors`,
          detail: `Only ${Math.round(ratio * 100)}% of it sits on the column below — the load steps sideways (eccentricity).`,
          where: where(c.x, c.y), value: off });
        continue;
      }
      const below = describeBelow(lo, x, y);
      push({ ...pair, kind: 'floating-column', severity: 'high', at: [c.x, c.y], atLower: [x, y],
        title: 'Floating column',
        detail: `Nothing below it on ${the(floors[k - 1])}${below ? ` — it lands in the ${below}` : ''}. It needs a transfer beam, and earthquake codes (e.g. IS 1893) treat this as an irregularity.`,
        where: where(c.x, c.y), value: nd });
    }

    // --- rooms over rooms (cell-by-cell overlap) --------------------------------
    const over = overlapRooms(lo, up, tx, ty); // Map upRoomId → Map loRoomId → m²
    const loRoom = new Map(lo.rooms.map((r) => [r.id, r]));
    for (const ru of up.rooms) {
      const m = over.get(ru.id) || new Map();
      // wet over dry
      if (WET.has(ru.type)) {
        for (const [lid, a] of m) {
          const rl = loRoom.get(lid);
          if (!rl || !DRY_HABITABLE.has(rl.type)) continue;
          if (a < 0.8 && a < ru.cellArea * 0.3) continue; // a sliver along a wall is alignment, not a problem
          const sev = ru.type === 'toilet' && rl.type === 'bedroom' ? 'high' : ru.type === 'kitchen' && rl.type === 'living' ? 'low' : 'medium';
          push({ ...pair, kind: 'wet-over-dry', severity: sev, at: [ru.cx, ru.cy], atLower: [rl.cx, rl.cy], rooms: [ru.id, rl.id],
            title: `${ru.name} over ${lower(rl.name)}`,
            detail: `${a.toFixed(1)} m² of the ${lower(ru.name)} on ${the(floors[k])} is above the ${lower(rl.name)} below — drains run through its ceiling and any leak lands there. Needs a sunken slab and a dropped ceiling, or a re-plan.`,
            where: where(ru.cx, ru.cy), value: a });
        }
      }
      // ducts and cores should continue straight down
      // a small unnamed space only *might* be a shaft ("Shaft?"): not enough to raise an issue
      if ((ru.type === 'duct' || ru.type === 'lift' || ru.type === 'stair') && ru.name !== 'Shaft?') {
        let same = 0;
        for (const [lid, a] of m) { const rl = loRoom.get(lid); if (rl && rl.type === ru.type) same += a; }
        const ratio = same / ru.cellArea;
        const need = ru.type === 'lift' ? 0.9 : ru.type === 'duct' ? 0.7 : 0.65;
        if (ratio >= need) continue;
        const cands = lo.rooms.filter((r) => r.type === ru.type);
        let nearest = null, nd = Infinity;
        for (const r of cands) { const d = Math.hypot(r.cx - (ru.cx + tx), r.cy - (ru.cy + ty)); if (d < nd) { nd = d; nearest = r; } }
        const label = ru.type === 'duct' ? 'Duct' : ru.type === 'lift' ? 'Lift well' : 'Staircase';
        if (nearest && nd < 2.5) {
          // centred on the one below: only the drawn shape differs (a stair's top flight and its
          // opening, a duct narrowing as it rises). A lift well still has to be the same size.
          if (nd < 0.15 && ru.type !== 'lift') continue;
          push({ ...pair, kind: `${ru.type}-offset`, severity: ru.type === 'stair' ? 'medium' : 'high', at: [ru.cx, ru.cy], atLower: [nearest.cx, nearest.cy], rooms: [ru.id, nearest.id],
            title: nd < 0.05 ? `${label} changes size` : `${label} shifted ${mm(nd)} mm`,
            detail: ru.type === 'duct'
              ? `Only ${Math.round(ratio * 100)}% of this ${lower(ru.name)} lines up with the one below. Vertical stacks (soil, waste, vent) can't jog without offsets and cleanouts.`
              : `Only ${Math.round(ratio * 100)}% overlaps the floor below. ${ru.type === 'lift' ? 'A lift well has to be dead straight.' : 'Flights and landings should stack.'}`,
            where: where(ru.cx, ru.cy), value: nd });
        } else {
          push({ ...pair, kind: `${ru.type}-missing`, severity: ru.type === 'duct' ? 'medium' : 'high', at: [ru.cx, ru.cy], atLower: [ru.cx + tx, ru.cy + ty], rooms: [ru.id],
            title: `${label} doesn't continue down`,
            detail: `There is no ${label.toLowerCase()} under it on ${the(floors[k - 1])}${describeBelow(lo, ru.cx + tx, ru.cy + ty) ? ` (it lands in the ${describeBelow(lo, ru.cx + tx, ru.cy + ty)})` : ''}.`,
            where: where(ru.cx, ru.cy), value: 0 });
        }
      }
    }

    // --- cantilevers --------------------------------------------------------------
    for (const c of cantilevers(lo, up, tx, ty)) {
      const sev = c.depth > 1.8 ? 'high' : c.depth > 1.2 ? 'medium' : 'low';
      push({ ...pair, kind: 'cantilever', severity: sev, at: c.at, atLower: [c.at[0] + tx, c.at[1] + ty],
        title: `Projects ${c.depth.toFixed(1)} m beyond the floor below`,
        detail: `${c.area.toFixed(1)} m²${c.room ? ` (${lower(c.room)})` : ''} hangs out past ${the(floors[k - 1])}. ${c.depth > 1.8 ? 'That is a long cantilever — get the structural engineer to confirm depth and back-span.' : c.depth > 1.2 ? 'Check the slab/beam cantilever design.' : 'Typical for a balcony or chajja.'}`,
        where: where(c.at[0], c.at[1]), value: c.depth });
    }
  }
  issues.sort((p, q) => SEV[q.severity] - SEV[p.severity] || p.upper - q.upper);
  return issues;
}

function overlap(a, b, tx, ty) {
  const x0 = Math.max(a[0] + tx, b[0]), x1 = Math.min(a[2] + tx, b[2]);
  const y0 = Math.max(a[1] + ty, b[1]), y1 = Math.min(a[3] + ty, b[3]);
  return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0;
}

/** For every room cell on the upper floor, which lower room is underneath? */
function overlapRooms(lo, up, tx, ty) {
  const out = new Map();
  const gu = up.grid, gl = lo.grid;
  const cellA = gu.res * gu.res;
  for (let j = 0; j < gu.h; j++) {
    for (let i = 0; i < gu.w; i++) {
      const id = up.roomAt[j * gu.w + i];
      if (id < 0) continue;
      const x = gu.x0 + (i + 0.5) * gu.res + tx, y = gu.y0 + (j + 0.5) * gu.res + ty;
      const li = Math.floor((x - gl.x0) / gl.res), lj = Math.floor((y - gl.y0) / gl.res);
      if (li < 0 || lj < 0 || li >= gl.w || lj >= gl.h) continue;
      const lid = lo.roomAt[lj * gl.w + li];
      if (lid < 0) continue;
      if (!out.has(id)) out.set(id, new Map());
      const m = out.get(id);
      m.set(lid, (m.get(lid) || 0) + cellA);
    }
  }
  return out;
}

/** Parts of the upper footprint with no footprint below them. */
function cantilevers(lo, up, tx, ty) {
  const gu = up.grid, gl = lo.grid;
  const W = gu.w, H = gu.h;
  const proj = new Uint8Array(W * H), supported = new Uint8Array(W * H);
  let any = false;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (!up.inside[k]) continue;
    const x = gu.x0 + (i + 0.5) * gu.res + tx, y = gu.y0 + (j + 0.5) * gu.res + ty;
    const li = Math.floor((x - gl.x0) / gl.res), lj = Math.floor((y - gl.y0) / gl.res);
    const below = li >= 0 && lj >= 0 && li < gl.w && lj < gl.h && lo.inside[lj * gl.w + li];
    if (below) supported[k] = 1; else { proj[k] = 1; any = true; }
  }
  if (!any) return [];
  const dist = distanceTransform(supported, W, H);
  const lab = label(proj, W, H, 1);
  // how thick each overhang is: a strip under ~0.8 m is a wall, fence or parapet line, not a slab
  const open = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) open[k] = proj[k] ? 0 : 1;
  const inner = distanceTransform(open, W, H);
  const out = [];
  for (let id = 0; id < lab.count; id++) {
    const area = lab.sizes[id] * gu.res * gu.res;
    if (area < 0.6) continue;
    let depth = 0, ax = 0, ay = 0, n = 0, thick = 0;
    const roomArea = new Map();
    const [i0, j0, i1, j1] = lab.bbox[id];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * W + i;
      if (lab.labels[k] !== id) continue;
      if (inner[k] > thick) thick = inner[k];
      if (dist[k] > depth) depth = dist[k];
      ax += i; ay += j; n++;
      const rid = up.roomAt[k];
      if (rid >= 0) roomArea.set(rid, (roomArea.get(rid) || 0) + 1);
    }
    depth *= gu.res;
    if (depth < 0.45) continue; // slivers from drawing differences
    if (2 * thick * gu.res < 0.8 && depth > 4 * thick * gu.res) continue; // a thin line sticking out (a garden wall, a fence), not a slab or a chajja
    let room = null, rb = 0;
    for (const [rid, c] of roomArea) { if (c > rb) { const r = up.rooms[rid]; if (r) { rb = c; room = r.name; } } }
    out.push({ area, depth, at: [gu.x0 + (ax / n + 0.5) * gu.res, gu.y0 + (ay / n + 0.5) * gu.res], room });
  }
  return out;
}

function describeBelow(lo, x, y) {
  const g = lo.grid;
  const i = Math.floor((x - g.x0) / g.res), j = Math.floor((y - g.y0) / g.res);
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return '';
  const id = lo.roomAt[j * g.w + i];
  const r = id >= 0 ? lo.rooms[id] : null;
  return r ? lower(r.name) : '';
}

/** "top-right of the plan" style hint, relative to the floor's footprint. */
function describePosition(f, x, y) {
  const [x0, y0, x1, y1] = f.box;
  const fx = (x - x0) / Math.max(1e-6, x1 - x0), fy = (y - y0) / Math.max(1e-6, y1 - y0);
  const v = fy > 0.66 ? 'top' : fy < 0.34 ? 'bottom' : 'middle';
  const h = fx > 0.66 ? 'right' : fx < 0.34 ? 'left' : 'centre';
  return v === 'middle' && h === 'centre' ? 'centre of the plan' : v === 'middle' ? `${h} side` : h === 'centre' ? `${v} middle` : `${v}-${h}`;
}

const mm = (m) => Math.round(m * 1000);
/** "Bed Room" → "bed room", but abbreviations stay as drawn: "T&B", "W.C.", "OTS". */
const lower = (s) => (/^[A-Z0-9&./ ]{1,5}$/.test(s) ? s : s.toLowerCase());
/** "FIRST FLOOR PLAN" → "the first floor" */
const the = (f) => 'the ' + String(f.title || '').toLowerCase().replace(/\bplan\b/, '').replace(/\s+/g, ' ').trim();
