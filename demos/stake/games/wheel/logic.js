// ============================================================
//  Wheel logic — a ring of multiplier segments. 1 float → segment.
//  Multipliers are generated per (segments, risk) and scaled so the
//  expected return is exactly (1 − edge) — provably fair, tunable.
// ============================================================

export const EDGE = 0.02;
export const SEG_OPTIONS = [10, 20, 30, 40, 50];
export const RISKS = ['low', 'medium', 'high'];

const SPEC = {
  low: { hi: 2, zeros: 0.10, pow: 1.6 },
  medium: { hi: 8, zeros: 0.40, pow: 2.2 },
  high: { hi: 60, zeros: 0.66, pow: 3.4 },
};

// Build the multiplier ring (length = segments). Zeros are losses;
// remaining slots rise from ~1 to `hi`, scaled to hit the RTP.
export function buildRing(segments, risk) {
  const spec = SPEC[risk] || SPEC.medium;
  const nZero = Math.min(segments - 1, Math.round(segments * spec.zeros));
  const nWin = segments - nZero;
  const raw = [];
  for (let j = 0; j < nWin; j++) {
    const t = nWin > 1 ? j / (nWin - 1) : 0;
    raw.push(1 + (spec.hi - 1) * Math.pow(t, spec.pow));
  }
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const k = ((1 - EDGE) * segments) / sum;
  const wins = raw.map((r) => round2(r * k)).sort((a, b) => a - b);
  // Spread the win slots evenly around the ring; the rest stay 0.
  const ring = new Array(segments).fill(0);
  const step = segments / nWin;
  const used = new Set();
  for (let i = 0; i < nWin; i++) {
    let slot = Math.round(i * step) % segments;
    while (used.has(slot)) slot = (slot + 1) % segments;
    used.add(slot);
  }
  [...used].sort((a, b) => a - b).forEach((slot, i) => { ring[slot] = wins[i]; });
  return ring;
}

export const logic = {
  floatsNeeded: () => 1,
  resolve(floats, params) {
    const segments = params.segments || 30;
    const ring = params.ring || buildRing(segments, params.risk || 'medium');
    const idx = Math.floor(floats[0] * ring.length);
    const m = ring[idx] || 0;
    return {
      won: m > 1,
      multiplier: m,
      detail: `${m.toFixed(2)}×`,
      meta: { idx, mult: m, ring },
    };
  },
  strategy: {
    controls: [
      { key: 'segments', label: 'Segments', type: 'select', default: 30, options: SEG_OPTIONS.map((s) => ({ value: s, label: String(s) })) },
      { key: 'risk', label: 'Risk', type: 'select', default: 'medium', options: RISKS.map((r) => ({ value: r, label: r })) },
    ],
    defaults: () => ({ segments: 30, risk: 'medium' }),
  },
};

function round2(n) { return Math.round(n * 100) / 100; }
