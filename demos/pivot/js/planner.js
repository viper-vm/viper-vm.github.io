// Pivot — 6-DOF motion planner (the "piano mover's problem").
// Bidirectional RRT-Connect in SE(3) with route-guided sampling, penetration-based
// repair for narrow passages, lift "portals", path shortcutting and a clearance profile.
// Pure JS, no DOM: runs in a Web Worker or in Node.

import {
  mulberry32, qToMat, qMul, qAxisAngle, qRandom, qNormalize, qAngle, qSlerp,
  AXIS_ALIGNED, satOverlap, satSeparation, BVH,
} from './geom.js';
import { progressOf, zoneAt } from './world.js';

const TRAPPED = 0, ADVANCED = 1, REACHED = 2;

// ---------------------------------------------------------------------------
// Collision world: obstacles in a BVH, the item as a union of inflated boxes.

export class CollisionWorld {
  constructor(world, item, inflate) {
    const obs = world.obstacles;
    const n = obs.length;
    this.n = n;
    this.oc = new Float64Array(n * 3);
    this.oe = new Float64Array(n * 3);
    this.oR = new Float64Array(n * 9);
    this.isOBB = new Uint8Array(n);
    const aabbs = new Float64Array(n * 6);
    obs.forEach((o, k) => {
      let c, h;
      if (o.R) {
        c = o.c; h = o.h;
        const R = o.R;
        for (let i = 0; i < 9; i++) this.oR[k * 9 + i] = R[i];
        this.isOBB[k] = 1;
        for (let i = 0; i < 3; i++) {
          const e = Math.abs(R[i * 3]) * h[0] + Math.abs(R[i * 3 + 1]) * h[1] + Math.abs(R[i * 3 + 2]) * h[2];
          aabbs[k * 6 + i] = c[i] - e;
          aabbs[k * 6 + 3 + i] = c[i] + e;
        }
      } else {
        c = [(o.min[0] + o.max[0]) / 2, (o.min[1] + o.max[1]) / 2, (o.min[2] + o.max[2]) / 2];
        h = [(o.max[0] - o.min[0]) / 2, (o.max[1] - o.min[1]) / 2, (o.max[2] - o.min[2]) / 2];
        for (let i = 0; i < 3; i++) { aabbs[k * 6 + i] = o.min[i]; aabbs[k * 6 + 3 + i] = o.max[i]; }
      }
      for (let i = 0; i < 3; i++) { this.oc[k * 3 + i] = c[i]; this.oe[k * 3 + i] = h[i]; }
    });
    this.bvh = new BVH(aabbs);
    this.setItem(item, inflate);
    this.R = new Float64Array(9);
    this.AR = new Float64Array(9);
    this.Rrel = new Float64Array(9);
    this.ARrel = new Float64Array(9);
    this.cand = new Int32Array(n + 8);
    this.axis = new Float64Array(3);
    this.upright = item.upright ? Math.cos((item.upright * Math.PI) / 180) : null;
    this.onEdge = item.onEdge ? Math.sin((item.onEdge * Math.PI) / 180) : null;
  }

  setItem(item, inflate) {
    const m = item.parts.length;
    this.m = m;
    this.inflate = inflate;
    this.pc = new Float64Array(m * 3);
    this.ph = new Float64Array(m * 3);
    item.parts.forEach((p, i) => {
      for (let a = 0; a < 3; a++) { this.pc[i * 3 + a] = p.c[a]; this.ph[i * 3 + a] = p.h[a] + inflate; }
    });
    this.wc = new Float64Array(m * 3);
    this.wx = new Float64Array(m * 3);
    this.radius = item.radius + inflate;
    // bounding box of all parts (item frame): if it is clear, every part is clear
    const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
    item.parts.forEach((p) => { for (let a = 0; a < 3; a++) { bmin[a] = Math.min(bmin[a], p.c[a] - p.h[a]); bmax[a] = Math.max(bmax[a], p.c[a] + p.h[a]); } });
    this.bc = [(bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2, (bmin[2] + bmax[2]) / 2];
    this.bh = [(bmax[0] - bmin[0]) / 2 + inflate, (bmax[1] - bmin[1]) / 2 + inflate, (bmax[2] - bmin[2]) / 2 + inflate];
    this.multi = m > 1;
  }

  setPose(x, y, z, qx, qy, qz, qw) {
    this.px = x; this.py = y; this.pz = z;
    this._bdirty = true;
    const R = this.R, AR = this.AR;
    const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz;
    const wx = qw * qx, wy = qw * qy, wz = qw * qz;
    R[0] = 1 - 2 * (yy + zz); R[1] = 2 * (xy - wz); R[2] = 2 * (xz + wy);
    R[3] = 2 * (xy + wz); R[4] = 1 - 2 * (xx + zz); R[5] = 2 * (yz - wx);
    R[6] = 2 * (xz - wy); R[7] = 2 * (yz + wx); R[8] = 1 - 2 * (xx + yy);
    for (let i = 0; i < 9; i++) AR[i] = Math.abs(R[i]) + 1e-9;
    const pc = this.pc, ph = this.ph, wc = this.wc, wxt = this.wx;
    for (let i = 0, k = 0; i < this.m; i++, k += 3) {
      const cx = pc[k], cy = pc[k + 1], cz = pc[k + 2];
      wc[k] = x + R[0] * cx + R[1] * cy + R[2] * cz;
      wc[k + 1] = y + R[3] * cx + R[4] * cy + R[5] * cz;
      wc[k + 2] = z + R[6] * cx + R[7] * cy + R[8] * cz;
      const hx = ph[k], hy = ph[k + 1], hz = ph[k + 2];
      wxt[k] = AR[0] * hx + AR[1] * hy + AR[2] * hz;
      wxt[k + 1] = AR[3] * hx + AR[4] * hy + AR[5] * hz;
      wxt[k + 2] = AR[6] * hx + AR[7] * hy + AR[8] * hz;
    }
  }

  orientationOK() {
    if (this.upright !== null && this.R[4] < this.upright) return false;
    if (this.onEdge !== null && Math.abs(this.R[5]) > this.onEdge) return false;
    const L = this.lock;
    if (L) {
      let exempt = false;
      if (L.exempt) {
        for (const b of L.exempt) {
          if (this.px >= b.min[0] && this.px <= b.max[0] && this.py >= b.min[1] && this.py <= b.max[1] && this.pz >= b.min[2] && this.pz <= b.max[2]) { exempt = true; break; }
        }
      }
      if (!exempt) {
        const v = this.R[3 + L.k];
        if (L.s === 0 ? Math.abs(v) < L.c : v * L.s < L.c) return false;
      }
    }
    return true;
  }

  _relative(k) {
    // obstacle k is an OBB: express the pose rotation in its frame
    const Ro = this.oR, o = k * 9, R = this.R, Rr = this.Rrel, AR = this.ARrel;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const v = Ro[o + i] * R[j] + Ro[o + 3 + i] * R[3 + j] + Ro[o + 6 + i] * R[6 + j];
      Rr[i * 3 + j] = v;
      AR[i * 3 + j] = Math.abs(v) + 1e-9;
    }
  }

  /** Does the item's whole bounding box touch anything? (cheap reject for open space) */
  _boxHits() {
    const R = this.R, AR = this.AR, oc = this.oc, oe = this.oe, cand = this.cand;
    const b = this.bc, e = this.bh;
    const cx = this.px + R[0] * b[0] + R[1] * b[1] + R[2] * b[2];
    const cy = this.py + R[3] * b[0] + R[4] * b[1] + R[5] * b[2];
    const cz = this.pz + R[6] * b[0] + R[7] * b[1] + R[8] * b[2];
    const wx = AR[0] * e[0] + AR[1] * e[1] + AR[2] * e[2];
    const wy = AR[3] * e[0] + AR[4] * e[1] + AR[5] * e[2];
    const wz = AR[6] * e[0] + AR[7] * e[1] + AR[8] * e[2];
    const n = this.bvh.query(cx - wx, cy - wy, cz - wz, cx + wx, cy + wy, cz + wz, cand);
    for (let c = 0; c < n; c++) {
      const o = cand[c], q = o * 3;
      if (this.isOBB[o]) return true; // rare: let the exact test decide
      if (satOverlap(oe[q], oe[q + 1], oe[q + 2], e[0], e[1], e[2], R, AR, cx - oc[q], cy - oc[q + 1], cz - oc[q + 2])) return true;
    }
    return false;
  }

  /** True if the current pose intersects any obstacle. */
  collides() {
    if (this.multi && !this._boxHits()) return false;
    const wc = this.wc, wx = this.wx, ph = this.ph, oc = this.oc, oe = this.oe, cand = this.cand;
    const R = this.R, AR = this.AR;
    for (let i = 0, k = 0; i < this.m; i++, k += 3) {
      const cx = wc[k], cy = wc[k + 1], cz = wc[k + 2];
      const n = this.bvh.query(cx - wx[k], cy - wx[k + 1], cz - wx[k + 2], cx + wx[k], cy + wx[k + 1], cz + wx[k + 2], cand);
      for (let c = 0; c < n; c++) {
        const o = cand[c], q = o * 3;
        if (!this.isOBB[o]) {
          if (satOverlap(oe[q], oe[q + 1], oe[q + 2], ph[k], ph[k + 1], ph[k + 2], R, AR, cx - oc[q], cy - oc[q + 1], cz - oc[q + 2])) return true;
        } else {
          this._relative(o);
          const Ro = this.oR, b = o * 9;
          const dx = cx - oc[q], dy = cy - oc[q + 1], dz = cz - oc[q + 2];
          const t0 = Ro[b] * dx + Ro[b + 3] * dy + Ro[b + 6] * dz;
          const t1 = Ro[b + 1] * dx + Ro[b + 4] * dy + Ro[b + 7] * dz;
          const t2 = Ro[b + 2] * dx + Ro[b + 5] * dy + Ro[b + 8] * dz;
          if (satOverlap(oe[q], oe[q + 1], oe[q + 2], ph[k], ph[k + 1], ph[k + 2], this.Rrel, this.ARrel, t0, t1, t2)) return true;
        }
      }
    }
    return false;
  }

  /**
   * Lower bound on the gap between the (inflated) item and the nearest obstacle, capped.
   * Negative = penetration. If `info` is given, records the part/obstacle/axis of the minimum.
   */
  clearance(cap, info) {
    const wc = this.wc, wx = this.wx, ph = this.ph, oc = this.oc, oe = this.oe, cand = this.cand;
    const R = this.R, AR = this.AR, ax = this.axis;
    let best = cap;
    for (let i = 0, k = 0; i < this.m; i++, k += 3) {
      const cx = wc[k], cy = wc[k + 1], cz = wc[k + 2];
      const e = best;
      const n = this.bvh.query(cx - wx[k] - e, cy - wx[k + 1] - e, cz - wx[k + 2] - e, cx + wx[k] + e, cy + wx[k + 1] + e, cz + wx[k + 2] + e, cand);
      for (let c = 0; c < n; c++) {
        const o = cand[c], q = o * 3;
        let s;
        if (!this.isOBB[o]) {
          s = satSeparation(oe[q], oe[q + 1], oe[q + 2], ph[k], ph[k + 1], ph[k + 2], R, AR, cx - oc[q], cy - oc[q + 1], cz - oc[q + 2], info ? ax : null);
          if (info && s < best) { info.part = i; info.obs = o; info.axis = [ax[0], ax[1], ax[2]]; }
        } else {
          this._relative(o);
          const Ro = this.oR, b = o * 9;
          const dx = cx - oc[q], dy = cy - oc[q + 1], dz = cz - oc[q + 2];
          const t0 = Ro[b] * dx + Ro[b + 3] * dy + Ro[b + 6] * dz;
          const t1 = Ro[b + 1] * dx + Ro[b + 4] * dy + Ro[b + 7] * dz;
          const t2 = Ro[b + 2] * dx + Ro[b + 5] * dy + Ro[b + 8] * dz;
          s = satSeparation(oe[q], oe[q + 1], oe[q + 2], ph[k], ph[k + 1], ph[k + 2], this.Rrel, this.ARrel, t0, t1, t2, info ? ax : null);
          if (info && s < best) {
            // axis back to world
            const w0 = Ro[b] * ax[0] + Ro[b + 1] * ax[1] + Ro[b + 2] * ax[2];
            const w1 = Ro[b + 3] * ax[0] + Ro[b + 4] * ax[1] + Ro[b + 5] * ax[2];
            const w2 = Ro[b + 6] * ax[0] + Ro[b + 7] * ax[1] + Ro[b + 8] * ax[2];
            info.part = i; info.obs = o; info.axis = [w0, w1, w2];
          }
        }
        if (s < best) best = s;
      }
    }
    return best;
  }

  /**
   * Accumulated push-out vector from every penetrating part/obstacle pair.
   * Returns total penetration depth (0 if free); writes the push into out[0..2].
   */
  pushOut(out) {
    const wc = this.wc, wx = this.wx, ph = this.ph, oc = this.oc, oe = this.oe, cand = this.cand;
    const R = this.R, AR = this.AR, ax = this.axis;
    let total = 0, px = 0, py = 0, pz = 0, deepest = 0;
    for (let i = 0, k = 0; i < this.m; i++, k += 3) {
      const cx = wc[k], cy = wc[k + 1], cz = wc[k + 2];
      const n = this.bvh.query(cx - wx[k], cy - wx[k + 1], cz - wx[k + 2], cx + wx[k], cy + wx[k + 1], cz + wx[k + 2], cand);
      for (let c = 0; c < n; c++) {
        const o = cand[c], q = o * 3;
        let s, w0, w1, w2;
        if (!this.isOBB[o]) {
          s = satSeparation(oe[q], oe[q + 1], oe[q + 2], ph[k], ph[k + 1], ph[k + 2], R, AR, cx - oc[q], cy - oc[q + 1], cz - oc[q + 2], ax);
          w0 = ax[0]; w1 = ax[1]; w2 = ax[2];
        } else {
          this._relative(o);
          const Ro = this.oR, b = o * 9;
          const dx = cx - oc[q], dy = cy - oc[q + 1], dz = cz - oc[q + 2];
          const t0 = Ro[b] * dx + Ro[b + 3] * dy + Ro[b + 6] * dz;
          const t1 = Ro[b + 1] * dx + Ro[b + 4] * dy + Ro[b + 7] * dz;
          const t2 = Ro[b + 2] * dx + Ro[b + 5] * dy + Ro[b + 8] * dz;
          s = satSeparation(oe[q], oe[q + 1], oe[q + 2], ph[k], ph[k + 1], ph[k + 2], this.Rrel, this.ARrel, t0, t1, t2, ax);
          w0 = Ro[b] * ax[0] + Ro[b + 1] * ax[1] + Ro[b + 2] * ax[2];
          w1 = Ro[b + 3] * ax[0] + Ro[b + 4] * ax[1] + Ro[b + 5] * ax[2];
          w2 = Ro[b + 6] * ax[0] + Ro[b + 7] * ax[1] + Ro[b + 8] * ax[2];
        }
        if (s < 0) {
          const d = -s;
          total += d;
          if (d > deepest) deepest = d;
          px += w0 * d; py += w1 * d; pz += w2 * d;
        }
      }
    }
    out[0] = px; out[1] = py; out[2] = pz; out[3] = deepest;
    return total;
  }

  /** Is every part inside the given AABB? */
  insideBox(b) {
    const wc = this.wc, wx = this.wx;
    for (let i = 0, k = 0; i < this.m; i++, k += 3) {
      for (let a = 0; a < 3; a++) {
        if (wc[k + a] - wx[k + a] < b.min[a] - 0.01 || wc[k + a] + wx[k + a] > b.max[a] + 0.01) return false;
      }
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Pose helpers. A pose is [x, y, z, qx, qy, qz, qw].

export function poseDist(a, b, rho) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  let d = Math.abs(a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6]);
  if (d > 1) d = 1;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) + rho * 2 * Math.acos(d);
}

export function poseLerp(a, b, t, out = new Array(7)) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  const q = qSlerp([a[3], a[4], a[5], a[6]], [b[3], b[4], b[5], b[6]], t);
  out[3] = q[0]; out[4] = q[1]; out[5] = q[2]; out[6] = q[3];
  return out;
}

// ---------------------------------------------------------------------------
// Planner

export class Tree {
  constructor(bounds, pad, cap = 4096) {
    void bounds; void pad;
    this.n = 0;
    this.cap = cap;
    this.P = new Float64Array(cap * 7);
    this.parent = new Int32Array(cap);
    this.tele = new Uint8Array(cap);
    this.prog = new Float32Array(cap);
    this.zone = new Int16Array(cap);
    this.indexed = 0;
    this.kd = null;
    this.kdRho = 0;
  }
  grow() {
    const cap = this.cap * 2;
    const P = new Float64Array(cap * 7); P.set(this.P); this.P = P;
    const pa = new Int32Array(cap); pa.set(this.parent); this.parent = pa;
    const te = new Uint8Array(cap); te.set(this.tele); this.tele = te;
    const pr = new Float32Array(cap); pr.set(this.prog); this.prog = pr;
    const zo = new Int16Array(cap); zo.set(this.zone); this.zone = zo;
    this.cap = cap;
  }
  add(pose, parent, tele, prog, zone) {
    if (this.n >= this.cap) this.grow();
    const i = this.n++;
    const o = i * 7;
    for (let k = 0; k < 7; k++) this.P[o + k] = pose[k];
    this.parent[i] = parent;
    this.tele[i] = tele ? 1 : 0;
    this.prog[i] = prog;
    this.zone[i] = zone;
    return i;
  }
  get(i, out = new Array(7)) {
    const o = i * 7;
    for (let k = 0; k < 7; k++) out[k] = this.P[o + k];
    return out;
  }
  /**
   * Exact nearest node under d = |Δp| + ρ·θ.
   * Nodes are embedded in 7-D as (x, y, z, 2ρ·q). Since ρ·θ ≥ 2ρ·min(|q−q'|, |q+q'|), the
   * Euclidean distance in the embedding (for the right quaternion sign) never exceeds d,
   * so a KD-tree over the embedding can prune safely. Searching with q and −q covers both
   * signs. Recent nodes wait in a small buffer that is scanned directly.
   */
  nearest(q, rho) {
    if (this.n - this.indexed > 320 || this.kdRho !== rho) this._rebuild(rho);
    const st = this._nn || (this._nn = { best: Infinity, bi: -1 });
    st.best = Infinity; st.bi = -1;
    if (this.indexed > 0) {
      const s = 2 * rho, sg = q[6] < 0 ? -1 : 1;
      const qe = this._qe || (this._qe = new Float64Array(7));
      qe[0] = q[0]; qe[1] = q[1]; qe[2] = q[2];
      for (let k = 3; k < 7; k++) qe[k] = s * sg * q[k];
      this._search(qe, q, rho, st);
      for (let k = 3; k < 7; k++) qe[k] = -qe[k];
      this._search(qe, q, rho, st);
    }
    // unindexed tail
    const P = this.P;
    const x = q[0], y = q[1], z = q[2], a = q[3], b = q[4], c = q[5], d = q[6];
    for (let i = this.indexed, o = i * 7; i < this.n; i++, o += 7) {
      const dx = P[o] - x, dy = P[o + 1] - y, dz = P[o + 2] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= st.best * st.best) continue;
      let dot = P[o + 3] * a + P[o + 4] * b + P[o + 5] * c + P[o + 6] * d;
      if (dot < 0) dot = -dot;
      if (dot > 1) dot = 1;
      const dist = Math.sqrt(d2) + rho * 2 * Math.acos(dot);
      if (dist < st.best) { st.best = dist; st.bi = i; }
    }
    return st.bi;
  }

  _rebuild(rho) {
    const n = this.n, P = this.P, s = 2 * rho;
    const E = new Float64Array(n * 7);
    for (let i = 0, o = 0; i < n; i++, o += 7) {
      const sg = P[o + 6] < 0 ? -1 : 1;
      E[o] = P[o]; E[o + 1] = P[o + 1]; E[o + 2] = P[o + 2];
      for (let k = 3; k < 7; k++) E[o + k] = s * sg * P[o + k];
    }
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    const cap = Math.ceil(n / 2) + 16; // leaves hold 5–10 points, so nodes ≤ 0.4·n + 1
    const dim = new Int8Array(cap), val = new Float64Array(cap), left = new Int32Array(cap), right = new Int32Array(cap);
    const lo = new Int32Array(cap), hi = new Int32Array(cap);
    let count = 0;
    const LEAF = 10;
    const build = (a, b) => {
      const id = count++;
      if (b - a <= LEAF) { dim[id] = -1; lo[id] = a; hi[id] = b; return id; }
      // widest dimension
      let bd = 0, bs = -1;
      for (let d = 0; d < 7; d++) {
        let mn = Infinity, mx = -Infinity;
        for (let i = a; i < b; i++) { const v = E[idx[i] * 7 + d]; if (v < mn) mn = v; if (v > mx) mx = v; }
        if (mx - mn > bs) { bs = mx - mn; bd = d; }
      }
      const mid = (a + b) >> 1;
      select(idx, E, bd, a, b - 1, mid);
      dim[id] = bd;
      val[id] = E[idx[mid] * 7 + bd];
      left[id] = build(a, mid);
      right[id] = build(mid, b);
      return id;
    };
    build(0, n);
    this.kd = { E, idx, dim, val, left, right, lo, hi };
    this.indexed = n;
    this.kdRho = rho;
    this._stack = new Int32Array(256);
    this._bound = new Float64Array(256);
  }

  /**
   * Best-first-ish KD search with the incremental cell-distance bound (Arya & Mount).
   * Prunes cells whose squared lower bound exceeds (best/(1+ε))², ε = 0.3: an approximate
   * nearest neighbour, which RRT is happy with.
   */
  _search(qe, q, rho, st) {
    const { dim, val, left, right, lo, hi, idx } = this.kd;
    const P = this.P;
    const x = q[0], y = q[1], z = q[2], a = q[3], b = q[4], c = q[5], d = q[6];
    const EPS = 1.3;
    let stack = this._stack, rds = this._bound, offs = this._offs;
    if (!offs || offs.length < stack.length * 7) offs = this._offs = new Float64Array(stack.length * 7);
    let sp = 0;
    stack[0] = 0; rds[0] = 0;
    for (let k = 0; k < 7; k++) offs[k] = 0;
    sp = 1;
    while (sp) {
      sp--;
      const node = stack[sp], rd = rds[sp];
      const lim = st.best / EPS;
      if (rd >= lim * lim) continue;
      const dm = dim[node];
      if (dm < 0) {
        for (let i = lo[node]; i < hi[node]; i++) {
          const j = idx[i], o = j * 7;
          const dx = P[o] - x, dy = P[o + 1] - y, dz = P[o + 2] - z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= st.best * st.best) continue;
          let dot = P[o + 3] * a + P[o + 4] * b + P[o + 5] * c + P[o + 6] * d;
          if (dot < 0) dot = -dot;
          if (dot > 1) dot = 1;
          const dist = Math.sqrt(d2) + rho * 2 * Math.acos(dot);
          if (dist < st.best) { st.best = dist; st.bi = j; }
        }
        continue;
      }
      if (sp + 2 >= stack.length) {
        const ns = new Int32Array(stack.length * 2); ns.set(stack); stack = this._stack = ns;
        const nr = new Float64Array(rds.length * 2); nr.set(rds); rds = this._bound = nr;
        const no = new Float64Array(offs.length * 2); no.set(offs); offs = this._offs = no;
      }
      const diff = qe[dm] - val[node];
      const near = diff < 0 ? left[node] : right[node];
      const far = diff < 0 ? right[node] : left[node];
      const base = sp * 7;
      const old = offs[base + dm];
      const rdFar = rd - old * old + diff * diff;
      // far child (explored later): same offsets but along dm the gap is |diff|
      if (rdFar < lim * lim) {
        stack[sp] = far; rds[sp] = rdFar;
        // offsets for this frame are already in place at base; copy to next frame for near
        const nb = (sp + 1) * 7;
        for (let k = 0; k < 7; k++) offs[nb + k] = offs[base + k];
        offs[base + dm] = diff;
        sp++;
        stack[sp] = near; rds[sp] = rd;
        sp++;
      } else {
        stack[sp] = near; rds[sp] = rd;
        sp++;
      }
    }
  }
}

/** Quickselect: reorder idx[a..b] so idx[k] holds the k-th smallest by E[·*7+d]. */
function select(idx, E, d, a, b, k) {
  while (b > a) {
    const pivot = E[idx[(a + b) >> 1] * 7 + d];
    let i = a, j = b;
    while (i <= j) {
      while (E[idx[i] * 7 + d] < pivot) i++;
      while (E[idx[j] * 7 + d] > pivot) j--;
      if (i <= j) { const t = idx[i]; idx[i] = idx[j]; idx[j] = t; i++; j--; }
    }
    if (k <= j) b = j;
    else if (k >= i) a = i;
    else return;
  }
}

function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class Planner {
  constructor(world, item, opts = {}) {
    this.world = world;
    this.item = item;
    this.margin = opts.margin ?? 1;
    this.res = opts.res ?? 0.8;
    this.eps = opts.eps ?? 16;
    // Search effort is budgeted in collision checks, not seconds, so a slow phone reaches the
    // same verdict as a fast laptop (it just takes longer). budgetMs is only a safety cap.
    this.budgetChecks = opts.budgetChecks ?? 1200000;
    this.budget = opts.budgetMs ?? 60000;
    this.rng = mulberry32((opts.seed ?? 1) * 2654435761);
    this.onProgress = opts.onProgress || null;
    this.cw = new CollisionWorld(world, item, this.margin + this.res / 2);
    this.rho = this.cw.radius;
    // Optional "carry posture": inside the building the item keeps one axis roughly vertical
    // (upright, on its end, on its back). It may tip freely outside and in the destination.
    this.carry = opts.carry || null;
    if (this.carry) {
      const exempt = world.free.filter((b) => b.kind === 'outside' || b.zone === world.destZone);
      this.cw.lock = { k: this.carry.k, s: this.carry.s, c: Math.cos(opts.carryTilt ?? 0.8), exempt };
      this._carryBases = AXIS_ALIGNED.filter((c) => {
        const m = qToMat(c);
        const v = m[3 + this.carry.k];
        return this.carry.s === 0 ? Math.abs(v) > 0.99 : v * this.carry.s > 0.99;
      });
    }
    this.stats = { checks: 0, samples: 0, repaired: 0, nodes: 0 };
    this._buildSampler();
    this._tmp = new Array(7);
    this._tmp2 = new Array(7);
    this._push = new Float64Array(4);
  }

  _buildSampler() {
    const w = this.world;
    const kindW = { outside: 0.25, door: 2.5, hall: 1, room: 0.4, stairs: 1.6, landing: 2.2, lift: 3 };
    this.boxes = w.free.map((b) => {
      const vol = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
      return { b, w: (kindW[b.kind] ?? 1) * Math.cbrt(vol) };
    });
    this.boxTotal = this.boxes.reduce((s, x) => s + x.w, 0);
    this.feats = w.features.slice();
    this.featTotal = this.feats.reduce((s, f) => s + f.weight, 0);
    for (const f of this.feats) f.s = progressOf(w, f.p[0], f.p[1], f.p[2], f.zone >= 0 ? f.zone : zoneAt(w, f.p[0], f.p[1], f.p[2]));
    this.focusFeats = null;
    // yaw-only orientations are handy for upright-constrained items
    this.uprightOnly = this.cw.upright !== null;
  }

  poseValid(p) {
    const cw = this.cw;
    cw.setPose(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
    this.stats.checks++;
    if (!cw.orientationOK()) return false;
    return !cw.collides();
  }

  /** Continuous check of the straight-line motion a→b (a assumed valid). */
  edgeValid(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    let cos = a[3] * b[3] + a[4] * b[4] + a[5] * b[5] + a[6] * b[6];
    let sgn = 1;
    if (cos < 0) { cos = -cos; sgn = -1; }
    if (cos > 1) cos = 1;
    const th = Math.acos(cos); // half the rotation angle
    const D = Math.sqrt(dx * dx + dy * dy + dz * dz) + this.rho * 2 * th;
    const n = Math.max(1, Math.ceil(D / this.res));
    const sinT = Math.sin(th);
    const cw = this.cw;
    const check = (i) => {
      const t = i / n;
      let wa, wb;
      if (th < 1e-4) { wa = 1 - t; wb = t; }
      else { wa = Math.sin((1 - t) * th) / sinT; wb = Math.sin(t * th) / sinT; }
      wb *= sgn;
      let qx = wa * a[3] + wb * b[3], qy = wa * a[4] + wb * b[4], qz = wa * a[5] + wb * b[5], qw = wa * a[6] + wb * b[6];
      const l = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
      qx /= l; qy /= l; qz /= l; qw /= l;
      cw.setPose(a[0] + dx * t, a[1] + dy * t, a[2] + dz * t, qx, qy, qz, qw);
      this.stats.checks++;
      return cw.orientationOK() && !cw.collides();
    };
    if (!check(n)) return false;
    let s = 1;
    while (s * 2 <= n) s *= 2;
    for (; s >= 1; s >>= 1) {
      for (let i = s; i < n; i += 2 * s) if (!check(i)) return false;
    }
    return true;
  }

  _sampleOrientation() {
    const rng = this.rng;
    if (this.carry && rng() < 0.8) {
      const base = this._carryBases[Math.floor(rng() * this._carryBases.length)];
      const yaw = qAxisAngle(0, 1, 0, rng() * Math.PI * 2);
      const ta = rng() * Math.PI * 2, tilt = rng() < 0.4 ? 0 : rng() * 0.75;
      const t = qAxisAngle(Math.cos(ta), 0, Math.sin(ta), tilt);
      return qNormalize(qMul(t, qMul(yaw, base)));
    }
    if (this.uprightOnly) {
      const yaw = rng() * Math.PI * 2;
      const lim = Math.acos(this.cw.upright);
      const tilt = rng() < 0.5 ? 0 : rng() * lim;
      const ta = rng() * Math.PI * 2;
      const qYaw = qAxisAngle(0, 1, 0, yaw);
      const qTilt = qAxisAngle(Math.cos(ta), 0, Math.sin(ta), tilt);
      return qMul(qTilt, qYaw);
    }
    const u = rng();
    if (u < 0.16) return qRandom(rng);
    const base = AXIS_ALIGNED[Math.floor(rng() * 24)];
    const ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    if (u < 0.46) {
      // exactly axis-aligned tilt, any heading: the postures movers actually use
      const r = qAxisAngle(0, 1, 0, rng() * Math.PI * 2);
      return qNormalize(qMul(r, base));
    }
    if (u < 0.6) {
      const a = rng() * 0.25 * (rng() < 0.5 ? 1 : 0.3);
      const r = qAxisAngle(gauss(rng), gauss(rng), gauss(rng), a);
      return qNormalize(qMul(r, base));
    }
    if (u < 0.86) {
      const A = ax[Math.floor(rng() * 3)];
      const r = qAxisAngle(A[0], A[1], A[2], rng() * Math.PI * 2);
      return qNormalize(qMul(r, base));
    }
    const A = ax[Math.floor(rng() * 3)], B = ax[Math.floor(rng() * 3)];
    const r1 = qAxisAngle(A[0], A[1], A[2], rng() * Math.PI * 2);
    const r2 = qAxisAngle(B[0], B[1], B[2], (rng() - 0.5) * Math.PI);
    return qNormalize(qMul(r2, qMul(r1, base)));
  }

  _samplePosition(out) {
    const rng = this.rng;
    if (this.focusFeats && this.focusFeats.length && rng() < 0.45) {
      const f = this.focusFeats[Math.floor(rng() * this.focusFeats.length)];
      const s = 20 + rng() * 45;
      out[0] = f.p[0] + gauss(rng) * s;
      out[1] = f.p[1] + gauss(rng) * s * 0.7;
      out[2] = f.p[2] + gauss(rng) * s;
      return;
    }
    if (rng() < 0.55 && this.feats.length) {
      let r = rng() * this.featTotal, f = this.feats[0];
      for (const x of this.feats) { r -= x.weight; if (r <= 0) { f = x; break; } }
      const s = 28 + rng() * 40;
      out[0] = f.p[0] + gauss(rng) * s;
      out[1] = f.p[1] + gauss(rng) * s * 0.7;
      out[2] = f.p[2] + gauss(rng) * s;
    } else {
      let r = rng() * this.boxTotal, b = this.boxes[0].b;
      for (const x of this.boxes) { r -= x.w; if (r <= 0) { b = x.b; break; } }
      out[0] = b.min[0] + rng() * (b.max[0] - b.min[0]);
      out[1] = b.min[1] + rng() * (b.max[1] - b.min[1]);
      out[2] = b.min[2] + rng() * (b.max[2] - b.min[2]);
    }
  }

  /** Nudge a colliding pose out of the walls. Returns true if it ends up valid. */
  repair(p, iters = 12) {
    const cw = this.cw, push = this._push, rng = this.rng;
    for (let it = 0; it < iters; it++) {
      cw.setPose(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
      this.stats.checks++;
      if (!cw.orientationOK()) return false;
      const total = cw.pushOut(push);
      if (total <= 0) return true;
      if (push[3] > 45) return false;
      const len = Math.hypot(push[0], push[1], push[2]);
      if (len < 1e-6 || (it % 4 === 3)) {
        // stuck between opposing walls: wiggle the orientation a little
        const k = rng();
        const r = k < 0.5 ? qAxisAngle(0, 1, 0, (rng() - 0.5) * 0.36)
          : k < 0.8 ? qAxisAngle(rng() < 0.5 ? 1 : 0, 0, rng() < 0.5 ? 0 : 1, (rng() - 0.5) * 0.24)
          : qAxisAngle(gauss(rng), gauss(rng), gauss(rng), 0.06 + rng() * 0.12);
        const q = qNormalize(qMul(r, [p[3], p[4], p[5], p[6]]));
        p[3] = q[0]; p[4] = q[1]; p[5] = q[2]; p[6] = q[3];
        if (len < 1e-6) continue;
      }
      const step = (push[3] + 0.4) / len;
      p[0] += push[0] * step; p[1] += push[1] * step; p[2] += push[2] * step;
    }
    cw.setPose(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
    return cw.orientationOK() && !cw.collides();
  }

  sample(repair = true) {
    const p = new Array(7);
    this._samplePosition(p);
    const q = this._sampleOrientation();
    p[3] = q[0]; p[4] = q[1]; p[5] = q[2]; p[6] = q[3];
    this.stats.samples++;
    if (repair && !this.poseValid(p)) {
      if (this.repair(p)) this.stats.repaired++;
    }
    return p;
  }

  /** Returns a function that stays true while under `checks` extra collision checks and `ms`. */
  _budget(checks, ms = 60000) {
    const c0 = this.stats.checks, t0 = Date.now();
    return () => this.stats.checks - c0 < checks && Date.now() - t0 < ms;
  }

  _progress(p, zone) { return progressOf(this.world, p[0], p[1], p[2], zone); }
  _zone(p) { return zoneAt(this.world, p[0], p[1], p[2]); }

  _addNode(T, pose, parent, tele) {
    const zn = this._zone(pose);
    const i = T.add(pose, parent, tele, this._progress(pose, zn), zn);
    this.stats.nodes++;
    if (this._newPts) { this._newPts.push(pose[0], pose[1], pose[2], T === this.Ta0 ? 0 : 1); }
    // lift portals: a pose fully inside a car also exists one floor up/down
    if (!tele && this.world.portals.length) {
      const cw = this.cw;
      cw.setPose(pose[0], pose[1], pose[2], pose[3], pose[4], pose[5], pose[6]);
      for (const pt of this.world.portals) {
        let dy = 0;
        if (cw.insideBox(pt.a)) dy = pt.dy;
        else if (cw.insideBox(pt.b)) dy = -pt.dy;
        if (!dy) continue;
        const twin = pose.slice();
        twin[1] += dy;
        if (this.poseValid(twin)) {
          const tz = this._zone(twin);
          T.add(twin, i, true, this._progress(twin, tz), tz);
          this.stats.nodes++;
          if (this._newPts) this._newPts.push(twin[0], twin[1], twin[2], T === this.Ta0 ? 0 : 1);
        }
      }
    }
    return i;
  }

  _extend(T, target, from = -1) {
    const ni = from >= 0 ? from : T.nearest(target, this.rho);
    const near = T.get(ni, this._tmp);
    const d = poseDist(near, target, this.rho);
    let qnew, reached = false;
    if (d <= this.eps) { qnew = target.slice(); reached = true; }
    else qnew = poseLerp(near, target, this.eps / d);
    if (this.edgeValid(near, qnew)) {
      this._lastAdded = this._addNode(T, qnew, ni, false);
      return reached ? REACHED : ADVANCED;
    }
    // Retraction: push the blocked pose back out of the wall and keep that instead, so
    // trees slide along door jambs and banisters rather than stalling against them.
    const r = qnew.slice();
    if (this.repair(r, 5)) {
      const dr = poseDist(near, r, this.rho);
      if (dr > 0.8 && dr < 2.5 * this.eps && this.edgeValid(near, r)) {
        this._lastAdded = this._addNode(T, r, ni, false);
        this.stats.retracted = (this.stats.retracted || 0) + 1;
        return poseDist(r, target, this.rho) < d - 0.5 ? ADVANCED : TRAPPED;
      }
    }
    return TRAPPED;
  }

  _connect(T, target) {
    let s = this._extend(T, target);
    let guard = 0;
    while (s === ADVANCED && ++guard < 600) s = this._extend(T, target, this._lastAdded);
    return s;
  }

  startPose() {
    const it = this.item, inf = this.cw.inflate;
    return [0, it.size[1] / 2 + inf + 0.3, 540 / 2 + 40, 0, 0, 0, 1];
  }

  goalPoses() {
    const b = this.world.destBox, it = this.item, inf = this.cw.inflate;
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const y = b.min[1] + it.size[1] / 2 + inf + 0.3;
    const alongX = b.max[0] - b.min[0] >= b.max[2] - b.min[2];
    const base = alongX ? 0 : Math.PI / 2;
    const out = [];
    for (const k of [0, 1, 2, 3]) {
      const q = qAxisAngle(0, 1, 0, base + (k * Math.PI) / 2);
      const p = [cx, y, cz, q[0], q[1], q[2], q[3]];
      if (this.poseValid(p)) out.push(p);
      else {
        const r = p.slice();
        if (this.repair(r) && this.cw.insideBox(b)) out.push(r);
      }
    }
    if (out.length) return { poses: out, natural: true };
    // the room is too tight to set it down normally: any pose inside the room will do
    for (let tries = 0; tries < 4000 && out.length < 6; tries++) {
      const q = this._sampleOrientation();
      const p = [
        b.min[0] + this.rng() * (b.max[0] - b.min[0]),
        b.min[1] + this.rng() * (b.max[1] - b.min[1]),
        b.min[2] + this.rng() * (b.max[2] - b.min[2]),
        q[0], q[1], q[2], q[3],
      ];
      if (this.poseValid(p) || this.repair(p)) {
        this.cw.setPose(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
        if (this.cw.insideBox(b)) out.push(p);
      }
    }
    return { poses: out, natural: false };
  }

  /** Run RRT-Connect until success or the time budget runs out. */
  solve() {
    const t0 = Date.now();
    const start = this.startPose();
    if (!this.poseValid(start) && !this.repair(start)) {
      return { ok: false, reason: 'start', stats: this.stats };
    }
    const goals = this.goalPoses();
    if (!goals.poses.length) {
      return { ok: false, reason: 'room', stats: this.stats, detail: 'The item cannot sit inside the destination room at all.' };
    }
    const TA = new Tree(this.world.bounds, this.rho), TB = new Tree(this.world.bounds, this.rho);
    this.Ta0 = TA;
    this._newPts = [];
    this._addNode(TA, start, -1, false);
    for (const g of goals.poses) this._addNode(TB, g, -1, false);
    let Ta = TA, Tb = TB;
    let iter = 0, lastReport = Date.now();
    let meet = null;
    const more = this._budget(this.budgetChecks, this.budget);
    while (more()) {
      iter++;
      const qr = this.sample(true);
      if (this._extend(Ta, qr) !== TRAPPED) {
        const ia = this._lastAdded;
        const qa = Ta.get(ia);
        if (this._connect(Tb, qa) === REACHED) {
          const ib = this._lastAdded;
          meet = Ta === TA ? { a: ia, b: ib } : { a: ib, b: ia };
          break;
        }
      }
      const tmp = Ta; Ta = Tb; Tb = tmp;
      if (iter % 1500 === 0) this._refocus(TA, TB);
      if (this.onProgress && Date.now() - lastReport > 180) {
        lastReport = Date.now();
        this.onProgress(this._progressReport(TA, TB, t0));
      }
    }
    this.elapsed = Date.now() - t0;
    this.trees = [TA, TB];
    if (this.onProgress) this.onProgress(this._progressReport(TA, TB, t0));
    if (!meet) {
      return { ok: false, reason: 'timeout', stats: { ...this.stats, iter, ms: this.elapsed }, diag: this._diagnose(TA, TB), natural: goals.natural };
    }
    const path = this._extract(TA, TB, meet);
    return { ok: true, path, stats: { ...this.stats, iter, ms: this.elapsed }, natural: goals.natural };
  }

  /** Concentrate sampling on the features between the two trees' frontiers. */
  _refocus(TA, TB) {
    let maxA = 0, minB = Infinity;
    for (let i = 0; i < TA.n; i++) if (TA.prog[i] > maxA) maxA = TA.prog[i];
    for (let i = 0; i < TB.n; i++) if (TB.prog[i] < minB) minB = TB.prog[i];
    const lo = Math.min(maxA, minB) - 120, hi = Math.max(maxA, minB) + 120;
    const f = this.feats.filter((x) => x.s >= lo && x.s <= hi);
    this.focusFeats = f.length ? f : null;
  }

  _progressReport(TA, TB, t0) {
    let maxA = 0, minB = Infinity;
    for (let i = 0; i < TA.n; i++) if (TA.prog[i] > maxA) maxA = TA.prog[i];
    for (let i = 0; i < TB.n; i++) if (TB.prog[i] < minB) minB = TB.prog[i];
    const pts = this._newPts;
    this._newPts = [];
    return { type: 'progress', nodesA: TA.n, nodesB: TB.n, frontA: maxA, frontB: minB, total: this.world.length, ms: Date.now() - t0, checks: this.stats.checks, pts };
  }

  _diagnose(TA, TB) {
    let maxA = 0, ia = 0, minB = Infinity, ib = 0;
    for (let i = 0; i < TA.n; i++) if (TA.prog[i] > maxA) { maxA = TA.prog[i]; ia = i; }
    for (let i = 0; i < TB.n; i++) if (TB.prog[i] < minB) { minB = TB.prog[i]; ib = i; }
    // zones the start tree reached, and the first zone it never got into
    const reachedA = new Set(), reachedB = new Set();
    for (let i = 0; i < TA.n; i++) reachedA.add(TA.zone[i]);
    for (let i = 0; i < TB.n; i++) reachedB.add(TB.zone[i]);
    return {
      frontA: maxA, frontB: minB,
      poseA: TA.get(ia), poseB: TB.get(ib),
      zonesA: [...reachedA], zonesB: [...reachedB],
      nodes: TA.n + TB.n,
    };
  }

  _extract(TA, TB, meet) {
    const chain = (T, i) => {
      const out = [];
      while (i >= 0) { out.push({ pose: T.get(i), tele: !!T.tele[i] }); i = T.parent[i]; }
      return out;
    };
    const a = chain(TA, meet.a).reverse(); // start → meet
    const b = chain(TB, meet.b);           // meet → goal root
    // a[k].tele = edge from a[k-1] to a[k] is a teleport.
    // In b (listed meet→root), b[k].tele marks the edge between b[k] and b[k+1].
    const path = a.map((n) => ({ pose: n.pose, tele: n.tele }));
    for (let k = 1; k < b.length; k++) path.push({ pose: b[k].pose, tele: b[k - 1].tele });
    // drop the duplicated meeting node if present
    return path;
  }

  // -------------------------------------------------------------------------
  // Post-processing

  /** Shortcut the path: repeatedly try straight connections between random points. */
  shortcut(path, checks = 120000) {
    const more = this._budget(checks, 8000);
    let P = path.slice();
    const rng = this.rng;
    let fails = 0;
    while (more() && P.length > 2 && fails < 400) {
      // continuous shortcut between random points on two different edges
      const n = P.length;
      let i = Math.floor(rng() * (n - 1)), j = Math.floor(rng() * (n - 1));
      if (i === j) { fails++; continue; }
      if (i > j) { const t = i; i = j; j = t; }
      let tele = false;
      for (let k = i + 1; k <= j + 1 && k < n; k++) if (P[k].tele) { tele = true; break; }
      if (tele) { fails++; continue; }
      const ta = rng(), tb = rng();
      const A = poseLerp(P[i].pose, P[i + 1].pose, ta);
      const B = poseLerp(P[j].pose, P[j + 1].pose, tb);
      if (this.edgeValid(A, B)) {
        const np = P.slice(0, i + 1);
        np.push({ pose: A, tele: false }, { pose: B, tele: false });
        np.push(...P.slice(j + 1));
        P = np;
        fails = 0;
      } else fails++;
    }
    // node-to-node pass
    for (let i = 0; i < P.length - 2; i++) {
      while (i + 2 < P.length && !P[i + 1].tele && !P[i + 2].tele && this.edgeValid(P[i].pose, P[i + 2].pose)) P.splice(i + 1, 1);
    }
    return P;
  }

  /**
   * Partial shortcut on orientation: keep the positions of a stretch of path but spread the
   * rotation evenly between its ends (removes needless flips and wiggles).
   */
  smoothRotation(path, checks = 60000) {
    const more = this._budget(checks, 6000);
    let P = path.map((n) => ({ pose: n.pose.slice(), tele: n.tele }));
    const rng = this.rng;
    let fails = 0;
    while (more() && fails < 300 && P.length > 2) {
      const n = P.length;
      let i = Math.floor(rng() * n), j = Math.floor(rng() * n);
      if (Math.abs(i - j) < 2) { fails++; continue; }
      if (i > j) { const t = i; i = j; j = t; }
      let tele = false;
      for (let k = i + 1; k <= j; k++) if (P[k].tele) { tele = true; break; }
      if (tele) { fails++; continue; }
      // arc length of positions between i and j
      const L = [0];
      for (let k = i + 1; k <= j; k++) {
        const a = P[k - 1].pose, b = P[k].pose;
        L.push(L[L.length - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      }
      const tot = L[L.length - 1];
      const qi = P[i].pose.slice(3), qj = P[j].pose.slice(3);
      // how much rotation is there now vs after?
      let before = 0;
      for (let k = i + 1; k <= j; k++) before += qAngle(P[k - 1].pose.slice(3), P[k].pose.slice(3));
      const after = qAngle(qi, qj);
      if (after > before - 0.05) { fails++; continue; }
      const cand = [];
      for (let k = i + 1; k < j; k++) {
        const f = tot > 1e-6 ? L[k - i] / tot : (k - i) / (j - i);
        const q = qSlerp(qi, qj, f);
        const p0 = P[k].pose;
        cand.push([p0[0], p0[1], p0[2], q[0], q[1], q[2], q[3]]);
      }
      let ok = true;
      let prev = P[i].pose;
      for (const c of cand) { if (!this.edgeValid(prev, c)) { ok = false; break; } prev = c; }
      if (ok && !this.edgeValid(prev, P[j].pose)) ok = false;
      if (ok) {
        for (let k = i + 1; k < j; k++) P[k].pose = cand[k - i - 1];
        fails = 0;
      } else fails++;
    }
    return P;
  }

  /**
   * The driveway and the destination room are wide open, so whatever happens there should
   * be one direct move: connect the start straight to the furthest reachable pose outside,
   * and the last pose inside the room straight to the goal.
   */
  simplifyEnds(path) {
    let P = path.slice();
    const outside = this.world.free.find((b) => b.kind === 'outside');
    const dest = this.world.destBox;
    const inBox = (p, b) => b && p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2];
    let e = 0;
    while (e + 1 < P.length && inBox(P[e + 1].pose, outside) && !P[e + 1].tele) e++;
    for (let j = Math.min(P.length - 1, e + 2); j >= 2; j--) {
      if (P.slice(1, j + 1).some((n) => n.tele)) continue;
      if (this.edgeValid(P[0].pose, P[j].pose)) { P = [P[0]].concat(P.slice(j)); break; }
    }
    let b = P.length - 1;
    while (b - 1 > 0 && inBox(P[b - 1].pose, dest) && !P[b].tele) b--;
    for (let i = Math.max(0, b - 2); i <= P.length - 3; i++) {
      if (P.slice(i + 1).some((n) => n.tele)) continue;
      if (this.edgeValid(P[i].pose, P[P.length - 1].pose)) { P = P.slice(0, i + 1).concat([P[P.length - 1]]); break; }
    }
    return P;
  }

  /** Which of the item's axes points up (with hysteresis), per waypoint. */
  _postures(path) {
    let held = null;
    return path.map((n) => {
      const m = qToMat([n.pose[3], n.pose[4], n.pose[5], n.pose[6]]);
      const ups = [m[3], m[4], m[5]];
      let k = 0;
      for (let j = 1; j < 3; j++) if (Math.abs(ups[j]) > Math.abs(ups[k])) k = j;
      const s = ups[k] >= 0 ? 1 : -1;
      if (!held || ((held.k !== k || held.s !== s) && Math.abs(ups[k]) > 0.84)) held = { k, s };
      return held;
    });
  }

  /**
   * Remove posture "excursions" (upright → on its side → upright) by re-planning that
   * stretch with the posture held, i.e. only turning about the vertical and small tilts.
   */
  lockPostures(path, checks = 120000) {
    const c0 = this.stats.checks;
    const left = () => checks - (this.stats.checks - c0);
    let P = path;
    for (let pass = 0; pass < 6 && left() > 2000; pass++) {
      const post = this._postures(P);
      let found = null;
      for (let a = 0; a < P.length - 2 && !found; a++) {
        if (post[a + 1].k === post[a].k && post[a + 1].s === post[a].s) continue;
        // posture changes after a; look for the next return to the same posture
        for (let b = a + 2; b < P.length; b++) {
          if (P[b].tele) break;
          if (post[b].k === post[a].k && post[b].s === post[a].s) { found = { a, b }; break; }
        }
      }
      if (!found) break;
      const { a, b } = found;
      const sub = this._lockedConnect(P, a, b, post[a], Math.min(45000, left()));
      if (!sub) {
        // cannot hold the posture here: mark as tried by skipping past it next time
        const rest = this.lockPostures(P.slice(b), left());
        return P.slice(0, b).concat(rest);
      }
      P = P.slice(0, a).concat(sub, P.slice(b + 1));
    }
    return P;
  }

  _lockedConnect(P, a, b, post, checks) {
    if (checks < 2000) return null;
    const cw = this.cw, rng = this.rng;
    cw.lock = { k: post.k, s: post.s, c: Math.cos(0.7) };
    const pa = P[a].pose, pb = P[b].pose;
    try {
      if (!this.poseValid(pa) || !this.poseValid(pb)) return null;
      if (this.edgeValid(pa, pb)) return [{ pose: pa.slice(), tele: P[a].tele }, { pose: pb.slice(), tele: false }];
      // base orientation with the locked axis pointing up, closest to pa
      const qa = [pa[3], pa[4], pa[5], pa[6]];
      let base = null, bestA = Infinity;
      for (const c of AXIS_ALIGNED) {
        const m = qToMat(c);
        if (m[3 + post.k] * post.s < 0.99) continue;
        const ang = qAngle(qa, c);
        if (ang < bestA) { bestA = ang; base = c; }
      }
      const sample = () => {
        const w = P[a + Math.floor(rng() * (b - a + 1))].pose;
        const s = 18 + rng() * 30;
        const q = qMul(qAxisAngle(gauss(rng), 0, gauss(rng), rng() * 0.35), qMul(qAxisAngle(0, 1, 0, rng() * Math.PI * 2), base));
        const p = [w[0] + gauss(rng) * s, w[1] + gauss(rng) * s * 0.5, w[2] + gauss(rng) * s, q[0], q[1], q[2], q[3]];
        if (!this.poseValid(p)) this.repair(p, 6);
        return p;
      };
      const more = this._budget(checks, 4000);
      const mk = () => new Tree(this.world.bounds, this.rho, 256);
      const TA = mk(), TB = mk();
      TA.add(pa, -1, false, 0, 0);
      TB.add(pb, -1, false, 0, 0);
      let Ta = TA, Tb = TB;
      const ext = (T, target, from = -1) => {
        const ni = from >= 0 ? from : T.nearest(target, this.rho);
        const near = T.get(ni);
        const d = poseDist(near, target, this.rho);
        const qn = d <= this.eps ? target.slice() : poseLerp(near, target, this.eps / d);
        if (!this.edgeValid(near, qn)) return [TRAPPED, -1];
        const i = T.add(qn, ni, false, 0, 0);
        return [d <= this.eps ? REACHED : ADVANCED, i];
      };
      while (more()) {
        const q = sample();
        const [st, ia] = ext(Ta, q);
        if (st !== TRAPPED) {
          const qa2 = Ta.get(ia);
          let [s2, ib] = ext(Tb, qa2);
          let guard = 0;
          while (s2 === ADVANCED && ++guard < 300) [s2, ib] = ext(Tb, qa2, ib);
          if (s2 === REACHED) {
            const iA = Ta === TA ? ia : ib, iB = Ta === TA ? ib : ia;
            const chain = (T, i) => { const o = []; while (i >= 0) { o.push(T.get(i)); i = T.parent[i]; } return o; };
            const left = chain(TA, iA).reverse(), right = chain(TB, iB);
            const poses = left.concat(right.slice(1));
            return poses.map((p, k) => ({ pose: p, tele: k === 0 ? P[a].tele : false }));
          }
        }
        const t = Ta; Ta = Tb; Tb = t;
      }
      return null;
    } finally {
      cw.lock = null;
    }
  }

  /** Snap near-canonical orientations and smooth positions where it stays collision-free. */
  beautify(path, passes = 3) {
    const P = path.map((n) => ({ pose: n.pose.slice(), tele: n.tele }));
    for (let pass = 0; pass < passes; pass++) {
      for (let k = 1; k < P.length - 1; k++) {
        if (P[k].tele || P[k + 1].tele) continue;
        const cur = P[k].pose;
        const q = [cur[3], cur[4], cur[5], cur[6]];
        let best = null, bestA = 0.35;
        for (const c of AXIS_ALIGNED) {
          // allow any yaw: compare after removing rotation about world y? keep simple: direct angle
          const a = qAngle(q, c);
          if (a < bestA) { bestA = a; best = c; }
        }
        if (best) {
          const cand = [cur[0], cur[1], cur[2], best[0], best[1], best[2], best[3]];
          if (this.poseValid(cand) && this.edgeValid(P[k - 1].pose, cand) && this.edgeValid(cand, P[k + 1].pose)) P[k].pose = cand;
        }
        const a = P[k - 1].pose, b = P[k + 1].pose, c = P[k].pose;
        const sm = [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4, (a[2] + 2 * c[2] + b[2]) / 4, c[3], c[4], c[5], c[6]];
        if (this.poseValid(sm) && this.edgeValid(a, sm) && this.edgeValid(sm, b)) P[k].pose = sm;
      }
    }
    return P;
  }

  /** Resample the path densely (by max point displacement) for animation and analysis. */
  densify(path, stepCm = 2) {
    const out = [];
    let acc = 0;
    out.push({ pose: path[0].pose.slice(), d: 0, tele: false });
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1].pose, b = path[k].pose;
      if (path[k].tele) {
        out.push({ pose: b.slice(), d: acc, tele: true });
        continue;
      }
      const D = poseDist(a, b, this.item.radius);
      const n = Math.max(1, Math.ceil(D / stepCm));
      for (let i = 1; i <= n; i++) out.push({ pose: poseLerp(a, b, i / n), d: acc + (D * i) / n, tele: false });
      acc += D;
    }
    return out;
  }

  /** Clearance (true gap, no inflation) along a dense path. */
  clearanceProfile(dense, cap = 25) {
    const cw0 = new CollisionWorld(this.world, this.item, 0);
    const vals = new Float32Array(dense.length);
    let min = Infinity, at = 0, info = null;
    for (let i = 0; i < dense.length; i++) {
      const p = dense[i].pose;
      cw0.setPose(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
      const inf = {};
      const c = cw0.clearance(cap, inf);
      vals[i] = c;
      if (c < min) { min = c; at = i; info = inf; }
    }
    let pinch = null;
    if (info && info.obs !== undefined) {
      const p = dense[at].pose;
      cw0.setPose(p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
      pinch = this._contactPoint(cw0, info, min);
      // name the place where the contact is, not where the item's centre happens to be
      const pt = pinch.point;
      let z = zoneAt(this.world, pt[0], pt[1], pt[2]);
      if (z < 0 || this.world.zones[z].kind === 'outside' || this.world.zones[z].kind === 'room') {
        let best = 90, bz = -1;
        for (const f of this.world.features) {
          if (f.zone < 0 || !['door', 'corner', 'stairs-end', 'bulkhead', 'lift', 'landing'].includes(f.kind)) continue;
          const d = Math.hypot(f.p[0] - pt[0], f.p[2] - pt[2]);
          if (d < best) { best = d; bz = f.zone; }
        }
        if (bz >= 0) z = bz;
        else if (z < 0) z = zoneAt(this.world, p[0], p[1], p[2]);
      }
      pinch.zone = z;
      pinch.obstacle = this.world.obstacles[info.obs];
    }
    return { values: Array.from(vals), min, at, pinch };
  }

  _contactPoint(cw, info, gap) {
    // support point of the part in the direction facing the obstacle (−axis)
    const i = info.part, k = i * 3, R = cw.R;
    const ax = info.axis; // obstacle → part
    const h = [cw.ph[k], cw.ph[k + 1], cw.ph[k + 2]];
    // local direction of −axis
    const lx = -(R[0] * ax[0] + R[3] * ax[1] + R[6] * ax[2]);
    const ly = -(R[1] * ax[0] + R[4] * ax[1] + R[7] * ax[2]);
    const lz = -(R[2] * ax[0] + R[5] * ax[1] + R[8] * ax[2]);
    const pick = (d, e) => (Math.abs(d) < 0.2 ? 0 : Math.sign(d) * e);
    const sx = pick(lx, h[0]), sy = pick(ly, h[1]), sz = pick(lz, h[2]);
    const px = cw.wc[k] + R[0] * sx + R[1] * sy + R[2] * sz;
    const py = cw.wc[k + 1] + R[3] * sx + R[4] * sy + R[5] * sz;
    const pz = cw.wc[k + 2] + R[6] * sx + R[7] * sy + R[8] * sz;
    const g = Math.max(0, gap);
    return {
      point: [px - (ax[0] * g) / 2, py - (ax[1] * g) / 2, pz - (ax[2] * g) / 2],
      normal: ax,
      part: this.item.parts[i] ? this.item.parts[i].name : '',
      gap,
    };
  }
}

/**
 * A plain box looks identical after a half-turn about any of its own axes. Pick the one
 * equivalent orientation for the whole path that spends the least time upside down or
 * face-down, so the playbook never says "turn the wardrobe upside down".
 */
export function canonicalizeSymmetric(item, path) {
  if (item.parts.length !== 1) return path;
  const flips = [[0, 0, 0, 1], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]]; // identity, 180° about x, y, z
  let best = null, bestCost = Infinity;
  for (const f of flips) {
    let cost = 0;
    for (const n of path) {
      const q = qMul([n.pose[3], n.pose[4], n.pose[5], n.pose[6]], f);
      const m = qToMat(q);
      // penalise local +y pointing down and local +z (front / doors) pointing down
      cost += Math.max(0, -m[4]) * 2 + Math.max(0, -m[5]);
    }
    if (cost < bestCost - 1e-9) { bestCost = cost; best = f; }
  }
  if (!best || best[3] === 1) return path;
  return path.map((n) => {
    const q = qMul([n.pose[3], n.pose[4], n.pose[5], n.pose[6]], best);
    return { ...n, pose: [n.pose[0], n.pose[1], n.pose[2], q[0], q[1], q[2], q[3]] };
  });
}

/** Convenience: full solve + post-processing. */
export function planRoute(world, item, opts = {}) {
  const pl = new Planner(world, item, opts);
  const res = pl.solve();
  if (!res.ok) return res;
  // Polishing only affects elegance, not the verdict: on slow devices do less of it so the
  // answer still arrives within a few seconds of the search.
  const speed = res.stats.checks / Math.max(1, res.stats.ms); // checks per ms
  const k = Math.max(0.12, Math.min(1, (speed * 3500) / 420000));
  const B = (n) => Math.max(4000, Math.round(n * k));
  let path = pl.shortcut(res.path, B(120000));
  path = pl.lockPostures(path, B(120000));
  path = pl.shortcut(path, B(50000));
  path = pl.smoothRotation(path, B(60000));
  path = pl.shortcut(path, B(30000));
  path = pl.beautify(path, 2);
  path = pl.smoothRotation(path, B(25000));
  path = pl.shortcut(path, B(25000));
  path = pl.simplifyEnds(path);
  path = canonicalizeSymmetric(item, path);
  const dense = pl.densify(path, 2);
  const clearance = pl.clearanceProfile(dense);
  return { ...res, path, dense, clearance };
}
