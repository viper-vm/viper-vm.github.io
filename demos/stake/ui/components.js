// ============================================================
//  Shared UI atoms — a tiny hyperscript helper plus reusable
//  pieces (amount field, segmented control, stat card, toast,
//  sparkline, mini equity chart) used across games and views.
// ============================================================

import { money, signedMoney } from '../core/format.js';

// Hyperscript: h('div.card', {onclick}, [child, 'text'])
export function h(tagSpec, props = {}, children = []) {
  const [tag, ...classes] = tagSpec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k in node && k !== 'list') {
      try { node[k] = v; } catch (_) { node.setAttribute(k, v); }
    } else {
      node.setAttribute(k, v);
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  const arr = Array.isArray(children) ? children : [children];
  for (const c of arr) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number'
      ? document.createTextNode(String(c))
      : c);
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// Lucide icon <i>. Icons are hydrated by lucide.createIcons() after mount.
export function icon(name, cls = '') {
  return h('i', { 'data-lucide': name, class: cls });
}

export function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

// ---------- Amount field with ½ / 2× / Max quick actions ----------
export function amountField(wallet, { value = 1, onChange } = {}) {
  const input = h('input.sk-amount-input', {
    type: 'number', min: 0, step: 'any', value,
    oninput: () => onChange && onChange(get()),
  });
  const get = () => Math.max(0, Number(input.value) || 0);
  const set = (v) => { input.value = String(Math.max(0, Number(v) || 0)); onChange && onChange(get()); };
  const quick = (label, fn) => h('button.sk-chip-btn', { type: 'button', onclick: () => set(fn(get())) }, label);
  const node = h('div.sk-amount', {}, [
    h('label.sk-label', {}, 'Bet Amount'),
    h('div.sk-amount-row', {}, [
      h('span.sk-amount-prefix', {}, '$'),
      input,
      h('div.sk-amount-quick', {}, [
        quick('½', (v) => v / 2),
        quick('2×', (v) => v * 2),
        quick('Max', () => wallet.balance),
      ]),
    ]),
  ]);
  return { node, get, set, input };
}

// ---------- Segmented control ----------
export function segmented(options, { value, onChange } = {}) {
  let current = value ?? options[0]?.value;
  const node = h('div.sk-seg', {});
  const buttons = new Map();
  for (const opt of options) {
    const b = h('button.sk-seg-btn', {
      type: 'button',
      onclick: () => { set(opt.value); onChange && onChange(opt.value); },
    }, opt.label);
    if (opt.value === current) b.classList.add('active');
    buttons.set(opt.value, b);
    node.appendChild(b);
  }
  function set(v) {
    current = v;
    for (const [val, b] of buttons) b.classList.toggle('active', val === v);
  }
  return { node, get: () => current, set };
}

// ---------- Stat card ----------
export function statCard(label, value, { sub, tone } = {}) {
  return h('div.sk-stat' + (tone ? '.tone-' + tone : ''), {}, [
    h('div.sk-stat-label', {}, label),
    h('div.sk-stat-value', {}, value),
    sub ? h('div.sk-stat-sub', {}, sub) : null,
  ]);
}

// ---------- Toast notifications ----------
export function mountToasts(bus) {
  const host = h('div.sk-toasts', {});
  document.body.appendChild(host);
  bus.on('toast', ({ message, tone = 'info', ttl = 2600 }) => {
    const t = h('div.sk-toast.tone-' + tone, {}, message);
    host.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 250);
    }, ttl);
  });
}

// ---------- Sparkline (SVG) ----------
export function sparkline(values, { w = 120, h: height = 32, stroke = 'var(--sk-accent)', fill = true } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${height}`);
  svg.setAttribute('class', 'sk-spark');
  svg.setAttribute('preserveAspectRatio', 'none');
  if (!values || values.length < 2) return svg;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i) => (i / (values.length - 1)) * w;
  const y = (v) => height - ((v - min) / span) * (height - 4) - 2;
  const pts = values.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`);
  if (fill) {
    const area = document.createElementNS(ns, 'path');
    area.setAttribute('d', `M0,${height} L${pts.join(' L')} L${w},${height} Z`);
    area.setAttribute('fill', stroke);
    area.setAttribute('opacity', '0.12');
    svg.appendChild(area);
  }
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', pts.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', stroke);
  line.setAttribute('stroke-width', '1.6');
  line.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(line);
  return svg;
}

// Compact P/L readout used in game side panels.
export function plChip(net) {
  const tone = net > 0 ? 'up' : net < 0 ? 'down' : 'flat';
  return h('span.sk-pl.tone-' + tone, {}, signedMoney(net));
}

export { money };
