// ============================================================
//  Strategy engine
//   • Progressions: Flat, Martingale, Paroli (anti-martingale),
//     D'Alembert, Fibonacci, and a fully custom on-win/on-loss rule.
//   • AutoBet: drives ANY game's single-bet function on a loop with
//     progression + stop conditions (profit/loss target, max bets,
//     streaks). Feeds the real wallet + analytics.
//   • backtest(): fast headless "what-if" — simulates N bets with a
//     seeded PRNG against a game's pure logic.resolve, WITHOUT
//     touching the wallet or history. Returns the projected curve
//     and outcome distribution.
// ============================================================

export const PRESETS = {
  flat: { label: 'Flat repeat', desc: 'Always bet the base amount.' },
  martingale: { label: 'Martingale', desc: 'Double after every loss, reset on a win.' },
  reverse: { label: 'Reverse Martingale', desc: 'Double after a win, reset after a loss.' },
  paroli: { label: 'Paroli', desc: 'Double after each win, up to 3 in a row, then reset.' },
  dalembert: { label: "D'Alembert", desc: 'Increase 1 unit after a loss, decrease 1 unit after a win.' },
  fibonacci: { label: 'Fibonacci', desc: 'Walk the Fibonacci sequence up on loss, back two on win.' },
  custom: { label: 'Custom', desc: 'Your own rules on win / on loss.' },
};

// Build a progression object: { current(), apply(won) -> nextBet, reset() }.
export function makeProgression(preset, base, custom = {}) {
  base = Math.max(0, Number(base) || 0);
  const clamp = (b) => Math.max(0, b);

  if (preset === 'martingale') return simple(base, { onLoss: ['multiply', 2], onWin: ['reset'] });
  if (preset === 'reverse' || preset === 'antimartingale') return simple(base, { onWin: ['multiply', 2], onLoss: ['reset'] });
  if (preset === 'paroli') return paroli(base, 3);
  if (preset === 'dalembert') return simple(base, { onLoss: ['unit', base], onWin: ['unit', -base] });
  if (preset === 'fibonacci') return fibonacci(base);
  if (preset === 'custom') return simple(base, {
    onWin: ruleToOp(custom.onWin),
    onLoss: ruleToOp(custom.onLoss),
  });
  // flat / default
  return simple(base, { onWin: ['reset'], onLoss: ['reset'] });

  function simple(baseBet, rules) {
    let bet = baseBet;
    const applyOp = (op) => {
      if (!op) return bet;
      const [kind, val] = op;
      if (kind === 'reset') return baseBet;
      if (kind === 'multiply') return bet * val;
      if (kind === 'unit') return clamp(bet + val);
      if (kind === 'increase') return bet * (1 + val / 100);
      if (kind === 'decrease') return bet * (1 - val / 100);
      return bet;
    };
    return {
      current: () => bet,
      apply(won) { bet = clamp(applyOp(won ? rules.onWin : rules.onLoss)); return bet; },
      reset() { bet = baseBet; },
    };
  }

  function paroli(baseBet, cap) {
    let bet = baseBet; let streak = 0;
    return {
      current: () => bet,
      apply(won) {
        if (won) { streak += 1; bet = streak >= cap ? (streak = 0, baseBet) : bet * 2; }
        else { streak = 0; bet = baseBet; }
        return bet;
      },
      reset() { bet = baseBet; streak = 0; },
    };
  }

  function fibonacci(baseBet) {
    let idx = 0;
    const seq = [1, 1];
    const at = (i) => {
      while (seq.length <= i) seq.push(seq[seq.length - 1] + seq[seq.length - 2]);
      return seq[i];
    };
    return {
      current: () => baseBet * at(idx),
      apply(won) {
        idx = won ? Math.max(0, idx - 2) : idx + 1;
        return baseBet * at(idx);
      },
      reset() { idx = 0; },
    };
  }

  function ruleToOp(rule) {
    if (!rule || rule.mode === 'reset') return ['reset'];
    const v = Number(rule.value) || 0;
    if (rule.mode === 'multiply') return ['multiply', v || 1];
    if (rule.mode === 'increase') return ['increase', v];
    if (rule.mode === 'decrease') return ['decrease', v];
    return ['reset'];
  }
}

// ---------- AutoBet loop ----------
export class AutoBet {
  constructor({ betFn, settings, onTick, onStateChange }) {
    this.betFn = betFn;              // async (wager) => { won, profit, multiplier, record }
    this.settings = settings;       // see start()
    this.onTick = onTick || (() => {});
    this.onStateChange = onStateChange || (() => {});
    this.running = false;
    this._cancel = false;
    this.count = 0;
    this.profit = 0;
    this.winStreak = 0;
    this.lossStreak = 0;
  }

  async start() {
    if (this.running) return;
    const s = this.settings;
    const prog = makeProgression(s.preset, s.baseBet, s.custom);
    this.running = true;
    this._cancel = false;
    this.count = 0;
    this.profit = 0;
    this.winStreak = 0;
    this.lossStreak = 0;
    this.onStateChange({ running: true });

    while (!this._cancel) {
      if (s.alive && !s.alive()) { this._stop('left game'); break; } // stop if the view was torn down
      let wager = round2(prog.current());
      if (s.cap > 0) wager = Math.min(wager, s.cap);
      const res = await this.betFn(wager);
      if (!res || res.error) { this._stop('error', res && res.error); break; }

      this.count += 1;
      this.profit += res.profit;
      if (res.won) { this.winStreak += 1; this.lossStreak = 0; }
      else { this.lossStreak += 1; this.winStreak = 0; }

      this.onTick({
        count: this.count, profit: this.profit, wager,
        won: res.won, multiplier: res.multiplier, record: res.record,
      });

      const stop = this._checkStop(s);
      if (stop) { this._stop(stop); break; }

      prog.apply(res.won);
      if (s.delayMs) await sleep(s.delayMs);
      else await sleep(0); // yield so UI stays responsive
    }
    if (!this._cancel) return; // stopped via _stop already
  }

  _checkStop(s) {
    if (s.numBets > 0 && this.count >= s.numBets) return 'bet count reached';
    if (s.stopProfit > 0 && this.profit >= s.stopProfit) return 'profit target hit';
    if (s.stopLoss > 0 && -this.profit >= s.stopLoss) return 'loss limit hit';
    if (s.stopWinStreak > 0 && this.winStreak >= s.stopWinStreak) return 'win streak reached';
    if (s.stopLossStreak > 0 && this.lossStreak >= s.stopLossStreak) return 'loss streak reached';
    return null;
  }

  _stop(reason, error) {
    this.running = false;
    this._cancel = true;
    this.onStateChange({ running: false, reason, error, count: this.count, profit: this.profit });
  }

  stop() {
    if (!this.running) return;
    this._stop('stopped');
  }
}

// ---------- Backtest (headless, seeded, no wallet impact) ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Map a game's strategy params + the round's wager into resolve()
// params. Most games are wager-independent; Roulette needs the
// wager baked into its bet amount.
export function buildParams(def, sp, wager) {
  const s = def.logic.strategy;
  if (s && typeof s.buildParams === 'function') return s.buildParams(sp, wager);
  return sp;
}

// def: game definition; sp: strategy params; settings: strategy settings.
export function backtest(def, sp, settings, { rounds = 1000, startBalance = 1000, seed = 12345 } = {}) {
  const rand = mulberry32(seed);
  const prog = makeProgression(settings.preset, settings.baseBet, settings.custom);

  let balance = startBalance;
  let peak = startBalance;
  let maxDrawdown = 0;
  let wins = 0, losses = 0, wagered = 0, returned = 0, busts = 0;
  let winStreak = 0, lossStreak = 0, maxWin = 0, maxLoss = 0;
  const curve = [startBalance];

  for (let i = 0; i < rounds; i++) {
    let wager = round2(prog.current());
    if (settings.cap > 0) wager = Math.min(wager, settings.cap);
    if (wager <= 0) wager = settings.baseBet;
    if (wager > balance) { busts += 1; break; } // can't cover the bet → ruin

    const params = buildParams(def, sp, wager);
    const need = def.logic.floatsNeeded(params);
    const floats = Array.from({ length: need }, () => rand());
    const r = def.logic.resolve(floats, params);
    const payout = r.payout != null ? r.payout : wager * r.multiplier;
    const profit = payout - wager;

    balance += profit;
    wagered += wager;
    returned += payout;
    if (r.won) { wins++; winStreak++; lossStreak = 0; } else { losses++; lossStreak++; winStreak = 0; }
    maxWin = Math.max(maxWin, winStreak);
    maxLoss = Math.max(maxLoss, lossStreak);
    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak - balance);
    curve.push(balance);

    prog.apply(r.won);

    // stop conditions mapped onto backtest net profit
    const net = balance - startBalance;
    if (settings.stopProfit > 0 && net >= settings.stopProfit) break;
    if (settings.stopLoss > 0 && -net >= settings.stopLoss) break;
  }

  const net = balance - startBalance;
  return {
    rounds: curve.length - 1,
    startBalance, endBalance: balance, net,
    roi: startBalance > 0 ? net / startBalance : 0,
    wins, losses, busts,
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    wagered, returned,
    rtp: wagered > 0 ? returned / wagered : 0,
    maxDrawdown, maxWinStreak: maxWin, maxLossStreak: maxLoss,
    curve,
  };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
