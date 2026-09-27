// Plumb — the whole analysis: DXF text → floors, rooms, columns, alignment and issues.

import { parseDXF } from './dxf.js';
import { inferUnitMM, toMetres, layerRoles, findFloors, analyseFloor, parseLevel } from './recognize.js';
import { alignPair, runChecks } from './checks.js';

/**
 * One DXF holding every floor plan (the usual way plan sets are drawn).
 * @param {string} text  DXF file contents
 * @param {object} opts  { unitMM?, roles?: Map<layer, role>, floors?: override list,
 *                         nudges?: {[floorIndex]: [dx,dy]}, onStage?: fn }
 */
export function analyse(text, opts = {}) {
  const t0 = now();
  const stage = opts.onStage || (() => {});
  const raw = typeof text === 'string' ? parseDXF(text) : text;
  const unit = opts.unitMM ? { mm: opts.unitMM, source: 'you' } : inferUnitMM(raw);
  const dx = toMetres(raw, unit.mm);
  stage('Sorting layers…');
  const roles = layerRoles(dx);
  if (opts.roles) for (const [l, r] of opts.roles) { const a = roles.get(l) || {}; roles.set(l, { ...a, role: r, auto: false, autoRole: a.role || 'other' }); }
  stage('Finding the floor plans…');
  const floors = (opts.floors || findFloors(dx, roles)).filter((f) => !f.excluded);
  return finish(dx, unit, roles, floors, opts, t0);
}

/** One DXF per floor. files: [{name, text}] in any order (levels read from names/titles). */
export function analyseFiles(files, opts = {}) {
  const t0 = now();
  const stage = opts.onStage || (() => {});
  const parts = files.map((f) => {
    const raw = parseDXF(f.text);
    const unit = opts.unitMM ? { mm: opts.unitMM, source: 'you' } : inferUnitMM(raw);
    return { f, raw, unit, dx: toMetres(raw, unit.mm) };
  });
  // lay the files out side by side so they never overlap, then merge
  const merged = { layers: new Map(), segs: [], arcs: [], circles: [], texts: [], fills: [], inserts: [], counts: {}, header: {} };
  const floors = [];
  let x = 0;
  parts.forEach((p, k) => {
    const b = p.dx.bounds, ox = x - b.x0, oy = -b.y0;
    for (const [n, l] of p.dx.layers) if (!merged.layers.has(n)) merged.layers.set(n, l);
    for (const s of p.dx.segs) merged.segs.push([s[0] + ox, s[1] + oy, s[2] + ox, s[3] + oy, s[4]]);
    for (const a of p.dx.arcs) merged.arcs.push({ ...a, cx: a.cx + ox, cy: a.cy + oy });
    for (const c of p.dx.circles) merged.circles.push({ ...c, cx: c.cx + ox, cy: c.cy + oy });
    for (const t of p.dx.texts) merged.texts.push({ ...t, x: t.x + ox, y: t.y + oy });
    for (const fl of p.dx.fills) merged.fills.push({ ...fl, pts: fl.pts.map((q) => [q[0] + ox, q[1] + oy]) });
    const lv = levelFromName(p.f.name) || bestTitle(p.dx);
    floors.push({ id: k, title: lv ? cleanTitle(lv.text) : p.f.name.replace(/\.dxf$/i, ''), level: lv ? lv.level : k, typical: !!(lv && lv.typical), box: [b.x0 + ox, b.y0 + oy, b.x1 + ox, b.y1 + oy], file: p.f.name, origin: [ox, oy], k: p.dx.k });
    x += b.x1 - b.x0 + 30;
  });
  floors.sort((a, b) => a.level - b.level || a.id - b.id);
  floors.forEach((f, k) => { f.id = k; });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of floors) { x0 = Math.min(x0, f.box[0]); y0 = Math.min(y0, f.box[1]); x1 = Math.max(x1, f.box[2]); y1 = Math.max(y1, f.box[3]); }
  merged.bounds = { x0, y0, x1, y1 };
  merged.k = 1;
  stage('Sorting layers…');
  const roles = layerRoles(merged);
  if (opts.roles) for (const [l, r] of opts.roles) { const a = roles.get(l) || {}; roles.set(l, { ...a, role: r, auto: false, autoRole: a.role || 'other' }); }
  const unit = { mm: parts[0] ? parts[0].unit.mm : 1, source: parts.length > 1 ? `${parts.length} files` : parts[0].unit.source };
  return finish(merged, unit, roles, (opts.floors || floors).filter((f) => !f.excluded), opts, t0);
}

function finish(dx, unit, roles, floors, opts, t0) {
  const stage = opts.onStage || (() => {});
  const an = floors.map((f, k) => { stage(`Reading ${f.title.toLowerCase()} (${k + 1}/${floors.length})…`); return analyseFloor(dx, roles, f.box, { types: opts.types }); });
  stage('Stacking the floors…');
  const transforms = [{ tx: 0, ty: 0 }], aligns = [null];
  for (let k = 1; k < an.length; k++) {
    const a = alignPair(an[k - 1], an[k]);
    const nudge = (opts.nudges && opts.nudges[k]) || [0, 0];
    a.tx += nudge[0]; a.ty += nudge[1];
    if (nudge[0] || nudge[1]) a.method += ' + nudge';
    aligns.push(a);
    transforms.push({ tx: transforms[k - 1].tx + a.tx, ty: transforms[k - 1].ty + a.ty });
  }
  stage('Checking what lines up…');
  const issues = runChecks(floors, an, transforms);
  return { dx, unit, roles, floors, an, transforms, aligns, issues, ms: { total: now() - t0 } };
}

/** "ground.dxf", "first-floor.dxf", "L2.dxf", "B1_plan.dxf", "03.dxf" → a level. */
export function levelFromName(name) {
  const base = String(name).replace(/\.dxf$/i, '').replace(/[_\-.]+/g, ' ').trim();
  const lv = parseLevel(base) || parseLevel(base + ' floor');
  if (lv) return { ...lv, text: /floor|plan|level/i.test(lv.text) ? lv.text : base + ' floor' };
  const m = base.match(/^(?:f|fl|flr|floor|lvl|level|l)?\s*(\d{1,2})$/i);
  return m ? { level: parseInt(m[1], 10), typical: false, text: `Floor ${parseInt(m[1], 10)}` } : null;
}

function bestTitle(dx) {
  let best = null;
  for (const t of dx.texts) {
    const lv = parseLevel(t.text);
    if (lv && (!best || t.h > best.h)) best = { ...lv, h: t.h };
  }
  return best;
}

const cleanTitle = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
