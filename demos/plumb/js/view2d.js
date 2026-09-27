// Plumb — the overlay: the floor above drawn over the floor below in registration colours.
// Lines that agree blend to white (ink on paper); lines that don't leave a coloured fringe.

import { PALETTES } from './style.js';
import { WET, DRY_HABITABLE } from './recognize.js';

const ROLE_STYLE = {
  hatch: { w: 0.6, a: 0.18 },
  grid: { w: 0.6, a: 0.16, dash: [9, 4, 2, 4] },
  furniture: { w: 0.7, a: 0.26 },
  other: { w: 0.7, a: 0.28 },
  door: { w: 0.8, a: 0.55 },
  stair: { w: 0.8, a: 0.6 },
  lift: { w: 0.8, a: 0.65 },
  duct: { w: 0.9, a: 0.8 },
  outline: { w: 1, a: 0.75, dash: [6, 4] },
  window: { w: 1, a: 0.85 },
  wall: { w: 1.5, a: 1 },
  column: { w: 1.1, a: 0.9 },
};
const DRAW_ORDER = Object.keys(ROLE_STYLE);
const PIN_R = 11;
const PIN_OFF = [16, -17]; // pins sit up-right of what they point at, on a short leader
const PIN_SPOTS = [PIN_OFF, [16, 17], [-16, -17], [-16, 17], [36, -6], [-36, -6], [30, -38], [-30, -38], [30, 38], [-30, 38], [0, -44], [0, 44]];

export class Plan2D {
  constructor(canvas, cb = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = cb;
    this.data = null;
    this.k = 1;
    this.mix = 0.55;
    this.theme = 'dark';
    this.view = { cx: 0, cy: 0, s: 20 };
    this.show = { wet: true, overhang: true, labels: true };
    this.selected = null;
    this.hoverIssue = null;
    this.dismissed = new Set();
    this.nudge = null;          // {dx, dy} while hand-aligning the upper floor
    this.W = 1; this.H = 1; this.dpr = 1;
    this.paths = new Map();
    this.patterns = new Map();
    this.anim = null;
    this.pointers = new Map();
    this._bind();
    this._resize();
    new ResizeObserver(() => { this._resize(); this.request(); }).observe(canvas);
  }

  // ---------------------------------------------------------------- state
  setData(data) {
    this.data = data;
    this.paths.clear();
    this.k = Math.min(Math.max(1, this.k), Math.max(0, data.floors.length - 1));
    if (data.floors.length < 2) this.k = 0;
    this.fit(false);
  }
  setPair(k, refit = true) { this.k = k; if (refit) this.fit(true); else this.request(); }
  setMix(v) { this.mix = v; this.request(); }
  setTheme(t) { this.theme = t; this.patterns.clear(); this.request(); }
  setShow(key, on) { this.show[key] = on; this.request(); }
  setSelected(id) { this.selected = id; this.request(); }
  setDismissed(set) { this.dismissed = set; this.request(); }
  setNudge(n) { this.nudge = n; this.cv.classList.toggle('nudging', !!n); this.request(); }

  offset(fi) {
    const T = this.data.transforms[fi] || { tx: 0, ty: 0 };
    if (this.nudge && fi >= this.k && this.k > 0) return { tx: T.tx + this.nudge.dx, ty: T.ty + this.nudge.dy };
    return T;
  }
  pairFloors(k = this.k) { return k > 0 ? [k - 1, k] : [0]; }

  // ---------------------------------------------------------------- view
  _resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
  }
  boundsOf(k = this.k) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const fi of this.pairFloors(k)) {
      const b = this.data.an[fi].box, T = this.offset(fi);
      x0 = Math.min(x0, b[0] + T.tx); y0 = Math.min(y0, b[1] + T.ty); x1 = Math.max(x1, b[2] + T.tx); y1 = Math.max(y1, b[3] + T.ty);
    }
    return [x0, y0, x1, y1];
  }
  fitView(b, W = this.W, H = this.H, pad = this.pads ? this.pads() : { t: 64, b: 72, l: 28, r: 64 }) {
    const w = Math.max(1, b[2] - b[0]), h = Math.max(1, b[3] - b[1]);
    const s = Math.min((W - pad.l - pad.r) / w, (H - pad.t - pad.b) / h);
    // centre in the padded box
    const cx = (b[0] + b[2]) / 2 - ((pad.l - pad.r) / 2) / s, cy = (b[1] + b[3]) / 2 + ((pad.t - pad.b) / 2) / s;
    return { cx, cy, s: Math.max(0.5, s) };
  }
  fit(animate = true) {
    if (!this.data) return;
    this.goTo(this.fitView(this.boundsOf()), animate);
  }
  goTo(v, animate = true) {
    if (!animate) { this.view = { ...v }; this.anim = null; this.request(); return; }
    this.anim = { from: { ...this.view }, to: { ...v }, t0: performance.now(), dur: 480 };
    this.request();
  }
  focusIssue(iss) {
    if (!this.data || !iss) return;
    if (iss.upper !== this.k) this.k = iss.upper;
    const T = this.offset(iss.upper);
    const x = iss.at[0] + T.tx, y = iss.at[1] + T.ty;
    const span = iss.kind === 'cantilever' ? 14 : 10;
    const s = Math.max(this.view.s, Math.min(this.W, this.H) / span);
    this.goTo({ cx: x, cy: y - 0.06 * this.H / s, s: Math.min(s, 120) }, true);
  }
  zoomBy(f, sx = this.W / 2, sy = this.H / 2) {
    const v = this.view;
    const wx = v.cx + (sx - this.W / 2) / v.s, wy = v.cy - (sy - this.H / 2) / v.s;
    const s = Math.min(400, Math.max(0.5, v.s * f));
    this.view = { s, cx: wx - (sx - this.W / 2) / s, cy: wy + (sy - this.H / 2) / s };
    this.anim = null;
    this.request();
  }
  toWorld(sx, sy, v = this.view) { return [v.cx + (sx - this.W / 2) / v.s, v.cy - (sy - this.H / 2) / v.s]; }
  toScreen(x, y, v = this.view) { return [this.W / 2 + (x - v.cx) * v.s, this.H / 2 - (y - v.cy) * v.s]; }

  request() {
    if (this._raf) return;
    this._raf = requestAnimationFrame((t) => { this._raf = 0; this.frame(t); });
  }
  frame(t = performance.now()) {
    if (this.anim) {
      const a = this.anim, u = Math.min(1, (t - a.t0) / a.dur), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      // zoom in log space so it feels even
      const ls = Math.log(a.from.s) + (Math.log(a.to.s) - Math.log(a.from.s)) * e;
      this.view = { cx: a.from.cx + (a.to.cx - a.from.cx) * e, cy: a.from.cy + (a.to.cy - a.from.cy) * e, s: Math.exp(ls) };
      if (u >= 1) this.anim = null; else this.request();
    }
    const pulse = this.selected ? (Math.sin(t / 260) + 1) / 2 : 0;
    this.draw(this.ctx, this.cv.width, this.cv.height, this.dpr, this.view, { k: this.k, pal: PALETTES[this.theme], pulse, main: true });
    if (this.selected && !document.hidden) this._pulseTimer ||= setTimeout(() => { this._pulseTimer = 0; this.request(); }, 60);
  }
  renderNow() { this.frame(performance.now()); }

  // ---------------------------------------------------------------- drawing
  /** Pure draw into any canvas (the screen, or a report thumbnail). W/H in device pixels. */
  draw(ctx, W, H, dpr, view, o) {
    const pal = o.pal;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);
    if (!this.data) return;
    const S = view.s * dpr, ox = W / 2, oy = H / 2;
    const X = (x) => ox + (x - view.cx) * S, Y = (y) => oy - (y - view.cy) * S;
    this._grid(ctx, W, H, dpr, view, X, Y, pal);

    const k = o.k;
    const floors = k > 0 ? [k - 1, k] : [0];
    const aL = Math.min(1, 2 * (1 - this.mix)), aU = Math.min(1, 2 * this.mix);
    const alphaOf = (fi) => (k === 0 ? 1 : fi === k ? aU : aL);
    const colorOf = (fi) => (k === 0 ? pal.ink : fi === k ? pal.above : pal.below);
    const issues = this.data.issues.filter((i) => i.upper === k);

    const polyPath = (pts, T) => {
      const p = new Path2D();
      pts.forEach((q, i) => (i ? p.lineTo(X(q[0] + T.tx), Y(q[1] + T.ty)) : p.moveTo(X(q[0] + T.tx), Y(q[1] + T.ty))));
      p.closePath();
      return p;
    };

    // 1. what the rooms are: dry habitable rooms below (tint), wet rooms above (hatched)
    if (k > 0 && this.show.wet) {
      const lo = this.data.an[k - 1], up = this.data.an[k], TL = this.offset(k - 1), TU = this.offset(k);
      ctx.globalAlpha = 0.13 * aL;
      ctx.fillStyle = pal.below;
      for (const r of lo.rooms) if (DRY_HABITABLE.has(r.type) && r.poly.length) ctx.fill(polyPath(r.poly, TL));
      ctx.globalAlpha = 0.55 * aU;
      ctx.fillStyle = this._hatch(pal.above, dpr, 45, 6);
      for (const r of up.rooms) if (WET.has(r.type) && r.poly.length) ctx.fill(polyPath(r.poly, TU));
      // conflicts: the exact overlap, cross-hatched red
      ctx.globalAlpha = 0.9;
      for (const iss of issues) {
        if (iss.kind !== 'wet-over-dry' || !iss.rooms) continue;
        const ru = up.rooms[iss.rooms[0]], rl = lo.rooms[iss.rooms[1]];
        if (!ru || !rl || !ru.poly.length || !rl.poly.length) continue;
        ctx.save();
        ctx.clip(polyPath(rl.poly, TL));
        ctx.fillStyle = this._hatch(pal[iss.severity], dpr, 45, 5, 1.6);
        ctx.fill(polyPath(ru.poly, TU));
        ctx.fillStyle = this._hatch(pal[iss.severity], dpr, 135, 5, 1.6);
        ctx.fill(polyPath(ru.poly, TU));
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // 2. overhangs: upper footprint outside the lower footprint
    if (k > 0 && this.show.overhang) {
      const lo = this.data.an[k - 1], up = this.data.an[k], TL = this.offset(k - 1), TU = this.offset(k);
      const clip = new Path2D();
      clip.rect(0, 0, W, H);
      for (const L of lo.outlines) clip.addPath(polyPath(L, TL));
      ctx.save();
      ctx.clip(clip, 'evenodd');
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = this._hatch(pal.medium, dpr, 135, 7, 1);
      for (const L of up.outlines) ctx.fill(polyPath(L, TU));
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // 3. line work, additive (screen) / multiply (paper)
    ctx.globalCompositeOperation = pal.blend;
    for (const fi of floors) {
      const T = this.offset(fi), geo = this.data.geometry[fi];
      const a = alphaOf(fi);
      if (a <= 0.01) continue;
      ctx.setTransform(S, 0, 0, -S, ox + (T.tx - view.cx) * S, oy + (view.cy - T.ty) * S);
      ctx.strokeStyle = colorOf(fi);
      ctx.lineCap = 'round';
      for (const role of DRAW_ORDER) {
        const st = ROLE_STYLE[role];
        const path = this._path(fi, role, geo);
        if (!path) continue;
        ctx.globalAlpha = st.a * a;
        ctx.lineWidth = (st.w * dpr) / S;
        ctx.setLineDash(st.dash ? st.dash.map((d) => (d * dpr) / S) : []);
        ctx.stroke(path);
      }
      ctx.setLineDash([]);
      // solid poché on wall layers
      const fills = this._fills(fi, geo);
      if (fills) { ctx.globalAlpha = 0.35 * a; ctx.fillStyle = colorOf(fi); ctx.fill(fills); }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 4. columns: below = solid, above = outline over a light fill
    for (const fi of floors) {
      const an = this.data.an[fi], T = this.offset(fi), a = alphaOf(fi);
      if (a <= 0.01) continue;
      const upper = fi === k && k > 0;
      ctx.fillStyle = colorOf(fi);
      ctx.strokeStyle = colorOf(fi);
      ctx.lineWidth = 1.6 * dpr;
      for (const c of an.columns) {
        const x0 = X(c.box[0] + T.tx), y0 = Y(c.box[3] + T.ty), w = (c.box[2] - c.box[0]) * S, h = (c.box[3] - c.box[1]) * S;
        ctx.globalAlpha = (upper ? 0.28 : 0.85) * a;
        ctx.fillRect(x0, y0, w, h);
        if (upper) { ctx.globalAlpha = a; ctx.strokeRect(x0, y0, w, h); }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 5. what each issue points at
    const TU = k > 0 ? this.offset(k) : null, TL = k > 0 ? this.offset(k - 1) : null;
    const tags = []; // measurement tags, placed after the pins so they can dodge them
    for (const iss of issues) {
      const col = this.dismissed.has(iss.id) ? pal.muted : pal[iss.severity];
      const sel = iss.id === this.selected;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineWidth = (sel ? 2.2 : 1.6) * dpr;
      const ux = X(iss.at[0] + TU.tx), uy = Y(iss.at[1] + TU.ty);
      const lx = X(iss.atLower[0] + TL.tx), ly = Y(iss.atLower[1] + TL.ty);
      if (iss.kind === 'floating-column' || iss.kind === 'column-offset' || iss.kind === 'column-grows') {
        const c = this.data.an[k].columns.find((q) => Math.abs(q.x - iss.at[0]) < 1e-6 && Math.abs(q.y - iss.at[1]) < 1e-6);
        const half = c ? Math.max(c.w, c.h) * S / 2 + 5 * dpr : 12 * dpr;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.strokeRect(ux - half, uy - half, half * 2, half * 2);
        ctx.setLineDash([]);
        if (iss.kind === 'column-offset' && Math.hypot(ux - lx, uy - ly) > 2 * dpr) {
          arrow(ctx, lx, ly, ux, uy, 7 * dpr);
          if (S > 20) tags.push({ x: (lx + ux) / 2, y: (ly + uy) / 2 - 12 * dpr, text: `${Math.round(iss.value * 1000)}`, col });
        }
        if (iss.kind === 'floating-column' && S > 6) {
          // "nothing here" cross where the support should be
          const r = 5 * dpr;
          ctx.beginPath(); ctx.moveTo(lx - r, ly - r); ctx.lineTo(lx + r, ly + r); ctx.moveTo(lx + r, ly - r); ctx.lineTo(lx - r, ly + r); ctx.stroke();
        }
      } else if (/-(offset|missing)$/.test(iss.kind) && iss.rooms) {
        const ru = this.data.an[k].rooms[iss.rooms[0]];
        if (ru && ru.poly.length) { ctx.stroke(polyPath(ru.poly, TU)); }
        if (iss.rooms[1] !== undefined) {
          const rl = this.data.an[k - 1].rooms[iss.rooms[1]];
          if (rl && rl.poly.length) { ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.stroke(polyPath(rl.poly, TL)); ctx.setLineDash([]); }
          if (Math.hypot(ux - lx, uy - ly) > 3 * dpr) {
            arrow(ctx, lx, ly, ux, uy, 7 * dpr);
            if (S > 20) tags.push({ x: (lx + ux) / 2, y: (ly + uy) / 2 - 12 * dpr, text: `${Math.round(iss.value * 1000)}`, col });
          }
        }
      } else if (iss.kind === 'wet-over-dry' && iss.rooms) {
        const ru = this.data.an[k].rooms[iss.rooms[0]];
        if (ru && ru.poly.length && sel) ctx.stroke(polyPath(ru.poly, TU));
      }
    }

    // 6. room names: the floor above in violet; the floor below in cyan only where it differs
    if (this.show.labels && S > 9 * dpr) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fs = Math.round(Math.min(12.5, Math.max(9.5, S / dpr / 3.2)) * dpr);
      const boxes = [];
      const hits = (b) => boxes.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
      const same = (a, b) => a && b && a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
      for (const fi of [...floors].reverse()) {
        const an = this.data.an[fi], T = this.offset(fi), a = alphaOf(fi);
        if (a < 0.25) continue;
        const upper = fi === k;
        ctx.font = `${upper ? 600 : 500} ${fs}px 'IBM Plex Sans', system-ui, sans-serif`;
        for (const r of an.rooms) {
          if (r.type === 'duct' && S < 40 * dpr) continue;
          const wx = r.cx + T.tx, wy = r.cy + T.ty;
          if (!upper && k > 0 && aU > 0.25 && same(r, this.roomAt(k, wx, wy))) continue; // same room both floors: one label
          const [i0, j0, i1, j1] = r.bbox;
          const wpx = (i1 - i0 + 1) * an.grid.res * S, hpx = (j1 - j0 + 1) * an.grid.res * S;
          const label = r.name.length > 18 ? r.name.slice(0, 17) + '…' : r.name;
          const tw = ctx.measureText(label).width;
          if (tw > wpx * 0.95 || hpx < fs * 2) continue;
          let x = X(wx), y = Y(wy);
          let box = [x - tw / 2 - 2, y - fs * 0.6, x + tw / 2 + 2, y + fs * 0.6];
          if (hits(box)) { y += fs * 1.25; box = [box[0], y - fs * 0.6, box[2], y + fs * 0.6]; }
          if (hits(box)) continue;
          boxes.push(box);
          ctx.globalAlpha = a;
          ctx.lineWidth = 3 * dpr; ctx.strokeStyle = pal.halo; ctx.lineJoin = 'round';
          ctx.strokeText(label, x, y);
          ctx.fillStyle = k === 0 ? pal.ink : upper ? pal.above : pal.below;
          ctx.fillText(label, x, y);
        }
      }
      ctx.globalAlpha = 1;
    }

    // 7. pins, placed so neighbours don't cover each other
    const placed = new Map();
    const gap = (2 * PIN_R + 4) * dpr;
    for (const iss of [...issues].sort((p, q) => p.n - q.n)) {
      const tx = X(iss.at[0] + TU.tx), ty = Y(iss.at[1] + TU.ty);
      let best = null;
      for (const o of PIN_SPOTS) {
        const x = tx + o[0] * dpr, y = ty + o[1] * dpr;
        if ([...placed.values()].every((q) => (q.x - x) ** 2 + (q.y - y) ** 2 > gap * gap)) { best = { x, y }; break; }
      }
      placed.set(iss.id, best || { x: tx + PIN_OFF[0] * dpr, y: ty + PIN_OFF[1] * dpr });
    }
    if (o.main) this.pinSpots = new Map([...placed].map(([id, q]) => [id, [q.x / dpr, q.y / dpr]]));
    const order = [...issues].sort((p, q) => (p.id === this.selected) - (q.id === this.selected));
    for (const iss of order) {
      const tx = X(iss.at[0] + TU.tx), ty = Y(iss.at[1] + TU.ty);
      const { x, y } = placed.get(iss.id);
      const sel = iss.id === this.selected, hov = iss.id === this.hoverIssue;
      const off = this.dismissed.has(iss.id);
      const r = (sel ? PIN_R + 3 : hov ? PIN_R + 1.5 : PIN_R) * dpr;
      // leader + target dot
      ctx.strokeStyle = pal.halo; ctx.lineWidth = 4 * dpr;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
      ctx.strokeStyle = off ? pal.muted : pal[iss.severity]; ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = off ? pal.muted : pal[iss.severity];
      ctx.beginPath(); ctx.arc(tx, ty, 2.6 * dpr, 0, Math.PI * 2); ctx.fill();
      if (sel) {
        ctx.globalAlpha = 0.35 * (1 - (o.pulse || 0));
        ctx.strokeStyle = pal[iss.severity]; ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.arc(x, y, r + (6 + 10 * (o.pulse || 0)) * dpr, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = off ? pal.bg : pal[iss.severity];
      ctx.fill();
      ctx.lineWidth = 2 * dpr; ctx.strokeStyle = off ? pal.muted : pal.halo;
      ctx.stroke();
      ctx.fillStyle = off ? pal.muted : iss.severity === 'high' ? '#fff' : '#111';
      ctx.font = `600 ${Math.round(r * 0.95)}px 'IBM Plex Mono', ui-monospace, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(iss.n), x, y + 0.5 * dpr);
    }

    // measurement tags: first free spot around the arrow's midpoint, else left out
    ctx.font = `600 ${Math.round(11 * dpr)}px 'IBM Plex Mono', ui-monospace, monospace`;
    const taken = [...placed.values()].map((q) => [q.x - (PIN_R + 2) * dpr, q.y - (PIN_R + 2) * dpr, q.x + (PIN_R + 2) * dpr, q.y + (PIN_R + 2) * dpr]);
    for (const t of tags) {
      const w = ctx.measureText(t.text).width + 10 * dpr, h = 17 * dpr;
      for (const [dx, dy] of [[0, 0], [0, 28], [-w / dpr - 6, 14], [w / dpr + 6, 14], [0, -24]]) {
        const x = t.x + dx * dpr, y = t.y + dy * dpr, b = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
        if (taken.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1])) continue;
        taken.push(b);
        tag(ctx, x, y, t.text, t.col, pal, dpr);
        break;
      }
    }

    // 8. scale bar
    scaleBar(ctx, S, dpr, 16 * dpr, o.scaleBottom ? H - 12 * dpr : 74 * dpr, pal);
  }

  _grid(ctx, W, H, dpr, view, X, Y, pal) {
    const S = view.s * dpr;
    const step = S > 14 * dpr ? 1 : S > 3 * dpr ? 5 : 25;
    const [x0, y1] = [view.cx - W / 2 / S, view.cy + H / 2 / S];
    const [x1, y0] = [view.cx + W / 2 / S, view.cy - H / 2 / S];
    ctx.lineWidth = 1;
    for (const [st, colr] of [[step, pal.grid], [step * 5, pal.gridMajor]]) {
      ctx.strokeStyle = colr;
      ctx.beginPath();
      for (let x = Math.ceil(x0 / st) * st; x <= x1; x += st) { const sx = Math.round(X(x)) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
      for (let y = Math.ceil(y0 / st) * st; y <= y1; y += st) { const sy = Math.round(Y(y)) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
      ctx.stroke();
    }
  }

  _path(fi, role, geo) {
    const key = fi + ':' + role;
    if (this.paths.has(key)) return this.paths.get(key);
    const arr = geo.lines[role];
    let p = null;
    if (arr && arr.length) {
      p = new Path2D();
      for (let i = 0; i < arr.length; i += 4) { p.moveTo(arr[i], arr[i + 1]); p.lineTo(arr[i + 2], arr[i + 3]); }
    }
    this.paths.set(key, p);
    return p;
  }
  _fills(fi, geo) {
    const key = fi + ':fills';
    if (this.paths.has(key)) return this.paths.get(key);
    let p = null;
    for (const f of geo.fills) {
      if (f.role !== 'wall' || f.pts.length < 3) continue;
      p ||= new Path2D();
      f.pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
      p.closePath();
    }
    this.paths.set(key, p);
    return p;
  }
  _hatch(color, dpr, angle, gap, width = 1.1) {
    const key = `${color}|${dpr}|${angle}|${gap}|${width}`;
    if (this.patterns.has(key)) return this.patterns.get(key);
    const n = Math.max(3, Math.round(gap * dpr));
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const x = c.getContext('2d');
    x.strokeStyle = color; x.lineWidth = width * dpr; x.lineCap = 'square';
    x.beginPath();
    for (const o of [-n, 0, n]) {
      if (angle === 45) { x.moveTo(o, n); x.lineTo(o + n, 0); } else { x.moveTo(o, 0); x.lineTo(o + n, n); }
    }
    x.stroke();
    const pat = this.ctx.createPattern(c, 'repeat');
    this.patterns.set(key, pat);
    return pat;
  }

  // ---------------------------------------------------------------- picking
  roomAt(fi, x, y) {
    const a = this.data.an[fi], T = this.offset(fi), g = a.grid;
    const i = Math.floor((x - T.tx - g.x0) / g.res), j = Math.floor((y - T.ty - g.y0) / g.res);
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) return null;
    const id = a.roomAt[j * g.w + i];
    return id >= 0 ? a.rooms[id] : null;
  }
  columnAt(fi, x, y, tol) {
    const a = this.data.an[fi], T = this.offset(fi);
    const fx = x - T.tx, fy = y - T.ty;
    return a.columns.find((c) => fx >= c.box[0] - tol && fx <= c.box[2] + tol && fy >= c.box[1] - tol && fy <= c.box[3] + tol) || null;
  }
  pinAt(sx, sy) {
    if (!this.data || this.k === 0) return null;
    const T = this.offset(this.k);
    let best = null, bd = (PIN_R + 4) ** 2;
    for (const iss of this.data.issues) {
      if (iss.upper !== this.k) continue;
      const spot = this.pinSpots && this.pinSpots.get(iss.id);
      const [px, py] = spot || this.toScreen(iss.at[0] + T.tx + PIN_OFF[0] / this.view.s, iss.at[1] + T.ty - PIN_OFF[1] / this.view.s);
      const d = (px - sx) ** 2 + (py - sy) ** 2;
      if (d < bd) { bd = d; best = iss; }
    }
    return best;
  }
  probe(sx, sy) {
    const [x, y] = this.toWorld(sx, sy);
    const out = { x, y, sx, sy, issue: this.pinAt(sx, sy) };
    if (!this.data) return out;
    const tol = 3 / this.view.s;
    if (this.k > 0) {
      out.above = this.roomAt(this.k, x, y); out.below = this.roomAt(this.k - 1, x, y);
      out.colAbove = this.columnAt(this.k, x, y, tol); out.colBelow = this.columnAt(this.k - 1, x, y, tol);
    } else {
      out.above = this.roomAt(0, x, y); out.colAbove = this.columnAt(0, x, y, tol);
    }
    return out;
  }

  // ---------------------------------------------------------------- input
  _bind() {
    const cv = this.cv;
    let drag = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      if (!this.data) return;
      cv.setPointerCapture(e.pointerId);
      const [sx, sy] = pos(e);
      this.pointers.set(e.pointerId, [sx, sy]);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        drag = { pinch: true, d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: this.view.s };
        return;
      }
      drag = { sx, sy, lx: sx, ly: sy, moved: false, nudge: !!this.nudge };
    });
    cv.addEventListener('pointermove', (e) => {
      const [sx, sy] = pos(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [sx, sy]);
      if (drag && drag.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.zoomBy((drag.s * d) / drag.d / this.view.s, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        return;
      }
      if (drag && !drag.pinch) {
        const dx = sx - drag.lx, dy = sy - drag.ly;
        if (!drag.moved && Math.hypot(sx - drag.sx, sy - drag.sy) > 3) { drag.moved = true; cv.classList.add('grabbing'); }
        if (drag.moved) {
          if (drag.nudge && this.nudge) {
            this.nudge = { dx: this.nudge.dx + dx / this.view.s, dy: this.nudge.dy - dy / this.view.s };
            this.cb.onNudge && this.cb.onNudge(this.nudge);
          } else {
            this.view = { ...this.view, cx: this.view.cx - dx / this.view.s, cy: this.view.cy + dy / this.view.s };
            this.anim = null;
          }
          this.request();
        }
        drag.lx = sx; drag.ly = sy;
        this.cb.onHover && this.cb.onHover(null);
        return;
      }
      if (!this.data) return;
      const pr = this.probe(sx, sy);
      const hid = pr.issue ? pr.issue.id : null;
      if (hid !== this.hoverIssue) { this.hoverIssue = hid; this.request(); }
      cv.style.cursor = pr.issue ? 'pointer' : '';
      this.cb.onHover && this.cb.onHover(pr);
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      cv.classList.remove('grabbing');
      if (drag && !drag.pinch && !drag.moved && this.data) {
        const [sx, sy] = pos(e);
        const pr = this.probe(sx, sy);
        if (pr.issue) this.cb.onPin && this.cb.onPin(pr.issue);
        else this.cb.onClick && this.cb.onClick(pr);
      }
      if (this.pointers.size < 2 && drag && drag.pinch) drag = null;
      if (!this.pointers.size) drag = null;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { if (!drag) { this.cb.onHover && this.cb.onHover(null); if (this.hoverIssue) { this.hoverIssue = null; this.request(); } } });
    cv.addEventListener('wheel', (e) => {
      if (!this.data) return;
      e.preventDefault();
      const [sx, sy] = pos(e);
      const k = e.deltaMode === 1 ? 0.05 : 0.0022;
      this.zoomBy(Math.exp(-e.deltaY * k * (e.ctrlKey ? 2.2 : 1)), sx, sy);
    }, { passive: false });
    cv.addEventListener('dblclick', (e) => { const [sx, sy] = pos(e); this.zoomBy(1.8, sx, sy); });
  }

  /** A still of one issue for the printed report. */
  snapshot(iss, w = 520, h = 360, theme = 'light') {
    const c = document.createElement('canvas');
    const dpr = 2;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d');
    const T = this.data.transforms[iss.upper];
    const span = iss.kind === 'cantilever' ? 16 : 11;
    const view = { cx: iss.at[0] + T.tx, cy: iss.at[1] + T.ty, s: Math.min(w, h) / span };
    const keep = { k: this.k, sel: this.selected, nudge: this.nudge, pat: this.patterns };
    this.k = iss.upper; this.selected = iss.id; this.nudge = null; this.patterns = new Map();
    const W0 = this.W, H0 = this.H;
    this.W = w; this.H = h;
    this.draw(ctx, c.width, c.height, dpr, view, { k: iss.upper, pal: PALETTES[theme], pulse: 0.6, scaleBottom: true });
    this.W = W0; this.H = H0;
    this.k = keep.k; this.selected = keep.sel; this.nudge = keep.nudge; this.patterns = keep.pat;
    return c.toDataURL('image/png');
  }
}

function arrow(ctx, x0, y0, x1, y1, head) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - head * Math.cos(a - 0.45), y1 - head * Math.sin(a - 0.45));
  ctx.lineTo(x1 - head * Math.cos(a + 0.45), y1 - head * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill();
}

function tag(ctx, x, y, text, color, pal, dpr) {
  ctx.font = `600 ${Math.round(11 * dpr)}px 'IBM Plex Mono', ui-monospace, monospace`;
  const w = ctx.measureText(text).width + 10 * dpr, h = 17 * dpr;
  ctx.fillStyle = pal.bg; ctx.globalAlpha = 0.92;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 4 * dpr); ctx.fill();
  ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 1 * dpr; ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5 * dpr);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function scaleBar(ctx, S, dpr, x, y, pal) {
  const target = 110 * dpr;
  const nice = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  let m = nice[0];
  for (const n of nice) if (n * S <= target) m = n;
  const w = m * S;
  ctx.strokeStyle = pal.muted; ctx.fillStyle = pal.muted; ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(x, y - 5 * dpr); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y - 5 * dpr); ctx.stroke();
  ctx.font = `500 ${Math.round(10.5 * dpr)}px 'IBM Plex Mono', ui-monospace, monospace`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText(`${m} m`, x + w + 6 * dpr, y + 2 * dpr);
}
