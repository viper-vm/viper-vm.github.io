// ============================================================
//  Roulette logic (pure) — American double-zero wheel.
//  1 float → pocket index into the real wheel sequence.
// ============================================================

export const WHEEL = ['0', '28', '9', '26', '30', '11', '7', '20', '32', '17', '5', '22', '34', '15', '3', '24', '36',
  '13', '1', '00', '27', '10', '25', '29', '12', '8', '19', '31', '18', '6', '21', '33', '16', '4', '23', '35', '14', '2'];
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const isRed = (n) => RED.has(n);

export function betWins(key, win) {
  const n = win === '0' || win === '00' ? -1 : Number(win);
  if (key.startsWith('straight:')) return key.slice(9) === win;
  if (n < 0) return false;
  switch (key) {
    case 'red': return isRed(n);
    case 'black': return !isRed(n);
    case 'odd': return n % 2 === 1;
    case 'even': return n % 2 === 0;
    case 'low': return n >= 1 && n <= 18;
    case 'high': return n >= 19 && n <= 36;
    case 'dozen:1': return n <= 12;
    case 'dozen:2': return n >= 13 && n <= 24;
    case 'dozen:3': return n >= 25;
    case 'col:1': return n % 3 === 1;
    case 'col:2': return n % 3 === 2;
    case 'col:3': return n % 3 === 0;
    default: return false;
  }
}

export function payMultiple(key) {
  if (key.startsWith('straight:')) return 36;      // 35:1
  if (key.startsWith('dozen:') || key.startsWith('col:')) return 3; // 2:1
  return 2;                                         // 1:1
}

export const logic = {
  floatsNeeded: () => 1,
  resolve(floats, params) {
    const bets = params.bets || [];
    const totalWager = bets.reduce((s, b) => s + b.amount, 0);
    const idx = Math.floor(floats[0] * WHEEL.length);
    const win = WHEEL[idx];
    let payout = 0;
    for (const b of bets) if (betWins(b.key, win)) payout += b.amount * payMultiple(b.key);
    return {
      won: payout > totalWager,
      multiplier: totalWager > 0 ? payout / totalWager : 0,
      payout,
      detail: `Landed ${win}`,
      meta: { win, idx, totalWager },
    };
  },
  strategy: {
    controls: [{ key: 'pick', label: 'Bet on', type: 'select', default: 'red',
      options: [{ value: 'red', label: 'Red' }, { value: 'black', label: 'Black' },
        { value: 'odd', label: 'Odd' }, { value: 'even', label: 'Even' }] }],
    defaults: () => ({ pick: 'red' }),
    buildParams: (sp, wager) => ({ bets: [{ key: sp.pick || 'red', amount: wager }] }),
  },
};
