// js/main.js — web app orchestration for WordGen 2.0.

import { MODES, MODE_CATEGORIES, getMode } from '../core/modes.js';
import { runTransform, runSynonyms, testProvider, PROVIDERS, DEFAULT_OPENAI_ENDPOINT } from '../core/providers.js';
import { initLocalEngine } from '../core/local-engine.js';
import { createHistory, webStorage } from '../core/history.js';
import { qs, qsa, el, escapeHtml, toast, relativeTime, wordDiff, caretCoordinates, autoGrow } from './ui.js';

const SETTINGS_KEY = 'wordgen.settings.v2';
const CALLOUT_SEEN_KEY = 'wordgen.calloutSeen.v2';

initLocalEngine('./assets/');
const history = createHistory(webStorage);

let settings = loadSettings();
let selectedModeId = null;
const recentModes = ['paraphrase', 'grammar', 'shorter', 'email', 'synonyms'];

const dom = {};

// ------------------------------------------------------------------ boot

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  applyTheme(settings.theme);
  renderModePicker();
  wireEditor();
  wireModes();
  wireTransform();
  wireThemeDots();
  wireHistory();
  wireSettings();
  wirePopover();
  updateCounts();
  updateTransformEnabled();
});

function cacheDom() {
  [
    'editor', 'sampleBtn', 'clearBtn', 'counts', 'modePicker', 'instruction', 'transformBtn',
    'localCallout', 'calloutSettings', 'calloutDismiss', 'results', 'popover',
    'historyBtn', 'drawerBackdrop', 'historyDrawer', 'historyClose', 'historySearch', 'historyClear', 'historyList',
    'settingsBtn', 'settingsOverlay', 'settingsClose', 'settingsCancel', 'settingsSave',
    'setProvider', 'rowKey', 'setApiKey', 'keyToggle', 'rowModelSelect', 'setModelSelect',
    'rowModelText', 'setModelText', 'rowEndpoint', 'setEndpoint', 'rowHeaders', 'setHeaders',
    'testBtn', 'testStatus', 'providerHint',
  ].forEach((id) => { dom[id] = qs(`#${id}`); });
}

// ------------------------------------------------------------------ settings

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch { saved = {}; }
  return Object.assign(
    { provider: 'local', apiKey: '', model: '', endpoint: '', headers: {}, theme: 'paper', bubbleEnabled: true, defaultTone: '' },
    saved,
  );
}

function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function providerConfig() {
  return {
    provider: settings.provider,
    apiKey: settings.apiKey,
    model: settings.model,
    endpoint: settings.endpoint,
    headers: settings.headers,
  };
}

function engineLabel() {
  if (settings.provider === 'local') return 'Local engine';
  if (settings.provider === 'anthropic') return settings.model || 'claude-opus-4-8';
  if (settings.provider === 'openai') return settings.model || 'gpt-4o-mini';
  return 'Custom endpoint';
}

// ------------------------------------------------------------------ themes

function applyTheme(theme) {
  const t = ['paper', 'ink', 'mist'].includes(theme) ? theme : 'paper';
  document.documentElement.setAttribute('data-theme', t);
  qsa('.theme-dot').forEach((dot) => {
    dot.setAttribute('aria-pressed', String(dot.dataset.themePick === t));
  });
}

function wireThemeDots() {
  qsa('.theme-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      settings.theme = dot.dataset.themePick;
      persistSettings();
      applyTheme(settings.theme);
    });
  });
}

// ------------------------------------------------------------------ editor

function wireEditor() {
  dom.editor.addEventListener('input', () => {
    updateCounts();
    updateTransformEnabled();
    autoGrow(dom.editor);
    hidePopover();
  });
  dom.instruction.addEventListener('input', updateTransformEnabled);
  dom.instruction.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doTransform(); }
  });
  dom.clearBtn.addEventListener('click', () => {
    dom.editor.value = '';
    updateCounts();
    updateTransformEnabled();
    autoGrow(dom.editor);
    dom.editor.focus();
  });
  dom.sampleBtn.addEventListener('click', loadSample);

  // Selection popover from the textarea.
  dom.editor.addEventListener('mouseup', maybeShowPopover);
  dom.editor.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift') maybeShowPopover();
  });
}

function updateCounts() {
  const text = dom.editor.value;
  const words = (text.trim().match(/\S+/g) || []).length;
  dom.counts.textContent = `${words} word${words === 1 ? '' : 's'} · ${text.length} character${text.length === 1 ? '' : 's'}`;
}

function updateTransformEnabled() {
  const hasText = dom.editor.value.trim().length > 0;
  const hasIntent = !!selectedModeId || dom.instruction.value.trim().length > 0;
  dom.transformBtn.disabled = !(hasText && hasIntent);
}

async function loadSample() {
  try {
    const res = await fetch('./assets/demo-texts.json');
    const data = await res.json();
    const texts = (data && data.texts) || [];
    if (!texts.length) return;
    const pick = texts[Math.floor(Math.random() * texts.length)];
    dom.editor.value = pick.text || '';
    updateCounts();
    updateTransformEnabled();
    autoGrow(dom.editor);
  } catch {
    toast('Could not load a sample.');
  }
}

// ------------------------------------------------------------------ modes

function renderModePicker() {
  dom.modePicker.innerHTML = '';
  for (const cat of MODE_CATEGORIES) {
    const modes = MODES.filter((m) => m.category === cat.id && m.id !== 'custom' && m.id !== 'synonyms');
    if (!modes.length) continue;
    const group = el('div', { class: 'mode-group' });
    group.appendChild(el('p', { class: 'mode-group-label', text: cat.label }));
    const chips = el('div', { class: 'mode-chips' });
    for (const mode of modes) {
      chips.appendChild(modeChip(mode));
    }
    group.appendChild(chips);
    dom.modePicker.appendChild(group);
  }
}

function modeChip(mode) {
  return el('button', {
    type: 'button',
    class: 'mode-chip',
    'data-mode': mode.id,
    title: mode.hint,
    'aria-pressed': 'false',
  }, [
    el('span', { class: 'chip-emoji', text: mode.emoji, 'aria-hidden': 'true' }),
    el('span', { text: mode.label }),
  ]);
}

function wireModes() {
  dom.modePicker.addEventListener('click', (e) => {
    const chip = e.target.closest('.mode-chip');
    if (!chip) return;
    selectMode(chip.dataset.mode);
  });
}

function selectMode(id) {
  selectedModeId = selectedModeId === id ? null : id;
  qsa('.mode-chip', dom.modePicker).forEach((chip) => {
    chip.setAttribute('aria-pressed', String(chip.dataset.mode === selectedModeId));
  });
  if (selectedModeId) bumpRecent(selectedModeId);
  updateTransformEnabled();
}

function bumpRecent(id) {
  const idx = recentModes.indexOf(id);
  if (idx !== -1) recentModes.splice(idx, 1);
  recentModes.unshift(id);
  recentModes.length = Math.min(recentModes.length, 6);
}

// ------------------------------------------------------------------ transform

function wireTransform() {
  dom.transformBtn.addEventListener('click', () => doTransform());
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !dom.transformBtn.disabled) {
      e.preventDefault();
      doTransform();
    }
  });
}

async function doTransform() {
  const text = dom.editor.value.trim();
  const instruction = dom.instruction.value.trim();
  if (!text) return;

  const modeId = selectedModeId || (instruction ? 'custom' : null);
  if (!modeId) return;
  const mode = getMode(modeId);
  bumpRecent(modeId);

  showLoading();
  const started = performance.now();
  try {
    const result = await runTransform({ providerConfig: providerConfig(), mode, text, opts: { instruction } });
    const ms = Math.round(performance.now() - started);
    renderResults(result, mode, text, ms);
    history.add({
      mode: mode.id,
      instruction,
      input: text,
      outputs: result.options,
      source: 'web',
    });
    if (result.limited) maybeShowCallout();
  } catch (err) {
    renderError(err);
  }
}

function showLoading() {
  dom.results.innerHTML = '';
  dom.results.appendChild(el('div', { class: 'results-head' }, [
    el('h2', { class: 'results-title', text: 'Working…' }),
  ]));
  for (let i = 0; i < 2; i++) dom.results.appendChild(el('div', { class: 'skeleton' }));
  dom.results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderResults(result, mode, inputText, ms) {
  dom.results.innerHTML = '';
  const isRewrite = mode.category === 'rewrite' && mode.id !== 'custom';

  const head = el('div', { class: 'results-head' }, [
    el('h2', { class: 'results-title', text: `${mode.emoji} ${mode.label}` }),
    el('span', { class: 'result-meta' }, [
      el('span', { class: 'engine-badge', text: engineLabel() }),
      el('span', { text: `${ms} ms` }),
    ]),
  ]);
  dom.results.appendChild(head);

  if (result.limited) {
    dom.results.appendChild(el('div', { class: 'callout' }, [
      el('p', { html: 'The <strong>local engine</strong> can’t do this mode well. Add an API key in Settings to unlock it.' }),
      el('div', { class: 'callout-actions' }, [
        el('button', { class: 'btn btn-small', type: 'button', onclick: openSettings, text: 'Open Settings' }),
      ]),
    ]));
  }

  result.options.forEach((opt) => {
    dom.results.appendChild(optionCard(opt, isRewrite, inputText));
  });
}

function optionCard(opt, isRewrite, inputText) {
  const card = el('div', { class: 'result-card' });
  const textNode = el('p', { class: 'result-text', text: opt.text });
  card.appendChild(textNode);
  if (opt.note) card.appendChild(el('p', { class: 'result-note', text: opt.note }));

  const actions = el('div', { class: 'result-actions' });
  actions.appendChild(el('button', {
    class: 'btn btn-mini', type: 'button', text: 'Copy',
    onclick: () => copyText(opt.text),
  }));
  actions.appendChild(el('button', {
    class: 'btn btn-mini', type: 'button', text: 'Replace',
    onclick: () => {
      dom.editor.value = opt.text;
      updateCounts();
      updateTransformEnabled();
      autoGrow(dom.editor);
      toast('Put into the editor');
    },
  }));
  if (isRewrite) {
    let diffOn = false;
    const diffBtn = el('button', { class: 'btn btn-mini', type: 'button', text: 'Show diff' });
    diffBtn.addEventListener('click', () => {
      diffOn = !diffOn;
      if (diffOn) {
        textNode.innerHTML = wordDiff(inputText, opt.text);
        diffBtn.textContent = 'Hide diff';
      } else {
        textNode.textContent = opt.text;
        diffBtn.textContent = 'Show diff';
      }
    });
    actions.appendChild(diffBtn);
  }
  card.appendChild(actions);
  return card;
}

function renderError(err) {
  dom.results.innerHTML = '';
  dom.results.appendChild(el('div', { class: 'result-error', text: err && err.message ? err.message : String(err) }));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    toast('Copy failed — select and copy manually.');
  }
}

// ------------------------------------------------------------------ callout

function maybeShowCallout() {
  if (localStorage.getItem(CALLOUT_SEEN_KEY)) return;
  dom.localCallout.hidden = false;
}

function wireSettings() {
  dom.calloutSettings.addEventListener('click', () => { dismissCallout(); openSettings(); });
  dom.calloutDismiss.addEventListener('click', dismissCallout);
  dom.settingsBtn.addEventListener('click', openSettings);
  dom.settingsClose.addEventListener('click', closeSettings);
  dom.settingsCancel.addEventListener('click', closeSettings);
  dom.settingsOverlay.addEventListener('click', (e) => { if (e.target === dom.settingsOverlay) closeSettings(); });
  dom.settingsSave.addEventListener('click', saveSettingsForm);
  dom.setProvider.addEventListener('change', updateSettingsRows);
  dom.testBtn.addEventListener('click', runTest);
  dom.keyToggle.addEventListener('click', () => {
    const showing = dom.setApiKey.type === 'text';
    dom.setApiKey.type = showing ? 'password' : 'text';
    dom.keyToggle.textContent = showing ? 'Show' : 'Hide';
    dom.keyToggle.setAttribute('aria-pressed', String(!showing));
  });
}

function dismissCallout() {
  dom.localCallout.hidden = true;
  localStorage.setItem(CALLOUT_SEEN_KEY, '1');
}

// ------------------------------------------------------------------ settings modal

function openSettings() {
  dom.setProvider.value = settings.provider;
  dom.setApiKey.value = settings.apiKey || '';
  dom.setModelSelect.value = PROVIDERS.anthropic.models.includes(settings.model) ? settings.model : 'claude-opus-4-8';
  dom.setModelText.value = settings.provider === 'openai' ? (settings.model || '') : '';
  dom.setEndpoint.value = settings.endpoint || '';
  dom.setHeaders.value = settings.headers && Object.keys(settings.headers).length
    ? JSON.stringify(settings.headers, null, 2)
    : '';
  dom.testStatus.textContent = '';
  dom.testStatus.className = 'test-status';
  updateSettingsRows();
  dom.settingsOverlay.hidden = false;
}

function closeSettings() {
  dom.settingsOverlay.hidden = true;
}

function updateSettingsRows() {
  const p = dom.setProvider.value;
  const hints = {
    local: 'Runs entirely in your browser. Great for synonyms and quick rewrites; no key needed.',
    anthropic: 'Best quality across every mode. Get a key at console.anthropic.com — it stays in your browser.',
    openai: 'Works with OpenAI, Groq, Ollama, Gemini (OpenAI-compatible), and more. Set the model and endpoint.',
    custom: 'POST JSON to your own endpoint. Expected: {options:[…]} or {candidates:[…]} back.',
  };
  dom.providerHint.textContent = hints[p] || '';
  dom.rowKey.hidden = p === 'local' || p === 'custom';
  dom.rowModelSelect.hidden = p !== 'anthropic';
  dom.rowModelText.hidden = p !== 'openai';
  dom.rowEndpoint.hidden = !(p === 'openai' || p === 'custom');
  dom.rowHeaders.hidden = p !== 'custom';
  if (p === 'openai' && !dom.setEndpoint.value) dom.setEndpoint.placeholder = DEFAULT_OPENAI_ENDPOINT;
}

function readSettingsForm() {
  const p = dom.setProvider.value;
  let headers = {};
  if (p === 'custom' && dom.setHeaders.value.trim()) {
    try { headers = JSON.parse(dom.setHeaders.value); } catch { throw new Error('Headers must be valid JSON.'); }
  }
  return {
    provider: p,
    apiKey: dom.setApiKey.value.trim(),
    model: p === 'anthropic' ? dom.setModelSelect.value : (p === 'openai' ? dom.setModelText.value.trim() : ''),
    endpoint: (p === 'openai' || p === 'custom') ? dom.setEndpoint.value.trim() : '',
    headers,
  };
}

function saveSettingsForm() {
  let form;
  try { form = readSettingsForm(); } catch (err) { setTestStatus(err.message, 'err'); return; }
  Object.assign(settings, form);
  persistSettings();
  closeSettings();
  toast('Settings saved');
}

async function runTest() {
  let form;
  try { form = readSettingsForm(); } catch (err) { setTestStatus(err.message, 'err'); return; }
  setTestStatus('Testing…', '');
  const res = await testProvider(form);
  if (res.ok) setTestStatus('Connected — the provider answered.', 'ok');
  else setTestStatus(res.error || 'No response.', 'err');
}

function setTestStatus(msg, kind) {
  dom.testStatus.textContent = msg;
  dom.testStatus.className = `test-status${kind ? ` ${kind}` : ''}`;
}

// ------------------------------------------------------------------ history drawer

function wireHistory() {
  dom.historyBtn.addEventListener('click', openHistory);
  dom.historyClose.addEventListener('click', closeHistory);
  dom.drawerBackdrop.addEventListener('click', closeHistory);
  dom.historySearch.addEventListener('input', () => renderHistory(dom.historySearch.value));
  dom.historyClear.addEventListener('click', async () => {
    if (!confirm('Clear all history? This cannot be undone.')) return;
    await history.clear();
    renderHistory('');
    toast('History cleared');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (dom.historyDrawer.classList.contains('open')) closeHistory();
      else if (!dom.settingsOverlay.hidden) closeSettings();
      else hidePopover();
    }
  });
}

function openHistory() {
  dom.drawerBackdrop.hidden = false;
  dom.historyDrawer.classList.add('open');
  renderHistory('');
}

function closeHistory() {
  dom.drawerBackdrop.hidden = true;
  dom.historyDrawer.classList.remove('open');
}

async function renderHistory(query) {
  const entries = query ? await history.search(query) : await history.list(100);
  dom.historyList.innerHTML = '';
  if (!entries.length) {
    dom.historyList.appendChild(el('p', { class: 'history-empty', text: query ? 'No matches.' : 'No history yet. Transform something!' }));
    return;
  }
  for (const entry of entries) {
    dom.historyList.appendChild(historyItem(entry));
  }
}

function historyItem(entry) {
  const mode = getMode(entry.mode);
  const item = el('div', { class: 'history-item' });
  const row = el('div', { class: 'hist-row' }, [
    el('span', { class: 'hist-emoji', text: mode ? mode.emoji : '✏️' }),
    el('span', { class: 'hist-text', text: entry.input.slice(0, 70) }),
    el('span', { class: 'hist-time', text: relativeTime(entry.ts) }),
  ]);
  item.appendChild(row);

  const outputs = el('div', { class: 'hist-outputs' });
  outputs.hidden = true;
  (entry.outputs || []).forEach((out) => {
    const o = el('div', { class: 'hist-output' }, [
      el('div', { text: out.text }),
      el('div', { class: 'hist-output-actions' }, [
        el('button', { class: 'btn btn-mini', type: 'button', text: 'Copy', onclick: (e) => { e.stopPropagation(); copyText(out.text); } }),
        el('button', {
          class: 'btn btn-mini', type: 'button', text: 'Restore',
          onclick: (e) => {
            e.stopPropagation();
            dom.editor.value = out.text;
            updateCounts();
            updateTransformEnabled();
            autoGrow(dom.editor);
            closeHistory();
            toast('Restored to editor');
          },
        }),
      ]),
    ]);
    outputs.appendChild(o);
  });
  item.appendChild(outputs);
  item.addEventListener('click', () => { outputs.hidden = !outputs.hidden; });
  return item;
}

// ------------------------------------------------------------------ selection popover

let popoverActive = false;

function wirePopover() {
  document.addEventListener('mousedown', (e) => {
    if (popoverActive && !dom.popover.contains(e.target) && e.target !== dom.editor) hidePopover();
  });
  window.addEventListener('scroll', hidePopover, { passive: true });
}

function maybeShowPopover() {
  const start = dom.editor.selectionStart;
  const end = dom.editor.selectionEnd;
  if (start === end) { hidePopover(); return; }
  const selected = dom.editor.value.slice(start, end).trim();
  if (!selected) { hidePopover(); return; }

  const coords = caretCoordinates(dom.editor, start);
  const singleWord = !/\s/.test(selected) && selected.length <= 24;
  buildPopover(selected, start, end, singleWord);
  positionPopover(coords);
}

function positionPopover(coords) {
  dom.popover.hidden = false;
  popoverActive = true;
  const width = dom.popover.offsetWidth;
  let left = coords.left;
  left = Math.max(10 + window.scrollX, Math.min(left, window.scrollX + window.innerWidth - width - 10));
  const top = coords.top - dom.popover.offsetHeight - 8;
  dom.popover.style.left = `${left}px`;
  dom.popover.style.top = `${top < window.scrollY ? coords.top + coords.lineHeight + 6 : top}px`;
}

function buildPopover(selected, start, end, singleWord) {
  dom.popover.innerHTML = '';
  if (singleWord) {
    buildSynonymActions(selected, start, end);
  } else {
    buildModeActions(selected, start, end);
  }
  dom.popover.hidden = false;
}

function buildSynonymActions(word, start, end) {
  const actions = el('div', { class: 'pop-actions' }, [
    el('button', {
      class: 'pop-chip', type: 'button',
      html: '📖 Synonyms', onclick: () => loadSynonyms(word, start, end),
    }),
    el('button', {
      class: 'pop-chip', type: 'button',
      html: '🔁 Rephrase', onclick: () => runSelectionMode('paraphrase', word, start, end),
    }),
  ]);
  dom.popover.appendChild(actions);
}

async function loadSynonyms(word, start, end) {
  dom.popover.innerHTML = '';
  dom.popover.appendChild(el('div', { class: 'pop-status', text: 'Finding synonyms…' }));
  const context = sentenceAround(start, end);
  try {
    const res = await runSynonyms({ providerConfig: providerConfig(), word, context });
    dom.popover.innerHTML = '';
    const list = el('div', { class: 'pop-list' });
    res.candidates.forEach((c) => {
      list.appendChild(el('button', {
        class: 'pop-cand', type: 'button', text: c.word,
        title: c.note || c.register,
        onclick: () => replaceRange(start, end, c.word, 'Replaced'),
      }));
    });
    dom.popover.appendChild(list);
  } catch (err) {
    dom.popover.innerHTML = '';
    dom.popover.appendChild(el('div', { class: 'pop-status', text: err.message }));
  }
}

function buildModeActions(selected, start, end) {
  const wrap = el('div', {});
  const chips = el('div', { class: 'pop-actions' });
  recentModes
    .map(getMode)
    .filter((m) => m && m.id !== 'synonyms')
    .slice(0, 5)
    .forEach((m) => {
      chips.appendChild(el('button', {
        class: 'pop-chip', type: 'button', title: m.hint,
        html: `${m.emoji} ${escapeHtml(m.label)}`,
        onclick: () => runSelectionMode(m.id, selected, start, end),
      }));
    });
  const moreBtn = el('button', { class: 'pop-chip', type: 'button', text: 'More ▾' });
  chips.appendChild(moreBtn);
  wrap.appendChild(chips);

  const grid = el('div', { class: 'pop-grid' });
  grid.hidden = true;
  MODES.filter((m) => m.id !== 'custom' && m.id !== 'synonyms').forEach((m) => {
    grid.appendChild(el('button', {
      class: 'pop-chip', type: 'button', title: m.hint,
      html: `${m.emoji} ${escapeHtml(m.label)}`,
      onclick: () => runSelectionMode(m.id, selected, start, end),
    }));
  });
  moreBtn.addEventListener('click', () => { grid.hidden = !grid.hidden; });
  wrap.appendChild(grid);

  const instr = el('input', { class: 'pop-input', type: 'text', placeholder: 'optional instruction, then pick a mode…' });
  wrap.appendChild(instr);
  dom.popover.__instr = instr;
  dom.popover.appendChild(wrap);
}

async function runSelectionMode(modeId, selected, start, end) {
  const mode = getMode(modeId);
  const instruction = dom.popover.__instr ? dom.popover.__instr.value.trim() : '';
  dom.popover.innerHTML = '';
  dom.popover.appendChild(el('div', { class: 'pop-status', text: `${mode.emoji} ${mode.label}…` }));
  bumpRecent(modeId);
  try {
    const res = await runTransform({ providerConfig: providerConfig(), mode, text: selected, opts: { instruction } });
    dom.popover.innerHTML = '';
    const list = el('div', { class: 'pop-list' });
    res.options.forEach((opt) => {
      list.appendChild(el('button', {
        class: 'pop-cand', type: 'button', text: opt.text.length > 60 ? `${opt.text.slice(0, 57)}…` : opt.text,
        title: opt.text,
        onclick: () => replaceRange(start, end, opt.text, 'Replaced selection'),
      }));
    });
    dom.popover.appendChild(list);
    if (res.limited) {
      dom.popover.appendChild(el('div', { class: 'pop-status', html: 'Local engine — <a href="#" id="popSettings">add a key</a> for this mode.' }));
      const link = qs('#popSettings', dom.popover);
      if (link) link.addEventListener('click', (e) => { e.preventDefault(); hidePopover(); openSettings(); });
    }
  } catch (err) {
    dom.popover.innerHTML = '';
    dom.popover.appendChild(el('div', { class: 'pop-status', text: err.message }));
  }
}

function replaceRange(start, end, replacement, msg) {
  const value = dom.editor.value;
  dom.editor.value = value.slice(0, start) + replacement + value.slice(end);
  updateCounts();
  updateTransformEnabled();
  autoGrow(dom.editor);
  hidePopover();
  toast(msg || 'Replaced');
  dom.editor.focus();
  const caret = start + replacement.length;
  dom.editor.setSelectionRange(caret, caret);
}

function sentenceAround(start, end) {
  const text = dom.editor.value;
  let s = start;
  let e = end;
  while (s > 0 && !'.!?\n'.includes(text[s - 1])) s--;
  while (e < text.length && !'.!?\n'.includes(text[e])) e++;
  return text.slice(s, e + 1).trim();
}

function hidePopover() {
  if (!dom.popover) return;
  dom.popover.hidden = true;
  dom.popover.__instr = null;
  popoverActive = false;
}
