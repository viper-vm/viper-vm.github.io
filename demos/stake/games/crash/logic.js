// ============================================================
//  Crash logic — a multiplier rises from 1.00× and busts at a
//  fair crash point. Cash out before it busts.
//  Fair: 1 float → crash = max(1, (1−edge)/(1−u)).
//  For strategy/backtest, `target` is the auto-cashout.
// ============================================================

export const EDGE = 0.01;
const CAP = 1000000;

export function crashFrom(u) {
  return Math.min(CAP, Math.max(1, (1 - EDGE) / (1 - u)));
}

export const logic = {
  floatsNeeded: () => 1,
  resolve(floats, params) {
    const target = Math.max(1.01, params.target || 2);
    const crash = crashFrom(floats[0]);
    const won = crash >= target;
    return {
      won,
      multiplier: won ? target : 0,
      detail: `Crashed ${crash.toFixed(2)}× · out ${target.toFixed(2)}×`,
      meta: { crash, target },
    };
  },
  strategy: {
    controls: [{ key: 'target', label: 'Auto cash-out ×', type: 'number', default: 2, min: 1.01, max: 1000, step: 0.01 }],
    defaults: () => ({ target: 2 }),
  },
};
