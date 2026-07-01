// ============================================================
//  Analytics dashboard — the full P&L picture.
//   • Scope: session / today / all-time
//   • Global or per-game (drill-in)
//   • Margin & ROI KPIs, equity curve
//   • Cross-game comparison table + profit bars + combined equity
//   • Multiplier distribution
//   • Recent form (last Y) and rolling window (last X) P/L
//   • Recent bets ledger
// ============================================================

import { registry } from '../core/registry.js';
import { h, icon, clear, statCard, sparkline, refreshIcons } from './components.js';
import { lineChart, multiLine, signedBars, histogram } from './charts.js';
import { money, signedMoney, signedPct, pct, mult, int, timeAgo, shortHex } from '../core/format.js';

export function renderAnalytics(env, { gameId }) {
  let scope = 'session';
  let game = gameId || null;
  let formN = 50;
  let windowN = 50;

  const body = h('div.sk-analytics-body', {});
  const scopeTabs = h('div.sk-seg.sk-scope', {}, [
    scopeBtn('Session', 'session'), scopeBtn('Today', 'today'), scopeBtn('All-time', 'all'),
  ]);
  const gameSel = h('select.sk-select', {}, [
    h('option', { value: '' }, 'All games'),
    ...registry.all().map((d) => h('option', { value: d.id }, d.name)),
  ]);
  gameSel.value = game || '';
  gameSel.onchange = () => { game = gameSel.value || null; env.router.go(game ? '/analytics/' + game : '/analytics'); };

  const view = h('div.sk-view.sk-analytics', {}, [
    h('div.sk-view-head', {}, [
      h('div', {}, [
        h('h1', {}, game ? registry.get(game)?.name + ' Analytics' : 'Analytics'),
        h('p', {}, 'Profit/loss, margin and behaviour across your play. Fake money, real math.'),
      ]),
      h('div.sk-analytics-controls', {}, [gameSel, scopeTabs]),
    ]),
    body,
  ]);

  function scopeBtn(label, val) {
    const b = h('button.sk-seg-btn', { onclick: () => { scope = val; syncScope(); rebuild(); } }, label);
    if (val === scope) b.classList.add('active');
    return b;
  }
  function syncScope() { [...scopeTabs.children].forEach((b, i) => b.classList.toggle('active', ['session', 'today', 'all'][i] === scope)); }

  function rebuild() {
    clear(body);
    const g = env.analytics.global(scope);
    const stat = game ? env.analytics.perGame(game, scope) : g;
    const wallet = env.wallet.state();

    if (env.analytics.filtered({ scope, game }).length === 0) {
      body.append(h('div.sk-empty', {}, [icon('bar-chart-3'),
        h('p', {}, 'No bets in this range yet.'),
        h('button.sk-pill-btn', { onclick: () => env.router.go('/') }, 'Go play')]));
      refreshIcons();
      return;
    }

    // ---- KPI cards ----
    const kpis = h('div.sk-kpi-grid', {}, [
      statCard('Net P/L', signedMoney(stat.net), { tone: stat.net >= 0 ? 'up' : 'down', sub: `${int(stat.count)} bets` }),
      statCard('Profit margin', signedPct(stat.margin), { tone: stat.margin >= 0 ? 'up' : 'down', sub: 'net ÷ wagered' }),
      statCard('Realized RTP', pct(stat.rtp), { sub: `${money(stat.won)} returned` }),
      statCard('Win rate', pct(stat.winRate), { sub: `${int(stat.wins)}W / ${int(stat.losses)}L` }),
      statCard('Wagered', money(stat.wagered), { sub: `avg ${money(stat.avgBet)}` }),
      statCard('Biggest win', signedMoney(stat.biggestWin), { tone: 'up', sub: `${mult(stat.biggestMult)} best` }),
      statCard('Win streak', int(stat.longestWin), { sub: 'longest' }),
      statCard('Loss streak', int(stat.longestLoss), { sub: 'longest' }),
    ]);
    if (!game) kpis.append(statCard('ROI (deposited)', signedPct(wallet.roi), { tone: wallet.roi >= 0 ? 'up' : 'down', sub: `${money(wallet.netDeposited)} in` }));
    body.append(kpis);

    // ---- equity curve ----
    const curve = env.analytics.equity({ scope, game });
    body.append(panel('Equity curve — cumulative P/L', lineChart(curve, {
      color: curve[curve.length - 1] >= 0 ? 'var(--sk-up)' : 'var(--sk-down)',
    }), 'trending-up'));

    // ---- cross-game (global only) ----
    if (!game) {
      const rows = env.analytics.byGame(scope);
      if (rows.length) {
        const bars = rows.map((r) => ({ label: registry.get(r.game)?.name || r.game, value: r.net, color: r.net >= 0 ? 'var(--sk-up)' : 'var(--sk-down)' }));
        body.append(h('div.sk-two-col', {}, [
          panel('Profit by game', signedBars(bars), 'chart-column'),
          panel('Combined equity by game', multiLine(rows.map((r) => ({
            color: registry.get(r.game)?.accent || 'var(--sk-accent)',
            values: env.analytics.equity({ scope, game: r.game }),
          }))), 'layers'),
        ]));
        body.append(gameTable(rows));
      }
    }

    // ---- multiplier distribution ----
    const wins = env.analytics.filtered({ scope, game }).filter((b) => b.won).map((b) => b.multiplier);
    body.append(panel('Winning multiplier distribution', histogram(wins, { color: 'var(--sk-accent)' }), 'bar-chart-4'));

    // ---- recent form + rolling window ----
    body.append(h('div.sk-two-col', {}, [recentForm(), rollingWindow()]));

    // ---- recent bets ledger ----
    body.append(recentBets());

    refreshIcons();
  }

  function panel(title, chart, ic) {
    return h('div.sk-panel', {}, [
      h('div.sk-panel-head', {}, [ic ? icon(ic) : null, h('h3', {}, title)]),
      h('div.sk-panel-chart', {}, [chart]),
    ]);
  }

  function gameTable(rows) {
    const table = h('table.sk-table', {}, [
      h('thead', {}, [h('tr', {}, ['Game', 'Bets', 'Wagered', 'Net P/L', 'Margin', 'RTP', 'Win %'].map((t) => h('th', {}, t)))]),
      h('tbody', {}, rows.map((r) => h('tr.sk-table-click', { onclick: () => env.router.go('/analytics/' + r.game) }, [
        h('td', {}, [h('span.sk-dot', { style: { background: registry.get(r.game)?.accent } }), registry.get(r.game)?.name || r.game]),
        h('td', {}, int(r.count)),
        h('td', {}, money(r.wagered)),
        h('td.' + (r.net >= 0 ? 'up' : 'down'), {}, signedMoney(r.net)),
        h('td', {}, signedPct(r.margin)),
        h('td', {}, pct(r.rtp)),
        h('td', {}, pct(r.winRate)),
      ]))),
    ]);
    return h('div.sk-panel', {}, [h('div.sk-panel-head', {}, [icon('table-2'), h('h3', {}, 'Cross-game comparison')]), table]);
  }

  function recentForm() {
    const sel = h('select.sk-select.sm', {}, [20, 50, 100, 200].map((n) => h('option', { value: n }, `Last ${n}`)));
    sel.value = String(formN);
    const ticks = h('div.sk-form-ticks', {});
    const wrap = h('div.sk-panel', {}, [
      h('div.sk-panel-head', {}, [icon('activity'), h('h3', {}, 'Recent form'), h('div.sk-spacer', {}), sel]),
      ticks,
    ]);
    const paint = () => {
      formN = Number(sel.value);
      const arr = env.analytics.lastN(formN, { game });
      clear(ticks);
      let cum = 0; const curve = [0];
      for (const b of arr) { cum += b.profit; curve.push(cum); }
      const strip = h('div.sk-tick-strip', {}, arr.map((b) =>
        h('span.sk-tick.' + (b.won ? 'win' : 'loss'), { title: `${b.game} ${signedMoney(b.profit)}` })));
      ticks.append(
        strip,
        h('div.sk-form-foot', {}, [
          h('span', {}, [sparkline(curve, { w: 200, h: 40, stroke: cum >= 0 ? 'var(--sk-up)' : 'var(--sk-down)' })]),
          h('span.sk-form-net.' + (cum >= 0 ? 'up' : 'down'), {}, signedMoney(cum)),
        ]),
      );
    };
    sel.onchange = paint; paint();
    return wrap;
  }

  function rollingWindow() {
    const sel = h('select.sk-select.sm', {}, [10, 25, 50, 100, 250].map((n) => h('option', { value: n }, `Last ${n}`)));
    sel.value = String(windowN);
    const box = h('div', {});
    const wrap = h('div.sk-panel', {}, [
      h('div.sk-panel-head', {}, [icon('gauge'), h('h3', {}, game ? 'Rolling window' : 'Rolling window (all games)'), h('div.sk-spacer', {}), sel]),
      box,
    ]);
    const paint = () => {
      windowN = Number(sel.value);
      const w = env.analytics.windowStats(windowN, { game });
      clear(box);
      box.append(
        h('div.sk-window-stats', {}, [
          statCard('Window P/L', signedMoney(w.net), { tone: w.net >= 0 ? 'up' : 'down' }),
          statCard('Margin', signedPct(w.margin), { tone: w.margin >= 0 ? 'up' : 'down' }),
          statCard('Win rate', pct(w.winRate)),
        ]),
        lineChart(w.curve, { h: 160, color: w.net >= 0 ? 'var(--sk-up)' : 'var(--sk-down)' }),
      );
    };
    sel.onchange = paint; paint();
    return wrap;
  }

  function recentBets() {
    const arr = env.analytics.lastN(25, { game }).reverse();
    const now = Date.now();
    const table = h('table.sk-table', {}, [
      h('thead', {}, [h('tr', {}, ['When', !game ? 'Game' : null, 'Bet', 'Mult', 'Payout', 'P/L', 'Fair'].filter(Boolean).map((t) => h('th', {}, t)))]),
      h('tbody', {}, arr.map((b) => h('tr', { class: b.won ? 'won' : 'lost' }, [
        h('td', {}, timeAgo(b.ts, now)),
        !game ? h('td', {}, registry.get(b.game)?.name || b.game) : null,
        h('td', {}, money(b.wager)),
        h('td', {}, mult(b.multiplier)),
        h('td', {}, money(b.payout)),
        h('td.' + (b.profit >= 0 ? 'up' : 'down'), {}, signedMoney(b.profit)),
        h('td.sk-mono', {}, b.fair ? shortHex(b.fair.serverSeedHash, 4, 4) : '—'),
      ].filter(Boolean)))),
    ]);
    return h('div.sk-panel', {}, [h('div.sk-panel-head', {}, [icon('receipt'), h('h3', {}, 'Recent bets')]), table]);
  }

  // live refresh while open
  const onUpd = () => {
    if (!document.body.contains(view)) { env.bus.off('analytics:updated', onUpd); return; }
    rebuild();
  };
  env.bus.on('analytics:updated', onUpd);

  rebuild();
  return view;
}
