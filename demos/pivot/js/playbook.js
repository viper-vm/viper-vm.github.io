// Pivot — turns a planned 6-DOF path into a mover's playbook: short, human steps
// ("Stand it on its left arm", "Through the front door, back first, swinging it right").

import { qToMat } from './geom.js';
import { zoneAt } from './world.js';

const AXES = ['x', 'y', 'z'];

/** Posture of the item: which of its own axes points up, and how far it leans. */
export function postureOf(q) {
  const m = qToMat(q);
  // column j's y-component = how much local axis j points up
  const ups = [m[3], m[4], m[5]];
  let a = 0;
  for (let j = 1; j < 3; j++) if (Math.abs(ups[j]) > Math.abs(ups[a])) a = j;
  const sign = ups[a] >= 0 ? 1 : -1;
  const tilt = (Math.acos(Math.min(1, Math.abs(ups[a]))) * 180) / Math.PI;
  return { axis: a, sign, code: `${sign > 0 ? '+' : '-'}${AXES[a]}`, tilt, m };
}

function names(item) {
  return item.names || { '+x': 'right end', '-x': 'left end', '+y': 'top', '-y': 'bottom', '+z': 'front', '-z': 'back' };
}

const flip = (code) => (code[0] === '+' ? '-' : '+') + code[1];

/** Human description of a posture. */
export function postureText(item, post) {
  const N = names(item);
  // a plain box looks the same upside down: never tell anyone to flip a wardrobe
  if (post.code === '-y' && item.parts.length === 1) post = { ...post, code: '+y', sign: 1 };
  const down = N[flip(post.code)];
  const sofa = ['sofa', 'loveseat', 'armchair', 'sectional'].includes(item.type);
  // a lean past ~40° is really the middle of a tip, not something to hold
  const lean = post.tilt > 22 && post.tilt <= 42 ? `, leaning about ${Math.round(post.tilt / 5) * 5}°` : '';
  if (post.code === '+y') return { short: 'upright', long: `upright${lean}` };
  if (post.code === '-y') return { short: 'upside down', long: `upside down${lean}` };
  if (post.axis === 0) {
    return sofa
      ? { short: `on its ${down}`, long: `standing on its ${down}${lean}` }
      : { short: `on its ${down}`, long: `standing on its ${down}${lean}` };
  }
  // z axis vertical: lying on front/back
  if (post.code === '+z') return { short: `on its ${N['-z']}`, long: `lying on its ${N['-z']}${lean}` };
  return { short: `on its ${N['+z']}`, long: `lying on its ${N['+z']}${lean}` };
}

/** Which part of the item leads in the direction of travel. */
function leading(item, m, dir) {
  // local = Rᵀ · dir
  const lx = m[0] * dir[0] + m[3] * dir[1] + m[6] * dir[2];
  const ly = m[1] * dir[0] + m[4] * dir[1] + m[7] * dir[2];
  const lz = m[2] * dir[0] + m[5] * dir[1] + m[8] * dir[2];
  const v = [lx, ly, lz];
  let a = 0;
  for (let j = 1; j < 3; j++) if (Math.abs(v[j]) > Math.abs(v[a])) a = j;
  const code = `${v[a] >= 0 ? '+' : '-'}${AXES[a]}`;
  return names(item)[code];
}

/** Signed rotation (radians) about the world vertical between two orientations; + = anticlockwise from above (a left turn). */
function yawDelta(q0, q1) {
  // relative rotation r = q1 * conj(q0)
  const [ax, ay, az, aw] = q0, [bx, by, bz, bw] = q1;
  const cx = -ax, cy = -ay, cz = -az, cw = aw;
  const rx = bw * cx + bx * cw + by * cz - bz * cy;
  const ry = bw * cy - bx * cz + by * cw + bz * cx;
  const rz = bw * cz + bx * cy - by * cx + bz * cw;
  let rw = bw * cw - bx * cx - by * cy - bz * cz;
  let sx = rx, sy = ry, sz = rz;
  if (rw < 0) { rw = -rw; sx = -sx; sy = -sy; sz = -sz; }
  const s = Math.hypot(sx, sy, sz);
  if (s < 1e-9) return 0;
  const ang = 2 * Math.atan2(s, rw);
  return (ang * sy) / s;
}

/**
 * Build the playbook.
 * @returns {{steps: Array, summary: object}}
 */
export function buildPlaybook(world, item, dense, clearance) {
  const n = dense.length;
  if (!n) return { steps: [], summary: {} };
  const zones = world.zones;
  const info = new Array(n);
  let lastZone = 0;
  let held = null; // posture with hysteresis: only switch once another axis is clearly vertical
  for (let i = 0; i < n; i++) {
    const p = dense[i].p;
    let z = zoneAt(world, p[0], p[1], p[2]);
    if (z < 0) z = lastZone;
    lastZone = z;
    const raw = postureOf([p[3], p[4], p[5], p[6]]);
    if (!held || (raw.code !== held.code && raw.tilt < 33)) held = raw;
    const ups = [raw.m[3], raw.m[4], raw.m[5]];
    const c = ups[held.axis] * held.sign;
    const post = { ...raw, axis: held.axis, sign: held.sign, code: held.code, tilt: (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI };
    info[i] = { z, post, d: dense[i].d, tele: !!dense[i].t };
  }
  // smooth the zone sequence: ignore visits shorter than 10 cm of travel
  const runs = [];
  for (let i = 0; i < n; i++) {
    const r = runs[runs.length - 1];
    if (r && r.z === info[i].z && !info[i].tele) r.i1 = i;
    else runs.push({ z: info[i].z, i0: i, i1: i, tele: info[i].tele });
  }
  const merged = [];
  for (const r of runs) {
    const len = info[r.i1].d - info[r.i0].d;
    const prev = merged[merged.length - 1];
    if (prev && !r.tele && len < 10 && zones[r.z].kind !== 'door') { prev.i1 = r.i1; continue; }
    if (prev && prev.z === r.z && !r.tele) { prev.i1 = r.i1; continue; }
    merged.push({ ...r });
  }

  // posture changes split runs further
  const phases = [];
  for (const r of merged) {
    let start = r.i0;
    for (let i = r.i0 + 1; i <= r.i1; i++) {
      if (info[i].post.code !== info[i - 1].post.code) {
        // include the rotation in the phase that ends with the new posture
        if (i - start > 0) phases.push({ z: r.z, i0: start, i1: i - 1, tele: start === r.i0 && r.tele });
        start = i;
      }
    }
    phases.push({ z: r.z, i0: start, i1: r.i1, tele: start === r.i0 && r.tele });
  }
  // merge tiny phases (<6 cm) into the previous one
  const P = [];
  for (const ph of phases) {
    const prev = P[P.length - 1];
    const len = info[ph.i1].d - info[ph.i0].d;
    if (prev && !ph.tele && len < 6 && prev.z === ph.z) { prev.i1 = ph.i1; continue; }
    P.push(ph);
  }

  const steps = [];
  const N = names(item);
  const vals = clearance ? clearance.values : null;
  for (let k = 0; k < P.length; k++) {
    const ph = P[k];
    const z = zones[ph.z];
    const a = info[ph.i0], b = info[ph.i1];
    const pA = dense[ph.i0].p, pB = dense[ph.i1].p;
    // judge "which end leads" on the level, unless it is mostly a vertical move
    const dir = [pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]];
    const hl = Math.hypot(dir[0], dir[2]);
    if (hl > 0.4 * Math.abs(dir[1])) dir[1] = 0;
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    dir[0] /= dl; dir[1] /= dl; dir[2] /= dl;
    const mid = Math.floor((ph.i0 + ph.i1) / 2);
    const midPost = info[mid].post;
    const lead = dl > 15 ? leading(item, midPost.m, dir) : null;
    let yaw = 0;
    for (let i = ph.i0 + 1; i <= ph.i1; i++) {
      if (info[i].tele) continue;
      const q0 = dense[i - 1].p.slice(3), q1 = dense[i].p.slice(3);
      yaw += yawDelta(q0, q1);
    }
    const yawDeg = (yaw * 180) / Math.PI;
    const turn = Math.abs(yawDeg) > 35 ? (yawDeg > 0 ? 'left' : 'right') : null;
    const turnAmount = Math.abs(yawDeg) > 135 ? 'half a turn' : Math.abs(yawDeg) > 60 ? 'a quarter turn' : 'a little';
    let gap = Infinity, gapAt = ph.i0;
    if (vals) for (let i = ph.i0; i <= ph.i1; i++) if (vals[i] < gap) { gap = vals[i]; gapAt = i; }
    const postB = postureText(item, b.post);
    const postA = postureText(item, a.post);
    const postureChanged = k > 0 && info[P[k - 1].i1].post.code !== b.post.code;

    let title, detail, icon = z.kind;
    const where = theZone(z.label);
    if (ph.tele) {
      title = 'Ride the lift up';
      detail = `Keep it ${postA.short} while the doors close.`;
      icon = 'lift';
    } else if (k === 0) {
      title = z.kind === 'outside' ? 'Start outside' : `Start in ${where}`;
      detail = `It starts ${postA.short}.`;
      icon = 'start';
    } else if (postureChanged) {
      title = verbFor(item, b.post);
      detail = `Now ${postB.long}${lead ? `, ${lead} first` : ''}.`;
      if (z.kind === 'door') title += ` in ${where}`;
      else if (z.kind === 'stairs') title += ' on the stairs';
      else if (z.kind === 'landing') title += ' on the landing';
      else if (z.kind === 'lift') title += ' inside the lift';
      icon = 'rotate';
    } else if (z.kind === 'door') {
      title = `Through ${where}${lead ? `, ${lead} first` : ''}`;
      detail = turn ? `Swing it ${turn} around the frame as it goes through (${turnAmount}).` : `Keep it ${postB.short} and go straight through.`;
    } else if (z.kind === 'stairs') {
      const up = z.label.toLowerCase().includes('up');
      title = `${up ? 'Up' : 'Down'} the stairs${lead ? `, ${lead} first` : ''}`;
      const lean = midPost.tilt > 15 ? ` tilted about ${Math.round(midPost.tilt / 5) * 5}°` : '';
      detail = `Carry it ${postB.short}${lean}${turn ? `, turning it ${turn} as you climb` : ''}.`;
    } else if (z.kind === 'landing') {
      title = turn ? `Turn it ${turn} on the landing` : 'Across the landing';
      detail = `Keep it ${postB.short}${turn ? ` — ${turnAmount} ${turn}` : ''}.`;
    } else if (z.kind === 'lift') {
      title = k === P.length - 1 ? 'Into the lift' : info[ph.i0].z === info[ph.i1].z && k > 0 && P[k - 1].tele ? 'Out of the lift' : 'Into the lift';
      detail = `${lead ? `${cap(lead)} first, ` : ''}${postB.short}${turn ? `, turning it ${turn}` : ''}.`;
    } else if (z.kind === 'room' && k === P.length - 1) {
      title = `Into ${where}`;
      detail = b.post.code === '+y' ? 'Set it down — done.' : `Then ${verbFor(item, { code: '+y' }).toLowerCase()} and set it down.`;
      icon = 'done';
    } else if (turn) {
      title = `Pivot ${turn} in ${where}`;
      detail = `${cap(turnAmount)} ${turn}, keeping it ${postB.short}.`;
      icon = 'turn';
    } else {
      title = `Along ${where}${lead ? `, ${lead} first` : ''}`;
      detail = `Keep it ${postB.short}.`;
    }
    steps.push({
      i0: ph.i0, i1: ph.i1, zone: ph.z, title, detail, icon,
      gap: Number.isFinite(gap) ? gap : null, gapAt,
      posture: b.post.code, tele: ph.tele,
    });
  }

  // collapse consecutive near-identical "along" steps
  const out = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev && prev.title === s.title && prev.zone === s.zone) { prev.i1 = s.i1; prev.gap = minGap(prev.gap, s.gap); continue; }
    out.push(s);
  }
  // mark the tightest step
  let tight = null;
  for (const s of out) if (s.gap !== null && (!tight || s.gap < tight.gap)) tight = s;
  if (tight) tight.tightest = true;
  const moves = out.filter((s) => s.icon === 'rotate' || /Swing|Pivot|Turn/.test(s.title + s.detail)).length;
  return {
    steps: out,
    summary: {
      steps: out.length,
      moves,
      length: dense[n - 1].d,
      tightest: tight ? { gap: tight.gap, zone: zones[tight.zone].label, step: out.indexOf(tight) } : null,
    },
  };
}

/** "the hallway", but "door 2" / "hallway 2" without an article. */
export function theZone(label) {
  const l = label.toLowerCase();
  if (/\d$/.test(l) || l.startsWith('the ')) return l;
  return `the ${l}`;
}

function minGap(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function verbFor(item, post) {
  const N = names(item);
  const down = N[flip(post.code)];
  if (post.code === '+y' || (post.code === '-y' && item.parts.length === 1)) return 'Tip it back upright';
  if (post.code === '-y') return 'Turn it upside down';
  if (post.code === '+x' || post.code === '-x') return `Stand it on its ${down}`;
  if (post.code === '+z') return `Lay it on its ${N['-z']}`;
  return `Lay it on its ${N['+z']}`;
}
