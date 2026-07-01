// ============================================================
//  American Roulette — 38 pockets (0, 00, 1–36).
//  Place chips on straight numbers or outside bets, then spin.
//  Fair: 1 float → pocket index into the real wheel sequence.
//  House edge (5.26%) is structural, from the two green zeros.
// ============================================================

import { registry } from '../core/registry.js';
import { placeWager, drawFloats, settle } from './game-base.js';
import { h, amountField, refreshIcons, icon } from '../ui/components.js';
import { money, mult, signedMoney } from '../core/format.js';

// Real American wheel sequence (clockwise).
const WHEEL = ['0', '28', '9', '26', '30', '11', '7', '20', '32', '17', '5', '22', '34', '15', '3', '24', '36',
  '13', '1', '00', '27', '10', '25', '29', '12', '8', '19', '31', '18', '6', '21', '33', '16', '4', '23', '35', '14', '2'];
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const isRed = (n) => RED.has(n);
function betWins(key, win) {
  const n = win === '0' || win === '00' ? -1 : Number(win);
  if (key.startsWith('straight:')) return key.slice(9) === win;
  if (n < 0) return false; // zeros lose all outside bets
  switch (key) {
    case 'red': return isRed(n);
    case 'black': return !isRed(n);
    case 'odd': return n % 2 === 1;
    case 'even': return n % 2 === 0;
    case 'low': return n >= 1 && n <= 18;
    case 'high': return n >= 19 && n <= 36;
    case 'dozen:1': return n <= 12;
    case 'dozen:2': return n >= 13 && n <= 24;
    case 'dozen:3': return n >= 25;
    case 'col:1': return n % 3 === 1;
    case 'col:2': return n % 3 === 2;
    case 'col:3': return n % 3 === 0;
    default: return false;
  }
}
// total return multiple (incl. stake) for a winning bet
function payMultiple(key) {
  if (key.startsWith('straight:')) return 36;      // 35:1
  if (key.startsWith('dozen:') || key.startsWith('col:')) return 3; // 2:1
  return 2;                                         // 1:1
}

const logic = {
  floatsNeeded: () => 1,
  resolve(floats, params) {
    const bets = params.bets || [];
    const totalWager = bets.reduce((s, b) => s + b.amount, 0);
    const idx = Math.floor(floats[0] * WHEEL.length);
    const win = WHEEL[idx];
    let payout = 0;
    for (const b of bets) if (betWins(b.key, win)) payout += b.amount * payMultiple(b.key);
    return {
      won: payout > totalWager,
      multiplier: totalWager > 0 ? payout / totalWager : 0,
      payout,
      detail: `Landed ${win}`,
      meta: { win, idx, totalWager },
    };
  },
  strategy: {
    controls: [{ key: 'pick', label: 'Bet on', type: 'select', default: 'red',
      options: [{ value: 'red', label: 'Red' }, { value: 'black', label: 'Black' },
        { value: 'odd', label: 'Odd' }, { value: 'even', label: 'Even' }] }],
    defaults: () => ({ pick: 'red' }),
    // strategy plays a single even-money bet with the whole unit wager
    buildParams: (sp, wager) => ({ bets: [{ key: sp.pick || 'red', amount: wager }] }),
  },
};

function create(env) {
  const bets = new Map();   // key -> amount
  const history = [];       // placement order for undo
  const cellBadges = new Map();
  let spinning = false;

  const amt = amountField(env.wallet, { value: 5 });
  amt.node.querySelector('.sk-label').textContent = 'Chip Size';

  // ----- wheel canvas -----
  const size = 240;
  const canvas = h('canvas.sk-wheel-canvas', { width: size, height: size });
  const wheelWrap = h('div.sk-wheel', {}, [h('div.sk-wheel-pointer', {}), canvas]);
  const resultBadge = h('div.sk-wheel-result', {}, '—');
  drawWheel(canvas);
  let rotation = 0;

  // ----- board -----
  const board = buildBoard();
  const totalOut = h('span.v', {}, '$0.00');

  const spinBtn = h('button.sk-action-btn', { type: 'button' }, [icon('rotate-cw'), ' Spin']);
  const clearBtn = h('button.sk-chip-btn', { type: 'button' }, 'Clear');
  const undoBtn = h('button.sk-chip-btn', { type: 'button' }, 'Undo');
  spinBtn.onclick = () => spin();
  clearBtn.onclick = () => { bets.clear(); history.length = 0; syncBadges(); };
  undoBtn.onclick = () => {
    const last = history.pop();
    if (!last) return;
    const cur = bets.get(last.key) || 0;
    const next = cur - last.amount;
    if (next > 1e-9) bets.set(last.key, next); else bets.delete(last.key);
    syncBadges();
  };

  const autoNum = h('input.sk-num', { type: 'number', value: 10, min: 1 });
  const autoBtn = h('button.sk-action-btn.auto', { type: 'button' }, [icon('repeat'), ' Auto Spin']);
  let autoLeft = 0;
  autoBtn.onclick = () => {
    if (autoLeft > 0) { autoLeft = 0; return; }
    autoLeft = Math.max(1, Number(autoNum.value) || 1);
    spin();
  };

  const panel = h('div.sk-betpanel', {}, [
    amt.node,
    h('div.sk-kv', {}, [h('span.k', {}, 'Total Wager'), totalOut]),
    h('div.sk-field-grid', {}, [clearBtn, undoBtn]),
    spinBtn,
    h('div.sk-field', {}, [h('label.sk-label', {}, 'Auto Spin ×'), autoNum]),
    autoBtn,
    h('div.sk-hint', {}, 'Click numbers or outside bets to place chips.'),
  ]);

  syncBadges();

  return {
    node: h('div.sk-game.sk-game-roulette', {}, [
      panel,
      h('div.sk-board-wrap', {}, [h('div.sk-roulette-board', {}, [wheelWrap, resultBadge, board])]),
    ]),
    onMount: () => refreshIcons(),
  };

  // ---------- betting ----------
  function place(key, label) {
    if (spinning) return;
    const chip = amt.get();
    if (!(chip > 0)) return env.bus.emit('toast', { message: 'Set a chip size', tone: 'warn' });
    bets.set(key, (bets.get(key) || 0) + chip);
    history.push({ key, amount: chip });
    syncBadges();
  }
  function totalWager() { let s = 0; for (const v of bets.values()) s += v; return s; }
  function syncBadges() {
    for (const [key, badge] of cellBadges) {
      const amount = bets.get(key) || 0;
      badge.textContent = amount ? '$' + trim(amount) : '';
      badge.parentElement.classList.toggle('has-chip', amount > 0);
    }
    totalOut.textContent = money(totalWager());
  }

  // ---------- spin ----------
  async function spin() {
    if (spinning) return;
    const total = totalWager();
    if (total <= 0) { autoLeft = 0; return env.bus.emit('toast', { message: 'Place a bet first', tone: 'warn' }); }
    const err = env.wallet.validateBet(total);
    if (err) { autoLeft = 0; return env.bus.emit('toast', { message: err, tone: 'warn' }); }

    spinning = true; spinBtn.disabled = true;
    placeWager(env, total);
    const { floats, ctx } = await drawFloats(env, 1);
    const idx = Math.floor(floats[0] * WHEEL.length);
    const win = WHEEL[idx];

    // rotate so winning pocket lands under the top pointer
    const seg = 360 / WHEEL.length;
    const targetMod = (360 - (idx * seg + seg / 2)) % 360;
    let base = rotation - (rotation % 360);
    let next = base + 360 * 5 + targetMod;
    while (next <= rotation + 360) next += 360;
    rotation = next;
    canvas.style.transition = 'transform 3.6s cubic-bezier(0.15,0.85,0.2,1)';
    canvas.style.transform = `rotate(${rotation}deg)`;

    await sleep(3700);

    const betList = [...bets.entries()].map(([key, amount]) => ({ key, amount }));
    let payout = 0;
    for (const b of betList) if (betWins(b.key, win)) payout += b.amount * payMultiple(b.key);
    const won = payout > total;

    await settle(env, {
      game: 'roulette', wager: total, multiplier: total > 0 ? payout / total : 0, payout, won,
      detail: `Landed ${win}`, meta: { win, bets: betList }, fairCtx: ctx,
    });

    const n = win === '0' || win === '00' ? -1 : Number(win);
    resultBadge.textContent = win;
    resultBadge.className = 'sk-wheel-result ' + (n < 0 ? 'green' : isRed(n) ? 'red' : 'black');
    highlightWinners(win);
    env.bus.emit('toast', payout > 0
      ? { message: `${win} — ${signedMoney(payout - total)}`, tone: won ? 'success' : 'info' }
      : { message: `${win} — lost ${money(total)}`, tone: 'danger' });

    spinning = false; spinBtn.disabled = false;
    if (autoLeft > 0) { autoLeft -= 1; if (autoLeft > 0) { await sleep(600); spin(); } }
  }

  function highlightWinners(win) {
    for (const [key, badge] of cellBadges) {
      badge.parentElement.classList.toggle('winning', (bets.get(key) || 0) > 0 && betWins(key, win));
    }
    setTimeout(() => { for (const [, badge] of cellBadges) badge.parentElement.classList.remove('winning'); }, 2200);
  }

  // ---------- board DOM ----------
  function buildBoard() {
    const wrap = h('div.sk-rl-grid', {});
    // zeros
    const zeros = h('div.sk-rl-zeros', {}, [cell('0', 'straight:0', 'green'), cell('00', 'straight:00', 'green')]);
    // numbers 3 rows x 12 cols (top row 3,6,..36)
    const numRows = h('div.sk-rl-numbers', {});
    for (let r = 0; r < 3; r++) {
      const row = h('div.sk-rl-row', {});
      for (let c = 0; c < 12; c++) {
        const n = c * 3 + (3 - r);
        row.appendChild(cell(String(n), 'straight:' + n, isRed(n) ? 'red' : 'black'));
      }
      // column bet at end
      row.appendChild(outside('2:1', 'col:' + (3 - r), 'col'));
      numRows.appendChild(row);
    }
    const dozens = h('div.sk-rl-dozens', {}, [
      outside('1st 12', 'dozen:1'), outside('2nd 12', 'dozen:2'), outside('3rd 12', 'dozen:3'),
    ]);
    const evens = h('div.sk-rl-evens', {}, [
      outside('1-18', 'low'), outside('EVEN', 'even'),
      outside('RED', 'red', 'red'), outside('BLACK', 'black', 'black'),
      outside('ODD', 'odd'), outside('19-36', 'high'),
    ]);
    wrap.append(h('div.sk-rl-top', {}, [zeros, numRows]), dozens, evens);
    return wrap;
  }
  function cell(label, key, color) {
    const badge = h('span.sk-chip-badge', {});
    cellBadges.set(key, badge);
    const c = h('button.sk-rl-cell.' + color, { type: 'button', onclick: () => place(key, label) }, [label, badge]);
    return c;
  }
  function outside(label, key, color = '') {
    const badge = h('span.sk-chip-badge', {});
    cellBadges.set(key, badge);
    return h('button.sk-rl-out' + (color ? '.' + color : ''), { type: 'button', onclick: () => place(key, label) }, [label, badge]);
  }
}

// ---------- wheel drawing ----------
function drawWheel(canvas) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width; const cx = size / 2; const cy = size / 2; const R = size / 2 - 2;
  const seg = (Math.PI * 2) / WHEEL.length;
  for (let i = 0; i < WHEEL.length; i++) {
    const val = WHEEL[i];
    const n = val === '0' || val === '00' ? -1 : Number(val);
    const color = n < 0 ? '#2f8f5b' : isRed(n) ? '#c23b3b' : '#20242c';
    const a0 = -Math.PI / 2 + i * seg;      // start at top, clockwise
    const a1 = a0 + seg;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a1);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    // number
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a0 + seg / 2);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui';
    ctx.fillText(val, R - 6, 0);
    ctx.restore();
  }
  // hub
  ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2);
  ctx.fillStyle = '#0d0f13'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.stroke();
}

function trim(n) { return Number.isInteger(n) ? String(n) : n.toFixed(2); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export const def = {
  id: 'roulette', name: 'Roulette', tagline: 'American double-zero wheel',
  icon: 'target', accent: '#e0b64d', category: 'Table', houseEdge: 2 / 38,
  logic, create,
};
registry.register(def);
