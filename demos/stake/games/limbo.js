// ============================================================
//  Limbo — pick a target multiplier; a crash multiplier is drawn.
//  Win target× your bet if crash ≥ target.
//  Fair: 1 float → crash = max(1, (1−edge)/(1−u)).
//  P(win) = (1−edge)/target, so EV = 1−edge for any target.
// ============================================================

import { registry } from '../core/registry.js';
import { runBet } from './game-base.js';
import { betPanel } from '../ui/bet-panel.js';
import { h, refreshIcons } from '../ui/components.js';
import { mult, pct } from '../core/format.js';

const EDGE = 0.01;
const CAP = 1000000;

function crashFrom(u) {
  return Math.min(CAP, Math.max(1, (1 - EDGE) / (1 - u)));
}

const logic = {
  floatsNeeded: () => 1,
  resolve(floats, params) {
    const target = Math.max(1.01, params.target);
    const crash = crashFrom(floats[0]);
    const won = crash >= target;
    return {
      won,
      multiplier: won ? target : 0,
      detail: `Crash ${crash.toFixed(2)}× · target ${target.toFixed(2)}×`,
      meta: { crash, target, chance: (1 - EDGE) / target },
    };
  },
  strategy: {
    controls: [{ key: 'target', label: 'Target ×', type: 'number', default: 2, min: 1.01, max: 1000, step: 0.01 }],
    defaults: () => ({ target: 2 }),
  },
};

function create(env) {
  let target = 2;

  const bigMult = h('div.sk-limbo-mult', {}, '1.00×');
  const bigWrap = h('div.sk-limbo-display', {}, [bigMult, h('div.sk-limbo-sub', {}, 'target ' + target.toFixed(2) + '×')]);

  const targetInput = h('input.sk-num.big', { type: 'number', step: 0.01, min: 1.01, value: target });
  const chanceOut = h('div.sk-stat-value', {}, pct((1 - EDGE) / target));
  const payoutOut = h('div.sk-stat-value', {}, mult(target));

  function paint() {
    bigWrap.querySelector('.sk-limbo-sub').textContent = 'target ' + target.toFixed(2) + '×';
    chanceOut.textContent = pct((1 - EDGE) / target);
    payoutOut.textContent = mult(target);
  }
  targetInput.oninput = () => { target = Math.max(1.01, Number(targetInput.value) || 1.01); paint(); };

  let animId = null;
  function animateTo(crash, won) {
    if (animId) cancelAnimationFrame(animId);
    bigMult.classList.remove('win', 'lose');
    const dur = 700; const start = performance.now(); const from = 1;
    const to = crash;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = from + (to - from) * eased;
      bigMult.textContent = val.toFixed(2) + '×';
      if (p < 1) animId = requestAnimationFrame(step);
      else {
        bigMult.textContent = crash.toFixed(2) + '×';
        bigMult.classList.add(won ? 'win' : 'lose');
      }
    };
    animId = requestAnimationFrame(step);
  }

  async function singleBet(wager) {
    const { record, result } = await runBet(env, def, wager, { target });
    return { won: record.won, profit: record.profit, multiplier: record.multiplier, record, crash: result.meta.crash };
  }
  const panel = betPanel(env, {
    singleBet, actionLabel: 'Bet',
    onResult: (res) => animateTo(res.crash, res.won),
  });

  const board = h('div.sk-limbo-board', {}, [
    bigWrap,
    h('div.sk-limbo-controls', {}, [
      field('Target Multiplier', targetInput),
      h('div.sk-dice-stat', {}, [h('div.sk-stat-label', {}, 'Win Chance'), chanceOut]),
      h('div.sk-dice-stat', {}, [h('div.sk-stat-label', {}, 'Payout'), payoutOut]),
    ]),
  ]);

  paint();
  return {
    node: h('div.sk-game.sk-game-limbo', {}, [panel.node, h('div.sk-board-wrap', {}, [board])]),
    onMount: () => refreshIcons(),
  };

  function field(label, input) { return h('div.sk-field', {}, [h('label.sk-label', {}, label), input]); }
}

export const def = {
  id: 'limbo', name: 'Limbo', tagline: 'How high will it go before the crash?',
  icon: 'trending-up', accent: '#22d3a6', category: 'Originals', houseEdge: EDGE,
  logic, create,
};
registry.register(def);
