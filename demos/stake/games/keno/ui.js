// ============================================================
//  Keno UI — pick up to 10 of 40, draw 10, match to win.
// ============================================================

import { runBet } from '../game-base.js';
import { betPanel } from '../../ui/bet-panel.js';
import { h, clear, icon, refreshIcons } from '../../ui/components.js';
import { ensureStyle } from '../../ui/style-loader.js';
import { mult } from '../../core/format.js';
import { logic, paytable, POOL, MAX_PICKS } from './logic.js';

ensureStyle(new URL('./style.css', import.meta.url).href);
const GAME = { id: 'keno', logic };

export function create(env) {
  const picks = new Set();
  const cells = [];
  let locked = false;

  const grid = h('div.sk-keno-grid', {});
  for (let n = 1; n <= POOL; n++) {
    const cell = h('button.sk-keno-cell', { type: 'button' }, String(n));
    cell.onclick = () => toggle(n);
    cells.push(cell); grid.appendChild(cell);
  }

  const status = h('div.sk-keno-status', {}, 'Pick 1–10 numbers');
  const payRow = h('div.sk-keno-pay', {});

  const quick = h('button.sk-chip-btn', { onclick: quickPick }, [icon('shuffle'), ' Quick pick']);
  const clr = h('button.sk-chip-btn', { onclick: () => { if (locked) return; picks.clear(); paint(); } }, [icon('x'), ' Clear']);

  function toggle(n) {
    if (locked) return;
    if (picks.has(n)) picks.delete(n);
    else { if (picks.size >= MAX_PICKS) return env.bus.emit('toast', { message: 'Max 10 picks', tone: 'warn' }); picks.add(n); }
    paint();
  }
  function quickPick() {
    if (locked) return;
    picks.clear();
    while (picks.size < 10) picks.add(1 + Math.floor(Math.random() * POOL));
    paint();
  }
  function paint() {
    cells.forEach((c, i) => {
      c.className = 'sk-keno-cell' + (picks.has(i + 1) ? ' picked' : '');
    });
    status.textContent = picks.size ? `${picks.size} picked` : 'Pick 1–10 numbers';
    renderPay();
  }
  function renderPay() {
    clear(payRow);
    const k = picks.size;
    if (!k) return;
    const t = paytable(k);
    for (let hh = 0; hh <= k; hh++) {
      if (t[hh] <= 0 && hh < k) continue;
      payRow.append(h('div.sk-keno-payitem' + (t[hh] > 0 ? '' : '.dim'), {}, [
        h('span.h', {}, `${hh}★`), h('span.m', {}, mult(t[hh])),
      ]));
    }
  }

  function reveal(drawn, picksArr) {
    const drawnSet = new Set(drawn);
    cells.forEach((c, i) => {
      const n = i + 1;
      const picked = picks.has(n), hit = drawnSet.has(n);
      c.className = 'sk-keno-cell'
        + (picked && hit ? ' hit' : '')
        + (picked && !hit ? ' miss' : '')
        + (!picked && hit ? ' drawn' : '');
    });
  }

  async function singleBet(wager) {
    locked = true;
    const picksArr = [...picks];
    const { record, result } = await runBet(env, GAME, wager, { picks: picksArr });
    reveal(result.meta.drawn, picksArr);
    status.textContent = `${result.meta.hits}/${result.meta.k} hits · ${mult(record.multiplier)}`;
    locked = false;
    return { won: record.won, profit: record.profit, multiplier: record.multiplier, record };
  }

  const panel = betPanel(env, {
    singleBet, actionLabel: 'Play',
    validate: () => (picks.size ? null : 'Pick at least one number'),
  });

  const board = h('div.sk-keno-board', {}, [
    h('div.sk-keno-top', {}, [status, h('div.sk-inline', {}, [quick, clr])]),
    grid,
    payRow,
  ]);

  paint();
  return { node: h('div.sk-game.sk-game-keno', {}, [panel.node, h('div.sk-board-wrap', {}, [board])]), onMount: () => refreshIcons() };
}
