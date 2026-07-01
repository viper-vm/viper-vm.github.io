// ============================================================
//  Plinko logic — drop a ball through `rows` of pegs; each peg is a
//  fair coin flip. Lands in slot = number of right-bounces (0..rows).
//  Slot multipliers are generated symmetric (bigger at the edges)
//  and scaled to (1 − edge) RTP against the binomial distribution.
// ============================================================

export const EDGE = 0.01;
export const ROW_OPTIONS = [8, 12, 16];
export const RISKS = ['low', 'medium', 'high'];

const SPEC = {
  low: { hi: 5, lo: 0.7, pow: 2.2 },
  medium: { hi: 22, lo: 0.4, pow: 2.7 },
  high: { hi: 220, lo: 0.2, pow: 3.6 },
};

function binom(rows, i) {
  // C(rows,i)/2^rows
  let c = 1;
  for (let k = 0; k < i; k++) c = (c * (rows - k)) / (k + 1);
  return c / Math.pow(2, rows);
}

const cache = new Map();
export function buildTable(rows, risk) {
  const key = rows + ':' + risk;
  if (cache.has(key)) return cache.get(key);
  const spec = SPEC[risk] || SPEC.medium;
  const raw = [];
  for (let i = 0; i <= rows; i++) {
    const d = Math.abs(i - rows / 2) / (rows / 2);
    raw.push(spec.lo + (spec.hi - spec.lo) * Math.pow(d, spec.pow));
  }
  let ev = 0;
  for (let i = 0; i <= rows; i++) ev += binom(rows, i) * raw[i];
  const k = ev > 0 ? (1 - EDGE) / ev : 0;
  const table = raw.map((r) => {
    const v = r * k;
    return Math.round(v * (v < 10 ? 100 : 10)) / (v < 10 ? 100 : 10);
  });
  cache.set(key, table);
  return table;
}

export const logic = {
  floatsNeeded: (params) => (params && params.rows) || 16,
  resolve(floats, params) {
    const rows = params.rows || 16;
    const risk = params.risk || 'medium';
    const path = [];
    let rights = 0;
    for (let r = 0; r < rows; r++) {
      const right = (floats[r] ?? Math.random()) >= 0.5;
      if (right) rights++;
      path.push(right ? 'R' : 'L');
    }
    const table = buildTable(rows, risk);
    const m = table[rights];
    return {
      won: m > 1,
      multiplier: m,
      detail: `slot ${rights} · ${m}×`,
      meta: { slot: rights, path, table, rows, risk },
    };
  },
  strategy: {
    controls: [
      { key: 'rows', label: 'Rows', type: 'select', default: 16, options: ROW_OPTIONS.map((r) => ({ value: r, label: String(r) })) },
      { key: 'risk', label: 'Risk', type: 'select', default: 'medium', options: RISKS.map((r) => ({ value: r, label: r })) },
    ],
    defaults: () => ({ rows: 16, risk: 'medium' }),
  },
};
