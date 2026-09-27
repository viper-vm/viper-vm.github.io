// Pivot — route builder.
// Turns a list of route steps ("door 81 wide", "turn left", "stairs up"…) into a 3D
// world: free-space boxes, solid obstacles (derived from the free space), stair steps
// and ceilings, lift "portals", features that guide sampling, and render geometry.
// Units: cm. World axes: x east, y up, z south. The route starts heading north (−z).

import { mulberry32 } from './geom.js';

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // (dx, dz) for headings N, E, S, W

export const STEP_TYPES = {
  door: {
    label: 'Doorway', icon: 'door',
    fields: [['w', 'Clear width', 'Narrowest point: stop to stop with the door open'], ['h', 'Clear height', 'Floor to the underside of the frame'], ['d', 'Frame depth', 'Wall thickness, front face to back face']],
    defaults: { w: 81, h: 203, d: 14 },
    extras: [['align', 'Position in wall', ['center', 'left', 'right']]],
  },
  hall: {
    label: 'Hallway', icon: 'hall',
    fields: [['w', 'Width', 'Wall to wall — or to the radiator / shoe rack if one sticks out'], ['l', 'Length', 'Up to the next turn or door'], ['h', 'Ceiling height', '']],
    defaults: { w: 100, l: 300, h: 250 },
    extras: [['align', 'Line up with the door', ['center', 'left', 'right']]],
  },
  turn: {
    label: 'Turn', icon: 'turn',
    fields: [['beyond', 'Space past the turn', 'How far the hallway carries on beyond the opening (0 if it ends there)']],
    defaults: { dir: 'L', beyond: 0, divider: 'rail' },
    extras: [['dir', 'Direction', ['L', 'R', 'UL', 'UR']], ['divider', 'Between the two flights', ['rail', 'wall']]],
  },
  stairs: {
    label: 'Stairs', icon: 'stairs',
    fields: [['w', 'Width', 'Wall to handrail, at the narrowest'], ['n', 'Steps', 'Number of risers'], ['rise', 'Step height', ''], ['go', 'Step depth', 'Front edge to front edge'], ['head', 'Headroom', 'Lowest point of the ceiling above, measured straight up from a step edge']],
    defaults: { dir: 'up', w: 90, n: 14, rise: 18, go: 26, head: 200, ceil: 'open' },
    extras: [['dir', 'Direction', ['up', 'down']], ['ceil', 'Ceiling above', ['open', 'sloped']]],
  },
  lift: {
    label: 'Lift', icon: 'lift',
    fields: [['cw', 'Car width', 'Inside, side to side'], ['cd', 'Car depth', 'Inside, door to back wall'], ['ch', 'Car height', 'Inside, floor to ceiling'], ['dw', 'Door width', 'Clear opening'], ['dh', 'Door height', '']],
    defaults: { cw: 110, cd: 140, ch: 215, dw: 80, dh: 200, align: 'center', exit: 'same' },
    extras: [['align', 'Door position', ['center', 'left', 'right']], ['exit', 'Exit door', ['same', 'opposite']]],
  },
  room: {
    label: 'Room', icon: 'room',
    fields: [['w', 'Width', 'Side to side as you walk in'], ['l', 'Depth', 'From the door to the far wall'], ['h', 'Ceiling height', '']],
    defaults: { w: 350, l: 380, h: 260, name: 'Room' },
    extras: [['align', 'Door is near the', ['center', 'left', 'right']]],
  },
};

const r2 = (v) => Math.round(v * 100) / 100;

function frameToWorld(F, u, v, w) {
  const f = DIRS[F.h], r = DIRS[(F.h + 1) % 4];
  return [F.O[0] + u * r[0] + w * f[0], F.O[1] + v, F.O[2] + u * r[1] + w * f[1]];
}

function frameBox(F, u0, u1, v0, v1, w0, w1) {
  const a = frameToWorld(F, u0, v0, w0), b = frameToWorld(F, u1, v1, w1);
  return {
    min: [r2(Math.min(a[0], b[0])), r2(Math.min(a[1], b[1])), r2(Math.min(a[2], b[2]))],
    max: [r2(Math.max(a[0], b[0])), r2(Math.max(a[1], b[1])), r2(Math.max(a[2], b[2]))],
  };
}

function withDefaults(step) {
  const t = STEP_TYPES[step.t];
  return t ? { ...t.defaults, ...step } : null;
}

/** Clean up a raw step list: drop unknown steps, fold double turns, insert implied spaces. */
export function normalizeSteps(raw) {
  const out = [];
  (raw || []).forEach((s0, src) => {
    const s = withDefaults(s0);
    if (!s) return;
    s.src = src;
    const prev = out[out.length - 1];
    if (s.t === 'turn') {
      if (!prev) return; // turning in the open driveway means nothing
      if (prev.t === 'turn') { out[out.length - 1] = s; return; }
    }
    out.push(s);
  });
  while (out.length && out[out.length - 1].t === 'turn') out.pop();
  // implied spaces
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const s = out[i], prev = res[res.length - 1], prev2 = res[res.length - 2];
    const doorish = (x) => x && (x.t === 'door' || x.t === 'lift');
    const afterDoor = doorish(prev);
    const afterDoorTurn = prev && prev.t === 'turn' && doorish(prev2);
    if ((s.t === 'door' || s.t === 'lift') && (afterDoor || afterDoorTurn)) {
      const dw = s.t === 'door' ? s.w : s.dw;
      const pd = afterDoor ? prev : prev2;
      const pw = pd.t === 'lift' ? pd.dw : pd.w;
      if (afterDoor) res.push({ t: 'hall', w: Math.max(dw, pw) + 70, l: s.t === 'lift' ? 170 : 110, h: 240, implied: true, src: -1 });
      else res.splice(res.length - 1, 0, { t: 'hall', w: pw + 70, l: dw + 80, h: 240, implied: true, src: -1 });
    }
    res.push(s);
  }
  const last = res[res.length - 1];
  if (!last || (last.t !== 'hall' && last.t !== 'room')) res.push({ t: 'room', w: 320, l: 320, h: 250, name: 'Room', implied: true, src: -1 });
  return res;
}

/**
 * Build the world for a route. Returns everything the planner and renderer need.
 */
export function buildWorld(route) {
  const steps = normalizeSteps(route.steps);
  const free = [];       // {min,max,zone,kind,level}
  const internal = [];   // extra obstacles: {kind, c, h, R|null, level, zone}
  const zones = [];      // {id,label,kind,step,level}
  const features = [];   // {p,kind,zone,weight}
  const labels = [];     // dimension annotations
  const portals = [];    // lift teleports
  const centerline = []; // polyline points [x,y,z]
  const warnings = [];

  const addZone = (label, kind, step, level) => {
    const z = { id: zones.length, label, kind, step, level, src: step >= 0 && steps[step] ? steps[step].src : -1 };
    zones.push(z);
    return z.id;
  };
  const elPrev = [];
  let linkPrev = null;
  const newEl = (prev) => { elPrev.push(prev); return elPrev.length - 1; };
  const takeEl = () => { const p = linkPrev !== null ? linkPrev : cur.el; linkPrev = null; return newEl(p); };
  const addFree = (b, zone, kind, level, el) => { free.push({ ...b, zone, kind, level, el }); return b; };
  // elements within two links of each other may legitimately touch (door ↔ hall ↔ hall behind it)
  const nearEl = (a, b) => {
    if (a === b) return true;
    const pa = elPrev[a], pb = elPrev[b];
    return pa === b || pb === a || (pa >= 0 && elPrev[pa] === b) || (pb >= 0 && elPrev[pb] === a);
  };
  const clZone = [];
  const cl = (p, zone = zones.length - 1) => {
    const last = centerline[centerline.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 1) { centerline.push(p); clZone.push(zone); }
  };

  // --- start area: a driveway in front of the facade --------------------------------
  const OUT_W = 760, OUT_L = 540, OUT_H = 560;
  let cur = {
    kind: 'outside', F: { O: [0, 0, OUT_L], h: 0 }, u0: -OUT_W / 2, u1: OUT_W / 2, L: OUT_L,
    yEnd: 0, H: OUT_H, level: 0, zone: addZone('Outside', 'outside', -1, 0), el: newEl(-1),
  };
  addFree(frameBox(cur.F, cur.u0, cur.u1, 0, OUT_H, 0, OUT_L), cur.zone, 'outside', 0, cur.el);
  cl([0, 100, OUT_L / 2]);

  let pendingTurn = null;
  let railGap = null; // set by an open-well U-turn: the next flight gets a banister on its inner side
  let doorCount = 0, hallCount = 0, liftCount = 0;

  // Frame for a new element of lateral width wNew attached to `cur`.
  function attach(wNew, align, stepIdx) {
    const y = cur.yEnd;
    if (pendingTurn && (pendingTurn.dir === 'UL' || pendingTurn.dir === 'UR')) {
      const t = pendingTurn; pendingTurn = null;
      const left = t.dir === 'UL', gap = 12;
      const depth = Math.max(cur.u1 - cur.u0, wNew, 70) + (t.beyond || 0);
      const lu0 = left ? cur.u0 - gap - wNew : cur.u0, lu1 = left ? cur.u1 : cur.u1 + gap + wNew;
      const lz = addZone(cur.kind === 'stairs' ? 'Landing' : 'Turn', 'landing', stepIdx, cur.level);
      const Hl = Math.max(cur.kind === 'stairs' ? 250 : cur.H, 200);
      const le = newEl(cur.el);
      linkPrev = le;
      addFree(frameBox({ O: [cur.F.O[0], y, cur.F.O[2]], h: cur.F.h }, lu0, lu1, 0, Hl, cur.L, cur.L + depth), lz, 'landing', cur.level, le);
      const lc = frameToWorld({ O: [cur.F.O[0], y, cur.F.O[2]], h: cur.F.h }, (lu0 + lu1) / 2, 0, cur.L + depth / 2);
      features.push({ p: [lc[0], y + 100, lc[2]], kind: 'landing', zone: lz, weight: 3 });
      cl([lc[0], y + 100, lc[2]]);
      if (cur.kind === 'stairs' && cur.st && (t.divider || 'rail') === 'rail') {
        // An open well with banisters: above the handrails the two flights share one space,
        // so a long item can swing over the rail at the landing (as it really can).
        const st = cur.st;
        const gu0 = left ? cur.u0 - gap : cur.u1, gu1 = left ? cur.u0 : cur.u1 + gap;
        const topEst = Math.max(st.top, y + (st.yHigh - st.yLow) + 260);
        addFree(frameBox(st.F, gu0, gu1, st.yLow - 40 - st.F.O[1], topEst - st.F.O[1], 0, st.run), lz, 'landing', cur.level, le);
        for (const b of railBoxes(st, gu0, gu1)) internal.push({ kind: 'rail', ...b, zone: lz, level: cur.level });
        railGap = { side: left ? 'L' : 'R', gap };
      }
      const uc = left ? cur.u0 - gap - wNew / 2 : cur.u1 + gap + wNew / 2;
      const O = frameToWorld({ O: [cur.F.O[0], y, cur.F.O[2]], h: cur.F.h }, uc, 0, cur.L);
      return { O, h: (cur.F.h + 2) % 4 };
    }
    if (pendingTurn) {
      const t = pendingTurn; pendingTurn = null;
      const left = t.dir === 'L';
      const h2 = left ? (cur.F.h + 3) % 4 : (cur.F.h + 1) % 4;
      const beyond = Math.max(0, t.beyond || 0);
      if (cur.kind === 'door') {
        // door opens onto the side wall of the new space
        const doorC = frameToWorld({ O: [cur.F.O[0], y, cur.F.O[2]], h: cur.F.h }, (cur.u0 + cur.u1) / 2, 0, cur.L + wNew / 2);
        const f2 = DIRS[h2];
        const back = cur.u1 - cur.u0 + 0; // door width
        const off = back / 2 + beyond;
        const cornerP = [doorC[0], y + 100, doorC[2]];
        features.push({ p: cornerP, kind: 'corner', zone: -1, weight: 2.5 });
        cl(cornerP);
        return { O: [doorC[0] - f2[0] * off, y, doorC[2] - f2[1] * off], h: h2, doorTurn: { off, doorW: back } };
      }
      const uSide = left ? cur.u0 : cur.u1;
      let wc = cur.L - beyond - wNew / 2;
      if (wc < wNew / 2) { wc = Math.min(cur.L / 2, wNew / 2); warnings.push('A turn opening is wider than the space before it.'); }
      const O = frameToWorld({ O: [cur.F.O[0], y, cur.F.O[2]], h: cur.F.h }, uSide, 0, wc);
      const cc = frameToWorld({ O: [cur.F.O[0], y, cur.F.O[2]], h: cur.F.h }, (cur.u0 + cur.u1) / 2, 0, wc);
      features.push({ p: [cc[0], y + 100, cc[2]], kind: 'corner', zone: cur.zone, weight: 2.5 });
      cl([cc[0], y + 100, cc[2]]);
      return { O, h: h2 };
    }
    // straight on
    const cu = (cur.u0 + cur.u1) / 2;
    let u = cu;
    if (align === 'left' || align === 'right') {
      const curW = cur.u1 - cur.u0;
      if (cur.kind === 'door' || cur.kind === 'exit') {
        // new (wider) space positioned so the door sits near one of its walls
        if (wNew > curW + 30) u = align === 'left' ? cur.u0 - 15 + wNew / 2 : cur.u1 + 15 - wNew / 2;
      } else if (curW > wNew + 20) {
        // new (narrower) element pushed towards one wall of the current space
        u = align === 'left' ? cur.u0 + 10 + wNew / 2 : cur.u1 - 10 - wNew / 2;
      }
    }
    return { O: frameToWorld({ O: [cur.F.O[0], y, cur.F.O[2]], h: cur.F.h }, u, 0, cur.L), h: cur.F.h };
  }

  function placeLanding(stepIdx, depth) {
    // flat landing at the top/bottom of a flight, so a turn has somewhere to happen
    const F = attach(cur.u1 - cur.u0, 'center', stepIdx);
    const w = cur.u1 - cur.u0;
    const lz = addZone('Landing', 'landing', stepIdx, cur.level);
    const H = Math.max(cur.H || 250, 220);
    const el = takeEl();
    addFree(frameBox(F, -w / 2, w / 2, 0, H, 0, depth), lz, 'landing', cur.level, el);
    const c = frameToWorld(F, 0, 100, depth / 2);
    features.push({ p: c, kind: 'landing', zone: lz, weight: 2.5 });
    cl(c);
    cur = { kind: 'landing', F, u0: -w / 2, u1: w / 2, L: depth, yEnd: F.O[1], H, level: cur.level, zone: lz, el };
  }

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const next = steps[i + 1];
    if (s.t === 'turn') {
      if (cur.kind === 'stairs' && (s.dir === 'L' || s.dir === 'R')) {
        const nextW = next ? (next.t === 'door' ? next.w + 20 : next.t === 'lift' ? next.dw + 20 : next.w || 90) : 90;
        placeLanding(i, Math.max(nextW + (s.beyond || 0), 60));
      }
      if (cur.kind === 'door' && (s.dir === 'UL' || s.dir === 'UR')) {
        // U-turn straight out of a doorway: treat as a simple turn
        pendingTurn = { dir: s.dir === 'UL' ? 'L' : 'R', beyond: s.beyond };
      } else pendingTurn = { dir: s.dir, beyond: s.beyond, divider: s.divider };
      continue;
    }

    railGap = null; // a banister only carries over to a flight that directly follows the U-turn
    if (s.t === 'door') {
      doorCount++;
      const F = attach(s.w, s.align, i);
      const label = doorCount === 1 ? 'Front door' : `Door ${doorCount}`;
      const z = addZone(label, 'door', i, cur.level);
      const el = takeEl();
      addFree(frameBox(F, -s.w / 2, s.w / 2, 0, s.h, 0, s.d), z, 'door', cur.level, el);
      const c = frameToWorld(F, 0, s.h / 2, s.d / 2);
      features.push({ p: c, kind: 'door', zone: z, weight: 4 });
      cl(frameToWorld(F, 0, Math.min(100, s.h / 2), 0));
      cl(frameToWorld(F, 0, Math.min(100, s.h / 2), s.d));
      labels.push({ kind: 'door', p: frameToWorld(F, 0, s.h + 6, s.d / 2), text: `${fmt(s.w)} × ${fmt(s.h)}`, h: F.h, w: s.w, zone: z });
      cur = { kind: 'door', F, u0: -s.w / 2, u1: s.w / 2, L: s.d, yEnd: F.O[1], H: s.h, level: cur.level, zone: z, el };
      continue;
    }

    if (s.t === 'hall' || s.t === 'room') {
      const isRoom = s.t === 'room';
      let F;
      if (isRoom && !pendingTurn && (!s.align || s.align === 'center')) {
        // rooms can sit anywhere along the wall: pick the placement that collides with nothing
        let pick = null;
        for (const al of ['center', 'left', 'right']) {
          const Fc = attach(s.w, al, i);
          const b = frameBox(Fc, -s.w / 2, s.w / 2, 0, s.h, 0, s.l);
          const clash = free.some((o) => o.el !== cur.el && !nearEl(o.el, cur.el) && boxesTouch(b, o));
          if (!clash) { pick = Fc; break; }
          if (!pick) pick = Fc;
        }
        F = pick;
      } else F = attach(s.w, s.align, i);
      let L = s.l;
      if (F.doorTurn) {
        const need = F.doorTurn.off + F.doorTurn.doorW / 2 + 40;
        if (L < need) { L = need; }
      }
      const label = isRoom ? (s.name || 'Room') : s.implied ? 'Passage' : `Hallway${++hallCount > 1 ? ' ' + hallCount : ''}`;
      const z = addZone(label, isRoom ? 'room' : 'hall', i, cur.level);
      const el = takeEl();
      addFree(frameBox(F, -s.w / 2, s.w / 2, 0, s.h, 0, L), z, isRoom ? 'room' : 'hall', cur.level, el);
      if (!F.doorTurn) cl(frameToWorld(F, 0, 100, Math.min(L / 2, s.w / 2)));
      if (!isRoom) cl(frameToWorld(F, 0, 100, L - Math.min(L / 2, s.w / 2)));
      else cl(frameToWorld(F, 0, 100, L / 2));
      labels.push({ kind: isRoom ? 'room' : 'hall', p: frameToWorld(F, 0, 2, L / 2), text: isRoom ? label : `${fmt(s.w)} wide`, h: F.h, zone: z });
      cur = { kind: isRoom ? 'room' : 'hall', F, u0: -s.w / 2, u1: s.w / 2, L, yEnd: F.O[1], H: s.h, level: cur.level, zone: z, el };
      continue;
    }

    if (s.t === 'stairs') {
      const F = attach(s.w, s.align, i);
      const up = s.dir !== 'down';
      const n = Math.max(1, Math.round(s.n)), rise = s.rise, go = s.go, run = n * go;
      const y0 = F.O[1];
      const yLow = up ? y0 : y0 - n * rise, yHigh = up ? y0 + n * rise : y0;
      const prevH = cur.H && cur.kind !== 'outside' ? cur.H : 250;
      const nextH = next && (next.t === 'hall' || next.t === 'room') ? next.h : 250;
      const Hlow = up ? prevH : nextH, Hhigh = up ? nextH : prevH;
      const top = Math.max(yLow + Hlow, yHigh + Hhigh);
      const level = cur.level, levelAfter = up ? level + 1 : level - 1;
      const z = addZone(up ? 'Stairs up' : 'Stairs down', 'stairs', i, Math.min(level, levelAfter));
      const el = takeEl();
      addFree(frameBox(F, -s.w / 2, s.w / 2, yLow - y0, top - y0, 0, run), z, 'stairs', Math.min(level, levelAfter), el);
      // treads
      for (let k = 1; k <= n; k++) {
        const w0 = (k - 1) * go, w1 = k * go;
        const topK = up ? yLow + k * rise : yHigh - (k - 1) * rise;
        const b = frameBox(F, -s.w / 2 - 20, s.w / 2 + 20, yLow - 40 - y0, topK - y0, w0, w1);
        internal.push({ kind: 'step', min: b.min, max: b.max, zone: z, level: Math.min(level, levelAfter) });
      }
      // ceiling: flat lower-floor ceiling from the low end until the headroom line, then sloped or open
      const tanA = rise / go, alpha = Math.atan(tanA);
      let dStar = (Hlow - rise - s.head) / tanA;
      dStar = Math.max(0, Math.min(run, dStar));
      const lowW = (d) => (up ? d : run - d); // distance-from-low-end → frame w
      if (dStar > 0.5) {
        const a = lowW(0), b = lowW(dStar);
        const bb = frameBox(F, -s.w / 2 - 20, s.w / 2 + 20, yLow + Hlow - y0, top - y0 + 40, Math.min(a, b), Math.max(a, b));
        internal.push({ kind: 'bulkhead', min: bb.min, max: bb.max, zone: z, level: Math.min(level, levelAfter) });
      }
      if (s.ceil === 'sloped' && dStar < run - 1) {
        // thick slab whose underside runs parallel to the nosing line, `head` above it
        const T = 260;
        const d0 = dStar, d1 = run;
        const len = (d1 - d0) / Math.cos(alpha);
        const dm = (d0 + d1) / 2;
        const yUnder = yLow + rise + s.head + dm * tanA; // underside height at mid-span
        // centre = underside point + normal·T/2; normal = (−sinα toward high end, cosα up)
        const hx = -Math.sin(alpha) * T / 2, hy = Math.cos(alpha) * T / 2;
        const wm = lowW(dm) + (up ? hx : -hx);
        const c = frameToWorld(F, 0, yUnder + hy - y0, wm);
        // axes: a = along slope toward high end, n = normal, l = lateral
        const fDir = DIRS[F.h], rDir = DIRS[(F.h + 1) % 4];
        const sg = up ? 1 : -1; // high end direction along frame w
        const ax = [fDir[0] * sg * Math.cos(alpha), Math.sin(alpha), fDir[1] * sg * Math.cos(alpha)];
        const nx = [-fDir[0] * sg * Math.sin(alpha), Math.cos(alpha), -fDir[1] * sg * Math.sin(alpha)];
        const lx = [-rDir[0], 0, -rDir[1]]; // negated so the frame stays right-handed
        // local x = lateral, y = normal, z = along-slope
        const R = [lx[0], nx[0], ax[0], lx[1], nx[1], ax[1], lx[2], nx[2], ax[2]];
        internal.push({ kind: 'slope', c, h: [s.w / 2 + 20, T / 2, len / 2], R, zone: z, level: Math.min(level, levelAfter) });
        // fill the little wedge above the slab's square-cut top end
        const wEnd = lowW(run), wIn = lowW(run - 45);
        const wb = frameBox(F, -s.w / 2 - 20, s.w / 2 + 20, yLow + rise + s.head + run * tanA - y0, top - y0 + 40, Math.min(wEnd, wIn), Math.max(wEnd, wIn));
        internal.push({ kind: 'bulkhead', min: wb.min, max: wb.max, zone: z, level: Math.min(level, levelAfter), hidden: true });
      }
      const lowP = frameToWorld(F, 0, yLow + rise + Math.min(s.head, 180) / 2 - y0, lowW(0));
      const highP = frameToWorld(F, 0, yHigh + rise + Math.min(s.head, 180) / 2 - y0, lowW(run));
      const pA = up ? lowP : highP, pB = up ? highP : lowP;
      features.push({ p: pA, kind: 'stairs-end', zone: z, weight: 2.5 });
      features.push({ p: pB, kind: 'stairs-end', zone: z, weight: 2.5 });
      features.push({ p: [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2, (pA[2] + pB[2]) / 2], kind: 'stairs', zone: z, weight: 1.5 });
      if (dStar > 0.5 && dStar < run - 0.5) {
        features.push({ p: frameToWorld(F, 0, yLow + Hlow - 60 - y0, lowW(dStar)), kind: 'bulkhead', zone: z, weight: 2.5 });
      }
      cl(pA); cl(pB);
      labels.push({ kind: 'stairs', p: frameToWorld(F, 0, (up ? yLow : yHigh) + 4 - y0, lowW(run / 2)), text: `${n} steps · ${fmt(s.head)} headroom`, h: F.h, zone: z });
      const st = { F, up, run, rise, go, tanA, yLow, yHigh, top, head: s.head, w: s.w };
      if (railGap) {
        const g = railGap; railGap = null;
        const gu0 = g.side === 'L' ? -s.w / 2 - g.gap : s.w / 2, gu1 = g.side === 'L' ? -s.w / 2 : s.w / 2 + g.gap;
        for (const b of railBoxes(st, gu0, gu1)) internal.push({ kind: 'rail', ...b, zone: z, level: Math.min(level, levelAfter) });
      }
      cur = {
        kind: 'stairs', F: { O: [F.O[0], up ? yHigh : yLow, F.O[2]], h: F.h }, u0: -s.w / 2, u1: s.w / 2, L: run,
        yEnd: up ? yHigh : yLow, H: up ? Hhigh : Hlow, level: levelAfter, zone: z, stairs: true, el, st,
      };
      continue;
    }

    if (s.t === 'lift') {
      liftCount++;
      const F = attach(s.dw, 'center', i);
      const t = 16;
      const off = s.align === 'left' ? s.cw / 2 - s.dw / 2 - 6 : s.align === 'right' ? -(s.cw / 2 - s.dw / 2 - 6) : 0;
      const dy = 380;
      const lvl = cur.level;
      const zDoor = addZone(liftCount > 1 ? `Lift ${liftCount} door` : 'Lift door', 'door', i, lvl);
      const zCar = addZone(liftCount > 1 ? `Lift ${liftCount}` : 'Lift', 'lift', i, lvl);
      const zCarUp = addZone(liftCount > 1 ? `Lift ${liftCount}` : 'Lift', 'lift', i, lvl + 1);
      const zDoorUp = addZone('Lift door', 'door', i, lvl + 1);
      const el = takeEl();
      addFree(frameBox(F, -s.dw / 2, s.dw / 2, 0, s.dh, 0, t), zDoor, 'door', lvl, el);
      const car = frameBox(F, off - s.cw / 2, off + s.cw / 2, 0, s.ch, t, t + s.cd);
      addFree(car, zCar, 'lift', lvl, el);
      const carUp = { min: [car.min[0], r2(car.min[1] + dy), car.min[2]], max: [car.max[0], r2(car.max[1] + dy), car.max[2]] };
      addFree(carUp, zCarUp, 'lift', lvl + 1, el);
      const same = s.exit !== 'opposite';
      const exitW0 = same ? 0 : t + s.cd, exitW1 = same ? t : 2 * t + s.cd;
      addFree(frameBox(F, -s.dw / 2, s.dw / 2, dy, dy + s.dh, exitW0, exitW1), zDoorUp, 'door', lvl + 1, el);
      portals.push({ a: car, b: carUp, dy, zone: zCar, zoneUp: zCarUp });
      features.push({ p: frameToWorld(F, 0, s.dh / 2, t / 2), kind: 'door', zone: zDoor, weight: 4 });
      features.push({ p: frameToWorld(F, off, s.ch / 2, t + s.cd / 2), kind: 'lift', zone: zCar, weight: 4 });
      features.push({ p: frameToWorld(F, off, dy + s.ch / 2, t + s.cd / 2), kind: 'lift', zone: zCarUp, weight: 4 });
      features.push({ p: frameToWorld(F, 0, dy + s.dh / 2, (exitW0 + exitW1) / 2), kind: 'door', zone: zDoorUp, weight: 4 });
      cl(frameToWorld(F, 0, 100, 0), zDoor);
      cl(frameToWorld(F, off, 100, t + s.cd / 2), zCar);
      cl(frameToWorld(F, off, dy + 100, t + s.cd / 2), zCarUp);
      cl(frameToWorld(F, 0, dy + 100, (exitW0 + exitW1) / 2), zDoorUp);
      labels.push({ kind: 'lift', p: frameToWorld(F, off, s.ch + 8, t + s.cd / 2), text: `Lift ${fmt(s.cw)} × ${fmt(s.cd)}`, h: F.h, zone: zCar });
      labels.push({ kind: 'door', p: frameToWorld(F, 0, s.dh + 6, t / 2), text: `${fmt(s.dw)} × ${fmt(s.dh)}`, h: F.h, w: s.dw, zone: zDoor });
      const exitF = same
        ? { O: frameToWorld(F, 0, dy, t), h: (F.h + 2) % 4 }
        : { O: frameToWorld(F, 0, dy, t + s.cd), h: F.h };
      cur = { kind: 'exit', F: exitF, u0: -s.dw / 2, u1: s.dw / 2, L: t, yEnd: exitF.O[1], H: s.dh, level: lvl + 1, zone: zDoorUp, el };
      // an exit door behaves like a door for whatever comes next
      cur.kind = 'door';
      continue;
    }
  }

  const resolved = resolveOverlaps(free, nearEl, zones, warnings);
  free.length = 0;
  free.push(...resolved);

  const dest = free.filter((b) => b.zone === cur.zone);
  const destBox = dest.reduce((a, b) => (vol(b) > vol(a) ? b : a), dest[0]);
  zones[cur.zone].dest = true;

  return finishWorld({ steps, free, internal, zones, features, labels, portals, centerline, clZone, warnings, destBox, destZone: cur.zone });
}

function fmt(v) {
  return `${Math.round(v)}`;
}

/**
 * A banister along one side of a flight, as one box per tread: solid from below the flight up
 * to 95 cm above the step edges (using each tread's higher end, so it errs on the safe side).
 */
function railBoxes(st, u0, u1) {
  const { F, up, run, rise, go, tanA, yLow } = st;
  const n = Math.round(run / go);
  const out = [];
  for (let k = 0; k < n; k++) {
    const w0 = k * go, w1 = (k + 1) * go;
    const dHi = up ? w1 : run - w0;
    const top = yLow + rise + dHi * tanA + 95;
    out.push(frameBox(F, u0, u1, yLow - 40 - F.O[1], top - F.O[1], w0, w1));
  }
  return out;
}

/**
 * An oriented slab whose face follows a line parallel to a flight's pitch:
 * y(d) = y0 + d·tan(α), d = distance from the flight's low end. `below` puts the slab under
 * the line (a banister), otherwise over it (a sloped ceiling). u0..u1 is the lateral extent.
 */
function slopeSlab(st, y0, u0, u1, T, below) {
  const { F, up, run, tanA } = st;
  const alpha = Math.atan(tanA);
  const len = run / Math.cos(alpha);
  const dm = run / 2;
  const yMid = y0 + dm * tanA;
  const sg = below ? -1 : 1;
  const hx = -Math.sin(alpha) * (T / 2) * sg, hy = Math.cos(alpha) * (T / 2) * sg;
  const wm = (up ? dm : run - dm) + (up ? hx : -hx);
  const c = frameToWorld(F, (u0 + u1) / 2, yMid + hy - F.O[1], wm);
  const fDir = DIRS[F.h], rDir = DIRS[(F.h + 1) % 4];
  const dir = up ? 1 : -1;
  const ax = [fDir[0] * dir * Math.cos(alpha), Math.sin(alpha), fDir[1] * dir * Math.cos(alpha)];
  const nx = [-fDir[0] * dir * Math.sin(alpha), Math.cos(alpha), -fDir[1] * dir * Math.sin(alpha)];
  const lx = [-rDir[0], 0, -rDir[1]];
  return { c, h: [(u1 - u0) / 2, T / 2, len / 2], R: [lx[0], nx[0], ax[0], lx[1], nx[1], ax[1], lx[2], nx[2], ax[2]] };
}

const vol = (b) => (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);

/**
 * Would these two free boxes join into one space? True if they overlap, or share a face
 * with real area. Boxes that only meet along an edge or corner, or have any gap at all,
 * are separated by solid material already. (gh/gv are kept for call-site symmetry.)
 */
function boxesTouch(a, b) {
  let positive = 0;
  for (let i = 0; i < 3; i++) {
    const ov = Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]);
    if (ov < -0.05) return false;
    if (ov > 0.5) positive++;
  }
  return positive >= 2;
}

/** a minus b → up to six boxes (metadata of a is kept). */
function subtractBox(a, b) {
  if (!(a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[1] < b.max[1] && a.max[1] > b.min[1] && a.min[2] < b.max[2] && a.max[2] > b.min[2])) return [a];
  const out = [];
  const mk = (x0, y0, z0, x1, y1, z1) => { if (x1 - x0 > 1 && y1 - y0 > 1 && z1 - z0 > 1) out.push({ ...a, min: [x0, y0, z0], max: [x1, y1, z1] }); };
  const x0 = Math.max(a.min[0], b.min[0]), x1 = Math.min(a.max[0], b.max[0]);
  const y0 = Math.max(a.min[1], b.min[1]), y1 = Math.min(a.max[1], b.max[1]);
  mk(a.min[0], a.min[1], a.min[2], x0, a.max[1], a.max[2]);
  mk(x1, a.min[1], a.min[2], a.max[0], a.max[1], a.max[2]);
  mk(x0, a.min[1], a.min[2], x1, y0, a.max[2]);
  mk(x0, y1, a.min[2], x1, a.max[1], a.max[2]);
  mk(x0, y0, a.min[2], x1, y1, Math.max(a.min[2], b.min[2]));
  mk(x0, y0, Math.min(a.max[2], b.max[2]), x1, y1, a.max[2]);
  return out;
}

/**
 * Spaces that are not neighbours on the route must not touch, or the item could take a
 * shortcut through what is really a wall. The driveway shrinks away from the building;
 * later spaces are clipped against earlier ones (leaving a 12 cm wall).
 */
function resolveOverlaps(free, nearEl, zones, warnings) {
  const GH = 12, GV = 0.6;
  const out = free[0];
  const firstEls = free.filter((b) => b.el !== 0 && nearEl(b.el, 0));
  const doorX0 = Math.min(...firstEls.map((b) => b.min[0]), -60), doorX1 = Math.max(...firstEls.map((b) => b.max[0]), 60);
  const clipOutside = [];
  for (const b of free) {
    if (b.el === 0 || nearEl(b.el, 0) || !boxesTouch(b, out)) continue;
    if (b.min[1] >= 150 && b.min[1] - GV >= 300) out.max[1] = Math.min(out.max[1], r2(b.min[1] - GV));
    else if (b.min[0] >= doorX1) out.max[0] = Math.min(out.max[0], r2(b.min[0] - GH));
    else if (b.max[0] <= doorX0) out.min[0] = Math.max(out.min[0], r2(b.max[0] + GH));
    else if (b.min[1] >= 150) out.max[1] = Math.min(out.max[1], r2(Math.max(260, b.min[1] - GV)));
    else clipOutside.push(b);
  }
  const res = [out];
  for (let i = 1; i < free.length; i++) {
    let frags = [free[i]];
    const blockers = [];
    for (let j = 0; j < i; j++) {
      const c = free[j];
      if (c.el === free[i].el || nearEl(free[i].el, c.el)) continue;
      if (j === 0 && !clipOutside.includes(free[i])) continue;
      if (!boxesTouch(free[i], c)) continue;
      const ex = { min: [c.min[0] - GH, c.min[1] - GV, c.min[2] - GH], max: [c.max[0] + GH, c.max[1] + GV, c.max[2] + GH] };
      frags = frags.flatMap((f) => subtractBox(f, ex));
      blockers.push(c);
    }
    const benign = blockers.every((c) => c.kind === 'stairs' || free[i].kind === 'stairs' || c.kind === 'landing' || free[i].kind === 'landing');
    if (blockers.length && !benign) {
      const a = zones[free[i].zone].label, b = zones[blockers[0].zone].label;
      warnings.push(`“${a}” runs into “${b}” — a wall has been kept between them. Check the turn directions and lengths.`);
    }
    res.push(...frags);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Derive solid obstacles (and render faces) from the free-space boxes.

function finishWorld(w) {
  const pad = 40;
  const grid = rasterize(w.free, pad);
  const solids = mergeSolids(grid);
  const faces = extractFaces(grid, w.free, w.zones);

  // obstacle arrays for the planner
  const obstacles = [];
  for (const b of solids) obstacles.push({ kind: 'wall', min: b.min, max: b.max });
  for (const o of w.internal) obstacles.push(o);

  // bounds
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const b of w.free) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], b.min[i]); max[i] = Math.max(max[i], b.max[i]); }

  // centreline arc length
  const cs = [0];
  for (let i = 1; i < w.centerline.length; i++) {
    const a = w.centerline[i - 1], b = w.centerline[i];
    cs.push(cs[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }

  // for each zone, the centreline segments near it (its own points plus one neighbour each side)
  for (const z of w.zones) { z.cl0 = Infinity; z.cl1 = -Infinity; }
  w.clZone.forEach((zid, i) => { const z = w.zones[zid]; if (!z) return; z.cl0 = Math.min(z.cl0, i); z.cl1 = Math.max(z.cl1, i); });
  for (const z of w.zones) {
    if (z.cl0 === Infinity) { z.cl0 = 0; z.cl1 = w.centerline.length - 1; }
    z.cl0 = Math.max(0, z.cl0 - 1); z.cl1 = Math.min(w.centerline.length - 1, z.cl1 + 1);
  }
  const levels = [...new Set(w.zones.map((z) => z.level))].sort((a, b) => a - b);
  return {
    ...w,
    obstacles,
    faces,
    bounds: { min, max },
    centerlineS: cs,
    length: cs[cs.length - 1] || 1,
    levels,
  };
}

function rasterize(free, pad) {
  const xsSet = new Set(), ysSet = new Set(), zsSet = new Set();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const b of free) {
    xsSet.add(b.min[0]); xsSet.add(b.max[0]);
    ysSet.add(b.min[1]); ysSet.add(b.max[1]);
    zsSet.add(b.min[2]); zsSet.add(b.max[2]);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], b.min[i]); max[i] = Math.max(max[i], b.max[i]); }
  }
  xsSet.add(r2(min[0] - pad)); xsSet.add(r2(max[0] + pad));
  ysSet.add(r2(min[1] - pad)); ysSet.add(r2(max[1] + pad));
  zsSet.add(r2(min[2] - pad)); zsSet.add(r2(max[2] + pad));
  const xs = [...xsSet].sort((a, b) => a - b), ys = [...ysSet].sort((a, b) => a - b), zs = [...zsSet].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1;
  const owner = new Int32Array(nx * ny * nz).fill(-1);
  const find = (arr, v) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; };
  free.forEach((b, bi) => {
    const i0 = find(xs, b.min[0]), i1 = find(xs, b.max[0]);
    const j0 = find(ys, b.min[1]), j1 = find(ys, b.max[1]);
    const k0 = find(zs, b.min[2]), k1 = find(zs, b.max[2]);
    for (let j = j0; j < j1; j++) for (let k = k0; k < k1; k++) for (let i = i0; i < i1; i++) {
      const id = (j * nz + k) * nx + i;
      if (owner[id] < 0) owner[id] = bi;
    }
  });
  return { xs, ys, zs, nx, ny, nz, owner };
}

function mergeSolids(g) {
  const { xs, ys, zs, nx, ny, nz, owner } = g;
  const used = new Uint8Array(owner.length);
  const at = (i, j, k) => (j * nz + k) * nx + i;
  const solid = (i, j, k) => owner[at(i, j, k)] < 0 && !used[at(i, j, k)];
  const out = [];
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    if (!solid(i, j, k)) continue;
    let i1 = i;
    while (i1 + 1 < nx && solid(i1 + 1, j, k)) i1++;
    let k1 = k;
    outerK: while (k1 + 1 < nz) {
      for (let ii = i; ii <= i1; ii++) if (!solid(ii, j, k1 + 1)) break outerK;
      k1++;
    }
    let j1 = j;
    outerJ: while (j1 + 1 < ny) {
      for (let kk = k; kk <= k1; kk++) for (let ii = i; ii <= i1; ii++) if (!solid(ii, j1 + 1, kk)) break outerJ;
      j1++;
    }
    for (let jj = j; jj <= j1; jj++) for (let kk = k; kk <= k1; kk++) for (let ii = i; ii <= i1; ii++) used[at(ii, jj, kk)] = 1;
    out.push({ min: [xs[i], ys[j], zs[k]], max: [xs[i1 + 1], ys[j1 + 1], zs[k1 + 1]] });
  }
  return out;
}

/**
 * Boundary faces between free and solid cells, oriented to face into the free space.
 * Returns [{axis, sign, kind:'floor'|'ceiling'|'wall', zone, corners:[[x,y,z]*4]}].
 */
function extractFaces(g, free, zones) {
  const { xs, ys, zs, nx, ny, nz, owner } = g;
  const at = (i, j, k) => (j * nz + k) * nx + i;
  const out = [];
  // For each axis we sweep planes; within a plane, build a 2D mask of (zone, sign) and greedy-merge.
  const dims = [nx, ny, nz];
  const coords = [xs, ys, zs];
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    const nu = dims[u], nv = dims[v];
    for (let p = 1; p < dims[axis]; p++) {
      const mask = new Int32Array(nu * nv).fill(-1); // encodes zone*2 + (sign>0)
      let any = false;
      for (let b = 0; b < nv; b++) for (let a = 0; a < nu; a++) {
        const idxA = [0, 0, 0], idxB = [0, 0, 0];
        idxA[axis] = p - 1; idxB[axis] = p;
        idxA[u] = a; idxA[v] = b; idxB[u] = a; idxB[v] = b;
        const oa = owner[at(idxA[0], idxA[1], idxA[2])];
        const ob = owner[at(idxB[0], idxB[1], idxB[2])];
        if ((oa < 0) === (ob < 0)) continue;
        // normal points into the free cell
        const freeOwner = oa >= 0 ? oa : ob;
        const sign = oa >= 0 ? -1 : 1; // free on the low side → normal points −axis
        mask[b * nu + a] = free[freeOwner].zone * 2 + (sign > 0 ? 1 : 0);
        any = true;
      }
      if (!any) continue;
      const done = new Uint8Array(nu * nv);
      for (let b = 0; b < nv; b++) for (let a = 0; a < nu; a++) {
        const m = mask[b * nu + a];
        if (m < 0 || done[b * nu + a]) continue;
        let a1 = a;
        while (a1 + 1 < nu && mask[b * nu + a1 + 1] === m && !done[b * nu + a1 + 1]) a1++;
        let b1 = b;
        outer: while (b1 + 1 < nv) {
          for (let aa = a; aa <= a1; aa++) if (mask[(b1 + 1) * nu + aa] !== m || done[(b1 + 1) * nu + aa]) break outer;
          b1++;
        }
        for (let bb = b; bb <= b1; bb++) for (let aa = a; aa <= a1; aa++) done[bb * nu + aa] = 1;
        const zone = m >> 1, sign = m & 1 ? 1 : -1;
        const P = coords[axis][p];
        const U0 = coords[u][a], U1 = coords[u][a1 + 1], V0 = coords[v][b], V1 = coords[v][b1 + 1];
        const mk = (uu, vv) => { const c = [0, 0, 0]; c[axis] = P; c[u] = uu; c[v] = vv; return c; };
        const kind = axis === 1 ? (sign > 0 ? 'floor' : 'ceiling') : 'wall';
        out.push({ axis, sign, kind, zone, zoneKind: zones[zone].kind, level: zones[zone].level, corners: [mk(U0, V0), mk(U1, V0), mk(U1, V1), mk(U0, V1)] });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Start and goal poses

/** Arc-length position of point p projected onto the route centreline. */
export function progressOf(world, x, y, z, zone = -1) {
  const c = world.centerline, cs = world.centerlineS;
  let best = Infinity, bestS = 0;
  let i0 = 1, i1 = c.length - 1;
  if (zone >= 0 && world.zones[zone]) { i0 = Math.max(1, world.zones[zone].cl0); i1 = Math.max(i0, world.zones[zone].cl1); }
  for (let i = i0; i <= i1 && i < c.length; i++) {
    const a = c[i - 1], b = c[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L2 = dx * dx + dy * dy + dz * dz || 1;
    let t = ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a[0] + dx * t - x, py = a[1] + dy * t - y, pz = a[2] + dz * t - z;
    const d = px * px + py * py * 4 + pz * pz; // vertical mismatch weighs more (floors)
    if (d < best) { best = d; bestS = cs[i - 1] + t * Math.sqrt(L2); }
  }
  return bestS;
}

/** Which zone a point is in (first free box containing it), or -1. */
export function zoneAt(world, x, y, z) {
  for (const b of world.free) {
    if (x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1] && z >= b.min[2] && z <= b.max[2]) return b.zone;
  }
  return -1;
}

export { mulberry32 };
