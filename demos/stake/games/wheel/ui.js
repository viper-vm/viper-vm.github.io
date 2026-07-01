// ============================================================
//  Wheel UI — spin a multiplier ring. Reuses the shared bet panel
//  for Manual/Auto (with progressions).
// ============================================================

import { runBet } from '../game-base.js';
import { betPanel } from '../../ui/bet-panel.js';
import { h, refreshIcons } from '../../ui/components.js';
import { ensureStyle } from '../../ui/style-loader.js';
import { mult } from '../../core/format.js';
import { logic, buildRing, SEG_OPTIONS, RISKS } from './logic.js';

ensureStyle(new URL('./style.css', import.meta.url).href);
const GAME = { id: 'wheel', logic };

function tierColor(m) {
  if (m <= 0) return '#2a3038';
  if (m < 1.5) return '#3aa0ff';
  if (m < 3) return '#22d3a6';
  if (m < 8) return '#7c5cff';
  if (m < 25) return '#ff5c8a';
  return '#e0b64d';
}

export function create(env) {
  let segments = 30;
  let risk = 'medium';
  let ring = buildRing(segments, risk);
  let rotation = 0;

  const size = 300;
  const canvas = h('canvas.sk-wheel2-canvas', { width: size, height: size });
  const centerOut = h('div.sk-wheel2-center', {}, '—');
  const wheelBox = h('div.sk-wheel2', {}, [h('div.sk-wheel2-pointer', {}), canvas, centerOut]);

  const segSel = h('select.sk-select', {}, SEG_OPTIONS.map((s) => h('option', { value: s }, String(s))));
  segSel.value = '30';
  const riskSel = h('select.sk-select', {}, RISKS.map((r) => h('option', { value: r }, r)));
  riskSel.value = 'medium';
  segSel.onchange = riskSel.onchange = () => { segments = Number(segSel.value); risk = riskSel.value; ring = buildRing(segments, risk); draw(); };

  function draw() {
    const ctx = canvas.getContext('2d');
    const cx = size / 2, cy = size / 2, R = size / 2 - 4;
    ctx.clearRect(0, 0, size, size);
    const seg = (Math.PI * 2) / ring.length;
    for (let i = 0; i < ring.length; i++) {
      const a0 = -Math.PI / 2 + i * seg, a1 = a0 + seg;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath();
      ctx.fillStyle = tierColor(ring[i]); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
      if (ring.length <= 30) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a0 + seg / 2);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#0b1620'; ctx.font = 'bold 10px system-ui';
        ctx.fillText(ring[i] ? ring[i].toFixed(ring[i] < 10 ? 1 : 0) + 'x' : '—', R - 6, 0); ctx.restore();
      }
    }
    ctx.beginPath(); ctx.arc(cx, cy, 46, 0, Math.PI * 2); ctx.fillStyle = 'var(--sk-surface)'; ctx.fill();
  }

  async function singleBet(wager) {
    const { record, result } = await runBet(env, GAME, wager, { segments, risk, ring });
    return { won: record.won, profit: record.profit, multiplier: record.multiplier, record, idx: result.meta.idx, m: result.meta.mult };
  }
  function spinTo(idx, m) {
    const seg = 360 / ring.length;
    const targetMod = (360 - (idx * seg + seg / 2)) % 360;
    let base = rotation - (rotation % 360);
    let next = base + 360 * 4 + targetMod;
    while (next <= rotation + 360) next += 360;
    rotation = next;
    canvas.style.transition = 'transform 1.2s cubic-bezier(0.15,0.85,0.2,1)';
    canvas.style.transform = `rotate(${rotation}deg)`;
    centerOut.textContent = '…';
    setTimeout(() => { centerOut.textContent = mult(m); centerOut.className = 'sk-wheel2-center ' + (m > 1 ? 'win' : 'lose'); }, 1250);
  }

  const panel = betPanel(env, {
    singleBet, actionLabel: 'Spin',
    onResult: (res) => spinTo(res.idx, res.m),
  });

  const board = h('div.sk-wheel2-board', {}, [
    wheelBox,
    h('div.sk-wheel2-controls', {}, [
      h('div.sk-field', {}, [h('label.sk-label', {}, 'Segments'), segSel]),
      h('div.sk-field', {}, [h('label.sk-label', {}, 'Risk'), riskSel]),
    ]),
  ]);

  draw();
  return { node: h('div.sk-game.sk-game-wheel', {}, [panel.node, h('div.sk-board-wrap', {}, [board])]), onMount: () => refreshIcons() };
}
