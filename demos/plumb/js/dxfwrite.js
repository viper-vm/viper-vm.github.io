// Plumb — minimal DXF writer (AutoCAD R12 / AC1009, readable by every CAD package).
// Used for the sample drawings and for exporting issue markers as an overlay.

export class DxfWriter {
  constructor() {
    this.layers = new Map(); // name → {color, ltype}
    this.body = [];
    this.blocks = [];        // {name, flags, body}
    this.nDim = 0;
    this.layer('0', 7);
  }

  /** Define a block: whatever fn draws goes into it instead of the model. */
  block(name, fn, flags = 0) {
    const keep = this.body;
    this.body = [];
    fn(this);
    this.blocks.push({ name, flags, body: this.body });
    this.body = keep;
    return this;
  }

  /**
   * A linear dimension from p1 to p2, its dimension line through `at` at angle rot (0 = horizontal,
   * 90 = vertical), drawn the way AutoCAD stores it: a DIMENSION entity plus an anonymous *D block
   * holding the extension lines, architectural ticks and text.
   */
  dimLinear(p1, p2, at, rot, layer, { h = 150, text = null, fmt = (v) => String(Math.round(v)) } = {}) {
    const r = (rot * Math.PI) / 180, dir = [Math.cos(r), Math.sin(r)], n = [-dir[1], dir[0]];
    const foot = (p) => { const t = (p[0] - at[0]) * dir[0] + (p[1] - at[1]) * dir[1]; return [at[0] + dir[0] * t, at[1] + dir[1] * t]; };
    const f1 = foot(p1), f2 = foot(p2);
    const value = Math.abs((p2[0] - p1[0]) * dir[0] + (p2[1] - p1[1]) * dir[1]);
    const tp = [(f1[0] + f2[0]) / 2 + n[0] * h * 0.8, (f1[1] + f2[1]) / 2 + n[1] * h * 0.8];
    const name = `*D${++this.nDim}`;
    this.block(name, (w) => {
      w.line(f1[0], f1[1], f2[0], f2[1], '0');
      const tick = [(dir[0] - dir[1]) / Math.SQRT2, (dir[0] + dir[1]) / Math.SQRT2];
      for (const [p, q] of [[p1, f1], [p2, f2]]) {
        const v = [q[0] - p[0], q[1] - p[1]], L = Math.hypot(v[0], v[1]);
        if (L > 1e-6) { const u = [v[0] / L, v[1] / L]; w.line(p[0] + u[0] * h * 0.5, p[1] + u[1] * h * 0.5, q[0] + u[0] * h * 0.6, q[1] + u[1] * h * 0.6, '0'); }
        w.line(q[0] - tick[0] * h * 0.5, q[1] - tick[1] * h * 0.5, q[0] + tick[0] * h * 0.5, q[1] + tick[1] * h * 0.5, '0');
      }
      w.text(tp[0], tp[1], h, text ?? fmt(value), '0', 'middle', rot);
    }, 1);
    this._e('DIMENSION', layer, [2, name, 10, f(f2[0]), 20, f(f2[1]), 30, 0, 11, f(tp[0]), 21, f(tp[1]), 31, 0, 70, 0, 1, '',
      13, f(p1[0]), 23, f(p1[1]), 33, 0, 14, f(p2[0]), 24, f(p2[1]), 34, 0, 50, f(rot)]);
    return this;
  }

  layer(name, color = 7, ltype = 'CONTINUOUS') {
    if (!this.layers.has(name)) this.layers.set(name, { color, ltype });
    return this;
  }

  _e(type, layer, pairs) {
    this.body.push(0, type, 8, layer);
    for (let i = 0; i < pairs.length; i += 2) this.body.push(pairs[i], pairs[i + 1]);
  }

  line(x1, y1, x2, y2, layer = '0') {
    this._e('LINE', layer, [10, f(x1), 20, f(y1), 30, 0, 11, f(x2), 21, f(y2), 31, 0]);
    return this;
  }

  /** Open or closed polyline; pts = [[x,y], …] */
  poly(pts, closed = false, layer = '0') {
    this._e('POLYLINE', layer, [66, 1, 10, 0, 20, 0, 30, 0, 70, closed ? 1 : 0]);
    for (const p of pts) this.body.push(0, 'VERTEX', 8, layer, 10, f(p[0]), 20, f(p[1]), 30, 0);
    this.body.push(0, 'SEQEND', 8, layer);
    return this;
  }

  rect(x0, y0, x1, y1, layer = '0') { return this.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true, layer); }

  /** Arc: angles in degrees, counter-clockwise from a0 to a1. */
  arc(cx, cy, r, a0, a1, layer = '0') {
    this._e('ARC', layer, [10, f(cx), 20, f(cy), 30, 0, 40, f(r), 50, f(a0), 51, f(a1)]);
    return this;
  }

  circle(cx, cy, r, layer = '0') {
    this._e('CIRCLE', layer, [10, f(cx), 20, f(cy), 30, 0, 40, f(r)]);
    return this;
  }

  /** Filled quadrilateral (R12 SOLID uses the "bow-tie" vertex order 1,2,4,3). */
  solidRect(x0, y0, x1, y1, layer = '0') {
    this._e('SOLID', layer, [10, f(x0), 20, f(y0), 30, 0, 11, f(x1), 21, f(y0), 31, 0, 12, f(x0), 22, f(y1), 32, 0, 13, f(x1), 23, f(y1), 33, 0]);
    return this;
  }

  /** Single-line text; align 'left' | 'center' | 'middle'. */
  text(x, y, h, s, layer = '0', align = 'left', rot = 0) {
    const str = String(s).replace(/\r?\n/g, ' ');
    if (align === 'left') this._e('TEXT', layer, [10, f(x), 20, f(y), 30, 0, 40, f(h), 1, str, 50, f(rot)]);
    else {
      const h72 = align === 'center' ? 1 : 4; // 4 = middle (horizontal + vertical centre)
      this._e('TEXT', layer, [10, f(x), 20, f(y), 30, 0, 40, f(h), 1, str, 50, f(rot), 72, h72, 11, f(x), 21, f(y), 31, 0]);
    }
    return this;
  }

  toString() {
    const out = [];
    const push = (...a) => { for (const v of a) out.push(String(v)); };
    push(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSBASE', 10, 0, 20, 0, 30, 0, 9, '$MEASUREMENT', 70, 1, 0, 'ENDSEC');
    push(0, 'SECTION', 2, 'TABLES');
    push(0, 'TABLE', 2, 'LTYPE', 70, 1, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0, 0, 'ENDTAB');
    push(0, 'TABLE', 2, 'LAYER', 70, this.layers.size);
    for (const [name, l] of this.layers) push(0, 'LAYER', 2, name, 70, 0, 62, l.color, 6, l.ltype);
    push(0, 'ENDTAB');
    push(0, 'TABLE', 2, 'STYLE', 70, 1, 0, 'STYLE', 2, 'STANDARD', 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 2.5, 3, 'txt', 4, '', 0, 'ENDTAB');
    push(0, 'ENDSEC');
    push(0, 'SECTION', 2, 'BLOCKS');
    for (const b of this.blocks) {
      push(0, 'BLOCK', 8, '0', 2, b.name, 70, b.flags, 10, 0, 20, 0, 30, 0, 3, b.name);
      for (const v of b.body) out.push(String(v));
      push(0, 'ENDBLK', 8, '0');
    }
    push(0, 'ENDSEC');
    push(0, 'SECTION', 2, 'ENTITIES');
    for (const v of this.body) out.push(String(v));
    push(0, 'ENDSEC', 0, 'EOF');
    return out.join('\n') + '\n';
  }
}

const f = (v) => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};
