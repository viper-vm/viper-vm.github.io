// Plumb — Issues: every finding with its evidence, taken to closure across revisions.

import { injectIcons, rail, wireRail, $, $$, esc, icon, toast, busy, relTime, qs } from '../shell/ui.js';
import { saveProject, getSettings } from '../shell/store.js';
import { openProject } from '../shell/projects.js';
import { STATUS_LABEL, stateOf, setStatus, summarize } from '../shell/model.js';
import { issueShot } from '../shell/thumbs.js';
import { levelTag, KIND, GROUPS, SEVERITIES, SEV_LABEL } from '../style.js';
import { markupsDXF, issuesCSV, download } from '../export.js';

injectIcons();
const railEl = $('#rail');
const page = $('#page');
const id = qs('id');
const WHO = ['Structure', 'Plumbing', 'Lifts', 'Architecture'];
let P = null, REV = null, R = null, SET = null;
let filtOpen = false; // the filters, folded away on narrow screens
const F = { status: 'open', sev: null, group: null, pair: qs('pair') ? +qs('pair') : null, who: null };
let sel = qs('issue') || null;
const shots = new Map();

async function load() {
  if (!id) { location.replace('./'); return; }
  try {
    SET = await getSettings();
    ({ project: P, rev: REV, result: R } = await openProject(id, (s) => busy(s)));
    busy(null);
  } catch (err) {
    busy(null);
    railEl.innerHTML = rail('issues'); wireRail(railEl);
    page.innerHTML = `<div class="empty">${icon('i-alert')}<h2>Can’t open this project</h2><p>${esc(err.message)}</p><a class="btn" href="./">All projects</a></div>`;
    return;
  }
  document.title = `Issues · ${P.name} · Plumb`;
  render();
}

/** Current findings plus history: issues that were resolved or accepted in earlier revisions. */
function items() {
  const cur = R.issues.map((i) => {
    const st = stateOf(P, i) || { status: 'open', assignee: (KIND[i.kind] || {}).who, history: [], notes: [] };
    return { key: i.stateId || i.id, iss: i, st, n: i.n, sev: i.severity, title: i.title, kind: i.kind, pair: i.upper,
      where: `${levelTag(R.floors[i.lower])}→${levelTag(R.floors[i.upper])} · ${i.where}`, current: true };
  });
  const seen = new Set(cur.map((c) => c.key));
  const past = Object.values(P.issueState).filter((st) => !seen.has(st.id)).map((st) => ({
    key: st.id, iss: null, st, n: null, sev: st.severity, title: st.title, kind: st.kind, pair: null,
    where: `${st.lower} → ${st.upper}`, current: false,
  }));
  return [...cur, ...past];
}
const isOpen = (st) => st.status === 'open' || st.status === 'review';
function passes(x) {
  if (F.status === 'open' && !isOpen(x.st)) return false;
  if (F.status === 'review' && x.st.status !== 'review') return false;
  if (F.status === 'resolved' && x.st.status !== 'resolved') return false;
  if (F.status === 'accepted' && x.st.status !== 'accepted') return false;
  if (F.sev && x.sev !== F.sev) return false;
  if (F.group && (KIND[x.kind] || {}).group !== F.group) return false;
  if (F.pair != null && x.pair !== F.pair) return false;
  if (F.who && x.st.assignee !== F.who) return false;
  return true;
}

function render() {
  const all = items();
  const s = summarize(R, P);
  railEl.innerHTML = rail('issues', P, { open: s.issues.total });
  wireRail(railEl);
  const list = all.filter(passes);
  if (!sel || !all.some((x) => x.key === sel)) sel = list[0] ? list[0].key : null;
  const count = (fn) => all.filter(fn).length;
  const fb = (grp, v, label, n) => `<button class="fb ${F[grp] === v ? 'on' : ''}" data-f="${grp}" data-v="${v == null ? '' : v}"><span>${label}</span><b>${n}</b></button>`;
  const pairs = R.floors.map((f, k) => k).filter((k) => k > 0);
  const wide = matchMedia('(min-width: 1101px)').matches;
  const filters = `<details class="filt-wrap" ${wide || filtOpen ? 'open' : ''}><summary>${icon('i-sliders')}Filters<span>showing ${list.length} of ${all.length}</span></summary><div class="filt">
    <h4>Status</h4>${fb('status', 'open', 'Open', count((x) => isOpen(x.st)))}${fb('status', 'review', 'In review', count((x) => x.st.status === 'review'))}${fb('status', 'resolved', 'Resolved', count((x) => x.st.status === 'resolved'))}${fb('status', 'accepted', 'Accepted as drawn', count((x) => x.st.status === 'accepted'))}${fb('status', 'all', 'All', all.length)}
    <h4>Severity</h4>${fb('sev', null, 'Any', all.length)}${SEVERITIES.map((v) => fb('sev', v, v[0].toUpperCase() + v.slice(1), count((x) => x.sev === v))).join('')}
    <h4>Kind</h4>${fb('group', null, 'Any', all.length)}${GROUPS.map((g) => fb('group', g.key, g.label, count((x) => (KIND[x.kind] || {}).group === g.key))).join('')}
    <h4>Floors</h4>${fb('pair', null, 'Any', all.length)}${pairs.map((k) => fb('pair', k, `${levelTag(R.floors[k - 1])} → ${levelTag(R.floors[k])}`, count((x) => x.pair === k))).join('')}
    <h4>For</h4>${fb('who', null, 'Anyone', all.length)}${WHO.map((w) => fb('who', w, w, count((x) => x.st.assignee === w))).join('')}
  </div></details>`;
  const rows = list.length ? list.map((x) => `<button class="irow ${x.key === sel ? 'on' : ''}" data-sel="${esc(x.key)}">
      <span class="n ${x.sev}">${x.n || '·'}</span><span class="t">${esc(x.title)}</span><span class="badge ${x.st.status}">${esc(STATUS_LABEL[x.st.status])}</span>
      <span class="w">${esc(x.where)} · ${esc(x.st.assignee || '')}${x.current ? '' : ' · not in ' + esc(REV.label)}</span></button>`).join('')
    : `<div class="tile muted">${F.status === 'open' ? `${icon('i-check')} Nothing open${F.sev || F.group || F.pair != null || F.who ? ' with these filters' : ''}.` : 'Nothing here.'}</div>`;
  page.innerHTML = `
    <a class="crumb" href="project.html?id=${encodeURIComponent(P.id)}">${icon('i-back')}${esc(P.name)}</a>
    <div class="page-head"><div><h1>Issues</h1><div class="sub"><span>${s.issues.total} open</span><span class="faint">·</span><span>${count((x) => x.st.status === 'resolved')} resolved</span><span class="faint">·</span><span>${count((x) => x.st.status === 'accepted')} accepted</span><span class="faint">·</span><span>${esc(REV.label)}</span></div></div>
      <div class="acts"><button class="btn" data-rfi>${icon('i-spark')}Draft RFIs with AI</button><button class="btn" data-x="csv">${icon('i-dl')}CSV</button><button class="btn" data-x="dxf">${icon('i-dl')}Markups DXF</button></div></div>
    <div class="ilayout">${filters}<div class="ilist">${rows}</div><div class="idetail" id="detail"></div></div>`;
  renderDetail();
}

function renderDetail() {
  const el = $('#detail');
  if (!el) return;
  const x = items().find((q) => q.key === sel);
  if (!x) { el.innerHTML = ''; return; }
  const pid = encodeURIComponent(P.id);
  let img = '';
  if (x.current) {
    if (!shots.has(x.key)) { try { shots.set(x.key, issueShot(R, x.iss, { w: 520, h: 340, theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' })); } catch { shots.set(x.key, ''); } }
    img = shots.get(x.key) ? `<img src="${shots.get(x.key)}" alt="The issue on the plan" />` : '';
  }
  const st = x.st;
  const measured = x.iss && /offset/.test(x.kind) ? `<div class="kpi-s">Measured: <b class="num">${Math.round(x.iss.value * 1000)} mm</b></div>` : x.iss && x.kind === 'cantilever' ? `<div class="kpi-s">Depth: <b class="num">${x.iss.value.toFixed(2)} m</b></div>` : '';
  el.innerHTML = `${img}
    <div><div class="muted" style="font:12px var(--mono)">${x.n ? `#${x.n} · ` : ''}${esc(x.sev.toUpperCase())} · ${esc(SEV_LABEL[x.sev])}</div><h2>${esc(x.title)}</h2><div class="muted" style="font-size:13px;margin-top:4px">${esc(x.where)}</div></div>
    ${x.iss ? `<p style="margin:0;color:var(--ink-2);font-size:13.5px">${esc(x.iss.detail)}</p>` : `<p class="muted" style="margin:0;font-size:13.5px">Not in ${esc(REV.label)}. Kept here for the record.</p>`}
    ${measured}
    ${x.current ? `<div style="display:flex;gap:6px;flex-wrap:wrap"><a class="btn small" href="workspace.html?id=${pid}&issue=${encodeURIComponent(x.key)}#plan">${icon('i-2d')}Show in plan</a><a class="btn small" href="workspace.html?id=${pid}&issue=${encodeURIComponent(x.key)}#model">${icon('i-home')}Show in 3D</a><button class="btn small" data-copy>${icon('i-doc')}Copy</button></div>` : ''}
    <div class="tile" style="display:grid;gap:10px">
      <div class="stbtns" role="group" aria-label="Status">${['open', 'review', 'resolved', 'accepted'].map((v) => `<button class="btn small ${st.status === v ? 'on' : ''}" data-status="${v}">${esc(STATUS_LABEL[v])}</button>`).join('')}</div>
      <label class="fld"><span>For</span><select id="who">${WHO.map((w) => `<option ${st.assignee === w ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
      <label class="fld"><span>Note</span><textarea id="note" placeholder="e.g. Structural consultant to add a transfer beam; revised drawing due Friday"></textarea></label>
      <div><button class="btn small" data-note>Add note</button></div>
    </div>
    ${st.history && st.history.length ? `<div><h2 class="sec" style="margin:4px 0 8px">History</h2><div class="hist">${[...(st.notes || []).map((n) => ({ at: n.at, text: '“' + n.text + '”' })), ...st.history].sort((a, b) => b.at - a.at).map((h) => `<div><time>${esc(relTime(h.at))}</time>${esc(h.text)}</div>`).join('')}</div></div>` : ''}`;
}

async function save(msg) {
  P.summary = summarize(R, P);
  await saveProject(P);
  if (msg) toast(msg);
  render();
}

page.addEventListener('toggle', (e) => { if (e.target.matches('.filt-wrap')) filtOpen = e.target.open; }, true);
page.addEventListener('click', async (e) => {
  const t = e.target;
  const f = t.closest('[data-f]');
  if (f) { const k = f.dataset.f, v = f.dataset.v; F[k] = v === '' ? null : k === 'pair' ? +v : v; render(); return; }
  const s = t.closest('[data-sel]');
  if (s) { sel = s.dataset.sel; $$('.irow').forEach((r) => r.classList.toggle('on', r.dataset.sel === sel)); renderDetail(); return; }
  const stb = t.closest('[data-status]');
  if (stb) {
    const note = ($('#note') || {}).value || '';
    setStatus(P, sel, stb.dataset.status, note.trim(), REV.label);
    await save(`Marked ${STATUS_LABEL[stb.dataset.status].toLowerCase()}.`);
    return;
  }
  if (t.closest('[data-note]')) {
    const v = ($('#note') || {}).value.trim();
    if (!v) return;
    const st = P.issueState[sel];
    (st.notes ||= []).push({ at: Date.now(), text: v });
    await save('Note added.');
    return;
  }
  if (t.closest('[data-copy]')) {
    const x = items().find((q) => q.key === sel);
    const text = `${x.title}\n${x.where}\n${x.iss ? x.iss.detail : ''}\n— ${P.name}, ${REV.label}`;
    try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { toast('Couldn’t copy.', true); }
    return;
  }
  const x = t.closest('[data-x]');
  if (x) {
    const done = new Set(R.issues.filter((i) => { const st = stateOf(P, i); return st && !isOpen(st); }).map((i) => i.id));
    const base = `${P.name.replace(/[^\w.-]+/g, '-')}-${REV.label.replace(/\s+/g, '')}`;
    if (x.dataset.x === 'csv') download(`${base}-issues.csv`, issuesCSV(R, done), 'text/csv');
    else { download(`${base}-markups.dxf`, markupsDXF(R, done, { file: P.name, date: new Date().toISOString().slice(0, 10) }), 'application/dxf'); toast('Markups saved. XREF them at 0,0 over the drawing.'); }
    return;
  }
  if (t.closest('[data-rfi]')) rfis();
});
page.addEventListener('change', async (e) => {
  if (e.target.id === 'who') { const st = P.issueState[sel]; st.assignee = e.target.value; st.history.push({ at: Date.now(), text: `For ${e.target.value}` }); await save(`Assigned to ${e.target.value}.`); }
});

// ------------------------------------------------------------------ RFIs with AI (optional)
async function rfis() {
  let key = SET.ai && SET.ai.key;
  if (!key) { toast('Add your Anthropic API key in Settings → AI assist first.', true); return; }
  const done = new Set(R.issues.filter((i) => { const st = stateOf(P, i); return st && !isOpen(st); }).map((i) => i.id));
  if (R.issues.length === done.size) { toast('No open issues to write up.'); return; }
  const d = document.createElement('dialog');
  d.className = 'dlg';
  d.style.width = 'min(720px, calc(100vw - 32px))';
  d.innerHTML = `<div class="dlg-in"><h3>${icon('i-spark')} Draft RFIs</h3><p class="muted"><span class="spinner" style="display:inline-block;vertical-align:-4px;margin-right:8px"></span>Writing one request per consultant from ${R.issues.length - done.size} open issues…</p></div>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  try {
    const { draftRFIs } = await import('../ai.js');
    const list = await draftRFIs(key, R, done, { file: P.name });
    const text = (r) => `To: ${r.to}\nSubject: ${r.subject}\n\n${r.body}\n`;
    d.innerHTML = `<div class="dlg-in"><h3>${icon('i-spark')} Draft RFIs <span class="faint" style="font-size:13px">· review before sending</span></h3>
      <div style="display:grid;gap:10px;max-height:60vh;overflow:auto">${list.map((r, i) => `<div class="tile"><h3>${esc(r.to)} <button class="btn small" style="margin-left:auto" data-c="${i}">Copy</button></h3><b>${esc(r.subject)}</b><pre style="white-space:pre-wrap;font:13px/1.5 var(--font);color:var(--ink-2);margin:8px 0 0">${esc(r.body)}</pre></div>`).join('')}</div>
      <div class="dlg-act"><button class="btn" data-all>Copy all</button><button class="btn primary" data-close>Done</button></div></div>`;
    d.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-c]');
      if (c) { try { await navigator.clipboard.writeText(text(list[+c.dataset.c])); toast('Copied.'); } catch { toast('Couldn’t copy.', true); } }
      if (e.target.closest('[data-all]')) { try { await navigator.clipboard.writeText(list.map(text).join('\n---\n\n')); toast('Copied.'); } catch { toast('Couldn’t copy.', true); } }
      if (e.target.closest('[data-close]')) d.close();
    });
  } catch (err) {
    d.innerHTML = `<div class="dlg-in"><h3>Couldn’t draft the RFIs</h3><p>${esc(err.message)}</p><div class="dlg-act"><button class="btn primary" data-close>Close</button></div></div>`;
    d.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) d.close(); });
  }
}

load();
