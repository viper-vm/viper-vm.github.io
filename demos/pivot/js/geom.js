// Pivot — geometry kernel.
// Quaternions are [x, y, z, w]; rotation matrices are row-major 3×3 arrays where
// column j is the body's j-th axis expressed in world coordinates (world = R · local).
// Units are centimetres throughout.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const Q_IDENTITY = Object.freeze([0, 0, 0, 1]);

export function qMul(a, b, out = [0, 0, 0, 1]) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

export function qNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
  return q;
}

export function qAxisAngle(ax, ay, az, ang) {
  const l = Math.hypot(ax, ay, az) || 1, s = Math.sin(ang / 2);
  return [(ax / l) * s, (ay / l) * s, (az / l) * s, Math.cos(ang / 2)];
}

export function qDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

/** Rotation angle (radians, 0..π) between two orientations. */
export function qAngle(a, b) {
  const d = Math.min(1, Math.abs(qDot(a, b)));
  return 2 * Math.acos(d);
}

/** Uniformly distributed random rotation (Shoemake). */
export function qRandom(rng) {
  const u1 = rng(), u2 = rng() * 2 * Math.PI, u3 = rng() * 2 * Math.PI;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

export function qSlerp(a, b, t, out = [0, 0, 0, 1]) {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let wa, wb;
  if (cos > 0.99995) { wa = 1 - t; wb = t; }
  else {
    const th = Math.acos(cos), s = Math.sin(th);
    wa = Math.sin((1 - t) * th) / s;
    wb = Math.sin(t * th) / s;
  }
  out[0] = wa * a[0] + wb * bx;
  out[1] = wa * a[1] + wb * by;
  out[2] = wa * a[2] + wb * bz;
  out[3] = wa * a[3] + wb * bw;
  return qNormalize(out);
}

export function qToMat(q, m = new Float64Array(9)) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy - wz); m[2] = 2 * (xz + wy);
  m[3] = 2 * (xy + wz); m[4] = 1 - 2 * (xx + zz); m[5] = 2 * (yz - wx);
  m[6] = 2 * (xz - wy); m[7] = 2 * (yz + wx); m[8] = 1 - 2 * (xx + yy);
  return m;
}

/** Rotate vector v by quaternion q. */
export function qRotate(q, v, out = [0, 0, 0]) {
  const m = qToMat(q, SCRATCH_M);
  const x = v[0], y = v[1], z = v[2];
  out[0] = m[0] * x + m[1] * y + m[2] * z;
  out[1] = m[3] * x + m[4] * y + m[5] * z;
  out[2] = m[6] * x + m[7] * y + m[8] * z;
  return out;
}
const SCRATCH_M = new Float64Array(9);

/** Quaternion from a row-major rotation matrix. */
export function qFromMat(m) {
  const tr = m[0] + m[4] + m[8];
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s;
  }
  return qNormalize([x, y, z, w]);
}

/** The 24 rotations that map the coordinate axes onto themselves. */
export const AXIS_ALIGNED = (() => {
  const out = [];
  const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const a of axes) for (const b of axes) {
    if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] !== 0) continue;
    const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    // columns: local x → a, local y → b, local z → c
    const m = [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
    out.push(Object.freeze(qFromMat(m)));
  }
  return Object.freeze(out);
})();

// ---------------------------------------------------------------------------
// Box–box separating-axis tests (Gottschalk / Ericson, RTCD §4.4.1).
// Box A has half-extents ea, box B half-extents eb. R is B's orientation in A's
// frame (R[i*3+j] = Ai · Bj), AR = |R| + ε, t = (cB − cA) in A's frame.

const SAT_EPS = 1e-9;

/** Boolean overlap test (touching counts as overlap). */
export function satOverlap(ea0, ea1, ea2, eb0, eb1, eb2, R, AR, t0, t1, t2) {
  let ra, rb;
  // A's face axes
  if (Math.abs(t0) > ea0 + eb0 * AR[0] + eb1 * AR[1] + eb2 * AR[2]) return false;
  if (Math.abs(t1) > ea1 + eb0 * AR[3] + eb1 * AR[4] + eb2 * AR[5]) return false;
  if (Math.abs(t2) > ea2 + eb0 * AR[6] + eb1 * AR[7] + eb2 * AR[8]) return false;
  // B's face axes
  if (Math.abs(t0 * R[0] + t1 * R[3] + t2 * R[6]) > ea0 * AR[0] + ea1 * AR[3] + ea2 * AR[6] + eb0) return false;
  if (Math.abs(t0 * R[1] + t1 * R[4] + t2 * R[7]) > ea0 * AR[1] + ea1 * AR[4] + ea2 * AR[7] + eb1) return false;
  if (Math.abs(t0 * R[2] + t1 * R[5] + t2 * R[8]) > ea0 * AR[2] + ea1 * AR[5] + ea2 * AR[8] + eb2) return false;
  // A0 × Bj
  ra = ea1 * AR[6] + ea2 * AR[3]; rb = eb1 * AR[2] + eb2 * AR[1];
  if (Math.abs(t2 * R[3] - t1 * R[6]) > ra + rb) return false;
  ra = ea1 * AR[7] + ea2 * AR[4]; rb = eb0 * AR[2] + eb2 * AR[0];
  if (Math.abs(t2 * R[4] - t1 * R[7]) > ra + rb) return false;
  ra = ea1 * AR[8] + ea2 * AR[5]; rb = eb0 * AR[1] + eb1 * AR[0];
  if (Math.abs(t2 * R[5] - t1 * R[8]) > ra + rb) return false;
  // A1 × Bj
  ra = ea0 * AR[6] + ea2 * AR[0]; rb = eb1 * AR[5] + eb2 * AR[4];
  if (Math.abs(t0 * R[6] - t2 * R[0]) > ra + rb) return false;
  ra = ea0 * AR[7] + ea2 * AR[1]; rb = eb0 * AR[5] + eb2 * AR[3];
  if (Math.abs(t0 * R[7] - t2 * R[1]) > ra + rb) return false;
  ra = ea0 * AR[8] + ea2 * AR[2]; rb = eb0 * AR[4] + eb1 * AR[3];
  if (Math.abs(t0 * R[8] - t2 * R[2]) > ra + rb) return false;
  // A2 × Bj
  ra = ea0 * AR[3] + ea1 * AR[0]; rb = eb1 * AR[8] + eb2 * AR[7];
  if (Math.abs(t1 * R[0] - t0 * R[3]) > ra + rb) return false;
  ra = ea0 * AR[4] + ea1 * AR[1]; rb = eb0 * AR[8] + eb2 * AR[6];
  if (Math.abs(t1 * R[1] - t0 * R[4]) > ra + rb) return false;
  ra = ea0 * AR[5] + ea1 * AR[2]; rb = eb0 * AR[7] + eb1 * AR[6];
  if (Math.abs(t1 * R[2] - t0 * R[5]) > ra + rb) return false;
  return true;
}

/**
 * Signed separation along the best of the 15 candidate axes.
 * > 0 : boxes are apart by at least this much (a lower bound on their distance).
 * ≤ 0 : boxes overlap; −value is the exact penetration depth.
 * If axisOut is given it receives the unit axis (A's frame) pointing from A towards B.
 */
export function satSeparation(ea0, ea1, ea2, eb0, eb1, eb2, R, AR, t0, t1, t2, axisOut) {
  let best = -Infinity, bx = 0, by = 0, bz = 0;
  let s, p, ra, rb, len;
  // A's axes
  p = t0; s = Math.abs(p) - (ea0 + eb0 * AR[0] + eb1 * AR[1] + eb2 * AR[2]);
  if (s > best) { best = s; bx = p < 0 ? -1 : 1; by = 0; bz = 0; }
  p = t1; s = Math.abs(p) - (ea1 + eb0 * AR[3] + eb1 * AR[4] + eb2 * AR[5]);
  if (s > best) { best = s; bx = 0; by = p < 0 ? -1 : 1; bz = 0; }
  p = t2; s = Math.abs(p) - (ea2 + eb0 * AR[6] + eb1 * AR[7] + eb2 * AR[8]);
  if (s > best) { best = s; bx = 0; by = 0; bz = p < 0 ? -1 : 1; }
  // B's axes (column j of R)
  for (let j = 0; j < 3; j++) {
    p = t0 * R[j] + t1 * R[3 + j] + t2 * R[6 + j];
    ra = ea0 * AR[j] + ea1 * AR[3 + j] + ea2 * AR[6 + j];
    rb = j === 0 ? eb0 : j === 1 ? eb1 : eb2;
    s = Math.abs(p) - ra - rb;
    if (s > best) { const g = p < 0 ? -1 : 1; best = s; bx = g * R[j]; by = g * R[3 + j]; bz = g * R[6 + j]; }
  }
  // Cross axes Ai × Bj
  for (let j = 0; j < 3; j++) {
    const r0 = R[j], r1 = R[3 + j], r2 = R[6 + j];
    const a0 = AR[j], a1 = AR[3 + j], a2 = AR[6 + j];
    // other B axes for rb
    const k1 = (j + 1) % 3, k2 = (j + 2) % 3;
    const ebk1 = k1 === 0 ? eb0 : k1 === 1 ? eb1 : eb2;
    const ebk2 = k2 === 0 ? eb0 : k2 === 1 ? eb1 : eb2;
    // i = 0 : L = (0, −r2, r1)
    len = Math.sqrt(r1 * r1 + r2 * r2);
    if (len > 1e-6) {
      p = t2 * r1 - t1 * r2;
      ra = ea1 * a2 + ea2 * a1;
      rb = ebk1 * AR[k2] + ebk2 * AR[k1];
      s = (Math.abs(p) - ra - rb) / len;
      if (s > best) { const g = (p < 0 ? -1 : 1) / len; best = s; bx = 0; by = -r2 * g; bz = r1 * g; }
    }
    // i = 1 : L = (r2, 0, −r0)
    len = Math.sqrt(r0 * r0 + r2 * r2);
    if (len > 1e-6) {
      p = t0 * r2 - t2 * r0;
      ra = ea0 * a2 + ea2 * a0;
      rb = ebk1 * AR[3 + k2] + ebk2 * AR[3 + k1];
      s = (Math.abs(p) - ra - rb) / len;
      if (s > best) { const g = (p < 0 ? -1 : 1) / len; best = s; bx = r2 * g; by = 0; bz = -r0 * g; }
    }
    // i = 2 : L = (−r1, r0, 0)
    len = Math.sqrt(r0 * r0 + r1 * r1);
    if (len > 1e-6) {
      p = t1 * r0 - t0 * r1;
      ra = ea0 * a1 + ea1 * a0;
      rb = ebk1 * AR[6 + k2] + ebk2 * AR[6 + k1];
      s = (Math.abs(p) - ra - rb) / len;
      if (s > best) { const g = (p < 0 ? -1 : 1) / len; best = s; bx = -r1 * g; by = r0 * g; bz = 0; }
    }
  }
  if (axisOut) { axisOut[0] = bx; axisOut[1] = by; axisOut[2] = bz; }
  return best;
}

// ---------------------------------------------------------------------------
// Static bounding-volume hierarchy over axis-aligned boxes.

export class BVH {
  /** @param {Float64Array} aabbs flat [minx,miny,minz,maxx,maxy,maxz]*n */
  constructor(aabbs) {
    const n = aabbs.length / 6;
    this.aabbs = aabbs;
    this.n = n;
    const cap = Math.max(1, 2 * n);
    this.nmin = new Float64Array(cap * 3);
    this.nmax = new Float64Array(cap * 3);
    this.left = new Int32Array(cap);
    this.right = new Int32Array(cap);
    this.start = new Int32Array(cap);
    this.count = new Int32Array(cap);
    this.idx = new Int32Array(n);
    for (let i = 0; i < n; i++) this.idx[i] = i;
    this.nodes = 0;
    this.stack = new Int32Array(128);
    if (n) this._build(0, n);
  }
  _build(lo, hi) {
    const id = this.nodes++;
    const a = this.aabbs, idx = this.idx;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
    for (let i = lo; i < hi; i++) {
      const k = idx[i] * 6;
      if (a[k] < x0) x0 = a[k]; if (a[k + 1] < y0) y0 = a[k + 1]; if (a[k + 2] < z0) z0 = a[k + 2];
      if (a[k + 3] > x1) x1 = a[k + 3]; if (a[k + 4] > y1) y1 = a[k + 4]; if (a[k + 5] > z1) z1 = a[k + 5];
      const cx = a[k] + a[k + 3], cy = a[k + 1] + a[k + 4], cz = a[k + 2] + a[k + 5];
      if (cx < cx0) cx0 = cx; if (cx > cx1) cx1 = cx;
      if (cy < cy0) cy0 = cy; if (cy > cy1) cy1 = cy;
      if (cz < cz0) cz0 = cz; if (cz > cz1) cz1 = cz;
    }
    this.nmin[id * 3] = x0; this.nmin[id * 3 + 1] = y0; this.nmin[id * 3 + 2] = z0;
    this.nmax[id * 3] = x1; this.nmax[id * 3 + 1] = y1; this.nmax[id * 3 + 2] = z1;
    if (hi - lo <= 2) {
      this.left[id] = -1; this.right[id] = -1; this.start[id] = lo; this.count[id] = hi - lo;
      return id;
    }
    const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const sub = idx.subarray(lo, hi);
    sub.sort((p, q) => (a[p * 6 + axis] + a[p * 6 + axis + 3]) - (a[q * 6 + axis] + a[q * 6 + axis + 3]));
    const mid = (lo + hi) >> 1;
    this.count[id] = 0;
    this.left[id] = this._build(lo, mid);
    this.right[id] = this._build(mid, hi);
    return id;
  }
  /** Writes indices of boxes whose AABB overlaps the query into out; returns count. */
  query(x0, y0, z0, x1, y1, z1, out) {
    if (!this.n) return 0;
    const st = this.stack, nmin = this.nmin, nmax = this.nmax, a = this.aabbs;
    let sp = 0, cnt = 0;
    st[sp++] = 0;
    while (sp) {
      const id = st[--sp];
      const k = id * 3;
      if (nmin[k] > x1 || nmax[k] < x0 || nmin[k + 1] > y1 || nmax[k + 1] < y0 || nmin[k + 2] > z1 || nmax[k + 2] < z0) continue;
      if (this.left[id] < 0) {
        const s = this.start[id], e = s + this.count[id];
        for (let i = s; i < e; i++) {
          const o = this.idx[i], q = o * 6;
          if (a[q] > x1 || a[q + 3] < x0 || a[q + 1] > y1 || a[q + 4] < y0 || a[q + 2] > z1 || a[q + 5] < z0) continue;
          out[cnt++] = o;
        }
      } else {
        st[sp++] = this.left[id];
        st[sp++] = this.right[id];
      }
    }
    return cnt;
  }
}

// ---------------------------------------------------------------------------
// Axis-aligned box helpers ({min:[x,y,z], max:[x,y,z]})

export function box(x0, y0, z0, x1, y1, z1, extra) {
  return Object.assign({ min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)] }, extra);
}

export function boxContainsPoint(b, x, y, z, pad = 0) {
  return x >= b.min[0] - pad && x <= b.max[0] + pad && y >= b.min[1] - pad && y <= b.max[1] + pad && z >= b.min[2] - pad && z <= b.max[2] + pad;
}

export function boxesOverlap(a, b, pad = 0) {
  return a.min[0] < b.max[0] + pad && a.max[0] > b.min[0] - pad &&
    a.min[1] < b.max[1] + pad && a.max[1] > b.min[1] - pad &&
    a.min[2] < b.max[2] + pad && a.max[2] > b.min[2] - pad;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
