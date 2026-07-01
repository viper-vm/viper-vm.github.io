// ============================================================
//  Auto-spin / auto-bet modal — collects an auto session config
//  (spins, strategy progression, cap, safety stops) and hands it
//  back via onStart(settings). Reusable across table games.
//  Strategies apply to whatever the player has staked; the
//  progression scales the whole stake each round.
// ============================================================

import { openModal } from './modal.js';
import { h, icon, clear, refreshIcons } from './components.js';
import { money } from '../core/format.js';
import { KV } from '../core/store.js';
import { PRESETS } from '../core/strategy.js';

const SAVE_KEY = 'autostrats';
const PRESET_ORDER = ['flat', 'martingale', 'reverse', 'dalembert', 'paroli', 'custom'];
// closest on-win/on-loss display for named presets
const PRESET_RULES = {
  flat: { onWin: ['reset', 0], onLoss: ['reset', 0] },
  martingale: { onWin: ['reset', 0], onLoss: ['multiply', 2] },
  reverse: { onWin: ['multiply', 2], onLoss: ['reset', 0] },
  paroli: { onWin: ['multiply', 2], onLoss: ['reset', 0] },
  dalembert: { onWin: ['reset', 0], onLoss: ['reset', 0] },
};

export function openAutobetModal(env, { baseBet = 0, note = 'Auto-spin repeats whatever you have on the table.', onStart } = {}) {
  const strat = {
    preset: 'flat',
    onWin: { mode: 'reset', value: 0 },
    onLoss: { mode: 'multiply', value: 2 },
    cap: 0, stopLoss: 0, stopWin: 0,
  };
  let spins = 25;

  // ----- spins selector -----
  const spinsRow = h('div.sk-spin-count', {});
  [['10', 10], ['25', 25], ['50', 50], ['100', 100], ['∞', 0]].forEach(([label, val]) => {
    const b = h('button.sk-spin-opt', { type: 'button', onclick: () => { spins = val; syncSpins(); } }, label);
    if (val === spins) b.classList.add('active');
    b.dataset.val = val; spinsRow.appendChild(b);
  });
  function syncSpins() { [...spinsRow.children].forEach((b) => b.classList.toggle('active', Number(b.dataset.val) === spins)); }

  // ----- strategy summary / editor toggle -----
  const stratName = h('span.sk-strat-summary-name', {}, PRESETS.flat.label);
  const stratHeader = h('button.sk-strat-header', { type: 'button', onclick: () => toggleEditor() }, [
    h('span', {}, [icon('chevron-right'), ' Strategy ', h('span.sk-dim-note', {}, '(optional)')]),
    stratName,
  ]);
  const editor = buildEditor();
  editor.node.style.display = 'none';

  // ----- saved strategies -----
  const savedList = h('div.sk-saved-list', {});
  function renderSaved() {
    const saved = KV.get(SAVE_KEY, []);
    clear(savedList);
    if (!saved.length) { savedList.append(h('div.sk-saved-empty', {}, 'No strategies saved yet. Create one below, or just hit Start to run a flat repeat of your current bets.')); return; }
    for (const s of saved) {
      savedList.append(h('button.sk-saved-item', { type: 'button', onclick: () => applySaved(s) }, [
        h('span', {}, s.name),
        h('span.sk-saved-x', { onclick: (e) => { e.stopPropagation(); KV.set(SAVE_KEY, KV.get(SAVE_KEY, []).filter((x) => x.name !== s.name)); renderSaved(); } }, '×'),
      ]));
    }
  }
  function applySaved(s) { Object.assign(strat, s.strat); syncEditor(); stratName.textContent = s.name; env.bus.emit('toast', { message: `Loaded “${s.name}”`, tone: 'info' }); }

  const body = h('div.sk-autospin', {}, [
    h('label.sk-label', {}, 'Spins'),
    spinsRow,
    h('div.sk-base-box', {}, [
      h('div', {}, ['Base bet: ', h('strong', {}, money(baseBet)), ' per round']),
      h('div.sk-dim-note', {}, note),
    ]),
    h('div.sk-strat-box', {}, [stratHeader, editor.node]),
    h('div.sk-saved-head', {}, [h('label.sk-label', {}, 'Saved strategies')]),
    savedList,
    h('button.sk-chip-btn', { type: 'button', onclick: () => { toggleEditor(true); } }, [icon('plus'), ' New strategy']),
    h('div.sk-autospin-foot', {}, [
      h('button.sk-btn-ghost', { type: 'button', onclick: () => close() }, 'Cancel'),
      h('button.sk-btn-primary', { type: 'button', onclick: startNow }, 'Start auto-spin'),
    ]),
  ]);

  const { close } = openModal({ title: 'Auto-spin', icon: 'refresh-cw', body, width: '520px' });
  renderSaved();
  syncEditor();

  function toggleEditor(force) {
    const show = force || editor.node.style.display === 'none';
    editor.node.style.display = show ? 'block' : 'none';
    stratHeader.querySelector('i').style.transform = show ? 'rotate(90deg)' : '';
  }

  function startNow() {
    const settings = {
      numBets: spins,
      preset: strat.preset,
      custom: { onWin: strat.onWin, onLoss: strat.onLoss },
      cap: strat.cap, stopProfit: strat.stopWin, stopLoss: strat.stopLoss,
    };
    close();
    onStart && onStart(settings);
  }

  // ---------- editor ----------
  function buildEditor() {
    const cards = h('div.sk-preset-grid', {}, PRESET_ORDER.map((k) => {
      const c = h('button.sk-preset-card', { type: 'button', dataset: { k }, onclick: () => choosePreset(k) }, [
        h('strong', {}, PRESETS[k].label), h('span', {}, PRESETS[k].desc),
      ]);
      return c;
    }));
    const winSel = ruleSelect(); const winVal = h('input.sk-num', { type: 'number', value: 0 });
    const lossSel = ruleSelect('multiply'); const lossVal = h('input.sk-num', { type: 'number', value: 2 });
    winSel.onchange = lossSel.onchange = winVal.oninput = lossVal.oninput = () => setCustomFromInputs();

    const capNone = h('input', { type: 'checkbox', checked: true });
    const capVal = h('input.sk-num', { type: 'number', value: 0, disabled: true });
    capNone.onchange = () => { capVal.disabled = capNone.checked; sync(); };
    capVal.oninput = sync;

    const slNone = h('input', { type: 'checkbox', checked: true });
    const slVal = h('input.sk-num', { type: 'number', value: 0, disabled: true });
    const swNone = h('input', { type: 'checkbox', checked: true });
    const swVal = h('input.sk-num', { type: 'number', value: 0, disabled: true });
    slNone.onchange = () => { slVal.disabled = slNone.checked; sync(); };
    swNone.onchange = () => { swVal.disabled = swNone.checked; sync(); };
    slVal.oninput = swVal.oninput = sync;

    const hint = h('div.sk-strat-hint', {}, 'Strategies apply to whatever bets are on the table. Every action (double, reset, …) acts on the full stake — the progression scales it on loss and resets on a win.');

    const node = h('div.sk-strat-editor', {}, [
      cards, hint,
      row('On win', winSel, winVal),
      row('On loss', lossSel, lossVal),
      h('div.sk-strat-line', {}, [h('label.sk-label', {}, 'Progression cap'), h('div.sk-toggle-num', {}, [labelCheck(capNone, 'None'), capVal, h('span.sk-dim-note', {}, 'no cap')])]),
      h('div.sk-safety', {}, [
        h('label.sk-label', {}, 'Safety stops'),
        h('div.sk-strat-line', {}, [h('span', {}, 'Stop-loss ($)'), h('div.sk-toggle-num', {}, [labelCheck(slNone, 'None'), slVal, h('span.sk-dim-note', {}, 'off')])]),
        h('div.sk-strat-line', {}, [h('span', {}, 'Stop-win ($)'), h('div.sk-toggle-num', {}, [labelCheck(swNone, 'None'), swVal, h('span.sk-dim-note', {}, 'off')])]),
      ]),
      h('div.sk-strat-editor-foot', {}, [
        h('button.sk-btn-ghost', { type: 'button', onclick: () => toggleEditor(false) }, 'Close'),
        h('button.sk-btn-outline', { type: 'button', onclick: useStrategy }, 'Use'),
        h('button.sk-btn-primary', { type: 'button', onclick: saveStrategy }, 'Save'),
      ]),
    ]);

    function setCustomFromInputs() {
      strat.preset = 'custom';
      strat.onWin = { mode: winSel.value, value: Number(winVal.value) || 0 };
      strat.onLoss = { mode: lossSel.value, value: Number(lossVal.value) || 0 };
      highlightCards();
    }
    function sync() {
      strat.cap = capNone.checked ? 0 : (Number(capVal.value) || 0);
      strat.stopLoss = slNone.checked ? 0 : (Number(slVal.value) || 0);
      strat.stopWin = swNone.checked ? 0 : (Number(swVal.value) || 0);
    }
    function useStrategy() { sync(); stratName.textContent = strat.preset === 'custom' ? 'Custom' : PRESETS[strat.preset].label; toggleEditor(false); env.bus.emit('toast', { message: 'Strategy set for this session', tone: 'success' }); }
    function saveStrategy() {
      sync();
      const name = prompt('Name this strategy:'); if (!name) return;
      const saved = KV.get(SAVE_KEY, []).filter((x) => x.name !== name);
      saved.push({ name, strat: JSON.parse(JSON.stringify(strat)) });
      KV.set(SAVE_KEY, saved); renderSaved();
      stratName.textContent = name;
      env.bus.emit('toast', { message: 'Strategy saved', tone: 'success' });
    }
    function highlightCards() { [...cards.children].forEach((c) => c.classList.toggle('active', c.dataset.k === strat.preset)); }

    return {
      node, cards, winSel, winVal, lossSel, lossVal, capNone, capVal, slNone, slVal, swNone, swVal, sync, highlightCards,
    };
  }

  function choosePreset(k) {
    strat.preset = k;
    if (PRESET_RULES[k]) {
      strat.onWin = { mode: PRESET_RULES[k].onWin[0], value: PRESET_RULES[k].onWin[1] };
      strat.onLoss = { mode: PRESET_RULES[k].onLoss[0], value: PRESET_RULES[k].onLoss[1] };
    }
    syncEditor();
    stratName.textContent = PRESETS[k].label;
  }

  function syncEditor() {
    editor.winSel.value = strat.onWin.mode; editor.winVal.value = strat.onWin.value;
    editor.lossSel.value = strat.onLoss.mode; editor.lossVal.value = strat.onLoss.value;
    editor.capNone.checked = !strat.cap; editor.capVal.disabled = !strat.cap; editor.capVal.value = strat.cap || 0;
    editor.slNone.checked = !strat.stopLoss; editor.slVal.disabled = !strat.stopLoss; editor.slVal.value = strat.stopLoss || 0;
    editor.swNone.checked = !strat.stopWin; editor.swVal.disabled = !strat.stopWin; editor.swVal.value = strat.stopWin || 0;
    editor.highlightCards();
    refreshIcons();
  }

  // helpers
  function ruleSelect(dv = 'reset') {
    const s = h('select.sk-select', {}, [['reset', 'Reset to base'], ['multiply', 'Multiply by'], ['increase', 'Increase %'], ['decrease', 'Decrease %']].map(([v, l]) => h('option', { value: v }, l)));
    s.value = dv; return s;
  }
  function row(label, sel, val) { return h('div.sk-strat-line', {}, [h('label.sk-label', {}, label), h('div.sk-rule-inline', {}, [sel, val])]); }
  function labelCheck(input, text) { const l = h('label.sk-check', {}, [input, h('span', {}, text)]); return l; }
}
