// Plumb — Bye-law checks: the project's drawings against Gujarat's CGDCR 2017 (Ahmedabad, D1 AUDA),
// with NBC 2016's room sizes as good practice. Every rule shows its clause, what it needs, what was
// measured and, on a small plan of each floor, the spaces it's about.

import { injectIcons, rail, wireRail, $, esc, icon, toast, busy, qs } from '../shell/ui.js';
import { saveProject, getSettings } from '../shell/store.js';
import { openProject } from '../shell/projects.js';
import { summarize } from '../shell/model.js';
import { levelTag } from '../style.js';
import { download } from '../export.js';
import { areaSetup } from '../areas.js';
import { BUILDING_USES, ruleSetup, checkBuilding, checksCSV } from '../rules.js';

injectIcons();
const railEl = $('#rail');
const page = $('#page');
const id = qs('id');
let P = null, REV = null, R = null, SET = null, RES = null;
const open = new Set();   // rules whose details are open (kept across re-renders)
const focus = {};         // rule id → 'k:room' picked in its list

const STATUS = { fail: 'Fails', warn: 'Check', need: 'Needs information', pass: 'Passes', na: 'Doesn’t apply' };
const ORDER = { fail: 0, warn: 1, need: 2, pass: 3, na: 4 };
const familyOf = (u) => (u === 'DW3' ? 'apartments' : u === 'M' ? 'commercial' : 'house');

let saveTimer = 0;
function save(now = false) {
  clearTimeout(saveTimer);
  const go = () => saveProject(P).catch((err) => toast(err.message, true));
  if (now) go(); else saveTimer = setTimeout(go, 400);
}

async function load() {
  if (!id) { location.replace('./'); return; }
  try {
    SET = await getSettings();
    ({ project: P, rev: REV, result: R } = await openProject(id, (s) => busy(s)));
    busy(null);
  } catch (err) {
    busy(null);
    railEl.innerHTML = rail('rules'); wireRail(railEl);
    page.innerHTML = `<div class="empty">${icon('i-alert')}<h2>Can’t open this project</h2><p>${esc(err.message)}</p><a class="btn" href="./">All projects</a></div>`;
    return;
  }
  document.title = `Bye-law checks · ${P.name} · Plumb`;
  areaSetup(P, R);
  render();
}

const heights = () => ({ ...SET.heights, ...(P.heights || {}) });
const run = () => checkBuilding(R, ruleSetup(P), { areas: P.areas, heights: heights() });
const fmt = (v) => (v == null ? '' : String(Math.round(v * 100) / 100));

function render() {
  const act = document.activeElement && document.activeElement.id;
  draw();
  if (act && document.getElementById(act)) document.getElementById(act).focus();
}
function draw() {
  const S = ruleSetup(P);
  RES = run();
  const { facts, groups, counts } = RES;
  railEl.innerHTML = rail('rules', P, { open: summarize(R, P).issues.total });
  wireRail(railEl);
  const pid = encodeURIComponent(P.id);
  const house = S.use === 'DW1' || S.use === 'DW2';
  const fld = (idn, label, val, { ph = '', hint = '', step = '0.01' } = {}) => `<label class="fld"><span>${label}</span><input id="${idn}" type="number" min="0" step="${step}" inputmode="decimal" value="${val == null ? '' : fmt(val)}" placeholder="${esc(ph)}" />${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  const tile = (st, n, sub) => `<div class="tile rl-k ${st}"><h3>${STATUS[st]}</h3><div class="kpi-v">${n}</div><div class="kpi-s">${sub}</div></div>`;

  page.innerHTML = `
    <a class="crumb" href="project.html?id=${pid}">${icon('i-back')}${esc(P.name)}</a>
    <div class="page-head"><div><h1>Bye-law checks</h1><div class="sub"><span>${esc(REV.label)}</span><span class="faint">·</span><span>CGDCR 2017, Ahmedabad (D1 AUDA)</span><span class="faint">·</span><span>a checking aid, not an approval</span></div></div>
      <div class="acts"><button class="btn" data-csv>${icon('i-dl')}CSV</button><button class="btn" data-print>${icon('i-print')}Print</button></div></div>

    <div class="grid g4">
      ${tile('fail', counts.fail, counts.fail ? 'against the regulation' : 'nothing fails')}
      ${tile('warn', counts.warn, 'short of it, or good practice')}
      ${tile('need', counts.need, counts.need ? 'add them below' : 'nothing missing')}
      ${tile('pass', counts.pass, `${counts.na} don’t apply`)}
    </div>

    <div class="grid g2 ar-setup" style="margin-top:14px">
      <div class="tile"><h3>Building</h3>
        <span class="seg" role="group" aria-label="Building use">${Object.entries(BUILDING_USES).map(([k, u]) => `<button type="button" data-use="${k}" class="${S.use === k ? 'on' : ''}" title="${esc(u.long)}">${esc(u.label)}</button>`).join('')}</span>
        <p class="hint" style="margin:0">${esc(BUILDING_USES[S.use].long)} (CGDCR Table 6.3).</p>
        <div class="frow">
          ${fld('r-height', 'Building height (m)', S.height, { ph: fmt(facts.autoHeight), hint: S.height == null ? `${facts.storeys} storey${facts.storeys === 1 ? '' : 's'} × ${fmt(heights().floor)} m. Enter the height to the terrace to be exact.` : `From the plans: ≈ ${fmt(facts.autoHeight)} m.` })}
          ${fld('r-units', house ? 'Dwelling units' : 'Flats / units', S.units, { ph: String(facts.units), step: '1', hint: S.units == null ? `${facts.kitchens} kitchen${facts.kitchens === 1 ? '' : 's'} found` : '' })}
        </div>
        <p class="hint" style="margin:0">Storey heights come from the model: ${fmt(heights().floor)} m floor to floor, ${fmt(heights().slab)} m slab. <a href="workspace.html?id=${pid}#model">Change them</a>.</p>
      </div>
      <div class="tile"><h3>Site <span class="muted" style="font-weight:400">· not in the plans</span></h3>
        <div class="frow">
          ${fld('r-road', 'Road width (m)', S.road, { ph: 'e.g. 12', hint: 'The road the plot abuts (the widest, if on two).' })}
          ${fld('r-plot', 'Plot area (m²)', facts.plot, { ph: 'e.g. 334.45', hint: 'Shared with the area statement.' })}
        </div>
        <div class="frow">
          ${fld('r-mroad', 'Road-side margin', S.margins.road, { ph: 'm' })}
          ${fld('r-mside', 'Side margin (least)', S.margins.side, { ph: 'm' })}
          ${fld('r-mrear', 'Rear margin', S.margins.rear, { ph: 'm' })}
        </div>
        <div class="frow">
          ${house ? fld('r-cars', 'Cars that fit (parking)', S.cars, { ph: 'from the plans', step: '1', hint: 'In the margin counts for a house.' }) : fld('r-parking', 'Parking area (m²)', S.parking, { ph: 'from the plans', hint: 'Leave empty to use the parking in the plans.' })}
        </div>
      </div>
    </div>

    ${groups.map((g) => `<h2 class="sec">${esc(g.title)}${g.id === 'nbc' ? ` <button class="btn link small" data-nbc="0">Hide</button>` : ''}</h2>
      ${g.note ? `<p class="hint" style="margin:-4px 2px 10px">${esc(g.note)}</p>` : ''}
      <div class="rl-list">${g.rules.slice().sort((a, b) => ORDER[a.status] - ORDER[b.status]).map(ruleCard).join('')}</div>`).join('')}
    ${S.nbc ? '' : `<p class="hint" style="margin-top:18px">NBC 2016 room sizes are hidden. <button class="btn link small" data-nbc="1">Show them</button></p>`}

    <h2 class="sec">How it’s checked</h2>
    <div class="tile ar-notes">
      <p><b>From the plans:</b> rooms and their areas, room widths (the widest circle that fits, wall face to wall face), openings (every gap in a wall: a door where there’s a swing, a window where lines cross it, otherwise an opening) and what each opens onto, stair flights (their tread lines: width and going), lifts, parking and the area statement’s FSI.</p>
      <p><b>From the model:</b> storey heights, window sill and head, door height. <b>From you:</b> the road, the plot, the margins, and parking outside the building.</p>
      <p><b>Not checked yet:</b> fire safety (the Fire Prevention and Life Safety Measures Regulations 2016), risers (they need a section), lofts and mezzanines, the open space of 13.4.1(1) itself, common plot, OTS sizes, accessibility beyond the entrance door, and margins between buildings.</p>
      <p>Thresholds are from CGDCR 2017 Part II (Tables 6.23, 6.24, 6.26, 6.44, 6.5) and Part III (13.1.5–13.1.13, 13.4, 13.9, 13.12) as notified by UD&amp;UHD Gujarat. Check them against the current amendments and your TP scheme before you submit.</p>
    </div>`;

  for (const r of groups.flatMap((g) => g.rules)) if (open.has(r.id)) fillPlans(r);
}

function ruleCard(r) {
  const bad = r.items.filter((i) => i.status !== 'pass');
  const has = r.items.length > 0;
  const items = r.items.slice().sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.k - b.k);
  return `<details class="rl-rule ${r.status}" data-rule="${r.id}" ${open.has(r.id) ? 'open' : ''}>
    <summary>
      <span class="rl-st ${r.status}">${r.status === 'pass' ? icon('i-check') : r.status === 'fail' || r.status === 'warn' ? icon('i-alert') : ''}${STATUS[r.status]}</span>
      <span class="rl-main"><b>${esc(r.title)}</b><span class="rl-need">${esc(r.need)}</span></span>
      <span class="rl-val">${esc(r.value)}${bad.length ? `<span class="muted"> · ${bad.length} to look at</span>` : ''}</span>
      <span class="rl-cl">${esc(r.clause)}</span>
    </summary>
    <div class="rl-body">
      ${r.note ? `<p class="hint" style="margin:0 0 10px">${esc(r.note)}${r.link === 'areas' ? ` <a href="areas.html?id=${encodeURIComponent(P.id)}">Area statement →</a>` : ''}</p>` : ''}
      ${has ? `<div class="rl-split"><div class="tblw"><table class="t"><thead><tr><th>Floor</th><th>Space</th><th>Measured</th><th></th></tr></thead><tbody>
        ${items.map((i) => `<tr class="click ${focus[r.id] === `${i.k}:${i.room}` ? 'sel' : ''}" data-item="${r.id}" data-k="${i.k}" data-room="${i.room}"><td><span class="ft-tag">${esc(levelTag(R.floors[i.k]))}</span></td><td>${esc(i.name)}</td><td class="num">${esc(i.value)}</td><td><span class="rl-dot ${i.status}" title="${STATUS[i.status]}"></span></td></tr>`).join('')}
      </tbody></table></div><div class="rl-plans" data-plans="${r.id}"></div></div>` : ''}
    </div>
  </details>`;
}

/** Small plans of the floors a rule is about, its spaces coloured by result. */
function fillPlans(r) {
  const host = page.querySelector(`[data-plans="${r.id}"]`);
  if (!host) return;
  const ks = [...new Set(r.items.map((i) => i.k))].sort((a, b) => a - b);
  const f = focus[r.id];
  const show = f ? [+f.split(':')[0]] : ks.filter((k) => r.items.some((i) => i.k === k && i.status !== 'pass')).slice(0, 3);
  host.innerHTML = (show.length ? show : ks.slice(0, 1)).map((k) => planSVG(k, r.items.filter((i) => i.k === k), f)).join('');
}

function planSVG(k, items, focusKey) {
  const an = R.an[k], geo = R.geometry[k];
  const [x0, y0, x1, y1] = R.floors[k].box, pad = 0.6;
  const W = x1 - x0 + 2 * pad, Hh = y1 - y0 + 2 * pad;
  const X = (x) => (x - x0 + pad).toFixed(2), Y = (y) => (y1 + pad - y).toFixed(2);
  const lines = (arr) => { if (!arr) return ''; let d = ''; for (let i = 0; i < arr.length; i += 4) d += `M${X(arr[i])} ${Y(arr[i + 1])}L${X(arr[i + 2])} ${Y(arr[i + 3])}`; return d; };
  const st = new Map();
  for (const i of items) for (const id of i.rooms || [i.room]) if (id >= 0) st.set(id, i.status);
  const poly = (rm) => rm.poly && rm.poly.length > 2 ? `M${rm.poly.map((p) => `${X(p[0])} ${Y(p[1])}`).join('L')}Z` : '';
  const rooms = an.rooms.map((rm) => {
    const s = st.get(rm.id);
    const on = focusKey === `${k}:${rm.id}` || (focusKey && items.some((i) => `${k}:${i.room}` === focusKey && (i.rooms || []).includes(rm.id)));
    return `<path d="${poly(rm)}" class="rp ${s || ''} ${on ? 'on' : ''}"><title>${esc(rm.name)}${s ? ` · ${STATUS[s]}` : ''}</title></path>`;
  }).join('');
  const boxes = items.filter((i) => i.box).map((i) => `<rect x="${X(i.box[0])}" y="${Y(i.box[3])}" width="${(i.box[2] - i.box[0]).toFixed(2)}" height="${(i.box[3] - i.box[1]).toFixed(2)}" class="rb ${i.status}"/>`).join('');
  const ops = (an.openings || []).map((o) => `M${X(o.x0)} ${Y(o.y0)}L${X(o.x1)} ${Y(o.y1)}`).join('');
  const walls = lines(geo && geo.lines.wall) + lines(geo && geo.lines.column);
  return `<figure class="rl-plan"><svg viewBox="0 0 ${W.toFixed(2)} ${Hh.toFixed(2)}" role="img" aria-label="${esc(levelTag(R.floors[k]))} plan">
    ${rooms}<path d="${walls}" class="rw"/><path d="${ops}" class="ro"/>${boxes}</svg>
    <figcaption><span class="ft-tag">${esc(levelTag(R.floors[k]))}</span> ${esc(R.floors[k].title)}</figcaption></figure>`;
}

// ------------------------------------------------------------------ edits
page.addEventListener('toggle', (e) => {
  const d = e.target.closest && e.target.closest('details[data-rule]');
  if (!d) return;
  const rid = d.dataset.rule;
  if (d.open) { open.add(rid); const r = RES.groups.flatMap((g) => g.rules).find((q) => q.id === rid); if (r) fillPlans(r); } else open.delete(rid);
}, true);

page.addEventListener('click', (e) => {
  const t = e.target;
  const u = t.closest('[data-use]');
  if (u) {
    P.rules = { ...(P.rules || {}), use: u.dataset.use };
    P.areas.building = familyOf(u.dataset.use);
    save(true); render(); return;
  }
  const nb = t.closest('[data-nbc]');
  if (nb) { P.rules = { ...(P.rules || {}), nbc: nb.dataset.nbc === '1' }; save(true); render(); return; }
  const it = t.closest('[data-item]');
  if (it) {
    const key = `${it.dataset.k}:${it.dataset.room}`;
    focus[it.dataset.item] = focus[it.dataset.item] === key ? undefined : key;
    for (const row of page.querySelectorAll(`[data-item="${it.dataset.item}"]`)) row.classList.toggle('sel', `${row.dataset.k}:${row.dataset.room}` === focus[it.dataset.item]);
    const r = RES.groups.flatMap((g) => g.rules).find((q) => q.id === it.dataset.item);
    if (r) fillPlans(r);
    return;
  }
  if (t.closest('[data-csv]')) {
    download(`${P.name.replace(/[^\w.-]+/g, '-')}-${REV.label.replace(/\s+/g, '')}-bye-law-checks.csv`, checksCSV(RES, { project: P.name, rev: REV.label }), 'text/csv');
    return;
  }
  if (t.closest('[data-print]')) {
    for (const d of page.querySelectorAll('details[data-rule]')) if (d.querySelector('.rl-body .t')) { d.open = true; open.add(d.dataset.rule); }
    for (const r of RES.groups.flatMap((g) => g.rules)) if (open.has(r.id)) fillPlans(r);
    window.print();
  }
});

const FIELDS = { 'r-road': ['road'], 'r-height': ['height'], 'r-units': ['units'], 'r-cars': ['cars'], 'r-parking': ['parking'], 'r-mroad': ['margins', 'road'], 'r-mside': ['margins', 'side'], 'r-mrear': ['margins', 'rear'] };
page.addEventListener('change', (e) => {
  const t = e.target;
  const v = parseFloat(t.value);
  const val = Number.isFinite(v) && v >= 0 ? v : null;
  if (t.id === 'r-plot') { P.areas.plot = val; save(); render(); return; }
  const path = FIELDS[t.id];
  if (!path) return;
  P.rules ||= {};
  if (path.length === 2) { P.rules.margins = { ...(P.rules.margins || {}), [path[1]]: val }; } else P.rules[path[0]] = val;
  save(); render();
});

load();
