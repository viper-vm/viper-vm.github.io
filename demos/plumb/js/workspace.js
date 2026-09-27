// Plumb — the workspace of one project: each floor over the one below (Plan), the floors
// pulled apart (Stack), and the building in 3D (3D model). Everything the architect changes
// (a layer role, a unit, a floor's order, an issue's status, storey heights) is saved to the project.

import { Plan2D } from './view2d.js';
import { KIND, GROUPS, SEVERITIES, SEV_LABEL, TYPE_COLOR, TYPE_LABEL, ROLE_COLOR, ROLE_LABEL, levelTag, floorName, fmtArea, esc } from './style.js';
import { ROLES, ROOM_TYPES, normName } from './recognize.js';
import { markupsDXF, issuesCSV, reportHTML, download } from './export.js';
import { injectIcons, setTheme as applyTheme, themeNow, qs } from './shell/ui.js';
import { saveProject, getSettings, saveSettings, pendDrawings } from './shell/store.js';
import { analyseRevision, massRevision } from './shell/engine.js';
import { openProject, number } from './shell/projects.js';
import { attachOrAdd, setStatus, summarize } from './shell/model.js';

injectIcons();
const $ = (s) => document.querySelector(s);
const UNITS = [[1, 'mm'], [10, 'cm'], [1000, 'm'], [25.4, 'in'], [304.8, 'ft']];

const state = {
  P: null, REV: null, SET: null,
  result: null, floorsAll: null,
  k: 1, view: '2d', selected: null, filter: null, nudging: null,
  mass: null, massFor: null, ai: null, rfis: null,
};
const opts = () => state.REV.opts;

// ------------------------------------------------------------------ views
const stage = $('#stage');
const plan = new Plan2D($('#plan'), {
  onHover: showTip,
  onPin: (iss) => select(iss.id, { scroll: true }),
  onClick: (pr) => { hideTip(); openRoomPicker(pr); },
  onNudge: (n) => { if (state.nudging) { state.nudging.dx = n.dx; state.nudging.dy = n.dy; renderPairChip(); } },
});
plan.pads = () => {
  const st = stage.getBoundingClientRect(), hb = $('#hudBottom').getBoundingClientRect(), chip = $('#pairChip').getBoundingClientRect();
  return { t: Math.max(24, chip.bottom - st.top + 14), b: Math.max(24, st.bottom - hb.top + 14), l: 24, r: st.width > 640 ? 60 : 50 };
};
// the 3D views load on first use; the promise is kept so two quick calls share one view
let stack = null, stackP = null;
function getStack() {
  return (stackP ||= (async () => {
    const { Stack3D } = await import('./view3d.js');
    stack = new Stack3D($('#view3d'), { onPin: (iss) => select(iss.id, { scroll: true }) });
    stack.setTheme(themeNow());
    stack.setExplode(+$('#explode').value / 100);
    return stack;
  })());
}
let model = null, modelP = null;
function getModel() {
  return (modelP ||= (async () => {
    const { Model3D } = await import('./model3d.js');
    model = new Model3D($('#model3d'));
    model.setTheme(themeNow());
    model.setHeights(heights());
    model.setCut(1);
    return model;
  })());
}
const heights = () => ({ ...state.SET.heights, ...(state.P.heights || {}) });

// ------------------------------------------------------------------ analysis
let job = 0;
async function runAnalysis() {
  const id = ++job;
  busy('Reading the drawing…');
  const t0 = performance.now();
  try {
    await saveProject(state.P);
    const r = await analyseRevision(state.P, state.REV, { onStage: (s) => { if (id === job) busy(s); } });
    if (id !== job) return;
    attachOrAdd(state.P, state.REV, r);
    number(r);
    const left = 220 - (performance.now() - t0);
    if (left > 0) await new Promise((res) => setTimeout(res, left));
    state.P.summary = summarize(r, state.P);
    state.REV.summary = state.P.summary;
    saveProject(state.P).catch(() => {});
    onResult(r);
  } catch (err) {
    if (id !== job) return;
    console.error(err);
    busy(null);
    toast(String(err.message || err).split('\n')[0], true);
  }
}

async function ensureMass() {
  if (state.mass && state.massFor === state.result) return state.mass;
  const forResult = state.result;
  busy('Building the 3D model…');
  try {
    const mass = await massRevision(state.P, state.REV, { onStage: (s) => busy(s) });
    if (state.result !== forResult) return null;
    state.mass = mass; state.massFor = forResult;
    return mass;
  } finally { busy(null); }
}

function onResult(r, { first = false } = {}) {
  busy(null);
  const prevState = state.selected && state.result ? (state.result.issues.find((i) => i.id === state.selected) || {}).stateId : null;
  state.result = r;
  if (!opts().floors) state.floorsAll = r.floors.map((f) => ({ ...f }));
  else state.floorsAll = opts().floors;
  if (!r.floors.length) { toast('No floor plans found. Titles like “FIRST FLOOR PLAN” under each plan help; see Help.', true); renderAll(); return; }
  const same = prevState && r.issues.find((i) => i.stateId === prevState);
  state.selected = same ? same.id : null;
  if (!same && !first) {
    const firstIss = openIssues()[0];
    state.k = Math.min(Math.max(1, firstIss ? firstIss.upper : Math.min(state.k, r.floors.length - 1)), Math.max(0, r.floors.length - 1));
  }
  if (r.floors.length < 2) state.k = 0;
  state.mass = null;
  plan.setData(r);
  plan.setPair(state.k, false);
  plan.fit(false);
  plan.setSelected(state.selected);
  plan.setDismissed(dismissedIds());
  if (stack) { stack.setData(r); stack.setDismissed(dismissedIds()); stack.setSelected(state.selected); }
  renderAll();
  if (state.view === 'model') showModel();
}

const statusOf = (iss) => (iss.stateId && state.P.issueState[iss.stateId] ? state.P.issueState[iss.stateId].status : 'open');
const isDone = (iss) => { const s = statusOf(iss); return s === 'accepted' || s === 'resolved'; };
const openIssues = () => state.result.issues.filter((i) => !isDone(i));
function dismissedIds() { return new Set(state.result ? state.result.issues.filter(isDone).map((i) => i.id) : []); }

// ------------------------------------------------------------------ rendering
function renderAll() {
  renderHeader();
  renderDimBtn();
  renderFloors();
  renderLayers();
  renderSummary();
  renderFilters();
  renderIssues();
  renderPairChip();
  renderLegend();
  renderLevels();
}

function renderHeader() {
  const P = state.P;
  document.title = `${P.name} · Plumb`;
  $('#wsName').textContent = P.name;
  $('#wsRev').textContent = `${state.REV.label}${P.city ? ' · ' + P.city : ''}`;
  $('#backBtn').href = `project.html?id=${encodeURIComponent(P.id)}`;
  $('#allIssues').href = `issues.html?id=${encodeURIComponent(P.id)}`;
  const r = state.result;
  if (!r) return;
  const cur = r.unit.mm;
  const src = r.unit.source === 'you' ? 'set by you' : r.unit.source;
  $('#unitsRow').innerHTML = `<span>Units</span><select id="unitSel" title="Drawing units · ${esc(src)}">${UNITS.map(([v, n]) => `<option value="${v}" ${Math.abs(v - cur) < 1e-9 ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="faint">${esc(src)}</span>`;
}

function includedIndex(fa) {
  if (fa.excluded) return -1;
  let n = 0;
  for (const f of state.floorsAll) { if (f === fa) return n; if (!f.excluded) n++; }
  return -1;
}

function renderFloors() {
  const r = state.result, el = $('#floors');
  if (!r || !state.floorsAll) { el.innerHTML = ''; $('#floorsSub').textContent = ''; return; }
  const n = r.floors.length;
  $('#floorsSub').textContent = n ? `${n} · top first` : '';
  let gx0 = Infinity, gx1 = -Infinity;
  r.an.forEach((a, k) => { const T = r.transforms[k]; gx0 = Math.min(gx0, a.box[0] + T.tx); gx1 = Math.max(gx1, a.box[2] + T.tx); });
  const span = Math.max(1, gx1 - gx0);
  const rows = [];
  const all = state.floorsAll;
  for (let p = all.length - 1; p >= 0; p--) {
    const fa = all[p], k = includedIndex(fa);
    const inPairLower = k >= 0 && k === state.k - 1, inPairUpper = k >= 0 && k === state.k && state.k > 0;
    let slab = '', meta = 'left out of the stack';
    if (k >= 0) {
      const a = r.an[k], T = r.transforms[k];
      const x0 = ((a.box[0] + T.tx - gx0) / span) * 100, x1 = ((a.box[2] + T.tx - gx0) / span) * 100;
      slab = `<div class="fl-slab"><i style="left:${x0.toFixed(1)}%;width:${(x1 - x0).toFixed(1)}%"></i></div>`;
      meta = `${a.rooms.length} rooms · ${a.columns.length} cols · ${a.footprintArea.toFixed(0)} m²`;
    }
    rows.push(`<li class="fl ${fa.excluded ? 'excluded' : ''} ${inPairLower || inPairUpper ? 'in-pair' : ''} ${inPairLower ? 'is-lower' : ''} ${inPairUpper ? 'is-upper' : ''}" data-p="${p}" tabindex="0">
      <span class="fl-tag">${esc(levelTag(fa))}</span>
      <span class="fl-title" title="${esc(fa.title)}">${esc(floorName(fa))}</span>
      <span class="fl-tools">
        <button data-act="up" title="Move up the stack" ${p === all.length - 1 ? 'disabled' : ''}><svg><use href="#i-up"/></svg></button>
        <button data-act="down" title="Move down the stack" ${p === 0 ? 'disabled' : ''}><svg><use href="#i-down"/></svg></button>
        <button data-act="toggle" title="${fa.excluded ? 'Put back in the stack' : 'Leave out (not a floor plan)'}"><svg><use href="#${fa.excluded ? 'i-plus' : 'i-x'}"/></svg></button>
      </span>
      <span class="fl-meta">${esc(meta)}</span>
      ${slab}
    </li>`);
    if (k > 0) {
      const iss = r.issues.filter((i) => i.upper === k && !isDone(i));
      const al = r.aligns[k];
      const dots = SEVERITIES.flatMap((s) => iss.filter((i) => i.severity === s).map(() => `<i class="dot" style="background:var(--${s})"></i>`)).slice(0, 9).join('');
      const how = al ? (al.method === 'columns' ? `${al.matched}/${al.of} col` : al.method.replace(' + nudge', ' +adj')) : '';
      rows.push(`<li class="joint ${k === state.k ? 'on' : ''}" data-k="${k}" title="Check ${esc(floorName(r.floors[k - 1]))} → ${esc(floorName(r.floors[k]))}">
        ${iss.length ? `<span class="dots">${dots}</span><span>${iss.length} issue${iss.length > 1 ? 's' : ''}</span>` : `<span class="okay"><svg><use href="#i-check"/></svg>lines up</span>`}
        <span class="how">${esc(how)}</span>
      </li>`);
    }
  }
  el.innerHTML = rows.join('');
  const weak = r.aligns.map((a, k) => ({ a, k })).filter(({ a }) => a && a.method !== 'columns' && !/nudge/.test(a.method));
  $('#alignNote').innerHTML = weak.length
    ? `<b style="color:var(--medium)">Check alignment:</b> ${weak.map(({ a, k }) => `${esc(floorName(r.floors[k]))} was placed by its ${a.method === 'core' ? 'stair/lift core' : 'outline'}`).join('; ')} (too few matching columns). Use <em>Adjust</em> on the plan if it's off.`
    : n > 1 ? 'Floors are stacked by matching their columns; columns that don\'t match are the findings.' : '';
}

function renderLayers() {
  const r = state.result, el = $('#layers');
  if (!r) { el.innerHTML = ''; return; }
  const content = (l) => (l.stats ? l.stats.segs + l.stats.arcs + l.stats.texts + l.stats.fills : 0);
  const layers = r.layers.filter((l) => content(l) > 0).sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || content(b) - content(a));
  el.innerHTML = layers.map((l) => {
    const o = ROLES.map((ro) => `<option value="${ro}" ${ro === l.role ? 'selected' : ''}>${ROLE_LABEL[ro]}${ro === l.autoRole && !l.auto ? ' (auto)' : ''}</option>`).join('');
    return `<div class="ly ${l.role === 'other' || l.role === 'text' || l.role === 'dim' ? 'ly-dim' : ''}">
      <span class="ly-sw" style="background:${ROLE_COLOR[l.role]}"></span>
      <span class="ly-name" title="${esc(l.name)}">${esc(l.name)}<small>${content(l)}</small></span>
      <select data-layer="${esc(l.name)}" class="${l.auto ? '' : 'you'}" title="${l.auto ? 'Read from the layer name and what is drawn on it' : 'Set by you or your office standard'}">${o}</select>
    </div>`;
  }).join('') || '<p class="pane-note">No layers with content.</p>';
}

function renderSummary() {
  const r = state.result, el = $('#summary');
  if (!r || !r.floors.length) { el.innerHTML = ''; return; }
  const open = openIssues();
  const n = { high: 0, medium: 0, low: 0 };
  for (const i of open) n[i.severity]++;
  const joints = Math.max(0, r.floors.length - 1);
  const done = r.issues.length - open.length;
  const verdict = !open.length ? 'ok' : n.high ? '' : 'medium';
  const title = r.floors.length < 2 ? 'One floor plan' : !open.length ? (r.issues.length ? 'All closed' : 'Everything stacks up') : `${open.length} thing${open.length > 1 ? 's' : ''} to check`;
  el.innerHTML = `
    <div class="sm-head">
      <span class="sm-verdict ${verdict}"><svg><use href="#${!open.length ? 'i-check' : 'i-alert'}"/></svg></span>
      <div><div class="sm-title">${title}</div>
      <div class="sm-sub">${r.floors.length} floor${r.floors.length > 1 ? 's' : ''} · ${joints} joint${joints === 1 ? '' : 's'} checked${done ? ` · ${done} closed` : ''}</div></div>
    </div>
    <div class="sm-bars">${SEVERITIES.map((s) => `<div class="sm-bar ${s} ${n[s] ? '' : 'zero'}" title="${SEV_LABEL[s]}"><span>${s}</span><b>${n[s]}</b></div>`).join('')}</div>`;
}

function renderFilters() {
  const r = state.result, el = $('#filters');
  if (!r || !r.issues.length) { el.innerHTML = ''; return; }
  const count = (g) => r.issues.filter((i) => (KIND[i.kind] || {}).group === g).length;
  const chips = [`<button class="chip ${!state.filter ? 'on' : ''}" data-f="">All <b>${r.issues.length}</b></button>`];
  for (const g of GROUPS) {
    const c = count(g.key);
    if (c) chips.push(`<button class="chip ${state.filter === g.key ? 'on' : ''}" data-f="${g.key}"><svg><use href="#${g.icon}"/></svg>${g.label} <b>${c}</b></button>`);
  }
  el.innerHTML = chips.join('');
}

function renderIssues() {
  const r = state.result, el = $('#issues');
  if (!r) { el.innerHTML = ''; return; }
  if (r.floors.length < 2) {
    el.innerHTML = `<li class="issues-empty">Plumb compares each floor with the one below it, so the checks need at least two floor plans. Upload the other floors as a revision, or put every plan in one drawing with a title under each.</li>`;
    return;
  }
  const list = r.issues.filter((i) => !state.filter || (KIND[i.kind] || {}).group === state.filter);
  if (!list.length) {
    el.innerHTML = `<li class="issues-empty"><svg><use href="#i-check"/></svg>Columns, wet areas, shafts, cores and slab edges all line up across ${r.floors.length} floors.</li>`;
    return;
  }
  const out = [];
  for (const s of SEVERITIES) {
    const g = list.filter((i) => i.severity === s);
    if (!g.length) continue;
    out.push(`<li class="ig-h">${s} · ${SEV_LABEL[s].toLowerCase()} <span>${g.length}</span></li>`);
    for (const i of g) {
      const st = statusOf(i), done = isDone(i);
      const lo = r.floors[i.lower], up = r.floors[i.upper];
      out.push(`<li class="iss ${i.id === state.selected ? 'on' : ''} ${done ? 'dismissed' : ''}" data-id="${i.id}" tabindex="0">
        <span class="iss-n ${i.severity}">${i.n}</span>
        <div class="iss-title">${esc(i.title)}</div>
        <div class="iss-where"><span class="fchip">${esc(levelTag(lo))}→${esc(levelTag(up))}</span>${esc(floorName(up))} · ${esc(i.where)}${st === 'review' ? ' · <b style="color:var(--medium)">in review</b>' : ''}</div>
        <div class="iss-body">
          <p class="iss-detail">${esc(i.detail)}</p>
          <div class="iss-actions">
            <button data-act="zoom"><svg><use href="#i-eye"/></svg>Show me</button>
            <button data-act="accept"><svg><use href="#${done ? 'i-x' : 'i-check'}"/></svg>${done ? 'Reopen' : 'Accept as drawn'}</button>
            <a data-act="more" href="issues.html?id=${encodeURIComponent(state.P.id)}&issue=${encodeURIComponent(i.stateId || '')}"><svg><use href="#i-issues"/></svg>Notes &amp; status</a>
          </div>
        </div>
      </li>`);
    }
  }
  el.innerHTML = out.join('');
}

function renderPairChip() {
  const r = state.result, el = $('#pairChip');
  if (!r || !r.floors.length) { el.innerHTML = ''; return; }
  if (state.view === '3d') {
    el.innerHTML = `<span class="pc-f"><svg><use href="#i-xray"/></svg>${r.floors.length} floors</span><span class="pc-how">drag to orbit · scroll to zoom · click a number</span>`;
    return;
  }
  if (state.view === 'model') { el.innerHTML = ''; return; }
  if (r.floors.length < 2) { el.innerHTML = `<span class="pc-f"><i style="background:var(--ink)"></i>${esc(floorName(r.floors[0]))}</span>`; return; }
  const k = state.k, lo = r.floors[k - 1], up = r.floors[k], al = r.aligns[k];
  if (state.nudging) {
    const nd = state.nudging;
    el.innerHTML = `<span class="pc-f"><svg><use href="#i-move"/></svg>Drag the violet floor into place</span>
      <span class="pc-how">${fmtMM(nd.dx)}, ${fmtMM(nd.dy)} mm · arrows 10 mm, ⇧ 100 mm</span>
      <button class="pc-btn" data-act="nudge-cancel">Cancel</button><button class="pc-btn on" data-act="nudge-apply">Apply</button>`;
    return;
  }
  const how = al ? (al.method === 'columns' ? `aligned on ${al.matched}/${al.of} columns` : al.method === 'core' ? 'aligned on the core' : al.method === 'bounds' ? 'aligned on the outline' : `aligned on ${al.matched}/${al.of} columns, adjusted`) : '';
  el.innerHTML = `
    <span class="pc-f"><i style="background:var(--below)"></i>${esc(floorName(lo))}</span>
    <span class="pc-arrow">→</span>
    <span class="pc-f"><i style="background:var(--above)"></i>${esc(floorName(up))}</span>
    <span class="pc-how">${esc(how)}</span>
    <span class="pc-step"><button data-act="pair-down" title="Pair below" ${k <= 1 ? 'disabled' : ''}><svg><use href="#i-down"/></svg></button><button data-act="pair-up" title="Pair above" ${k >= r.floors.length - 1 ? 'disabled' : ''}><svg><use href="#i-up"/></svg></button></span>
    <button class="pc-btn" data-act="nudge" title="Line the two floors up by hand"><svg><use href="#i-move"/></svg>Adjust</button>
    ${opts().nudges && opts().nudges[k] ? '<button class="pc-btn" data-act="nudge-reset" title="Back to the automatic alignment">Reset</button>' : ''}`;
}
const fmtMM = (m) => (m >= 0 ? '+' : '−') + Math.abs(Math.round(m * 1000));

function renderLegend() {
  const el = $('#legend');
  const r = state.result;
  const v = state.view;
  $('#mixWrap').hidden = v !== '2d' || !r || r.floors.length < 2;
  $('#explodeWrap').hidden = v !== '3d' || !r;
  $('#hud2d').hidden = v !== '2d' || !r;
  for (const id of ['levels', 'presets', 'dock']) $('#' + id).hidden = v !== 'model' || !r;
  if (v !== 'model') { $('#cutPop').hidden = true; $('#heightsPop').hidden = true; }
  if (!r || !r.floors.length) { el.innerHTML = ''; return; }
  if (v === 'model') { el.innerHTML = ''; return; }
  if (v === '3d') {
    const types = ['toilet', 'kitchen', 'bedroom', 'living', 'circulation', 'duct', 'stair'];
    el.innerHTML = types.map((t) => `<span class="lg"><i style="background:${TYPE_COLOR[t]}"></i>${TYPE_LABEL[t]}</span>`).join('') +
      `<span class="lg"><i style="background:var(--high)"></i>Problem column / shaft</span>`;
    return;
  }
  if (r.floors.length < 2) { el.innerHTML = ''; return; }
  const on = plan.show;
  el.innerHTML = `
    <span class="lg"><i class="line" style="background:var(--below)"></i>Below</span>
    <span class="lg"><i class="line" style="background:var(--above)"></i>Above</span>
    <span class="lg opt" title="Where the two floors agree, their lines add up to white"><i class="line" style="background:var(--ink)"></i>Both</span>
    <span class="lg toggle ${on.wet ? '' : 'off'}" data-show="wet" title="Wet rooms above (hatched) over bedrooms &amp; living below (tint) — click to toggle"><i class="hatch" style="color:var(--above)"></i>Wet above <i style="background:color-mix(in srgb,var(--below) 40%,transparent)"></i>Dry below</span>
    <span class="lg toggle ${on.overhang ? '' : 'off'}" data-show="overhang" title="Slab beyond the floor below — click to toggle"><i class="hatch" style="color:var(--medium)"></i>Overhang</span>
    <span class="lg toggle opt ${on.labels ? '' : 'off'}" data-show="labels" title="Click to toggle">Aa Names</span>
    ${on.dims ? '<span class="lg toggle" data-show="dims" title="The dimensions drawn in the CAD file — click to hide"><svg style="width:14px;height:14px"><use href="#i-ruler"/></svg>Dimensions</span>' : ''}`;
}

/** The 3D model's levels strip: top floor first, plus "All". */
function renderLevels() {
  const r = state.result, el = $('#levels');
  if (!r) { el.innerHTML = ''; return; }
  const focus = model ? model.focus : -1;
  el.innerHTML = `<button data-lv="-1" class="${focus < 0 ? 'on' : ''}" title="Whole building">All</button>` +
    r.floors.map((f, k) => ({ f, k })).reverse().map(({ f, k }) => `<button data-lv="${k}" class="${focus === k ? 'on' : ''}" title="Up to ${esc(floorName(f))}">${esc(levelTag(f))}</button>`).join('');
}

function toggleDims() {
  if (!state.result) return;
  plan.setShow('dims', !plan.show.dims);
  renderDimBtn();
  renderLegend();
  if (!state.selected) plan.fit(true);
}
function renderDimBtn() {
  const b = $('#dimBtn'), r = state.result;
  const n = r ? r.geometry.reduce((a, g) => a + ((g.dims && g.dims.count) || 0), 0) : 0;
  b.disabled = !n;
  b.setAttribute('aria-pressed', String(!!(n && plan.show.dims)));
  b.title = n ? `${plan.show.dims ? 'Hide' : 'Show'} the drawing's own dimensions — ${n} found (D)` : 'No dimensions found in this drawing';
}

// ------------------------------------------------------------------ selection
function select(id, { scroll = false, fly = true } = {}) {
  const r = state.result;
  if (!r) return;
  state.selected = id;
  const iss = id ? r.issues.find((i) => i.id === id) : null;
  if (iss && iss.upper !== state.k) { state.k = iss.upper; plan.setPair(state.k, false); }
  plan.setSelected(id);
  if (iss && fly && state.view === '2d') plan.focusIssue(iss);
  if (stack) { stack.setSelected(id); if (iss && fly && state.view === '3d') stack.focusIssue(iss); }
  if (model && model.data) { model.setIssue(iss); if (iss && fly && state.view === 'model') focusModelIssue(iss); }
  renderIssues();
  renderFloors();
  renderPairChip();
  if (scroll && id) {
    const li = $(`#issues [data-id="${id}"]`);
    if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
function setPair(k) {
  if (!state.result) return;
  state.k = k;
  if (state.nudging) cancelNudge();
  plan.setPair(k, true);
  const sel = state.selected && state.result.issues.find((i) => i.id === state.selected);
  if (sel && sel.upper !== k) { state.selected = null; plan.setSelected(null); if (stack) stack.setSelected(null); renderIssues(); }
  renderFloors();
  renderPairChip();
}
async function toggleAccept(id) {
  const iss = state.result.issues.find((i) => i.id === id);
  if (!iss || !iss.stateId) return;
  setStatus(state.P, iss.stateId, isDone(iss) ? 'open' : 'accepted', '', state.REV.label);
  state.P.summary = summarize(state.result, state.P);
  await saveProject(state.P);
  const d = dismissedIds();
  plan.setDismissed(d);
  if (stack) stack.setDismissed(d);
  renderSummary(); renderIssues(); renderFloors();
}

// ------------------------------------------------------------------ nudge (hand alignment)
function startNudge() {
  if (!state.result || state.k < 1) return;
  if (state.view !== '2d') setView('2d');
  state.nudging = { k: state.k, dx: 0, dy: 0 };
  plan.setNudge({ dx: 0, dy: 0 });
  renderPairChip();
  toast('Drag the violet (upper) floor until the walls turn white. Arrow keys nudge.');
}
function cancelNudge() { state.nudging = null; plan.setNudge(null); renderPairChip(); }
function applyNudge() {
  const n = state.nudging;
  if (!n) return;
  const nudges = { ...(opts().nudges || {}) };
  const prev = nudges[n.k] || [0, 0];
  nudges[n.k] = [prev[0] + n.dx, prev[1] + n.dy];
  opts().nudges = nudges;
  state.nudging = null;
  plan.setNudge(null);
  runAnalysis();
}

// ------------------------------------------------------------------ room type picker
function openRoomPicker(pr) {
  closePicker();
  if (!state.result || state.nudging) return;
  const room = pr.above || pr.below;
  if (!room) { if (state.selected) select(null); return; }
  const floor = pr.above ? state.k : state.k - 1;
  const f = state.result.floors[floor];
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.id = 'picker';
  const named = !!(room.label && room.label.trim());
  pop.innerHTML = `<h4>${esc(room.name)} <span style="color:var(--muted);font-weight:400">· ${esc(floorName(f))}</span></h4>
    <p>${fmtArea(room.area)}${room.sizeText ? ' · ' + esc(room.sizeText) : ''} · read as <b>${esc(TYPE_LABEL[room.type])}</b>. ${named ? `Wrong? Pick what every room called “${esc(room.label.trim())}” is:` : 'This space has no name in the drawing, so it can’t be re-typed here. Label it in CAD.'}</p>
    ${named ? `<div class="types">${ROOM_TYPES.map((t) => `<button data-type="${t}" class="${t === room.type ? 'on' : ''}"><i style="background:${TYPE_COLOR[t]}"></i>${TYPE_LABEL[t]}</button>`).join('')}</div>` : ''}`;
  stage.appendChild(pop);
  const W = stage.clientWidth, H = stage.clientHeight;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.min(W - pw - 8, Math.max(8, pr.sx + 12)) + 'px';
  pop.style.top = Math.min(H - ph - 8, Math.max(8, pr.sy + 12)) + 'px';
  pop.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-type]');
    if (!b) return;
    const key = normName(room.label);
    const types = new Map(opts().types || []);
    types.set(key, b.dataset.type);
    opts().types = [...types];
    state.SET = await saveSettings({ roomTypes: { ...(state.SET.roomTypes || {}), [key]: b.dataset.type } });
    closePicker();
    toast(`“${room.label.trim()}” is now read as ${TYPE_LABEL[b.dataset.type].toLowerCase()}. Re-checking…`);
    runAnalysis();
  });
}
function closePicker() { $('#picker')?.remove(); }

// ------------------------------------------------------------------ tooltip
function showTip(pr) {
  const tip = $('#tip');
  if (!pr || $('#picker')) { tip.hidden = true; return; }
  const rows = [];
  const room = (r) => (r ? `${esc(r.name)}<small>${fmtArea(r.area)}</small>` : '<span style="color:var(--faint)">—</span>');
  const col = (c) => (c ? `<small>column ${Math.round(c.w * 1000)}×${Math.round(c.h * 1000)}</small>` : '');
  if (state.result.floors.length > 1) {
    rows.push(`<div class="t-row"><span class="t-k above">Above</span><span class="t-v">${room(pr.above)}${col(pr.colAbove)}</span></div>`);
    rows.push(`<div class="t-row"><span class="t-k below">Below</span><span class="t-v">${room(pr.below)}${col(pr.colBelow)}</span></div>`);
  } else rows.push(`<div class="t-row"><span class="t-k">Room</span><span class="t-v">${room(pr.above)}</span></div>`);
  if (pr.issue) rows.push(`<div class="t-issue" style="color:var(--${pr.issue.severity})">${pr.issue.n}. ${esc(pr.issue.title)}</div>`);
  if (!pr.above && !pr.below && !pr.issue && !pr.colAbove && !pr.colBelow) { tip.hidden = true; return; }
  tip.innerHTML = rows.join('');
  tip.hidden = false;
  const W = stage.clientWidth, H = stage.clientHeight;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = pr.sx + 16, y = pr.sy + 16;
  if (x + tw > W - 8) x = pr.sx - tw - 12;
  if (y + th > H - 8) y = pr.sy - th - 12;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
function hideTip() { $('#tip').hidden = true; }

// ------------------------------------------------------------------ panels
const panelPref = (v) => { try { return localStorage.getItem('plumb.ws.panels.' + v); } catch { return null; } };
const setPanelPref = (v, s) => { try { localStorage.setItem('plumb.ws.panels.' + v, s); } catch { /* private mode */ } };
function applyPanels() {
  const v = state.view;
  const wide = innerWidth > 980;
  const saved = panelPref(v);
  const def = v === 'model' ? '' : v === '3d' ? 'r' : wide ? 'lr' : '';
  const s = saved ?? def;
  document.body.classList.toggle('no-left', !s.includes('l'));
  document.body.classList.toggle('no-right', !s.includes('r'));
  $('#leftToggle').setAttribute('aria-pressed', String(s.includes('l')));
  $('#rightToggle').setAttribute('aria-pressed', String(s.includes('r')));
  requestAnimationFrame(() => { plan._resize(); plan.request(); if (stack) { stack._resize(); stack.request(); } if (model) { model._resize(); model.request(); } });
}
function togglePanel(side) {
  const cur = (document.body.classList.contains('no-left') ? '' : 'l') + (document.body.classList.contains('no-right') ? '' : 'r');
  const next = cur.includes(side) ? cur.replace(side, '') : cur + side;
  setPanelPref(state.view, next);
  applyPanels();
}

// ------------------------------------------------------------------ view switch
async function setView(v) {
  state.view = v;
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  document.body.dataset.view = v;
  $('#plan').hidden = v !== '2d';
  $('#view3d').hidden = v !== '3d';
  $('#model3d').hidden = v !== 'model';
  hideTip(); closePicker();
  document.body.classList.remove('hide-ui');
  $('#hideHint').hidden = true;
  const hash = v === '2d' ? '#plan' : v === '3d' ? '#stack' : '#model';
  if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
  applyPanels();
  renderPairChip();
  renderLegend();
  if (!state.result) return;
  if (v === 'model') { if (state.nudging) cancelNudge(); await showModel(); return; }
  if (v === '3d') {
    if (state.nudging) cancelNudge();
    const s = await getStack();
    if (s.data !== state.result) { s.setData(state.result); s.setDismissed(dismissedIds()); s.setSelected(state.selected); }
    s._resize();
    const iss = state.selected && state.result.issues.find((i) => i.id === state.selected);
    if (iss) s.focusIssue(iss);
    s.request();
  } else { plan._resize(); plan.request(); }
}

async function showModel() {
  if (!state.result || !state.result.floors.length) return;
  const [m, mass] = await Promise.all([getModel(), ensureMass()]);
  if (!mass || state.view !== 'model') return;
  if (m.data !== state.result || m.mass !== mass) m.setData(state.result, mass);
  m._resize();
  const iss = state.selected && state.result.issues.find((i) => i.id === state.selected);
  m.setIssue(iss);
  if (iss) focusModelIssue(iss);
  m.request();
  renderLevels();
  syncDock();
}
/** Open the model up to the issue's floor, cut into it, and fly to the pin. */
function focusModelIssue(iss) {
  model.focusIssue(iss);
  $('#mCut').value = Math.round(model.cut * 100);
  $('#cutPop').hidden = false;
  renderLevels();
  syncDock();
}
function syncDock() {
  if (!model) return;
  $('#dkRoof').setAttribute('aria-pressed', String(model.roof));
  $('#dkColors').setAttribute('aria-pressed', String(model.roomColors));
  $('#dkCut').setAttribute('aria-pressed', String(model.cut < 0.999));
  $('#cutVal').textContent = model.cut < 0.999 ? `${(model.cut * (model.h.floor - model.h.slab)).toFixed(1)} m` : '';
}
function openHeights() {
  const pop = $('#heightsPop');
  if (!pop.hidden) { pop.hidden = true; return; }
  for (const [k, v] of Object.entries(model.h)) if (pop.elements[k]) pop.elements[k].value = v;
  pop.hidden = false;
}

function setTheme(t) {
  applyTheme(t);
  plan.setTheme(t);
  if (stack) stack.setTheme(t);
  if (model) model.setTheme(t);
}

// ------------------------------------------------------------------ chrome
let busyTimer = 0;
function busy(text) {
  const el = $('#busy');
  clearTimeout(busyTimer);
  if (!text) { el.hidden = true; return; }
  $('#busyText').textContent = text;
  if (el.hidden) busyTimer = setTimeout(() => { el.hidden = false; }, 120); else el.hidden = false;
}
let toastTimer = 0;
function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), bad ? 6500 : 3200);
}

function menu() {
  document.querySelector('.menu')?.remove();
  const m = document.createElement('div');
  m.className = 'popover menu';
  const pid = encodeURIComponent(state.P.id);
  m.innerHTML = `<a href="project.html?id=${pid}">Project overview</a><a href="issues.html?id=${pid}">All issues</a><a href="import.html?project=${pid}">Upload a revision…</a>
    <hr /><button data-m="dxf">Markups DXF</button><button data-m="csv">Issue log CSV</button><button data-m="report">Printable report</button>
    <hr /><button data-m="rfi">Draft RFIs with AI…</button><button data-m="naming">Ask AI about layer names…</button>
    <hr /><a href="settings.html">Settings</a><a href="help.html">Help</a><a href="./">All projects</a>`;
  document.body.appendChild(m);
  const r = $('#menuBtn').getBoundingClientRect();
  m.style.position = 'fixed';
  m.style.top = r.bottom + 6 + 'px';
  m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
  m.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    m.remove();
    ({ dxf: exportDXF, csv: exportCSV, report: printReport, rfi: () => openAI('rfi'), naming: () => openAI('naming') })[b.dataset.m]();
  });
  setTimeout(() => document.addEventListener('pointerdown', function close(e) { if (!m.contains(e.target) && e.target !== $('#menuBtn')) { m.remove(); document.removeEventListener('pointerdown', close); } }), 0);
}

// ------------------------------------------------------------------ exports
const baseName = () => `${state.P.name}-${state.REV.label}`.replace(/[^\w.-]+/g, '-');
function exportDXF() {
  if (!state.result || !state.result.issues.length) { toast('Nothing to mark up. No issues found.'); return; }
  download(`${baseName()}-markups.dxf`, markupsDXF(state.result, dismissedIds(), { file: state.P.name, date: new Date().toISOString().slice(0, 10) }), 'application/dxf');
  toast('Markups saved. XREF (or insert) at 0,0 over your drawing; each open issue is ringed on both floors, on PLUMB-* layers.');
}
function exportCSV() { if (state.result) download(`${baseName()}-issues.csv`, issuesCSV(state.result, dismissedIds()), 'text/csv'); }
function printReport() {
  if (!state.result) return;
  const units = { 1: 'mm', 10: 'cm', 1000: 'm', 25.4: 'in', 304.8: 'ft' }[state.result.unit.mm] || `${state.result.unit.mm} mm`;
  $('#printSheet').innerHTML = reportHTML(state.result, dismissedIds(), { file: `${state.P.name} · ${state.REV.label}`, date: new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' }), units, rfis: state.rfis }, (iss) => plan.snapshot(iss));
  setTimeout(() => window.print(), 60);
}

// ------------------------------------------------------------------ AI assist (optional, your key)
function openAI(mode) {
  const r = state.result;
  if (!r || !r.floors.length) return;
  const open = openIssues();
  if (mode === 'rfi' && !open.length) { toast('No open findings to write up.'); return; }
  state.ai = { mode, abort: null, naming: null };
  const nLayers = r.layers.filter((l) => l.stats && l.stats.segs + l.stats.arcs + l.stats.texts + l.stats.fills > 0).length;
  const nLabels = new Set(r.an.flatMap((a) => a.rooms.map((q) => (q.label || '').trim()).filter(Boolean))).size;
  $('#aiTitle').textContent = mode === 'naming' ? 'Read my drawing’s naming' : 'Draft RFIs for each consultant';
  $('#aiIntro').innerHTML = mode === 'naming'
    ? 'Plumb reads layers and room labels with rules. Office layer codes, abbreviations (<i>M.B.R., K.T., T&amp;B</i>) or labels in Gujarati or Hindi can trip it up. The AI reads the names and suggests corrections; you pick which to apply.'
    : `The AI turns the ${open.length} open finding${open.length > 1 ? 's' : ''} into one RFI per consultant (structure, plumbing, lifts), ready to paste into an email. They also go into the printed report.`;
  $('#aiWhat').textContent = mode === 'naming'
    ? `Sent: ${nLayers} layer names with counts of what’s drawn on each, and ${nLabels} room labels. No geometry.`
    : 'Sent: the findings (titles, floors, positions in words) and the project name. No geometry.';
  $('#aiGoText').textContent = mode === 'naming' ? 'Read the names' : 'Draft RFIs';
  $('#aiKey').value = state.SET.ai.key || '';
  aiStatus('');
  $('#aiOut').innerHTML = mode === 'rfi' && state.rfis ? rfiHTML(state.rfis) : '';
  $('#aiDlg').showModal();
  if (!state.SET.ai.key) $('#aiKey').focus();
}
let aiTimer = 0;
function aiStatus(text, bad = false, spin = false) {
  const el = $('#aiStatus');
  el.classList.toggle('bad', bad);
  el.innerHTML = (spin ? '<span class="spinner"></span>' : '') + esc(text);
}
async function runAI(e) {
  e.preventDefault();
  const ai = state.ai;
  if (!ai || ai.abort) return;
  const key = $('#aiKey').value.trim();
  if (!/^sk-ant-[\w-]{10,}$/.test(key)) { aiStatus('That doesn’t look like an Anthropic API key (it starts with sk-ant-).', true); return; }
  if ($('#aiRemember').checked && key !== state.SET.ai.key) state.SET = await saveSettings({ ai: { ...state.SET.ai, key, enabled: true } });
  ai.abort = new AbortController();
  $('#aiGo').disabled = true;
  const t0 = performance.now();
  const say = () => aiStatus(`${ai.mode === 'naming' ? 'Reading the names' : 'Drafting the RFIs'}… ${Math.round((performance.now() - t0) / 1000)} s`, false, true);
  say();
  aiTimer = setInterval(say, 1000);
  try {
    const { readNaming, draftRFIs } = await import('./ai.js');
    if (ai.mode === 'naming') {
      ai.naming = await readNaming(key, state.result, ai.abort.signal);
      $('#aiOut').innerHTML = namingHTML(ai.naming);
    } else {
      state.rfis = await draftRFIs(key, state.result, dismissedIds(), { file: state.P.name }, ai.abort.signal);
      $('#aiOut').innerHTML = rfiHTML(state.rfis);
    }
    aiStatus(`Done in ${Math.round((performance.now() - t0) / 1000)} s.`);
  } catch (err) {
    aiStatus(err.message, true);
  } finally {
    clearInterval(aiTimer);
    ai.abort = null;
    $('#aiGo').disabled = false;
  }
}
function namingHTML(out) {
  const n = out.layers.length + out.rooms.length;
  const note = out.notes ? `<p class="ai-note">${esc(out.notes)}</p>` : '';
  if (!n) return `${note}<p class="ai-note">The AI checked ${out.sent.layers} layers and ${out.sent.rooms} room labels and agrees with how Plumb read them.</p>`;
  const rows = (items, kind) => items.map((it, i) => `<tr>
      <td><label><input type="checkbox" checked data-kind="${kind}" data-i="${i}" /> ${esc(kind === 'layer' ? it.name : it.label)}</label></td>
      <td><span class="from">${esc(kind === 'layer' ? ROLE_LABEL[it.from] : TYPE_LABEL[it.from])}</span> → <span class="to">${esc(kind === 'layer' ? ROLE_LABEL[it.role] : TYPE_LABEL[it.type])}</span></td>
      <td class="why">${esc(it.why)}</td></tr>`).join('');
  return `${note}
    ${out.layers.length ? `<table class="ai-table"><thead><tr><th>Layer</th><th>Reading</th><th>Why</th></tr></thead><tbody>${rows(out.layers, 'layer')}</tbody></table>` : ''}
    ${out.rooms.length ? `<table class="ai-table"><thead><tr><th>Room label</th><th>Type</th><th>Why</th></tr></thead><tbody>${rows(out.rooms, 'room')}</tbody></table>` : ''}
    <button class="btn primary" data-act="apply-naming"><svg><use href="#i-check"/></svg>Apply and re-check</button>`;
}
async function applyNaming() {
  const nm = state.ai && state.ai.naming;
  if (!nm) return;
  const roles = new Map(opts().roles || []), types = new Map(opts().types || []);
  let n = 0;
  for (const cb of document.querySelectorAll('#aiOut input[type=checkbox]:checked')) {
    const it = (cb.dataset.kind === 'layer' ? nm.layers : nm.rooms)[+cb.dataset.i];
    if (!it) continue;
    if (cb.dataset.kind === 'layer') roles.set(it.name, it.role); else types.set(normName(it.label), it.type);
    n++;
  }
  $('#aiDlg').close();
  if (!n) return;
  opts().roles = [...roles]; opts().types = [...types];
  toast(`Applied ${n} correction${n > 1 ? 's' : ''} from AI. Re-checking…`);
  runAnalysis();
}
function rfiHTML(rfis) {
  if (!rfis.length) return '<p class="ai-note">Nothing to send.</p>';
  return `<div style="display:flex;justify-content:flex-end;margin:0 0 8px"><button class="btn small" data-act="copy-all"><svg><use href="#i-dl"/></svg>Copy all</button></div>` +
    rfis.map((r, i) => `<div class="rfi"><div class="rfi-head"><span class="rfi-to">${esc(r.to)}</span><button class="btn small" data-act="copy" data-i="${i}">Copy</button></div>
      <div class="rfi-subject">${esc(r.subject)}</div><p class="rfi-body">${esc(r.body)}</p></div>`).join('');
}
const rfiText = (r) => `To: ${r.to}\nSubject: ${r.subject}\n\n${r.body}\n`;
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Copied.'); } catch { toast('Couldn’t copy. Select the text instead.', true); } }

// ------------------------------------------------------------------ events
function wire() {
  $('#viewSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); });
  $('#themeBtn').addEventListener('click', () => setTheme(themeNow() === 'dark' ? 'light' : 'dark'));
  $('#menuBtn').addEventListener('click', menu);
  $('#leftToggle').addEventListener('click', () => togglePanel('l'));
  $('#rightToggle').addEventListener('click', () => togglePanel('r'));
  $('#zoomIn').addEventListener('click', () => plan.zoomBy(1.4));
  $('#zoomOut').addEventListener('click', () => plan.zoomBy(1 / 1.4));
  $('#zoomFit').addEventListener('click', () => plan.fit(true));
  $('#dimBtn').addEventListener('click', toggleDims);
  $('#mix').addEventListener('input', (e) => plan.setMix(+e.target.value / 100));
  $('#explode').addEventListener('input', async (e) => (await getStack()).setExplode(+e.target.value / 100));
  $('#exportDxf').addEventListener('click', exportDXF);
  $('#printBtn').addEventListener('click', printReport);
  $('#aiNaming').addEventListener('click', () => openAI('naming'));
  $('#aiForm').addEventListener('submit', runAI);
  $('#aiClose').addEventListener('click', () => $('#aiDlg').close());
  $('#aiDlg').addEventListener('close', () => { if (state.ai && state.ai.abort) state.ai.abort.abort(); });
  $('#aiDlg').addEventListener('click', (e) => {
    if (e.target === $('#aiDlg')) { $('#aiDlg').close(); return; }
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'apply-naming') applyNaming();
    if (b.dataset.act === 'copy') copyText(rfiText(state.rfis[+b.dataset.i]));
    if (b.dataset.act === 'copy-all') copyText(state.rfis.map(rfiText).join('\n---\n\n'));
  });

  // 3D model controls
  $('#levels').addEventListener('click', (e) => { const b = e.target.closest('[data-lv]'); if (b && model) { model.setFocus(+b.dataset.lv); renderLevels(); } });
  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b || !model) return;
    document.querySelectorAll('#presets button').forEach((q) => q.classList.toggle('on', q === b));
    model.viewPreset(b.dataset.view);
  });
  $('#dkFit').addEventListener('click', () => model && model.fit(true));
  $('#dkCut').addEventListener('click', () => {
    if (!model) return;
    const on = model.cut >= 0.999;
    model.setCut(on ? +$('#mCut').value / 100 : 1);
    $('#cutPop').hidden = !on;
    syncDock();
  });
  $('#mCut').addEventListener('input', (e) => { if (model) { model.setCut(+e.target.value / 100); syncDock(); } });
  $('#dkRoof').addEventListener('click', () => { if (model) { model.setRoof(!model.roof); syncDock(); } });
  $('#dkColors').addEventListener('click', () => { if (model) { model.setRoomColors(!model.roomColors); syncDock(); } });
  $('#dkHeights').addEventListener('click', () => model && openHeights());
  $('#dkShot').addEventListener('click', () => {
    if (!model) return;
    const url = model.snapshot();
    fetch(url).then((r) => r.blob()).then((b) => download(`${baseName()}-3d.png`, b)).catch(() => toast('Couldn’t save the picture.', true));
  });
  $('#dkGlb').addEventListener('click', async () => {
    if (!model || !model.data) return;
    busy('Packing the model…');
    try { download(`${baseName()}-model.glb`, await model.exportGLB()); toast('Saved a .glb: opens in Blender, SketchUp (glTF importer), Rhino 8 or any glTF viewer.'); }
    catch (err) { console.error(err); toast('Couldn’t export the model.', true); }
    finally { busy(null); }
  });
  $('#hpReset').addEventListener('click', async () => {
    state.P.heights = null;
    await saveProject(state.P);
    model.setHeights(state.SET.heights);
    $('#heightsPop').hidden = true;
    syncDock();
  });
  $('#heightsPop').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, h = {};
    for (const k of ['floor', 'slab', 'door', 'sill', 'head', 'parapet']) { const v = parseFloat(f.elements[k].value); if (Number.isFinite(v)) h[k] = v; }
    h.head = Math.max(h.head ?? model.h.head, (h.sill ?? model.h.sill) + 0.3);
    model.setHeights(h);
    state.P.heights = { ...model.h };
    await saveProject(state.P);
    f.hidden = true;
    syncDock();
    toast('Heights saved with this project.');
  });

  $('#legend').addEventListener('click', (e) => {
    const t = e.target.closest('[data-show]');
    if (!t) return;
    plan.setShow(t.dataset.show, !plan.show[t.dataset.show]);
    renderLegend();
    renderDimBtn();
  });
  $('#pairChip').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'pair-up') setPair(state.k + 1);
    if (a === 'pair-down') setPair(state.k - 1);
    if (a === 'nudge') startNudge();
    if (a === 'nudge-cancel') cancelNudge();
    if (a === 'nudge-apply') applyNudge();
    if (a === 'nudge-reset') { const nd = { ...(opts().nudges || {}) }; delete nd[state.k]; opts().nudges = nd; runAnalysis(); }
  });
  $('#floors').addEventListener('click', (e) => {
    const joint = e.target.closest('.joint');
    if (joint) { setPair(+joint.dataset.k); return; }
    const row = e.target.closest('.fl');
    if (!row) return;
    const p = +row.dataset.p, all = state.floorsAll;
    const btn = e.target.closest('button[data-act]');
    if (btn) {
      const a = btn.dataset.act;
      if (a === 'up' && p < all.length - 1) [all[p], all[p + 1]] = [all[p + 1], all[p]];
      else if (a === 'down' && p > 0) [all[p], all[p - 1]] = [all[p - 1], all[p]];
      else if (a === 'toggle') all[p].excluded = !all[p].excluded;
      else return;
      opts().floors = all;
      opts().nudges = {};
      state.selected = null;
      runAnalysis();
      return;
    }
    const k = includedIndex(all[p]);
    if (k >= 0 && state.result.floors.length > 1) setPair(Math.max(1, k));
  });
  $('#layers').addEventListener('change', async (e) => {
    const s = e.target.closest('select[data-layer]');
    if (!s) return;
    const l = state.result.layers.find((q) => q.name === s.dataset.layer);
    const roles = new Map(opts().roles || []);
    if (l && s.value === l.autoRole) roles.delete(l.name); else roles.set(s.dataset.layer, s.value);
    opts().roles = [...roles];
    state.SET = await saveSettings({ layerRoles: { ...(state.SET.layerRoles || {}), [s.dataset.layer]: s.value } });
    runAnalysis();
  });
  $('#unitsRow').addEventListener('change', (e) => {
    if (e.target.id !== 'unitSel') return;
    opts().unitMM = +e.target.value;
    opts().floors = null;
    opts().nudges = {};
    runAnalysis();
  });
  $('#filters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.filter = b.dataset.f || null;
    renderFilters(); renderIssues();
  });
  $('#issues').addEventListener('click', (e) => {
    const li = e.target.closest('.iss');
    if (!li) return;
    const btn = e.target.closest('[data-act]');
    if (btn && btn.dataset.act === 'more') return;
    if (btn && btn.dataset.act === 'accept') { toggleAccept(li.dataset.id); return; }
    if (btn && btn.dataset.act === 'zoom') { select(li.dataset.id); return; }
    select(li.dataset.id === state.selected && !btn ? null : li.dataset.id);
  });
  $('#issues').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('iss')) select(e.target.dataset.id); });

  // a new revision can be dropped straight onto the workspace
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { depth++; $('#dropveil').hidden = false; } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('#dropveil').hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0; $('#dropveil').hidden = true;
    if (await pendDrawings(e.dataTransfer?.files || [])) location.href = `import.html?project=${encodeURIComponent(state.P.id)}`;
    else toast('Plumb reads DWG and DXF drawings.', true);
  });

  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element)) return;
    if ($('#picker') && !e.target.closest('#picker') && e.target !== $('#plan')) closePicker();
    if (!$('#heightsPop').hidden && !e.target.closest('#heightsPop, #dkHeights')) $('#heightsPop').hidden = true;
  });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.closest('input, select, textarea, dialog[open]')) return;
    if (state.nudging) {
      const st = e.shiftKey ? 0.1 : 0.01;
      const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
      if (d) { e.preventDefault(); state.nudging.dx += d[0]; state.nudging.dy += d[1]; plan.setNudge({ dx: state.nudging.dx, dy: state.nudging.dy }); renderPairChip(); return; }
      if (e.key === 'Enter') { applyNudge(); return; }
      if (e.key === 'Escape') { cancelNudge(); return; }
    }
    if (e.key === 'Escape') { closePicker(); if (document.body.classList.contains('hide-ui')) { document.body.classList.remove('hide-ui'); $('#hideHint').hidden = true; } if (state.selected) select(null, { fly: false }); return; }
    if (!state.result) return;
    if (e.key === 'j' || e.key === 'k' || ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target instanceof Element && e.target.closest('#issues'))) {
      const list = [...document.querySelectorAll('#issues .iss')].map((li) => li.dataset.id);
      if (!list.length) return;
      e.preventDefault();
      const i = list.indexOf(state.selected);
      const next = e.key === 'j' || e.key === 'ArrowDown' ? list[Math.min(list.length - 1, i + 1)] : list[Math.max(0, i - 1)];
      select(next, { scroll: true });
      $(`#issues [data-id="${next}"]`)?.focus({ preventScroll: true });
    }
    if (e.key === '2') setView('2d');
    if (e.key === '3') setView('3d');
    if (e.key === 'm') setView('model');
    if (e.key === 'f') { if (state.view === '2d') plan.fit(true); else if (state.view === 'model') model && model.fit(true); else stack && stack.fit(true); }
    if (e.key === 'd' && state.view === '2d') toggleDims();
    if (e.key === 'h' && state.view === 'model') {
      const on = document.body.classList.toggle('hide-ui');
      $('#hideHint').hidden = !on;
      requestAnimationFrame(() => { if (model) { model._resize(); model.request(); } });
    }
  });
  window.addEventListener('resize', () => applyPanels());
  window.addEventListener('plumb:theme', (e) => { plan.setTheme(e.detail); if (stack) stack.setTheme(e.detail); if (model) model.setTheme(e.detail); });
}

// ------------------------------------------------------------------ boot
window.plumb = { state, plan, get stack() { return stack; }, get model() { return model; }, select, setView, setPair };
wire();
(async () => {
  const id = qs('id');
  if (!id) { location.replace('./'); return; }
  const want = location.hash === '#model' ? 'model' : location.hash === '#stack' ? '3d' : '2d';
  state.view = want;
  document.body.dataset.view = want;
  applyPanels();
  try {
    state.SET = await getSettings();
    const { project, rev, result } = await openProject(id, (s) => busy(s));
    state.P = project; state.REV = rev;
    rev.opts ||= { roles: [], types: [], nudges: {}, unitMM: null, floors: null };
    plan.setTheme(themeNow());
    // where to start: a requested issue or floor, else the busiest pair
    const wantIss = qs('issue') && result.issues.find((i) => i.stateId === qs('issue'));
    const wantFloor = qs('floor') != null ? Math.max(1, Math.min(result.floors.length - 1, +qs('floor'))) : null;
    const open = result.issues.filter((i) => { const s = project.issueState[i.stateId]; return !s || s.status === 'open' || s.status === 'review'; });
    state.k = wantIss ? wantIss.upper : wantFloor != null ? wantFloor : Math.max(result.floors.length > 1 ? 1 : 0, open[0] ? open[0].upper : 1);
    state.result = null;
    onResult(result, { first: true });
    await setView(want);
    if (wantIss) select(wantIss.id, { scroll: true });
    if (qs('report')) setTimeout(printReport, 400);
  } catch (err) {
    busy(null);
    $('#wsName').textContent = 'Can’t open this project';
    $('#stage').insertAdjacentHTML('beforeend', `<div class="ws-error"><h2>Can’t open this project</h2><p>${esc(err.message)}</p><a class="btn" href="./">All projects</a></div>`);
  }
})();
