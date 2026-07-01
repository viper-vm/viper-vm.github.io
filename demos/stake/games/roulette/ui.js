// ============================================================
//  Roulette UI — interactive felt table.
//  Center-spin wheel (hold to open auto-spin), chip tray, action
//  bar (Rebet / 2× / Undo / Clear / Turbo / Auto Spin), recent
//  spins strip. Fully responsive so it fits the viewport.
// ============================================================

import { placeWager, drawFloats, settle } from '../game-base.js';
import { h, clear, icon, refreshIcons } from '../../ui/components.js';
import { chipTray, actionBar, chipShort } from '../../ui/casino-kit.js';
import { openAutobetModal } from '../../ui/autobet-modal.js';
import { ensureStyle } from '../../ui/style-loader.js';
import { AutoBet } from '../../core/strategy.js';
import { money, signedMoney, mult } from '../../core/format.js';
import { WHEEL, isRed, betWins, payMultiple } from './logic.js';

ensureStyle(new URL('./style.css', import.meta.url).href);

export function create(env) {
  const bets = new Map();        // key -> amount
  const history = [];            // {key, amount} for undo
  const cellBadges = new Map();
  let lastBets = [];             // snapshot for rebet
  let spinning = false;
  let turbo = false;
  let autoRunning = false;
  let auto = null;
  let rotation = 0;
  const recent = [];

  const chips = chipTray(env, { denoms: [1, 5, 25, 100, 500, 1000] });

  // ----- wheel -----
  const size = 260;
  const canvas = h('canvas.sk-rl2-canvas', { width: size, height: size });
  drawWheel(canvas);
  const spinBtn = h('button.sk-rl2-spin', { type: 'button' }, 'SPIN');
  const wheel = h('div.sk-rl2-wheel', {}, [
    h('div.sk-rl2-pointer', {}), canvas, spinBtn,
    h('div.sk-rl2-hold', {}, 'Hold to auto-spin'),
  ]);
  wirePressHold(spinBtn, () => manualSpin(), () => openAuto());

  const recentStrip = h('div.sk-rl2-recent', {}, [h('span.sk-rl2-recent-empty', {}, 'Recent spins appear here')]);
  const resultBadge = h('div.sk-rl2-result', {}, '—');

  // ----- status bar -----
  const totalOut = h('strong', {}, '$0.00');
  const status = h('div.sk-rl2-status', {}, [
    h('div', {}, ['Total bet: ', totalOut]),
    resultBadge,
  ]);

  // ----- felt board -----
  const felt = buildFelt();

  // ----- action bar -----
  const bar = actionBar([
    { key: 'rebet', label: 'Rebet', icon: 'rotate-ccw', onClick: rebet },
    { key: 'x2', label: '2×', icon: 'chevrons-up', onClick: doubleAll },
    { key: 'undo', label: 'Undo', icon: 'undo-2', onClick: undo },
    { key: 'clear', label: 'Clear', icon: 'trash-2', onClick: clearBets },
    { key: 'turbo', label: 'Turbo', icon: 'zap', variant: 'toggle', onClick: () => { turbo = !turbo; bar.setActive('turbo', turbo); } },
    { key: 'auto', label: 'Auto Spin', icon: 'refresh-cw', variant: 'accent', onClick: () => (autoRunning ? stopAuto() : openAuto()) },
  ]);

  const bottom = h('div.sk-rl2-bottom', {}, [chips.node, bar.node]);

  const root = h('div.sk-rl2', {}, [
    h('div.sk-rl2-stage', {}, [
      h('div.sk-rl2-wheelwrap', {}, [recentStrip, wheel]),
      status,
      felt,
    ]),
    bottom,
  ]);

  syncBadges();

  return { node: root, onMount: () => refreshIcons() };

  // ---------- betting ----------
  function place(key) {
    if (spinning || autoRunning) return;
    const chip = chips.get();
    bets.set(key, (bets.get(key) || 0) + chip);
    history.push({ key, amount: chip });
    syncBadges();
  }
  function totalWager() { let s = 0; for (const v of bets.values()) s += v; return s; }
  function syncBadges() {
    for (const [key, badge] of cellBadges) {
      const amt = bets.get(key) || 0;
      badge.textContent = amt ? chipShort(amt) : '';
      badge.parentElement.classList.toggle('has-chip', amt > 0);
    }
    totalOut.textContent = money(totalWager());
  }
  function rebet() {
    if (spinning || autoRunning) return;
    if (!lastBets.length && !bets.size) return;
    const src = bets.size ? [...bets.entries()] : lastBets;
    if (bets.size) lastBets = src;
    bets.clear(); history.length = 0;
    for (const [k, a] of (bets.size ? [] : lastBets)) { bets.set(k, a); history.push({ key: k, amount: a }); }
    // if table had bets, keep them; otherwise restored above
    syncBadges();
  }
  function doubleAll() {
    if (spinning || autoRunning || !bets.size) return;
    for (const [k, a] of [...bets.entries()]) { bets.set(k, a * 2); history.push({ key: k, amount: a }); }
    syncBadges();
  }
  function undo() {
    if (spinning || autoRunning) return;
    const last = history.pop(); if (!last) return;
    const cur = bets.get(last.key) || 0; const next = cur - last.amount;
    if (next > 1e-9) bets.set(last.key, next); else bets.delete(last.key);
    syncBadges();
  }
  function clearBets() {
    if (spinning || autoRunning) return;
    if (bets.size) lastBets = [...bets.entries()];
    bets.clear(); history.length = 0; syncBadges();
  }

  // ---------- spin ----------
  async function manualSpin() {
    if (spinning || autoRunning) return;
    const entries = [...bets.entries()].map(([key, amount]) => ({ key, amount }));
    if (!entries.length) return env.bus.emit('toast', { message: 'Place a bet first', tone: 'warn' });
    lastBets = [...bets.entries()];
    await doSpin(entries);
  }

  async function doSpin(entries) {
    const total = entries.reduce((s, b) => s + b.amount, 0);
    const err = env.wallet.validateBet(total);
    if (err) { env.bus.emit('toast', { message: err, tone: 'warn' }); return { error: err }; }

    spinning = true; spinBtn.classList.add('spinning'); spinBtn.textContent = '…';
    placeWager(env, total);
    const { floats, ctx } = await drawFloats(env, 1);
    const idx = Math.floor(floats[0] * WHEEL.length);
    const win = WHEEL[idx];

    const seg = 360 / WHEEL.length;
    const targetMod = (360 - (idx * seg + seg / 2)) % 360;
    let base = rotation - (rotation % 360);
    let next = base + 360 * (turbo ? 3 : 5) + targetMod;
    while (next <= rotation + 360) next += 360;
    rotation = next;
    const dur = turbo ? 0.9 : 3.4;
    canvas.style.transition = `transform ${dur}s cubic-bezier(0.15,0.85,0.2,1)`;
    canvas.style.transform = `rotate(${rotation}deg)`;
    await sleep(dur * 1000 + 120);

    let payout = 0;
    for (const b of entries) if (betWins(b.key, win)) payout += b.amount * payMultiple(b.key);
    const won = payout > total;
    const record = await settle(env, {
      game: 'roulette', wager: total, multiplier: total > 0 ? payout / total : 0, payout, won,
      detail: `Landed ${win}`, meta: { win, bets: entries }, fairCtx: ctx,
    });

    const n = win === '0' || win === '00' ? -1 : Number(win);
    resultBadge.textContent = win;
    resultBadge.className = 'sk-rl2-result ' + (n < 0 ? 'green' : isRed(n) ? 'red' : 'black');
    pushRecent(win, n);
    highlightWinners(win);
    env.bus.emit('toast', payout > 0
      ? { message: `${win} — ${signedMoney(payout - total)}`, tone: won ? 'success' : 'info' }
      : { message: `${win} — lost ${money(total)}`, tone: 'danger' });

    spinning = false; spinBtn.classList.remove('spinning'); spinBtn.textContent = 'SPIN';
    return { won, profit: record.profit, multiplier: record.multiplier, record };
  }

  function pushRecent(win, n) {
    recent.unshift({ win, cls: n < 0 ? 'green' : isRed(n) ? 'red' : 'black' });
    if (recent.length > 14) recent.pop();
    clear(recentStrip);
    for (const r of recent) recentStrip.append(h('span.sk-rl2-chip.' + r.cls, {}, r.win));
  }
  function highlightWinners(win) {
    for (const [key, badge] of cellBadges) {
      badge.parentElement.classList.toggle('winning', (bets.get(key) || 0) > 0 && betWins(key, win));
    }
    setTimeout(() => { for (const [, badge] of cellBadges) badge.parentElement.classList.remove('winning'); }, 2000);
  }

  // ---------- auto ----------
  function openAuto() {
    if (autoRunning) return;
    const baseTotal = totalWager();
    if (baseTotal <= 0) return env.bus.emit('toast', { message: 'Place your bets, then auto-spin', tone: 'warn' });
    const pattern = [...bets.entries()];
    openAutobetModal(env, {
      baseBet: baseTotal,
      note: 'Auto-spin repeats your table bets; a strategy scales the whole stake each round.',
      onStart: (settings) => startAuto(settings, pattern, baseTotal),
    });
  }
  function startAuto(settings, pattern, baseTotal) {
    autoRunning = true; bar.setLabel('auto', 'Stop'); bar.setActive('auto', true);
    turbo = true; bar.setActive('turbo', true);
    auto = new AutoBet({
      betFn: async (wager) => {
        const factor = baseTotal > 0 ? wager / baseTotal : 1;
        const entries = pattern.map(([key, amount]) => ({ key, amount: round2(amount * factor) }));
        // reflect scaled bets on the table
        bets.clear(); for (const e of entries) bets.set(e.key, e.amount); syncBadges();
        const r = await doSpin(entries);
        return r && r.error ? r : r;
      },
      settings: { ...settings, baseBet: baseTotal, delayMs: 350, alive: () => document.body.contains(bar.node) },
      onStateChange: (st) => {
        if (!st.running) {
          autoRunning = false; bar.setLabel('auto', 'Auto Spin'); bar.setActive('auto', false);
          if (st.reason && st.reason !== 'stopped') env.bus.emit('toast', { message: `Auto-spin stopped — ${st.reason}`, tone: 'info' });
          // restore original pattern on the table
          bets.clear(); for (const [k, a] of pattern) bets.set(k, a); syncBadges();
        }
      },
    });
    auto.start();
  }
  function stopAuto() { if (auto) auto.stop(); }

  // ---------- felt DOM ----------
  function buildFelt() {
    const grid = h('div.sk-felt', {});
    const zeros = h('div.sk-felt-zeros', {}, [cell('0', 'straight:0', 'green'), cell('00', 'straight:00', 'green')]);
    const numbers = h('div.sk-felt-numbers', {});
    for (let r = 0; r < 3; r++) {
      const row = h('div.sk-felt-row', {});
      for (let c = 0; c < 12; c++) {
        const n = c * 3 + (3 - r);
        row.appendChild(cell(String(n), 'straight:' + n, isRed(n) ? 'red' : 'black'));
      }
      row.appendChild(outside('2:1', 'col:' + (3 - r), 'col'));
      numbers.appendChild(row);
    }
    const dozens = h('div.sk-felt-dozens', {}, [outside('1st 12', 'dozen:1'), outside('2nd 12', 'dozen:2'), outside('3rd 12', 'dozen:3')]);
    const evens = h('div.sk-felt-evens', {}, [
      outside('1-18', 'low'), outside('EVEN', 'even'), outside('RED', 'red', 'red'),
      outside('BLACK', 'black', 'black'), outside('ODD', 'odd'), outside('19-36', 'high'),
    ]);
    grid.append(h('div.sk-felt-top', {}, [zeros, numbers]), dozens, evens);
    return grid;
  }
  function cell(label, key, color) {
    const badge = h('span.sk-felt-badge', {}); cellBadges.set(key, badge);
    return h('button.sk-felt-cell.' + color, { type: 'button', onclick: () => place(key) }, [h('span.sk-felt-n', {}, label), badge]);
  }
  function outside(label, key, color = '') {
    const badge = h('span.sk-felt-badge', {}); cellBadges.set(key, badge);
    return h('button.sk-felt-out' + (color ? '.' + color : ''), { type: 'button', onclick: () => place(key) }, [h('span', {}, label), badge]);
  }
}

// press-and-hold: quick click → onClick, hold >450ms → onHold
function wirePressHold(el, onClick, onHold) {
  let timer = null, held = false;
  const down = (e) => { e.preventDefault(); held = false; timer = setTimeout(() => { held = true; onHold(); }, 450); };
  const up = () => { if (timer) clearTimeout(timer); if (!held) onClick(); };
  const cancel = () => { if (timer) clearTimeout(timer); };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', cancel);
}

function drawWheel(canvas) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width, cx = size / 2, cy = size / 2, R = size / 2 - 2;
  const seg = (Math.PI * 2) / WHEEL.length;
  for (let i = 0; i < WHEEL.length; i++) {
    const val = WHEEL[i];
    const n = val === '0' || val === '00' ? -1 : Number(val);
    const color = n < 0 ? '#1f8a4c' : isRed(n) ? '#c1362f' : '#14171d';
    const a0 = -Math.PI / 2 + i * seg, a1 = a0 + seg;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a0 + seg / 2);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui';
    ctx.fillText(val, R - 7, 0); ctx.restore();
  }
  ctx.beginPath(); ctx.arc(cx, cy, 62, 0, Math.PI * 2); ctx.fillStyle = '#7a4a1e'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 58, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.stroke();
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
