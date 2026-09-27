// Pivot — app controller: editors, persistence, the planning race, playback and results.

import { Scene3D } from './scene.js';
import { ITEM_TYPES, itemType, buildItem, parseDims } from './items.js';
import { STEP_TYPES, buildWorld, zoneAt } from './world.js';
import { buildPlaybook, theZone } from './playbook.js';
import { qSlerp } from './geom.js';
import { EXAMPLES, DEFAULT_EXAMPLE } from './examples.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const icon = (id, cls = '') => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) s.setAttribute('class', cls);
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `#${id}`);
  s.append(u);
  return s;
};

// ---------------------------------------------------------------------------
// storage (never let a blocked localStorage break the page)

const mem = new Map();
const store = {
  get(k, d = null) {
    try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return mem.has(k) ? mem.get(k) : d; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { mem.set(k, v); }
  },
};
const K = { last: 'pivot.v1.last', places: 'pivot.v1.places', units: 'pivot.v1.units', theme: 'pivot.v1.theme', seen: 'pivot.v1.seen' };

// ---------------------------------------------------------------------------
// state

const clone = (x) => JSON.parse(JSON.stringify(x));
const state = {
  item: null,       // { type, params }
  route: [],        // raw steps
  margin: 1,
  units: store.get(K.units, 'cm'),
  example: null,
};
let world = null, item = null;
let result = null;   // { ok, ... }
let run = null;      // active planning run
let playback = null; // animation state

// ---------------------------------------------------------------------------
// units

const IN = 2.54;
const toUnit = (cm) => (state.units === 'in' ? cm / IN : cm);
const fromUnit = (v) => (state.units === 'in' ? v * IN : v);
const unitLabel = () => (state.units === 'in' ? 'in' : 'cm');
function fmtIn(cm) {
  if (state.units === 'in') return `${(cm / IN).toFixed(cm / IN < 10 ? 1 : 0)}″`;
  return `${Math.round(cm)} cm`;
}
function fmtGap(cm) {
  if (cm === null || cm === undefined || !Number.isFinite(cm)) return '—';
  if (state.units === 'in') return `${(cm / IN).toFixed(2)}″`;
  return `${cm.toFixed(1)} cm`;
}
const shown = (cm) => (state.units === 'in' ? +(cm / IN).toFixed(1) : Math.round(cm * 10) / 10);

// ---------------------------------------------------------------------------
// scene

const scene = new Scene3D($('#viewport'), $('#labels'));
const media = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = store.get(K.theme, null);
  const dark = pref ? pref === 'dark' : media.matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#111316' : '#f1ede5');
  $('#themeBtn use').setAttribute('href', dark ? '#i-sun' : '#i-moon');
  scene.setTheme(dark);
}
media.addEventListener?.('change', applyTheme);

// ---------------------------------------------------------------------------
// item editor

const TYPE_ORDER = ['sofa', 'loveseat', 'armchair', 'sectional', 'mattress', 'boxspring', 'wardrobe', 'bookcase', 'fridge', 'washer', 'piano', 'table', 'tv', 'box'];
const TYPE_SHORT = { sofa: 'Sofa', loveseat: 'Loveseat', armchair: 'Armchair', sectional: 'Sectional', mattress: 'Mattress', boxspring: 'Box spring', wardrobe: 'Wardrobe', bookcase: 'Bookcase', fridge: 'Fridge', washer: 'Washer', piano: 'Piano', table: 'Table', tv: 'TV', box: 'Box' };

function renderTypes() {
  const wrap = $('#types');
  wrap.replaceChildren(...TYPE_ORDER.map((t) => h('button', {
    class: 'type', role: 'radio', 'aria-checked': String(state.item.type === t), title: ITEM_TYPES[t].label,
    onclick: () => {
      if (state.item.type === t) return;
      state.item = { type: t, params: clone(itemType(t).defaults) };
      state.example = null;
      renderItem();
      changed({ reframe: false });
    },
  }, icon(`it-${t}`), TYPE_SHORT[t])));
}

function numberField(label, value, onValue, { unit = true, hint = '', step = unit ? 0.5 : 1, min = 0 } = {}) {
  const input = h('input', { type: 'number', inputmode: 'decimal', step: String(step), min: String(min), value: String(unit ? shown(value) : value), 'aria-label': label });
  const f = h('div', { class: 'field' },
    h('label', {}, label),
    h('div', { class: 'num-in' }, input, unit ? h('span', { class: 'u' }, unitLabel()) : null),
    hint ? h('span', { class: 'hint' }, hint) : null);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    const ok = Number.isFinite(v) && v >= min;
    f.classList.toggle('bad', !ok);
    if (ok) onValue(unit ? fromUnit(v) : v);
  });
  input.addEventListener('focus', () => input.select());
  return f;
}

function renderItem() {
  renderTypes();
  const t = itemType(state.item.type);
  const p = state.item.params;
  $('#itemFields').replaceChildren(...t.fields.map(([key, label, hint]) =>
    numberField(label, p[key], (v) => { p[key] = v; state.example = null; changed(); }, { hint })));
  $('#itemToggles').replaceChildren(...(t.toggles || []).map(([key, label, hint]) => {
    const input = h('input', { type: 'checkbox', role: 'switch' });
    input.checked = !!p[key];
    input.addEventListener('change', () => { p[key] = input.checked; state.example = null; changed(); });
    return h('label', { class: 'tog' }, h('span', { class: 'tog-t' }, label, hint ? h('small', {}, hint) : null), h('span', { class: 'switch' }, input, h('span')));
  }));
  const note = $('#itemNote');
  note.hidden = !t.note;
  note.textContent = t.note || '';
  updateItemSummary();
}

function updateItemSummary() {
  if (!item) return;
  const [x, y, z] = item.size;
  const parts = [`${fmtIn(x)} × ${fmtIn(z)} × ${fmtIn(y)} (W × D × H)`];
  if (item.upright) parts.push('stays upright');
  $('#itemSummary').textContent = parts.join(' · ');
}

$('#pasteDims').addEventListener('change', (e) => {
  const d = parseDims(e.target.value);
  if (!d) { toast('Could not read those dimensions'); return; }
  const p = state.item.params;
  for (const k of ['W', 'D', 'H']) if (d[k] && k in p) p[k] = Math.round(d[k] * 10) / 10;
  e.target.value = '';
  state.example = null;
  renderItem();
  changed();
  toast('Dimensions filled in');
});

// ---------------------------------------------------------------------------
// route editor

const STEP_MENU = [
  { t: 'door', label: 'Doorway', d: 'Front door, room door, gate', ico: 'st-door', make: () => ({ t: 'door', w: 81, h: 203, d: 14 }) },
  { t: 'hall', label: 'Hallway', d: 'Corridor, passage, porch', ico: 'st-hall', make: () => ({ t: 'hall', w: 100, l: 300, h: 250 }) },
  { t: 'turn', label: 'Turn left', d: 'A 90° corner', ico: 'st-turn-L', make: () => ({ t: 'turn', dir: 'L', beyond: 0 }) },
  { t: 'turn', label: 'Turn right', d: 'A 90° corner', ico: 'st-turn-R', make: () => ({ t: 'turn', dir: 'R', beyond: 0 }) },
  { t: 'turn', label: 'U-turn landing', d: 'Half-landing between flights', ico: 'st-turn-UL', make: () => ({ t: 'turn', dir: 'UL', beyond: 0 }) },
  { t: 'stairs', label: 'Stairs up', d: 'A straight flight', ico: 'st-stairs', make: () => ({ t: 'stairs', dir: 'up', w: 90, n: 14, rise: 18, go: 26, head: 200, ceil: 'open' }) },
  { t: 'stairs', label: 'Stairs down', d: 'Basement, split level', ico: 'st-stairs-down', make: () => ({ t: 'stairs', dir: 'down', w: 90, n: 14, rise: 18, go: 26, head: 200, ceil: 'open' }) },
  { t: 'lift', label: 'Lift', d: 'Elevator car and its door', ico: 'st-lift', make: () => ({ t: 'lift', cw: 110, cd: 140, ch: 215, dw: 80, dh: 200, align: 'center', exit: 'same' }) },
  { t: 'room', label: 'Room', d: 'Where it ends up', ico: 'st-room', make: () => ({ t: 'room', w: 350, l: 380, h: 260, name: 'Room' }) },
];

const INLINE = { door: ['w', 'h'], hall: ['w', 'l'], stairs: ['w', 'n', 'head'], lift: ['cw', 'cd', 'dw'], room: ['w', 'l'], turn: [] };
const COUNT_FIELDS = new Set(['n']);
const CHOICE_LABELS = {
  L: ['Left', 'st-turn-L'], R: ['Right', 'st-turn-R'], UL: ['U-turn left', 'st-turn-UL'], UR: ['U-turn right', 'st-turn-UR'],
  up: ['Up', 'st-stairs'], down: ['Down', 'st-stairs-down'], open: ['Open above', null], sloped: ['Sloped ceiling', null],
  center: ['Centre', null], left: ['Left', null], right: ['Right', null], same: ['Same side', null], opposite: ['Opposite side', null],
  rail: ['Open, with banisters', null], wall: ['Solid wall', null],
};

function stepIcon(s) {
  if (s.t === 'turn') return `st-turn-${s.dir || 'L'}`;
  if (s.t === 'stairs') return s.dir === 'down' ? 'st-stairs-down' : 'st-stairs';
  return `st-${s.t}`;
}
function stepTitles() {
  let doors = 0, halls = 0;
  return state.route.map((s) => {
    if (s.t === 'door') return ++doors === 1 ? 'Front door' : `Door ${doors}`;
    if (s.t === 'hall') return ++halls === 1 ? 'Hallway' : `Hallway ${halls}`;
    if (s.t === 'turn') return s.dir === 'L' ? 'Turn left' : s.dir === 'R' ? 'Turn right' : s.dir === 'UL' ? 'U-turn (left)' : 'U-turn (right)';
    if (s.t === 'stairs') return s.dir === 'down' ? 'Stairs down' : 'Stairs up';
    if (s.t === 'lift') return 'Lift';
    if (s.t === 'room') return s.name || 'Room';
    return s.t;
  });
}

function renderRoute() {
  const list = $('#route');
  const titles = stepTitles();
  const items = [h('li', { class: 'rstep start compact' },
    h('div', { class: 'rcard' },
      h('span', { class: 'r-ico outside' }, icon('st-outside')),
      h('div', { class: 'r-head' }, h('div', { class: 'r-title' }, 'Outside')),
      h('div', { class: 'r-sub' }, 'The van, the driveway — plenty of room to tip it over.')),
    insertBtn(0))];
  state.route.forEach((s, i) => {
    const def = STEP_TYPES[s.t];
    if (!def) return;
    const isLast = i === state.route.length - 1;
    const card = h('div', { class: 'rcard', onclick: (e) => { if (!e.target.closest('input,button,summary,select')) focusStep(i); } });
    card.append(h('span', { class: `r-ico ${s.t}` }, icon(stepIcon(s))));
    const title = s.t === 'room'
      ? h('div', { class: 'r-title' }, h('input', { value: s.name || 'Room', 'aria-label': 'Room name', oninput: (e) => { s.name = e.target.value || 'Room'; state.example = null; changed({ light: true }); } }), isLast ? h('span', { class: 'r-tag' }, 'Destination') : null)
      : h('div', { class: 'r-title' }, titles[i]);
    const acts = h('div', { class: 'r-acts' },
      i > 0 ? h('button', { title: 'Move up', onclick: () => moveStep(i, -1) }, icon('i-up')) : null,
      i < state.route.length - 1 ? h('button', { title: 'Move down', onclick: () => moveStep(i, 1) }, icon('i-down')) : null,
      h('button', { title: 'Remove', onclick: () => removeStep(i) }, icon('i-x')));
    card.append(h('div', { class: 'r-head' }, title, acts));

    const inline = INLINE[s.t] || [];
    const fieldDefs = def.fields.filter(([k]) => inline.includes(k));
    const moreDefs = def.fields.filter(([k]) => !inline.includes(k));
    const mkField = ([k, label, hint]) => numberField(label, s[k] ?? def.defaults[k], (v) => { s[k] = COUNT_FIELDS.has(k) ? Math.max(1, Math.round(v)) : v; state.example = null; changed(); }, { unit: !COUNT_FIELDS.has(k), hint: '', step: COUNT_FIELDS.has(k) ? 1 : 0.5, min: COUNT_FIELDS.has(k) ? 1 : 0 });
    if (s.t === 'turn') {
      card.append(choiceChips(s, 'dir', ['L', 'R', 'UL', 'UR']));
      card.classList.add('turn');
    } else if (s.t === 'stairs') {
      card.append(choiceChips(s, 'dir', ['up', 'down']));
    }
    if (fieldDefs.length) card.append(h('div', { class: 'r-fields' }, ...fieldDefs.map(mkField)));
    const extras = (def.extras || []).filter(([k]) => !(s.t === 'turn' && k === 'dir') && !(s.t === 'stairs' && k === 'dir') && !(s.t === 'turn' && k === 'divider' && !String(s.dir).startsWith('U')));
    if (moreDefs.length || extras.length) {
      const more = h('details', { class: 'r-more' },
        h('summary', {}, s.t === 'turn' ? (String(s.dir).startsWith('U') ? 'Landing details' : 'Space past the turn') : 'More measurements', icon('i-chev')),
        moreDefs.length ? h('div', { class: 'r-fields' }, ...moreDefs.map(mkField)) : null,
        ...extras.map(([k, label, opts]) => h('div', { class: 'field', style: 'margin-top:6px' }, h('label', {}, label), choiceChips(s, k, opts))));
      card.append(more);
    }
    const hintText = stepHint(s);
    if (hintText) card.append(h('div', { class: 'r-sub' }, hintText));
    const li = h('li', { class: `rstep${s.t === 'turn' ? ' compact' : ''}`, dataset: { i: String(i) } }, card, insertBtn(i + 1));
    items.push(li);
  });
  list.replaceChildren(...items);
  markTrouble();
}

function stepHint(s) {
  if (s.t === 'turn' && (s.dir === 'UL' || s.dir === 'UR')) return 'A half-landing: the next flight runs back alongside this one.';
  if (s.t === 'lift') return `Lift car ${fmtIn(s.cw)} × ${fmtIn(s.cd)}, door ${fmtIn(s.dw)} wide.`;
  return '';
}

function choiceChips(s, key, opts) {
  const wrap = h('div', { class: 'r-chips', role: 'group' });
  const cur = s[key] ?? STEP_TYPES[s.t].defaults[key];
  for (const o of opts) {
    const [label, ico] = CHOICE_LABELS[o] || [o, null];
    wrap.append(h('button', {
      class: `chip${cur === o ? ' on' : ''}`, type: 'button',
      onclick: () => { s[key] = o; state.example = null; renderRoute(); changed(); },
    }, ico ? icon(ico) : null, label));
  }
  return wrap;
}

function insertBtn(at) {
  return h('button', { class: 'insert', title: 'Insert a step here', onclick: (e) => { e.stopPropagation(); openAddMenu(at, e.currentTarget); } }, icon('i-plus'));
}

let addAt = null;
function openAddMenu(at, anchor) {
  addAt = at;
  const menu = $('#addStepMenu');
  const wrap = menu.parentElement;
  if (anchor && anchor.classList.contains('insert')) {
    // float the menu next to the inline + button
    const r = anchor.getBoundingClientRect(), pr = $('#setup').getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.left = `${Math.min(r.left + 20, pr.right - 350)}px`;
    menu.style.top = `${Math.min(r.top, window.innerHeight - 440)}px`;
    menu.style.bottom = 'auto';
  } else {
    menu.style.position = ''; menu.style.left = ''; menu.style.top = ''; menu.style.bottom = '';
  }
  void wrap;
  toggleMenu(menu, true);
}

function renderAddMenu() {
  const menu = $('#addStepMenu');
  menu.classList.add('grid');
  menu.replaceChildren(...STEP_MENU.map((m) => h('button', {
    role: 'menuitem',
    onclick: () => {
      const s = m.make();
      let at = addAt;
      if (at === null) {
        at = state.route.length;
        const last = state.route[state.route.length - 1];
        if (s.t !== 'room' && last && last.t === 'room') at = state.route.length - 1;
      }
      state.route.splice(at, 0, s);
      state.example = null;
      toggleMenu(menu, false);
      renderRoute();
      changed({ reframe: true });
      focusStep(at);
    },
  }, h('span', { class: 'mi-ico' }, icon(m.ico)), h('span', {}, h('span', { class: 'mi-t' }, m.label), h('span', { class: 'mi-d' }, m.d)))));
}

function moveStep(i, d) {
  const j = i + d;
  if (j < 0 || j >= state.route.length) return;
  const [s] = state.route.splice(i, 1);
  state.route.splice(j, 0, s);
  state.example = null;
  renderRoute();
  changed({ reframe: true });
}
function removeStep(i) {
  state.route.splice(i, 1);
  state.example = null;
  renderRoute();
  changed({ reframe: true });
}

function focusStep(i) {
  $$('.rstep').forEach((li) => li.classList.toggle('focus', li.dataset.i === String(i)));
  if (!world) return;
  const zs = world.zones.filter((z) => z.src === i).map((z) => z.id);
  if (!zs.length) return;
  const boxes = world.free.filter((b) => zs.includes(b.zone));
  if (!boxes.length) return;
  const min = [0, 1, 2].map((a) => Math.min(...boxes.map((b) => b.min[a])));
  const max = [0, 1, 2].map((a) => Math.max(...boxes.map((b) => b.max[a])));
  const pad = 160;
  const lvl = Math.max(...zs.map((z) => world.zones[z].level));
  if (world.levels.length > 1) setFloor(lvl);
  scene.frameAll(true, { min: [min[0] - pad, min[1], min[2] - pad], max: [max[0] + pad, max[1], max[2] + pad] });
}

function markTrouble() {
  const trouble = result && !result.ok && result.troubleSrc ? result.troubleSrc : [];
  $$('.rstep').forEach((li) => li.classList.toggle('trouble', trouble.includes(Number(li.dataset.i))));
}

// ---------------------------------------------------------------------------
// menus

function toggleMenu(menu, open) {
  const willOpen = open ?? menu.hidden;
  $$('.menu').forEach((m) => { if (m !== menu) m.hidden = true; });
  menu.hidden = !willOpen;
  const btn = menu.parentElement.querySelector('button[aria-haspopup]');
  if (btn) btn.setAttribute('aria-expanded', String(willOpen));
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-wrap') && !e.target.closest('.insert')) $$('.menu').forEach((m) => (m.hidden = true));
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.menu').forEach((m) => (m.hidden = true)); });
$('#addStepBtn').addEventListener('click', (e) => { e.stopPropagation(); addAt = null; const m = $('#addStepMenu'); m.style.position = ''; m.style.left = ''; m.style.top = ''; toggleMenu(m); });
$('#examplesBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu($('#examplesMenu')); });
$('#homesBtn').addEventListener('click', (e) => { e.stopPropagation(); renderPlaces(); toggleMenu($('#homesMenu')); });

function renderExamples() {
  $('#examplesMenu').replaceChildren(...EXAMPLES.map((ex) => h('button', {
    role: 'menuitem', onclick: () => { toggleMenu($('#examplesMenu'), false); loadExample(ex.id, true); },
  }, h('span', { class: 'mi-ico' }, icon(ex.icon)), h('span', {}, h('span', { class: 'mi-t' }, ex.title), h('span', { class: 'mi-d' }, ex.blurb)))));
}

function renderPlaces() {
  const places = store.get(K.places, []);
  const menu = $('#homesMenu');
  const rows = places.map((p, idx) => h('div', { class: 'mi-row' },
    h('button', { role: 'menuitem', onclick: () => { toggleMenu(menu, false); state.route = clone(p.route); state.example = null; renderRoute(); changed({ reframe: true }); toast(`Loaded “${p.name}” — check any item against it`); } },
      h('span', { class: 'mi-ico' }, icon('i-home')), h('span', {}, h('span', { class: 'mi-t' }, p.name), h('span', { class: 'mi-d' }, `${p.route.length} steps · saved ${new Date(p.at).toLocaleDateString()}`))),
    h('button', { class: 'del', title: 'Forget', onclick: (e) => { e.stopPropagation(); places.splice(idx, 1); store.set(K.places, places); renderPlaces(); } }, icon('i-x'))));
  menu.replaceChildren(
    ...(rows.length ? rows : [h('div', { class: 'mi-empty' }, 'Save a route once — your front door, stairs and lift — then test every sofa you like against it.')]),
    h('hr'),
    h('button', { role: 'menuitem', onclick: () => { toggleMenu(menu, false); saveRoute(); } }, h('span', { class: 'mi-ico' }, icon('i-save')), h('span', {}, h('span', { class: 'mi-t' }, 'Save the current route'), h('span', { class: 'mi-d' }, 'Kept in this browser only')))
  );
}

function saveRoute() {
  let name = '';
  try { name = window.prompt('Name this route (e.g. “Our flat”, “Mum’s house”)', 'My home') || ''; } catch { name = ''; }
  if (!name.trim()) name = `Route ${new Date().toLocaleDateString()}`;
  const places = store.get(K.places, []);
  places.unshift({ name: name.trim(), route: clone(state.route), at: Date.now() });
  store.set(K.places, places.slice(0, 20));
  toast(`Saved “${name.trim()}”`);
}
$('#saveHomeBtn').addEventListener('click', saveRoute);

// ---------------------------------------------------------------------------
// world rebuild + persistence

let rebuildTimer = 0, hashTimer = 0, framedOnce = false, rebuildPending = false, pendingReframe = false;
function changed({ reframe = false, light = false } = {}) {
  invalidate();
  clearTimeout(rebuildTimer);
  rebuildPending = true;
  pendingReframe = pendingReframe || reframe;
  rebuildTimer = setTimeout(() => rebuild({ reframe: pendingReframe }), light ? 250 : 90);
  clearTimeout(hashTimer);
  hashTimer = setTimeout(persist, 400);
}

function rebuild({ reframe = false } = {}) {
  rebuildPending = false;
  pendingReframe = false;
  try {
    world = buildWorld({ steps: state.route });
    item = buildItem(state.item);
  } catch (err) {
    console.error(err);
    toast('Something in the route does not add up');
    return;
  }
  scene.setWorld(world, { keepCamera: framedOnce && !reframe });
  if (!framedOnce || reframe) { scene.frameAll(framedOnce); framedOnce = true; }
  scene.setItem(item);
  scene.setItemPose(startPoseFor(item));
  renderFloors();
  updateItemSummary();
  const w = $('#routeWarnings');
  w.hidden = !world.warnings.length;
  w.replaceChildren(...world.warnings.map((t) => h('p', {}, t)));
}

function startPoseFor(it) {
  const inf = state.margin + 0.4;
  return [0, it.size[1] / 2 + inf + 0.3, 540 / 2 + 40, 0, 0, 0, 1];
}

function persist() {
  const snap = { v: 1, i: state.item, r: state.route, m: state.margin };
  store.set(K.last, snap);
  const enc = encodeState(snap);
  history.replaceState(null, '', `#p=${enc}`);
}

function encodeState(snap) {
  const json = JSON.stringify(snap);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeState(s) {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const snap = JSON.parse(new TextDecoder().decode(bytes));
    if (!snap || !snap.i || !Array.isArray(snap.r)) return null;
    return snap;
  } catch { return null; }
}

function loadSnap(snap) {
  const t = snap.i.type in ITEM_TYPES ? snap.i.type : 'sofa';
  state.item = { type: t, params: { ...itemType(t).defaults, ...(snap.i.params || {}) } };
  state.route = clone(snap.r);
  state.margin = [0.5, 1, 2.5].includes(snap.m) ? snap.m : 1;
  $$('#marginSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.m) === state.margin));
}

function loadExample(id, autorun) {
  const ex = EXAMPLES.find((e) => e.id === id) || EXAMPLES[0];
  state.example = ex.id;
  state.item = clone(ex.item);
  state.item.params = { ...itemType(ex.item.type).defaults, ...ex.item.params };
  state.route = clone(ex.route);
  renderItem();
  renderRoute();
  invalidate();
  rebuild({ reframe: true });
  persist();
  if (autorun) setTimeout(check, 350);
}

// ---------------------------------------------------------------------------
// planning: a race between workers holding different carry postures

function carryModes(it) {
  if (it.upright) return [null, null, null];
  // the three ways movers carry things — on its end, upright, on its back — plus a free search
  return [{ k: 0, s: 0 }, null, { k: 1, s: 1 }, { k: 2, s: 0 }];
}

function workerWorld(w) {
  const { faces, labels, steps, warnings, ...rest } = w;
  return rest;
}

function stopRun() {
  if (!run) return;
  const r = run;
  run = null;
  r.stopped = true;
  if (r.cancel) r.cancel();
}

/**
 * Race several planners (different seeds / carry postures). Resolves with the best plan
 * found, or with the failures. onProgress receives merged progress.
 */
function race(w, it, { budgetChecks = 1200000, budgetMs = 60000, grace = 2200, modes, onProgress, cloud = false, handle = null, seedBase = 0 } = {}) {
  return new Promise((resolve) => {
    const cores = navigator.hardwareConcurrency || 4;
    const list = (modes || carryModes(it)).slice(0, Math.max(2, Math.min(4, cores - 1)));
    const payload = workerWorld(w);
    const me = { workers: [], done: 0, results: [], fails: [], prog: [], graceTimer: 0, finished: false, started: performance.now() };
    const finish = () => {
      if (me.finished) return;
      me.finished = true;
      clearTimeout(me.graceTimer);
      for (const wk of me.workers) wk.terminate();
      resolve(me);
    };
    me.cancel = () => { me.cancelled = true; finish(); };
    if (handle) handle.cancel = me.cancel;
    list.forEach((carry, k) => {
      let wk;
      try { wk = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); } catch (err) { me.fails.push({ ok: false, reason: 'worker' }); return; }
      me.workers.push(wk);
      wk.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') {
          me.prog[k] = m;
          if (onProgress) onProgress(me, cloud && m.pts ? m.pts : null);
        } else if (m.type === 'result' || m.type === 'error') {
          me.done++;
          const res = m.type === 'result' ? m.res : { ok: false, reason: 'error', message: m.message };
          res.carry = carry;
          if (res.ok) {
            me.results.push(res);
            if (me.results.length === 1) me.graceTimer = setTimeout(finish, grace);
          } else me.fails.push(res);
          if (me.done >= list.length) finish();
        }
      };
      wk.onerror = (err) => { console.error(err); me.done++; me.fails.push({ ok: false, reason: 'error' }); if (me.done >= list.length) finish(); };
      wk.postMessage({ id: 1, world: payload, item: it, opts: { margin: state.margin, budgetChecks, budgetMs, seed: seedBase + 11 + k * 7, carry } });
    });
    if (!me.workers.length) finish();
  });
}

function scorePlan(res, w, it) {
  const pb = buildPlaybook(w, it, res.dense, res.clearance);
  const len = res.dense.length ? res.dense[res.dense.length - 1].d : 0;
  const flips = pb.steps.filter((s) => s.icon === 'rotate').length;
  return { pb, score: flips * 220 + pb.steps.length * 45 + len * 0.02 - Math.min(3, res.clearance.min) * 10 };
}

async function check({ extra = false } = {}) {
  if (run) stopRun();
  pause();
  if (rebuildPending || !world || !item) { clearTimeout(rebuildTimer); rebuild(); }
  const w = world, it = item;
  result = null;
  hideResult();
  setVerdict('run');
  $('#runTitle').textContent = 'Rehearsing the move…';
  $('#raceA').style.width = '0%';
  $('#raceB').style.width = '0%';
  $('#runStats').textContent = 'warming up';
  $('#checkBtn').classList.remove('stale');
  $('#checkBtn span').textContent = 'Checking…';
  scene.clearCloud();
  scene.fadeCloud(0.75);
  scene.setPath(null);
  scene.hideDimLabels = false;
  scene.setItemPose(startPoseFor(it));
  if (world.levels.length > 1) setFloor(null);
  if (window.matchMedia('(max-width: 900px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' });
  const myRun = (run = { cancel: null, stopped: false });
  const t0 = performance.now();
  const me = await race(w, it, {
    budgetChecks: extra ? 3000000 : 1200000,
    budgetMs: extra ? 480000 : 240000, // safety cap only; the verdict is set by budgetChecks
    seedBase: extra ? 1000 + Math.floor(Math.random() * 1e6) : 0,
    cloud: true,
    handle: myRun,
    onProgress: (st, pts) => {
      if (run !== myRun) return;
      const total = w.length || 1;
      let a = 0, b = total, checks = 0;
      for (const p of st.prog) if (p) { a = Math.max(a, p.frontA); b = Math.min(b, p.frontB); checks += p.checks; }
      $('#raceA').style.width = `${Math.min(100, (a / total) * 100)}%`;
      $('#raceB').style.width = `${Math.min(100, ((total - b) / total) * 100)}%`;
      const budget = (extra ? 3000000 : 1200000) * Math.max(1, st.workers.length);
      $('#runStats').textContent = `${fmtCount(checks)} positions · ${Math.min(99, Math.round((checks / budget) * 100))}% of the search`;
      if (pts) scene.addCloud(pts);
      const secs = (performance.now() - t0) / 1000;
      if (st.results.length) $('#runTitle').textContent = 'Found a way — looking for a simpler one…';
      else if (secs > 30) $('#runTitle').textContent = 'Still rehearsing — this device is taking its time…';
    },
  });
  if (run !== myRun || myRun.stopped) return; // superseded or stopped
  run = null;
  $('#checkBtn span').textContent = 'Check the fit';
  const elapsed = (performance.now() - t0) / 1000;
  let checks = 0;
  for (const p of me.prog) if (p) checks += p.checks;
  if (me.results.length) {
    let best = null;
    for (const r of me.results) {
      const s = scorePlan(r, w, it);
      if (!best || s.score < best.score) best = { ...s, res: r };
    }
    result = { ok: true, ...best.res, pb: best.pb, world: w, item: it, elapsed, checks };
    showSuccess();
  } else {
    result = { ok: false, world: w, item: it, fails: me.fails, elapsed, checks, diag: mergeDiag(me.fails, w) };
    showFailure();
  }
  track('check', result.ok ? 'fits' : 'no');
}

function mergeDiag(fails, w) {
  const d = { zonesA: new Set(), zonesB: new Set(), frontA: 0, frontB: Infinity, poseA: null, poseB: null, reason: null };
  for (const f of fails) {
    if (f.reason === 'room') d.reason = 'room';
    if (!f.diag) continue;
    f.diag.zonesA.forEach((z) => d.zonesA.add(z));
    f.diag.zonesB.forEach((z) => d.zonesB.add(z));
    if (f.diag.frontA >= d.frontA) { d.frontA = f.diag.frontA; d.poseA = f.diag.poseA; }
    if (f.diag.frontB <= d.frontB) { d.frontB = f.diag.frontB; d.poseB = f.diag.poseB; }
  }
  void w;
  return d;
}

$('#checkBtn').addEventListener('click', () => {
  if (run) { stopRun(); cancelRunUI(); return; }
  check();
});
$('#stopBtn').addEventListener('click', () => { if (run) { stopRun(); cancelRunUI(); } });

function cancelRunUI() {
  $('#checkBtn span').textContent = 'Check the fit';
  setVerdict('idle');
  scene.fadeCloud(0);
}

function invalidate() {
  if (run) { stopRun(); $('#checkBtn span').textContent = 'Check the fit'; }
  if (result || $('#verdict').dataset.state !== 'idle') {
    result = null;
    hideResult();
    setVerdict('idle');
    $('#checkBtn').classList.add('stale');
    scene.fadeCloud(0);
    scene.setPath(null);
    markTrouble();
  }
}

// ---------------------------------------------------------------------------
// result UI

function setVerdict(s) { $('#verdict').dataset.state = s; }

function hideResult() {
  pause();
  playback = null;
  $('#timeline').hidden = true;
  $('#playbook').hidden = true;
  $('#pbReopen').hidden = true;
  $('#stage').classList.remove('pb-open');
  $('#fixes').hidden = true;
  if (fixRun) { fixRun.cancelled = true; if (fixRun.cancel) fixRun.cancel(); fixRun = null; }
}

function zoneLabel(z) { return result?.world?.zones[z]?.label || ''; }

function showSuccess() {
  const r = result, pb = r.pb, w = r.world;
  setVerdict('ok');
  $('#app').classList.add('focus');
  $('#vBadge use').setAttribute('href', '#i-check');
  const gap = r.clearance.min;
  const pinchZone = r.clearance.pinch ? w.zones[r.clearance.pinch.zone]?.label : pb.summary.tightest?.zone;
  $('#vTitle').textContent = gap < 1.5 ? 'It fits — just.' : gap < 4 ? 'It fits.' : 'It fits easily.';
  $('#vSub').innerHTML = `Tightest squeeze: <b>${fmtGap(gap)}</b>${pinchZone ? ` at ${esc(theZone(pinchZone))}` : ''} · ${pb.steps.length} steps`;
  scene.fadeCloud(0);
  // playbook
  $('#pbEyebrow').textContent = "The mover's playbook";
  $('#pbTitle').textContent = 'How to get it in';
  $('#pbSummary').style.display = '';
  $('#pbSummary').replaceChildren(
    h('div', { class: `stat ${gap < 1.5 ? 'tight' : 'ok'}` }, h('b', {}, fmtGap(gap)), h('span', {}, 'tightest gap')),
    h('div', { class: 'stat' }, h('b', {}, String(pb.steps.length)), h('span', {}, 'steps')),
    h('div', { class: 'stat' }, h('b', {}, `${fmtCount(r.checks)}`), h('span', {}, `moves tried · ${r.elapsed.toFixed(1)} s`)));
  $('#steps').replaceChildren(...pb.steps.map((s, i) => {
    const gapCls = s.gap === null ? '' : s.gap < 1.5 ? 'tight' : s.gap < 4 ? 'snug' : '';
    return h('li', { dataset: { i: String(i) }, onclick: () => seekStep(i) },
      h('span', { class: 's-num' }, String(i + 1)),
      h('div', {}, h('div', { class: 's-t' }, s.title), h('div', { class: 's-d' }, s.detail),
        i > 0 && s.gap !== null && s.gap < 6 ? h('span', { class: `s-gap ${gapCls}` }, `${s.tightest ? 'tightest · ' : ''}${fmtGap(s.gap)} spare`) : null));
  }));
  $('#fixes').hidden = true;
  $('#playbook').hidden = false;
  $('#stage').classList.add('pb-open');
  $('#pbReopen').hidden = true;
  // 3D
  const ghosts = pb.steps.filter((s) => s.icon === 'rotate').map((s) => s.i1).slice(0, 6);
  const pinch = r.clearance.pinch;
  scene.setPath(r.dense, {
    ghosts,
    pinch,
    pinchText: `${fmtGap(gap)} spare`,
    pinchLevel: pinch ? w.zones[pinch.zone]?.level ?? 0 : 0,
    levelAt: (p) => { const z = zoneAt(w, p[0], p[1], p[2]); return z >= 0 ? w.zones[z].level : 0; },
  });
  setupPlayback();
  markTrouble();
  setTimeout(() => play(), 450);
}

function showFailure() {
  const r = result, w = r.world, d = r.diag;
  setVerdict('no');
  $('#app').classList.add('focus');
  $('#vBadge use').setAttribute('href', '#i-x');
  $('#timeline').hidden = true;
  scene.fadeCloud(0.35);
  if (r.fails.length && r.fails.every((f) => f.reason === 'worker' || f.reason === 'error')) {
    $('#vTitle').textContent = 'The planner didn’t start.';
    $('#vSub').textContent = 'This browser blocked its background workers. Open the page over http(s) in a current Chrome, Edge, Firefox or Safari.';
    console.warn('Pivot: planner workers failed', r.fails);
    $('#app').classList.remove('focus');
    $('#playbook').hidden = true;
    $('#stage').classList.remove('pb-open');
    return;
  }
  if (d.reason === 'room') {
    $('#vTitle').textContent = 'It won’t fit in the room.';
    $('#vSub').textContent = 'Even standing on its own in the destination room, it hits a wall or the ceiling.';
  } else {
    $('#vTitle').textContent = 'Pivot couldn’t get it in.';
    $('#vSub').innerHTML = `${fmtCount(r.checks)} positions tried in ${r.elapsed.toFixed(0)} s.`;
  }
  // which zones did each side reach?
  const order = w.zones.filter((z) => z.kind !== 'outside').map((z) => z.id);
  const reachedA = new Set(d.zonesA), reachedB = new Set(d.zonesB);
  // the trouble spot: the first zone after the last zone the outside search reached
  const inRoute = w.zones.filter((z) => z.id !== 0);
  let lastA = 0;
  for (const z of inRoute) if (reachedA.has(z.id)) lastA = Math.max(lastA, z.id);
  let firstB = w.zones.length - 1;
  for (const z of [...inRoute].reverse()) if (reachedB.has(z.id)) firstB = Math.min(firstB, z.id);
  const trouble = firstB <= lastA
    ? [w.zones[lastA]]
    : w.zones.filter((z) => z.id > lastA && z.id < Math.max(firstB, lastA + 2)).slice(0, 3);
  const troubleZone = trouble[0] || w.zones[Math.min(w.zones.length - 1, lastA + 1)];
  r.troubleSrc = [...new Set(trouble.map((z) => z.src).concat(troubleZone ? [troubleZone.src] : []))].filter((x) => x >= 0);
  markTrouble();
  if (d.reason !== 'room' && troubleZone) $('#vSub').innerHTML += ` It gets stuck at <b>${esc(theZone(troubleZone.label))}</b>.`;
  $('#pbEyebrow').textContent = 'No way found';
  $('#pbTitle').textContent = 'Where it gets stuck';
  const strip = h('div', { class: 'route-strip' }, ...order.map((id) => {
    const z = w.zones[id];
    const cls = reachedA.has(id) && !trouble.includes(z) ? 'a' : reachedB.has(id) && !trouble.includes(z) ? 'b' : trouble.includes(z) ? 'x' : '';
    return h('span', { class: cls }, z.label);
  }));
  const lastALabel = w.zones[lastA]?.label || 'Outside';
  const firstBLabel = w.zones[firstB]?.label || w.zones[w.destZone].label;
  $('#pbSummary').replaceChildren(h('div', { class: 'why', style: 'grid-column: 1 / -1' },
    d.reason === 'room'
      ? h('span', {}, 'The destination room is smaller than the item needs, whatever the route.')
      : h('span', {},
        lastA === 0
          ? ['From outside, it doesn’t get through ', h('b', {}, theZone(w.zones[1]?.label || 'front door')), '. ']
          : ['Coming from outside, it gets as far as ', h('b', {}, theZone(lastALabel)), '. '],
        firstB >= w.destZone
          ? ['Working backwards, it can’t even get out of ', h('b', {}, theZone(w.zones[w.destZone].label)), '. ']
          : ['Working backwards from ', h('b', {}, theZone(w.zones[w.destZone].label)), ', it gets back to ', h('b', {}, theZone(firstBLabel)), '. '],
        'Nothing Pivot tried joins the two.'),
    strip));
  $('#pbSummary').style.display = 'block';
  $('#pbSummary').append(h('button', { class: 'btn small', style: 'margin: -2px 0 12px', onclick: () => check({ extra: true }) }, icon('i-restart'), 'Keep searching (2½× longer, new attempts)'));
  $('#steps').replaceChildren();
  $('#playbook').hidden = false;
  $('#stage').classList.add('pb-open');
  // show how far it got
  scene.setPath(null);
  if (d.poseA) scene.setItemPose(d.poseA);
  if (d.poseA && world.levels.length > 1) setFloor(zoneLevelAt(d.poseA));
  runFixes();
}

function zoneLevelAt(p) {
  const z = zoneAt(result?.world || world, p[0], p[1], p[2]);
  return z >= 0 ? (result?.world || world).zones[z].level : 0;
}

// ---------------------------------------------------------------------------
// fixes: try the usual remedies and report which ones work

let fixRun = null;
async function runFixes() {
  const r = result;
  const box = $('#fixes');
  box.hidden = false;
  const me = (fixRun = { cancelled: false });
  const p = state.item.params;
  const t = itemType(state.item.type);
  const fixes = [];
  if ('legs' in p && p.legs) fixes.push({ id: 'legs', title: 'Take the legs off', detail: `Most legs unscrew — that's ${fmtIn(p.legH || 10)} lower`, mutate: (s) => { s.item.params.legs = false; } });
  if ('layDown' in p && !p.layDown) fixes.push({ id: 'lay', title: t.label === 'Upright piano' ? 'Lay it on its back' : 'Tilt it further than 45°', detail: 'Ask the maker first — some need to stand before use', mutate: (s) => { s.item.params.layDown = true; } });
  const doors = state.route.map((s, i) => [s, i]).filter(([s]) => s.t === 'door');
  const trouble = r.troubleSrc || [];
  const tDoors = doors.filter(([, i]) => trouble.includes(i));
  const useDoors = tDoors.length ? tDoors : doors;
  if (useDoors.length) fixes.push({ id: 'hinges', title: useDoors.length === 1 && tDoors.length ? `Take the ${stepTitles()[useDoors[0][1]].toLowerCase()} off its hinges` : 'Take the doors off their hinges', detail: 'Usually wins 3–5 cm; Pivot assumes 4', mutate: (s) => { for (const [, i] of useDoors) s.route[i].w += 4; } });
  if ('armW' in p && ['sofa', 'loveseat', 'armchair'].includes(state.item.type)) fixes.push({ id: 'arms', title: 'If the arms come off', detail: 'Some sofas have bolt-on arms', mutate: (s) => { s.item.params.W -= 2 * s.item.params.armW; s.item.params.armW = 0; } });
  fixes.push({ id: 'size', title: 'The biggest one that would make it', detail: 'Same shape, shorter', search: true });

  const rows = new Map();
  box.replaceChildren(h('h4', {}, 'What would help'), ...fixes.map((f) => {
    const row = h('div', { class: 'fix run' }, h('span', { class: 'f-ico' }, h('span', { class: 'spinner' })), h('div', {}, h('div', { class: 'f-t' }, f.title), h('div', { class: 'f-d' }, f.detail)), h('span'));
    rows.set(f.id, row);
    return row;
  }));

  const tryState = async (mut, budget = 600000) => {
    const s = clone({ item: state.item, route: state.route });
    mut(s);
    const w = buildWorld({ steps: s.route }), it = buildItem(s.item);
    const out = await race(w, it, { budgetChecks: budget, budgetMs: 180000, grace: 0, handle: me });
    return { ok: out.results.length > 0, s };
  };
  const setRow = (id, ok, detail, apply) => {
    const row = rows.get(id);
    if (!row) return;
    row.className = `fix ${ok ? 'ok' : 'no'}`;
    row.querySelector('.f-ico').replaceChildren(icon(ok ? 'i-check' : 'i-x'));
    if (detail) row.querySelector('.f-d').textContent = detail;
    const slot = row.lastChild;
    slot.replaceChildren(ok && apply ? h('button', { class: 'btn small f-btn', onclick: apply }, 'Apply') : h('span', { class: 'f-d' }, ok ? '' : 'still no'));
  };

  for (const f of fixes) {
    if (me.cancelled) return;
    if (f.search) {
      // shrink the long dimension until it fits
      const key = 'W';
      const full = state.item.params[key];
      let lo = full * 0.5, hi = full, best = null;
      const loRes = await tryState((s) => { s.item.params[key] = lo; }, 500000);
      if (me.cancelled) return;
      if (!loRes.ok) { setRow(f.id, false, `Even at ${fmtIn(lo)} it doesn’t go — the problem is its depth or height, not its length.`); continue; }
      best = lo;
      for (let k = 0; k < 4 && !me.cancelled; k++) {
        const mid = (lo + hi) / 2;
        rows.get(f.id).querySelector('.f-d').textContent = `Testing ${fmtIn(mid)}…`;
        const res = await tryState((s) => { s.item.params[key] = mid; }, 500000);
        if (res.ok) { best = mid; lo = mid; } else hi = mid;
      }
      if (me.cancelled) return;
      const v = Math.floor(best);
      setRow(f.id, true, `Up to about ${fmtIn(v)} ${itemType(state.item.type).fields.find((x) => x[0] === key)?.[1].toLowerCase() || 'long'} would make it.`, () => { state.item.params[key] = v; state.example = null; renderItem(); changed(); setTimeout(check, 150); });
      continue;
    }
    const res = await tryState(f.mutate);
    if (me.cancelled) return;
    setRow(f.id, res.ok, null, () => { f.mutate(state); state.example = null; renderItem(); renderRoute(); changed(); setTimeout(check, 150); });
  }
}

// ---------------------------------------------------------------------------
// playback

function setupPlayback() {
  const r = result;
  const dense = r.dense;
  // time map: travel at ~55 cm/s of point motion, lift rides take 1.6 s
  const times = new Float64Array(dense.length);
  let t = 0;
  for (let i = 1; i < dense.length; i++) {
    t += dense[i].t ? 1.6 : (dense[i].d - dense[i - 1].d) / 55;
    times[i] = t;
  }
  const scale = Math.min(1, 40 / Math.max(1, t)) * Math.max(1, 7 / Math.max(0.1, t));
  for (let i = 0; i < times.length; i++) times[i] *= scale;
  playback = { times, dur: times[times.length - 1] || 1, t: 0, playing: false, speed: Number($('#speedSeg .on')?.dataset.s || 1), step: -1 };
  $('#timeline').hidden = false;
  drawClearance();
  const marks = $('#scrubMarks');
  marks.replaceChildren(...r.pb.steps.map((s) => h('i', { class: s.tightest ? 'tight' : '', style: `left:${(times[s.i0] / playback.dur) * 100}%` })));
  seek(0);
}

function drawClearance() {
  const host = $('#clearStrip');
  const c = document.createElement('canvas');
  const W = 600, H = 10;
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const vals = result.clearance.values, times = playback.times, dur = playback.dur;
  let j = 0;
  for (let x = 0; x < W; x++) {
    const tt = (x / (W - 1)) * dur;
    while (j < times.length - 1 && times[j + 1] < tt) j++;
    const v = vals[j];
    g.fillStyle = v < 1.2 ? '#e5484d' : v < 2.5 ? '#f08c2e' : v < 5 ? '#f3c24a' : v < 12 ? '#9cc9a4' : 'rgba(150,150,140,0.25)';
    g.fillRect(x, 0, 1, H);
  }
  host.replaceChildren(c);
  host.title = 'Red = within about a centimetre of something';
}

function poseAt(t) {
  const { times } = playback, dense = result.dense;
  if (t <= 0) return { pose: dense[0].p, i: 0 };
  if (t >= playback.dur) return { pose: dense[dense.length - 1].p, i: dense.length - 1 };
  let lo = 0, hi = times.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
  const a = dense[lo].p, b = dense[hi].p;
  const f = (t - times[lo]) / Math.max(1e-6, times[hi] - times[lo]);
  if (dense[hi].t) {
    // riding the lift: slide straight up/down between the two cars
    return { pose: [a[0], a[1] + (b[1] - a[1]) * ease(f), a[2], a[3], a[4], a[5], a[6]], i: lo, riding: true };
  }
  const q = qSlerp([a[3], a[4], a[5], a[6]], [b[3], b[4], b[5], b[6]], f);
  return { pose: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, q[0], q[1], q[2], q[3]], i: lo };
}
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

function seek(t) {
  if (!playback) return;
  playback.t = Math.max(0, Math.min(playback.dur, t));
  const { pose, i } = poseAt(playback.t);
  scene.setItemPose(pose);
  const k = playback.t / playback.dur;
  $('#scrubFill').style.width = `${k * 100}%`;
  $('#scrubKnob').style.left = `${k * 100}%`;
  $('#scrubInput').value = String(Math.round(k * 1000));
  // active step
  const steps = result.pb.steps;
  let si = 0;
  for (let s = 0; s < steps.length; s++) if (i >= steps[s].i0) si = s;
  if (si !== playback.step) {
    playback.step = si;
    $$('#steps li').forEach((li) => li.classList.toggle('on', li.dataset.i === String(si)));
    const li = $(`#steps li[data-i="${si}"]`);
    if (li && playback.playing) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    $('#tlStep').textContent = `${si + 1}. ${steps[si].title}`;
  }
  if (result.world.levels.length > 1 && floorAuto) {
    const W = result.world;
    const z = zoneAt(W, pose[0], pose[1], pose[2]);
    if (z >= 0) {
      const zn = W.zones[z];
      // on the stairs show the floor they lead to as well
      scene.setFocusLevel(zn.kind === 'stairs' ? zn.level + 1 : zn.level);
      renderFloorsActive();
    }
  }
}

function seekStep(i) {
  if (!playback) return;
  const s = result.pb.steps[i];
  pause();
  seek(playback.times[s.i0]);
}

let lastFrame = 0;
scene.onFrame((now) => {
  if (!playback || !playback.playing) { lastFrame = now; return; }
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  let t = playback.t + dt * playback.speed;
  if (t >= playback.dur) { t = playback.dur; seek(t); pause(); return; }
  seek(t);
});

function play() {
  if (!playback) return;
  if (playback.t >= playback.dur - 0.01) seek(0);
  playback.playing = true;
  lastFrame = performance.now();
  $('#playBtn use').setAttribute('href', '#i-pause');
  $('#playBtn').setAttribute('aria-label', 'Pause');
}
function pause() {
  if (!playback) return;
  playback.playing = false;
  $('#playBtn use').setAttribute('href', '#i-play');
  $('#playBtn').setAttribute('aria-label', 'Play');
}
$('#playBtn').addEventListener('click', () => (playback?.playing ? pause() : play()));
$('#scrubInput').addEventListener('input', (e) => { pause(); seek((Number(e.target.value) / 1000) * playback.dur); });
$$('#speedSeg button').forEach((b) => b.addEventListener('click', () => {
  $$('#speedSeg button').forEach((x) => x.classList.toggle('on', x === b));
  if (playback) playback.speed = Number(b.dataset.s);
}));

// ---------------------------------------------------------------------------
// view tools

let floorAuto = true;
function renderFloors() {
  const box = $('#floors');
  const lv = world ? world.levels : [0];
  box.hidden = lv.length < 2;
  if (lv.length < 2) { scene.setFocusLevel(null); return; }
  box.replaceChildren(...[...lv].reverse().map((l) => h('button', { dataset: { l: String(l) }, title: l === 0 ? 'Ground floor' : `Floor ${l}`, onclick: () => { floorAuto = false; setFloor(l); } }, l === 0 ? 'G' : String(l))),
    h('button', { dataset: { l: 'all' }, title: 'All floors', onclick: () => { floorAuto = true; setFloor(null); } }, 'All'));
  renderFloorsActive();
}
function setFloor(l) {
  scene.setFocusLevel(l);
  renderFloorsActive();
}
function renderFloorsActive() {
  const f = scene.focusLevel;
  $$('#floors button').forEach((b) => b.classList.toggle('on', b.dataset.l === (f === null ? 'all' : String(f))));
}
$('#fitBtn').addEventListener('click', () => scene.frameAll(true));
$('#followBtn').addEventListener('click', (e) => {
  scene.follow = !scene.follow;
  e.currentTarget.classList.toggle('on', scene.follow);
  toast(scene.follow ? 'Camera follows the item' : 'Camera free');
});
$('#labelsBtn').addEventListener('click', (e) => {
  scene.hideDimLabels = !scene.hideDimLabels;
  e.currentTarget.classList.toggle('on', !scene.hideDimLabels);
  scene.dirty();
});
$('#labelsBtn').classList.add('on');
$('#snapBtn').addEventListener('click', () => {
  const url = scene.snapshot();
  const a = h('a', { href: url, download: `pivot-${state.item.type}.png` });
  document.body.append(a); a.click(); a.remove();
});
$('#editBtn').addEventListener('click', () => {
  if (window.matchMedia('(max-width: 900px)').matches) { $('#setup').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  $('#app').classList.remove('focus');
  if (window.innerWidth < 1360 && !$('#playbook').hidden) { $('#playbook').hidden = true; $('#stage').classList.remove('pb-open'); $('#pbReopen').hidden = false; }
  setTimeout(() => scene.resize(), 400);
});
$('#pbClose').addEventListener('click', () => { $('#playbook').hidden = true; $('#stage').classList.remove('pb-open'); $('#pbReopen').hidden = false; });
$('#pbReopen').addEventListener('click', () => { $('#playbook').hidden = false; $('#stage').classList.add('pb-open'); $('#pbReopen').hidden = true; });

// ---------------------------------------------------------------------------
// header controls

$$('#unitsSeg button').forEach((b) => b.addEventListener('click', () => {
  state.units = b.dataset.u;
  store.set(K.units, state.units);
  $$('#unitsSeg button').forEach((x) => x.classList.toggle('on', x === b));
  renderItem();
  renderRoute();
  if (result && result.ok) showSuccessTextOnly();
}));
function showSuccessTextOnly() {
  const gap = result.clearance.min;
  const pinchZone = result.clearance.pinch ? result.world.zones[result.clearance.pinch.zone]?.label : '';
  $('#vSub').innerHTML = `Tightest squeeze: <b>${fmtGap(gap)}</b>${pinchZone ? ` at ${esc(theZone(pinchZone))}` : ''} · ${result.pb.steps.length} steps`;
}
$$('#marginSeg button').forEach((b) => b.addEventListener('click', () => {
  state.margin = Number(b.dataset.m);
  $$('#marginSeg button').forEach((x) => x.classList.toggle('on', x === b));
  changed();
}));
$('#themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  store.set(K.theme, dark ? 'dark' : 'light');
  applyTheme();
});
const helpDlg = $('#helpDlg');
$('#helpBtn').addEventListener('click', () => helpDlg.showModal());
$('#helpClose').addEventListener('click', () => helpDlg.close());
helpDlg.addEventListener('click', (e) => { if (e.target === helpDlg) helpDlg.close(); });

$('#shareBtn').addEventListener('click', async () => {
  persist();
  try { await navigator.clipboard.writeText(location.href); toast('Link copied — it opens this exact item and route'); }
  catch { toast('Copy the address bar to share'); }
});

$('#printBtn').addEventListener('click', () => {
  if (!result) return;
  const img = scene.snapshot('image/jpeg');
  const r = result;
  const sheet = $('#printSheet');
  const itemRows = itemType(state.item.type).fields.map(([k, label]) => h('li', {}, `${label}: ${fmtIn(state.item.params[k])}`));
  const titles = stepTitles();
  const routeRows = state.route.map((s, i) => h('li', {}, `${titles[i]}${s.t === 'door' ? ` — ${fmtIn(s.w)} wide, ${fmtIn(s.h)} high` : s.t === 'hall' ? ` — ${fmtIn(s.w)} wide` : s.t === 'stairs' ? ` — ${fmtIn(s.w)} wide, ${s.n} steps, ${fmtIn(s.head)} headroom` : s.t === 'lift' ? ` — car ${fmtIn(s.cw)} × ${fmtIn(s.cd)} × ${fmtIn(s.ch)}, door ${fmtIn(s.dw)} × ${fmtIn(s.dh)}` : s.t === 'room' ? ` — ${fmtIn(s.w)} × ${fmtIn(s.l)}` : ''}`));
  sheet.replaceChildren(
    h('div', { class: 'ps-head' }, h('div', {}, h('div', { class: 'ps-brand' }, 'PIVOT · MOVER’S SHEET'), h('h1', {}, `${r.item.label}: ${r.ok ? 'it fits' : 'no way found'}`)), h('div', { class: 'ps-brand' }, new Date().toLocaleDateString())),
    h('p', { class: 'ps-verdict' }, r.ok ? `Tightest gap ${fmtGap(r.clearance.min)}. ${r.pb.steps.length} steps.` : 'Pivot could not find a way. See the fixes it tested in the app.'),
    h('img', { class: 'ps-img', src: img, alt: '' }),
    h('div', { class: 'ps-cols' },
      h('div', { class: 'ps-box' }, h('h3', {}, 'The item'), h('ul', {}, ...itemRows)),
      h('div', { class: 'ps-box' }, h('h3', {}, 'The way in'), h('ul', {}, ...routeRows))),
    r.ok ? h('div', { class: 'ps-box', style: 'margin-top:12px' }, h('h3', {}, 'Step by step'), h('ol', { class: 'ps-steps' }, ...r.pb.steps.map((s) => h('li', {}, h('b', {}, s.title), ' — ', s.detail, s.gap !== null && s.gap < 3 ? h('span', { class: 'ps-gap' }, `  (${fmtGap(s.gap)} spare)`) : null)))) : null,
    h('p', { class: 'ps-foot' }, `Made with Pivot — ${location.href.split('#')[0]}. A simulation from your measurements: measure twice, and allow for skirting boards, handrails and door stops.`));
  setTimeout(() => window.print(), 60);
});

// keyboard
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === ' ' && playback) { e.preventDefault(); playback.playing ? pause() : play(); }
  else if (e.key === 'ArrowRight' && playback) { const s = Math.min(result.pb.steps.length - 1, playback.step + 1); seekStep(s); }
  else if (e.key === 'ArrowLeft' && playback) { const s = Math.max(0, playback.step - (playback.t > playback.times[result.pb.steps[playback.step].i0] + 0.3 ? 0 : 1)); seekStep(s); }
  else if (e.key === 'f' || e.key === 'F') $('#followBtn').click();
  else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) check();
});

// ---------------------------------------------------------------------------
// misc

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}
function track() { /* no analytics — everything stays in the browser */ }

// debug hooks for headless verification
window.__pivot = {
  state, get world() { return world; }, get item() { return item; }, get result() { return result; }, get playback() { return playback; },
  scene, check, seek, play, pause, loadExample, EXAMPLES,
};

// ---------------------------------------------------------------------------
// boot

function boot() {
  applyTheme();
  $$('#unitsSeg button').forEach((b) => b.classList.toggle('on', b.dataset.u === state.units));
  renderExamples();
  renderAddMenu();
  const m = location.hash.match(/p=([A-Za-z0-9_-]+)/);
  const fromHash = m ? decodeState(m[1]) : null;
  const ex = location.hash.match(/ex=([a-z-]+)/);
  if (fromHash) {
    loadSnap(fromHash);
    renderItem();
    renderRoute();
    rebuild({ reframe: true });
    setTimeout(check, 500);
  } else if (ex) {
    loadExample(ex[1], true);
  } else {
    const last = store.get(K.last, null);
    if (last && store.get(K.seen, false)) {
      loadSnap(last);
      renderItem();
      renderRoute();
      rebuild({ reframe: true });
    } else {
      store.set(K.seen, true);
      loadExample(DEFAULT_EXAMPLE, true);
    }
  }
}
boot();
