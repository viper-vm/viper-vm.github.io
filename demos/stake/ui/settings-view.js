// ============================================================
//  Settings — bankroll limits, data management, disclaimer.
// ============================================================

import { h, icon, statCard } from './components.js';
import { money, int } from '../core/format.js';

export function renderSettings(env) {
  const startInput = h('input.sk-num', { type: 'number', step: 'any', value: env.wallet.startingBalance });
  const minInput = h('input.sk-num', { type: 'number', step: 'any', value: env.wallet.minBet });
  const maxInput = h('input.sk-num', { type: 'number', step: 'any', value: env.wallet.maxBet });

  return h('div.sk-view.sk-settings', {}, [
    h('div.sk-view-head', {}, [h('h1', {}, 'Settings'), h('p', {}, 'Everything here is local to your browser.')]),

    section('Bankroll', [
      h('div.sk-field-grid', {}, [
        wrap('Starting balance', startInput),
        wrap('Minimum bet', minInput),
        wrap('Maximum bet', maxInput),
      ]),
      h('button.sk-action-btn', { onclick: async () => {
        await env.wallet.setStartingBalance(startInput.value);
        env.wallet.minBet = Math.max(0.01, Number(minInput.value) || 0.1);
        env.wallet.maxBet = Math.max(env.wallet.minBet, Number(maxInput.value) || 1000000);
        env.wallet._persist();
        env.bus.emit('toast', { message: 'Settings saved', tone: 'success' });
      } }, 'Save bankroll settings'),
    ]),

    section('Data', [
      h('div.sk-settings-stats', {}, [
        statCard('Bets stored', int(env.analytics.bets.length)),
        statCard('Total wagered', money(env.wallet.state().totalWagered)),
      ]),
      h('div.sk-inline', {}, [
        h('button.sk-chip-btn.danger', { onclick: async () => {
          if (!confirm('Clear all bet history? Your balance stays; analytics resets.')) return;
          await env.analytics.clear();
          env.bus.emit('toast', { message: 'Bet history cleared', tone: 'info' });
          env.router.go('/settings');
        } }, [icon('trash-2'), 'Clear bet history']),
        h('button.sk-chip-btn.danger', { onclick: () => {
          if (!confirm('Full reset: wipe balance, history and seeds, then reload?')) return;
          Object.keys(localStorage).filter((k) => k.startsWith('stake:')).forEach((k) => localStorage.removeItem(k));
          env.analytics.clear().finally(() => location.reload());
        } }, [icon('rotate-ccw'), 'Reset everything']),
      ]),
    ]),

    section('About', [
      h('p.sk-disclaimer', {}, [icon('info'),
        ' This is a free, offline simulator built for entertainment and to study betting math. No real money is involved and nothing is redeemable. Gambling with real money carries real risk — please play responsibly.']),
    ]),
  ]);

  function section(title, children) {
    return h('section.sk-settings-section', {}, [h('h2', {}, title), ...children]);
  }
  function wrap(label, input) { return h('div.sk-field', {}, [h('label.sk-label', {}, label), input]); }
}
