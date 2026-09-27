// Plumb — Settings: the office's defaults, set once so every project reads correctly.

import { injectIcons, rail, wireRail, $, esc, icon, toast, confirmBox, fmtBytes, setTheme, themeNow } from '../shell/ui.js';
import { getSettings, saveSettings, usage, askPersist, wipeAll, listProjects, DEFAULT_SETTINGS } from '../shell/store.js';
import { ROLES, ROOM_TYPES } from '../recognize.js';
import { ROLE_LABEL, TYPE_LABEL } from '../style.js';

injectIcons();
const railEl = $('#rail');
railEl.innerHTML = rail('settings');
wireRail(railEl);
const page = $('#page');
let S = null, U = null, N = 0;

async function load() {
  [S, U] = await Promise.all([getSettings(), usage()]);
  N = (await listProjects()).length;
  render();
}

const seg = (id, cur, opts) => `<span class="seg" role="group" id="${id}">${opts.map(([v, l]) => `<button type="button" data-seg="${id}" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</span>`;

function render() {
  const h = S.heights;
  const lr = Object.entries(S.layerRoles || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const rt = Object.entries(S.roomTypes || {}).sort((a, b) => a[0].localeCompare(b[0]));
  page.innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><div class="sub">Office-wide defaults, stored on this device. Changes save as you make them.</div></div></div>

    <h2 class="sec" id="region">Region &amp; rules</h2>
    <div class="tile"><div class="frow">
      <label class="fld"><span>Region</span><select id="region-sel"><option value="IN-AMD" selected>India · Ahmedabad</option><option disabled>More cities later</option></select>
      <span class="hint">Ahmedabad (AMC and AUDA areas) follows Gujarat’s Comprehensive General Development Control Regulations, CGDCR 2017. FSI and area statements (next phase) and bye-law checks (the phase after) will use it; every rule will show its clause and stay editable.</span></label>
    </div></div>

    <h2 class="sec" id="units">Units</h2>
    <div class="tile" style="display:grid;gap:14px">
      <div class="frow"><div class="fld"><span>Lengths</span>${seg('lengthUnit', S.lengthUnit, [['mm', 'mm'], ['m', 'm'], ['ftin', 'ft-in']])}</div>
      <div class="fld"><span>Areas</span>${seg('areaUnit', S.areaUnit, [['m2', 'm²'], ['ft2', 'ft²'], ['both', 'm² and ft²']])}<span class="hint">RERA uses m²; brochures often use ft². “Both” shows each.</span></div></div>
    </div>

    <h2 class="sec" id="heights">Storey heights</h2>
    <div class="tile"><p class="muted" style="margin:0 0 12px;font-size:13px">Plans don’t carry heights, so the 3D model uses these unless a project sets its own.</p>
      <form id="hform" class="frow">
        ${[['floor', 'Floor to floor'], ['slab', 'Slab'], ['door', 'Door head'], ['sill', 'Window sill'], ['head', 'Window head'], ['parapet', 'Parapet']].map(([k, l]) => `<label class="fld"><span>${l} (m)</span><input type="number" step="0.01" min="0" max="10" name="${k}" value="${h[k]}" /></label>`).join('')}
      </form>
      <div style="margin-top:12px;display:flex;gap:8px"><button class="btn small primary" data-hsave>Save heights</button><button class="btn small ghost" data-hreset>Reset</button></div>
    </div>

    <h2 class="sec" id="standards">Office layer standards</h2>
    <div class="tile"><p class="muted" style="margin:0 0 12px;font-size:13px">Learnt from your imports. When a new drawing has a layer with one of these names, Plumb reads it the same way.</p>
      ${lr.length ? `<div class="tblw"><table class="t"><thead><tr><th>Layer</th><th>Holds</th><th></th></tr></thead><tbody>${lr.map(([l, r]) => `<tr><td class="num" style="font-size:12.5px">${esc(l)}</td><td><select class="inp" data-lr="${esc(l)}" style="height:30px">${ROLES.map((ro) => `<option value="${ro}" ${ro === r ? 'selected' : ''}>${ROLE_LABEL[ro]}</option>`).join('')}</select></td><td class="n"><button class="icon-btn" data-lrdel="${esc(l)}" aria-label="Forget ${esc(l)}">${icon('i-trash')}</button></td></tr>`).join('')}</tbody></table></div>
        <div style="margin-top:10px"><button class="btn small ghost" data-lrclear>Forget all layers</button></div>` : '<p class="muted" style="margin:0">Nothing learnt yet. Import a drawing with “Remember these layer roles” ticked.</p>'}
      ${rt.length ? `<h2 class="sec" style="margin-top:18px">Room names</h2><div class="tblw"><table class="t"><tbody>${rt.map(([l, t]) => `<tr><td>${esc(l)}</td><td><select class="inp" data-rt="${esc(l)}" style="height:30px">${ROOM_TYPES.map((ty) => `<option value="${ty}" ${ty === t ? 'selected' : ''}>${TYPE_LABEL[ty]}</option>`).join('')}</select></td><td class="n"><button class="icon-btn" data-rtdel="${esc(l)}" aria-label="Forget">${icon('i-trash')}</button></td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>

    <h2 class="sec" id="ai">AI assist</h2>
    <div class="tile" style="display:grid;gap:12px">
      <p class="muted" style="margin:0;font-size:13px">Optional. With your own Anthropic API key, AI reads layer names and room labels that rules miss (office codes, abbreviations, Gujarati or Hindi labels) and drafts RFIs for consultants. Only names, counts and findings are sent, straight from this browser to the AI provider. Never the drawing.</p>
      <div class="frow"><label class="fld"><span>Anthropic API key</span><input type="password" id="aikey" value="${esc(S.ai.key || '')}" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" /><span class="hint">${S.ai.key ? 'Saved on this device.' : 'Not set.'} Get one at console.anthropic.com.</span></label></div>
      <div style="display:flex;gap:8px"><button class="btn small primary" data-aisave>Save key</button>${S.ai.key ? '<button class="btn small ghost" data-aiforget>Forget key</button>' : ''}</div>
    </div>

    <h2 class="sec" id="appearance">Appearance</h2>
    <div class="tile"><div class="fld"><span>Theme</span>${seg('theme', themeNow(), [['dark', 'Dark'], ['light', 'Light']])}</div></div>

    <h2 class="sec" id="data">Data &amp; privacy</h2>
    <div class="tile" style="display:grid;gap:10px">
      <p style="margin:0">${N} project${N === 1 ? '' : 's'} · ${fmtBytes(U.used)} used${U.quota ? ` of ${fmtBytes(U.quota)} available` : ''}. ${U.persisted ? 'The browser keeps this data safe from automatic clean-up.' : 'The browser may clear this data if the disk fills up.'}</p>
      <p class="muted" style="margin:0;font-size:13px">Everything stays in this browser on this computer. Nothing is uploaded; clearing the browser’s site data removes it.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${U.persisted ? '' : '<button class="btn small" data-persist>Keep data safe</button>'}<button class="btn small danger" data-wipe>${icon('i-trash')}Delete everything on this device</button></div>
    </div>

    <h2 class="sec" id="shortcuts">Keyboard shortcuts</h2>
    <div class="tblw"><table class="t"><tbody>
      ${[['2 · 3 · M', 'Plan · stack · 3D model (in a project)'], ['D', 'Show the drawing’s dimensions'], ['F', 'Fit the view'], ['J · K', 'Next · previous issue'], ['H', 'Hide the panels (3D)'], ['Esc', 'Clear the selection']].map(([k, v]) => `<tr><td class="num" style="width:140px">${k}</td><td>${v}</td></tr>`).join('')}
    </tbody></table></div>`;
}

async function save(patch, msg = 'Saved.') {
  S = await saveSettings(patch);
  toast(msg);
  render();
}

page.addEventListener('click', async (e) => {
  const t = e.target;
  const sg = t.closest('[data-seg]');
  if (sg) {
    const k = sg.dataset.seg, v = sg.dataset.v;
    if (k === 'theme') { setTheme(v); await save({ theme: v }); railEl.innerHTML = rail('settings'); return; }
    await save({ [k]: v });
    return;
  }
  if (t.closest('[data-hsave]')) {
    const f = $('#hform'), h = {};
    for (const k of Object.keys(DEFAULT_SETTINGS.heights)) { const v = parseFloat(f.elements[k].value); if (Number.isFinite(v) && v >= 0) h[k] = v; }
    if (h.head <= h.sill) { toast('The window head has to be above the sill.', true); return; }
    await save({ heights: { ...S.heights, ...h } }, 'Heights saved.');
    return;
  }
  if (t.closest('[data-hreset]')) { await save({ heights: { ...DEFAULT_SETTINGS.heights } }, 'Heights reset.'); return; }
  const ld = t.closest('[data-lrdel]');
  if (ld) { const m = { ...S.layerRoles }; delete m[ld.dataset.lrdel]; await save({ layerRoles: m }, 'Forgotten.'); return; }
  if (t.closest('[data-lrclear]')) { if (await confirmBox({ title: 'Forget every learnt layer?', body: 'New drawings will be read from their layer names and contents again.', ok: 'Forget all' })) await save({ layerRoles: {} }, 'Forgotten.'); return; }
  const rd = t.closest('[data-rtdel]');
  if (rd) { const m = { ...S.roomTypes }; delete m[rd.dataset.rtdel]; await save({ roomTypes: m }, 'Forgotten.'); return; }
  if (t.closest('[data-aisave]')) {
    const v = $('#aikey').value.trim();
    if (v && !/^sk-ant-[\w-]{10,}$/.test(v)) { toast('That doesn’t look like an Anthropic API key (it starts with sk-ant-).', true); return; }
    await save({ ai: { ...S.ai, key: v, enabled: !!v } }, v ? 'Key saved on this device.' : 'Key removed.');
    return;
  }
  if (t.closest('[data-aiforget]')) { await save({ ai: { ...S.ai, key: '', enabled: false } }, 'Key forgotten.'); return; }
  if (t.closest('[data-persist]')) { const ok = await askPersist(); U = await usage(); toast(ok ? 'The browser will keep your projects.' : 'The browser didn’t allow it.', !ok); render(); return; }
  if (t.closest('[data-wipe]')) {
    if (await confirmBox({ title: 'Delete everything?', body: `All ${N} project${N === 1 ? '' : 's'}, their drawings, issues and notes, and these settings are removed from this device. This can’t be undone.`, ok: 'Delete everything', danger: true })) {
      await wipeAll();
      toast('Everything deleted.');
      setTimeout(() => { location.href = './'; }, 600);
    }
  }
});
page.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.lr) await save({ layerRoles: { ...S.layerRoles, [t.dataset.lr]: t.value } });
  if (t.dataset.rt) await save({ roomTypes: { ...S.roomTypes, [t.dataset.rt]: t.value } });
});

load();
