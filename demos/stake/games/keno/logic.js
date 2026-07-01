// ============================================================
//  Keno logic — 40 numbers, 10 drawn, pick up to 10.
//  Paytables are generated per pick-count from the exact
//  hypergeometric probabilities and scaled to (1 − edge) RTP.
// ============================================================

export const EDGE = 0.03;
export const POOL = 40;
export const DRAW = 10;
export const MAX_PICKS = 10;

function comb(n, r) {
  if (r < 0 || r > n) return 0;
  r = Math.min(r, n - r);
  let c = 1;
  for (let i = 0; i < r; i++) c = (c * (n - i)) / (i + 1);
  return c;
}
// P(hits = h | picked k)
function hyperProb(k, h) {
  return (comb(k, h) * comb(POOL - k, DRAW - h)) / comb(POOL, DRAW);
}

const tableCache = new Map();
export function paytable(k) {
  if (k <= 0) return [0];
  if (tableCache.has(k)) return tableCache.get(k);
  const thr = Math.max(1, Math.ceil(k * 0.55));
  const raw = [];
  for (let h = 0; h <= k; h++) raw.push(h >= thr ? Math.pow(h - thr + 1, 2.2) : 0);
  let ev = 0;
  for (let h = 0; h <= k; h++) ev += hyperProb(k, h) * raw[h];
  const scale = ev > 0 ? (1 - EDGE) / ev : 0;
  const t = raw.map((r) => Math.round(r * scale * 100) / 100);
  tableCache.set(k, t);
  return t;
}

export const logic = {
  floatsNeeded: () => POOL,
  resolve(floats, params) {
    const picks = params.picks || [];
    const k = picks.length;
    const arr = Array.from({ length: POOL }, (_, i) => i + 1);
    for (let i = POOL - 1; i > 0; i--) {
      const j = Math.floor((floats[POOL - 1 - i] ?? Math.random()) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const drawn = new Set(arr.slice(0, DRAW));
    const hits = picks.filter((p) => drawn.has(p)).length;
    const table = paytable(k);
    const m = k > 0 ? (table[hits] || 0) : 0;
    return {
      won: m > 1,
      multiplier: m,
      detail: `${hits}/${k} hits`,
      meta: { drawn: [...drawn], hits, k, table },
    };
  },
  strategy: {
    controls: [{ key: 'count', label: 'Auto-pick count', type: 'number', default: 5, min: 1, max: 10, step: 1 }],
    defaults: () => ({ count: 5, picks: [1, 2, 3, 4, 5] }),
    // strategy uses a fixed set of the first `count` numbers
    buildParams: (sp) => ({ picks: Array.from({ length: Math.max(1, Math.min(10, sp.count || 5)) }, (_, i) => i + 1) }),
  },
};
