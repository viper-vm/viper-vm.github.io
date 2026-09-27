// Plumb — from a 2D floor plan to 3D building parts: solid walls (the space between a wall's
// two lines is wall), low parapets round balconies, lintels over doors, and window openings.
// Works on a fine raster so it copes with however the walls were drawn (lines, polylines,
// hatches, curves), then traces clean outlines to extrude.

import { Grid, label, distanceTransform, allContours, polyArea, pointInPoly } from './raster.js';

const WALLISH = new Set(['wall', 'column']);

/**
 * One floor → { walls:[{outer, holes}], parapets:[…], doors:[{x0,y0,x1,y1,t,c}], windows:[{cx,cy,ang,len,t}], res }.
 * All coordinates in the floor's own metres (as in the analysis).
 */
export function massFloor(dx, roles, an) {
  const [bx0, by0, bx1, by1] = an.box;
  const span = Math.max(bx1 - bx0, by1 - by0);
  const res = Math.max(0.025, span / 2600);
  const m = 1.2;
  const g = new Grid(bx0 - m, by0 - m, bx1 + m, by1 + m, res);
  const W = g.w, H = g.h;
  const inBox = (x, y) => x >= bx0 - m && x <= bx1 + m && y >= by0 - m && y <= by1 + m;
  const roleOf = (layer) => (roles.get(layer) || { role: 'other' }).role;

  // 1. wall linework, stamped as a gap-free (supercover) one-cell line
  const B = g.data;
  for (const s of dx.segs) {
    if (!WALLISH.has(roleOf(s[4]))) continue;
    if (!inBox(s[0], s[1]) && !inBox(s[2], s[3])) continue;
    stampLine(g, s[0], s[1], s[2], s[3]);
  }
  for (const f of dx.fills) if (WALLISH.has(roleOf(f.layer)) && f.pts.some((p) => inBox(p[0], p[1]))) g.poly(f.pts, 1);

  // 2. the inside of a wall is a thin closed pocket of "free" space: fill it
  const lab = label(B, W, H, 0);
  const dt = distanceTransform(B, W, H);
  const maxDT = new Float64Array(lab.count);
  for (let k = 0; k < W * H; k++) { const id = lab.labels[k]; if (id >= 0 && dt[k] > maxDT[id]) maxDT[id] = dt[k]; }
  const fill = new Uint8Array(lab.count);
  for (let id = 0; id < lab.count; id++) {
    if (lab.touchesBorder[id]) continue;
    const area = lab.sizes[id] * res * res;
    if (maxDT[id] * res < 0.2 || area < 0.03) fill[id] = 1;
  }
  for (let k = 0; k < W * H; k++) { const id = lab.labels[k]; if (id >= 0 && fill[id]) B[k] = 1; }

  // 3. parapets: wall cells that only ever face a balcony (or the outside)
  const ag = an.grid;
  const bal = new Uint8Array(W * H), room = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const y = g.y0 + (j + 0.5) * res, lj = Math.floor((y - ag.y0) / ag.res);
    if (lj < 0 || lj >= ag.h) continue;
    for (let i = 0; i < W; i++) {
      const x = g.x0 + (i + 0.5) * res, li = Math.floor((x - ag.x0) / ag.res);
      if (li < 0 || li >= ag.w) continue;
      const rid = an.roomAt[lj * ag.w + li];
      if (rid < 0) continue;
      const r = an.rooms[rid];
      if (r && r.type === 'balcony') bal[j * W + i] = 1; else room[j * W + i] = 1;
    }
  }
  const dBal = distanceTransform(bal, W, H), dRoom = distanceTransform(room, W, H);
  const reach = 0.45 / res;
  const par = new Uint8Array(W * H), full = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    if (!B[k]) continue;
    if (dBal[k] <= reach && dRoom[k] > reach) par[k] = 1; else full[k] = 1;
  }

  // 4. doors: every door swing marks an opening (hinge → the jamb it closes against)
  const doors = [];
  const at = (x, y) => { const i = Math.floor((x - g.x0) / res), j = Math.floor((y - g.y0) / res); return i >= 0 && j >= 0 && i < W && j < H ? B[j * W + i] : 0; };
  const leafLines = dx.segs.filter((s) => roleOf(s[4]) === 'door' && inBox(s[0], s[1]));
  for (const a of dx.arcs) {
    const sw = a.a1 - a.a0, r = roleOf(a.layer);
    if (!inBox(a.cx, a.cy) || !(a.r > 0.45 && a.r < 1.4 && sw > 1.1 && sw < 2.05)) continue;
    if (r !== 'door' && r !== 'other' && r !== 'wall' && r !== 'window') continue;
    const d0 = [Math.cos(a.a0), Math.sin(a.a0)], d1 = [Math.cos(a.a1), Math.sin(a.a1)];
    // the leaf is drawn along one radius; the doorway runs along the other
    const along = (d) => leafLines.some((s) => {
      const u = [s[2] - s[0], s[3] - s[1]], L = Math.hypot(u[0], u[1]);
      if (L < a.r * 0.6) return false;
      const near = Math.hypot(s[0] - a.cx, s[1] - a.cy) < 0.05 || Math.hypot(s[2] - a.cx, s[3] - a.cy) < 0.05;
      return near && Math.abs((u[0] * d[0] + u[1] * d[1]) / L) > 0.98;
    });
    const jamb = (d) => at(a.cx + d[0] * (a.r + 0.07), a.cy + d[1] * (a.r + 0.07));
    let dc;
    if (along(d0) !== along(d1)) dc = along(d0) ? d1 : d0;
    else if (jamb(d0) !== jamb(d1)) dc = jamb(d0) ? d0 : d1;
    else dc = d0;
    // wall thickness across the doorway, measured just behind the hinge
    const n = [-dc[1], dc[0]];
    const bx = a.cx - dc[0] * 0.06, by = a.cy - dc[1] * 0.06;
    let lo = 0, hi = 0;
    for (let s = 0; s < 0.7; s += res / 2) { if (at(bx + n[0] * s, by + n[1] * s)) hi = s; else if (s > 0.08) break; }
    for (let s = 0; s < 0.7; s += res / 2) { if (at(bx - n[0] * s, by - n[1] * s)) lo = s; else if (s > 0.08) break; }
    let t = hi + lo + res, c = (hi - lo) / 2;
    if (t < 0.08) { t = 0.2; c = 0; }
    doors.push({ x0: a.cx + n[0] * c, y0: a.cy + n[1] * c, x1: a.cx + dc[0] * a.r + n[0] * c, y1: a.cy + dc[1] * a.r + n[1] * c, t: Math.min(t, 0.6) });
  }

  // 5. windows: glazing lines, merged per opening, as oriented boxes
  const win = new Grid(bx0 - m, by0 - m, bx1 + m, by1 + m, res);
  const grow = Math.max(1, Math.round(0.06 / res));
  let anyWin = false;
  for (const s of dx.segs) {
    if (roleOf(s[4]) !== 'window') continue;
    if (!inBox(s[0], s[1]) && !inBox(s[2], s[3])) continue;
    win.seg(s[0], s[1], s[2], s[3], grow);
    anyWin = true;
  }
  const windows = [];
  if (anyWin) {
    const wl = label(win.data, W, H, 1);
    const acc = Array.from({ length: wl.count }, () => [0, 0, 0, 0, 0, 0]); // n, sx, sy, sxx, syy, sxy
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const id = wl.labels[j * W + i];
      if (id < 0) continue;
      const q = acc[id]; q[0]++; q[1] += i; q[2] += j; q[3] += i * i; q[4] += j * j; q[5] += i * j;
    }
    acc.forEach((q, id) => {
      const nn = q[0];
      if (nn < 4) return;
      const mx = q[1] / nn, my = q[2] / nn;
      const cxx = q[3] / nn - mx * mx, cyy = q[4] / nn - my * my, cxy = q[5] / nn - mx * my;
      const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      const u = [Math.cos(ang), Math.sin(ang)], v = [-u[1], u[0]];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      const [i0, j0, i1, j1] = wl.bbox[id];
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (wl.labels[j * W + i] !== id) continue;
        const px = i - mx, py = j - my, pa = px * u[0] + py * u[1], pb = px * v[0] + py * v[1];
        if (pa < a0) a0 = pa; if (pa > a1) a1 = pa; if (pb < b0) b0 = pb; if (pb > b1) b1 = pb;
      }
      const len = (a1 - a0 + 1 - 2 * grow) * res, t = (b1 - b0 + 1 - 2 * grow) * res;
      if (len < 0.3 || t > 0.9) return;
      const cA = (a0 + a1) / 2, cB = (b0 + b1) / 2;
      const ci = mx + u[0] * cA + v[0] * cB, cj = my + u[1] * cA + v[1] * cB;
      windows.push({ cx: g.x0 + (ci + 0.5) * res, cy: g.y0 + (cj + 0.5) * res, ang, len, t: Math.max(0.08, Math.min(t, 0.6)) });
    });
  }

  return { res, walls: shapes(full, g), parapets: shapes(par, g), doors, windows };
}

/** Mask → polygons with holes, in metres. */
function shapes(mask, g) {
  const loops = allContours((k) => mask[k] === 1, g.w, g.h, 0.9).map((L) => ({ pts: L.map(([i, j]) => [g.x0 + i * g.res, g.y0 + j * g.res]), a: polyArea(L) }));
  const outers = loops.filter((l) => l.a < 0 && -l.a * g.res * g.res > 0.004).map((l) => ({ outer: l.pts, holes: [], area: -l.a }));
  outers.sort((p, q) => p.area - q.area);
  for (const h of loops) {
    if (h.a <= 0 || h.a * g.res * g.res < 0.004) continue;
    const [x, y] = h.pts[0];
    const home = outers.find((o) => pointInPoly(x, y, o.outer));
    if (home) home.holes.push(h.pts);
  }
  return outers.map(({ outer, holes }) => ({ outer, holes }));
}

/** A one-cell line with no diagonal leaks (4-connected), so thin wall pockets stay closed. */
function stampLine(g, x1, y1, x2, y2) {
  const a0 = g.cx(x1), b0 = g.cy(y1), a1 = g.cx(x2), b1 = g.cy(y2);
  const n = Math.max(1, Math.ceil(Math.hypot(a1 - a0, b1 - b0) * 3));
  let pi = -1, pj = -1;
  for (let k = 0; k <= n; k++) {
    const t = k / n, i = Math.floor(a0 + (a1 - a0) * t), j = Math.floor(b0 + (b1 - b0) * t);
    if (i === pi && j === pj) continue;
    if (pi >= 0 && i !== pi && j !== pj) put(g, i, pj);
    put(g, i, j);
    pi = i; pj = j;
  }
}
function put(g, i, j) { if (i >= 0 && j >= 0 && i < g.w && j < g.h) g.data[j * g.w + i] = 1; }
