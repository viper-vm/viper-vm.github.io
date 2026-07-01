// ============================================================
//  Shell — app chrome (header, nav, wallet readout) and the
//  route → view dispatcher. Views are plain render(env,params)
//  functions returning a DOM node.
// ============================================================

import { h, clear, icon, refreshIcons, mountToasts } from './components.js';
import { money, signedMoney, shortHex } from '../core/format.js';
import { renderLobby } from './lobby.js';
import { renderGame } from './game-view.js';
import { renderAnalytics } from './analytics-view.js';
import { renderStrategies } from './strategy-view.js';
import { renderSettings } from './settings-view.js';
import { openCashier } from './cashier.js';
import { openFairness } from './fairness-modal.js';

const NAV = [
  { path: '/', label: 'Lobby', icon: 'layout-grid' },
  { path: '/analytics', label: 'Analytics', icon: 'bar-chart-3' },
  { path: '/strategies', label: 'Strategies', icon: 'sliders-horizontal' },
];

export function buildShell(env) {
  mountToasts(env.bus);
  initTheme();

  // ---- header ----
  const balanceEl = h('span.sk-balance-amount', {}, money(env.wallet.balance));
  const profitEl = h('span.sk-balance-net', {}, '');
  const seedEl = h('span.sk-seed-nonce', {}, '');

  const navButtons = NAV.map((n) => {
    const b = h('button.sk-nav-btn', { type: 'button', dataset: { path: n.path }, onclick: () => env.router.go(n.path) },
      [icon(n.icon), h('span', {}, n.label)]);
    return b;
  });

  const themeBtn = h('button.sk-icon-btn', { type: 'button', title: 'Toggle theme', onclick: toggleTheme }, [icon('moon')]);
  const cashierBtn = h('button.sk-hdr-btn', { type: 'button', onclick: () => openCashier(env) }, [icon('wallet'), h('span', {}, 'Cashier')]);
  const fairBtn = h('button.sk-hdr-btn.ghost', { type: 'button', onclick: () => openFairness(env), title: 'Provably fair' },
    [icon('shield-check'), seedEl]);

  const header = h('header.sk-header', {}, [
    h('div.sk-header-inner', {}, [
      h('div.sk-brand', {}, [
        h('a.sk-back', { href: '/demos/', title: 'Back to demos' }, [icon('arrow-left')]),
        h('div.sk-logo', {}, 'S'),
        h('div.sk-brand-text', {}, [
          h('strong', {}, 'Stake'),
          h('span.sk-fun-pill', {}, 'FUN MONEY · SIMULATOR'),
        ]),
      ]),
      h('nav.sk-nav', {}, navButtons),
      h('div.sk-header-right', {}, [
        h('button.sk-balance', { type: 'button', onclick: () => openCashier(env), title: 'Cashier' }, [
          h('div.sk-balance-main', {}, [icon('circle-dollar-sign'), balanceEl]),
          profitEl,
        ]),
        cashierBtn, fairBtn, themeBtn,
      ]),
    ]),
  ]);

  const main = h('main.sk-main', {});
  const root = h('div.sk-app', {}, [header, main]);
  document.body.appendChild(root);

  // ---- wallet + seed reactive updates ----
  function paintWallet() {
    const st = env.wallet.state();
    balanceEl.textContent = money(st.balance);
    profitEl.textContent = (st.netProfit >= 0 ? '▲ ' : '▼ ') + signedMoney(st.netProfit);
    profitEl.className = 'sk-balance-net tone-' + (st.netProfit >= 0 ? 'up' : 'down');
  }
  function paintSeed() {
    const s = env.fair.publicState();
    seedEl.textContent = `${shortHex(s.clientSeed, 4, 4)} · #${s.nonce}`;
  }
  env.bus.on('wallet:changed', paintWallet);
  env.bus.on('cashier:changed', paintWallet);
  env.bus.on('seed:rotated', paintSeed);
  env.bus.on('bet:settled', paintSeed);
  paintWallet();
  paintSeed();

  // ---- route dispatch ----
  function renderRoute(route) {
    const [head, arg] = route.segs;
    clear(main);
    let node, active = '/';
    if (!head) { node = renderLobby(env); active = '/'; }
    else if (head === 'play' && arg) { node = renderGame(env, { gameId: arg }); active = '/'; }
    else if (head === 'analytics') { node = renderAnalytics(env, { gameId: arg || null }); active = '/analytics'; }
    else if (head === 'strategies') { node = renderStrategies(env); active = '/strategies'; }
    else if (head === 'settings') { node = renderSettings(env); active = '/settings'; }
    else { node = renderLobby(env); active = '/'; }

    main.appendChild(node);
    for (const b of navButtons) b.classList.toggle('active', b.dataset.path === active);
    refreshIcons();
    if (node._onMount) node._onMount();
    window.scrollTo(0, 0);
  }

  env.router = env.router || null;
  return { renderRoute };
}

// ---------- theme ----------
function initTheme() {
  const saved = localStorage.getItem('stake:theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('stake:theme', next);
}
