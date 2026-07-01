// ============================================================
//  Game view — mounts a game plus a live per-game panel:
//  session P/L, win rate, a rolling "last X rounds" equity
//  sparkline, and a recent-bets feed. Updates on each settled bet.
// ============================================================

import { registry } from '../core/registry.js';
import { h, icon, clear, sparkline, statCard, plChip, refreshIcons } from './components.js';
import { money, signedMoney, mult, pct, int, timeAgo } from '../core/format.js';

export function renderGame(env, { gameId }) {
  const def = registry.get(gameId);
  if (!def) {
    return h('div.sk-view', {}, [
      h('div.sk-empty', {}, [icon('circle-alert'), h('p', {}, `Unknown game "${gameId}".`),
        h('button.sk-pill-btn', { onclick: () => env.router.go('/') }, 'Back to lobby')]),
    ]);
  }

  const instance = def.create(env);

  // ----- live per-game panel -----
  let windowN = 25;
  const statsRow = h('div.sk-live-stats', {});
  const sparkBox = h('div.sk-live-spark', {});
  const feed = h('tbody', {});
  const winSel = h('select.sk-select.sm', {},
    [10, 25, 50, 100, 250].map((n) => h('option', { value: n }, `Last ${n}`)));
  winSel.value = '25';
  winSel.onchange = () => { windowN = Number(winSel.value); update(); };

  function update() {
    const all = env.analytics.perGame(gameId, 'all');
    const session = env.analytics.perGame(gameId, 'session');
    clear(statsRow);
    statsRow.append(
      statCard('Session P/L', signedMoney(session.net), { tone: session.net >= 0 ? 'up' : 'down' }),
      statCard('Win rate', pct(all.winRate), { sub: `${int(all.wins)}/${int(all.count)}` }),
      statCard('Bets', int(all.count), { sub: money(all.wagered) + ' wagered' }),
      statCard('Best', mult(all.biggestMult), { sub: signedMoney(all.biggestWin) }),
    );

    const win = env.analytics.windowStats(windowN, { game: gameId });
    clear(sparkBox);
    sparkBox.append(
      h('div.sk-live-spark-head', {}, [
        h('span', {}, `Last ${Math.min(windowN, win.count)} rounds P/L`),
        plChip(win.net),
      ]),
      sparkline(win.curve.length > 1 ? win.curve : [0, 0], {
        w: 260, h: 56, stroke: win.net >= 0 ? 'var(--sk-up)' : 'var(--sk-down)',
      }),
      h('div.sk-live-spark-foot', {}, [
        h('span', {}, `Margin ${pct(win.margin)}`),
        h('span', {}, `RTP ${pct(win.rtp)}`),
      ]),
    );

    const recent = env.analytics.lastN(8, { game: gameId }).reverse();
    clear(feed);
    const now = Date.now();
    if (!recent.length) {
      feed.append(h('tr', {}, [h('td.sk-feed-empty', { colspan: 4 }, 'No bets yet — place one to begin.')]));
    } else {
      for (const b of recent) {
        feed.append(h('tr', { class: b.won ? 'won' : 'lost' }, [
          h('td', {}, timeAgo(b.ts, now)),
          h('td', {}, money(b.wager)),
          h('td', {}, mult(b.multiplier)),
          h('td.sk-feed-pl', {}, signedMoney(b.profit)),
        ]));
      }
    }
  }

  const onSettled = (rec) => {
    if (!document.body.contains(panelNode)) { env.bus.off('bet:settled', onSettled); return; }
    if (rec.game === gameId) update();
  };
  env.bus.on('bet:settled', onSettled);

  const panelNode = h('aside.sk-live-panel', {}, [
    h('div.sk-live-head', {}, [h('h3', {}, 'Live Stats'), winSel]),
    statsRow,
    sparkBox,
    h('div.sk-live-feed', {}, [
      h('table.sk-feed-table', {}, [
        h('thead', {}, [h('tr', {}, [h('th', {}, 'When'), h('th', {}, 'Bet'), h('th', {}, '×'), h('th', {}, 'P/L')])]),
        feed,
      ]),
    ]),
    h('a.sk-live-more', { onclick: () => env.router.go('/analytics/' + gameId) }, ['Full analytics ', icon('arrow-right')]),
  ]);

  update();

  const view = h('div.sk-view.sk-game-view', {}, [
    h('div.sk-game-topbar', {}, [
      h('button.sk-back-link', { onclick: () => env.router.go('/'), title: 'Lobby' }, [icon('arrow-left')]),
      h('div.sk-game-title-icon', { style: { color: def.accent } }, [icon(def.icon)]),
      h('h1.sk-game-name', {}, def.name),
      h('span.sk-game-sub', {}, def.tagline),
      h('div.sk-game-badges', {}, [
        h('span.sk-badge', {}, `Edge ${pct(def.houseEdge)}`),
        h('span.sk-badge.provably', {}, [icon('shield-check'), 'Provably fair']),
      ]),
    ]),
    h('div.sk-game-layout', {}, [instance.node, panelNode]),
  ]);

  view._onMount = () => { instance.onMount && instance.onMount(); refreshIcons(); };
  return view;
}
