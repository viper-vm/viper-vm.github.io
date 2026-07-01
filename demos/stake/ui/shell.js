// ============================================================
//  Shell — app chrome. A left icon sidebar handles navigation
//  (expands on hover, pin to keep open); a slim topbar keeps the
//  wallet balance always visible. Route → view dispatch lives here.
//  On narrow screens the sidebar collapses to a bottom bar.
// ============================================================

import { h, clear, icon, refreshIcons, mountToasts } from './components.js';
import { money, signedMoney } from '../core/format.js';
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
  { path: '/strategies', label: 'Strategy Lab', icon: 'sliders-horizontal' },
];

export function buildShell(env) {
  mountToasts(env.bus);
  initTheme();

  const items = []; // path-bound items for active state

  function sideItem(ic, label, onClick, path) {
    const btn = h('button.sk-side-item', { type: 'button', onclick: onClick, title: label }, [
      icon(ic), h('span.sk-side-label', {}, label),
    ]);
    const it = { node: btn, path, setActive: (on) => btn.classList.toggle('active', on) };
    if (path) items.push(it);
    return it;
  }

  const navItems = NAV.map((n) => sideItem(n.icon, n.label, () => env.router.go(n.path), n.path));
  const cashierItem = sideItem('wallet', 'Cashier', () => openCashier(env));
  const fairItem = sideItem('shield-check', 'Provably Fair', () => openFairness(env));
  const settingsItem = sideItem('settings', 'Settings', () => env.router.go('/settings'), '/settings');
  const themeItem = sideItem('moon', 'Theme', toggleTheme);
  const exitItem = sideItem('log-out', 'Exit to portfolio', () => { location.href = '/demos/'; });

  const hamburger = h('button.sk-side-toggle', { type: 'button', title: 'Pin menu', onclick: togglePinned }, [icon('menu')]);
  const brand = h('a.sk-side-brand', { href: '#/', title: 'Lobby', onclick: (e) => { e.preventDefault(); env.router.go('/'); } }, [
    h('span.sk-side-logo', {}, 'S'), h('span.sk-side-label.brand', {}, 'Stake'),
  ]);

  const sidebar = h('aside.sk-sidebar', {}, [
    h('div.sk-side-top', {}, [hamburger, brand]),
    h('nav.sk-side-nav', {}, [
      ...navItems.map((i) => i.node), sep(),
      cashierItem.node, fairItem.node,
    ]),
    h('div.sk-side-bottom', {}, [settingsItem.node, themeItem.node, exitItem.node]),
  ]);

  // ---- topbar ----
  const balAmt = h('span.sk-bal-amt', {}, money(env.wallet.balance));
  const balNet = h('span.sk-bal-net', {}, '');
  const pageTitle = h('span.sk-top-page', {}, 'Lobby');
  const topbar = h('header.sk-topbar', {}, [
    h('div.sk-top-left', {}, [
      h('span.sk-fun-pill', {}, 'FUN MONEY · SIMULATOR'),
      pageTitle,
    ]),
    h('div.sk-top-right', {}, [
      h('button.sk-bal', { type: 'button', title: 'Cashier', onclick: () => openCashier(env) }, [
        h('span.sk-bal-main', {}, [icon('circle-dollar-sign'), balAmt]),
        balNet,
      ]),
    ]),
  ]);

  const main = h('main.sk-main', {});
  const shellMain = h('div.sk-shell-main', {}, [topbar, main]);
  const root = h('div.sk-app', {}, [sidebar, shellMain]);
  document.body.appendChild(root);
  applyPinned();

  // ---- wallet ----
  function paintWallet() {
    const st = env.wallet.state();
    balAmt.textContent = money(st.balance);
    balNet.textContent = (st.netProfit >= 0 ? '▲ ' : '▼ ') + signedMoney(st.netProfit);
    balNet.className = 'sk-bal-net tone-' + (st.netProfit >= 0 ? 'up' : 'down');
  }
  env.bus.on('wallet:changed', paintWallet);
  env.bus.on('cashier:changed', paintWallet);
  paintWallet();

  // ---- routing ----
  const TITLES = { '/': 'Lobby', '/analytics': 'Analytics', '/strategies': 'Strategy Lab', '/settings': 'Settings' };
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
    for (const it of items) it.setActive(it.path === active);
    pageTitle.textContent = head === 'play' && arg ? cap(arg) : (TITLES[active] || 'Lobby');
    refreshIcons();
    if (node._onMount) node._onMount();
    window.scrollTo(0, 0);
  }

  return { renderRoute };

  function sep() { return h('div.sk-side-sep', {}); }
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

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

// ---------- sidebar pin ----------
function applyPinned() {
  const pinned = localStorage.getItem('stake:sidebar') === 'pinned';
  document.querySelector('.sk-app')?.classList.toggle('pinned', pinned);
}
function togglePinned() {
  const app = document.querySelector('.sk-app');
  const pinned = !app.classList.contains('pinned');
  app.classList.toggle('pinned', pinned);
  localStorage.setItem('stake:sidebar', pinned ? 'pinned' : '');
}
