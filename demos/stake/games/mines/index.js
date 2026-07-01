// ============================================================
//  Mines — 5×5 grid with N hidden mines. Reveal gems to grow the
//  multiplier; cash out any time. Hit a mine and lose the bet.
//  Fair: 25 floats → Fisher–Yates shuffle → first N cells are mines.
//  cashMult(mines,k) = (1−edge)·Π (25−i)/(25−mines−i), i=0..k−1
// ============================================================

import { registry } from '../../core/registry.js';
import { placeWager, drawFloats, settle } from '../game-base.js';
import { h, amountField, segmented, refreshIcons, icon } from '../../ui/components.js';
import { AutoBet, PRESETS } from '../../core/strategy.js';
import { money, mult, signedMoney } from '../../core/format.js';

const EDGE = 0.01;
const TILES = 25;

function bombPositions(floats, mines) {
  const idx = [...Array(TILES).keys()];
  for (let i = TILES - 1; i > 0; i--) {
    const j = Math.floor((floats[TILES - 1 - i] ?? Math.random()) * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return new Set(idx.slice(0, mines));
}
function cashMult(mines, k) {
  let m = 1 - EDGE;
  for (let i = 0; i < k; i++) m *= (TILES - i) / (TILES - mines - i);
  return m;
}

const logic = {
  floatsNeeded: () => TILES,
  resolve(floats, params) {
    const mines = clampMines(params.mines);
    const picks = Math.min(params.picks ?? 3, TILES - mines);
    const bombs = bombPositions(floats, mines);
    let won = true;
    for (let c = 0; c < picks; c++) if (bombs.has(c)) { won = false; break; }
    const m = won ? cashMult(mines, picks) : 0;
    return { won, multiplier: m, detail: `${mines} mines · ${picks} picks`, meta: { mines, picks, won } };
  },
  strategy: {
    controls: [
      { key: 'mines', label: 'Mines', type: 'number', default: 3, min: 1, max: 24, step: 1 },
      { key: 'picks', label: 'Tiles to reveal', type: 'number', default: 3, min: 1, max: 24, step: 1 },
    ],
    defaults: () => ({ mines: 3, picks: 3 }),
  },
};

function clampMines(n) { return Math.max(1, Math.min(24, Math.round(n || 3))); }

function create(env) {
  let mines = 3;
  let round = null; // { wager, bombs, revealed:Set, over:boolean }

  // ----- grid -----
  const cells = [];
  const grid = h('div.sk-mines-grid', {});
  for (let i = 0; i < TILES; i++) {
    const cell = h('button.sk-mine-cell', { type: 'button' });
    cell.onclick = () => onReveal(i);
    cells.push(cell);
    grid.appendChild(cell);
  }

  // ----- controls -----
  const amt = amountField(env.wallet, { value: 1, onChange: () => syncBet() });
  function syncBet() { const bad = !(amt.get() > 0); if (!round) betBtn.disabled = bad; autoBtn.disabled = bad; }
  const minesSel = h('select.sk-select', {},
    Array.from({ length: 24 }, (_, i) => h('option', { value: i + 1 }, String(i + 1))));
  minesSel.value = '3';
  minesSel.onchange = () => { if (!round) mines = clampMines(Number(minesSel.value)); refreshInfo(); };

  const multOut = info('Next tile', mult(cashMult(3, 1)));
  const potOut = info('Profit on cashout', '$0.00');

  const betBtn = h('button.sk-action-btn', { type: 'button' }, 'Bet');
  const cashBtn = h('button.sk-action-btn.cashout', { type: 'button', style: { display: 'none' } }, 'Cashout');
  betBtn.onclick = startRound;
  cashBtn.onclick = () => endRound(true);

  // ----- auto -----
  const autoPicks = h('input.sk-num', { type: 'number', min: 1, max: 24, value: 3 });
  const presetSel = h('select.sk-select', {}, Object.entries(PRESETS).map(([k, v]) => h('option', { value: k }, v.label)));
  const numBets = h('input.sk-num', { type: 'number', value: 0 });
  const stopProfit = h('input.sk-num', { type: 'number', value: 0 });
  const stopLoss = h('input.sk-num', { type: 'number', value: 0 });
  const autoStat = h('div.sk-auto-stat', {}, [kv('Bets', '0', 'b'), kv('Profit', '$0.00', 'p')]);
  const autoBtn = h('button.sk-action-btn.auto', { type: 'button' }, [icon('play'), ' Start Autobet']);
  let auto = null;
  autoBtn.onclick = () => {
    if (auto && auto.running) { auto.stop(); return; }
    const base = amt.get();
    const err = env.wallet.validateBet(base);
    if (err) return env.bus.emit('toast', { message: err, tone: 'warn' });
    const picks = Math.max(1, Math.min(24 - mines + 1, Number(autoPicks.value) || 3));
    auto = new AutoBet({
      betFn: (wager) => autoRound(wager, picks),
      settings: { preset: presetSel.value, baseBet: base, numBets: Number(numBets.value) || 0,
        stopProfit: Number(stopProfit.value) || 0, stopLoss: Number(stopLoss.value) || 0, delayMs: 220,
        alive: () => document.body.contains(autoBtn) },
      onTick: (t) => { setK('b', String(t.count)); setK('p', signedMoney(t.profit)); },
      onStateChange: (st) => {
        autoBtn.innerHTML = '';
        autoBtn.append(icon(st.running ? 'square' : 'play'), document.createTextNode(st.running ? ' Stop Autobet' : ' Start Autobet'));
        autoBtn.classList.toggle('running', !!st.running);
        setControlsDisabled(!!st.running);
        refreshIcons();
      },
    });
    auto.start();
  };

  // ----- mode tabs -----
  const manualPane = h('div.sk-pane', {}, [
    h('div.sk-field', {}, [h('label.sk-label', {}, 'Mines'), minesSel]),
    h('div.sk-field-grid', {}, [multOut.node, potOut.node]),
    betBtn, cashBtn,
  ]);
  const autoPane = h('div.sk-pane', { style: { display: 'none' } }, [
    h('div.sk-field-grid', {}, [
      h('div.sk-field', {}, [h('label.sk-label', {}, 'Mines'), minesSel.cloneNode(true)]),
      h('div.sk-field', {}, [h('label.sk-label', {}, 'Reveal tiles'), autoPicks]),
    ]),
    h('div.sk-field', {}, [h('label.sk-label', {}, 'Strategy'), presetSel]),
    h('div.sk-field-grid', {}, [
      h('div.sk-field', {}, [h('label.sk-label', {}, 'Number of Bets'), numBets]),
      h('div.sk-field', {}, [h('label.sk-label', {}, 'Stop Profit ($)'), stopProfit]),
    ]),
    h('div.sk-field-grid', {}, [h('div.sk-field', {}, [h('label.sk-label', {}, 'Stop Loss ($)'), stopLoss])]),
    autoBtn, autoStat,
  ]);
  // keep the cloned auto mines-select in sync
  const autoMinesSel = autoPane.querySelector('select');
  autoMinesSel.value = '3';
  autoMinesSel.onchange = () => { mines = clampMines(Number(autoMinesSel.value)); minesSel.value = String(mines); refreshInfo(); };

  const mode = segmented([{ label: 'Manual', value: 'manual' }, { label: 'Auto', value: 'auto' }], {
    onChange: (v) => { manualPane.style.display = v === 'manual' ? 'block' : 'none'; autoPane.style.display = v === 'auto' ? 'block' : 'none'; },
  });
  const panel = h('div.sk-betpanel', {}, [mode.node, amt.node, manualPane, autoPane]);

  refreshInfo();
  resetGrid();
  syncBet();

  return {
    node: h('div.sk-game.sk-game-mines', {}, [panel, h('div.sk-board-wrap', {}, [h('div.sk-mines-board', {}, [grid])])]),
    onMount: () => refreshIcons(),
  };

  // ---------- interactive round ----------
  function startRound() {
    const wager = amt.get();
    const err = env.wallet.validateBet(wager);
    if (err) return env.bus.emit('toast', { message: err, tone: 'warn' });
    mines = clampMines(Number(minesSel.value));
    const placed = placeWager(env, wager);
    if (!placed.ok) return env.bus.emit('toast', { message: placed.error, tone: 'warn' });
    drawFloats(env, TILES).then(({ floats, ctx }) => {
      round = { wager, bombs: bombPositions(floats, mines), revealed: new Set(), over: false, ctx };
      resetGrid();
      cells.forEach((c) => c.classList.add('armed'));
      betBtn.style.display = 'none';
      cashBtn.style.display = 'block';
      cashBtn.disabled = true;
      setControlsDisabled(true, true);
      refreshInfo();
    });
  }

  function onReveal(i) {
    if (!round || round.over || round.revealed.has(i)) return;
    if (round.bombs.has(i)) {
      round.revealed.add(i);
      cells[i].classList.add('bomb', 'boom');
      cells[i].innerHTML = '💣';
      endRound(false);
      return;
    }
    round.revealed.add(i);
    const cell = cells[i];
    cell.classList.add('gem');
    cell.innerHTML = '💎';
    const k = round.revealed.size;
    cashBtn.disabled = false;
    const m = cashMult(mines, k);
    cashBtn.textContent = `Cashout ${mult(m)}`;
    if (k >= TILES - mines) endRound(true); // all gems found
    refreshInfo(k);
  }

  async function endRound(cashout) {
    if (!round || round.over) return;
    round.over = true;
    const k = round.revealed.size;
    const won = cashout && k > 0;
    const m = won ? cashMult(mines, k) : 0;
    const payout = won ? round.wager * m : 0;
    revealAll(round.bombs);
    await settle(env, {
      game: 'mines', wager: round.wager, multiplier: m, payout, won,
      detail: `${mines} mines · ${k} gems${won ? '' : ' · boom'}`,
      meta: { mines, gems: k, cashout: !!cashout }, fairCtx: round.ctx,
    });
    env.bus.emit('toast', won
      ? { message: `Cashed out ${mult(m)} — ${signedMoney(payout - round.wager)}`, tone: 'success' }
      : { message: `Boom! Lost ${money(round.wager)}`, tone: 'danger' });
    round = null;
    betBtn.style.display = 'block';
    cashBtn.style.display = 'none';
    setControlsDisabled(false);
    refreshInfo();
  }

  // ---------- auto round (headless-ish, animated) ----------
  async function autoRound(wager, picks) {
    const err = env.wallet.validateBet(wager);
    if (err) return { error: err };
    placeWager(env, wager);
    const { floats, ctx } = await drawFloats(env, TILES);
    const bombs = bombPositions(floats, mines);
    resetGrid();
    let survived = true; let k = 0;
    for (let c = 0; c < picks; c++) {
      if (bombs.has(c)) { survived = false; cells[c].classList.add('bomb'); cells[c].innerHTML = '💣'; break; }
      cells[c].classList.add('gem'); cells[c].innerHTML = '💎'; k = c + 1;
    }
    const m = survived ? cashMult(mines, picks) : 0;
    const payout = survived ? wager * m : 0;
    if (!survived) revealAll(bombs);
    const record = await settle(env, {
      game: 'mines', wager, multiplier: m, payout, won: survived,
      detail: `${mines} mines · ${picks} picks${survived ? '' : ' · boom'}`,
      meta: { mines, picks, survived }, fairCtx: ctx,
    });
    return { won: survived, profit: record.profit, multiplier: record.multiplier, record };
  }

  // ---------- helpers ----------
  function resetGrid() {
    cells.forEach((c) => { c.className = 'sk-mine-cell'; c.innerHTML = ''; });
  }
  function revealAll(bombs) {
    cells.forEach((c, i) => {
      c.classList.add('revealed');
      if (!c.classList.contains('gem') && !c.classList.contains('bomb')) {
        c.classList.add(bombs.has(i) ? 'bomb-dim' : 'gem-dim');
        c.innerHTML = bombs.has(i) ? '💣' : '💎';
      }
    });
  }
  function refreshInfo(k) {
    const revealed = k ?? (round ? round.revealed.size : 0);
    const nextK = revealed + 1;
    multOut.value.textContent = mult(cashMult(mines, Math.min(nextK, TILES - mines)));
    if (round && revealed > 0) {
      const m = cashMult(mines, revealed);
      potOut.value.textContent = signedMoney(round.wager * m - round.wager);
    } else potOut.value.textContent = '$0.00';
  }
  function setControlsDisabled(disabled, keepCashout) {
    minesSel.disabled = disabled; autoMinesSel.disabled = disabled; amt.input.disabled = disabled;
    if (!keepCashout) { /* betBtn managed elsewhere */ }
  }
  function info(label, value) {
    const v = h('div.sk-stat-value', {}, value);
    return { node: h('div.sk-dice-stat', {}, [h('div.sk-stat-label', {}, label), v]), value: v };
  }
  function kv(label, val, key) { return h('div.sk-kv', { dataset: { k: key } }, [h('span.k', {}, label), h('span.v', {}, val)]); }
  function setK(key, val) { const n = autoStat.querySelector('[data-k="' + key + '"] .v'); if (n) n.textContent = val; }
}

export const def = {
  id: 'mines', name: 'Mines', tagline: 'Find the gems, dodge the mines',
  icon: 'bomb', accent: '#ff5c8a', category: 'Originals', houseEdge: EDGE,
  rules: [
    'Choose how many mines hide on the 5×5 grid (1–24), then place your bet to start a round.',
    'Click tiles to reveal gems. Each safe reveal raises your multiplier — the more mines, the faster it climbs.',
    'Cash out any time to bank your winnings. Reveal a mine and you lose the bet.',
    'Mine positions are fixed provably-fair at the start of the round. Auto reveals a set number of tiles per round. House edge 1%.',
  ],
  logic, create,
};
registry.register(def);
