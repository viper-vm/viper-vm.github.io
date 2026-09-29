// Plumb — the import wizard: files → floors → units → layers → review. Every step has a sensible
// default, so an office whose layer names are already known clicks Next four times.

import { injectIcons, rail, wireRail, $, $$, esc, icon, toast, busy, fmtArea, fmtBytes, qs, onDropFiles } from '../shell/ui.js';
import { takePending, getProject, getSettings, saveSettings } from '../shell/store.js';
import { analyseLoose, kindOf, decodeText } from '../shell/engine.js';
import { storeFiles, adopt, defaultOpts } from '../shell/projects.js';
import { newProject, newRevision, nextLabel, currentRev, PROJECT_STATUS, storeys } from '../shell/model.js';
import { thumb } from '../shell/thumbs.js';
import { SheetEditor } from '../shell/sheet.js';
import { ROLES, storeyTitle } from '../recognize.js';
import { ROLE_LABEL, ROLE_COLOR, levelTag, floorName, SEVERITIES } from '../style.js';

injectIcons();
const railEl = $('#rail');
const page = $('#page');

const STEPS = ['Files', 'Floors', 'Units', 'Layers', 'Review'];
const UNITS = [[1, 'mm'], [10, 'cm'], [1000, 'm'], [25.4, 'inches'], [304.8, 'feet']];
const CITIES = ['Ahmedabad', 'Gandhinagar', 'Surat', 'Vadodara', 'Rajkot', 'Mumbai', 'Pune', 'Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata', 'Jaipur'];

const S = {
  step: 0, pid: qs('project'), project: null, settings: null,
  files: [], meta: { name: '', auto: true, city: 'Ahmedabad', client: '', status: 'working' },
  opts: { roles: [], types: [], nudges: {}, unitMM: null, floors: null },
  floorsAll: null, floorsEdited: false, result: null, running: false, stage: '', error: null,
  remember: true, thumbs: new Map(), ai: null,
  sel: -1, cam: null, detected: null, // floors marked on the sheet: the selected one, the view, what Plumb found
};

// ------------------------------------------------------------------ analysis
let timer = 0, runId = 0;
function schedule(delay = 250) { clearTimeout(timer); timer = setTimeout(run, delay); }
async function run() {
  if (!S.files.length) { S.result = null; render(); return; }
  const id = ++runId;
  S.running = true; S.error = null; S.stage = 'Reading…';
  render();
  const files = S.files.map((f) => (f.kind === 'dwg' ? { name: f.name, dwg: true, bin: f.bytes.buffer.slice(0), stamp: f.name + f.size } : f.kind === 'dxfb' ? { name: f.name, text: f.bytes } : { name: f.name, text: f.text || (f.text = decodeText(f.bytes)) }));
  const opts = { ...S.opts, floors: S.floorsEdited ? S.floorsAll : null };
  try {
    const r = await analyseLoose(files, opts, (st) => { if (id === runId) { S.stage = st; paintStatus(); } }, { sheet: true });
    if (id !== runId) return;
    S.result = r;
    if (!S.floorsEdited) { S.floorsAll = r.floors.map((f) => ({ ...f, repeat: f.repeat || 1 })); S.detected = r.floors.map((f) => ({ ...f })); S.sel = -1; }
    // pictures of each floor, remembered by position so left-out floors keep theirs
    r.floors.forEach((f, k) => { const key = boxKey(f); if (!S.thumbs.has(key)) S.thumbs.set(key, thumb(r, { only: k, w: 300, h: 188 })); });
  } catch (err) {
    if (id !== runId) return;
    const m = String(err.message || err);
    S.error = m === 'DWG_LOAD' ? 'Couldn’t load the DWG reader (it needs internet the first time). Save the drawing as DXF instead.'
      : m === 'DWG_READ' ? 'Couldn’t read this DWG. It may be damaged or from a version the reader doesn’t know yet; save it as DXF and try again.' : m.split('\n')[0];
  } finally {
    if (id === runId) { S.running = false; render(); }
  }
}
const boxKey = (f) => f.box.map((v) => v.toFixed(1)).join(',');

async function addFiles(list) {
  for (const f of list) {
    const bytes = f.bytes || new Uint8Array(await f.arrayBuffer());
    const kind = kindOf(f.name, bytes);
    if (!kind) { toast(`${f.name} isn’t a DWG or DXF drawing.`, true); continue; }
    if (S.files.some((g) => g.name === f.name && g.size === bytes.byteLength)) continue;
    S.files.push({ name: f.name, bytes, kind, size: bytes.byteLength });
  }
  autoName();
  S.floorsEdited = false; S.floorsAll = null; S.opts.floors = null;
  schedule(0);
}
const pretty = (n) => n.replace(/\.(dwg|dxf)$/i, '').replace(/[_-]+/g, ' ').replace(/\b(rev|r)\s*\w$/i, '').trim().replace(/\b\w/g, (c) => c.toUpperCase());
/** Name a new project after its files until the user types one: one file → its name; several → the words
 *  their names share ("Lakeview GF", "Lakeview FF" → "Lakeview"), else nothing. */
function autoName() {
  if (S.project || !S.meta.auto) return;
  const words = S.files.map((f) => pretty(f.name).split(' '));
  const same = (i) => words.every((w) => i < w.length && w[i].toLowerCase() === words[0][i].toLowerCase());
  let n = 0;
  while (words.length && same(n)) n++;
  S.meta.name = words.length === 1 ? words[0].join(' ') : words.length ? words[0].slice(0, n).join(' ') : '';
}

// ------------------------------------------------------------------ rendering
function render() {
  const sheetFocused = !!editor && document.activeElement === editor.cv; // before the page is replaced
  railEl.innerHTML = rail('projects', S.project);
  const title = S.project ? `New revision · ${esc(S.project.name)}` : 'New project';
  const sub = S.project ? `This becomes <b>${esc(nextLabel(S.project))}</b>. Layer roles and units carry over from ${esc(currentRev(S.project)?.label || 'the last revision')}.` : 'Plumb reads your drawings on this computer. Nothing is uploaded.';
  page.innerHTML = `
    <a class="crumb" href="${S.project ? `project.html?id=${encodeURIComponent(S.project.id)}` : './'}">${icon('i-back')}${S.project ? esc(S.project.name) : 'All projects'}</a>
    <div class="page-head"><div><h1>${title}</h1><div class="sub">${sub}</div></div></div>
    <ol class="steps" aria-label="Steps">${STEPS.map((s, i) => `<li class="step ${i < S.step ? 'done' : i === S.step ? 'on' : ''}"${i === S.step ? ' aria-current="step"' : ''}><b>${i < S.step ? '✓' : i + 1}</b>${s}</li>`).join('')}</ol>
    <div class="wz-body" id="body">${[stepFiles, stepFloors, stepUnits, stepLayers, stepReview][S.step]()}</div>
    <div class="wz-nav">
      <button class="btn" data-back ${S.step === 0 ? 'disabled' : ''}>${icon('i-back')}Back</button>
      <span id="status" class="muted" style="align-self:center;font-size:13px"></span>
      ${S.step < STEPS.length - 1 ? `<button class="btn primary" data-next ${canNext() ? '' : 'disabled'}>Next: ${STEPS[S.step + 1].toLowerCase()}</button>`
        : `<button class="btn primary" data-create ${canNext() ? '' : 'disabled'}>${icon('i-check')}${S.project ? `Add ${esc(nextLabel(S.project))}` : 'Create project'}</button>`}
    </div>`;
  paintStatus();
  mountSheet(sheetFocused);
}

// ------------------------------------------------------------------ marking floors on the sheet
let editor = null;
function mountSheet(focused = false) {
  // the page is redrawn after every change: keep the keyboard on the sheet if it was there
  if (editor) { editor.destroy(); editor = null; }
  const cv = $('#sheet');
  if (!cv || !S.result || !S.result.sheet) return;
  if (focused) cv.focus({ preventScroll: true });
  editor = new SheetEditor(cv, {
    onAdd: addFloor, onChange: changeFloor, onRemove: removeFloor,
    onSelect: (i) => { S.sel = i; $$('.fthumb').forEach((el) => el.classList.toggle('sel', +el.dataset.card === i)); },
    onCamera: (cam) => { S.cam = cam.auto ? null : cam; }, // an automatic fit is redone for the new canvas
  }, S.cam);
  editor.setSheet(S.result.sheet);
  editor.setFloors(sheetFloors(), S.sel);
}
const sheetFloors = () => (S.floorsAll || []).map((f) => ({ box: f.box, tag: levelTag(f), title: floorName(f), excluded: !!f.excluded }));
function edited() { S.floorsEdited = true; schedule(0); }
/** A box drawn over files laid side by side belongs to the file under it (markups go back in its coordinates). */
function sourceOf(box) {
  let best = null, bestA = 0;
  for (const f of S.detected || []) {
    if (!f.origin) continue;
    const a = Math.max(0, Math.min(box[2], f.box[2]) - Math.max(box[0], f.box[0])) * Math.max(0, Math.min(box[3], f.box[3]) - Math.max(box[1], f.box[1]));
    if (a > bestA) { bestA = a; best = f; }
  }
  return best ? { file: best.file, origin: best.origin, k: best.k } : {};
}
function addFloor(box) {
  const inc = S.floorsAll.filter((f) => !f.excluded && f.level < 90);
  const level = inc.length ? Math.max(...inc.map((f) => f.level)) + 1 : 0;
  S.floorsAll.push({ id: S.floorsAll.length, title: storeyTitle(level), level, typical: false, box, repeat: 1, marked: true, ...sourceOf(box) });
  S.sel = S.floorsAll.length - 1;
  edited();
}
function changeFloor(i, box) {
  Object.assign(S.floorsAll[i], { box }, sourceOf(box));
  edited();
}
function removeFloor(i) {
  const f = S.floorsAll[i];
  if (f.marked) S.floorsAll.splice(i, 1); else f.excluded = true; // a floor Plumb found can be put back
  S.sel = -1;
  edited();
}
function paintStatus() {
  const el = $('#status');
  if (!el) return;
  if (S.running) el.innerHTML = `<span class="spinner" style="display:inline-block;vertical-align:-4px;margin-right:8px;width:16px;height:16px"></span>${esc(S.stage)}`;
  else if (S.error) el.innerHTML = `<span style="color:var(--high)">${esc(S.error)}</span>`;
  else if (S.result) el.textContent = `${S.result.floors.length} floor plan${S.result.floors.length === 1 ? '' : 's'} · read in ${(S.result.ms.total / 1000).toFixed(1)} s${S.step === 0 && !S.project && !S.meta.name.trim() ? ' · name the project to go on' : ''}`;
  else el.textContent = '';
}
const canNext = () => !S.running && !S.error && S.result && S.result.floors.length > 0 && (S.step > 0 || S.project || S.meta.name.trim());

function stepFiles() {
  const files = S.files.length ? `<div class="files">${S.files.map((f, i) => `<div class="file"><span class="fi">${f.kind === 'dwg' ? 'DWG' : f.kind === 'dxfb' ? 'BIN' : 'DXF'}</span>
      <div style="min-width:0"><div class="fn">${esc(f.name)}</div><div class="fm">${fmtBytes(f.size)}</div></div>
      <span class="fm">${f.kind === 'dwg' ? 'converted on this computer' : ''}</span>
      <button class="icon-btn" data-remove="${i}" aria-label="Remove ${esc(f.name)}">${icon('i-x')}</button></div>`).join('')}
      <div><button class="btn small" data-pick>${icon('i-plus')}Add files</button> <span class="muted" style="font-size:12.5px">One file per floor? Add them all.</span></div></div>`
    : `<div class="empty" data-pick tabindex="0" role="button">${icon('i-upload')}<h2>Choose your drawings</h2><p>DWG or DXF. One file with every floor plan side by side (each titled like “FIRST FLOOR PLAN”), or one file per floor named like <code>ground.dxf</code>, <code>first-floor.dwg</code>.</p><button class="btn primary" data-pick>${icon('i-open')}Choose files</button></div>`;
  const details = S.project ? '' : `<div class="tile"><h3>Project</h3><div class="frow">
      <label class="fld"><span>Name</span><input id="m-name" value="${esc(S.meta.name)}" placeholder="e.g. Shyamal Residency" autocomplete="off" /></label>
      <label class="fld"><span>City</span><input id="m-city" value="${esc(S.meta.city)}" list="cities" autocomplete="off" /><datalist id="cities">${CITIES.map((c) => `<option value="${c}"></option>`).join('')}</datalist></label>
      <label class="fld"><span>Client <span class="faint">(optional)</span></span><input id="m-client" value="${esc(S.meta.client)}" autocomplete="off" /></label>
      <label class="fld"><span>Stage</span><select id="m-status">${Object.entries(PROJECT_STATUS).map(([k, l]) => `<option value="${k}" ${S.meta.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div></div>`;
  return files + details;
}

function stepFloors() {
  const all = S.floorsAll || [];
  let k = 0;
  const cards = all.map((f, p) => {
    const inc = !f.excluded, idx = inc ? k++ : -1;
    const r = inc && S.result ? S.result.an[idx] : null;
    const img = S.thumbs.get(boxKey(f));
    return `<div class="fthumb ${inc ? '' : 'off'} ${p === S.sel ? 'sel' : ''}" data-card="${p}">
      ${img ? `<img src="${img}" alt="${esc(f.title)}" />` : '<div class="ph"></div>'}
      <div class="ft-b">
        <div class="ft-row"><span class="ft-tag">${esc(levelTag(f))}</span><input data-title="${p}" value="${esc(f.title)}" aria-label="Title of this floor" /></div>
        <div class="ft-row"><span class="muted" style="font-size:12px">${r ? `${r.rooms.length} rooms · ${r.columns.length} cols · ${fmtArea(r.footprintArea, { areaUnit: 'm2' })}` : 'left out'}</span></div>
        <div class="ft-act">
          <button class="icon-btn" data-move="${p}" data-d="-1" title="Lower in the stack" ${p === 0 ? 'disabled' : ''}>${icon('i-down')}</button>
          <button class="icon-btn" data-move="${p}" data-d="1" title="Higher in the stack" ${p === all.length - 1 ? 'disabled' : ''}>${icon('i-up')}</button>
          <button class="icon-btn" data-excl="${p}" title="${inc ? 'Leave out (not a floor plan)' : 'Put back'}">${icon(inc ? 'i-x' : 'i-plus')}</button>
          <label class="ft-typ" title="A typical floor that repeats (e.g. floors 3–7 = ×5)">×<input type="number" min="1" max="99" data-repeat="${p}" value="${f.repeat || 1}" /></label>
        </div>
      </div></div>`;
  }).join('');
  const guessed = (S.detected || []).find((f) => f.guessed); // stays put while you edit, so the sheet doesn't jump
  const one = (S.detected || []).length === 1 && S.files.length === 1 && !S.floorsEdited;
  const why = one ? `<p class="tile" style="margin:0;font-size:13px">${icon('i-alert')} Plumb found one floor plan on this sheet. If it holds more (drawn close together or touching), <b>mark each one</b>: pull this box in round one plan, then drag across the next.</p>`
    : guessed ? `<p class="tile" style="margin:0;font-size:13px">${icon('i-alert')} This drawing has no floor titles, so the floors are ${guessed.guessed === 'stairs' ? 'in the order their stairs give: the plan whose stair only goes <b>UP</b> is the lowest, the one that only goes <b>DOWN</b> is the top' : 'in order from left to right'}. Check the order, and rename each floor if you like.</p>` : '';
  const sheet = S.result && S.result.sheet ? `<div class="sheetbox">
      <canvas id="sheet"></canvas>
      <div class="sheet-tools">
        <button class="icon-btn" data-zoom="1.25" title="Zoom in (+)">${icon('i-plus')}</button>
        <button class="icon-btn" data-zoom="0.8" title="Zoom out (−)">${icon('i-minus')}</button>
        <button class="icon-btn" data-fit title="Fit the sheet (F)">${icon('i-fit')}</button>
        ${S.floorsEdited ? `<button class="btn small" data-redetect title="Forget your changes and find the floors again">Detect again</button>` : ''}
      </div>
    </div>
    <p class="sheet-hint">The whole sheet, with a box round each floor plan. <b>Drag across a plan</b> to add a floor · drag a box to move it · pull its corners to resize · <kbd>Delete</kbd> removes it · scroll to pan, <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + scroll to zoom.</p>` : '';
  return `${why}${sheet}<p class="muted" style="margin:0">Bottom to top, as the building stacks. Rename a floor, move it, leave out anything that isn’t a floor plan (a site plan, a title block), and mark typical floors with how many times they repeat.</p>
    <div class="fthumbs">${cards}</div>`;
}

function stepUnits() {
  const r = S.result;
  if (!r) return '';
  const b = r.an[0].box, w = b[2] - b[0], h = b[3] - b[1];
  const doors = r.an.flatMap((a) => a.doors.map((d) => d.w)).sort((x, y) => x - y);
  const door = doors.length ? doors[Math.floor(doors.length / 2)] : null;
  const rooms = r.an.flatMap((a) => a.rooms).filter((q) => q.type !== 'duct').sort((x, y) => y.area - x.area);
  const cur = S.opts.unitMM || r.unit.mm;
  const unitName = (UNITS.find(([v]) => Math.abs(v - cur) < 1e-9) || [0, `${cur} mm`])[1];
  const sane = (v, lo, hi) => (v >= lo && v <= hi ? 'ok' : 'bad');
  const dc = (r.dimChecks || []).slice(0, 4);
  return `<div class="grid g2">
    <div class="tile"><h3>Drawing units</h3>
      <label class="fld"><span>One drawing unit is</span><select id="unit">${UNITS.map(([v, n]) => `<option value="${v}" ${Math.abs(v - cur) < 1e-9 ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <span class="hint">${S.opts.unitMM ? 'Set by you' : `Worked out from ${esc(r.unit.source)}`}</span></label>
    </div>
    <div class="tile"><h3>Does it look right in ${esc(unitName)}?</h3><div class="evid">
      <div><span class="${sane(Math.max(w, h), 4, 400)}">${sane(Math.max(w, h), 4, 400) === 'ok' ? '✓' : '✗'}</span><span>Ground plan is <b>${w.toFixed(1)} × ${h.toFixed(1)} m</b></span></div>
      ${door ? `<div><span class="${sane(door, 0.6, 1.4)}">${sane(door, 0.6, 1.4) === 'ok' ? '✓' : '✗'}</span><span>Doors are typically <b>${(door * 1000).toFixed(0)} mm</b> wide</span></div>` : ''}
      ${rooms[0] ? `<div><span class="${sane(rooms[0].area, 6, 2000)}">${sane(rooms[0].area, 6, 2000) === 'ok' ? '✓' : '✗'}</span><span>Largest room: ${esc(rooms[0].name)}, <b>${fmtArea(rooms[0].area, { areaUnit: 'both' })}</b></span></div>` : ''}
      ${dc.map((d) => `<div><span class="${d.match === 'ok' ? 'ok' : d.match == null ? '' : 'bad'}">${d.match === 'ok' ? '✓' : d.match == null ? '·' : '✗'}</span><span>Dimension “${esc(d.label)}” measures <b>${d.measured.toFixed(d.measured < 50 ? 2 : 0)}</b> drawing units</span></div>`).join('')}
    </div></div></div>`;
}

function stepLayers() {
  const r = S.result;
  if (!r) return '';
  const content = (l) => (l.stats ? l.stats.segs + l.stats.arcs + l.stats.texts + l.stats.fills : 0);
  const layers = r.layers.filter((l) => content(l) > 0).sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || content(b) - content(a));
  const ai = S.settings.ai && S.settings.ai.key;
  return `<div class="page-head" style="margin:0"><div><div class="sub" style="margin:0">What each layer holds decides what counts as a wall, a column, a door… Office codes and other languages may need a nudge.</div></div>
      <div class="acts"><button class="btn" data-ai ${ai ? '' : 'title="Add your API key in Settings → AI assist"'}>${icon('i-spark')}Ask AI</button></div></div>
    ${S.ai ? S.ai : ''}
    <div class="tblw"><table class="t lyt"><thead><tr><th>Layer</th><th class="n">Items</th><th>Holds</th></tr></thead><tbody>
      ${layers.map((l) => `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${ROLE_COLOR[l.role]};margin-right:8px"></span><span class="num" style="font-size:12.5px">${esc(l.name)}</span></td><td class="n">${content(l)}</td>
        <td><select data-layer="${esc(l.name)}" class="${l.auto ? '' : 'you'}">${ROLES.map((ro) => `<option value="${ro}" ${ro === l.role ? 'selected' : ''}>${ROLE_LABEL[ro]}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table></div>
    <label class="opt"><input type="checkbox" id="remember" ${S.remember ? 'checked' : ''} /> Remember the roles you change for the office’s next drawings</label>`;
}

function stepReview() {
  const r = S.result;
  if (!r) return '';
  const n = { high: 0, medium: 0, low: 0 };
  for (const i of r.issues) n[i.severity]++;
  const floors = S.floorsAll.filter((f) => !f.excluded);
  const rep = floors.reduce((a, f) => a + (f.repeat || 1), 0);
  return `<div class="grid g4">
      <div class="tile"><h3>Storeys</h3><div class="kpi-v">${esc(storeys(r.floors))}</div><div class="kpi-s">${r.floors.length} plans${rep > r.floors.length ? ` · ${rep} floors with typicals` : ''}</div></div>
      <div class="tile"><h3>Rooms</h3><div class="kpi-v">${r.an.reduce((a, x) => a + x.rooms.length, 0)}</div><div class="kpi-s">${r.an.reduce((a, x) => a + x.columns.length, 0)} columns</div></div>
      <div class="tile"><h3>Built-up</h3><div class="kpi-v" style="font-size:24px">${fmtArea(r.an.reduce((a, x) => a + x.footprintArea, 0), { areaUnit: 'm2' })}</div><div class="kpi-s">sum of floor plates</div></div>
      <div class="tile"><h3>To check</h3><div class="kpi-v ${n.high ? 'high' : ''}">${r.issues.length}</div><div class="kpi-s">${SEVERITIES.map((s) => `${n[s]} ${s}`).join(' · ')}</div></div>
    </div>
    <div class="tblw"><table class="t"><thead><tr><th>Floor</th><th>Title</th><th class="n">Rooms</th><th class="n">Columns</th><th class="n">Plate</th><th class="n">Repeats</th></tr></thead><tbody>
      ${r.floors.map((f, k) => `<tr><td><span class="ft-tag">${esc(levelTag(f))}</span></td><td>${esc(floorName(f))}</td><td class="n">${r.an[k].rooms.length}</td><td class="n">${r.an[k].columns.length}</td><td class="n">${fmtArea(r.an[k].footprintArea, { areaUnit: 'm2' })}</td><td class="n">×${f.repeat || 1}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted" style="margin:0">Units: ${esc(unitText())} · ${r.layers.filter((l) => l.role !== 'other').length} layers in use${r.geometry.some((g) => g.dims && g.dims.count) ? ` · ${r.geometry.reduce((a, g) => a + g.dims.count, 0)} dimensions` : ''}</p>`;
}
const unitText = () => { const v = S.opts.unitMM || S.result.unit.mm; return (UNITS.find(([u]) => Math.abs(u - v) < 1e-9) || [0, `${v} mm`])[1]; };

// ------------------------------------------------------------------ AI naming (optional)
async function askAI() {
  const key = S.settings.ai && S.settings.ai.key;
  if (!key) { toast('Add your Anthropic API key in Settings → AI assist first.', true); return; }
  S.ai = `<div class="tile"><span class="spinner" style="display:inline-block;vertical-align:-4px;margin-right:8px"></span>Reading the layer names and room labels…</div>`;
  render();
  try {
    const { readNaming } = await import('../ai.js');
    const out = await readNaming(key, S.result);
    const n = out.layers.length + out.rooms.length;
    S.aiOut = out;
    S.ai = n ? `<div class="tile"><h3>${icon('i-spark')}Suggested by AI</h3><div class="tblw"><table class="t"><tbody>
        ${out.layers.map((l, i) => `<tr><td><label class="opt"><input type="checkbox" data-ail="${i}" checked /> <span class="num">${esc(l.name)}</span></label></td><td>${esc(ROLE_LABEL[l.from])} → <b>${esc(ROLE_LABEL[l.role])}</b></td><td class="muted">${esc(l.why)}</td></tr>`).join('')}
        ${out.rooms.map((q, i) => `<tr><td><label class="opt"><input type="checkbox" data-air="${i}" checked /> ${esc(q.label)}</label></td><td>${esc(q.from)} → <b>${esc(q.type)}</b></td><td class="muted">${esc(q.why)}</td></tr>`).join('')}
      </tbody></table></div><div style="margin-top:10px"><button class="btn primary small" data-aiapply>Apply ${n} change${n > 1 ? 's' : ''}</button></div></div>`
      : `<div class="tile">${icon('i-check')} The AI agrees with how every layer and room label was read.</div>`;
  } catch (err) {
    S.ai = `<div class="tile" style="color:var(--high)">${esc(err.message)}</div>`;
  }
  render();
}
function applyAI() {
  const out = S.aiOut;
  if (!out) return;
  const roles = new Map(S.opts.roles), types = new Map(S.opts.types);
  $$('[data-ail]:checked').forEach((c) => { const l = out.layers[+c.dataset.ail]; roles.set(l.name, l.role); });
  $$('[data-air]:checked').forEach((c) => { const q = out.rooms[+c.dataset.air]; types.set(q.label.toLowerCase().replace(/\s+/g, ' ').trim(), q.type); });
  S.opts.roles = [...roles]; S.opts.types = [...types];
  S.ai = null; S.aiOut = null;
  schedule(0);
}

// ------------------------------------------------------------------ create
async function create() {
  busy(S.project ? 'Adding the revision…' : 'Creating the project…');
  try {
    const stored = await storeFiles(S.files.map((f) => ({ name: f.name, bytes: f.bytes, kind: f.kind })));
    const opts = { roles: S.opts.roles, types: S.opts.types, nudges: {}, unitMM: S.opts.unitMM, floors: S.floorsEdited ? S.floorsAll : null };
    let project = S.project ? await getProject(S.project.id) : newProject({ ...S.meta, name: S.meta.name.trim() || 'Untitled project' });
    if (!S.project) project.status = S.meta.status;
    const rev = newRevision(project, stored, opts);
    project.revisions.push(rev);
    await adopt(project, rev, S.result, { first: !S.project });
    if (S.remember) {
      const layerRoles = { ...(S.settings.layerRoles || {}) };
      // only what you decided: Plumb's own guesses are made fresh for every drawing
      for (const [name, role] of S.opts.roles) layerRoles[name] = role;
      const roomTypes = { ...(S.settings.roomTypes || {}) };
      for (const [k, v] of S.opts.types) roomTypes[k] = v;
      await saveSettings({ layerRoles, roomTypes });
    }
    location.href = `project.html?id=${encodeURIComponent(project.id)}`;
  } catch (err) {
    busy(null);
    toast(err.message || String(err), true);
  }
}

// ------------------------------------------------------------------ events
const picker = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.dwg,.DWG,.dxf,.DXF', hidden: true });
document.body.appendChild(picker);
picker.addEventListener('change', () => { if (picker.files.length) addFiles([...picker.files]); picker.value = ''; });

page.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-pick]')) { picker.click(); return; }
  const rm = t.closest('[data-remove]');
  if (rm) { S.files.splice(+rm.dataset.remove, 1); autoName(); S.floorsEdited = false; S.floorsAll = null; schedule(0); return; }
  if (t.closest('[data-back]')) { S.step = Math.max(0, S.step - 1); render(); return; }
  if (t.closest('[data-next]')) { if (canNext()) { S.step++; render(); window.scrollTo(0, 0); } return; }
  if (t.closest('[data-create]')) { if (canNext()) create(); return; }
  const mv = t.closest('[data-move]');
  if (mv) { const p = +mv.dataset.move, d = +mv.dataset.d, a = S.floorsAll; if (a[p + d]) { [a[p], a[p + d]] = [a[p + d], a[p]]; S.floorsEdited = true; schedule(0); } return; }
  const ex = t.closest('[data-excl]');
  if (ex) { const f = S.floorsAll[+ex.dataset.excl]; f.excluded = !f.excluded; S.floorsEdited = true; schedule(0); return; }
  if (t.closest('[data-ai]')) { askAI(); return; }
  const zm = t.closest('[data-zoom]');
  if (zm) { if (editor) editor.zoom(+zm.dataset.zoom); return; }
  if (t.closest('[data-fit]')) { if (editor) editor.fit(); return; }
  if (t.closest('[data-redetect]')) { S.floorsEdited = false; S.floorsAll = null; S.sel = -1; schedule(0); return; }
  const card = t.closest('[data-card]');
  if (card && !t.closest('button, input, label')) { S.sel = +card.dataset.card; $$('.fthumb').forEach((el) => el.classList.toggle('sel', el === card)); if (editor) editor.setFloors(sheetFloors(), S.sel); return; }
  if (t.closest('[data-aiapply]')) { applyAI(); return; }
});
page.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'unit') { S.opts.unitMM = +t.value; S.floorsEdited = false; S.floorsAll = null; S.thumbs.clear(); schedule(0); return; }
  if (t.dataset.layer) {
    const auto = S.result.layers.find((l) => l.name === t.dataset.layer);
    const roles = new Map(S.opts.roles);
    if (auto && t.value === auto.autoRole) roles.delete(t.dataset.layer); else roles.set(t.dataset.layer, t.value);
    S.opts.roles = [...roles];
    schedule(0);
    return;
  }
  if (t.id === 'remember') { S.remember = t.checked; return; }
  if (t.dataset.title) { S.floorsAll[+t.dataset.title].title = t.value.trim() || S.floorsAll[+t.dataset.title].title; S.floorsEdited = true; schedule(400); return; }
  if (t.dataset.repeat) { S.floorsAll[+t.dataset.repeat].repeat = Math.max(1, Math.min(99, parseInt(t.value, 10) || 1)); S.floorsEdited = true; return; }
  if (t.id === 'm-status') S.meta.status = t.value;
});
page.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'm-name') { S.meta.name = t.value; S.meta.auto = false; const b = $('[data-next]'); if (b) b.disabled = !canNext(); paintStatus(); }
  if (t.id === 'm-city') S.meta.city = t.value;
  if (t.id === 'm-client') S.meta.client = t.value;
});
page.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.empty[data-pick]')) { e.preventDefault(); picker.click(); } });
// Delete removes the selected floor from anywhere on the Floors step (not while typing a name)
document.addEventListener('keydown', (e) => {
  if (S.step !== 1 || S.sel < 0 || !S.floorsAll || !S.floorsAll[S.sel] || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
  if ((editor && e.target === editor.cv) || (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]'))) return;
  e.preventDefault();
  removeFloor(S.sel);
});
onDropFiles((files) => { if (S.step !== 0) S.step = 0; addFiles(files); });

// ------------------------------------------------------------------ boot
(async () => {
  wireRail(railEl);
  try {
    S.settings = await getSettings();
    if (S.pid) {
      S.project = await getProject(S.pid);
      if (!S.project) throw new Error('That project isn’t on this device.');
      const prev = currentRev(S.project);
      if (prev) S.opts = { roles: prev.opts.roles || [], types: prev.opts.types || [], nudges: {}, unitMM: prev.opts.unitMM || null, floors: null };
    } else {
      const d = await defaultOpts();
      S.opts.roles = d.roles; S.opts.types = d.types;
    }
    const pending = await takePending();
    render();
    if (pending && pending.length) addFiles(pending);
  } catch (err) {
    render();
    toast(err.message, true);
  }
})();
