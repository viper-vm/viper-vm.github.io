// Plumb — the app: files in, analysis in a worker, the overlay/stack views, issues out.

import { Plan2D } from './view2d.js';
import { KIND, GROUPS, SEVERITIES, SEV_LABEL, TYPE_COLOR, TYPE_LABEL, ROLE_COLOR, ROLE_LABEL, levelTag, floorName, fmtArea, esc } from './style.js';
import { ROLES, ROOM_TYPES, normName } from './recognize.js';
import { markupsDXF, issuesCSV, reportHTML, download } from './export.js';
import { readNaming, draftRFIs } from './ai.js';

const $ = (s) => document.querySelector(s);
const SAMPLE = { url: 'samples/riverside-residency.dxf', name: 'riverside-residency.dxf' };
const store = {
  get(k) { try { return localStorage.getItem('plumb.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('plumb.' + k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem('plumb.' + k); } catch { /* private mode */ } },
};

const state = {
  files: null,
  label: '',
  isSample: false,
  result: null,
  floorsAll: null,
  floorsEdited: false,
  opts: { roles: new Map(), types: new Map(), nudges: {}, unitMM: null },
  k: 1,
  view: '2d',
  selected: null,
  accepted: new Set(),   // signatures, so "looks fine" survives re-analysis
  filter: null,
  nudging: null,
  theme: store.get('theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  apiKey: store.get('key') || '',
  ai: null,             // {mode, abort, naming}
  rfis: null,           // Claude-drafted RFIs, also printed in the report
};

// ------------------------------------------------------------------ views
const stage = $('#stage');
const plan = new Plan2D($('#plan'), {
  onHover: showTip,
  onPin: (iss) => select(iss.id, { scroll: true }),
  onClick: (pr) => { hideTip(); openRoomPicker(pr); },
  onNudge: (n) => { if (state.nudging) { state.nudging.dx = n.dx; state.nudging.dy = n.dy; renderPairChip(); } },
});
// keep fitted plans clear of the floating chips and sliders
plan.pads = () => {
  const st = stage.getBoundingClientRect(), hb = $('#hudBottom').getBoundingClientRect(), chip = $('#pairChip').getBoundingClientRect();
  return { t: Math.max(24, chip.bottom - st.top + 14), b: Math.max(24, st.bottom - hb.top + 14), l: 24, r: st.width > 640 ? 60 : 50 };
};
let stack = null;
async function getStack() {
  if (stack) return stack;
  const { Stack3D } = await import('./view3d.js');
  stack = new Stack3D($('#view3d'), { onPin: (iss) => select(iss.id, { scroll: true }) });
  stack.setTheme(state.theme);
  stack.setExplode(+$('#explode').value / 100);
  return stack;
}

// ------------------------------------------------------------------ analysis
let worker = null, workerBroken = false, job = 0;
function makeWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('error', () => { workerBroken = true; worker = null; });
  } catch { workerBroken = true; worker = null; }
  return worker;
}

function serialOpts() {
  return {
    roles: [...state.opts.roles],
    types: [...state.opts.types],
    nudges: state.opts.nudges,
    unitMM: state.opts.unitMM || undefined,
    floors: state.floorsEdited && state.floorsAll ? state.floorsAll : undefined,
  };
}

async function runAnalysis() {
  if (!state.files) return;
  const id = ++job;
  busy('Reading the drawing…');
  const t0 = performance.now();
  try {
    const result = await new Promise((resolve, reject) => {
      const w = makeWorker();
      if (!w) return inline().then(resolve, reject);
      const onMsg = (e) => {
        if (e.data.id !== id) return;
        if (e.data.type === 'progress') { if (id === job) busy(e.data.stage); return; }
        w.removeEventListener('message', onMsg);
        w.removeEventListener('error', onErr);
        if (e.data.type === 'result') resolve(e.data.result); else reject(new Error(e.data.message));
      };
      const onErr = () => { w.removeEventListener('message', onMsg); inline().then(resolve, reject); };
      w.addEventListener('message', onMsg);
      w.addEventListener('error', onErr, { once: true });
      w.postMessage({ id, files: state.files, opts: serialOpts() });
    });
    if (id !== job) return;
    // keep the spinner up a beat so quick re-runs don't flicker
    const left = 260 - (performance.now() - t0);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    onResult(result);
  } catch (err) {
    if (id !== job) return;
    console.error(err);
    busy(null);
    const msg = String(err.message || err);
    if (msg === 'DWG_LOAD') failed('Couldn’t load the DWG reader (needs internet the first time). Save the drawing as DXF instead.');
    else if (msg === 'DWG_READ') failed('Couldn’t read this DWG — it may be damaged or from a version LibreDWG doesn’t know yet. Save it as DXF from your CAD app and drop that.');
    else failed(msg.split('\n')[0]);
  }
}

let inlineLast = null;
async function inline() {
  const [{ analyse, analyseFiles }, { pack }, { dwgToDxf }] = await Promise.all([import('./pipeline.js'), import('./pack.js'), import('./dwg.js')]);
  await new Promise((r) => setTimeout(r, 30));
  const opts = { ...serialOpts(), onStage: (s) => busy(s) };
  const files = [];
  for (const f of state.files) files.push(f.dwg ? { name: f.name, text: await dwgToDxf(new Uint8Array(f.bin), (s) => busy(s)) } : f);
  const r = files.length === 1 ? analyse(files[0].text, opts) : analyseFiles(files, opts);
  inlineLast = r;
  return pack(r);
}

/** The 3D parts of every floor (walls, openings…), built once per analysis, on first use. */
let massJob = 0;
async function ensureMass() {
  if (state.mass && state.massFor === state.result) return state.mass;
  const forResult = state.result, id = 'm' + ++massJob;
  busy('Building the 3D model…');
  try {
    let mass;
    const w = makeWorker();
    if (w && !inlineLast) {
      mass = await new Promise((resolve, reject) => {
        const onMsg = (e) => {
          if (e.data.id !== id) return;
          if (e.data.type === 'progress') { busy(e.data.stage); return; }
          w.removeEventListener('message', onMsg);
          if (e.data.type === 'mass') resolve(e.data.mass); else reject(new Error(e.data.message));
        };
        w.addEventListener('message', onMsg);
        w.postMessage({ id, type: 'mass' });
      });
    } else {
      const { massFloor } = await import('./massing.js');
      mass = inlineLast.an.map((a) => massFloor(inlineLast.dx, inlineLast.roles, a));
    }
    if (state.result !== forResult) return null;
    state.mass = mass; state.massFor = forResult;
    return mass;
  } finally { busy(null); }
}

const sig = (i) => `${i.kind}:${i.upper}:${Math.round(i.at[0] * 5)}:${Math.round(i.at[1] * 5)}`;

function onResult(r) {
  busy(null);
  r.issues.forEach((iss, i) => { iss.n = i + 1; iss.sig = sig(iss); });
  const prevSel = state.selected && state.result ? (state.result.issues.find((i) => i.id === state.selected) || {}).sig : null;
  state.result = r;
  if (!state.floorsEdited) state.floorsAll = r.floors.map((f) => ({ ...f }));
  document.body.classList.toggle('has-result', true);
  $('#empty')?.remove();

  if (!r.floors.length) {
    failed('No floor plans found in this drawing. Plumb looks for plans laid out side by side, each with a title like “FIRST FLOOR PLAN” — or drop one DXF per floor.');
    renderAll();
    return;
  }
  const same = prevSel && r.issues.find((i) => i.sig === prevSel);
  state.selected = same ? same.id : null;
  if (!same) {
    const first = r.issues[0];
    state.k = Math.min(Math.max(1, first ? first.upper : Math.min(state.k, r.floors.length - 1)), Math.max(0, r.floors.length - 1));
    if (r.floors.length < 2) state.k = 0;
  }
  state.mass = null;
  plan.setData(r);
  plan.setPair(state.k, false);
  plan.fit(false);
  plan.setSelected(state.selected);
  plan.setDismissed(dismissedIds());
  if (stack) { stack.setData(r); stack.setDismissed(dismissedIds()); stack.setSelected(state.selected); }
  renderAll();
  if (state.view === 'model') showModel();
  if (r.floors.length === 1) toast('Only one floor found. Put every floor plan in the same DXF side by side with a title under each, or drop one DXF per floor.', true);
}

function dismissedIds() {
  const out = new Set();
  if (state.result) for (const i of state.result.issues) if (state.accepted.has(i.sig)) out.add(i.id);
  return out;
}

// ------------------------------------------------------------------ files
async function openFiles(list) {
  const files = [...list].filter((f) => /\.(dxf|dwg)$/i.test(f.name));
  if (!files.length) {
    const other = [...list][0];
    const ext = other ? (other.name.split('.').pop() || '').toLowerCase() : '';
    toast(ext === 'pdf' ? 'Plumb reads CAD drawings, not PDFs — export DWG or DXF from your CAD app.' : 'Plumb reads DWG and DXF drawings (AutoCAD, BricsCAD, ZWCAD, DraftSight, LibreCAD, Revit exports…).', true);
    return;
  }
  busy(`Opening ${files.length > 1 ? files.length + ' files' : files[0].name}…`);
  const out = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.dwg$/i.test(f.name) || isDWG(bytes)) { out.push({ name: f.name, dwg: true, bin: bytes.buffer, stamp: f.lastModified }); continue; }
    if (isBinaryDXF(bytes)) { out.push({ name: f.name, text: bytes }); continue; }
    const text = decodeText(bytes);
    if (!/SECTION|EOF/.test(text.slice(0, 20000))) { busy(null); toast(`${f.name} doesn't look like a DXF file.`, true); return; }
    out.push({ name: f.name, text });
  }
  load(out, files.length > 1 ? `${files.length} files` : files[0].name, false);
}
/** DXF text is UTF-8 from AutoCAD 2007 on, the Windows codepage before that. */
function decodeText(bytes) {
  const t = new TextDecoder('utf-8').decode(bytes);
  return t.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(bytes) : t;
}
const isDWG = (b) => b.length > 6 && b[0] === 0x41 && b[1] === 0x43 && b[2] === 0x31 && b[3] === 0x30; // "AC10…"
function isBinaryDXF(b) {
  const sig = 'AutoCAD Binary DXF';
  if (b.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig.charCodeAt(i)) return false;
  return true;
}
async function loadSample() {
  busy('Opening the sample building…');
  try {
    const res = await fetch(SAMPLE.url);
    if (!res.ok) throw new Error(res.status);
    load([{ name: SAMPLE.name, text: await res.text() }], SAMPLE.name, true);
  } catch {
    busy(null);
    toast('Could not load the sample drawing.', true);
  }
}
function load(files, label, isSample) {
  state.files = files;
  state.label = label;
  state.isSample = isSample;
  state.opts = { roles: new Map(), types: new Map(), nudges: {}, unitMM: null };
  state.floorsAll = null;
  state.floorsEdited = false;
  state.accepted = new Set();
  state.selected = null;
  state.filter = null;
  state.nudging = null;
  state.rfis = null;
  plan.setNudge(null);
  $('#banner').hidden = !isSample || store.get('bannerSeen') === '1';
  runAnalysis();
}

// ------------------------------------------------------------------ rendering
function renderAll() {
  renderDimBtn();
  renderHeader();
  renderFloors();
  renderLayers();
  renderSummary();
  renderFilters();
  renderIssues();
  renderPairChip();
  renderLegend();
}

function renderHeader() {
  const r = state.result;
  $('#fileChip').hidden = !r;
  if (!r) return;
  $('#fcName').textContent = state.label;
  const units = [[1, 'mm'], [10, 'cm'], [1000, 'm'], [25.4, 'in'], [304.8, 'ft']];
  const cur = r.unit.mm;
  const opts = units.map(([v, n]) => `<option value="${v}" ${Math.abs(v - cur) < 1e-9 ? 'selected' : ''}>${n}</option>`).join('');
  const src = r.unit.source === 'you' ? 'set by you' : r.unit.source;
  $('#fcMeta').innerHTML = `<select id="unitSel" title="Drawing units (${esc(src)})">${opts}</select><span class="fc-src"> · ${esc(src)}</span>`;
  $('#unitSel').onchange = (e) => {
    state.opts.unitMM = +e.target.value;
    state.floorsEdited = false;
    state.floorsAll = null;
    state.opts.nudges = {};
    runAnalysis();
  };
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
  $('#floorsSub').textContent = n ? `${n} found · top first` : '';
  // section extents in building x (after alignment)
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
      // true section: the floor plate's x-extent, so overhangs show as a longer slab
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
    // the joint between this floor and the next included floor below it
    if (k > 0) {
      const iss = r.issues.filter((i) => i.upper === k && !state.accepted.has(i.sig));
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
    ? `<b style="color:var(--medium)">Check alignment:</b> ${weak.map(({ a, k }) => `${esc(floorName(r.floors[k]))} was placed by its ${a.method === 'core' ? 'stair/lift core' : 'outline'}`).join('; ')} (too few matching columns). Use <em>Adjust</em> on the overlay if it's off.`
    : n > 1 ? 'Floors are stacked by matching their columns; columns that don\'t match are the findings.' : '';
}

function renderLayers() {
  const r = state.result, el = $('#layers');
  if (!r) { el.innerHTML = ''; return; }
  const content = (l) => (l.stats ? l.stats.segs + l.stats.arcs + l.stats.texts + l.stats.fills : 0);
  const layers = r.layers.filter((l) => content(l) > 0).sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || content(b) - content(a));
  el.innerHTML = layers.map((l) => {
    const opts = ROLES.map((ro) => `<option value="${ro}" ${ro === l.role ? 'selected' : ''}>${ROLE_LABEL[ro]}${ro === l.autoRole && !l.auto ? ' (auto)' : ''}</option>`).join('');
    return `<div class="ly ${l.role === 'other' || l.role === 'text' || l.role === 'dim' ? 'ly-dim' : ''}">
      <span class="ly-sw" style="background:${ROLE_COLOR[l.role]}"></span>
      <span class="ly-name" title="${esc(l.name)}">${esc(l.name)}<small>${content(l)}</small></span>
      <select data-layer="${esc(l.name)}" class="${l.auto ? '' : 'you'}" title="${l.auto ? 'Guessed from the layer name and what is drawn on it' : 'Set by you'}">${opts}</select>
    </div>`;
  }).join('') || '<p class="pane-note">No layers with content.</p>';
}

function renderSummary() {
  const r = state.result, el = $('#summary');
  if (!r || !r.floors.length) { el.innerHTML = ''; return; }
  const open = r.issues.filter((i) => !state.accepted.has(i.sig));
  const n = { high: 0, medium: 0, low: 0 };
  for (const i of open) n[i.severity]++;
  const joints = Math.max(0, r.floors.length - 1);
  const secs = (r.ms.total / 1000).toFixed(1);
  const verdict = !open.length ? 'ok' : n.high ? '' : 'medium';
  const title = r.floors.length < 2 ? 'Only one floor found' : !open.length ? (r.issues.length ? 'All accepted' : 'Everything stacks up') : `${open.length} thing${open.length > 1 ? 's' : ''} to check`;
  el.innerHTML = `
    <div class="sm-head">
      <span class="sm-verdict ${verdict}"><svg><use href="#${!open.length ? 'i-check' : 'i-alert'}"/></svg></span>
      <div><div class="sm-title">${title}</div>
      <div class="sm-sub">${r.floors.length} floor${r.floors.length > 1 ? 's' : ''} · ${joints} joint${joints === 1 ? '' : 's'} checked · read in ${secs} s${state.accepted.size ? ` · ${r.issues.length - open.length} accepted` : ''}</div></div>
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
    el.innerHTML = `<li class="issues-empty">Plumb compares each floor with the one below it, so it needs at least two floor plans.<br><br>Put every plan in one DXF side by side, each with a title like <b>FIRST FLOOR PLAN</b> under it — or drop one DXF per floor (name them <i>ground.dxf</i>, <i>first.dxf</i>…).</li>`;
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
      const acc = state.accepted.has(i.sig);
      const lo = r.floors[i.lower], up = r.floors[i.upper];
      out.push(`<li class="iss ${i.id === state.selected ? 'on' : ''} ${acc ? 'dismissed' : ''}" data-id="${i.id}" tabindex="0">
        <span class="iss-n ${i.severity}">${i.n}</span>
        <div class="iss-title">${esc(i.title)}</div>
        <div class="iss-where"><span class="fchip">${esc(levelTag(lo))}→${esc(levelTag(up))}</span>${esc(floorName(up))} · ${esc(i.where)}</div>
        <div class="iss-body">
          <p class="iss-detail">${esc(i.detail)}</p>
          <div class="iss-actions">
            <button data-act="zoom"><svg><use href="#i-eye"/></svg>Show me</button>
            <button data-act="accept"><svg><use href="#${acc ? 'i-x' : 'i-check'}"/></svg>${acc ? 'Reopen' : 'Looks fine'}</button>
            <span style="margin-left:auto;font:11px var(--mono);color:var(--faint);align-self:center">${esc((KIND[i.kind] || {}).who || '')}</span>
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
    el.innerHTML = `<span class="pc-f"><svg><use href="#i-layers"/></svg>${r.floors.length} floors</span><span class="pc-how">drag to orbit · scroll to zoom · click a number</span>`;
    return;
  }
  if (state.view === 'model') {
    const h = model ? model.h : { floor: 3 };
    el.innerHTML = `<span class="pc-f"><svg><use href="#i-home"/></svg>3D model · ${r.floors.length} floor${r.floors.length > 1 ? 's' : ''}</span><span class="pc-how">${h.floor.toFixed(2)} m floor to floor · drag to orbit, right-drag to pan</span>`;
    return;
  }
  if (r.floors.length < 2) {
    el.innerHTML = `<span class="pc-f"><i style="background:var(--ink)"></i>${esc(floorName(r.floors[0]))}</span>`;
    return;
  }
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
    ${state.opts.nudges[k] ? '<button class="pc-btn" data-act="nudge-reset" title="Back to the automatic alignment">Reset</button>' : ''}`;
}
const fmtMM = (m) => (m >= 0 ? '+' : '−') + Math.abs(Math.round(m * 1000));

function renderLegend() {
  const el = $('#legend');
  const r = state.result;
  $('#mixWrap').hidden = state.view !== '2d' || !r || r.floors.length < 2;
  $('#explodeWrap').hidden = state.view !== '3d' || !r;
  $('#hud2d').hidden = state.view !== '2d' || !r;
  $('#modelBar').hidden = state.view !== 'model' || !r;
  if (!r || !r.floors.length) { el.innerHTML = ''; return; }
  if (state.view === 'model') {
    const on = !model || model.roomColors;
    el.innerHTML = on ? ['bedroom', 'living', 'toilet', 'kitchen', 'circulation', 'balcony'].map((t) => `<span class="lg opt"><i style="background:${TYPE_COLOR[t]}"></i>${TYPE_LABEL[t]}</span>`).join('') : '';
    return;
  }
  if (state.view === '3d') {
    const types = ['toilet', 'kitchen', 'bedroom', 'living', 'circulation', 'duct', 'stair'];
    el.innerHTML = types.map((t) => `<span class="lg"><i style="background:${TYPE_COLOR[t]}"></i>${TYPE_LABEL[t]}</span>`).join('') +
      `<span class="lg"><i style="background:var(--high)"></i>Problem column / shaft</span><span class="lg opt"><i class="line" style="background:var(--high)"></i>Plumb line with nothing below</span>`;
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
  if (iss && fly) plan.focusIssue(iss);
  if (stack) { stack.setSelected(id); if (iss && fly && state.view === '3d') stack.focusIssue(iss); }
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
function toggleAccept(id) {
  const iss = state.result.issues.find((i) => i.id === id);
  if (!iss) return;
  if (state.accepted.has(iss.sig)) state.accepted.delete(iss.sig); else state.accepted.add(iss.sig);
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
function cancelNudge() {
  state.nudging = null;
  plan.setNudge(null);
  renderPairChip();
}
function applyNudge() {
  const n = state.nudging;
  if (!n) return;
  const prev = state.opts.nudges[n.k] || [0, 0];
  state.opts.nudges = { ...state.opts.nudges, [n.k]: [prev[0] + n.dx, prev[1] + n.dy] };
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
    <p>${fmtArea(room.area)}${room.sizeText ? ' · ' + esc(room.sizeText) : ''} · read as <b>${esc(TYPE_LABEL[room.type])}</b>. ${named ? `Wrong? Pick what every room called “${esc(room.label.trim())}” is:` : 'This space has no name in the drawing, so it can’t be re-typed here — label it in CAD.'}</p>
    ${named ? `<div class="types">${ROOM_TYPES.map((t) => `<button data-type="${t}" class="${t === room.type ? 'on' : ''}"><i style="background:${TYPE_COLOR[t]}"></i>${TYPE_LABEL[t]}</button>`).join('')}</div>` : ''}`;
  stage.appendChild(pop);
  const W = stage.clientWidth, H = stage.clientHeight;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.min(W - pw - 8, Math.max(8, pr.sx + 12)) + 'px';
  pop.style.top = Math.min(H - ph - 8, Math.max(8, pr.sy + 12)) + 'px';
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-type]');
    if (!b) return;
    state.opts.types.set(normName(room.label), b.dataset.type);
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
  const room = (r) => r ? `${esc(r.name)}<small>${fmtArea(r.area)}</small>` : '<span style="color:var(--faint)">—</span>';
  const col = (c) => c ? `<small>column ${Math.round(c.w * 1000)}×${Math.round(c.h * 1000)}</small>` : '';
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

// ------------------------------------------------------------------ view switch, theme, chrome
async function setView(v) {
  state.view = v;
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('#plan').hidden = v !== '2d';
  $('#view3d').hidden = v !== '3d';
  $('#model3d').hidden = v !== 'model';
  $('#heightsPop').hidden = true;
  hideTip(); closePicker();
  if (v === 'model') {
    if (state.nudging) cancelNudge();
    renderPairChip(); renderLegend();
    await showModel();
    return;
  }
  if (v === '3d') {
    if (state.nudging) cancelNudge();
    const s = await getStack();
    if (state.result && s.data !== state.result) { s.setData(state.result); s.setDismissed(dismissedIds()); s.setSelected(state.selected); }
    s._resize();
    const iss = state.selected && state.result.issues.find((i) => i.id === state.selected);
    if (iss) s.focusIssue(iss);
    s.request();
  } else {
    plan._resize();
    plan.request();
  }
  renderPairChip();
  renderLegend();
}

// ------------------------------------------------------------------ the 3D model
let model = null;
async function getModel() {
  if (model) return model;
  const { Model3D } = await import('./model3d.js');
  model = new Model3D($('#model3d'));
  model.setTheme(state.theme);
  model.setHeights(loadHeights());
  return model;
}
function loadHeights() { try { return JSON.parse(store.get('heights') || '{}'); } catch { return {}; } }
async function showModel() {
  if (!state.result || !state.result.floors.length) return;
  const [m, mass] = await Promise.all([getModel(), ensureMass()]);
  if (!mass || state.view !== 'model') return;
  if (m.data !== state.result || m.mass !== mass) {
    m.setData(state.result, mass);
    renderModelBar();
  }
  m._resize();
  m.request();
}
function renderModelBar() {
  const r = state.result;
  if (!r || !model) return;
  const sel = $('#mFloor');
  const cur = model.focus;
  sel.innerHTML = `<option value="-1">All floors</option>` + r.floors.map((f, k) => `<option value="${k}">Up to ${esc(levelTag(f))} · ${esc(floorName(f))}</option>`).join('');
  sel.value = String(cur < r.floors.length ? cur : -1);
  $('#mRoof').setAttribute('aria-pressed', String(model.roof));
  $('#mColors').setAttribute('aria-pressed', String(model.roomColors));
  $('#mCut').value = String(Math.round(model.cut * 100));
}
function openHeights() {
  const pop = $('#heightsPop');
  if (!pop.hidden) { pop.hidden = true; return; }
  for (const [k, v] of Object.entries(model.h)) if (pop.elements[k]) pop.elements[k].value = v;
  pop.hidden = false;
}

function setTheme(t) {
  state.theme = t;
  document.documentElement.dataset.theme = t;
  store.set('theme', t);
  $('#themeBtn use').setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', t === 'dark' ? '#0b0d10' : '#f8f7f3');
  plan.setTheme(t);
  if (stack) stack.setTheme(t);
  if (model) model.setTheme(t);
}

let busyTimer = 0;
function busy(text) {
  const el = $('#busy');
  clearTimeout(busyTimer);
  if (!text) { el.hidden = true; return; }
  $('#busyText').textContent = text;
  // don't flash the spinner for instant work
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
function failed(msg) { toast(msg, true); }

// ------------------------------------------------------------------ exports
function baseName() { return (state.label || 'drawing').replace(/\.dxf$/i, '').replace(/[^\w.-]+/g, '-'); }
function exportDXF() {
  if (!state.result || !state.result.issues.length) { toast('Nothing to mark up — no issues found.'); return; }
  const text = markupsDXF(state.result, dismissedIds(), { file: state.label, date: new Date().toISOString().slice(0, 10) });
  download(`${baseName()}-plumb-markups.dxf`, text, 'application/dxf');
  toast('Markups saved. XREF (or insert) at 0,0 over your drawing — each issue is ringed on both floors, on PLUMB-* layers.');
}
function exportCSV() {
  if (!state.result) return;
  download(`${baseName()}-plumb-issues.csv`, issuesCSV(state.result, dismissedIds()), 'text/csv');
}
function printReport() {
  if (!state.result) return;
  const units = { 1: 'mm', 10: 'cm', 1000: 'm', 25.4: 'in', 304.8: 'ft' }[state.result.unit.mm] || `${state.result.unit.mm} mm`;
  $('#printSheet').innerHTML = reportHTML(state.result, dismissedIds(), { file: state.label, date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }), units, rfis: state.rfis }, (iss) => plan.snapshot(iss));
  setTimeout(() => window.print(), 60);
}

// ------------------------------------------------------------------ Claude assist (optional, your key)
function openAI(mode) {
  const r = state.result;
  if (!r || !r.floors.length) return;
  const open = r.issues.filter((i) => !state.accepted.has(i.sig));
  if (mode === 'rfi' && !open.length) { toast('No open findings to write up.'); return; }
  state.ai = { mode, abort: null, naming: null };
  const nLayers = r.layers.filter((l) => l.stats && l.stats.segs + l.stats.arcs + l.stats.texts + l.stats.fills > 0).length;
  const nLabels = new Set(r.an.flatMap((a) => a.rooms.map((q) => (q.label || '').trim()).filter(Boolean))).size;
  $('#aiTitle').textContent = mode === 'naming' ? 'Read my drawing’s naming' : 'Draft RFIs for each consultant';
  $('#aiIntro').innerHTML = mode === 'naming'
    ? 'Plumb reads layers and room labels with rules. Office layer codes, abbreviations (<i>M.B.R., K.T., T&amp;B</i>) or labels in another language can trip it up. Claude reads the names and suggests corrections; you pick which to apply.'
    : `Claude turns the ${open.length} open finding${open.length > 1 ? 's' : ''} into one RFI per consultant (structure, plumbing, lifts), ready to paste into an email or your RFI log. They also go into the printed report.`;
  $('#aiWhat').textContent = mode === 'naming'
    ? `Sent: ${nLayers} layer names with counts of what’s drawn on each, and ${nLabels} room labels. No geometry.`
    : 'Sent: the findings (titles, floors, positions in words) and the file name. No geometry.';
  $('#aiGoText').textContent = mode === 'naming' ? 'Read the names' : 'Draft RFIs';
  $('#aiKey').value = state.apiKey;
  $('#aiRemember').checked = !!store.get('key');
  aiStatus('');
  $('#aiOut').innerHTML = mode === 'rfi' && state.rfis ? rfiHTML(state.rfis) : '';
  $('#aiDlg').showModal();
  if (!state.apiKey) $('#aiKey').focus();
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
  state.apiKey = key;
  if ($('#aiRemember').checked) store.set('key', key); else store.del('key');
  ai.abort = new AbortController();
  $('#aiGo').disabled = true;
  const t0 = performance.now();
  const say = () => aiStatus(`${ai.mode === 'naming' ? 'Claude is reading the names' : 'Claude is drafting'}… ${Math.round((performance.now() - t0) / 1000)} s`, false, true);
  say();
  aiTimer = setInterval(say, 1000);
  try {
    if (ai.mode === 'naming') {
      ai.naming = await readNaming(key, state.result, ai.abort.signal);
      $('#aiOut').innerHTML = namingHTML(ai.naming);
    } else {
      state.rfis = await draftRFIs(key, state.result, dismissedIds(), { file: state.label }, ai.abort.signal);
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
  if (!n) return `${note}<p class="ai-note">Claude checked ${out.sent.layers} layers and ${out.sent.rooms} room labels and agrees with how Plumb read them.</p>`;
  const rows = (items, kind) => items.map((it, i) => `<tr>
      <td><label><input type="checkbox" checked data-kind="${kind}" data-i="${i}" /> ${esc(kind === 'layer' ? it.name : it.label)}</label></td>
      <td><span class="from">${esc(kind === 'layer' ? ROLE_LABEL[it.from] : TYPE_LABEL[it.from])}</span> → <span class="to">${esc(kind === 'layer' ? ROLE_LABEL[it.role] : TYPE_LABEL[it.type])}</span></td>
      <td class="why">${esc(it.why)}</td></tr>`).join('');
  return `${note}
    ${out.layers.length ? `<table class="ai-table"><thead><tr><th>Layer</th><th>Reading</th><th>Why</th></tr></thead><tbody>${rows(out.layers, 'layer')}</tbody></table>` : ''}
    ${out.rooms.length ? `<table class="ai-table"><thead><tr><th>Room label</th><th>Type</th><th>Why</th></tr></thead><tbody>${rows(out.rooms, 'room')}</tbody></table>` : ''}
    <button class="btn primary" data-act="apply-naming"><svg><use href="#i-check"/></svg>Apply and re-check</button>`;
}

function applyNaming() {
  const nm = state.ai && state.ai.naming;
  if (!nm) return;
  let n = 0;
  for (const cb of document.querySelectorAll('#aiOut input[type=checkbox]:checked')) {
    const it = (cb.dataset.kind === 'layer' ? nm.layers : nm.rooms)[+cb.dataset.i];
    if (!it) continue;
    if (cb.dataset.kind === 'layer') state.opts.roles.set(it.name, it.role);
    else state.opts.types.set(normName(it.label), it.type);
    n++;
  }
  $('#aiDlg').close();
  if (!n) return;
  toast(`Applied ${n} correction${n > 1 ? 's' : ''} from Claude. Re-checking…`);
  runAnalysis();
}

function rfiHTML(rfis) {
  if (!rfis.length) return '<p class="ai-note">Nothing to send.</p>';
  return `<div style="display:flex;justify-content:flex-end;margin:0 0 8px"><button class="btn small" data-act="copy-all"><svg><use href="#i-dl"/></svg>Copy all</button></div>` +
    rfis.map((r, i) => `<div class="rfi">
      <div class="rfi-head"><span class="rfi-to">${esc(r.to)}</span><button class="btn small" data-act="copy" data-i="${i}">Copy</button></div>
      <div class="rfi-subject">${esc(r.subject)}</div>
      <p class="rfi-body">${esc(r.body)}</p>
    </div>`).join('');
}
const rfiText = (r) => `To: ${r.to}\nSubject: ${r.subject}\n\n${r.body}\n`;
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Copied.'); } catch { toast('Couldn’t copy — select the text instead.', true); }
}

// ------------------------------------------------------------------ events
function wire() {
  $('#fileInput').addEventListener('change', (e) => { if (e.target.files.length) openFiles(e.target.files); e.target.value = ''; });
  $('#openBtn').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fileInput').click(); } });
  $('#sampleBtn').addEventListener('click', loadSample);
  $('#viewSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); });
  $('#themeBtn').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
  $('#helpBtn').addEventListener('click', () => $('#helpDlg').showModal());
  $('#helpClose').addEventListener('click', () => $('#helpDlg').close());
  $('#helpDlg').addEventListener('click', (e) => { if (e.target === $('#helpDlg')) $('#helpDlg').close(); });
  $('#bannerX').addEventListener('click', () => { $('#banner').hidden = true; store.set('bannerSeen', '1'); });
  $('#zoomIn').addEventListener('click', () => plan.zoomBy(1.4));
  $('#zoomOut').addEventListener('click', () => plan.zoomBy(1 / 1.4));
  $('#zoomFit').addEventListener('click', () => plan.fit(true));
  $('#dimBtn').addEventListener('click', toggleDims);
  $('#mFloor').addEventListener('change', (e) => { model && model.setFocus(+e.target.value); });
  $('#mCut').addEventListener('input', (e) => { model && model.setCut(+e.target.value / 100); });
  $('#mRoof').addEventListener('click', () => { if (!model) return; model.setRoof(!model.roof); renderModelBar(); });
  $('#mColors').addEventListener('click', () => { if (!model) return; model.setRoomColors(!model.roomColors); renderModelBar(); renderLegend(); });
  $('#mHeights').addEventListener('click', () => model && openHeights());
  $('#hpReset').addEventListener('click', async () => {
    const { DEFAULT_HEIGHTS } = await import('./model3d.js');
    store.del('heights'); model.setHeights(DEFAULT_HEIGHTS); $('#heightsPop').hidden = true; renderPairChip();
  });
  $('#heightsPop').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target, h = {};
    for (const k of ['floor', 'slab', 'door', 'sill', 'head', 'parapet']) { const v = parseFloat(f.elements[k].value); if (Number.isFinite(v)) h[k] = v; }
    h.head = Math.max(h.head ?? model.h.head, (h.sill ?? model.h.sill) + 0.3);
    model.setHeights(h);
    store.set('heights', JSON.stringify(model.h));
    f.hidden = true;
    renderPairChip();
  });
  $('#mExport').addEventListener('click', async () => {
    if (!model || !model.data) return;
    busy('Packing the model…');
    try { download(`${baseName()}-model.glb`, await model.exportGLB()); toast('Saved a .glb — opens in Blender, SketchUp (glTF importer), Rhino 8, Windows 3D Viewer or any glTF viewer.'); }
    catch (err) { console.error(err); toast('Couldn’t export the model.', true); }
    finally { busy(null); }
  });
  $('#mix').addEventListener('input', (e) => plan.setMix(+e.target.value / 100));
  $('#explode').addEventListener('input', async (e) => (await getStack()).setExplode(+e.target.value / 100));
  $('#exportDxf').addEventListener('click', exportDXF);
  $('#exportCsv').addEventListener('click', exportCSV);
  $('#printBtn').addEventListener('click', printReport);
  $('#aiNaming').addEventListener('click', () => openAI('naming'));
  $('#aiRfi').addEventListener('click', () => openAI('rfi'));
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

  $('#legend').addEventListener('click', (e) => {
    const t = e.target.closest('[data-show]');
    if (!t) return;
    const key = t.dataset.show;
    plan.setShow(key, !plan.show[key]);
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
    if (a === 'nudge-reset') { const nd = { ...state.opts.nudges }; delete nd[state.k]; state.opts.nudges = nd; runAnalysis(); }
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
      state.floorsEdited = true;
      state.opts.nudges = {};
      state.selected = null;
      runAnalysis();
      return;
    }
    const k = includedIndex(all[p]);
    if (k >= 0 && state.result.floors.length > 1) setPair(Math.max(1, k));
  });
  $('#layers').addEventListener('change', (e) => {
    const s = e.target.closest('select[data-layer]');
    if (!s) return;
    const l = state.result.layers.find((q) => q.name === s.dataset.layer);
    if (l && s.value === l.autoRole) state.opts.roles.delete(l.name); else state.opts.roles.set(s.dataset.layer, s.value);
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
    const btn = e.target.closest('button[data-act]');
    if (btn && btn.dataset.act === 'accept') { toggleAccept(li.dataset.id); return; }
    if (btn && btn.dataset.act === 'zoom') { select(li.dataset.id); return; }
    select(li.dataset.id === state.selected && !btn ? null : li.dataset.id);
  });
  $('#issues').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('iss')) select(e.target.dataset.id);
  });

  // drag & drop anywhere
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { depth++; $('#dropveil').hidden = false; } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) $('#dropveil').hidden = true; });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0; $('#dropveil').hidden = true;
    if (e.dataTransfer?.files?.length) openFiles(e.dataTransfer.files);
  });

  document.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element)) return;
    if ($('#picker') && !e.target.closest('#picker') && e.target !== $('#plan')) closePicker();
    if (!$('#heightsPop').hidden && !e.target.closest('#heightsPop, #mHeights')) $('#heightsPop').hidden = true;
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
    if (e.key === 'Escape') { closePicker(); if (state.selected) select(null, { fly: false }); return; }
    if (!state.result) return;
    if (e.key === 'j' || e.key === 'k' || ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.closest('#issues'))) {
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
  });
}

// ------------------------------------------------------------------ boot
window.plumb = { state, plan, get stack() { return stack; }, get model() { return model; }, select, setView, setPair, openAI, namingHTML, rfiHTML }; // handy from the console
wire();
setTheme(state.theme);
setView('2d');
renderAll();
loadSample();
