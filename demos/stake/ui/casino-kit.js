// ============================================================
//  Casino kit — shared table controls: a poker-chip denomination
//  tray and an action bar (Rebet / 2× / Undo / Clear / Hold /
//  Turbo …). Used by table games so interaction feels consistent.
//  All amounts are fake USD.
// ============================================================

import { h, clear, icon, refreshIcons } from './components.js';

const CHIP_COLORS = {
  1: '#e9edf0', 5: '#d64545', 25: '#2fa84f', 100: '#20242c',
  500: '#7c5cff', 1000: '#e0b64d', 5000: '#2fd0c2',
};

export function chipShort(n) {
  if (n >= 1000000) return '$' + trim(n / 1000000) + 'M';
  if (n >= 1000) return '$' + trim(n / 1000) + 'K';
  return '$' + trim(n);
}
function trim(n) { return Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 2 : 1); }
function colorFor(n) {
  const keys = Object.keys(CHIP_COLORS).map(Number).sort((a, b) => a - b);
  let c = CHIP_COLORS[keys[0]];
  for (const k of keys) if (n >= k) c = CHIP_COLORS[k];
  return c;
}

export function chipTray(env, { denoms = [1, 5, 25, 100, 500, 1000], value, onSelect } = {}) {
  const list = [...denoms];
  let current = value ?? list[0];
  const node = h('div.sk-chip-tray', {});
  const btns = new Map();

  function render() {
    clear(node); btns.clear();
    for (const d of list) {
      const b = h('button.sk-chip', { type: 'button', onclick: () => set(d) }, chipShort(d));
      b.style.setProperty('--chip', colorFor(d));
      if (d === current) b.classList.add('active');
      btns.set(d, b); node.appendChild(b);
    }
    const add = h('button.sk-chip.sk-chip-add', { type: 'button', title: 'Custom chip', onclick: addCustom }, '+');
    node.appendChild(add);
  }
  function set(d) { current = d; for (const [v, b] of btns) b.classList.toggle('active', v === current); onSelect && onSelect(d); }
  function addCustom() {
    const v = Number(prompt('Custom chip amount ($):'));
    if (v > 0) { if (!list.includes(v)) { list.push(v); list.sort((a, b) => a - b); } render(); set(v); }
  }
  render();
  return { node, get: () => current, set };
}

export function actionBar(actions) {
  const node = h('div.sk-actionbar', {});
  const map = new Map();
  for (const a of actions) {
    const b = h('button.sk-act' + (a.variant ? '.' + a.variant : ''), {
      type: 'button', title: a.label, onclick: a.onClick,
    }, [a.icon ? icon(a.icon) : null, h('span.sk-act-label', {}, a.label)]);
    map.set(a.key, b); node.appendChild(b);
  }
  refreshIcons();
  return {
    node,
    btn: (k) => map.get(k),
    setDisabled: (k, d) => { const b = map.get(k); if (b) b.disabled = d; },
    setActive: (k, on) => { const b = map.get(k); if (b) b.classList.toggle('active', on); },
    setLabel: (k, label) => { const b = map.get(k); if (b) { const s = b.querySelector('.sk-act-label'); if (s) s.textContent = label; } },
  };
}
