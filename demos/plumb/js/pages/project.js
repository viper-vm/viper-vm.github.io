// Plumb — Project overview: the state of one building at a glance, and the way into its work.

import { injectIcons, rail, wireRail, $, esc, icon, toast, busy, promptBox, fmtArea, relTime, fmtDate, qs, onDropFiles } from '../shell/ui.js';
import { saveProject, getSettings, pendDrawings } from '../shell/store.js';
import { openProject } from '../shell/projects.js';
import { PROJECT_STATUS, STATUS_LABEL, prevRev, stateOf, summarize } from '../shell/model.js';
import { levelTag, floorName, SEVERITIES, KIND } from '../style.js';
import { markupsDXF, issuesCSV, download } from '../export.js';

injectIcons();
const railEl = $('#rail');
const page = $('#page');
const id = qs('id');
let P = null, REV = null, R = null, SET = null;

async function load() {
  if (!id) { location.replace('./'); return; }
  try {
    SET = await getSettings();
    ({ project: P, rev: REV, result: R } = await openProject(id, (s) => busy(s)));
    busy(null);
  } catch (err) {
    busy(null);
    railEl.innerHTML = rail('overview'); wireRail(railEl);
    page.innerHTML = `<a class="crumb" href="./">${icon('i-back')}All projects</a><div class="empty">${icon('i-alert')}<h2>Can’t open this project</h2><p>${esc(err.message)}</p><a class="btn" href="./">Back to all projects</a></div>`;
    return;
  }
  document.title = `${P.name} · Plumb`;
  render();
}

const openIssues = () => R.issues.filter((i) => { const st = stateOf(P, i); return !st || st.status === 'open' || st.status === 'review'; });

function render() {
  const s = summarize(R, P);
  P.summary = s;
  railEl.innerHTML = rail('overview', P, { open: s.issues.total });
  wireRail(railEl);
  const A = { areaUnit: SET.areaUnit };
  const pid = encodeURIComponent(P.id);
  const prev = prevRev(P, REV);

  // mini section: each floor's plate across the building, top first, with its joint below
  let gx0 = Infinity, gx1 = -Infinity;
  R.an.forEach((a, k) => { const T = R.transforms[k]; gx0 = Math.min(gx0, a.box[0] + T.tx); gx1 = Math.max(gx1, a.box[2] + T.tx); });
  const span = Math.max(1, gx1 - gx0);
  const open = openIssues();
  const section = R.floors.map((f, k) => ({ f, k })).reverse().map(({ f, k }) => {
    const a = R.an[k], T = R.transforms[k];
    const x0 = ((a.box[0] + T.tx - gx0) / span) * 100, x1 = ((a.box[2] + T.tx - gx0) / span) * 100;
    const iss = open.filter((i) => i.upper === k);
    const joint = k > 0 ? `<div class="joint">${iss.length ? `<span class="sevdots">${iss.map((i) => `<i class="${i.severity}"></i>`).join('')}</span><a href="issues.html?id=${pid}&pair=${k}" style="color:inherit">${iss.length} to check between ${esc(levelTag(R.floors[k - 1]))} and ${esc(levelTag(f))}</a>` : `<span class="ok">${icon('i-check')} lines up</span>`}</div>` : '';
    return `<div class="sb"><span class="tag">${esc(levelTag(f))}</span><span class="bar" title="${esc(floorName(f))}"><i style="left:${x0.toFixed(1)}%;width:${(x1 - x0).toFixed(1)}%"></i></span><span class="num muted" style="text-align:right">${fmtArea(a.footprintArea, { areaUnit: 'm2' })}</span>${joint}</div>`;
  }).join('');

  // since the last revision
  let since = '';
  if (prev) {
    const st = Object.values(P.issueState);
    const resolved = st.filter((x) => x.resolvedIn === REV.id).length;
    const added = st.filter((x) => x.found === REV.id).length;
    const before = prev.summary ? new Map(prev.summary.perFloor.map((f) => [f.title, f])) : new Map();
    const deltas = s.perFloor.map((f) => { const b = before.get(f.title); return b ? { f, d: f.area - b.area, dr: f.rooms - b.rooms } : null; }).filter((x) => x && (Math.abs(x.d) > 0.5 || x.dr));
    since = `<div class="tile"><h3>${icon('i-clock')}Since ${esc(prev.label)} <span class="faint">(${esc(fmtDate(prev.date))})</span></h3><div class="delta">
      <div><b class="up">${resolved}</b> issue${resolved === 1 ? '' : 's'} resolved</div>
      <div><b class="${added ? 'down' : ''}">${added}</b> new issue${added === 1 ? '' : 's'}</div>
      ${deltas.slice(0, 4).map((x) => `<div><span class="num ${x.d < 0 ? 'down' : 'up'}">${x.d >= 0 ? '+' : '−'}${Math.abs(x.d).toFixed(1)} m²</span><span>${esc(x.f.name)}${x.dr ? ` · ${x.dr > 0 ? '+' : ''}${x.dr} rooms` : ''}</span></div>`).join('')}
    </div></div>`;
  }

  const top = open.slice(0, 5).map((i) => `<a class="irow" href="issues.html?id=${pid}&issue=${encodeURIComponent(i.stateId || '')}" style="text-decoration:none"><span class="n ${i.severity}">${i.n || ''}</span><span class="t">${esc(i.title)}</span><span class="badge ${(stateOf(P, i) || {}).status || 'open'}">${esc(STATUS_LABEL[(stateOf(P, i) || {}).status || 'open'])}</span><span class="w">${esc(levelTag(R.floors[i.lower]))}→${esc(levelTag(R.floors[i.upper]))} · ${esc(i.where)} · ${esc((KIND[i.kind] || {}).who || '')}</span></a>`).join('');

  const revRows = [...P.revisions].reverse().map((r) => `<tr><td><b>${esc(r.label)}</b>${r.id === REV.id ? ' <span class="badge status">current</span>' : ''}</td><td>${esc(fmtDate(r.date))}</td><td>${esc(r.files.map((f) => f.name).join(', '))}</td><td class="n">${r.summary ? r.summary.issues.all : '—'}</td></tr>`).join('');

  page.innerHTML = `
    <a class="crumb" href="./">${icon('i-back')}All projects</a>
    <div class="page-head">
      <div><h1><span data-rename title="Rename" style="cursor:text">${esc(P.name)}</span></h1>
        <div class="sub">${P.city ? `<span>${icon('i-pin')} ${esc(P.city)}</span>` : ''}${P.client ? `<span>${esc(P.client)}</span>` : ''}
          <select class="inp" id="pstatus" style="height:28px;font-size:12.5px" aria-label="Stage">${Object.entries(PROJECT_STATUS).map(([k, l]) => `<option value="${k}" ${P.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <span class="badge status">${esc(REV.label)} · ${esc(fmtDate(REV.date))}</span></div></div>
      <div class="acts">
        <a class="btn" href="import.html?project=${pid}">${icon('i-upload')}Upload revision</a>
        <a class="btn" href="areas.html?id=${pid}">${icon('i-area')}Area statement</a>
        <a class="btn" href="rules.html?id=${pid}">${icon('i-rule')}Bye-law checks</a>
        <a class="btn" href="workspace.html?id=${pid}#plan">${icon('i-2d')}Plan</a>
        <a class="btn primary" href="workspace.html?id=${pid}#model">${icon('i-home')}3D model</a>
      </div>
    </div>

    <div class="grid g4">
      <div class="tile"><h3>Open issues</h3><div class="kpi-v ${s.issues.high ? 'high' : ''}">${s.issues.total}</div><div class="kpi-s">${SEVERITIES.map((k) => `${s.issues[k]} ${k}`).join(' · ')}</div></div>
      <div class="tile"><h3>Storeys</h3><div class="kpi-v">${esc(s.storeys)}</div><div class="kpi-s">${s.floors} floor plan${s.floors === 1 ? '' : 's'} · ${s.rooms} rooms</div></div>
      <div class="tile"><h3>Built-up area</h3><div class="kpi-v" style="font-size:24px">${fmtArea(s.footprint, { areaUnit: 'm2' })}</div><div class="kpi-s">${SET.areaUnit === 'm2' ? 'sum of floor plates' : `${Math.round(s.footprint * 10.7639).toLocaleString('en-IN')} ft² · sum of floor plates`} · <a href="areas.html?id=${pid}">area statement</a></div></div>
      <div class="tile"><h3>Drawing</h3><div class="kpi-v" style="font-size:24px">${s.unitMM === 1 ? 'mm' : s.unitMM === 1000 ? 'm' : s.unitMM === 10 ? 'cm' : s.unitMM === 25.4 ? 'in' : s.unitMM === 304.8 ? 'ft' : s.unitMM + ' mm'}</div><div class="kpi-s">${s.columns} columns · ${s.dims} dimensions</div></div>
    </div>

    <div class="grid g2" style="margin-top:14px">
      <div class="tile"><h3>${icon('i-layers')}The stack <a class="more" href="workspace.html?id=${pid}#plan">Open plan →</a></h3><div class="section-bars">${section}</div></div>
      <div class="tile"><h3>${icon('i-issues')}Most urgent <a class="more" href="issues.html?id=${pid}">All issues →</a></h3><div class="ilist">${top || `<p class="muted" style="margin:0">${icon('i-check')} Nothing open. Columns, wet areas, shafts, cores and slab edges line up.</p>`}</div></div>
    </div>

    <div class="grid g2" style="margin-top:14px">
      ${since || `<div class="tile"><h3>${icon('i-clock')}Revisions</h3><p class="muted" style="margin:0 0 10px">When the drawings change, upload the new set here. Plumb matches every issue across revisions and marks what got fixed.</p><a class="btn small" href="import.html?project=${pid}">${icon('i-upload')}Upload ${esc(nextRevLabel())}</a></div>`}
      <div class="tile"><h3>${icon('i-dl')}Hand back</h3><div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" data-x="dxf">${icon('i-dl')}Markups DXF</button><button class="btn small" data-x="csv">${icon('i-dl')}Issue log CSV</button>
        <a class="btn small" href="workspace.html?id=${pid}&report=1#plan">${icon('i-print')}Printable report</a></div>
        <p class="muted" style="margin:10px 0 0;font-size:12.5px">Markups ring every open issue on both floors, in the drawing’s own units, on PLUMB-* layers. XREF at 0,0.</p></div>
    </div>

    <h2 class="sec">Floor plans</h2>
    <div class="tblw"><table class="t"><thead><tr><th>Floor</th><th>Title</th><th class="n">Rooms</th><th class="n">Columns</th><th class="n">Plate</th><th></th></tr></thead><tbody>
      ${R.floors.map((f, k) => `<tr class="click" data-floor="${k}"><td><span class="ft-tag">${esc(levelTag(f))}</span></td><td>${esc(floorName(f))}</td><td class="n">${R.an[k].rooms.length}</td><td class="n">${R.an[k].columns.length}</td><td class="n">${fmtArea(R.an[k].footprintArea, A)}</td><td class="muted">${f.repeat > 1 ? `×${f.repeat} typical` : ''}</td></tr>`).join('')}
    </tbody></table></div>

    <div class="grid g2" style="margin-top:14px">
      <div><h2 class="sec" style="margin-top:12px">Revisions</h2><div class="tblw"><table class="t"><thead><tr><th>Rev</th><th>Date</th><th>Files</th><th class="n">Findings</th></tr></thead><tbody>${revRows}</tbody></table></div></div>
      <div><h2 class="sec" style="margin-top:12px">Activity</h2><div class="tile act">${P.activity.slice(0, 8).map((a) => `<div><time>${esc(relTime(a.at))}</time><span>${esc(a.text)}</span></div>`).join('') || '<span class="muted">Nothing yet.</span>'}</div></div>
    </div>`;
}
const nextRevLabel = () => 'Rev ' + String.fromCharCode(65 + P.revisions.length);

page.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('[data-rename]')) {
    const v = await promptBox({ title: 'Rename project', label: 'Name', value: P.name });
    if (v) { P.name = v; await saveProject(P); render(); }
    return;
  }
  const x = t.closest('[data-x]');
  if (x) {
    const accepted = new Set(R.issues.filter((i) => { const st = stateOf(P, i); return st && (st.status === 'accepted' || st.status === 'resolved'); }).map((i) => i.id));
    const base = P.name.replace(/[^\w.-]+/g, '-');
    if (x.dataset.x === 'dxf') { download(`${base}-${REV.label.replace(/\s+/g, '')}-markups.dxf`, markupsDXF(R, accepted, { file: P.name, date: new Date().toISOString().slice(0, 10) }), 'application/dxf'); toast('Markups saved. XREF them at 0,0 over the drawing.'); }
    if (x.dataset.x === 'csv') download(`${base}-${REV.label.replace(/\s+/g, '')}-issues.csv`, issuesCSV(R, accepted), 'text/csv');
    return;
  }
  const fl = t.closest('tr[data-floor]');
  if (fl) location.href = `workspace.html?id=${encodeURIComponent(P.id)}&floor=${fl.dataset.floor}#plan`;
});
page.addEventListener('change', async (e) => {
  if (e.target.id === 'pstatus') { P.status = e.target.value; await saveProject(P); toast(`Marked ${PROJECT_STATUS[P.status]}.`); }
});
onDropFiles(async (files) => {
  if (await pendDrawings(files)) location.href = `import.html?project=${encodeURIComponent(P.id)}`;
  else toast('Plumb reads DWG and DXF drawings.', true);
}, 'Drop the new revision');

load();
