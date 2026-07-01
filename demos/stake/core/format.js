// ============================================================
//  Formatters — USD money, multipliers, percentages, numbers.
//  All balances are FAKE dollars; formatting mirrors real money
//  so the simulator feels authentic.
// ============================================================

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});

// $1,234.56 — the canonical money format.
export function money(n) {
  if (!isFinite(n)) return '$0.00';
  return usd.format(n);
}

// Signed money for P/L: +$12.00 / −$8.50 (note real minus glyph).
export function signedMoney(n) {
  if (!isFinite(n)) n = 0;
  const s = money(Math.abs(n));
  if (n > 0) return '+' + s;
  if (n < 0) return '−' + s;
  return s;
}

// Compact money for tight spaces: $1.2K, $3.4M.
export function moneyCompact(n) {
  if (!isFinite(n)) return '$0';
  if (Math.abs(n) < 10000) return money(n);
  return usdCompact.format(n);
}

// 2.00x multiplier display.
export function mult(n) {
  if (!isFinite(n)) return '0.00x';
  return `${n.toFixed(2)}x`;
}

// 12.34% — accepts a fraction (0.1234) OR set already=true for a raw pct.
export function pct(fraction, already = false) {
  const v = already ? fraction : fraction * 100;
  if (!isFinite(v)) return '0.00%';
  return `${v.toFixed(2)}%`;
}

// Signed pct for ROI/margin: +4.2% / −1.1%.
export function signedPct(fraction, already = false) {
  const v = already ? fraction : fraction * 100;
  if (!isFinite(v)) return '0.00%';
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

// Plain integer with grouping: 1,234.
export function int(n) {
  if (!isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}

// Short relative time for history rows.
export function timeAgo(ts, now) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Truncate a long hex seed for compact display: abcd…7f21.
export function shortHex(hex, head = 6, tail = 6) {
  if (!hex || hex.length <= head + tail + 1) return hex || '';
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}
