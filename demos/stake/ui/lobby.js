// ============================================================
//  Lobby — game grid built entirely from the registry, plus a
//  bankroll snapshot. Adding a game makes a card appear here for
//  free.
// ============================================================

import { registry } from '../core/registry.js';
import { h, icon, statCard } from './components.js';
import { money, signedMoney, int } from '../core/format.js';

export function renderLobby(env) {
  const g = env.analytics.global('all');
  const wallet = env.wallet.state();

  const snapshot = h('div.sk-lobby-snapshot', {}, [
    statCard('Balance', money(wallet.balance), { tone: 'accent' }),
    statCard('All-time P/L', signedMoney(wallet.netProfit), { tone: wallet.netProfit >= 0 ? 'up' : 'down' }),
    statCard('Bets placed', int(g.count)),
    statCard('Total wagered', money(g.wagered)),
  ]);

  const cards = registry.all().map((def) => {
    const stat = env.analytics.perGame(def.id, 'all');
    const card = h('button.sk-game-card', {
      type: 'button',
      style: { '--card-accent': def.accent || 'var(--sk-accent)' },
      onclick: () => env.router.go('/play/' + def.id),
    }, [
      h('div.sk-game-card-icon', {}, [icon(def.icon || 'gamepad-2')]),
      h('div.sk-game-card-body', {}, [
        h('div.sk-game-card-cat', {}, def.category || 'Game'),
        h('h3', {}, def.name),
        h('p', {}, def.tagline || ''),
      ]),
      h('div.sk-game-card-foot', {}, [
        h('span', {}, stat.count ? `${int(stat.count)} bets · ${signedMoney(stat.net)}` : 'Not played yet'),
        h('span.sk-game-card-play', {}, [icon('play'), 'Play']),
      ]),
    ]);
    return card;
  });

  return h('div.sk-lobby', {}, [
    h('div.sk-lobby-hero', {}, [
      h('div', {}, [
        h('h1', {}, 'The House'),
        h('p', {}, 'A provably-fair casino simulator. Every bet is fake money — play, test strategies and study the math with zero risk.'),
      ]),
      h('div.sk-lobby-hero-actions', {}, [
        h('button.sk-pill-btn', { onclick: () => env.router.go('/analytics') }, [icon('bar-chart-3'), 'Analytics']),
        h('button.sk-pill-btn', { onclick: () => env.router.go('/strategies') }, [icon('sliders-horizontal'), 'Strategy Lab']),
      ]),
    ]),
    snapshot,
    h('h2.sk-section-title', {}, 'Games'),
    h('div.sk-game-grid', {}, cards),
  ]);
}
