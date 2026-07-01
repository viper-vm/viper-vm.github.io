// ============================================================
//  Lobby — bankroll snapshot + games grouped by category, all
//  built from the registry. Adding a game makes a card appear
//  here for free.
// ============================================================

import { registry } from '../core/registry.js';
import { h, icon, statCard } from './components.js';
import { money, signedMoney, int, pct } from '../core/format.js';

const CATEGORY_ORDER = ['Originals', 'Table'];

export function renderLobby(env) {
  const g = env.analytics.global('all');
  const wallet = env.wallet.state();

  const snapshot = h('div.sk-lobby-snapshot', {}, [
    statCard('Balance', money(wallet.balance), { tone: 'accent' }),
    statCard('All-time P/L', signedMoney(wallet.netProfit), { tone: wallet.netProfit >= 0 ? 'up' : 'down', sub: pct(wallet.roi, false) + ' ROI' }),
    statCard('Bets placed', int(g.count)),
    statCard('Total wagered', money(g.wagered)),
  ]);

  // group games by category
  const groups = new Map();
  for (const def of registry.all()) {
    const cat = def.category || 'Games';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(def);
  }
  const orderedCats = [
    ...CATEGORY_ORDER.filter((c) => groups.has(c)),
    ...[...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  const sections = orderedCats.map((cat) => h('section.sk-lobby-section', {}, [
    h('div.sk-section-title', {}, [h('span', {}, cat), h('span.sk-section-count', {}, `${groups.get(cat).length} games`)]),
    h('div.sk-game-grid', {}, groups.get(cat).map((def) => card(env, def))),
  ]));

  return h('div.sk-lobby', {}, [
    h('div.sk-lobby-hero', {}, [
      h('div.sk-lobby-hero-text', {}, [
        h('div.sk-lobby-kicker', {}, [icon('shield-check'), 'Provably fair · fake money']),
        h('h1', {}, 'The House'),
        h('p', {}, 'A casino simulator you can actually learn from. Every bet is fake — play the games, test betting systems, and watch the math play out with zero risk.'),
        h('div.sk-lobby-hero-actions', {}, [
          h('button.sk-pill-btn.primary', { onclick: () => env.router.go('/play/' + (registry.ids()[0] || 'dice')) }, [icon('play'), 'Start playing']),
          h('button.sk-pill-btn', { onclick: () => env.router.go('/analytics') }, [icon('bar-chart-3'), 'Analytics']),
          h('button.sk-pill-btn', { onclick: () => env.router.go('/strategies') }, [icon('sliders-horizontal'), 'Strategy Lab']),
        ]),
      ]),
      h('div.sk-lobby-hero-art', {}, registry.all().slice(0, 6).map((d) =>
        h('span.sk-hero-chip', { style: { color: d.accent } }, [icon(d.icon)]))),
    ]),
    snapshot,
    ...sections,
  ]);
}

function card(env, def) {
  const stat = env.analytics.perGame(def.id, 'all');
  return h('button.sk-game-card', {
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
}
