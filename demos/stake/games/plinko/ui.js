// ============================================================
//  Plinko UI — canvas board; drop balls that bounce to their fair
//  slot. Manual/Auto via the shared bet panel.
// ============================================================

import { runBet } from '../game-base.js';
import { betPanel } from '../../ui/bet-panel.js';
import { h, refreshIcons } from '../../ui/components.js';
import { ensureStyle } from '../../ui/style-loader.js';
import { logic, buildTable, ROW_OPTIONS, RISKS } from './logic.js';

ensureStyle(new URL('./style.css', import.meta.url).href);
const GAME = { id: 'plinko', logic };

function tierColor(m) {
  if (m < 0.8) return '#c1362f';
  if (m < 1.2) return '#d99a2b';
  if (m < 3) return '#22d3a6';
  if (m < 10) return '#7c5cff';
  return '#e0b64d';
}

export function create(env) {
  let rows = 16, risk = 'medium';
  let table = buildTable(rows, risk);

  const W = 360, H = 380;
  const canvas = h('canvas.sk-plinko-canvas', { width: W, height: H });
  const ctx = canvas.getContext('2d');
  const balls = [];
  let flashSlot = -1, flashUntil = 0, raf = null;

  const rowSel = h('select.sk-select', {}, ROW_OPTIONS.map((r) => h('option', { value: r }, String(r))));
  rowSel.value = '16';
  const riskSel = h('select.sk-select', {}, RISKS.map((r) => h('option', { value: r }, r)));
  riskSel.value = 'medium';
  rowSel.onchange = riskSel.onchange = () => { rows = Number(rowSel.value); risk = riskSel.value; table = buildTable(rows, risk); drawStatic(); };

  const geom = () => {
    const top = 24, slotH = 34;
    const pegTop = top, pegBottom = H - slotH - 14;
    const slotW = W / (rows + 1);
    return { top, slotH, pegTop, pegBottom, slotW };
  };

  function drawStatic() {
    const { pegTop, pegBottom, slotH, slotW } = geom();
    ctx.clearRect(0, 0, W, H);
    // pegs
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let r = 0; r < rows; r++) {
      const count = r + 2;
      const y = pegTop + (r / (rows - 1)) * (pegBottom - pegTop);
      const rowW = (count - 1) * (W / (rows + 1));
      const x0 = (W - rowW) / 2;
      for (let c = 0; c < count; c++) {
        ctx.beginPath(); ctx.arc(x0 + c * (W / (rows + 1)), y, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    // slots
    for (let i = 0; i <= rows; i++) {
      const x = i * slotW, y = H - slotH;
      ctx.fillStyle = tierColor(table[i]) + (i === flashSlot ? 'ff' : 'cc');
      roundRect(ctx, x + 2, y, slotW - 4, slotH - 2, 5); ctx.fill();
      ctx.fillStyle = '#0b1620'; ctx.font = 'bold ' + (rows > 12 ? 8 : 10) + 'px system-ui';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const t = table[i];
      ctx.fillText(t < 100 ? t + '×' : t + '', x + slotW / 2, y + slotH / 2 - 1);
    }
  }

  function loop() {
    drawStatic();
    const now = performance.now();
    for (const b of balls) {
      const p = Math.min(1, (now - b.start) / b.dur);
      const { pegTop, pegBottom, slotW } = geom();
      const targetX = (b.slot + 0.5) * slotW;
      const y = pegTop + p * (pegBottom - pegTop + 20);
      // wobble along the path for realism, converging to target
      const wob = Math.sin(p * rows * Math.PI) * (1 - p) * (slotW * 0.5);
      const x = W / 2 + (targetX - W / 2) * p + wob;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd54a'; ctx.fill();
      if (p >= 1 && !b.done) { b.done = true; flashSlot = b.slot; flashUntil = now + 500; }
    }
    for (let i = balls.length - 1; i >= 0; i--) if (balls[i].done) balls.splice(i, 1);
    if (now > flashUntil) flashSlot = -1;
    if (balls.length || flashSlot >= 0) raf = requestAnimationFrame(loop);
    else { raf = null; drawStatic(); }
  }
  function dropBall(slot) {
    balls.push({ slot, start: performance.now(), dur: 850, done: false });
    if (!raf) raf = requestAnimationFrame(loop);
  }

  async function singleBet(wager) {
    const { record, result } = await runBet(env, GAME, wager, { rows, risk });
    return { won: record.won, profit: record.profit, multiplier: record.multiplier, record, slot: result.meta.slot };
  }
  const panel = betPanel(env, { singleBet, actionLabel: 'Drop', onResult: (res) => dropBall(res.slot) });

  const board = h('div.sk-plinko-board', {}, [
    canvas,
    h('div.sk-plinko-controls', {}, [
      h('div.sk-field', {}, [h('label.sk-label', {}, 'Rows'), rowSel]),
      h('div.sk-field', {}, [h('label.sk-label', {}, 'Risk'), riskSel]),
    ]),
  ]);

  drawStatic();
  return { node: h('div.sk-game.sk-game-plinko', {}, [panel.node, h('div.sk-board-wrap', {}, [board])]), onMount: () => refreshIcons() };
}

function roundRect(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
