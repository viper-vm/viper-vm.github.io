// ============================================================
//  AnalyticsEngine
//  Source of truth = the IndexedDB bet history. On boot we load it
//  all into memory; every new bet:settled is appended. All P&L
//  views are computed on demand from that array so the dashboard
//  can slice it any way: global, per-game, last-N rounds, recent
//  form, session/today/all-time, and cross-game comparison.
// ============================================================

import { betStore } from './store.js';

export function summarize(bets) {
  let wagered = 0, won = 0, net = 0, wins = 0;
  let biggestWin = 0, biggestMult = 0;
  let curW = 0, curL = 0, maxW = 0, maxL = 0;
  for (const b of bets) {
    wagered += b.wager; won += b.payout; net += b.profit;
    if (b.won) { wins++; curW++; curL = 0; if (curW > maxW) maxW = curW; }
    else { curL++; curW = 0; if (curL > maxL) maxL = curL; }
    if (b.profit > biggestWin) biggestWin = b.profit;
    if (b.multiplier > biggestMult) biggestMult = b.multiplier;
  }
  const count = bets.length;
  return {
    count, wagered, won, net,
    rtp: wagered > 0 ? won / wagered : 0,
    margin: wagered > 0 ? net / wagered : 0,
    winRate: count > 0 ? wins / count : 0,
    avgBet: count > 0 ? wagered / count : 0,
    wins, losses: count - wins,
    biggestWin, biggestMult,
    longestWin: maxW, longestLoss: maxL,
  };
}

// Cumulative net profit points for an equity curve.
export function equityCurve(bets) {
  let cum = 0;
  const pts = [0];
  for (const b of bets) { cum += b.profit; pts.push(cum); }
  return pts;
}

export class AnalyticsEngine {
  constructor(bus) {
    this.bus = bus;
    this.bets = [];
    this.sessionStart = Date.now();
  }

  async init() {
    const store = await betStore();
    this.bets = (await store.allBets()).sort((a, b) => a.ts - b.ts);
    this.bus.on('bet:settled', (rec) => {
      this.bets.push(rec);
      this.bus.emit('analytics:updated', { bet: rec });
    });
    return this;
  }

  // ---- scoping ----
  _scoped(scope) {
    if (scope === 'session') return this.bets.filter((b) => b.ts >= this.sessionStart);
    if (scope === 'today') {
      const d = new Date(); d.setHours(0, 0, 0, 0);
      const start = d.getTime();
      return this.bets.filter((b) => b.ts >= start);
    }
    return this.bets;
  }

  filtered({ scope = 'all', game = null } = {}) {
    let arr = this._scoped(scope);
    if (game) arr = arr.filter((b) => b.game === game);
    return arr;
  }

  // ---- headline stats ----
  global(scope = 'all') { return summarize(this._scoped(scope)); }
  perGame(game, scope = 'all') { return summarize(this.filtered({ scope, game })); }

  // one summary row per game that has bets
  byGame(scope = 'all') {
    const arr = this._scoped(scope);
    const groups = new Map();
    for (const b of arr) {
      if (!groups.has(b.game)) groups.set(b.game, []);
      groups.get(b.game).push(b);
    }
    const out = [];
    for (const [game, bets] of groups) out.push({ game, ...summarize(bets) });
    return out.sort((a, b) => b.count - a.count);
  }

  // ---- windows ----
  lastN(n, { game = null } = {}) {
    let arr = this.bets;
    if (game) arr = arr.filter((b) => b.game === game);
    return arr.slice(-n);
  }
  windowStats(n, { game = null } = {}) {
    const arr = this.lastN(n, { game });
    return { ...summarize(arr), curve: equityCurve(arr), bets: arr };
  }

  equity({ scope = 'all', game = null } = {}) {
    return equityCurve(this.filtered({ scope, game }));
  }

  hasData() { return this.bets.length > 0; }

  async clear() {
    const store = await betStore();
    await store.clearAll();
    this.bets = [];
    this.sessionStart = Date.now();
    this.bus.emit('analytics:updated', { cleared: true });
  }
}
