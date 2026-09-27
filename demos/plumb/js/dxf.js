// Plumb — DXF reader.
// Parses ASCII DXF (R12 … 2018) into a flat drawing model in world coordinates:
//   { units, layers, segs, arcs, circles, texts, fills, bounds }
// Blocks (INSERT) are exploded recursively; entities on layer "0" inside a block take the
// insert's layer. Curves are kept as arcs where possible and also tessellated into segments.

const UNIT_MM = { 0: null, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4, 14: 100 };

/** Read group-code / value pairs. */
function pairs(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) { i -= 1; continue; } // resync on stray lines
    out.push([code, lines[i + 1]]);
  }
  return out;
}

const num = (v) => parseFloat(v);

/** Split a pair list into entities: each starts at a code-0 record. */
function records(ps, start, end) {
  const out = [];
  let cur = null;
  for (let i = start; i < end; i++) {
    const [c, v] = ps[i];
    if (c === 0) {
      if (cur) out.push(cur);
      cur = { type: v.trim(), d: [] };
    } else if (cur) cur.d.push([c, v]);
  }
  if (cur) out.push(cur);
  return out;
}

function get(rec, code, dflt) {
  for (const [c, v] of rec.d) if (c === code) return v;
  return dflt;
}
function getNum(rec, code, dflt = 0) {
  const v = get(rec, code, null);
  return v === null ? dflt : num(v);
}

/** Decode DXF text codes: %%c → ⌀, %%d → °, %%p → ±, \U+XXXX, MTEXT formatting. */
export function cleanText(s, mtext = false) {
  let t = String(s || '');
  t = t.replace(/%%[cC]/g, '⌀').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoO]/g, '').replace(/%%%/g, '%');
  t = t.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  if (mtext) {
    t = t.replace(/\\P/g, '\n').replace(/\\~/g, ' ');
    t = t.replace(/\\[ACFHQTWcfhqtw][^;\\{}]*;/g, ''); // font/height/width/colour switches
    t = t.replace(/\\[LlOoKk]/g, '');
    t = t.replace(/\\S([^;]*);/g, (_, f) => f.replace(/[#^]/g, '/'));
    t = t.replace(/[{}]/g, '');
    t = t.replace(/\\\\/g, '\\');
  }
  return t.trim();
}

// ---------------------------------------------------------------------------

export function parseDXF(text) {
  const ps = pairs(text);
  // sections
  const sections = {};
  for (let i = 0; i < ps.length; i++) {
    if (ps[i][0] === 0 && ps[i][1].trim() === 'SECTION' && ps[i + 1] && ps[i + 1][0] === 2) {
      const name = ps[i + 1][1].trim();
      let j = i + 2;
      while (j < ps.length && !(ps[j][0] === 0 && ps[j][1].trim() === 'ENDSEC')) j++;
      sections[name] = [i + 2, j];
      i = j;
    }
  }

  // header
  const header = {};
  if (sections.HEADER) {
    const [a, b] = sections.HEADER;
    let key = null;
    for (let i = a; i < b; i++) {
      const [c, v] = ps[i];
      if (c === 9) key = v.trim();
      else if (key && header[key] === undefined) header[key] = v.trim();
    }
  }
  const insunits = parseInt(header.$INSUNITS ?? '0', 10);

  // layers
  const layers = new Map();
  if (sections.TABLES) {
    const [a, b] = sections.TABLES;
    for (const r of records(ps, a, b)) {
      if (r.type !== 'LAYER') continue;
      const name = get(r, 2, '0').trim();
      const color = getNum(r, 62, 7);
      const flags = getNum(r, 70, 0);
      layers.set(name, { name, color: Math.abs(color), off: color < 0, frozen: (flags & 1) === 1 });
    }
  }
  const layerOf = (n) => {
    const k = (n || '0').trim();
    if (!layers.has(k)) layers.set(k, { name: k, color: 7, off: false, frozen: false });
    return k;
  };

  // blocks
  const blocks = new Map();
  if (sections.BLOCKS) {
    const [a, b] = sections.BLOCKS;
    const recs = records(ps, a, b);
    let cur = null;
    for (const r of recs) {
      if (r.type === 'BLOCK') {
        cur = { name: get(r, 2, '').trim(), base: [getNum(r, 10), getNum(r, 20)], ents: [] };
        blocks.set(cur.name, cur);
      } else if (r.type === 'ENDBLK') cur = null;
      else if (cur) cur.ents.push(r);
    }
    for (const bl of blocks.values()) bl.ents = groupPolylines(bl.ents);
  }

  const ents = sections.ENTITIES ? groupPolylines(records(ps, ...sections.ENTITIES)) : [];

  const out = {
    header, insunits, unitMM: UNIT_MM[insunits] ?? null,
    layers, blocks: [...blocks.keys()],
    segs: [],     // [x1,y1,x2,y2,layer]
    arcs: [],     // {cx,cy,r,a0,a1,layer}  (angles in radians, CCW from a0 to a1)
    circles: [],  // {cx,cy,r,layer}
    texts: [],    // {x,y,h,rot,text,layer}
    fills: [],    // {pts:[[x,y]...], layer, solid:true}   filled areas (SOLID, solid HATCH)
    inserts: [],  // {name,x,y,layer}  top-level + nested (for block-name hints)
    counts: {},
  };
  const count = (t) => { out.counts[t] = (out.counts[t] || 0) + 1; };

  const emit = (recs, M, inherited, depth) => {
    for (const r of recs) {
      if (depth === 0 && get(r, 67, '0').trim() === '1') continue; // paper space (sheet layouts), not the model
      count(r.type);
      let layer = get(r, 8, '0').trim();
      if (layer === '0' && inherited) layer = inherited;
      layer = layerOf(layer);
      switch (r.type) {
        case 'LINE': {
          const p = M.apply(getNum(r, 10), getNum(r, 20)), q = M.apply(getNum(r, 11), getNum(r, 21));
          out.segs.push([p[0], p[1], q[0], q[1], layer]);
          break;
        }
        case 'LWPOLYLINE': case 'POLYLINE': {
          const pts = r.pts || lwPoints(r);
          const closed = r.type === 'LWPOLYLINE' ? (getNum(r, 70, 0) & 1) === 1 : r.closed;
          emitPoly(pts, closed, M, layer);
          break;
        }
        case 'ARC': {
          const c = [getNum(r, 10), getNum(r, 20)], rr = getNum(r, 40);
          const a0 = (getNum(r, 50) * Math.PI) / 180, a1 = (getNum(r, 51) * Math.PI) / 180;
          emitArc(c, rr, a0, a1, M, layer);
          break;
        }
        case 'CIRCLE': {
          const c = M.apply(getNum(r, 10), getNum(r, 20));
          const rr = getNum(r, 40) * M.scale;
          out.circles.push({ cx: c[0], cy: c[1], r: rr, layer });
          tessCircle(c, rr, layer);
          break;
        }
        case 'ELLIPSE': {
          const cx = getNum(r, 10), cy = getNum(r, 20), mx = getNum(r, 11), my = getNum(r, 21), ratio = getNum(r, 40, 1);
          let t0 = getNum(r, 41, 0), t1 = getNum(r, 42, Math.PI * 2);
          if (t1 < t0) t1 += Math.PI * 2;
          const n = Math.max(8, Math.ceil(((t1 - t0) / (Math.PI * 2)) * 48));
          const mx2 = -my * ratio, my2 = mx * ratio;
          let prev = null;
          for (let k = 0; k <= n; k++) {
            const t = t0 + ((t1 - t0) * k) / n;
            const x = cx + mx * Math.cos(t) + mx2 * Math.sin(t), y = cy + my * Math.cos(t) + my2 * Math.sin(t);
            const p = M.apply(x, y);
            if (prev) out.segs.push([prev[0], prev[1], p[0], p[1], layer]);
            prev = p;
          }
          break;
        }
        case 'SPLINE': {
          const pts = [];
          const fit = [], ctrl = [];
          let fx = null, cx = null;
          for (const [c, v] of r.d) {
            if (c === 11) fx = num(v); else if (c === 21 && fx !== null) { fit.push([fx, num(v)]); fx = null; }
            if (c === 10) cx = num(v); else if (c === 20 && cx !== null) { ctrl.push([cx, num(v)]); cx = null; }
          }
          const src = fit.length >= 2 ? fit : ctrl;
          for (const p of src) pts.push(p);
          emitPoly(pts.map((p) => [p[0], p[1], 0]), false, M, layer);
          break;
        }
        case 'TEXT': case 'MTEXT': case 'ATTRIB': {
          if (r.type === 'ATTRIB' && (getNum(r, 70, 0) & 1)) break; // invisible
          let x = getNum(r, 10), y = getNum(r, 20);
          const ha = r.type === 'MTEXT' ? 0 : getNum(r, 72, 0), va = r.type === 'MTEXT' ? 0 : getNum(r, 73, 0);
          if (r.type !== 'MTEXT' && (ha || va) && get(r, 11, null) !== null) {
            // aligned / fit text runs between the two points; everything else hangs off point 2
            if (ha === 3 || ha === 5) { x = (x + getNum(r, 11)) / 2; y = (y + getNum(r, 21)) / 2; }
            else { x = getNum(r, 11); y = getNum(r, 21); }
          }
          let s = '';
          if (r.type === 'MTEXT') { for (const [c, v] of r.d) if (c === 3 || c === 1) s += v; }
          else s = get(r, 1, '');
          const p = M.apply(x, y);
          const h = getNum(r, 40, 1) * M.scale;
          let rot = getNum(r, 50, 0);
          if (r.type === 'MTEXT') {
            const dx = getNum(r, 11, 1), dy = getNum(r, 21, 0);
            if (get(r, 11, null) !== null) rot = (Math.atan2(dy, dx) * 180) / Math.PI;
          }
          const text = cleanText(s, r.type === 'MTEXT');
          if (text) out.texts.push({ x: p[0], y: p[1], h, rot: rot + M.rotDeg, text, layer, mtext: r.type === 'MTEXT', ha, va, attach: r.type === 'MTEXT' ? getNum(r, 71, 1) : 0 });
          break;
        }
        case 'SOLID': case 'TRACE': {
          const q = [[getNum(r, 10), getNum(r, 20)], [getNum(r, 11), getNum(r, 21)], [getNum(r, 13), getNum(r, 23)], [getNum(r, 12), getNum(r, 22)]];
          const pts = q.map((p) => M.apply(p[0], p[1]));
          out.fills.push({ pts, layer, solid: true });
          for (let k = 0; k < 4; k++) { const a = pts[k], b = pts[(k + 1) % 4]; if (a[0] !== b[0] || a[1] !== b[1]) out.segs.push([a[0], a[1], b[0], b[1], layer]); }
          break;
        }
        case 'HATCH': {
          const solid = getNum(r, 70, 0) === 1;
          for (const loop of hatchLoops(r)) {
            const pts = loop.map((p) => M.apply(p[0], p[1]));
            if (pts.length >= 3) out.fills.push({ pts, layer, solid });
          }
          break;
        }
        case 'INSERT': {
          const name = get(r, 2, '').trim();
          const bl = blocks.get(name);
          const ix = getNum(r, 10), iy = getNum(r, 20);
          const sx = getNum(r, 41, 1), sy = getNum(r, 42, 1), rotI = getNum(r, 50, 0);
          const cols = Math.max(1, getNum(r, 70, 1)), rows = Math.max(1, getNum(r, 71, 1));
          const dcol = getNum(r, 44, 0), drow = getNum(r, 45, 0);
          const wp = M.apply(ix, iy);
          out.inserts.push({ name, x: wp[0], y: wp[1], layer, sx, sy, rot: rotI + M.rotDeg });
          if (!bl || depth > 12) break;
          for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
            const local = Mat.insert(ix, iy, sx, sy, rotI, bl.base, ci * dcol, ri * drow);
            emit(bl.ents, M.mul(local), layer, depth + 1);
          }
          break;
        }
        default: break;
      }
    }
  };

  function emitPoly(pts, closed, M, layer) {
    const n = pts.length;
    if (n < 2) return;
    const last = closed ? n : n - 1;
    for (let k = 0; k < last; k++) {
      const a = pts[k], b = pts[(k + 1) % n];
      const bulge = a[2] || 0;
      if (Math.abs(bulge) > 1e-9) {
        // arc from a to b with bulge = tan(θ/4)
        const th = 4 * Math.atan(bulge);
        const dx = b[0] - a[0], dy = b[1] - a[1], chord = Math.hypot(dx, dy);
        if (chord < 1e-12) continue;
        const rr = chord / (2 * Math.sin(Math.abs(th) / 2));
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const hDist = Math.sqrt(Math.max(0, rr * rr - (chord / 2) ** 2));
        const nx = -dy / chord, ny = dx / chord;
        const sgn = (th > 0) === (Math.abs(th) < Math.PI) ? 1 : -1;
        const cx = mx + nx * hDist * sgn, cy = my + ny * hDist * sgn;
        let a0 = Math.atan2(a[1] - cy, a[0] - cx), a1 = Math.atan2(b[1] - cy, b[0] - cx);
        if (th < 0) { const t = a0; a0 = a1; a1 = t; }
        emitArc([cx, cy], rr, a0, a1, M, layer);
      } else {
        const p = M.apply(a[0], a[1]), q = M.apply(b[0], b[1]);
        out.segs.push([p[0], p[1], q[0], q[1], layer]);
      }
    }
  }

  function emitArc(c, rr, a0, a1, M, layer) {
    while (a1 <= a0) a1 += Math.PI * 2;
    const cw = M.flip; // a mirrored insert reverses the arc direction
    const wc = M.apply(c[0], c[1]);
    const wr = rr * M.scale;
    const pa = M.apply(c[0] + rr * Math.cos(a0), c[1] + rr * Math.sin(a0));
    const pb = M.apply(c[0] + rr * Math.cos(a1), c[1] + rr * Math.sin(a1));
    let w0 = Math.atan2(pa[1] - wc[1], pa[0] - wc[0]), w1 = Math.atan2(pb[1] - wc[1], pb[0] - wc[0]);
    if (cw) { const t = w0; w0 = w1; w1 = t; }
    while (w1 <= w0) w1 += Math.PI * 2;
    out.arcs.push({ cx: wc[0], cy: wc[1], r: wr, a0: w0, a1: w1, layer });
    const n = Math.max(2, Math.ceil(((w1 - w0) / (Math.PI * 2)) * 48));
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const t = w0 + ((w1 - w0) * k) / n;
      const p = [wc[0] + wr * Math.cos(t), wc[1] + wr * Math.sin(t)];
      if (prev) out.segs.push([prev[0], prev[1], p[0], p[1], layer]);
      prev = p;
    }
  }

  function tessCircle(c, rr, layer) {
    const n = 32;
    for (let k = 0; k < n; k++) {
      const t0 = (k / n) * Math.PI * 2, t1 = ((k + 1) / n) * Math.PI * 2;
      out.segs.push([c[0] + rr * Math.cos(t0), c[1] + rr * Math.sin(t0), c[0] + rr * Math.cos(t1), c[1] + rr * Math.sin(t1), layer]);
    }
  }

  emit(ents, Mat.identity(), null, 0);

  // bounds
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of out.segs) {
    if (s[0] < x0) x0 = s[0]; if (s[2] < x0) x0 = s[2]; if (s[0] > x1) x1 = s[0]; if (s[2] > x1) x1 = s[2];
    if (s[1] < y0) y0 = s[1]; if (s[3] < y0) y0 = s[3]; if (s[1] > y1) y1 = s[1]; if (s[3] > y1) y1 = s[3];
  }
  for (const t of out.texts) { if (t.x < x0) x0 = t.x; if (t.x > x1) x1 = t.x; if (t.y < y0) y0 = t.y; if (t.y > y1) y1 = t.y; }
  out.bounds = Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 1, y1: 1 };
  return out;
}

// POLYLINE / VERTEX / SEQEND → a single record with pts
function groupPolylines(recs) {
  const out = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.type === 'POLYLINE') {
      const flags = getNum(r, 70, 0);
      if (flags & (16 | 64)) { // polygon mesh / polyface: skip, and its vertices
        while (i + 1 < recs.length && recs[i + 1].type !== 'SEQEND') i++;
        i++;
        continue;
      }
      const pts = [];
      while (i + 1 < recs.length && recs[i + 1].type === 'VERTEX') {
        i++;
        const v = recs[i];
        pts.push([getNum(v, 10), getNum(v, 20), getNum(v, 42, 0)]);
      }
      if (i + 1 < recs.length && recs[i + 1].type === 'SEQEND') i++;
      out.push({ type: 'POLYLINE', d: r.d, pts, closed: (flags & 1) === 1 });
    } else out.push(r);
  }
  return out;
}

function lwPoints(r) {
  const pts = [];
  let cur = null;
  for (const [c, v] of r.d) {
    if (c === 10) { cur = [num(v), 0, 0]; pts.push(cur); }
    else if (c === 20 && cur) cur[1] = num(v);
    else if (c === 42 && cur) cur[2] = num(v);
  }
  return pts;
}

/** HATCH boundary loops as point lists (polyline and edge-defined paths). */
function hatchLoops(r) {
  const d = r.d;
  const loops = [];
  let i = 0;
  // find the number of loops (code 91) after the pattern header
  while (i < d.length && d[i][0] !== 91) i++;
  if (i >= d.length) return loops;
  const nLoops = parseInt(d[i][1], 10);
  i++;
  for (let L = 0; L < nLoops && i < d.length; L++) {
    while (i < d.length && d[i][0] !== 92) i++;
    if (i >= d.length) break;
    const type = parseInt(d[i][1], 10); i++;
    const pts = [];
    if (type & 2) {
      // polyline path: 72 hasBulge, 73 closed, 93 nverts, then 10/20(/42)
      let hasBulge = 0, nv = 0;
      while (i < d.length && d[i][0] !== 93) { if (d[i][0] === 72) hasBulge = parseInt(d[i][1], 10); i++; }
      nv = parseInt(d[i][1], 10); i++;
      for (let k = 0; k < nv && i < d.length; k++) {
        while (i < d.length && d[i][0] !== 10) i++;
        const x = num(d[i][1]); i++;
        const y = num(d[i][1]); i++;
        let b = 0;
        if (hasBulge && i < d.length && d[i][0] === 42) { b = num(d[i][1]); i++; }
        pts.push([x, y, b]);
      }
      loops.push(bulgeToPoints(pts));
    } else {
      // edge path: 93 nedges, each 72 edge type
      while (i < d.length && d[i][0] !== 93) i++;
      const ne = parseInt(d[i][1], 10); i++;
      for (let k = 0; k < ne && i < d.length; k++) {
        while (i < d.length && d[i][0] !== 72) i++;
        const et = parseInt(d[i][1], 10); i++;
        const read = (code) => { while (i < d.length && d[i][0] !== code) i++; const v = num(d[i][1]); i++; return v; };
        if (et === 1) { const x0 = read(10), y0 = read(20), x1 = read(11), y1 = read(21); pts.push([x0, y0], [x1, y1]); }
        else if (et === 2) {
          const cx = read(10), cy = read(20), rr = read(40), s = (read(50) * Math.PI) / 180, e = (read(51) * Math.PI) / 180;
          const ccw = parseInt((() => { while (i < d.length && d[i][0] !== 73) i++; const v = d[i][1]; i++; return v; })(), 10);
          let a0 = s, a1 = e;
          if (!ccw) { a0 = -s; a1 = -e; }
          while (a1 < a0) a1 += Math.PI * 2;
          const n = 12;
          for (let q = 0; q <= n; q++) { const t = a0 + ((a1 - a0) * q) / n; pts.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]); }
        } else if (et === 3) {
          const cx = read(10), cy = read(20), mx = read(11), my = read(21), ratio = read(40);
          const s = (read(50) * Math.PI) / 180, e = (read(51) * Math.PI) / 180;
          const n = 12;
          for (let q = 0; q <= n; q++) { const t = s + ((e - s) * q) / n; pts.push([cx + mx * Math.cos(t) - my * ratio * Math.sin(t), cy + my * Math.cos(t) + mx * ratio * Math.sin(t)]); }
        } else if (et === 4) {
          // spline edge: use control points
          while (i < d.length && d[i][0] !== 95) i++;
          const nk = parseInt(d[i][1], 10); i++;
          while (i < d.length && d[i][0] !== 96) i++;
          const nc = parseInt(d[i][1], 10); i++;
          for (let q = 0; q < nk; q++) { while (i < d.length && d[i][0] !== 40) i++; i++; }
          for (let q = 0; q < nc; q++) { const x = read(10), y = read(20); pts.push([x, y]); }
        }
      }
      loops.push(pts);
    }
    // skip source boundary object references
    while (i < d.length && d[i][0] === 97) { const nb = parseInt(d[i][1], 10); i += 1 + nb; }
  }
  return loops;
}

function bulgeToPoints(pts) {
  const out = [];
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    out.push([a[0], a[1]]);
    const bulge = a[2] || 0;
    if (Math.abs(bulge) > 1e-9) {
      const th = 4 * Math.atan(bulge);
      const steps = 8;
      const dx = b[0] - a[0], dy = b[1] - a[1], chord = Math.hypot(dx, dy);
      if (chord < 1e-12) continue;
      const rr = chord / (2 * Math.sin(Math.abs(th) / 2));
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const hDist = Math.sqrt(Math.max(0, rr * rr - (chord / 2) ** 2));
      const nx = -dy / chord, ny = dx / chord;
      const sgn = (th > 0) === (Math.abs(th) < Math.PI) ? 1 : -1;
      const cx = mx + nx * hDist * sgn, cy = my + ny * hDist * sgn;
      const a0 = Math.atan2(a[1] - cy, a[0] - cx);
      for (let q = 1; q < steps; q++) {
        const t = a0 + (th * q) / steps;
        out.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]);
      }
    }
  }
  return out;
}

// 2D affine transforms: [a b c; d e f] (x' = a x + b y + c, y' = d x + e y + f)
export const Mat = {
  identity() { return make(1, 0, 0, 0, 1, 0); },
  insert(ix, iy, sx, sy, rotDeg, base, ox = 0, oy = 0) {
    const r = (rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    // p' = T(ix,iy) · R · S · T(-base + (ox,oy)/S?)  — array offsets are in the rotated frame
    const bx = -base[0], by = -base[1];
    const a = c * sx, b = -s * sy, d = s * sx, e = c * sy;
    const tx = a * bx + b * by + ix + (c * ox - s * oy);
    const ty = d * bx + e * by + iy + (s * ox + c * oy);
    return make(a, b, tx, d, e, ty);
  },
};

function make(a, b, c, d, e, f) {
  const det = a * e - b * d;
  return {
    m: [a, b, c, d, e, f],
    scale: Math.sqrt(Math.abs(det)),
    flip: det < 0,
    rotDeg: (Math.atan2(d, a) * 180) / Math.PI,
    apply(x, y) { return [a * x + b * y + c, d * x + e * y + f]; },
    mul(o) {
      const [A, B, C, D, E, F] = o.m;
      return make(a * A + b * D, a * B + b * E, a * C + b * F + c, d * A + e * D, d * B + e * E, d * C + e * F + f);
    },
  };
}
