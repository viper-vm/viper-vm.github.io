// Plumb — Area statement: RERA carpet area and FSI under Gujarat's CGDCR 2017 (Ahmedabad), measured
// from the project's drawings. Every number says where it comes from; every space can be re-assigned.

import { injectIcons, rail, wireRail, $, $$, esc, icon, toast, busy, qs } from '../shell/ui.js';
import { saveProject, getSettings } from '../shell/store.js';
import { openProject } from '../shell/projects.js';
import { summarize } from '../shell/model.js';
import { levelTag } from '../style.js';
import { download } from '../export.js';
import { ZONES, zoneOf, BUILDINGS, USES, USE_ORDER, areaStatement, statementCSV, areaSetup } from '../areas.js';

injectIcons();
const railEl = $('#rail');
const page = $('#page');
const id = qs('id');
let P = null, REV = null, R = null, SET = null;

const FT2 = 10.7639;
const m2 = (v) => (Number.isFinite(v) ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const ft2 = (v) => (Number.isFinite(v) ? Math.round(v * FT2).toLocaleString('en-IN') : '—');
const both = (v) => `${m2(v)} m²<span class="ft"> · ${ft2(v)} ft²</span>`;

const setup = () => areaSetup(P, R);
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
  for (const f of st.floors) for (const e of f.exempt) exemptAll[e.short || e.label] = { rule: e.rule, area: (exemptAll[e.short || e.label] ? exemptAll[e.short || e.label].area : 0) + e.area * f.repeat };

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
        <p class="hint" style="margin:10px 0 0">${st.building === 'house' ? 'One unit: its staircase is part of the carpet area (and still exempt from FSI).' : st.building === 'apartments' ? 'Flats: stairs, lifts and lobbies are common areas, outside every flat’s carpet area. Carpet area is worked out flat by flat.' : 'Stairs, lifts and lobbies are common areas.'}</p>
      </div>
    </div>

    <div class="grid g4" style="margin-top:14px">
      <div class="tile"><h3>FSI consumed</h3>${fsiLine}</div>
      <div class="tile"><h3>FSI area</h3><div class="kpi-v" style="font-size:24px">${m2(T.fsiArea)} m²</div><div class="kpi-s">built-up ${m2(T.builtUp)} m²</div></div>
      <div class="tile"><h3>RERA carpet area</h3><div class="kpi-v" style="font-size:24px">${m2(T.carpet)} m²</div><div class="kpi-s">${ft2(T.carpet)} ft²${T.flats ? ` · ${T.flats} flat${T.flats === 1 ? '' : 's'}` : ''} · balconies ${m2(T.balcony)} m²${T.terrace > 0.005 ? ` · open terraces ${m2(T.terrace)} m²` : ''}</div></div>
      <div class="tile"><h3>Not in FSI</h3><div class="kpi-v" style="font-size:24px">${m2(T.exemptArea)} m²</div><div class="kpi-s">${(Object.keys(exemptAll).join(', ').replace(/^./, (c) => c.toUpperCase())) || 'Nothing exempt'}</div></div>
    </div>

    ${reviewN ? `<div class="tile ar-review">${icon('i-alert')}<div><b>${reviewN} space${reviewN > 1 ? 's' : ''} (${m2(T.review)} m²) need${reviewN > 1 ? '' : 's'} a decision.</b> They have no name in the drawing, so Plumb can’t tell a room from a terrace or a gap. Say what each is in the room list below; until then they’re left out of every total.
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn small" href="#rooms">Go to the rooms</a><button class="btn small ghost" data-ignoreall>Leave them all out</button></div></div></div>` : ''}

    <h2 class="sec">Floor by floor</h2>
    <div class="tblw"><table class="t ar-t"><thead><tr><th>Floor</th><th class="n">×</th><th class="n">Built-up</th><th class="n">Not in FSI</th><th class="n">FSI area</th><th class="n">RERA carpet</th><th class="n">Balcony / verandah</th><th class="n">Open terrace</th><th class="n">Common</th><th class="n">Shafts</th><th class="n">Walls</th></tr></thead><tbody>
      ${st.floors.map((f) => `<tr><td><span class="ft-tag">${esc(levelTag(R.floors[f.k]))}</span> ${esc(cap(f.title))}</td><td class="n">${f.repeat}</td><td class="n">${m2(f.builtUp)}</td><td class="n">${m2(f.exemptArea)}</td><td class="n"><b>${m2(f.fsiArea)}</b></td><td class="n"><b>${m2(f.carpet)}</b></td><td class="n">${m2(f.balcony)}</td><td class="n">${m2(f.terrace)}</td><td class="n">${m2(f.common)}</td><td class="n">${m2(f.shafts)}</td><td class="n">${m2(f.walls)}</td></tr>`).join('')}
      <tr class="tot"><td>Total${st.floors.some((f) => f.repeat > 1) ? ' (typical floors counted each time)' : ''}</td><td></td><td class="n">${m2(T.builtUp)}</td><td class="n">${m2(T.exemptArea)}</td><td class="n"><b>${m2(T.fsiArea)}</b></td><td class="n"><b>${m2(T.carpet)}</b></td><td class="n">${m2(T.balcony)}</td><td class="n">${m2(T.terrace)}</td><td class="n">${m2(T.common)}</td><td class="n">${m2(T.shafts)}</td><td class="n">${m2(T.walls)}</td></tr>
    </tbody></table></div>
    <p class="hint" style="margin:6px 2px 0">All areas in m². Built-up is measured to the outer face of the walls, balconies included. ${T.pergola > 0.005 ? `Pergolas (${m2(T.pergola)} m²) are left out of built-up area: CGDCR 6.3.2(13).` : ''}</p>

    ${flatsSection(st)}

    ${landingsSection(st)}

    ${loftsSection(st)}

    ${mezzSection(st)}

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
      <div class="tblw"><table class="t"><thead><tr><th>Space</th><th class="n">Area m²</th><th>Counts as</th>${f.flats.length ? '<th>Flat</th>' : ''}<th>RERA</th><th>FSI</th></tr></thead><tbody>
        ${f.rooms.slice().sort((a, b) => (b.use === 'review') - (a.use === 'review') || USE_ORDER.indexOf(a.use) - USE_ORDER.indexOf(b.use) || b.area - a.area).map((r) => `<tr class="${r.use === 'review' ? 'rv' : ''}"><td>${esc(r.name)}${r.label && r.label.trim().toLowerCase() !== r.name.toLowerCase() ? ` <span class="muted">(“${esc(r.label)}”)</span>` : ''}</td><td class="n">${m2(r.area)}</td>
          <td><select class="inp ${r.set ? 'you' : ''}" data-use="${esc(r.key)}" aria-label="What ${esc(r.name)} counts as">${USE_ORDER.map((u) => `<option value="${u}" ${u === r.use ? 'selected' : ''}>${esc(USES[u].label)}</option>`).join('')}</select></td>
          ${f.flats.length ? `<td>${r.rera === 'none' && !r.flat ? '<span class="muted">—</span>' : `<select class="inp ${(S.flatOf || {})[r.key] ? 'you' : ''}" data-flat="${esc(r.key)}" aria-label="Which flat ${esc(r.name)} is in">${f.flats.map((fl) => `<option value="${esc(fl.key)}" ${fl.key === r.flat ? 'selected' : ''}>${esc(fl.name)}</option>`).join('')}<option value="none" ${!r.flat ? 'selected' : ''}>Not in a flat</option></select>`}</td>` : ''}
          <td class="muted">${esc(reraText(r.rera))}</td><td class="muted">${esc(fsiText(r.fsi, r.rule))}</td></tr>`).join('')}
      </tbody></table></div></details>`).join('')}

    <h2 class="sec">How it’s worked out</h2>
    <div class="tile ar-notes">
      <p><b>RERA carpet area</b> (Real Estate Act 2016, §2(k)): the net usable floor area, without the external walls, service shafts and the exclusive balcony, verandah and open terrace areas (stated separately), but with the internal partition walls.</p>
      <p><b>FSI</b> (CGDCR 2017 Part II): built-up area on every floor, lofts and mezzanines included, divided by the plot area. Not counted, under §6.3.2: staircases with their intermediate landings and walls, and the landing at floor level up to 2x by x (6); lifts and lift wells with their walls, and the landing up to 2x by 2x (7, 8); lofts up to 30% of their room (5); parking basements and hollow plinths (3, 4); electric rooms (10); pergolas (13). Balconies aren’t on that list, so they count.</p>
      <p><b>From the drawing:</b> room areas are net, inside the walls. Every wall is split between the spaces on its two sides; a wall with carpet on both sides is a partition, and the rest are external. Stairs named only by their UP/DOWN arrow are measured to their flight.</p>
      ${st.building === 'apartments' ? `<p><b>Flats:</b> every flat has a kitchen, so each space goes with the kitchen it reaches through the fewest doors and openings, never through a lobby, stair or lift. A flat’s carpet area is its rooms plus the walls between two of its own rooms; a wall to the next flat or to the lobby isn’t an internal partition. A flat is named from a label like “FLAT 101” or “A-302” in it, else numbered by floor, left to right (101, 102…). Move a room to another flat in the room list if a door wasn’t found.</p>` : ''}
      <p><b>Mezzanines</b> count towards FSI in full (Part I 2.70) and, inside a unit, towards its carpet area; a mezzanine drawn as a plan of its own is measured like any floor.</p>
      <p><b>Lofts and mezzanines over a room</b> are measured inside the dashed outline round their note, to the middle of its lines (a cross drawn through a loft is ignored). With no outline of their own, enter the area.</p>
      <p>Check the zone and FSI against your TP scheme and the current amendments before you submit.</p>
    </div>`;
}

/** Stair and lift landings left out of FSI, and how the allowance was worked out. */
function landingsSection(st) {
  const fl = st.floors.filter((f) => f.landings.cores.length);
  if (!fl.length) return '';
  return `<h2 class="sec">Stair and lift landings</h2>
    <p class="hint" style="margin:-4px 2px 10px">CGDCR 6.3.2(6): a stair’s landing at floor level up to twice the stair’s width, x (taken as 2x wide, x deep). 6.3.2(7), (8): a lift’s landing 2x wide and 2x deep, x being the well with its walls. What’s left out is the lobby or landing actually there, up to the allowance${st.building === 'house' ? '' : ' (common spaces only)'}.</p>
    <div class="tblw"><table class="t ar-t"><thead><tr><th>Floor</th><th>Stair or lift</th><th class="n">x</th><th class="n">Allowed</th><th>Landing there</th><th class="n">Not in FSI</th></tr></thead><tbody>
      ${fl.map((f) => f.landings.cores.map((c, n) => `<tr>${n === 0 ? `<td rowspan="${f.landings.cores.length}"><span class="ft-tag">${esc(levelTag(R.floors[f.k]))}</span> ${esc(cap(f.title))}${f.repeat > 1 ? ` <span class="muted">×${f.repeat}</span>` : ''}</td>` : ''}
        <td>${esc(c.name)}</td><td class="n">${c.x.toFixed(2)} m${c.measured ? '' : '<span class="muted" title="Treads not measured: the smallest width Table 13.2 allows"> *</span>'}</td><td class="n">${m2(c.allow)}</td>
        ${n === 0 ? `<td rowspan="${f.landings.cores.length}">${f.landings.spaces.length ? `${esc(f.landings.spaces.map((i) => f.rooms[i].name).join(', '))} <span class="muted">· ${m2(f.landings.space)} m²</span>` : '<span class="muted">none next to it</span>'}</td><td class="n" rowspan="${f.landings.cores.length}"><b>${m2(f.landings.exempt)}</b></td>` : ''}</tr>`).join('')).join('')}
    </tbody></table></div>
    ${fl.some((f) => f.landings.cores.some((c) => !c.measured)) ? '<p class="hint" style="margin:6px 2px 0">* The stair’s treads weren’t measured, so x is the smallest width Table 13.2 allows. Put the treads on a stair layer to measure them.</p>' : ''}`;
}

/** Lofts: up to 30% of the room below isn't counted; any more is. */
function loftsSection(st) {
  const lofts = st.floors.flatMap((f) => f.lofts.map((l) => ({ f, l })));
  const S = setup();
  const candidates = st.floors.flatMap((f) => f.rooms.filter((r) => r.rera === 'carpet' && !f.lofts.some((l) => l.i === r.i)).map((r) => ({ f, r })));
  return `<h2 class="sec">Lofts</h2>
    <p class="hint" style="margin:-4px 2px 10px">CGDCR 6.3.2(5): a loft up to 30% of the room it’s in isn’t counted towards FSI; the rest is. Plumb finds lofts written in a room (“LOFT ABOVE”) and measures the outline drawn round the note; type an area to use your own, or add a loft.</p>
    ${lofts.length ? `<div class="tblw"><table class="t ar-t ar-lofts"><thead><tr><th>Floor</th><th>Over</th><th class="n">Room</th><th class="n">Loft m²</th><th class="n">Free up to 30%</th><th class="n">Counted in FSI</th><th></th></tr></thead><tbody>
      ${lofts.map(({ f, l }) => `<tr class="${l.area == null ? 'rv' : ''}"><td><span class="ft-tag">${esc(levelTag(R.floors[f.k]))}</span></td><td>${esc(l.name)}${l.detected ? ' <span class="muted">· in the drawing</span>' : ''}</td><td class="n">${m2(l.roomArea)}</td>
        <td class="n"><input class="inp ar-loft ${l.yours ? 'you' : ''}" type="number" min="0" step="0.01" inputmode="decimal" data-loft="${esc(l.key)}" data-measured="${l.measured ?? ''}" value="${l.area != null ? +l.area.toFixed(2) : ''}" placeholder="area" aria-label="Loft area over ${esc(l.name)}" />${srcTag(l)}</td>
        <td class="n">${m2(l.allowed)}</td><td class="n ${l.excess > 0.005 ? 'bad' : ''}">${l.area == null ? '<span class="muted">—</span>' : m2(l.excess)}</td>
        <td><button class="btn link small" data-noloft="${esc(l.key)}">Remove</button></td></tr>`).join('')}
    </tbody></table></div>` : ''}
    ${candidates.length ? `<div class="ar-addloft"><select class="inp" id="a-addloft" aria-label="Room to add a loft to"><option value="">Add a loft over…</option>${candidates.map(({ f, r }) => `<option value="${esc(r.key)}">${esc(levelTag(R.floors[f.k]))} · ${esc(r.name)} (${m2(r.area)} m²)</option>`).join('')}</select></div>` : ''}
    ${!lofts.length && !candidates.length ? '<p class="muted">No rooms to put a loft in yet.</p>' : ''}
    ${S.lofts && Object.values(S.lofts).some((v) => v === false) ? `<p class="hint" style="margin:6px 2px 0"><button class="btn link small" data-loftsback>Bring back the lofts you removed</button></p>` : ''}`;
}

/** Where a loft's or mezzanine's area came from. */
const srcTag = (o) => `<div class="ar-src">${o.yours ? (o.measured != null ? `yours · measured ${m2(o.measured)}` : 'yours') : o.measured != null ? 'measured from the outline' : 'no outline: enter it'}</div>`;

/** Mezzanines: every square metre counts towards FSI (Part I 2.70); 30% of the space they're in at most (Part III 13.1.8). */
function mezzSection(st) {
  const plans = st.floors.filter((f) => f.mezzFloor);
  const mz = st.floors.flatMap((f) => f.mezz.map((m) => ({ f, m })));
  const S = setup();
  const candidates = st.floors.filter((f) => !f.mezzFloor).flatMap((f) => f.rooms.filter((r) => (r.fsi === 'count' || r.fsi === 'exempt') && r.use !== 'stair' && r.use !== 'lift' && !f.mezz.some((m) => m.i === r.i)).map((r) => ({ f, r })));
  const pct = (v) => `${Math.round(v * 100)}%`;
  return `<h2 class="sec">Mezzanines</h2>
    <p class="hint" style="margin:-4px 2px 10px">A mezzanine’s area counts towards FSI, all of it (CGDCR Part I 2.70), and inside a flat or unit it’s carpet area too. It may cover up to 30% of the space it’s in, with 2.1 m clear above and below (Part III 13.1.8). A plan titled “MEZZANINE” is read as a floor of its own; one written in a room (“MEZZANINE ABOVE”) is measured from the outline drawn round the note; type an area to use your own, or add one.</p>
    ${plans.length || mz.length ? `<div class="tblw"><table class="t ar-t ar-lofts"><thead><tr><th>Floor</th><th>Mezzanine</th><th class="n">Area m²</th><th class="n">Of the space</th><th class="n">Share</th><th class="n">In FSI</th><th></th></tr></thead><tbody>
      ${plans.map((f) => `<tr><td><span class="ft-tag">${esc(levelTag(R.floors[f.k]))}</span></td><td>${esc(cap(f.title))} <span class="muted">· a plan of its own${f.overlooks ? `, over the ${esc(f.overlooks.title.toLowerCase())}` : ''}</span></td>
        <td class="n">${m2(f.builtUp)}</td><td class="n">${f.overlooks ? m2(f.overlooks.area) : '—'}</td><td class="n ${f.overlooks && f.overlooks.share > 0.3 + 1e-6 ? 'bad' : ''}">${f.overlooks ? pct(f.overlooks.share) : '—'}</td><td class="n">${m2(f.builtUp)}</td><td></td></tr>`).join('')}
      ${mz.map(({ f, m }) => `<tr class="${m.area == null ? 'rv' : ''}"><td><span class="ft-tag">${esc(levelTag(R.floors[f.k]))}</span></td><td>Over ${esc(m.name)}${m.detected ? ' <span class="muted">· in the drawing</span>' : ''}${m.carpet ? ' <span class="muted">· carpet</span>' : ''}</td>
        <td class="n"><input class="inp ar-loft ${m.yours ? 'you' : ''}" type="number" min="0" step="0.01" inputmode="decimal" data-mezz="${esc(m.key)}" data-measured="${m.measured ?? ''}" value="${m.area != null ? +m.area.toFixed(2) : ''}" placeholder="area" aria-label="Mezzanine area over ${esc(m.name)}" />${srcTag(m)}</td>
        <td class="n">${m2(m.roomArea)}</td><td class="n ${m.over > 0.005 ? 'bad' : ''}">${m.area == null ? '—' : pct(m.area / m.roomArea)}</td><td class="n">${m.area == null ? '<span class="muted">—</span>' : m2(m.area)}</td>
        <td><button class="btn link small" data-nomezz="${esc(m.key)}">Remove</button></td></tr>`).join('')}
    </tbody></table></div>` : ''}
    ${candidates.length ? `<div class="ar-addloft"><select class="inp" id="a-addmezz" aria-label="Room to add a mezzanine in"><option value="">Add a mezzanine in…</option>${candidates.map(({ f, r }) => `<option value="${esc(r.key)}">${esc(levelTag(R.floors[f.k]))} · ${esc(r.name)} (${m2(r.area)} m²)</option>`).join('')}</select></div>` : ''}
    ${S.mezz && Object.values(S.mezz).some((v) => v === false) ? `<p class="hint" style="margin:6px 2px 0"><button class="btn link small" data-mezzback>Bring back the mezzanines you removed</button></p>` : ''}`;
}

/** Carpet area flat by flat (buildings of flats only). */
function flatsSection(st) {
  if (st.building !== 'apartments') return '';
  const withFlats = st.floors.filter((f) => f.flats.length);
  if (!withFlats.length) {
    return `<h2 class="sec">Flats</h2><div class="tile ar-notes"><p>No flats found yet. Plumb groups each floor’s rooms round their kitchens; ${st.floors.some((f) => f.review.length) ? 'name the unnamed spaces in the room list (a kitchen, a bedroom…) and the flats will appear.' : 'check the kitchens are named in the drawing.'}</p></div>`;
  }
  const all = withFlats.flatMap((f) => f.flats.map((fl) => ({ f, fl })));
  const cs = all.map((x) => x.fl.carpet);
  const kinds = {};
  for (const { f, fl } of all) if (fl.kind) kinds[fl.kind] = (kinds[fl.kind] || 0) + f.repeat;
  return `<h2 class="sec">Flats <span class="muted" style="font-weight:400;font-size:14px">· ${st.totals.flats} flat${st.totals.flats === 1 ? '' : 's'}${Object.keys(kinds).length ? ` · ${Object.entries(kinds).map(([k, n]) => `${n} × ${esc(k)}`).join(', ')}` : ''} · carpet ${m2(Math.min(...cs))}${cs.length > 1 ? `–${m2(Math.max(...cs))}` : ''} m²</span></h2>
    <p class="hint" style="margin:-4px 2px 10px">RERA carpet area of each flat: its rooms plus its internal walls. Balconies, verandahs and open terraces are stated beside it. Rename a flat by typing over its name.</p>
    <div class="tblw"><table class="t ar-t ar-flats"><thead><tr><th>Floor</th><th>Flat</th><th>Type</th><th class="n">RERA carpet</th><th class="n">Rooms + walls</th><th class="n">Balcony / verandah</th><th class="n">Open terrace</th></tr></thead><tbody>
      ${withFlats.map((f) => f.flats.map((fl, n) => `<tr>${n === 0 ? `<td rowspan="${f.flats.length}"><span class="ft-tag">${esc(levelTag(R.floors[f.k]))}</span> ${esc(cap(f.title))}${f.repeat > 1 ? `<div class="muted" style="font-size:12px">× ${f.repeat} floors</div>` : ''}</td>` : ''}
        <td><input class="inp ar-fname ${fl.named ? 'you' : ''}" data-fname="${esc(fl.key)}" value="${esc(fl.name)}" aria-label="Name of this flat" />
          <div class="ar-sp">${esc(fl.rooms.map((i) => f.rooms[i]).filter((r) => r.use !== 'review').map((r) => r.name).join(', '))}${fl.pending ? ` <span class="rv-n">+ ${fl.pending} to decide</span>` : ''}</div></td>
        <td class="nowrap">${esc(fl.kind || '—')}</td>
        <td class="n"><b>${m2(fl.carpet)}</b><span class="ft"> · ${ft2(fl.carpet)} ft²</span></td>
        <td class="n muted">${m2(fl.carpetRooms)} + ${m2(fl.partitions)}${fl.mezz ? ` + ${m2(fl.mezz)} mezz.` : ''}</td>
        <td class="n">${m2(fl.balcony)}</td><td class="n">${m2(fl.terrace)}</td></tr>`).join('')).join('')}
    </tbody></table></div>`;
}

const cap = (s) => { const t = String(s || '').toLowerCase().replace(/\bplan\b/, '').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const reraText = (v) => ({ carpet: 'Carpet area', balcony: 'Balcony / verandah', terrace: 'Open terrace', none: '—' }[v] || '—');
const fsiText = (v, rule) => (v === 'count' ? 'Counted' : v === 'exempt' ? `Not counted${rule ? ` · ${rule}` : ''}` : rule ? `Not built-up · ${rule}` : '—');

// ------------------------------------------------------------------ edits
page.addEventListener('click', (e) => {
  const t = e.target;
  const sb = t.closest('[data-set]');
  if (sb) {
    setup()[sb.dataset.set] = sb.dataset.v;
    // the bye-law checks' building use follows (a bungalow and a row house are both a house)
    if (sb.dataset.set === 'building' && P.rules && P.rules.use && ({ DW1: 'house', DW2: 'house', DW3: 'apartments', M: 'commercial' })[P.rules.use] !== sb.dataset.v) delete P.rules.use;
    save(true); render(); return;
  }
  if (t.closest('[data-zonefsi]')) { const S = setup(), z = zoneOf(S.zone); Object.assign(S, { base: z.base, chargeable: z.chargeable, max: z.max }); save(true); render(); return; }
  if (t.closest('[data-ignoreall]')) {
    const S = setup(), st = areaStatement(R, S);
    for (const f of st.floors) for (const r of f.review) S.uses[r.key] = 'ignore';
    save(true); render(); toast('Left out of the totals. Change any of them in the room list.');
    return;
  }
  const nl = t.closest('[data-noloft]');
  if (nl) { const S = setup(); S.lofts ||= {}; S.lofts[nl.dataset.noloft] = false; save(true); render(); return; }
  const nm = t.closest('[data-nomezz]');
  if (nm) { const S = setup(); S.mezz ||= {}; S.mezz[nm.dataset.nomezz] = false; save(true); render(); return; }
  if (t.closest('[data-mezzback]')) { const S = setup(); for (const [k, v] of Object.entries(S.mezz || {})) if (v === false) delete S.mezz[k]; save(true); render(); return; }
  if (t.closest('[data-loftsback]')) { const S = setup(); for (const [k, v] of Object.entries(S.lofts || {})) if (v === false) delete S.lofts[k]; save(true); render(); return; }
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
  if (t.dataset.flat) {
    S.flatOf ||= {};
    const auto = areaStatement(R, { ...S, flatOf: {} }).floors.flatMap((f) => f.rooms).find((r) => r.key === t.dataset.flat);
    if (auto && (auto.flat || 'none') === t.value) delete S.flatOf[t.dataset.flat]; else S.flatOf[t.dataset.flat] = t.value;
    save(true); render();
    return;
  }
  if (t.dataset.loft) {
    S.lofts ||= {};
    const v = parseFloat(t.value), meas = parseFloat(t.dataset.measured);
    S.lofts[t.dataset.loft] = { area: Number.isFinite(v) && v > 0 && !(Math.abs(v - meas) < 0.005) ? v : null }; // empty, or the measured figure: measured
    save(true); render();
    return;
  }
  if (t.dataset.mezz) {
    S.mezz ||= {};
    const v = parseFloat(t.value), meas = parseFloat(t.dataset.measured);
    S.mezz[t.dataset.mezz] = { area: Number.isFinite(v) && v > 0 && !(Math.abs(v - meas) < 0.005) ? v : null };
    save(true); render();
    return;
  }
  if (t.id === 'a-addmezz' && t.value) {
    S.mezz ||= {};
    S.mezz[t.value] = { area: null };
    save(true); render();
    const inp = page.querySelector(`[data-mezz="${CSS.escape(t.value)}"]`);
    if (inp) inp.focus();
    return;
  }
  if (t.id === 'a-addloft' && t.value) {
    S.lofts ||= {};
    S.lofts[t.value] = { area: null };
    save(true); render();
    const inp = page.querySelector(`[data-loft="${CSS.escape(t.value)}"]`);
    if (inp) inp.focus();
    return;
  }
  if (t.dataset.fname) {
    S.flatNames ||= {};
    const v = t.value.trim();
    if (v) S.flatNames[t.dataset.fname] = v; else delete S.flatNames[t.dataset.fname];
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
