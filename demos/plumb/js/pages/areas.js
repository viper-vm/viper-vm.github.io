// Plumb — Area statement: RERA carpet area and FSI under Gujarat's CGDCR 2017 (Ahmedabad), measured
// from the project's drawings. Every number says where it comes from; every space can be re-assigned.

import { injectIcons, rail, wireRail, $, $$, esc, icon, toast, busy, qs } from '../shell/ui.js';
import { saveProject, getSettings } from '../shell/store.js';
import { openProject } from '../shell/projects.js';
import { summarize } from '../shell/model.js';
import { levelTag } from '../style.js';
import { download } from '../export.js';
import { ZONES, zoneOf, BUILDINGS, USES, USE_ORDER, areaStatement, statementCSV } from '../areas.js';

injectIcons();
const railEl = $('#rail');
const page = $('#page');
const id = qs('id');
let P = null, REV = null, R = null, SET = null;

const FT2 = 10.7639;
const m2 = (v) => (Number.isFinite(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const ft2 = (v) => (Number.isFinite(v) ? Math.round(v * FT2).toLocaleString('en-IN') : '—');
const both = (v) => `${m2(v)} m²<span class="ft"> · ${ft2(v)} ft²</span>`;

/** Flats have a kitchen each: two or more on a floor is a building of flats. */
function guessBuilding(result) {
  const most = Math.max(0, ...result.an.map((a) => a.rooms.filter((r) => r.type === 'kitchen').length));
  return most >= 2 ? 'apartments' : 'house';
}
function setup() {
  if (!P.areas) {
    const z = zoneOf('R1');
    P.areas = { building: guessBuilding(R), plot: null, zone: z.code, base: z.base, chargeable: z.chargeable, max: z.max, uses: {} };
  }
  P.areas.uses ||= {};
  return P.areas;
}
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
    railEl.innerHTML = rail('areas'); wireRail(railEl);
    page.innerHTML = `<div class="empty">${icon('i-alert')}<h2>Can’t open this project</h2><p>${esc(err.message)}</p><a class="btn" href="./">All projects</a></div>`;
    return;
  }
  document.title = `Area statement · ${P.name} · Plumb`;
  render();
}

function render() {
  const S = setup();
  const st = areaStatement(R, S);
  const T = st.totals, F = st.fsi, z = F.zone;
  railEl.innerHTML = rail('areas', P, { open: summarize(R, P).issues.total });
  wireRail(railEl);
  const reviewN = st.floors.reduce((a, f) => a + f.review.length, 0);
  const seg = (name, cur, opts) => `<span class="seg" role="group" aria-label="${name}">${opts.map(([v, l]) => `<button type="button" data-set="${name}" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</span>`;
  const exemptAll = {};
  for (const f of st.floors) for (const e of f.exempt) exemptAll[e.label] = { rule: e.rule, area: (exemptAll[e.label] ? exemptAll[e.label].area : 0) + e.area * f.repeat };

  const fsiLine = !(F.plot > 0) ? `<div class="kpi-v" style="font-size:20px">Add the plot area</div><div class="kpi-s">to work out the FSI consumed</div>`
    : `<div class="kpi-v ${F.status === 'over' ? 'high' : ''}">${F.consumed.toFixed(2)}</div><div class="kpi-s">of ${F.base} base · ${F.max} maximum (${esc(z.code)})</div>`;

  page.innerHTML = `
    <a class="crumb" href="project.html?id=${encodeURIComponent(P.id)}">${icon('i-back')}${esc(P.name)}</a>
    <div class="page-head"><div><h1>Area statement</h1><div class="sub"><span>${esc(REV.label)}</span><span class="faint">·</span><span>RERA carpet area and FSI under CGDCR 2017, Ahmedabad (D1 AUDA)</span><span class="faint">·</span><span>measured from the drawings</span></div></div>
      <div class="acts"><button class="btn" data-csv>${icon('i-dl')}CSV</button><button class="btn" data-print>${icon('i-print')}Print</button></div></div>

    <div class="grid g2 ar-setup">
      <div class="tile"><h3>Plot and zone</h3>
        <div class="frow">
          <label class="fld"><span>Plot area (m²)</span><input id="a-plot" type="number" min="0" step="0.01" inputmode="decimal" value="${F.plot > 0 ? F.plot : ''}" placeholder="e.g. 334.45" /><span class="hint">${F.plot > 0 ? `${ft2(F.plot)} ft² · ${(F.plot / 0.836127).toFixed(1)} sq yd` : 'From the plot’s 7/12 or the TP scheme’s final plot.'}</span></label>
          <label class="fld"><span>Zone (Table 6.5)</span><select id="a-zone">${ZONES.map((q) => `<option value="${q.code}" ${q.code === z.code ? 'selected' : ''}>${esc(q.code)} · ${esc(q.name)}</option>`).join('')}</select></label>
        </div>
        <div class="frow ar-fsi">
          <label class="fld"><span>Base FSI</span><input id="a-base" type="number" min="0" step="0.05" value="${F.base}" /></label>
          <label class="fld"><span>Chargeable</span><input id="a-chargeable" type="number" min="0" step="0.05" value="${F.chargeable}" /></label>
          <label class="fld"><span>Maximum</span><input id="a-max" type="number" min="0" step="0.05" value="${F.max}" /></label>
        </div>
        <p class="hint" style="margin:8px 0 0">${z.note ? esc(z.note) + ' ' : ''}From CGDCR 2017 Part II, Table 6.5 (category D1 AUDA). Chargeable FSI is at 40% of the jantri rate. Check the zone against your TP scheme and any later amendment.${F.base !== z.base || F.chargeable !== z.chargeable || F.max !== z.max ? ` <button class="btn link small" data-zonefsi>Use the table’s values</button>` : ''}</p>
      </div>
      <div class="tile"><h3>Building</h3>
        ${seg('building', st.building, Object.entries(BUILDINGS))}
        <p class="hint" style="margin:10px 0 0">${st.building === 'house' ? 'One unit: its staircase is part of the carpet area (and still exempt from FSI).' : 'Flats: stairs, lifts and lobbies are common areas, outside every flat’s carpet area. Carpet area is shown floor by floor, all flats together.'}</p>
      </div>
    </div>

    <div class="grid g4" style="margin-top:14px">
      <div class="tile"><h3>FSI consumed</h3>${fsiLine}</div>
      <div class="tile"><h3>FSI area</h3><div class="kpi-v" style="font-size:24px">${m2(T.fsiArea)} m²</div><div class="kpi-s">built-up ${m2(T.builtUp)} m²</div></div>
      <div class="tile"><h3>RERA carpet area</h3><div class="kpi-v" style="font-size:24px">${m2(T.carpet)} m²</div><div class="kpi-s">${ft2(T.carpet)} ft² · balconies ${m2(T.balcony)} m²${T.terrace > 0.005 ? ` · open terraces ${m2(T.terrace)} m²` : ''}</div></div>
      <div class="tile"><h3>Not in FSI</h3><div class="kpi-v" style="font-size:24px">${m2(T.exemptArea)} m²</div><div class="kpi-s">${Object.keys(exemptAll).map(esc).join(', ') || 'nothing exempt'}</div></div>
    </div>

    ${reviewN ? `<div class="tile ar-review">${icon('i-alert')}<div><b>${reviewN} space${reviewN > 1 ? 's' : ''} (${m2(T.review)} m²) need${reviewN > 1 ? '' : 's'} a decision.</b> They have no name in the drawing, so Plumb can’t tell a room from a terrace or a gap. Say what each is in the room list below; until then they’re left out of every total.
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn small" href="#rooms">Go to the rooms</a><button class="btn small ghost" data-ignoreall>Leave them all out</button></div></div></div>` : ''}

    <h2 class="sec">Floor by floor</h2>
    <div class="tblw"><table class="t ar-t"><thead><tr><th>Floor</th><th class="n">×</th><th class="n">Built-up</th><th class="n">Not in FSI</th><th class="n">FSI area</th><th class="n">RERA carpet</th><th class="n">Balcony / verandah</th><th class="n">Open terrace</th><th class="n">Common</th><th class="n">Shafts</th><th class="n">Walls</th></tr></thead><tbody>
      ${st.floors.map((f) => `<tr><td><span class="ft-tag">${esc(levelTag(R.floors[f.k]))}</span> ${esc(cap(f.title))}</td><td class="n">${f.repeat}</td><td class="n">${m2(f.builtUp)}</td><td class="n">${m2(f.exemptArea)}</td><td class="n"><b>${m2(f.fsiArea)}</b></td><td class="n"><b>${m2(f.carpet)}</b></td><td class="n">${m2(f.balcony)}</td><td class="n">${m2(f.terrace)}</td><td class="n">${m2(f.common)}</td><td class="n">${m2(f.shafts)}</td><td class="n">${m2(f.walls)}</td></tr>`).join('')}
      <tr class="tot"><td>Total${st.floors.some((f) => f.repeat > 1) ? ' (typical floors counted each time)' : ''}</td><td></td><td class="n">${m2(T.builtUp)}</td><td class="n">${m2(T.exemptArea)}</td><td class="n"><b>${m2(T.fsiArea)}</b></td><td class="n"><b>${m2(T.carpet)}</b></td><td class="n">${m2(T.balcony)}</td><td class="n">${m2(T.terrace)}</td><td class="n">${m2(T.common)}</td><td class="n">${m2(T.shafts)}</td><td class="n">${m2(T.walls)}</td></tr>
    </tbody></table></div>
    <p class="hint" style="margin:6px 2px 0">All areas in m². Built-up is measured to the outer face of the walls, balconies included. ${T.pergola > 0.005 ? `Pergolas (${m2(T.pergola)} m²) are left out of built-up area: CGDCR 6.3.2(13).` : ''}</p>

    ${F.plot > 0 ? `<h2 class="sec">FSI</h2>
    <div class="tile ar-fsisum">
      <div><span>Plot area</span><b class="num">${m2(F.plot)} m²</b></div>
      <div><span>Base FSI ${F.base} × plot</span><b class="num">${m2(F.baseArea)} m²</b></div>
      <div><span>Maximum FSI ${F.max} × plot</span><b class="num">${m2(F.maxArea)} m²</b></div>
      <div><span>FSI area proposed</span><b class="num">${m2(T.fsiArea)} m²</b></div>
      <div class="${F.status === 'over' ? 'bad' : 'ok'}"><span>${F.status === 'base' ? 'Within the base FSI: nothing chargeable' : F.status === 'chargeable' ? `Uses chargeable FSI (at 40% of the jantri rate)` : 'Over the maximum FSI'}</span><b class="num">${F.status === 'base' ? `${m2(F.baseArea - T.fsiArea)} m² to spare` : F.status === 'chargeable' ? `${m2(F.chargeableUsed)} m² chargeable` : `${m2(F.over)} m² over`}</b></div>
    </div>` : ''}

    <h2 class="sec" id="rooms">Rooms</h2>
    <p class="hint" style="margin:-4px 2px 10px">What each space counts as decides where its area goes. Plumb guesses from the room’s name; change anything that’s wrong and it’s kept for this project.</p>
    ${st.floors.map((f) => `<details class="ar-floor" open><summary><span class="ft-tag">${esc(levelTag(R.floors[f.k]))}</span> ${esc(cap(f.title))} <span class="muted">· ${f.rooms.length} spaces · carpet ${m2(f.carpet)} m² (rooms ${m2(f.carpetRooms)} + partitions ${m2(f.partitions)})</span></summary>
      <div class="tblw"><table class="t"><thead><tr><th>Space</th><th class="n">Area m²</th><th>Counts as</th><th>RERA</th><th>FSI</th></tr></thead><tbody>
        ${f.rooms.slice().sort((a, b) => (b.use === 'review') - (a.use === 'review') || USE_ORDER.indexOf(a.use) - USE_ORDER.indexOf(b.use) || b.area - a.area).map((r) => `<tr class="${r.use === 'review' ? 'rv' : ''}"><td>${esc(r.name)}${r.label && r.label.trim().toLowerCase() !== r.name.toLowerCase() ? ` <span class="muted">(“${esc(r.label)}”)</span>` : ''}</td><td class="n">${m2(r.area)}</td>
          <td><select class="inp ${r.set ? 'you' : ''}" data-use="${esc(r.key)}" aria-label="What ${esc(r.name)} counts as">${USE_ORDER.map((u) => `<option value="${u}" ${u === r.use ? 'selected' : ''}>${esc(USES[u].label)}</option>`).join('')}</select></td>
          <td class="muted">${esc(reraText(r.rera))}</td><td class="muted">${esc(fsiText(r.fsi, r.rule))}</td></tr>`).join('')}
      </tbody></table></div></details>`).join('')}

    <h2 class="sec">How it’s worked out</h2>
    <div class="tile ar-notes">
      <p><b>RERA carpet area</b> (Real Estate Act 2016, §2(k)): the net usable floor area, without the external walls, service shafts and the exclusive balcony, verandah and open terrace areas (stated separately), but with the internal partition walls.</p>
      <p><b>FSI</b> (CGDCR 2017 Part II): built-up area on every floor divided by the plot area. Not counted, under §6.3.2: staircases with their intermediate landings (6), lifts, lift wells and landings with their walls (7), parking basements and hollow plinths (3, 4), electric rooms (10), pergolas (13). Balconies aren’t on that list, so they count.</p>
      <p><b>From the drawing:</b> room areas are net, inside the walls. Every wall is split between the spaces on its two sides; a wall with carpet on both sides is a partition, and the rest are external. Stairs named only by their UP/DOWN arrow are measured to their flight.</p>
      <p><b>Not yet:</b> the landing allowances of 6.3.2(6) and (7) beyond the stair and lift as drawn, lofts, mezzanines, and carpet area flat by flat (shown floor by floor for now). Check the zone and FSI against your TP scheme and the current amendments before you submit.</p>
    </div>`;
}

const cap = (s) => { const t = String(s || '').toLowerCase().replace(/\bplan\b/, '').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const reraText = (v) => ({ carpet: 'Carpet area', balcony: 'Balcony / verandah', terrace: 'Open terrace', none: '—' }[v] || '—');
const fsiText = (v, rule) => (v === 'count' ? 'Counted' : v === 'exempt' ? `Not counted${rule ? ` · ${rule}` : ''}` : rule ? `Not built-up · ${rule}` : '—');

// ------------------------------------------------------------------ edits
page.addEventListener('click', (e) => {
  const t = e.target;
  const sb = t.closest('[data-set]');
  if (sb) { setup()[sb.dataset.set] = sb.dataset.v; save(true); render(); return; }
  if (t.closest('[data-zonefsi]')) { const S = setup(), z = zoneOf(S.zone); Object.assign(S, { base: z.base, chargeable: z.chargeable, max: z.max }); save(true); render(); return; }
  if (t.closest('[data-ignoreall]')) {
    const S = setup(), st = areaStatement(R, S);
    for (const f of st.floors) for (const r of f.review) S.uses[r.key] = 'ignore';
    save(true); render(); toast('Left out of the totals. Change any of them in the room list.');
    return;
  }
  if (t.closest('[data-csv]')) {
    const st = areaStatement(R, setup());
    download(`${P.name.replace(/[^\w.-]+/g, '-')}-${REV.label.replace(/\s+/g, '')}-area-statement.csv`, statementCSV(st, { project: P.name, rev: REV.label }), 'text/csv');
    return;
  }
  if (t.closest('[data-print]')) window.print();
});
page.addEventListener('change', (e) => {
  const t = e.target, S = setup();
  if (t.dataset.use) {
    const st = areaStatement(R, { ...S, uses: {} });
    const auto = st.floors.flatMap((f) => f.rooms).find((r) => r.key === t.dataset.use);
    if (auto && auto.use === t.value) delete S.uses[t.dataset.use]; else S.uses[t.dataset.use] = t.value;
    save(true); render();
    return;
  }
  if (t.id === 'a-zone') { const z = zoneOf(t.value); Object.assign(S, { zone: z.code, base: z.base, chargeable: z.chargeable, max: z.max }); save(true); render(); return; }
  if (t.id === 'a-plot' || t.id === 'a-base' || t.id === 'a-chargeable' || t.id === 'a-max') {
    const v = parseFloat(t.value);
    const key = { 'a-plot': 'plot', 'a-base': 'base', 'a-chargeable': 'chargeable', 'a-max': 'max' }[t.id];
    S[key] = Number.isFinite(v) && v >= 0 ? v : key === 'plot' ? null : S[key];
    if (key === 'base' || key === 'chargeable') S.max = Math.round((S.base + S.chargeable) * 100) / 100;
    save(); render();
  }
});

load();
