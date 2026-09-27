// Plumb — raster toolkit: occupancy grids, flood-fill labelling, distance transforms and
// contour tracing. Topology is found on the grid (robust to sloppy CAD: tiny gaps, overlaps);
// coordinates stay in metres.

export class Grid {
  /** Covers [x0,x1]×[y0,y1] (metres) with square cells of size res. */
  constructor(x0, y0, x1, y1, res) {
    this.res = res;
    this.x0 = x0; this.y0 = y0;
    this.w = Math.max(1, Math.ceil((x1 - x0) / res));
    this.h = Math.max(1, Math.ceil((y1 - y0) / res));
    this.data = new Uint8Array(this.w * this.h); // 0 = free, 1 = solid
  }
  cx(x) { return (x - this.x0) / this.res; }
  cy(y) { return (y - this.y0) / this.res; }
  wx(i) { return this.x0 + (i + 0.5) * this.res; }
  wy(j) { return this.y0 + (j + 0.5) * this.res; }
  idx(x, y) {
    const i = Math.floor(this.cx(x)), j = Math.floor(this.cy(y));
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  /** Stamp a segment with a square brush of half-size r cells (r=0 → 1 cell). */
  seg(x1, y1, x2, y2, r = 0, v = 1) {
    const a0 = this.cx(x1), b0 = this.cy(y1), a1 = this.cx(x2), b1 = this.cy(y2);
    const len = Math.hypot(a1 - a0, b1 - b0);
    const n = Math.max(1, Math.ceil(len * 2));
    const W = this.w, H = this.h, d = this.data;
    const ri = Math.ceil(r);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const i = Math.floor(a0 + (a1 - a0) * t), j = Math.floor(b0 + (b1 - b0) * t);
      for (let dj = -ri; dj <= ri; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= H) continue;
        const row = jj * W;
        for (let di = -ri; di <= ri; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= W) continue;
          d[row + ii] = v;
        }
      }
    }
  }

  /** Fill a polygon (even-odd scanline). */
  poly(pts, v = 1) {
    if (pts.length < 3) return;
    const W = this.w, H = this.h, d = this.data;
    let yMin = Infinity, yMax = -Infinity;
    const P = pts.map((p) => [this.cx(p[0]), this.cy(p[1])]);
    for (const p of P) { if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1]; }
    const j0 = Math.max(0, Math.floor(yMin)), j1 = Math.min(H - 1, Math.ceil(yMax));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const yc = j + 0.5;
      xs.length = 0;
      for (let k = 0, n = P.length; k < n; k++) {
        const a = P[k], b = P[(k + 1) % n];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
          xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let i = i0; i <= i1; i++) d[j * W + i] = v;
      }
    }
  }
}

/**
 * 4-connected components of cells where mask[i] === target.
 * Returns { labels: Int32Array (−1 elsewhere), count, sizes, touchesBorder:boolean[], bbox:[i0,j0,i1,j1][] }
 */
export function label(mask, W, H, target = 0) {
  const labels = new Int32Array(W * H).fill(-1);
  const stack = new Int32Array(W * H);
  const sizes = [], border = [], bbox = [];
  let count = 0;
  for (let s = 0; s < W * H; s++) {
    if (mask[s] !== target || labels[s] !== -1) continue;
    const id = count++;
    let sp = 0, size = 0, touches = false;
    let i0 = W, j0 = H, i1 = -1, j1 = -1;
    stack[sp++] = s;
    labels[s] = id;
    while (sp) {
      const c = stack[--sp];
      size++;
      const i = c % W, j = (c - i) / W;
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
      if (i === 0 || j === 0 || i === W - 1 || j === H - 1) touches = true;
      if (i > 0) { const n = c - 1; if (mask[n] === target && labels[n] === -1) { labels[n] = id; stack[sp++] = n; } }
      if (i < W - 1) { const n = c + 1; if (mask[n] === target && labels[n] === -1) { labels[n] = id; stack[sp++] = n; } }
      if (j > 0) { const n = c - W; if (mask[n] === target && labels[n] === -1) { labels[n] = id; stack[sp++] = n; } }
      if (j < H - 1) { const n = c + W; if (mask[n] === target && labels[n] === -1) { labels[n] = id; stack[sp++] = n; } }
    }
    sizes.push(size); border.push(touches); bbox.push([i0, j0, i1, j1]);
  }
  return { labels, count, sizes, touchesBorder: border, bbox };
}

/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher), in cells.
 * Distance from every cell to the nearest cell where src[i] is truthy.
 */
export function distanceTransform(src, W, H) {
  const INF = 1e20;
  const f = new Float64Array(Math.max(W, H));
  const d = new Float64Array(Math.max(W, H));
  const v = new Int32Array(Math.max(W, H));
  const z = new Float64Array(Math.max(W, H) + 1);
  const out = new Float64Array(W * H);
  for (let k = 0; k < W * H; k++) out[k] = src[k] ? 0 : INF;
  const pass = (n) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) f[j] = out[j * W + i];
    pass(H);
    for (let j = 0; j < H; j++) out[j * W + i] = d[j];
  }
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) f[i] = out[j * W + i];
    pass(W);
    for (let i = 0; i < W; i++) out[j * W + i] = Math.sqrt(d[i]);
  }
  return out;
}

/**
 * Outer boundary of the cells where pred(index) is true, containing seed cell `s`.
 * Moore-neighbour tracing on cell corners → polygon in cell coordinates, then simplified.
 */
export function traceOuter(pred, W, H, s) {
  // walk left from the seed to hit the boundary on the region's left edge
  let i = s % W, j = (s - i) / W;
  while (i > 0 && pred(j * W + i - 1)) i--;
  // trace the boundary edges with the "left hand on the wall" rule on the cell-corner lattice
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && pred(y * W + x);
  // start at the corner (i, j) (bottom-left of cell i,j) heading up (+y) with the region on the right
  const pts = [];
  let x = i, y = j, dir = 1; // 0:+x 1:+y 2:-x 3:-y
  const x0 = x, y0 = y, d0 = dir;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  let guard = 0;
  // cells to the left/right of an edge from corner (x,y) in direction dir
  const rightCell = (x, y, d) => {
    switch (d) {
      case 0: return [x, y - 1];      // moving +x: right side is below
      case 1: return [x, y];          // moving +y: right side is the cell at (x, y)
      case 2: return [x - 1, y];      // moving -x: right side is above
      default: return [x - 1, y - 1]; // moving -y: right side is left
    }
  };
  const leftCell = (x, y, d) => {
    switch (d) {
      case 0: return [x, y];
      case 1: return [x - 1, y];
      case 2: return [x - 1, y - 1];
      default: return [x, y - 1];
    }
  };
  do {
    pts.push([x, y]);
    x += DX[dir]; y += DY[dir];
    // at the new corner prefer a right turn, then straight, then left (keeps the region on the
    // right and treats diagonal-only contacts as separate: 4-connectivity)
    for (const turn of [3, 0, 1, 2]) {
      const nd = (dir + turn) % 4;
      const r = rightCell(x, y, nd), l = leftCell(x, y, nd);
      if (inside(r[0], r[1]) && !inside(l[0], l[1])) { dir = nd; break; }
    }
    if (++guard > 4 * W * H + 8) break;
  } while (!(x === x0 && y === y0 && dir === d0));
  return simplifyClosed(mergeCollinear(pts), 0.75);
}

/**
 * Every boundary loop (outer outlines and holes) of the cells where pred(index) is true.
 * Returns rings of cell-corner coordinates (region on the right when walking the ring).
 */
export function allContours(pred, W, H, tol = 0.75) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && pred(y * W + x);
  const seen = new Uint8Array((W + 1) * H);
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const rightCell = (x, y, d) => (d === 0 ? [x, y - 1] : d === 1 ? [x, y] : d === 2 ? [x - 1, y] : [x - 1, y - 1]);
  const leftCell = (x, y, d) => (d === 0 ? [x, y] : d === 1 ? [x - 1, y] : d === 2 ? [x - 1, y - 1] : [x, y - 1]);
  const loops = [];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!inside(i, j) || inside(i - 1, j) || seen[j * (W + 1) + i]) continue;
      const pts = [];
      let x = i, y = j, dir = 1, guard = 0;
      do {
        pts.push([x, y]);
        if (dir === 1) seen[y * (W + 1) + x] = 1;
        x += DX[dir]; y += DY[dir];
        for (const turn of [3, 0, 1, 2]) {
          const nd = (dir + turn) % 4;
          const r = rightCell(x, y, nd), l = leftCell(x, y, nd);
          if (inside(r[0], r[1]) && !inside(l[0], l[1])) { dir = nd; break; }
        }
        if (++guard > 4 * (W + 1) * (H + 1)) break;
      } while (!(x === i && y === j && dir === 1));
      const ring = mergeCollinear(pts);
      loops.push(tol > 0 ? simplifyClosed(ring, tol) : ring);
    }
  }
  return loops;
}

function mergeCollinear(pts) {
  const out = [];
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const a = pts[(k - 1 + n) % n], b = pts[k], c = pts[(k + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) out.push(b);
  }
  return out.length >= 3 ? out : pts;
}

/** Douglas–Peucker on a closed ring. */
export function simplifyClosed(pts, tol) {
  const n = pts.length;
  if (n <= 4) return pts;
  // split at the two farthest-apart points
  let a = 0, b = 0, best = -1;
  for (let k = 0; k < n; k++) {
    const d = (pts[k][0] - pts[0][0]) ** 2 + (pts[k][1] - pts[0][1]) ** 2;
    if (d > best) { best = d; b = k; }
  }
  const part = (from, to) => {
    const seq = [];
    for (let k = from; ; k = (k + 1) % n) { seq.push(pts[k]); if (k === to) break; }
    return dp(seq, tol);
  };
  const p1 = part(a, b), p2 = part(b, a);
  return p1.slice(0, -1).concat(p2.slice(0, -1));
}

function dp(seq, tol) {
  if (seq.length <= 2) return seq.slice();
  const [ax, ay] = seq[0], [bx, by] = seq[seq.length - 1];
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
  let idx = -1, dmax = -1;
  for (let k = 1; k < seq.length - 1; k++) {
    const d = Math.abs((seq[k][0] - ax) * dy - (seq[k][1] - ay) * dx) / L;
    if (d > dmax) { dmax = d; idx = k; }
  }
  if (dmax <= tol) return [seq[0], seq[seq.length - 1]];
  const l = dp(seq.slice(0, idx + 1), tol), r = dp(seq.slice(idx), tol);
  return l.slice(0, -1).concat(r);
}

export function polyArea(pts) {
  let s = 0;
  for (let k = 0, n = pts.length; k < n; k++) {
    const a = pts[k], b = pts[(k + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
