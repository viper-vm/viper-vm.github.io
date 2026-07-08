/* WordGen options page. Settings live in chrome.storage.sync so they roam with
 * the user's Google account; the API key can be opted out into
 * chrome.storage.local. Provider test calls go through the background worker
 * like every other provider call. */

import { createHistory } from '../core/history.js';

const SETTINGS_KEY = 'wordgen.settings.v2';
const LOCAL_APIKEY_KEY = 'wordgen.apiKey.v2';
const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const DEFAULTS = {
  provider: 'local',
  apiKey: '',
  model: '',
  endpoint: '',
  headers: {},
  theme: 'paper',
  bubbleEnabled: true,
  defaultTone: '',
  syncKey: true,
};

const $ = (id) => document.getElementById(id);
const els = {
  provider: $('provider'),
  provLocal: $('provLocal'),
  provKey: $('provKey'),
  provAnthropic: $('provAnthropic'),
  provOpenai: $('provOpenai'),
  provCustom: $('provCustom'),
  apiKey: $('apiKey'),
  apiKeyLabel: $('apiKeyLabel'),
  keyHint: $('keyHint'),
  revealKey: $('revealKey'),
  modelSelect: $('modelSelect'),
  modelText: $('modelText'),
  endpointOpenai: $('endpointOpenai'),
  endpointCustom: $('endpointCustom'),
  headers: $('headers'),
  keySyncRow: $('keySyncRow'),
  syncKey: $('syncKey'),
  bubbleEnabled: $('bubbleEnabled'),
  testBtn: $('testBtn'),
  testStatus: $('testStatus'),
  histCount: $('histCount'),
  histStatus: $('histStatus'),
  clearHist: $('clearHist'),
  saveBtn: $('saveBtn'),
  saveStatus: $('saveStatus'),
};

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

let loaded = { ...DEFAULTS };
let chosenTheme = 'paper';
let saveStatusTimer = 0;

// ------------------------------------------------------------------ load

async function loadSettings() {
  const synced = await chrome.storage.sync.get(SETTINGS_KEY);
  loaded = { ...DEFAULTS, ...(synced[SETTINGS_KEY] || {}) };
  if (loaded.syncKey === false) {
    const local = await chrome.storage.local.get(LOCAL_APIKEY_KEY);
    loaded.apiKey = local[LOCAL_APIKEY_KEY] || '';
  }

  els.provider.value = loaded.provider || 'local';
  els.apiKey.value = loaded.apiKey || '';
  if (loaded.provider === 'anthropic' && loaded.model) els.modelSelect.value = loaded.model;
  if (loaded.provider === 'openai') els.modelText.value = loaded.model || '';
  els.endpointOpenai.value = loaded.provider === 'openai' ? loaded.endpoint || '' : '';
  els.endpointCustom.value = loaded.provider === 'custom' ? loaded.endpoint || '' : '';
  els.headers.value =
    loaded.headers && Object.keys(loaded.headers).length
      ? JSON.stringify(loaded.headers, null, 2)
      : '';
  els.syncKey.checked = loaded.syncKey !== false;
  els.bubbleEnabled.checked = loaded.bubbleEnabled !== false;

  applyTheme(loaded.theme || 'paper');
  refreshProviderUI();
}

function applyTheme(theme) {
  chosenTheme = ['paper', 'ink', 'mist'].includes(theme) ? theme : 'paper';
  document.documentElement.setAttribute('data-theme', chosenTheme);
  document.querySelectorAll('[data-theme-pick]').forEach((btn) => {
    btn.setAttribute('aria-pressed', btn.dataset.themePick === chosenTheme ? 'true' : 'false');
  });
}

function refreshProviderUI() {
  const p = els.provider.value;
  els.provLocal.hidden = p !== 'local';
  els.provKey.hidden = p !== 'anthropic' && p !== 'openai';
  els.provAnthropic.hidden = p !== 'anthropic';
  els.provOpenai.hidden = p !== 'openai';
  els.provCustom.hidden = p !== 'custom';
  els.keySyncRow.hidden = p !== 'anthropic' && p !== 'openai';
  if (p === 'anthropic') {
    els.apiKeyLabel.textContent = 'Anthropic API key';
    els.apiKey.placeholder = 'sk-ant-…';
    els.keyHint.textContent =
      'Create a key at console.anthropic.com (Settings → API keys). Usage is billed to your Anthropic account.';
  } else if (p === 'openai') {
    els.apiKeyLabel.textContent = 'API key';
    els.apiKey.placeholder = 'sk-…';
    els.keyHint.textContent =
      'The key for OpenAI, or for whichever compatible service the endpoint below points at.';
  }
}

// ------------------------------------------------------------------ gather + save

function gatherConfig() {
  const p = els.provider.value;
  const cfg = {
    provider: p,
    apiKey: p === 'anthropic' || p === 'openai' ? els.apiKey.value.trim() : '',
    model: '',
    endpoint: '',
    headers: {},
  };
  if (p === 'anthropic') cfg.model = els.modelSelect.value;
  if (p === 'openai') {
    cfg.model = els.modelText.value.trim() || 'gpt-4o-mini';
    cfg.endpoint = els.endpointOpenai.value.trim();
  }
  if (p === 'custom') {
    cfg.endpoint = els.endpointCustom.value.trim();
    const raw = els.headers.value.trim();
    if (raw) {
      const parsed = JSON.parse(raw); // caller catches and reports
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Headers must be a JSON object, e.g. {"Authorization": "Bearer …"}.');
      }
      cfg.headers = parsed;
    }
  }
  return cfg;
}

function endpointNeedingPermission(cfg) {
  if (cfg.provider === 'custom' && cfg.endpoint) return cfg.endpoint;
  if (cfg.provider === 'openai' && cfg.endpoint && cfg.endpoint !== DEFAULT_OPENAI_ENDPOINT) {
    return cfg.endpoint;
  }
  return null;
}

async function requestEndpointPermission(endpoint) {
  const url = new URL(endpoint); // caller catches invalid URLs
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The endpoint must be an http(s) URL.');
  }
  try {
    return await chrome.permissions.request({ origins: [url.origin + '/*'] });
  } catch (err) {
    console.error('WordGen: permission request failed', err);
    return false;
  }
}

function setStatus(el, text, kind) {
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

async function save() {
  let cfg;
  try {
    cfg = gatherConfig();
  } catch (err) {
    setStatus(els.saveStatus, (err && err.message) || 'Invalid settings.', 'err');
    return;
  }
  if (cfg.provider === 'custom' && !cfg.endpoint) {
    setStatus(els.saveStatus, 'The custom provider needs an endpoint URL.', 'err');
    return;
  }

  let permissionNote = '';
  const endpoint = endpointNeedingPermission(cfg);
  if (endpoint) {
    let granted = false;
    try {
      granted = await requestEndpointPermission(endpoint);
    } catch (err) {
      setStatus(els.saveStatus, (err && err.message) || 'Invalid endpoint URL.', 'err');
      return;
    }
    if (!granted) {
      permissionNote = ' Heads-up: host permission was declined, so requests to this endpoint will fail until you grant it.';
    }
  }

  const syncKey = els.keySyncRow.hidden ? true : els.syncKey.checked;
  const settings = {
    provider: cfg.provider,
    apiKey: syncKey ? cfg.apiKey : '',
    model: cfg.model,
    endpoint: cfg.endpoint,
    headers: cfg.headers,
    theme: chosenTheme,
    bubbleEnabled: els.bubbleEnabled.checked,
    defaultTone: loaded.defaultTone || '',
    syncKey,
  };

  try {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
    if (syncKey) {
      await chrome.storage.local.remove(LOCAL_APIKEY_KEY);
    } else {
      await chrome.storage.local.set({ [LOCAL_APIKEY_KEY]: cfg.apiKey });
    }
    loaded = { ...settings, apiKey: cfg.apiKey };
    setStatus(els.saveStatus, 'Saved.' + permissionNote, permissionNote ? 'err' : 'ok');
    clearTimeout(saveStatusTimer);
    if (!permissionNote) {
      saveStatusTimer = setTimeout(() => setStatus(els.saveStatus, '', ''), 2500);
    }
  } catch (err) {
    setStatus(els.saveStatus, 'Could not save: ' + ((err && err.message) || err), 'err');
  }
}

// ------------------------------------------------------------------ test connection

async function testConnection() {
  let cfg;
  try {
    cfg = gatherConfig();
  } catch (err) {
    setStatus(els.testStatus, (err && err.message) || 'Invalid settings.', 'err');
    return;
  }
  els.testBtn.disabled = true;
  setStatus(els.testStatus, 'Testing…', '');
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'wordgen:run',
      payload: { kind: 'test', providerConfig: cfg },
    });
    if (res && res.ok && res.result && res.result.ok) {
      setStatus(els.testStatus, 'Connected — the provider answered.', 'ok');
    } else {
      const reason =
        (res && res.result && res.result.error) || (res && res.error) || 'No response.';
      setStatus(els.testStatus, reason, 'err');
    }
  } catch (err) {
    setStatus(els.testStatus, (err && err.message) || String(err), 'err');
  } finally {
    els.testBtn.disabled = false;
  }
}

// ------------------------------------------------------------------ history

async function refreshHistoryCount() {
  try {
    const entries = await history.list(100);
    els.histCount.textContent = String(entries.length);
  } catch (err) {
    console.error('WordGen: history read failed', err);
    els.histCount.textContent = '0';
  }
}

async function clearHistory() {
  if (!window.confirm('Delete all saved WordGen history on this device?')) return;
  try {
    await history.clear();
    await refreshHistoryCount();
    setStatus(els.histStatus, 'History cleared.', 'ok');
    setTimeout(() => setStatus(els.histStatus, '', ''), 2500);
  } catch (err) {
    setStatus(els.histStatus, 'Could not clear: ' + ((err && err.message) || err), 'err');
  }
}

// ------------------------------------------------------------------ wiring

els.provider.addEventListener('change', refreshProviderUI);
els.revealKey.addEventListener('click', () => {
  const showing = els.apiKey.type === 'text';
  els.apiKey.type = showing ? 'password' : 'text';
  els.revealKey.textContent = showing ? 'Show' : 'Hide';
});
document.querySelectorAll('[data-theme-pick]').forEach((btn) => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.themePick));
});
els.testBtn.addEventListener('click', testConnection);
els.saveBtn.addEventListener('click', save);
els.clearHist.addEventListener('click', clearHistory);

loadSettings();
refreshHistoryCount();
