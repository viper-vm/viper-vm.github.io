// ============================================================
//  Dice — roll 0.00–100.00, bet OVER or UNDER a target.
//  Fair: 1 float → roll = float×100. House edge baked into the
//  payout multiplier = (1 − edge) / winChance.
// ============================================================

import { registry } from '../../core/registry.js';
import { runBet } from '../game-base.js';
import { betPanel } from '../../ui/bet-panel.js';
import { h, refreshIcons } from '../../ui/components.js';
import { mult, pct } from '../../core/format.js';

const EDGE = 0.01;

function chanceOf(target, direction) {
  return direction === 'over' ? (100 - target) / 100 : target / 100;
}
function multiplierOf(target, direction) {
  const c = chanceOf(target, direction);
  return c > 0 ? (1 - EDGE) / c : 0;
}

const logic = {
  floatsNeeded: () => 1,
  resolve(floats, params) {
    const { target, direction } = params;
    const roll = floats[0] * 100;
    const won = direction === 'over' ? roll > target : roll < target;
    const payoutMult = multiplierOf(target, direction);
    return {
      won,
      multiplier: won ? payoutMult : 0,
      detail: `Rolled ${roll.toFixed(2)} · ${direction} ${target.toFixed(2)}`,
      meta: { roll, target, direction, potentialMultiplier: payoutMult, chance: chanceOf(target, direction) },
    };
  },
  strategy: {
    controls: [
      { key: 'target', label: 'Target', type: 'number', default: 50, min: 2, max: 98, step: 0.01 },
      { key: 'direction', label: 'Direction', type: 'select', default: 'over', options: [
        { value: 'over', label: 'Roll Over' }, { value: 'under', label: 'Roll Under' }] },
    ],
    defaults: () => ({ target: 50, direction: 'over' }),
  },
};

function create(env) {
  let target = 50;
  let direction = 'over';

  // ----- board -----
  const zoneLose = h('div.sk-dice-zone.lose', {});
  const zoneWin = h('div.sk-dice-zone.win', {});
  const handle = h('div.sk-dice-handle', {}, [h('span.sk-dice-handle-val', {}, '50.00')]);
  const pointer = h('div.sk-dice-pointer', { style: { left: '50%', opacity: '0' } }, [
    h('div.sk-dice-bubble', {}, '0.00'),
    h('div.sk-dice-arrow', {}),
  ]);
  const range = h('input.sk-dice-range', { type: 'range', min: 2, max: 98, step: 0.01, value: 50 });
  const track = h('div.sk-dice-track', {}, [zoneLose, zoneWin, pointer, handle]);
  const scale = h('div.sk-dice-scale', {}, [0, 25, 50, 75, 100].map((n) => h('span', {}, String(n))));

  const dirBtn = h('button.sk-dice-dir', { type: 'button' }, 'Roll Over');
  const multOut = statBox('Multiplier', mult(multiplierOf(50, 'over')));
  const targOut = statBox('Roll Over', '50.00');
  const chanceOut = statBox('Win Chance', pct(chanceOf(50, 'over')));

  function paint() {
    const t = target;
    if (direction === 'over') {
      zoneLose.style.left = '0%'; zoneLose.style.width = t + '%';
      zoneWin.style.left = t + '%'; zoneWin.style.width = (100 - t) + '%';
      targOut.label.textContent = 'Roll Over';
    } else {
      zoneWin.style.left = '0%'; zoneWin.style.width = t + '%';
      zoneLose.style.left = t + '%'; zoneLose.style.width = (100 - t) + '%';
      targOut.label.textContent = 'Roll Under';
    }
    handle.style.left = t + '%';
    handle.querySelector('.sk-dice-handle-val').textContent = t.toFixed(2);
    multOut.value.textContent = mult(multiplierOf(t, direction));
    targOut.value.textContent = t.toFixed(2);
    chanceOut.value.textContent = pct(chanceOf(t, direction));
  }
  range.oninput = () => { target = Number(range.value); paint(); };
  dirBtn.onclick = () => {
    direction = direction === 'over' ? 'under' : 'over';
    dirBtn.textContent = direction === 'over' ? 'Roll Over' : 'Roll Under';
    paint();
  };

  function showResult(roll, won) {
    pointer.style.opacity = '1';
    pointer.style.left = roll + '%';
    pointer.querySelector('.sk-dice-bubble').textContent = roll.toFixed(2);
    pointer.classList.toggle('win', won);
    pointer.classList.toggle('lose', !won);
  }

  // ----- bet wiring -----
  async function singleBet(wager) {
    const { record, result } = await runBet(env, def, wager, { target, direction, edge: EDGE });
    return { won: record.won, profit: record.profit, multiplier: record.multiplier, record, roll: result.meta.roll };
  }
  const panel = betPanel(env, {
    singleBet, actionLabel: 'Roll Dice',
    onResult: (res) => showResult(res.roll, res.won),
  });

  const board = h('div.sk-dice-board', {}, [
    h('div.sk-dice-stats', {}, [dirBtn, multOut.node, targOut.node, chanceOut.node]),
    h('div.sk-dice-slider', {}, [track, range, scale]),
  ]);

  paint();

  return {
    node: h('div.sk-game.sk-game-dice', {}, [panel.node, h('div.sk-board-wrap', {}, [board])]),
    onMount: () => refreshIcons(),
  };
}

function statBox(label, value) {
  const l = h('div.sk-stat-label', {}, label);
  const v = h('div.sk-stat-value', {}, value);
  return { node: h('div.sk-dice-stat', {}, [l, v]), label: l, value: v };
}

export const def = {
  id: 'dice', name: 'Dice', tagline: 'Roll over or under your target',
  icon: 'dices', accent: '#7c5cff', category: 'Originals', houseEdge: EDGE,
  rules: [
    'Drag the slider to set your target, and choose whether to win by rolling OVER or UNDER it.',
    'A provably-fair number from 0.00 to 99.99 is rolled. You win if it lands on your chosen side.',
    'Your win chance sets the payout: multiplier = (100 − 1% edge) ÷ win chance. Slimmer chances pay more.',
    'Use Auto with a progression (Martingale, etc.) and stop conditions to run hands-free. House edge 1%.',
  ],
  logic, create,
};
registry.register(def);
