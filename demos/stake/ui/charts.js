// ============================================================
//  Charts — lightweight dependency-free SVG charts. Hand-rolled
//  so the whole simulator has zero runtime dependencies and works
//  offline: equity line, multi-series line, signed bars, histogram.
// ============================================================

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function svgRoot(w, h) {
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, class: 'sk-chart' });
  svg.style.width = '100%';
  svg.style.height = 'auto';
  return svg;
}

// Cumulative equity / P&L line with a zero baseline.
export function lineChart(values, opts = {}) {
  const { w = 640, h = 240, pad = 30, color = 'var(--sk-accent)', area = true } = opts;
  const svg = svgRoot(w, h);
  if (!values || values.length < 2) return withEmpty(svg, w, h);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const x = (i) => pad + (i / (values.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);

  drawGrid(svg, w, h, pad, min, max, y);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  if (area) {
    const zeroY = y(0);
    svg.appendChild(el('path', {
      d: `M${x(0)},${zeroY} L${pts.join(' L')} L${x(values.length - 1)},${zeroY} Z`,
      fill: color, opacity: '0.12',
    }));
  }
  svg.appendChild(el('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linejoin': 'round' }));
  const last = values[values.length - 1];
  svg.appendChild(el('circle', { cx: x(values.length - 1), cy: y(last), r: '3.5', fill: color }));
  return svg;
}

// Multiple series on shared axes (cross-game equity).
export function multiLine(series, opts = {}) {
  const { w = 640, h = 260, pad = 30 } = opts;
  const svg = svgRoot(w, h);
  const withVals = series.filter((s) => s.values && s.values.length > 1);
  if (!withVals.length) return withEmpty(svg, w, h);
  const all = withVals.flatMap((s) => s.values).concat(0);
  const min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  const maxLen = Math.max(...withVals.map((s) => s.values.length));
  const x = (i, len) => pad + (i / (Math.max(1, len - 1))) * (w - pad * 2);
  const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
  drawGrid(svg, w, h, pad, min, max, y);
  for (const s of withVals) {
    const pts = s.values.map((v, i) => `${x(i, s.values.length).toFixed(1)},${y(v).toFixed(1)}`);
    svg.appendChild(el('polyline', { points: pts.join(' '), fill: 'none', stroke: s.color || 'var(--sk-accent)', 'stroke-width': '2', 'stroke-linejoin': 'round', opacity: '0.9' }));
  }
  return svg;
}

// Signed vertical bars (profit by game): positive up, negative down.
export function signedBars(items, opts = {}) {
  const { w = 640, h = 240, pad = 30 } = opts;
  const svg = svgRoot(w, h);
  if (!items || !items.length) return withEmpty(svg, w, h);
  const vals = items.map((d) => d.value);
  const min = Math.min(...vals, 0), max = Math.max(...vals, 0);
  const span = max - min || 1;
  const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
  const zeroY = y(0);
  const bw = (w - pad * 2) / items.length;
  svg.appendChild(el('line', { x1: pad, y1: zeroY, x2: w - pad, y2: zeroY, stroke: 'var(--sk-border)', 'stroke-width': '1' }));
  items.forEach((d, i) => {
    const cx = pad + i * bw + bw / 2;
    const barW = Math.min(46, bw * 0.6);
    const top = Math.min(zeroY, y(d.value));
    const height = Math.abs(zeroY - y(d.value));
    svg.appendChild(el('rect', { x: cx - barW / 2, y: top, width: barW, height: Math.max(1, height), rx: 4, fill: d.color || (d.value >= 0 ? 'var(--sk-up)' : 'var(--sk-down)') }));
    const label = el('text', { x: cx, y: h - pad + 14, 'text-anchor': 'middle', class: 'sk-chart-label' });
    label.textContent = d.label;
    svg.appendChild(label);
  });
  return svg;
}

// Histogram of multipliers (win distribution).
export function histogram(values, opts = {}) {
  const { w = 640, h = 220, pad = 30, bins = 16, color = 'var(--sk-accent)' } = opts;
  const svg = svgRoot(w, h);
  if (!values || !values.length) return withEmpty(svg, w, h);
  const max = Math.max(...values);
  const lo = 0, hi = Math.max(2, max);
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    let idx = Math.floor(((v - lo) / (hi - lo)) * bins);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx]++;
  }
  const cmax = Math.max(...counts) || 1;
  const bw = (w - pad * 2) / bins;
  counts.forEach((c, i) => {
    const bh = (c / cmax) * (h - pad * 2);
    svg.appendChild(el('rect', { x: pad + i * bw + 1, y: h - pad - bh, width: bw - 2, height: Math.max(0, bh), rx: 2, fill: color, opacity: '0.85' }));
  });
  const l = el('text', { x: pad, y: h - 8, class: 'sk-chart-label' }); l.textContent = '0×';
  const r = el('text', { x: w - pad, y: h - 8, 'text-anchor': 'end', class: 'sk-chart-label' }); r.textContent = hi.toFixed(1) + '×';
  svg.append(l, r);
  return svg;
}

function drawGrid(svg, w, h, pad, min, max, y) {
  const zeroY = y(0);
  svg.appendChild(el('line', { x1: pad, y1: zeroY, x2: w - pad, y2: zeroY, stroke: 'var(--sk-border-strong)', 'stroke-width': '1', 'stroke-dasharray': '3 3' }));
  const maxT = el('text', { x: pad - 4, y: y(max) + 4, 'text-anchor': 'end', class: 'sk-chart-label' }); maxT.textContent = fmt(max);
  const minT = el('text', { x: pad - 4, y: y(min) + 4, 'text-anchor': 'end', class: 'sk-chart-label' }); minT.textContent = fmt(min);
  svg.append(maxT, minT);
}
function fmt(n) {
  const a = Math.abs(n);
  if (a >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toFixed(a < 10 ? 1 : 0);
}
function withEmpty(svg, w, h) {
  const t = el('text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', class: 'sk-chart-empty' });
  t.textContent = 'Not enough data yet';
  svg.appendChild(t);
  return svg;
}
