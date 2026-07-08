/* WordGen standalone note — fallback window for pages where content scripts
 * cannot run (chrome://, the Web Store, the PDF viewer…). Same UI contract as
 * the in-page sticky note. All provider calls still go through the background
 * worker, so this page never touches API keys or provider endpoints directly. */

import { MODES, MODE_CATEGORIES, getMode } from '../core/modes.js';
import { createHistory } from '../core/history.js';

const SETTINGS_KEY = 'wordgen.settings.v2';

const els = {
  input: document.getElementById('input'),
  chips: document.getElementById('chips'),
  instruction: document.getElementById('instruction'),
  run: document.getElementById('run'),
  results: document.getElementById('results'),
  viewMain: document.getElementById('viewMain'),
  viewSyn: document.getElementById('viewSyn'),
  synBack: document.getElementById('synBack'),
  synTitle: document.getElementById('synTitle'),
  synList: document.getElementById('synList'),
  viewHist: document.getElementById('viewHist'),
  histList: document.getElementById('histList'),
  historyBtn: document.getElementById('historyBtn'),
  optionsBtn: document.getElementById('optionsBtn'),
  engine: document.getElementById('engine'),
  ms: document.getElementById('ms'),
  toast: document.getElementById('toast'),
};

let settings = { provider: 'local', theme: 'paper' };
let selectedModeId = null;
let runToken = 0;
let toastTimer = 0;

const chromeLocalAdapter = {
  async get(key) {
    const obj = await chrome.storage.local.get(key);
    return obj[key];
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
};

const history = createHistory(chromeLocalAdapter);

// ------------------------------------------------------------------ helpers

function isSingleWord(text) {
  const t = (text || '').trim();
  return t.length > 0 && t.length <= 24 && !/\s/.test(t);
}

async function sendRun(payload) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'wordgen:run', payload });
    return res || { ok: false, error: 'No response from WordGen.' };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 1800);
}

function relativeTime(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

function engineLabel() {
  const p = settings.provider || 'local';
  if (p === 'local') return 'Local engine';
  if (p === 'custom') return 'Custom endpoint';
  return settings.model || p;
}

// ------------------------------------------------------------------ settings + theme

function applySettings(next) {
  settings = Object.assign({ provider: 'local', theme: 'paper' }, next || {});
  document.documentElement.setAttribute('data-theme', settings.theme || 'paper');
  els.engine.textContent = engineLabel();
}

async function loadSettings() {
  try {
    const obj = await chrome.storage.sync.get(SETTINGS_KEY);
    applySettings(obj[SETTINGS_KEY]);
  } catch {
    applySettings(null);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes[SETTINGS_KEY]) applySettings(changes[SETTINGS_KEY].newValue);
});

// ------------------------------------------------------------------ views

function showView(name) {
  els.viewMain.hidden = name !== 'main';
  els.viewSyn.hidden = name !== 'syn';
  els.viewHist.hidden = name !== 'hist';
  els.historyBtn.setAttribute('aria-pressed', name === 'hist' ? 'true' : 'false');
}

function autogrow() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight + 2, Math.round(window.innerHeight * 0.32)) + 'px';
}

function updateRunState() {
  const hasText = els.input.value.trim().length > 0;
  const hasWay = !!selectedModeId || els.instruction.value.trim().length > 0;
  els.run.disabled = !(hasText && hasWay);
}

// ------------------------------------------------------------------ mode chips

function buildChips() {
  els.chips.textContent = '';
  let firstGroup = true;
  for (const cat of MODE_CATEGORIES) {
    const modes = MODES.filter((m) => m.category === cat.id && m.id !== 'custom');
    if (!modes.length) continue;
    if (!firstGroup) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      els.chips.appendChild(sep);
    }
    firstGroup = false;
    const label = document.createElement('span');
    label.className = 'group';
    label.textContent = cat.label;
    els.chips.appendChild(label);
    for (const mode of modes) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.mode = mode.id;
      chip.title = mode.hint || mode.label;
      chip.setAttribute('aria-pressed', 'false');
      const em = document.createElement('span');
      em.textContent = mode.emoji || '';
      const lb = document.createElement('span');
      lb.textContent = mode.label;
      chip.append(em, lb);
      chip.addEventListener('click', () => selectMode(mode.id));
      els.chips.appendChild(chip);
    }
  }
}

function selectMode(id) {
  selectedModeId = selectedModeId === id ? null : id;
  els.chips.querySelectorAll('.chip').forEach((c) => {
    c.setAttribute('aria-pressed', c.dataset.mode === selectedModeId ? 'true' : 'false');
  });
  updateRunState();
}

// ------------------------------------------------------------------ transform flow

async function runSelected() {
  const text = els.input.value.trim();
  const instruction = els.instruction.value.trim();
  let modeId = selectedModeId;
  if (!modeId && instruction) modeId = 'custom';
  if (!text || !modeId) return;

  if (modeId === 'synonyms') {
    if (!isSingleWord(text)) {
      renderError('Synonyms works on a single word — type just one word.');
      return;
    }
    openSynonyms(text);
    return;
  }

  const token = ++runToken;
  renderSkeleton();
  els.run.disabled = true;
  const res = await sendRun({
    kind: 'transform',
    modeId,
    text,
    opts: instruction ? { instruction } : {},
  });
  if (token !== runToken) return;
  updateRunState();
  if (!res.ok) {
    renderError(res.error || 'Something went wrong.');
    return;
  }
  renderResults(res.result, res.meta);
}

function renderSkeleton() {
  els.results.textContent = '';
  for (let i = 0; i < 2; i++) {
    const sk = document.createElement('div');
    sk.className = 'skel';
    els.results.appendChild(sk);
  }
}

function renderError(message) {
  els.results.textContent = '';
  const err = document.createElement('p');
  err.className = 'error';
  err.textContent = message;
  els.results.appendChild(err);
}

function renderResults(result, meta) {
  els.results.textContent = '';
  if (result && result.limited) {
    const banner = document.createElement('div');
    banner.className = 'banner';
    const span = document.createElement('span');
    span.textContent = 'This mode needs an AI provider — the free local engine did what it could.';
    const btn = document.createElement('button');
    btn.className = 'abtn';
    btn.textContent = 'Open Settings';
    btn.addEventListener('click', () => chrome.runtime.openOptionsPage());
    banner.append(span, btn);
    els.results.appendChild(banner);
  }
  const options = (result && result.options) || [];
  if (!options.length) {
    renderError('No options came back — try again or tweak the instruction.');
    return;
  }
  for (const opt of options) {
    const card = document.createElement('div');
    card.className = 'opt';
    const textEl = document.createElement('div');
    textEl.className = 'opt-text';
    textEl.textContent = opt.text || '';
    card.appendChild(textEl);
    if (opt.note) {
      const noteRow = document.createElement('div');
      noteRow.className = 'opt-note';
      noteRow.textContent = opt.note;
      card.appendChild(noteRow);
    }
    const actions = document.createElement('div');
    actions.className = 'opt-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'abtn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => toast((await copyText(opt.text || '')) ? 'Copied' : 'Copy failed'));
    const useBtn = document.createElement('button');
    useBtn.className = 'abtn';
    useBtn.textContent = 'Use as input';
    useBtn.addEventListener('click', () => {
      els.input.value = opt.text || '';
      autogrow();
      updateRunState();
      els.input.focus();
      toast('Moved to the editor');
    });
    actions.append(copyBtn, useBtn);
    card.appendChild(actions);
    els.results.appendChild(card);
  }
  if (meta) {
    els.engine.textContent = meta.engine || engineLabel();
    els.ms.textContent = typeof meta.ms === 'number' ? meta.ms + ' ms' : '';
  }
}

// ------------------------------------------------------------------ synonyms flow

async function openSynonyms(word) {
  showView('syn');
  els.synTitle.textContent = 'Synonyms for “' + word + '”';
  els.synList.textContent = '';
  for (let i = 0; i < 5; i++) {
    const sk = document.createElement('div');
    sk.className = 'skel';
    sk.style.cssText = 'width:86px;height:30px;border-radius:999px;';
    els.synList.appendChild(sk);
  }
  const token = ++runToken;
  const res = await sendRun({ kind: 'synonyms', word, context: '', opts: {} });
  if (token !== runToken || els.viewSyn.hidden) return;
  els.synList.textContent = '';
  if (!res.ok) {
    const err = document.createElement('p');
    err.className = 'error';
    err.textContent = res.error || 'Could not fetch synonyms.';
    els.synList.appendChild(err);
    return;
  }
  const candidates = (res.result && res.result.candidates) || [];
  if (!candidates.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No good synonyms found for that word.';
    els.synList.appendChild(empty);
    return;
  }
  for (const cand of candidates) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'syn-word';
    if (cand.note) chip.title = cand.note;
    const w = document.createElement('span');
    w.textContent = cand.word || '';
    chip.appendChild(w);
    if (cand.register) {
      const reg = document.createElement('span');
      reg.className = 'syn-reg';
      reg.textContent = cand.register;
      chip.appendChild(reg);
    }
    chip.addEventListener('click', async () => {
      if (els.input.value.trim() === word) {
        els.input.value = cand.word || '';
        showView('main');
        updateRunState();
        toast('Replaced');
      } else {
        toast((await copyText(cand.word || '')) ? 'Copied' : 'Copy failed');
      }
    });
    els.synList.appendChild(chip);
  }
  if (res.meta) {
    els.engine.textContent = res.meta.engine || engineLabel();
    els.ms.textContent = typeof res.meta.ms === 'number' ? res.meta.ms + ' ms' : '';
  }
}

// ------------------------------------------------------------------ history view

async function openHistory() {
  showView('hist');
  els.histList.textContent = '';
  const loading = document.createElement('div');
  loading.className = 'empty';
  loading.textContent = 'Loading…';
  els.histList.appendChild(loading);
  let entries = [];
  try {
    entries = await history.list(20);
  } catch (err) {
    console.error('WordGen: history load failed', err);
  }
  if (els.viewHist.hidden) return;
  els.histList.textContent = '';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nothing here yet — transform something first.';
    els.histList.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'hist-row';
    const mode = getMode(entry.mode);
    const emoji = document.createElement('span');
    emoji.textContent = (mode && mode.emoji) || '✏️';
    const snippet = document.createElement('span');
    snippet.className = 'hist-snippet';
    snippet.textContent = (entry.input || '').slice(0, 60);
    const time = document.createElement('span');
    time.className = 'hist-time';
    time.textContent = relativeTime(entry.ts || 0);
    row.append(emoji, snippet, time);
    row.addEventListener('click', () => {
      els.input.value = entry.input || '';
      showView('main');
      autogrow();
      updateRunState();
      renderResults({ options: entry.outputs || [] }, null);
    });
    els.histList.appendChild(row);
  }
}

// ------------------------------------------------------------------ wiring

els.input.addEventListener('input', () => {
  autogrow();
  updateRunState();
});
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !els.run.disabled) runSelected();
});
els.instruction.addEventListener('input', updateRunState);
els.instruction.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !els.run.disabled) runSelected();
});
els.run.addEventListener('click', runSelected);
els.synBack.addEventListener('click', () => showView('main'));
els.historyBtn.addEventListener('click', () => {
  if (els.viewHist.hidden) openHistory();
  else showView('main');
});
els.optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (!els.viewSyn.hidden || !els.viewHist.hidden)) showView('main');
});

// The background prefills text via the URL hash when opening this window
// from a context-menu click on a restricted page.
if (location.hash.startsWith('#text=')) {
  try {
    els.input.value = decodeURIComponent(location.hash.slice('#text='.length));
  } catch { /* malformed hash — leave the editor empty */ }
}

buildChips();
loadSettings();
autogrow();
updateRunState();
els.input.focus();
