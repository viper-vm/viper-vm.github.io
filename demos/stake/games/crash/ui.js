// ============================================================
//  Crash UI — watch the multiplier climb and cash out before it
//  busts. Manual round is animated in real time; Auto runs fast
//  rounds that cash out at your target via the AutoBet engine.
// ============================================================

import { placeWager, drawFloats, settle } from '../game-base.js';
import { h, amountField, segmented, icon, refreshIcons } from '../../ui/components.js';
import { ensureStyle } from '../../ui/style-loader.js';
import { AutoBet, PRESETS } from '../../core/strategy.js';
import { money, mult, signedMoney } from '../../core/format.js';
import { crashFrom } from './logic.js';

ensureStyle(new URL('./style.css', import.meta.url).href);
const RATE = 0.45; // growth per second (≈2× in 1.5s)

export function create(env) {
  const recent = [];
  let round = null;
  let auto = null;
  let autoRunning = false;

  // ----- board -----
  const size = 360, hgt = 200;
  const canvas = h('canvas.sk-crash-canvas', { width: size, height: hgt });
  const bigMult = h('div.sk-crash-mult', {}, '1.00×');
  const recentStrip = h('div.sk-crash-recent', {}, [h('span.sk-dim-note', {}, 'Recent crashes appear here')]);
  const board = h('div.sk-crash-board', {}, [recentStrip, h('div.sk-crash-stage', {}, [canvas, bigMult])]);
  drawCurve([], 1, false);

  // ----- controls -----
  const amt = amountField(env.wallet, { value: 1, onChange: () => syncBet() });
  function syncBet() { const bad = !(amt.get() > 0); if (!round) betBtn.disabled = bad; autoBtn.disabled = bad; }
  const target = h('input.sk-num', { type: 'number', step: 0.01, min: 1.01, value: 2 });

  const betBtn = h('button.sk-action-btn', { type: 'button', onclick: startManual }, 'Bet');

  // auto pane
  const presetSel = h('select.sk-select', {}, Object.entries(PRESETS).map(([k, v]) => h('option', { value: k }, v.label)));
  const numBets = h('input.sk-num', { type: 'number', value: 0 });
  const stopProfit = h('input.sk-num', { type: 'number', value: 0 });
  const stopLoss = h('input.sk-num', { type: 'number', value: 0 });
  const autoStat = h('div.sk-auto-stat', {}, [kv('Bets', '0', 'b'), kv('Profit', '$0.00', 'p')]);
  const autoBtn = h('button.sk-action-btn.auto', { type: 'button', onclick: toggleAuto }, [icon('play'), ' Start Autobet']);

  const manualPane = h('div.sk-pane', {}, [betBtn]);
  const autoPane = h('div.sk-pane', { style: { display: 'none' } }, [
    h('div.sk-field', {}, [h('label.sk-label', {}, 'Strategy'), presetSel]),
    h('div.sk-field-grid', {}, [
      h('div.sk-field', {}, [h('label.sk-label', {}, 'Number of Bets'), numBets]),
      h('div.sk-field', {}, [h('label.sk-label', {}, 'Stop Profit ($)'), stopProfit]),
    ]),
    h('div.sk-field-grid', {}, [h('div.sk-field', {}, [h('label.sk-label', {}, 'Stop Loss ($)'), stopLoss])]),
    autoBtn, autoStat,
  ]);
  const mode = segmented([{ label: 'Manual', value: 'manual' }, { label: 'Auto', value: 'auto' }], {
    onChange: (v) => { manualPane.style.display = v === 'manual' ? 'block' : 'none'; autoPane.style.display = v === 'auto' ? 'block' : 'none'; },
  });
  const panel = h('div.sk-betpanel', {}, [
    mode.node, amt.node,
    h('div.sk-field', {}, [h('label.sk-label', {}, 'Auto Cash-out ×'), target]),
    manualPane, autoPane,
  ]);

  syncBet();
  return { node: h('div.sk-game.sk-game-crash', {}, [panel, h('div.sk-board-wrap', {}, [board])]), onMount: () => refreshIcons() };

  // ---------- manual round ----------
  function startManual() {
    if (round) return;
    const wager = amt.get();
    const err = env.wallet.validateBet(wager);
    if (err) return env.bus.emit('toast', { message: err, tone: 'warn' });
    placeWager(env, wager);
    drawFloats(env, 1).then(({ floats, ctx }) => {
      const crash = crashFrom(floats[0]);
      const autoTarget = Number(target.value) || 0;
      round = { wager, crash, ctx, m: 1, pts: [], start: performance.now(), settled: false };
      betBtn.textContent = 'Cash Out'; betBtn.classList.add('cashout');
      betBtn.onclick = () => manualCashout();
      amt.input.disabled = target.disabled = true;
      bigMult.className = 'sk-crash-mult';
      tick();
      function tick() {
        if (!round || round.settled) return;
        const t = (performance.now() - round.start) / 1000;
        round.m = Math.min(round.crash, Math.exp(RATE * t));
        round.pts.push(round.m);
        bigMult.textContent = round.m.toFixed(2) + '×';
        drawCurve(round.pts, round.m, false);
        if (autoTarget > 1 && round.m >= autoTarget && autoTarget <= round.crash) return manualCashout(autoTarget);
        if (round.m >= round.crash) return boom();
        round.raf = requestAnimationFrame(tick);
      }
    });
  }
  async function manualCashout(at) {
    if (!round || round.settled) return;
    round.settled = true; if (round.raf) cancelAnimationFrame(round.raf);
    const m = at || round.m;
    const rec = await settle(env, {
      game: 'crash', wager: round.wager, multiplier: m, payout: round.wager * m, won: true,
      detail: `Out ${m.toFixed(2)}× (crash ${round.crash.toFixed(2)}×)`, meta: { crash: round.crash, out: m }, fairCtx: round.ctx,
    });
    bigMult.textContent = m.toFixed(2) + '×'; bigMult.className = 'sk-crash-mult win';
    env.bus.emit('toast', { message: `Cashed out ${mult(m)} — ${signedMoney(rec.profit)}`, tone: 'success' });
    pushRecent(round.crash); endManual();
  }
  async function boom() {
    if (!round || round.settled) return;
    round.settled = true;
    await settle(env, {
      game: 'crash', wager: round.wager, multiplier: 0, payout: 0, won: false,
      detail: `Crashed ${round.crash.toFixed(2)}×`, meta: { crash: round.crash, out: 0 }, fairCtx: round.ctx,
    });
    bigMult.textContent = round.crash.toFixed(2) + '×'; bigMult.className = 'sk-crash-mult lose';
    drawCurve(round.pts, round.crash, true);
    env.bus.emit('toast', { message: `Crashed at ${mult(round.crash)} — lost ${money(round.wager)}`, tone: 'danger' });
    pushRecent(round.crash); endManual();
  }
  function endManual() {
    betBtn.textContent = 'Bet'; betBtn.classList.remove('cashout'); betBtn.onclick = startManual;
    amt.input.disabled = target.disabled = false;
    round = null;
  }

  // ---------- auto (fast) ----------
  function toggleAuto() {
    if (autoRunning) { auto && auto.stop(); return; }
    const base = amt.get();
    const err = env.wallet.validateBet(base);
    if (err) return env.bus.emit('toast', { message: err, tone: 'warn' });
    const tgt = Number(target.value) || 0;
    if (tgt <= 1) return env.bus.emit('toast', { message: 'Set an auto cash-out above 1.00×', tone: 'warn' });
    autoRunning = true;
    auto = new AutoBet({
      betFn: (wager) => quickRound(wager, tgt),
      settings: { preset: presetSel.value, baseBet: base, numBets: Number(numBets.value) || 0, stopProfit: Number(stopProfit.value) || 0, stopLoss: Number(stopLoss.value) || 0, delayMs: 260, alive: () => document.body.contains(autoBtn) },
      onTick: (t) => { setK('b', String(t.count)); setK('p', signedMoney(t.profit)); },
      onStateChange: (st) => {
        autoBtn.innerHTML = ''; autoBtn.append(icon(st.running ? 'square' : 'play'), document.createTextNode(st.running ? ' Stop Autobet' : ' Start Autobet'));
        autoBtn.classList.toggle('running', !!st.running);
        if (!st.running) autoRunning = false;
        refreshIcons();
      },
    });
    auto.start();
  }
  async function quickRound(wager, tgt) {
    const err = env.wallet.validateBet(wager); if (err) return { error: err };
    placeWager(env, wager);
    const { floats, ctx } = await drawFloats(env, 1);
    const crash = crashFrom(floats[0]);
    const won = crash >= tgt;
    const m = won ? tgt : 0;
    const rec = await settle(env, {
      game: 'crash', wager, multiplier: m, payout: wager * m, won,
      detail: won ? `Out ${tgt.toFixed(2)}×` : `Crashed ${crash.toFixed(2)}×`, meta: { crash, out: m }, fairCtx: ctx,
    });
    bigMult.textContent = crash.toFixed(2) + '×'; bigMult.className = 'sk-crash-mult ' + (won ? 'win' : 'lose');
    drawCurve([], crash, !won); pushRecent(crash);
    return { won, profit: rec.profit, multiplier: rec.multiplier, record: rec };
  }

  // ---------- helpers ----------
  function pushRecent(crash) {
    recent.unshift(crash); if (recent.length > 16) recent.pop();
    recentStrip.innerHTML = '';
    for (const c of recent) recentStrip.append(h('span.sk-crash-tag.' + (c < 2 ? 'lo' : c < 10 ? 'mid' : 'hi'), {}, c.toFixed(2) + '×'));
  }
  function drawCurve(pts, cur, busted) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, hgt);
    const YMAX = Math.max(4, cur * 1.1);
    const xN = Math.max(pts.length, 2);
    ctx.beginPath();
    ctx.moveTo(0, hgt - 2);
    if (pts.length > 1) {
      pts.forEach((m, i) => {
        const x = (i / (xN - 1)) * size;
        const y = hgt - 2 - (Math.log(m) / Math.log(YMAX)) * (hgt - 12);
        ctx.lineTo(x, Math.max(2, y));
      });
    } else {
      ctx.lineTo(size * 0.02, hgt - 2 - (Math.log(Math.max(1.01, cur)) / Math.log(YMAX)) * (hgt - 12));
    }
    ctx.strokeStyle = busted ? getVar('--sk-down') : getVar('--sk-accent');
    ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.lineTo(size * (pts.length > 1 ? 1 : 0.02), hgt - 2); ctx.closePath();
    ctx.fillStyle = (busted ? getVar('--sk-down') : getVar('--sk-accent')) + '22'; ctx.fill();
  }
  function kv(label, val, key) { return h('div.sk-kv', { dataset: { k: key } }, [h('span.k', {}, label), h('span.v', {}, val)]); }
  function setK(key, val) { const n = autoStat.querySelector('[data-k="' + key + '"] .v'); if (n) n.textContent = val; }
}

function getVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#00e701'; }
