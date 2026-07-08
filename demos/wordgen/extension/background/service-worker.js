// WordGen background service worker (MV3, module).
// Owns ALL provider network calls: content scripts and extension pages send
// {type:'wordgen:run'} messages here, so API keys never enter page contexts and
// page CSP/CORS never interferes (host_permissions apply to the worker's fetch).

import { getMode } from '../core/modes.js';
import { runTransform, runSynonyms, testProvider } from '../core/providers.js';
import { initLocalEngine } from '../core/local-engine.js';
import { createHistory } from '../core/history.js';

const SETTINGS_KEY = 'wordgen.settings.v2';
const LOCAL_APIKEY_KEY = 'wordgen.apiKey.v2';

initLocalEngine(chrome.runtime.getURL('assets/'));

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

// ---------------------------------------------------------------- settings

async function loadSettings() {
  const synced = await chrome.storage.sync.get(SETTINGS_KEY);
  const settings = Object.assign(
    { provider: 'local', apiKey: '', model: '', endpoint: '', headers: {}, theme: 'paper', bubbleEnabled: true, syncKey: true },
    synced[SETTINGS_KEY] || {}
  );
  if (settings.syncKey === false) {
    // User opted out of syncing the key: it lives in chrome.storage.local only.
    const local = await chrome.storage.local.get(LOCAL_APIKEY_KEY);
    settings.apiKey = local[LOCAL_APIKEY_KEY] || '';
  }
  return settings;
}

function providerConfigFrom(settings) {
  return {
    provider: settings.provider || 'local',
    apiKey: settings.apiKey || '',
    model: settings.model || '',
    endpoint: settings.endpoint || '',
    headers: settings.headers || {},
  };
}

function engineLabel(settings) {
  if (!settings.provider || settings.provider === 'local') return 'Local engine';
  if (settings.provider === 'custom') return 'Custom endpoint';
  return settings.model || settings.provider;
}

// ---------------------------------------------------------------- badge

const pendingByTab = new Map();

function badgeStart(tabId) {
  if (tabId == null) return;
  pendingByTab.set(tabId, (pendingByTab.get(tabId) || 0) + 1);
  chrome.action.setBadgeText({ tabId, text: '…' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#C4593B' }).catch(() => {});
}

function badgeEnd(tabId) {
  if (tabId == null) return;
  const left = (pendingByTab.get(tabId) || 1) - 1;
  if (left <= 0) {
    pendingByTab.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  } else {
    pendingByTab.set(tabId, left);
  }
}

// ---------------------------------------------------------------- toolbar click

function openStandaloneNote(text) {
  const hash = text ? '#text=' + encodeURIComponent(text) : '';
  chrome.windows.create({
    url: chrome.runtime.getURL('standalone/note.html') + hash,
    type: 'popup',
    width: 420,
    height: 640,
  });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) {
    openStandaloneNote('');
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'wordgen:toggle' });
    return;
  } catch {
    // No content script in this tab yet (e.g. tab predates the install).
    // activeTab + scripting let us inject it on demand; if that fails too,
    // the page is restricted (chrome://, Web Store, PDF viewer…) → fall back
    // to the standalone note window.
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/note.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/note.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'wordgen:toggle' });
  } catch {
    openStandaloneNote('');
  }
});

// ---------------------------------------------------------------- context menus

function installContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'wordgen-rewrite',
      title: 'WordGen: Rewrite selection…',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'wordgen-synonyms',
      title: 'WordGen: Synonyms',
      contexts: ['selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(installContextMenus);
chrome.runtime.onStartup.addListener(installContextMenus);

function isSingleWord(text) {
  const t = (text || '').trim();
  return t.length > 0 && t.length <= 24 && !/\s/.test(t);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const text = (info.selectionText || '').trim();
  // Context menus cannot be shown conditionally per-selection, so the
  // "Synonyms" item degrades to the normal note when selection isn't one word.
  const view = info.menuItemId === 'wordgen-synonyms' && isSingleWord(text) ? 'synonyms' : 'note';
  if (tab && tab.id != null) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'wordgen:open', payload: { text, view } });
      return;
    } catch {
      // fall through to standalone window
    }
  }
  openStandaloneNote(text);
});

// ---------------------------------------------------------------- message hub

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'wordgen:open-options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'wordgen:run') {
    handleRun(msg.payload || {}, sender)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: errorMessage(err) }));
    return true; // async sendResponse
  }

  return false;
});

function errorMessage(err) {
  return err && err.message ? err.message : String(err);
}

async function handleRun(payload, sender) {
  const tabId = sender && sender.tab ? sender.tab.id : null;
  badgeStart(tabId);
  const started = Date.now();
  try {
    if (payload.kind === 'test') {
      // Options page tests unsaved form values, so the config comes with the message.
      const result = await testProvider(payload.providerConfig || {});
      return { ok: true, result };
    }

    const settings = await loadSettings();
    const providerConfig = providerConfigFrom(settings);

    if (payload.kind === 'synonyms') {
      const result = await runSynonyms({
        providerConfig,
        word: payload.word || '',
        context: payload.context || '',
        opts: payload.opts || {},
      });
      return { ok: true, result, meta: { engine: engineLabel(settings), ms: Date.now() - started } };
    }

    if (payload.kind === 'transform') {
      const mode = getMode(payload.modeId);
      if (!mode) throw new Error(`Unknown mode: ${payload.modeId}`);
      const result = await runTransform({
        providerConfig,
        mode,
        text: payload.text || '',
        opts: payload.opts || {},
      });
      try {
        await history.add({
          id: typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : String(Date.now()) + '-' + Math.random().toString(16).slice(2),
          ts: Date.now(),
          mode: mode.id,
          instruction: (payload.opts && payload.opts.instruction) || '',
          input: payload.text || '',
          outputs: result.options || [],
          source: 'extension',
          url: (sender && sender.tab && sender.tab.url) || payload.url || '',
        });
      } catch (err) {
        console.error('WordGen: history write failed', err);
      }
      return { ok: true, result, meta: { engine: engineLabel(settings), ms: Date.now() - started } };
    }

    throw new Error(`Unknown run kind: ${payload.kind}`);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  } finally {
    badgeEnd(tabId);
  }
}
