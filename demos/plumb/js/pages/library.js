// Plumb — All projects: every building on this device, and the way into a new one.

import { injectIcons, rail, wireRail, $, esc, icon, toast, busy, confirmBox, promptBox, relTime, fmtArea, fmtBytes, onDropFiles } from '../shell/ui.js';
import { listProjects, saveProject, deleteProject, usage, askPersist, pendDrawings, getSettings } from '../shell/store.js';
import { sampleProject } from '../shell/projects.js';
import { PROJECT_STATUS } from '../shell/model.js';

injectIcons();
const railEl = $('#rail');
railEl.innerHTML = rail('projects');
wireRail(railEl);
const page = $('#page');

const pref = (k, d) => { try { return localStorage.getItem('plumb.lib.' + k) || d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('plumb.lib.' + k, v); } catch { /* private mode */ } };
const state = { q: '', filter: pref('filter', 'all'), view: pref('view', 'grid'), projects: [], settings: null, usage: null };

async function load() {
  try {
    [state.projects, state.settings, state.usage] = await Promise.all([listProjects(), getSettings(), usage()]);
  } catch (err) {
    page.innerHTML = `<div class="empty">${icon('i-alert')}<h2>Can’t open this device’s storage</h2><p>${esc(err.message)}</p></div>`;
    return;
  }
  render();
  // "Try the sample building" on the landing page
  if (new URLSearchParams(location.search).has('sample')) { history.replaceState(null, '', './'); openSample(); }
}

function visible() {
  const q = state.q.trim().toLowerCase();
  return state.projects.filter((p) => {
    if (state.filter === 'starred' && !p.starred) return false;
    if (state.filter === 'archived' ? !p.archived : p.archived) return false;
    if (!q) return true;
    const hay = [p.name, p.client, p.city, ...p.revisions.flatMap((r) => r.files.map((f) => f.name))].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function sevDots(s) {
  if (!s || !s.issues) return '';
  const i = s.issues, dots = [];
  for (const [k, n] of [['high', i.high], ['medium', i.medium], ['low', i.low]]) for (let j = 0; j < Math.min(n, 6); j++) dots.push(`<i class="${k}"></i>`);
  return i.total ? `<span class="sevdots" title="${i.total} open issue${i.total > 1 ? 's' : ''}">${dots.join('')}</span><span class="num muted">${i.total}</span>` : `<span class="badge resolved">${icon('i-check')}clear</span>`;
}

function card(p) {
  const s = p.summary || {};
  const rev = p.revisions.find((r) => r.id === p.current) || p.revisions[p.revisions.length - 1];
  return `<a class="pcard ${p.sample ? 'sample' : ''}" href="project.html?id=${encodeURIComponent(p.id)}" data-id="${esc(p.id)}">
    <div class="pc-thumb" style="${p.thumb ? `background-image:url('${p.thumb}')` : ''}">${p.thumb ? '' : icon('i-2d')}</div>
    <button class="pc-star ${p.starred ? 'on' : ''}" data-star="${esc(p.id)}" aria-label="${p.starred ? 'Unstar' : 'Star'}" title="${p.starred ? 'Starred' : 'Star'}">${icon('i-star')}</button>
    <div class="pc-body">
      <div class="pc-name"><span>${esc(p.name)}</span></div>
      <div class="pc-meta"><span>${esc(s.storeys || '—')}</span><span>·</span><span>${s.floors || 0} plan${s.floors === 1 ? '' : 's'}</span><span>·</span><span>${esc(rev ? rev.label : '')}</span>${p.city ? `<span>·</span><span>${esc(p.city)}</span>` : ''}</div>
      <div class="pc-foot"><span style="display:inline-flex;gap:6px;align-items:center">${sevDots(s)}</span><span class="badge status">${esc(PROJECT_STATUS[p.status] || 'Working')}</span></div>
      <div class="pc-meta"><span>Opened ${esc(relTime(p.openedAt))}</span><button class="icon-btn" style="margin-left:auto;width:28px;height:28px" data-menu="${esc(p.id)}" aria-label="More for ${esc(p.name)}">${icon('i-dots')}</button></div>
    </div>
  </a>`;
}

function row(p) {
  const s = p.summary || {};
  const rev = p.revisions.find((r) => r.id === p.current) || p.revisions[p.revisions.length - 1];
  return `<tr class="click" data-open="${esc(p.id)}"><td><b>${esc(p.name)}</b>${p.sample ? ' <span class="badge">sample</span>' : ''}<div class="muted" style="font-size:12px">${esc([p.client, p.city].filter(Boolean).join(' · '))}</div></td>
    <td>${esc(s.storeys || '—')}</td><td class="n">${s.floors || 0}</td><td class="n">${s.footprint ? esc(fmtArea(s.footprint, { areaUnit: 'm2' })) : '—'}</td>
    <td>${sevDots(s)}</td><td>${esc(rev ? rev.label : '')}</td><td>${esc(PROJECT_STATUS[p.status] || 'Working')}</td><td class="muted">${esc(relTime(p.openedAt))}</td>
    <td><button class="icon-btn" data-menu="${esc(p.id)}" aria-label="More">${icon('i-dots')}</button></td></tr>`;
}

function render() {
  const hasSample = state.projects.some((p) => p.sample);
  const n = state.projects.filter((p) => !p.archived).length;
  const head = `<div class="page-head"><div><h1>Projects</h1><div class="sub">${n ? `${n} building${n > 1 ? 's' : ''} on this device` : 'Nothing here yet'}<span class="faint">·</span><span>Drawings never leave this computer</span></div></div>
    <div class="acts">${hasSample ? '' : `<button class="btn" data-sample>${icon('i-flask')}Open the sample building</button>`}<a class="btn primary" href="import.html">${icon('i-plus')}New project</a></div></div>`;

  if (!state.projects.length) {
    page.innerHTML = head + `<div class="empty" data-pick tabindex="0" role="button" aria-label="Choose drawings">
      ${icon('i-upload')}<h2>Drop your floor plans here</h2>
      <p>One DWG or DXF with every floor plan side by side, or one file per floor. Plumb reads the floors, lines them up, finds what doesn’t stack, and builds the 3D model.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><button class="btn primary" data-pick>${icon('i-open')}Choose drawings</button><button class="btn" data-sample>${icon('i-flask')}Try the sample building</button></div>
      <div class="formats">DWG (AutoCAD R13 → 2025) · DXF (ASCII or binary) · several files at once</div></div>`;
    return;
  }

  const chips = [['all', 'All'], ['starred', 'Starred'], ['archived', 'Archived']].map(([k, l]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('');
  const tools = `<div class="toolbar"><label class="search">${icon('i-search')}<input id="q" type="search" placeholder="Search projects, clients, files" value="${esc(state.q)}" autocomplete="off" aria-label="Search projects" /></label>${chips}
    <span style="margin-left:auto" class="seg" role="group" aria-label="View"><button data-view="grid" class="${state.view === 'grid' ? 'on' : ''}" title="Cards">${icon('i-grid')}</button><button data-view="list" class="${state.view === 'list' ? 'on' : ''}" title="List">${icon('i-list')}</button></span></div>`;
  const u = state.usage;
  const foot = u && u.quota ? `<p class="muted" style="font-size:12.5px;margin-top:22px">Stored on this device: ${fmtBytes(u.used)} of ${fmtBytes(u.quota)}${u.persisted ? ' · kept safe from browser clean-up' : ` · <button class="btn link small" data-persist>Keep it safe from browser clean-up</button>`}</p>` : '';
  page.innerHTML = head + tools + '<div id="results"></div>' + foot;
  renderList();
}

/** Only the cards or rows (so typing in search keeps its cursor). */
function renderList() {
  const el = $('#results');
  if (!el) return;
  const list = visible();
  if (!list.length) el.innerHTML = `<p class="muted" style="padding:24px 0">${state.q ? `Nothing matches “${esc(state.q)}”.` : state.filter === 'starred' ? 'Star a project to keep it here.' : 'No archived projects.'}</p>`;
  else if (state.view === 'list') el.innerHTML = `<div class="tblw"><table class="t"><thead><tr><th>Project</th><th>Storeys</th><th class="n">Plans</th><th class="n">Built-up</th><th>Open issues</th><th>Rev</th><th>Status</th><th>Opened</th><th></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>`;
  else el.innerHTML = `<div class="pcards">${list.map(card).join('')}${state.filter === 'all' && !state.q ? `<button class="pcard new" data-pick>${icon('i-upload')}<b>New project</b><span>Drop DWG / DXF here or click to choose</span></button>` : ''}</div>`;
}

// ------------------------------------------------------------------ actions
const picker = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.dwg,.DWG,.dxf,.DXF', hidden: true });
document.body.appendChild(picker);
picker.addEventListener('change', () => { if (picker.files.length) startImport([...picker.files]); picker.value = ''; });

async function startImport(files) {
  busy('Opening the drawings…');
  try {
    if (await pendDrawings(files)) { location.href = 'import.html'; return; }
    busy(null); toast('Plumb reads DWG and DXF drawings. Export one from your CAD app.', true);
  } catch (err) { busy(null); toast(err.message, true); }
}

async function openSample() {
  const found = state.projects.find((p) => p.sample);
  if (found) { location.href = `project.html?id=${encodeURIComponent(found.id)}`; return; }
  try {
    const p = await sampleProject((s) => busy(s));
    location.href = `project.html?id=${encodeURIComponent(p.id)}`;
  } catch (err) { busy(null); toast(err.message, true); }
}

function menu(btn, p) {
  document.querySelector('.menu')?.remove();
  const m = document.createElement('div');
  m.className = 'popover menu';
  m.style.position = 'fixed';
  m.innerHTML = `<button data-act="rename">Rename…</button>
    <div class="menu-sub">Status</div>${Object.entries(PROJECT_STATUS).map(([k, l]) => `<button data-act="status" data-v="${k}" class="${p.status === k ? 'on' : ''}">${l}</button>`).join('')}
    <hr /><button data-act="archive">${p.archived ? 'Put back' : 'Archive'}</button><button data-act="delete" class="danger">Delete…</button>`;
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
  m.style.top = Math.min(innerHeight - m.offsetHeight - 8, r.bottom + 4) + 'px';
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    m.remove();
    const a = b.dataset.act;
    if (a === 'rename') { const v = await promptBox({ title: 'Rename project', label: 'Name', value: p.name }); if (v) { p.name = v; await saveProject(p); render(); } }
    if (a === 'status') { p.status = b.dataset.v; await saveProject(p); render(); }
    if (a === 'archive') { p.archived = !p.archived; await saveProject(p); render(); toast(p.archived ? 'Archived.' : 'Put back.'); }
    if (a === 'delete') {
      if (await confirmBox({ title: `Delete “${p.name}”?`, body: 'Its drawings, issues and notes are removed from this device. This can’t be undone.', ok: 'Delete', danger: true })) {
        await deleteProject(p.id);
        state.projects = state.projects.filter((q) => q.id !== p.id);
        render(); toast('Deleted.');
      }
    }
  });
  setTimeout(() => document.addEventListener('pointerdown', function close(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', close); } }), 0);
}

page.addEventListener('click', async (e) => {
  const t = e.target;
  const star = t.closest('[data-star]');
  if (star) { e.preventDefault(); const p = state.projects.find((q) => q.id === star.dataset.star); p.starred = !p.starred; await saveProject(p); render(); return; }
  const mb = t.closest('[data-menu]');
  if (mb) { e.preventDefault(); e.stopPropagation(); menu(mb, state.projects.find((q) => q.id === mb.dataset.menu)); return; }
  if (t.closest('[data-sample]')) { openSample(); return; }
  if (t.closest('[data-pick]')) { picker.click(); return; }
  const f = t.closest('[data-filter]');
  if (f) { state.filter = f.dataset.filter; setPref('filter', state.filter); render(); return; }
  const v = t.closest('[data-view]');
  if (v) { state.view = v.dataset.view; setPref('view', state.view); render(); return; }
  if (t.closest('[data-persist]')) { const ok = await askPersist(); toast(ok ? 'This browser will keep your projects.' : 'The browser didn’t allow it; export important projects as backup.', !ok); state.usage = await usage(); render(); return; }
  const tr = t.closest('tr[data-open]');
  if (tr) location.href = `project.html?id=${encodeURIComponent(tr.dataset.open)}`;
});
page.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.empty[data-pick]')) { e.preventDefault(); picker.click(); } });
page.addEventListener('input', (e) => { if (e.target.id === 'q') { state.q = e.target.value; renderList(); } });

onDropFiles(startImport);
load();
