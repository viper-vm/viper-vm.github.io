// Plumb — the whole sheet, for marking floor plans by hand. Drag across empty space to draw a box
// round a plan, drag a box to move it, pull its corners or edges to resize, Delete removes it.
// Scroll or two-finger drag pans, ⌘/Ctrl + scroll or pinch zooms, F fits.

const HANDLE = 7;     // px, half the grab size of a resize handle
const MIN_PX = 12;    // a drag smaller than this is a click
const MIN_M = 0.5;    // no floor smaller than half a metre

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

export class SheetEditor {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onAdd?:Function, onChange?:Function, onRemove?:Function, onSelect?:Function, onCamera?:Function}} cb
   *   onAdd(box) · onChange(i, box) · onRemove(i) · onSelect(i or -1) · onCamera(cam) — boxes in drawing metres
   */
  constructor(canvas, cb = {}, cam = null) {
    this.cv = canvas;
    this.cb = cb;
    this.cam = cam ? { ...cam } : null; // { cx, cy, s }: the world point at the centre, px per metre
    this.auto = !cam;   // fitted automatically: refit when the canvas changes size (until you pan or zoom)
    this.sheet = null;
    this.floors = [];   // [{ box:[x0,y0,x1,y1], tag, title, excluded }]
    this.sel = -1;
    this.drag = null;
    this.base = null;   // the linework drawn once per camera
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.raf = 0;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'The whole sheet. Drag across a floor plan to mark it; Delete removes the selected box.');
    this._on = [
      ['pointerdown', (e) => this.down(e)], ['pointermove', (e) => this.move(e)], ['pointerup', (e) => this.up(e)],
      ['pointercancel', () => this.cancel()], ['wheel', (e) => this.wheel(e), { passive: false }], ['keydown', (e) => this.key(e)],
    ];
    for (const [t, f, o] of this._on) canvas.addEventListener(t, f, o);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  destroy() {
    for (const [t, f, o] of this._on) this.cv.removeEventListener(t, f, o);
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }

  setSheet(sheet) { this.sheet = sheet; this.base = null; if (!this.cam) this.fit(); else this.request(); }
  setFloors(floors, sel = this.sel) { this.floors = floors; this.sel = sel; this.request(); }

  // ------------------------------------------------------------------ camera
  resize() {
    const r = this.cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * this.dpr)), h = Math.max(1, Math.round(r.height * this.dpr));
    if (w === this.cv.width && h === this.cv.height) return;
    this.cv.width = w; this.cv.height = h;
    this.base = null;
    if (this.sheet && (!this.cam || this.auto)) this.fit(); else this.request();
  }
  get W() { return this.cv.width / this.dpr; }
  get H() { return this.cv.height / this.dpr; }
  fit() {
    const s = this.sheet;
    if (!s) return;
    const pad = 24, W = this.W, H = this.H;
    const k = Math.min((W - 2 * pad) / Math.max(s.w, 1e-6), (H - 2 * pad) / Math.max(s.h, 1e-6));
    this.auto = true;
    this.setCam({ cx: s.x0 + s.w / 2, cy: s.y0 + s.h / 2, s: k > 0 ? k : 1 });
  }
  zoom(f, X = this.W / 2, Y = this.H / 2) {
    if (!this.cam) return;
    const [wx, wy] = this.toWorld(X, Y);
    const s = Math.max(1e-4, Math.min(1e5, this.cam.s * f));
    // keep the point under the cursor where it is
    this.auto = false;
    this.setCam({ s, cx: wx - (X - this.W / 2) / s, cy: wy + (Y - this.H / 2) / s });
  }
  setCam(cam) { this.cam = cam; this.base = null; this.request(); if (this.cb.onCamera) this.cb.onCamera({ ...cam, auto: this.auto }); }
  toScreen(x, y) { const c = this.cam; return [(x - c.cx) * c.s + this.W / 2, this.H / 2 - (y - c.cy) * c.s]; }
  toWorld(X, Y) { const c = this.cam; return [(X - this.W / 2) / c.s + c.cx, c.cy - (Y - this.H / 2) / c.s]; }
  rectOf(b) {
    const [X0, Y1] = this.toScreen(b[0], b[1]), [X1, Y0] = this.toScreen(b[2], b[3]);
    return [X0, Y0, X1, Y1]; // screen: left, top, right, bottom
  }

  // ------------------------------------------------------------------ drawing
  request() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }
  colors() {
    const cs = getComputedStyle(this.cv);
    const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    return { bg: v('--panel', '#111418'), ink: v('--ink', '#e9ecef'), muted: v('--muted', '#8a94a1'), faint: v('--faint', '#5d6774'), brass: v('--brass', '#e2ad4d'), card: v('--card', '#1a1f25') };
  }
  drawBase(C) {
    const cv = document.createElement('canvas');
    cv.width = this.cv.width; cv.height = this.cv.height;
    const g = cv.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, this.W, this.H);
    const s = this.sheet;
    if (s && this.cam) {
      const c = this.cam, ox = (s.x0 - c.cx) * c.s + this.W / 2, oy = this.H / 2 + (c.cy - s.y0) * c.s, k = c.s;
      const segs = s.segs, wt = s.weight;
      // light lines first, walls last and darkest
      for (const [w, alpha, lw] of [[0, 0.22, 0.8], [1, 0.4, 0.9], [2, 0.6, 1], [3, 0.95, 1.2]]) {
        g.beginPath();
        for (let i = 0; i < wt.length; i++) {
          if (wt[i] !== w) continue;
          const a = ox + segs[i * 4] * k, b = oy - segs[i * 4 + 1] * k, e = ox + segs[i * 4 + 2] * k, f = oy - segs[i * 4 + 3] * k;
          if ((a < 0 && e < 0) || (a > this.W && e > this.W) || (b < 0 && f < 0) || (b > this.H && f > this.H)) continue;
          g.moveTo(a, b); g.lineTo(e, f);
        }
        g.globalAlpha = alpha; g.strokeStyle = C.ink; g.lineWidth = lw; g.stroke();
      }
      g.globalAlpha = 1;
      // texts big enough to read: titles and room names help find the plans
      g.fillStyle = C.muted;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const t of s.texts) {
        const px = t.h * k;
        if (px < 7) continue;
        const X = ox + t.x * k, Y = oy - t.y * k;
        if (X < -200 || X > this.W + 200 || Y < -50 || Y > this.H + 50) continue;
        g.save();
        g.translate(X, Y); g.rotate((-t.rot * Math.PI) / 180);
        g.font = `500 ${Math.min(px, 28)}px 'IBM Plex Sans', system-ui, sans-serif`;
        g.fillText(t.text, 0, 0);
        g.restore();
      }
    }
    this.base = cv;
  }
  draw() {
    const ctx = this.cv.getContext('2d');
    const C = this.colors();
    if (!this.base) this.drawBase(C);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    if (!this.cam) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const shown = this.floors.map((f, i) => ({ ...f, box: this.drag && this.drag.i === i && this.drag.box ? this.drag.box : f.box, i }));
    // unselected first, the selected box on top
    shown.sort((a, b) => (a.i === this.sel) - (b.i === this.sel));
    for (const f of shown) {
      const [l, t, r, b] = this.rectOf(f.box), on = f.i === this.sel;
      ctx.save();
      if (f.excluded) { ctx.setLineDash([5, 4]); ctx.strokeStyle = C.faint; ctx.lineWidth = 1.2; ctx.strokeRect(l, t, r - l, b - t); ctx.restore(); continue; }
      ctx.fillStyle = C.brass; ctx.globalAlpha = on ? 0.12 : 0.06; ctx.fillRect(l, t, r - l, b - t);
      ctx.globalAlpha = 1; ctx.strokeStyle = C.brass; ctx.lineWidth = on ? 2.2 : 1.4; ctx.strokeRect(l, t, r - l, b - t);
      // label chip: level tag and name
      const label = `${f.tag}  ${f.title || ''}`.trim();
      ctx.font = "600 11.5px 'IBM Plex Mono', ui-monospace, monospace";
      const tw = Math.min(ctx.measureText(label).width + 12, Math.max(40, r - l));
      const ly = t - 20 > 0 ? t - 20 : t + 2;
      ctx.fillStyle = on ? C.brass : C.card; ctx.globalAlpha = 0.95;
      ctx.fillRect(l, ly, tw, 18);
      ctx.globalAlpha = 1; ctx.fillStyle = on ? '#16191d' : C.ink; ctx.textBaseline = 'middle';
      ctx.save(); ctx.beginPath(); ctx.rect(l, ly, tw, 18); ctx.clip(); ctx.fillText(label, l + 6, ly + 9.5); ctx.restore();
      if (on) for (const [, X, Y] of this.handles(f.box)) { ctx.fillStyle = '#fff'; ctx.strokeStyle = C.brass; ctx.lineWidth = 1.5; ctx.fillRect(X - 4, Y - 4, 8, 8); ctx.strokeRect(X - 4, Y - 4, 8, 8); }
      ctx.restore();
    }
    if (this.drag && this.drag.mode === 'new' && this.drag.box) {
      const [l, t, r, b] = this.rectOf(this.drag.box);
      ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = C.brass; ctx.lineWidth = 1.6; ctx.strokeRect(l, t, r - l, b - t);
      ctx.fillStyle = C.brass; ctx.globalAlpha = 0.08; ctx.fillRect(l, t, r - l, b - t); ctx.restore();
    }
  }

  // ------------------------------------------------------------------ hit testing
  handles(box) {
    const [l, t, r, b] = this.rectOf(box), mx = (l + r) / 2, my = (t + b) / 2;
    const at = { nw: [l, t], n: [mx, t], ne: [r, t], e: [r, my], se: [r, b], s: [mx, b], sw: [l, b], w: [l, my] };
    return HANDLES.map((h) => [h, ...at[h]]);
  }
  hit(X, Y) {
    if (this.sel >= 0 && this.floors[this.sel] && !this.floors[this.sel].excluded) {
      for (const [h, hx, hy] of this.handles(this.floors[this.sel].box)) if (Math.abs(X - hx) <= HANDLE && Math.abs(Y - hy) <= HANDLE) return { i: this.sel, handle: h };
    }
    const inside = (i) => { const [l, t, r, b] = this.rectOf(this.floors[i].box); return X >= l - 3 && X <= r + 3 && Y >= t - 3 && Y <= b + 3; };
    if (this.sel >= 0 && this.floors[this.sel] && inside(this.sel)) return { i: this.sel };
    // the smallest box under the pointer: a floor drawn inside a bigger one stays reachable
    let best = -1, bestA = Infinity;
    this.floors.forEach((f, i) => {
      if (!inside(i)) return;
      const a = (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
      if (a < bestA) { bestA = a; best = i; }
    });
    return best >= 0 ? { i: best } : null;
  }

  // ------------------------------------------------------------------ pointer + keys
  local(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  down(e) {
    if (!this.cam || (e.button !== 0 && e.button !== 1)) return;
    this.cv.focus({ preventScroll: true });
    const [X, Y] = this.local(e);
    this.cv.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.altKey || this.space) { this.drag = { mode: 'pan', X, Y, cam: { ...this.cam } }; return; }
    const h = this.hit(X, Y);
    if (h && h.handle) this.drag = { mode: 'resize', i: h.i, handle: h.handle, start: [...this.floors[h.i].box], X, Y };
    else if (h) {
      if (h.i !== this.sel) { this.sel = h.i; if (this.cb.onSelect) this.cb.onSelect(h.i); }
      this.drag = this.floors[h.i].excluded ? null : { mode: 'move', i: h.i, start: [...this.floors[h.i].box], X, Y };
    } else this.drag = { mode: 'new', X, Y, w0: this.toWorld(X, Y) };
    this.request();
  }
  move(e) {
    const [X, Y] = this.local(e);
    const d = this.drag;
    if (!d) {
      const h = this.cam && this.hit(X, Y);
      this.cv.style.cursor = this.space ? 'grab' : h && h.handle ? CURSOR[h.handle] : h ? (this.floors[h.i].excluded ? 'pointer' : 'move') : 'crosshair';
      return;
    }
    const s = this.cam.s, dx = (X - d.X) / s, dy = -(Y - d.Y) / s;
    if (d.mode === 'pan') { this.auto = false; this.setCam({ ...d.cam, cx: d.cam.cx - (X - d.X) / d.cam.s, cy: d.cam.cy + (Y - d.Y) / d.cam.s }); return; }
    if (d.mode === 'move') d.box = [d.start[0] + dx, d.start[1] + dy, d.start[2] + dx, d.start[3] + dy];
    else if (d.mode === 'resize') {
      const b = [...d.start];
      if (d.handle.includes('w')) b[0] = Math.min(d.start[0] + dx, b[2] - MIN_M);
      if (d.handle.includes('e')) b[2] = Math.max(d.start[2] + dx, b[0] + MIN_M);
      if (d.handle.includes('s')) b[1] = Math.min(d.start[1] + dy, b[3] - MIN_M);
      if (d.handle.includes('n')) b[3] = Math.max(d.start[3] + dy, b[1] + MIN_M);
      d.box = b;
    } else if (d.mode === 'new') {
      const [wx, wy] = this.toWorld(X, Y);
      d.box = [Math.min(d.w0[0], wx), Math.min(d.w0[1], wy), Math.max(d.w0[0], wx), Math.max(d.w0[1], wy)];
      d.px = Math.min(Math.abs(X - d.X), Math.abs(Y - d.Y));
    }
    this.request();
  }
  up(e) {
    const d = this.drag;
    this.drag = null;
    if (e && this.cv.hasPointerCapture(e.pointerId)) this.cv.releasePointerCapture(e.pointerId);
    if (!d) return;
    if ((d.mode === 'move' || d.mode === 'resize') && d.box && d.box.some((v, k) => Math.abs(v - d.start[k]) > 1e-6)) {
      this.floors[d.i] = { ...this.floors[d.i], box: d.box };
      if (this.cb.onChange) this.cb.onChange(d.i, d.box);
    } else if (d.mode === 'new') {
      const big = d.box && d.px >= MIN_PX && d.box[2] - d.box[0] >= MIN_M && d.box[3] - d.box[1] >= MIN_M;
      if (big && this.cb.onAdd) this.cb.onAdd(d.box);
      else if (this.sel !== -1) { this.sel = -1; if (this.cb.onSelect) this.cb.onSelect(-1); }
    }
    this.request();
  }
  cancel() { this.drag = null; this.request(); }
  wheel(e) {
    if (!this.cam) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { const [X, Y] = this.local(e); this.zoom(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), X, Y); return; }
    const k = e.deltaMode ? 16 : 1;
    this.auto = false;
    this.setCam({ ...this.cam, cx: this.cam.cx + (e.deltaX * k) / this.cam.s, cy: this.cam.cy - (e.deltaY * k) / this.cam.s });
  }
  key(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel >= 0) { e.preventDefault(); if (this.cb.onRemove) this.cb.onRemove(this.sel); return; }
    if (e.key === 'Escape') { if (this.drag) this.cancel(); else if (this.sel >= 0) { this.sel = -1; if (this.cb.onSelect) this.cb.onSelect(-1); this.request(); } return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); this.fit(); return; }
    if (e.key === '+' || e.key === '=') { this.zoom(1.25); return; }
    if (e.key === '-') { this.zoom(0.8); return; }
    if (e.key === ' ' && !this.space) {
      e.preventDefault();
      this.space = true; this.cv.style.cursor = 'grab';
      this.cv.addEventListener('keyup', (u) => { if (u.key === ' ') { this.space = false; this.cv.style.cursor = 'crosshair'; } }, { once: true });
    }
  }
}
