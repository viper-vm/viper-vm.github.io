// Plumb — minimal DXF writer (AutoCAD R12 / AC1009, readable by every CAD package).
// Used for the sample drawings and for exporting issue markers as an overlay.

export class DxfWriter {
  constructor() {
    this.layers = new Map(); // name → {color, ltype}
    this.body = [];
    this.layer('0', 7);
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
    push(0, 'SECTION', 2, 'BLOCKS', 0, 'ENDSEC');
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
