// ============================================================
//  Wallet + Cashier
//  A single FAKE USD bankroll modeled like the real thing:
//    • configurable starting balance (default $10,000)
//    • deposit / withdraw fake funds (bankroll management)
//    • debit on bet placed, credit on payout
//    • every bankroll movement recorded in a cashier ledger
//
//  Derived quantities used by analytics:
//    netProfit  = totalWon - totalWagered   (== balance - netDeposited)
//    roi        = netProfit / netDeposited  (return on money put in)
//    margin     = netProfit / totalWagered  (edge realized on turnover)
// ============================================================

import { KV, betStore } from './store.js';

const DEFAULT_START = 10000;

export class Wallet {
  constructor(bus) {
    this.bus = bus;
    const s = KV.get('wallet', null);
    if (s) {
      this.balance = s.balance;
      this.startingBalance = s.startingBalance ?? DEFAULT_START;
      this.netDeposited = s.netDeposited ?? this.startingBalance;
      this.totalWagered = s.totalWagered ?? 0;
      this.totalWon = s.totalWon ?? 0;
      this.minBet = s.minBet ?? 0.1;
      this.maxBet = s.maxBet ?? 1000000;
      this._initialized = true;
    } else {
      this.startingBalance = DEFAULT_START;
      this.balance = DEFAULT_START;
      this.netDeposited = DEFAULT_START;
      this.totalWagered = 0;
      this.totalWon = 0;
      this.minBet = 0.1;
      this.maxBet = 1000000;
      this._initialized = false;
    }
    this.ledger = []; // in-memory mirror for display
  }

  async init() {
    const store = await betStore();
    this.ledger = await store.allLedger();
    // First-ever launch: record the opening balance as a deposit.
    if (!this._initialized) {
      this._initialized = true;
      await this._logLedger('initial', this.startingBalance);
      this._persist();
    }
    this._emit();
    return this;
  }

  _persist() {
    KV.set('wallet', {
      balance: this.balance,
      startingBalance: this.startingBalance,
      netDeposited: this.netDeposited,
      totalWagered: this.totalWagered,
      totalWon: this.totalWon,
      minBet: this.minBet,
      maxBet: this.maxBet,
    });
  }

  async _logLedger(type, amount) {
    const entry = { type, amount, balanceAfter: this.balance, ts: Date.now() };
    try {
      const store = await betStore();
      const id = await store.addLedger(entry);
      entry.id = id;
    } catch (_) {}
    this.ledger.push(entry);
    this.bus?.emit('cashier:changed', { entry, state: this.state() });
    return entry;
  }

  _emit() {
    this.bus?.emit('wallet:changed', this.state());
  }

  state() {
    const netProfit = this.balance - this.netDeposited;
    return {
      balance: this.balance,
      startingBalance: this.startingBalance,
      netDeposited: this.netDeposited,
      totalWagered: this.totalWagered,
      totalWon: this.totalWon,
      netProfit,
      roi: this.netDeposited > 0 ? netProfit / this.netDeposited : 0,
      margin: this.totalWagered > 0 ? netProfit / this.totalWagered : 0,
      minBet: this.minBet,
      maxBet: this.maxBet,
    };
  }

  canAfford(amount) {
    return amount > 0 && amount <= this.balance + 1e-9;
  }

  validateBet(amount) {
    if (!(amount > 0)) return 'Enter a bet amount';
    if (amount < this.minBet) return `Minimum bet is $${this.minBet}`;
    if (amount > this.maxBet) return `Maximum bet is $${this.maxBet}`;
    if (!this.canAfford(amount)) return 'Insufficient balance';
    return null;
  }

  // ---- betting movements ----
  debit(amount) {
    if (!this.canAfford(amount)) return false;
    this.balance -= amount;
    this.totalWagered += amount;
    this._persist();
    this._emit();
    return true;
  }

  credit(amount) {
    if (amount <= 0) {
      this._emit();
      return;
    }
    this.balance += amount;
    this.totalWon += amount;
    this._persist();
    this._emit();
  }

  // ---- cashier movements ----
  async deposit(amount) {
    amount = Number(amount);
    if (!(amount > 0)) return { ok: false, error: 'Enter an amount to deposit' };
    this.balance += amount;
    this.netDeposited += amount;
    this._persist();
    await this._logLedger('deposit', amount);
    this._emit();
    return { ok: true };
  }

  async withdraw(amount) {
    amount = Number(amount);
    if (!(amount > 0)) return { ok: false, error: 'Enter an amount to withdraw' };
    if (amount > this.balance + 1e-9) return { ok: false, error: 'Amount exceeds balance' };
    this.balance -= amount;
    this.netDeposited -= amount;
    this._persist();
    await this._logLedger('withdraw', amount);
    this._emit();
    return { ok: true };
  }

  async setStartingBalance(amount) {
    amount = Number(amount);
    if (!(amount >= 0)) return { ok: false, error: 'Invalid amount' };
    this.startingBalance = amount;
    this._persist();
    this._emit();
    return { ok: true };
  }

  // Reset bankroll to the configured starting balance. Does NOT
  // wipe bet history (that's a separate action in Settings).
  async reset() {
    this.balance = this.startingBalance;
    this.netDeposited = this.startingBalance;
    this.totalWagered = 0;
    this.totalWon = 0;
    this._persist();
    await this._logLedger('reset', this.startingBalance);
    this._emit();
    return { ok: true };
  }
}
