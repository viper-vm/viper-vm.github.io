// js/ui.js — DOM helpers, toasts, word-level diff, and textarea caret geometry
// for the web app. No framework, no dependencies.

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Tiny element factory: el('button', {class:'x', onclick:fn}, ['text', childNode]). */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer = null;
export function toast(message) {
  const wrap = qs('#toasts');
  if (!wrap) return;
  const node = el('div', { class: 'toast', text: message });
  wrap.appendChild(node);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.remove(), 2400);
  // Cap visible toasts.
  while (wrap.children.length > 3) wrap.firstChild.remove();
}

export function relativeTime(ts) {
  const diff = Date.now() - ts;
  const s = Math.round(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Word-level diff between two strings, returned as safe HTML with <ins>/<del>.
 * Uses an LCS over whitespace-split tokens (kept simple; text is short).
 */
export function wordDiff(oldStr, newStr) {
  const a = tokenize(oldStr);
  const b = tokenize(newStr);
  const n = a.length;
  const m = b.length;
  // LCS length table.
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  let out = '';
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out += escapeHtml(a[i]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out += `<del>${escapeHtml(a[i])}</del>`;
      i++;
    } else {
      out += `<ins>${escapeHtml(b[j])}</ins>`;
      j++;
    }
  }
  while (i < n) { out += `<del>${escapeHtml(a[i])}</del>`; i++; }
  while (j < m) { out += `<ins>${escapeHtml(b[j])}</ins>`; j++; }
  return out;
}

function tokenize(str) {
  // Split into words and the whitespace runs between them, both kept as tokens.
  return String(str).match(/\s+|[^\s]+/g) || [];
}

/**
 * Pixel coordinates of a caret index inside a textarea, relative to the page.
 * Classic mirror-div technique: render a hidden clone with the same typography,
 * place a marker span at the caret, and read its position.
 */
export function caretCoordinates(textarea, position) {
  const div = document.createElement('div');
  const style = window.getComputedStyle(textarea);
  const props = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust',
    'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'textDecoration',
    'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordWrap', 'overflowWrap',
  ];
  props.forEach((p) => { div.style[p] = style[p]; });
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.overflow = 'hidden';
  div.style.width = `${textarea.clientWidth}px`;

  const value = textarea.value;
  div.textContent = value.substring(0, position);
  const span = document.createElement('span');
  span.textContent = value.substring(position) || '.';
  div.appendChild(span);
  document.body.appendChild(div);

  const rect = textarea.getBoundingClientRect();
  const top = rect.top + window.scrollY + span.offsetTop - textarea.scrollTop;
  const left = rect.left + window.scrollX + span.offsetLeft - textarea.scrollLeft;
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  document.body.removeChild(div);
  return { top, left, lineHeight };
}

/** Grow a textarea to fit its content, bounded by CSS max-height. */
export function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, window.innerHeight * 0.46)}px`;
}
