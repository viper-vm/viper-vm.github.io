// Plumb — small shared UI pieces for every app page: icons, toasts, the busy chip, a confirm
// dialog, unit-aware formatting, and the navigation rail.

import { ICONS } from './icons.js';
import { esc } from '../style.js';

export { esc };
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const icon = (name, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#${name}"/></svg>`;

export function injectIcons() {
  if (document.getElementById('plumb-icons')) return;
  const holder = document.createElement('div');
  holder.innerHTML = `<svg id="plumb-icons" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${ICONS}</defs></svg>`;
  document.body.prepend(holder.firstChild);
}

// ------------------------------------------------------------------ theme
export const themeNow = () => document.documentElement.dataset.theme || 'dark';
export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('plumb.theme', t); } catch { /* private mode */ }
  document.querySelectorAll('[data-theme-icon]').forEach((u) => u.setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon'));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0b0d10' : '#f8f7f3');
  window.dispatchEvent(new CustomEvent('plumb:theme', { detail: t }));
}

// ------------------------------------------------------------------ toast + busy
let toastTimer = 0;
export function toast(msg, bad = false) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), bad ? 6500 : 3400);
}
let busyTimer = 0;
export function busy(text) {
  let el = document.getElementById('busy');
  if (!el) { el = document.createElement('div'); el.id = 'busy'; el.className = 'busy'; el.hidden = true; el.innerHTML = '<span class="spinner"></span><span class="busy-text"></span>'; document.body.appendChild(el); }
  clearTimeout(busyTimer);
  if (!text) { el.hidden = true; return; }
  el.querySelector('.busy-text').textContent = text;
  if (el.hidden) busyTimer = setTimeout(() => { el.hidden = false; }, 150); else el.hidden = false;
}

/** A yes/no question in the page (the browser's own confirm() is too blunt). */
export function confirmBox({ title, body = '', ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = `<form method="dialog" class="dlg-in"><h3>${esc(title)}</h3>${body ? `<p>${body}</p>` : ''}
      <div class="dlg-act"><button value="no" class="btn ghost">Cancel</button><button value="yes" class="btn ${danger ? 'danger' : 'primary'}">${esc(ok)}</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => { resolve(d.returnValue === 'yes'); d.remove(); });
    d.showModal();
  });
}

/** Ask for a line of text in the page. */
export function promptBox({ title, label = '', value = '', ok = 'Save' }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = `<form method="dialog" class="dlg-in"><h3>${esc(title)}</h3><label class="fld"><span>${esc(label)}</span><input name="v" value="${esc(value)}" autocomplete="off" /></label>
      <div class="dlg-act"><button value="no" class="btn ghost">Cancel</button><button value="yes" class="btn primary">${esc(ok)}</button></div></form>`;
    document.body.appendChild(d);
    const inp = d.querySelector('input');
    d.addEventListener('close', () => { resolve(d.returnValue === 'yes' ? inp.value.trim() : null); d.remove(); });
    d.showModal();
    inp.select();
  });
}

// ------------------------------------------------------------------ formatting
const FT2 = 10.7639;
export function fmtArea(m2, s = {}) {
  if (!Number.isFinite(m2)) return '—';
  const m = `${m2 >= 100 ? Math.round(m2).toLocaleString('en-IN') : m2.toFixed(1)} m²`;
  const f = `${Math.round(m2 * FT2).toLocaleString('en-IN')} ft²`;
  return s.areaUnit === 'ft2' ? f : s.areaUnit === 'm2' ? m : `${m} · ${f}`;
}
export function fmtLen(m, s = {}) {
  if (!Number.isFinite(m)) return '—';
  if (s.lengthUnit === 'm') return `${m.toFixed(2)} m`;
  if (s.lengthUnit === 'ftin') { const inch = Math.round(m / 0.0254), ft = Math.floor(inch / 12); return `${ft}'-${inch % 12}"`; }
  return `${Math.round(m * 1000).toLocaleString('en-IN')} mm`;
}
export function relTime(ts) {
  if (!ts) return '';
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 172800) return 'yesterday';
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d > 300 * 86400 ? 'numeric' : undefined });
}
export const fmtDate = (ts) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtBytes = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
export const qs = (k) => new URLSearchParams(location.search).get(k);

// ------------------------------------------------------------------ navigation rail
/**
 * The left rail on every page except the workspaces.
 * active: 'projects' | 'overview' | 'issues' | 'areas' | 'settings' | 'help'; project: the open project (or null).
 */
export function rail(active, project = null, counts = {}) {
  const a = (key, href, ic, label, extra = '') => `<a class="rl ${active === key ? 'on' : ''}" href="${href}"${active === key ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${extra}</a>`;
  const pid = project ? encodeURIComponent(project.id) : '';
  return `
    <div class="rail-top">
      <a class="brand" href="../" title="Plumb home"><span class="bob">${icon('i-bob')}</span><span class="brand-name">Plumb</span></a>
      <button class="icon-btn rail-toggle" type="button" data-rail-toggle aria-label="Menu">${icon('i-menu')}</button>
    </div>
    <nav class="rail-nav" aria-label="Main">
      ${a('projects', './', 'i-grid', 'All projects')}
      ${project ? `<div class="rail-proj">
        <div class="rp-h" title="${esc(project.name)}">${esc(project.name)}</div>
        ${a('overview', `project.html?id=${pid}`, 'i-overview', 'Overview')}
        ${a('plan', `workspace.html?id=${pid}#plan`, 'i-2d', 'Plan')}
        ${a('model', `workspace.html?id=${pid}#model`, 'i-home', '3D model')}
        ${a('issues', `issues.html?id=${pid}`, 'i-issues', 'Issues', counts.open ? `<b class="rl-n">${counts.open}</b>` : '')}
        ${a('areas', `areas.html?id=${pid}`, 'i-area', 'Areas')}
      </div>` : ''}
    </nav>
    <div class="rail-foot">
      ${a('settings', 'settings.html', 'i-gear', 'Settings')}
      ${a('help', 'help.html', 'i-help', 'Help')}
      <button class="rl" type="button" data-theme-toggle>${icon(themeNow() === 'dark' ? 'i-sun' : 'i-moon')}<span>${themeNow() === 'dark' ? 'Light' : 'Dark'} theme</span></button>
    </div>`;
}

/** Wire the rail's buttons (mobile toggle, theme). */
export function wireRail(root) {
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-rail-toggle]')) root.classList.toggle('open');
    const t = e.target.closest('[data-theme-toggle]');
    if (t) {
      const next = themeNow() === 'dark' ? 'light' : 'dark';
      setTheme(next);
      t.innerHTML = `${icon(next === 'dark' ? 'i-sun' : 'i-moon')}<span>${next === 'dark' ? 'Light' : 'Dark'} theme</span>`;
    }
  });
}

/** Drag-and-drop of drawings anywhere on a page. */
export function onDropFiles(handler, veilText = 'Drop your DWG or DXF drawings') {
  let depth = 0;
  let veil = document.getElementById('dropveil');
  if (!veil) {
    veil = document.createElement('div');
    veil.id = 'dropveil'; veil.className = 'dropveil'; veil.hidden = true;
    veil.innerHTML = `<div>${icon('i-upload')}<strong>${esc(veilText)}</strong><span>one file with every floor, or one file per floor</span></div>`;
    document.body.appendChild(veil);
  }
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; veil.hidden = false; } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) veil.hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; veil.hidden = true; if (e.dataTransfer?.files?.length) handler([...e.dataTransfer.files]); });
}
