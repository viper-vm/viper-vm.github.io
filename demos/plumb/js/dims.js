// Plumb — the drawing's own dimensions: DIMENSION entities (drawn from their blocks exactly as
// on the sheet, or rebuilt from their definition points when a file carries no block) plus
// whatever sits on dimension layers. Each dimension string goes to the floor plan it belongs to.

import { cleanText } from './dxf.js';

/** A length in the drawing's own units, written the way that drawing would write it. */
export function formatLength(v, mm) {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (mm === 25.4 || mm === 304.8) {
    const inches = Math.round(mm === 304.8 ? a * 12 : a);
    const ft = Math.floor(inches / 12), inch = inches % 12;
    return ft ? `${ft}'-${inch}"` : `${inch}"`;
  }
  if (mm === 1000) return a.toFixed(2);
  if (mm === 10) return (Math.round(a * 10) / 10).toString();
  return String(Math.round(a));
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
/** Text angle that reads left-to-right or bottom-to-top. */
const readable = (deg) => { let d = ((deg % 360) + 360) % 360; if (d > 90.5 && d <= 270.5) d -= 180; return d; };

/** Label: the override text (with <> standing for the measured value), else the measurement. */
function labelOf(d, measured, mm) {
  const value = d.value != null ? d.value : measured;
  const fmt = d.type === 2 || d.type === 5 ? `${Math.round((value * 180) / Math.PI)}°` : formatLength(value, mm);
  const o = d.label ? cleanText(d.label, true) : '';
  if (o && o !== '<>') return o.replace(/<>/g, fmt);
  return (d.type === 3 ? '⌀' : d.type === 4 ? 'R' : '') + fmt;
}

/** Rebuild a dimension from its definition points (files that carry no *D block). */
export function synthesize(d, h, mm) {
  const k = mm / 1000; // metres per drawing unit
  const segs = [], texts = [];
  const text = (at, rot, measured) => texts.push({ x: at[0], y: at[1], h, rot: readable(rot), text: labelOf(d, measured, mm), ha: 4, va: 0 });
  if ((d.type === 0 || d.type === 1) && d.p13 && d.p14 && d.p10) {
    const dir = d.type === 0 ? [Math.cos((d.rot * Math.PI) / 180), Math.sin((d.rot * Math.PI) / 180)] : unit(sub(d.p14, d.p13));
    const foot = (p) => add(d.p10, mul(dir, dot(sub(p, d.p10), dir)));
    const f13 = foot(d.p13), f14 = foot(d.p14);
    segs.push([...f13, ...f14]);
    for (const [p, f] of [[d.p13, f13], [d.p14, f14]]) {
      const v = sub(f, p), L = len(v);
      if (L > 1e-9) { const u = mul(v, 1 / L); segs.push([...add(p, mul(u, Math.min(h * 0.6, L * 0.3))), ...add(f, mul(u, h * 0.6))]); }
      const t = unit([dir[0] - dir[1], dir[0] + dir[1]]); // architectural tick at 45°
      segs.push([...add(f, mul(t, -h * 0.55)), ...add(f, mul(t, h * 0.55))]);
    }
    const mid = mul(add(f13, f14), 0.5), n = [-dir[1], dir[0]];
    const at = d.p11 || add(mid, mul(n, h * 0.8));
    text(at, (Math.atan2(dir[1], dir[0]) * 180) / Math.PI, len(sub(f14, f13)) / k);
  } else if ((d.type === 3 || d.type === 4) && d.p10 && d.p15) {
    segs.push([...d.p10, ...d.p15]);
    const v = sub(d.p15, d.p10);
    text(d.p11 || mul(add(d.p10, d.p15), 0.5), (Math.atan2(v[1], v[0]) * 180) / Math.PI, len(v) / k);
  } else if (d.p11) {
    text(d.p11, 0, d.value || 0);
  }
  return { segs, texts };
}

/**
 * Per floor: everything dimensional that belongs to it, as {segs: Float64Array, texts, fills, count}.
 * dx is in metres; boxes are the floors' boxes.
 */
export function floorDims(dx, roles, boxes, unitMM) {
  const tol = boxes.map((b) => Math.max(4, 0.35 * Math.max(b[2] - b[0], b[3] - b[1])));
  const nearest = (x, y) => {
    let best = -1, bd = Infinity;
    boxes.forEach((b, i) => {
      const dx0 = Math.max(b[0] - x, 0, x - b[2]), dy0 = Math.max(b[1] - y, 0, y - b[3]);
      const dd = Math.hypot(dx0, dy0);
      if (dd < bd && dd <= tol[i]) { bd = dd; best = i; }
    });
    return best;
  };
  const out = boxes.map(() => ({ segs: [], texts: [], fills: [], count: 0 }));
  // a sensible text height for rebuilt dimensions: what the drawing uses for its dimension text
  const hs = (dx.dimTexts.length ? dx.dimTexts : dx.texts).map((t) => t.h).filter((h) => h > 0).sort((a, b) => a - b);
  const h = hs.length ? hs[Math.floor(hs.length / 2)] * (dx.dimTexts.length ? 1 : 0.8) : 0.18;
  for (const d of dx.dims) {
    const at = d.p11 || d.p10 || d.p13;
    if (!at) continue;
    const fi = nearest(at[0], at[1]);
    if (fi < 0) continue;
    const o = out[fi];
    o.count++;
    if (d.drawn) {
      const [[s0, s1], [t0, t1], [f0, f1]] = d.ranges;
      for (let i = s0; i < s1; i++) { const q = dx.dimSegs[i]; o.segs.push(q[0], q[1], q[2], q[3]); }
      for (let i = t0; i < t1; i++) o.texts.push(pickText(dx.dimTexts[i]));
      for (let i = f0; i < f1; i++) o.fills.push({ pts: dx.dimFills[i].pts });
    } else {
      const g = synthesize(d, h, d.mm || unitMM);
      for (const q of g.segs) o.segs.push(...q);
      o.texts.push(...g.texts);
    }
  }
  // dimensions drawn by hand on dimension layers (lines + text)
  const isDim = (layer) => (roles.get(layer) || {}).role === 'dim';
  for (const q of dx.segs) {
    if (!isDim(q[4])) continue;
    const fi = nearest((q[0] + q[2]) / 2, (q[1] + q[3]) / 2);
    if (fi >= 0) out[fi].segs.push(q[0], q[1], q[2], q[3]);
  }
  for (const t of dx.texts) {
    if (!isDim(t.layer)) continue;
    const fi = nearest(t.x, t.y);
    if (fi >= 0) { out[fi].texts.push(pickText(t)); out[fi].count++; }
  }
  return out.map((o) => ({ ...o, segs: new Float64Array(o.segs) }));
}

const pickText = (t) => ({ x: t.x, y: t.y, h: t.h, rot: t.rot || 0, text: t.text, ha: t.ha || 0, va: t.va || 0, mtext: !!t.mtext, attach: t.attach || 0 });

/**
 * A few linear dimensions with what they say and what they measure, in drawing units, so a
 * wrong unit shows at a glance ("says 3600, measures 3600" vs "says 3600, measures 360").
 */
export function dimChecks(dx, unitMM, n = 8) {
  const out = [];
  for (const d of dx.dims) {
    if (out.length >= n) break;
    if (!((d.type === 0 || d.type === 1) && d.p13 && d.p14)) continue;
    const mm = d.mm || unitMM, k = mm / 1000;
    const dir = d.type === 0 ? [Math.cos((d.rot * Math.PI) / 180), Math.sin((d.rot * Math.PI) / 180)] : unit(sub(d.p14, d.p13));
    const measured = Math.abs(dot(sub(d.p14, d.p13), dir)) / k;
    if (measured < 1e-6) continue;
    let label = '';
    if (d.drawn) { const [t0, t1] = d.ranges[1]; for (let i = t0; i < t1 && !label; i++) label = String(dx.dimTexts[i].text || '').trim(); }
    else label = labelOf(d, measured, mm);
    if (out.some((o) => o.label === label && Math.abs(o.measured - measured) < 1e-6)) continue; // a repeated dimension proves nothing new
    const said = parseFloat(String(label).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(said) || /'/.test(label)) { out.push({ label, measured, match: null }); continue; }
    const r = said / measured;
    out.push({ label, measured, match: Math.abs(r - 1) < 0.02 ? 'ok' : [10, 0.1, 100, 0.01, 1000, 0.001, 25.4, 1 / 25.4, 304.8, 1 / 304.8].find((f) => Math.abs(r / f - 1) < 0.02) || 'off' });
  }
  return out;
}
