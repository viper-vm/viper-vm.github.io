// ============================================================
//  Bet panel — the shared Manual / Auto control column used by
//  the stateless games (Dice, Limbo). Auto mode wires straight
//  into the AutoBet progression engine, so every game gets
//  Martingale/Paroli/etc. for free.
// ============================================================

import { h, amountField, segmented, refreshIcons, icon } from './components.js';
import { signedMoney, money } from '../core/format.js';
import { AutoBet, PRESETS } from '../core/strategy.js';

export function betPanel(env, opts) {
  const {
    singleBet,               // async (wager) => { won, profit, multiplier, record } | { error }
    actionLabel = 'Bet',
    amountLabel = 'Bet Amount',
    validate,                // optional () => errString | null
    onResult,                // optional (result) => void
  } = opts;

  const amt = amountField(env.wallet, { value: 1 });
  if (amountLabel !== 'Bet Amount') amt.node.querySelector('.sk-label').textContent = amountLabel;

  // ----- Manual -----
  const manualBtn = h('button.sk-action-btn', { type: 'button' }, actionLabel);
  manualBtn.onclick = async () => {
    if (validate) { const e = validate(); if (e) return env.bus.emit('toast', { message: e, tone: 'warn' }); }
    const wager = amt.get();
    const err = env.wallet.validateBet(wager);
    if (err) return env.bus.emit('toast', { message: err, tone: 'warn' });
    manualBtn.disabled = true;
    const res = await singleBet(wager);
    manualBtn.disabled = false;
    if (res && res.error) env.bus.emit('toast', { message: res.error, tone: 'warn' });
    else if (res && onResult) onResult(res);
  };
  const manualPane = h('div.sk-pane', {}, [manualBtn]);

  // ----- Auto -----
  const presetSel = h('select.sk-select', {},
    Object.entries(PRESETS).map(([k, v]) => h('option', { value: k }, v.label)));
  const presetDesc = h('div.sk-hint', {}, PRESETS.flat.desc);

  const num = numField('Number of Bets', 0, { hint: '0 = ∞' });
  const stopProfit = numField('Stop on Profit ($)', 0);
  const stopLoss = numField('Stop on Loss ($)', 0);
  const speed = segmented(
    [{ label: 'Fast', value: 0 }, { label: 'Normal', value: 120 }, { label: 'Slow', value: 400 }],
    { value: 120 });

  // custom rule fields (shown only for preset=custom)
  const winMode = ruleSelect(); const winVal = numField('by', 100, { compact: true });
  const lossMode = ruleSelect('multiply'); const lossVal = numField('by', 2, { compact: true });
  const customBox = h('div.sk-custom-rules', { style: { display: 'none' } }, [
    h('div.sk-rule-row', {}, [h('span.sk-rule-tag.win', {}, 'On win'), winMode.node, winVal.node]),
    h('div.sk-rule-row', {}, [h('span.sk-rule-tag.loss', {}, 'On loss'), lossMode.node, lossVal.node]),
  ]);
  presetSel.onchange = () => {
    presetDesc.textContent = PRESETS[presetSel.value]?.desc || '';
    customBox.style.display = presetSel.value === 'custom' ? 'flex' : 'none';
  };

  const autoStat = h('div.sk-auto-stat', {}, [
    kv('Bets', '0', 'a-bets'), kv('Profit', '$0.00', 'a-profit'), kv('Streak', '—', 'a-streak'),
  ]);
  const setStat = (sel, val) => { const n = autoStat.querySelector('[data-k="' + sel + '"] .v'); if (n) n.textContent = val; };

  const startBtn = h('button.sk-action-btn.auto', { type: 'button' }, [icon('play'), ' Start Autobet']);
  let auto = null;
  startBtn.onclick = () => {
    if (auto && auto.running) { auto.stop(); return; }
    if (validate) { const e = validate(); if (e) return env.bus.emit('toast', { message: e, tone: 'warn' }); }
    const base = amt.get();
    if (env.wallet.validateBet(base)) return env.bus.emit('toast', { message: env.wallet.validateBet(base), tone: 'warn' });
    auto = new AutoBet({
      betFn: async (wager) => {
        const err = env.wallet.validateBet(wager);
        if (err) return { error: err };
        const res = await singleBet(wager);
        if (res && res.error) return res;
        if (onResult) onResult(res);
        return res;
      },
      settings: {
        preset: presetSel.value, baseBet: base,
        custom: { onWin: { mode: winMode.value(), value: winVal.get() }, onLoss: { mode: lossMode.value(), value: lossVal.get() } },
        numBets: num.get(), stopProfit: stopProfit.get(), stopLoss: stopLoss.get(),
        delayMs: speed.get(),
      },
      onTick: (t) => {
        setStat('a-bets', String(t.count));
        setStat('a-profit', signedMoney(t.profit));
        setStat('a-streak', (t.won ? 'W' : 'L'));
        autoStat.querySelector('[data-k="a-profit"]').className = 'sk-kv tone-' + (t.profit >= 0 ? 'up' : 'down');
      },
      onStateChange: (st) => {
        startBtn.innerHTML = '';
        if (st.running) { startBtn.append(icon('square'), document.createTextNode(' Stop Autobet')); startBtn.classList.add('running'); }
        else {
          startBtn.append(icon('play'), document.createTextNode(' Start Autobet'));
          startBtn.classList.remove('running');
          if (st.reason && st.reason !== 'stopped') env.bus.emit('toast', { message: `Autobet stopped — ${st.reason}`, tone: 'info' });
        }
        refreshIcons();
      },
    });
    auto.start();
  };

  const autoPane = h('div.sk-pane', { style: { display: 'none' } }, [
    h('div.sk-field-2', {}, [wrap('Strategy', presetSel), presetDesc]),
    customBox,
    h('div.sk-field-grid', {}, [num.node, speed && wrap('Speed', speed.node)]),
    h('div.sk-field-grid', {}, [stopProfit.node, stopLoss.node]),
    startBtn,
    autoStat,
  ]);

  // ----- mode toggle -----
  const mode = segmented([{ label: 'Manual', value: 'manual' }, { label: 'Auto', value: 'auto' }], {
    value: 'manual',
    onChange: (v) => {
      manualPane.style.display = v === 'manual' ? 'block' : 'none';
      autoPane.style.display = v === 'auto' ? 'block' : 'none';
    },
  });

  const node = h('div.sk-betpanel', {}, [
    mode.node,
    amt.node,
    manualPane,
    autoPane,
  ]);

  return { node, getAmount: amt.get, setAmount: amt.set, amountField: amt };

  // helpers
  function wrap(label, control) { return h('div.sk-field', {}, [h('label.sk-label', {}, label), control]); }
  function kv(label, val, key) {
    return h('div.sk-kv', { dataset: { k: key } }, [h('span.k', {}, label), h('span.v', {}, val)]);
  }
  function numField(label, value, o = {}) {
    const input = h('input.sk-num', { type: 'number', step: 'any', value });
    const node = h('div.sk-field' + (o.compact ? '.compact' : ''), {}, [
      h('label.sk-label', {}, label),
      input,
      o.hint ? h('span.sk-hint', {}, o.hint) : null,
    ]);
    return { node, get: () => Number(input.value) || 0, set: (v) => { input.value = v; } };
  }
  function ruleSelect(def = 'reset') {
    const sel = h('select.sk-select.sm', {}, [
      h('option', { value: 'reset' }, 'reset to base'),
      h('option', { value: 'multiply' }, 'multiply ×'),
      h('option', { value: 'increase' }, 'increase %'),
      h('option', { value: 'decrease' }, 'decrease %'),
    ]);
    sel.value = def;
    return { node: sel, value: () => sel.value };
  }
}
