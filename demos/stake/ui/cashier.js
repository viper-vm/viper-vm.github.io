// ============================================================
//  Cashier — manage the fake bankroll: deposit, withdraw, set the
//  starting balance, reset, and review the ledger. All money is
//  fake; this simply models real bankroll management so ROI can
//  be measured against net deposited.
// ============================================================

import { openModal } from './modal.js';
import { h, icon, clear, statCard, refreshIcons } from './components.js';
import { money, signedMoney, signedPct, timeAgo } from '../core/format.js';

const LEDGER_ICON = { deposit: 'arrow-down-to-line', withdraw: 'arrow-up-from-line', reset: 'rotate-ccw', initial: 'flag' };

export function openCashier(env) {
  const summary = h('div.sk-cashier-summary', {});
  const ledgerBox = h('div.sk-ledger', {});

  const depositInput = amountInput();
  const withdrawInput = amountInput();
  const startInput = h('input.sk-num', { type: 'number', step: 'any', value: env.wallet.startingBalance });

  const body = h('div.sk-cashier', {}, [
    summary,
    h('div.sk-cashier-actions', {}, [
      row('Deposit funds', depositInput, 'Deposit', 'deposit', async (v) => {
        const r = await env.wallet.deposit(v);
        if (!r.ok) env.bus.emit('toast', { message: r.error, tone: 'warn' });
        else { env.bus.emit('toast', { message: `Deposited ${money(v)}`, tone: 'success' }); depositInput.value = ''; }
        paint();
      }),
      row('Withdraw funds', withdrawInput, 'Withdraw', 'withdraw', async (v) => {
        const r = await env.wallet.withdraw(v);
        if (!r.ok) env.bus.emit('toast', { message: r.error, tone: 'warn' });
        else { env.bus.emit('toast', { message: `Withdrew ${money(v)}`, tone: 'info' }); withdrawInput.value = ''; }
        paint();
      }),
    ]),
    h('div.sk-cashier-config', {}, [
      h('div.sk-field', {}, [h('label.sk-label', {}, 'Starting balance (used on reset)'), startInput]),
      h('div.sk-cashier-config-btns', {}, [
        h('button.sk-chip-btn', { onclick: async () => { await env.wallet.setStartingBalance(startInput.value); env.bus.emit('toast', { message: 'Starting balance saved', tone: 'success' }); } }, 'Save'),
        h('button.sk-chip-btn.danger', { onclick: async () => {
          await env.wallet.setStartingBalance(startInput.value);
          await env.wallet.reset();
          env.bus.emit('toast', { message: 'Bankroll reset', tone: 'info' });
          paint();
        } }, [icon('rotate-ccw'), 'Reset bankroll']),
      ]),
    ]),
    h('div.sk-ledger-wrap', {}, [h('h3', {}, 'Ledger'), ledgerBox]),
  ]);

  const { close } = openModal({ title: 'Cashier', icon: 'wallet', body, width: '560px' });

  function paint() {
    const st = env.wallet.state();
    clear(summary);
    summary.append(
      statCard('Balance', money(st.balance), { tone: 'accent' }),
      statCard('Net deposited', money(st.netDeposited)),
      statCard('Net P/L', signedMoney(st.netProfit), { tone: st.netProfit >= 0 ? 'up' : 'down', sub: signedPct(st.roi) + ' ROI' }),
    );
    clear(ledgerBox);
    const entries = [...env.wallet.ledger].reverse().slice(0, 30);
    const now = Date.now();
    if (!entries.length) ledgerBox.append(h('div.sk-ledger-empty', {}, 'No transactions yet.'));
    for (const e of entries) {
      const sign = e.type === 'withdraw' ? -1 : 1;
      ledgerBox.append(h('div.sk-ledger-row', {}, [
        h('div.sk-ledger-icon.' + e.type, {}, [icon(LEDGER_ICON[e.type] || 'circle')]),
        h('div.sk-ledger-main', {}, [
          h('span.sk-ledger-type', {}, e.type),
          h('span.sk-ledger-time', {}, timeAgo(e.ts, now)),
        ]),
        h('div.sk-ledger-amt', {}, e.type === 'reset' || e.type === 'initial' ? money(e.amount) : signedMoney(sign * e.amount)),
        h('div.sk-ledger-bal', {}, money(e.balanceAfter)),
      ]));
    }
    refreshIcons();
  }
  paint();

  function amountInput() {
    return h('input.sk-num', { type: 'number', step: 'any', min: 0, placeholder: '0.00' });
  }
  function row(label, input, btnLabel, kind, onClick) {
    return h('div.sk-cashier-row', {}, [
      h('div.sk-field', {}, [h('label.sk-label', {}, label), input]),
      h('button.sk-action-btn.' + kind, { type: 'button', onclick: () => onClick(Number(input.value) || 0) }, btnLabel),
    ]);
  }
}
