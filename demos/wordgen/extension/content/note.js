/* WordGen content script — sticky note panel + selection bubble.
 *
 * CLASSIC script by design: content scripts cannot be ES modules, so the shared
 * core is pulled in with dynamic import(chrome.runtime.getURL(...)) — allowed
 * because core/* is listed in web_accessible_resources.
 *
 * Everything is wrapped so a failure can never break the host page, and the UI
 * lives in a closed shadow root so page CSS cannot leak in (and ours cannot
 * leak out). All provider network calls go through the background worker.
 */
(() => {
  'use strict';

  // Double-injection guard (registered content script + on-demand injection).
  if (window.__wordgenLoaded) return;
  window.__wordgenLoaded = true;

  const SETTINGS_KEY = 'wordgen.settings.v2';
  const POS_KEY = 'wordgen.note.pos.v2';

  let settings = { provider: 'local', theme: 'paper', bubbleEnabled: true };
  let host = null;
  let wg = null; // themed wrapper inside the closed shadow root
  let noteEl = null;
  let refs = null; // elements queried inside the note
  let noteBuilt = false;
  let bubbleEl = null;
  let bubbleText = '';
  let corePromise = null;
  let selectedModeId = null;
  let insertTarget = null; // editable page element captured at note-open time
  let synFlow = 'note'; // 'page' when synonyms were launched from the bubble
  let toastTimer = 0;
  let runToken = 0;

  const getURL = (p) => chrome.runtime.getURL(p);

  const chromeLocalAdapter = {
    async get(key) {
      const obj = await chrome.storage.local.get(key);
      return obj[key];
    },
    async set(key, value) {
      await chrome.storage.local.set({ [key]: value });
    },
  };

  // ------------------------------------------------------------------ styles

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    button { font: inherit; color: inherit; }

    .wg {
      position: absolute; inset: 0; pointer-events: none;
      font-family: var(--font-ui); color: var(--text);
      font-size: 13.5px; line-height: 1.45;
      --font-ui: "Avenir Next", Avenir, Seravek, "Segoe UI", system-ui, sans-serif;
    }

    /* ---- three art directions (mirrors the web app themes) ---- */
    .wg, .wg[data-theme="paper"] {
      --font-display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      --note-bg: linear-gradient(178deg, #FFFAE6 0%, #FFF2C2 82%, #F8E7A6 100%);
      --text: #26221B; --muted: #7C7361;
      --accent: #C4593B; --accent-contrast: #FFFDF7; --accent-soft: rgba(196,89,59,.16);
      --card: #FFFDF7; --border: rgba(38,34,27,.18); --border-soft: rgba(38,34,27,.10);
      --chip-bg: rgba(255,253,247,.72);
      --tape: rgba(224,199,138,.6);
      --shadow: 0 18px 32px -14px rgba(76,56,24,.45), 0 4px 10px -6px rgba(76,56,24,.3);
      --radius: 4px 4px 14px 5px;
      --chip-tilt: rotate(-1.2deg);
    }
    .wg[data-theme="ink"] {
      --font-display: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      --note-bg: #14171C;
      --text: #ECEEF1; --muted: #8C949E;
      --accent: #4FD1A5; --accent-contrast: #0C1512; --accent-soft: rgba(79,209,165,.16);
      --card: #101216; --border: rgba(236,238,241,.2); --border-soft: rgba(236,238,241,.1);
      --chip-bg: rgba(236,238,241,.05);
      --tape: rgba(79,209,165,.22);
      --shadow: none;
      --radius: 6px;
      --chip-tilt: none;
    }
    .wg[data-theme="mist"] {
      --font-display: "Avenir Next", "Segoe UI", system-ui, sans-serif;
      --note-bg: #FBFCFE;
      --text: #2A3140; --muted: #7C8698;
      --accent: #4A5FC1; --accent-contrast: #FFFFFF; --accent-soft: rgba(74,95,193,.14);
      --card: #FFFFFF; --border: rgba(42,49,64,.15); --border-soft: rgba(42,49,64,.08);
      --chip-bg: #F2F5F9;
      --tape: rgba(74,95,193,.16);
      --shadow: 0 24px 48px -20px rgba(42,49,64,.35), 0 6px 16px -10px rgba(42,49,64,.2);
      --radius: 16px;
      --chip-tilt: none;
    }

    /* ---- the sticky note ---- */
    .wg-note {
      position: absolute; width: 380px; min-width: 300px; min-height: 240px;
      max-width: min(560px, calc(100vw - 24px)); max-height: 70vh;
      display: flex; flex-direction: column;
      pointer-events: auto; resize: both; overflow: hidden;
      background: var(--note-bg); color: var(--text);
      border: 1px solid var(--border); border-radius: var(--radius);
      box-shadow: var(--shadow);
      opacity: 0; transform: translateX(14px);
      transition: opacity .18s ease-out, transform .18s ease-out;
    }
    .wg-note.wg-in { opacity: 1; transform: none; }
    .wg[data-theme="paper"] .wg-note::before {
      content: ""; position: absolute; inset: 0; pointer-events: none;
      background:
        radial-gradient(120% 60% at 50% -8%, rgba(255,255,255,.55), transparent 60%),
        repeating-linear-gradient(0deg, transparent 0 26px, rgba(120,96,40,.035) 26px 27px);
    }
    .wg-tape {
      position: absolute; top: -1px; left: 22px; width: 74px; height: 17px;
      transform: rotate(-2.5deg); transform-origin: left top;
      background: var(--tape);
      border-left: 1px dashed rgba(0,0,0,.10); border-right: 1px dashed rgba(0,0,0,.10);
      box-shadow: 0 1px 2px rgba(0,0,0,.10); pointer-events: none;
    }

    .wg-head {
      position: relative; display: flex; align-items: center; gap: 8px;
      padding: 12px 10px 8px 14px; cursor: grab; user-select: none; touch-action: none;
      border-bottom: 1px solid var(--border-soft);
    }
    .wg-head:active { cursor: grabbing; }
    .wg-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); flex: none; }
    .wg-title { font-family: var(--font-display); font-weight: 700; font-size: 15px; letter-spacing: .2px; margin-right: auto; }
    .wg-ibtn {
      flex: none; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: none; border-radius: 7px; cursor: pointer; padding: 0; font-size: 13px; color: var(--muted);
    }
    .wg-ibtn:hover { background: var(--accent-soft); color: var(--text); }
    .wg-ibtn[aria-pressed="true"] { background: var(--accent); color: var(--accent-contrast); }
    .wg-ibtn svg { width: 15px; height: 15px; display: block; }

    .wg-body { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .wg-view { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
    .wg-view[hidden] { display: none; }

    .wg-text {
      margin: 10px 12px 0; padding: 8px 10px; min-height: 64px; max-height: 30vh; resize: none;
      background: var(--card); color: var(--text);
      border: 1px solid var(--border); border-radius: 8px;
      font: inherit; outline: none; overflow-y: auto;
    }
    .wg-text:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .wg-text::placeholder { color: var(--muted); opacity: .9; }

    .wg-chips {
      display: flex; align-items: center; gap: 6px; overflow-x: auto; overflow-y: hidden;
      padding: 9px 12px 7px; scrollbar-width: thin; flex: none;
    }
    .wg-group {
      flex: none; font-size: 9.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
      color: var(--muted); padding-right: 2px;
    }
    .wg-sep { flex: none; width: 1px; height: 20px; background: var(--border); margin: 0 5px; }
    .wg-chip {
      flex: none; display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px;
      background: var(--chip-bg); cursor: pointer; font-size: 12px; white-space: nowrap;
    }
    .wg-chip:hover { border-color: var(--accent); }
    .wg-chip[aria-pressed="true"] {
      background: var(--accent); border-color: var(--accent); color: var(--accent-contrast);
      transform: var(--chip-tilt);
    }

    .wg-runrow { display: flex; gap: 8px; padding: 2px 12px 10px; flex: none; }
    .wg-instr {
      flex: 1 1 auto; min-width: 0; padding: 7px 10px;
      background: var(--card); color: var(--text);
      border: 1px solid var(--border); border-radius: 8px; font: inherit; font-size: 12.5px; outline: none;
    }
    .wg-instr:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .wg-instr::placeholder { color: var(--muted); opacity: .9; }
    .wg-run {
      flex: none; padding: 7px 14px; border: none; border-radius: 8px; cursor: pointer;
      background: var(--accent); color: var(--accent-contrast); font-weight: 700; font-size: 13px;
    }
    .wg-run:hover:not(:disabled) { filter: brightness(1.08); }
    .wg-run:disabled { opacity: .45; cursor: not-allowed; }

    .wg-results { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 12px 10px; display: flex; flex-direction: column; gap: 8px; }
    .wg-opt {
      background: var(--card); border: 1px solid var(--border-soft); border-radius: 10px;
      padding: 9px 10px; box-shadow: 0 1px 3px rgba(0,0,0,.05);
    }
    .wg-opt-text { white-space: pre-wrap; word-wrap: break-word; }
    .wg-opt-note { margin-top: 4px; font-size: 11.5px; color: var(--muted); font-style: italic; }
    .wg-opt-actions { display: flex; gap: 6px; margin-top: 7px; }
    .wg-abtn {
      padding: 3px 10px; border: 1px solid var(--border); border-radius: 999px; background: transparent;
      cursor: pointer; font-size: 11.5px; color: var(--text);
    }
    .wg-abtn:hover { border-color: var(--accent); color: var(--accent); }
    .wg-error {
      margin: 0; padding: 8px 10px; border-radius: 8px; font-size: 12.5px;
      background: var(--accent-soft); border: 1px solid var(--accent); color: var(--text);
    }
    .wg-banner {
      display: flex; align-items: center; gap: 8px; justify-content: space-between;
      padding: 8px 10px; border-radius: 8px; font-size: 12px;
      background: var(--accent-soft); border: 1px dashed var(--accent);
    }
    .wg-banner button { flex: none; }
    .wg-skel { flex: none; height: 56px; border-radius: 10px;
      background: linear-gradient(90deg, var(--border-soft) 25%, var(--chip-bg) 50%, var(--border-soft) 75%);
      background-size: 200% 100%; animation: wg-shimmer 1.1s linear infinite; }
    @keyframes wg-shimmer { to { background-position: -200% 0; } }

    .wg-foot {
      flex: none; display: flex; align-items: center; gap: 8px;
      padding: 6px 14px 8px; border-top: 1px solid var(--border-soft);
      font-size: 11px; color: var(--muted);
    }
    .wg-engine { font-weight: 600; }
    .wg-ms { margin-left: auto; font-variant-numeric: tabular-nums; }

    /* ---- synonyms view ---- */
    .wg-syn-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 4px; flex: none; }
    .wg-syn-title { font-family: var(--font-display); font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wg-syn-list { display: flex; flex-wrap: wrap; gap: 7px; padding: 8px 12px 12px; overflow-y: auto; align-content: flex-start; }
    .wg-syn-word {
      display: inline-flex; align-items: baseline; gap: 6px; padding: 5px 11px;
      border: 1px solid var(--border); border-radius: 999px; background: var(--card);
      cursor: pointer; font-size: 13px;
    }
    .wg-syn-word:hover { border-color: var(--accent); background: var(--accent-soft); }
    .wg-syn-reg { font-size: 9.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .wg-syn-hint { padding: 0 12px 8px; font-size: 11.5px; color: var(--muted); flex: none; }

    /* ---- history view ---- */
    .wg-hist { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 4px; }
    .wg-hist-row {
      display: flex; align-items: baseline; gap: 8px; width: 100%; text-align: left;
      background: transparent; border: none; border-radius: 8px; padding: 7px 8px; cursor: pointer;
    }
    .wg-hist-row:hover { background: var(--accent-soft); }
    .wg-hist-emoji { flex: none; }
    .wg-hist-snippet { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
    .wg-hist-time { flex: none; font-size: 10.5px; color: var(--muted); }
    .wg-empty { padding: 18px 12px; text-align: center; color: var(--muted); font-size: 12.5px; }

    /* ---- selection bubble ---- */
    .wg-bubble {
      position: absolute; width: 28px; height: 28px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      background: var(--accent); color: var(--accent-contrast);
      font-family: Georgia, serif; font-weight: 700; font-size: 14px; line-height: 1;
      border: none; cursor: pointer; pointer-events: auto;
      box-shadow: 0 2px 8px rgba(0,0,0,.3);
    }
    .wg-bubble:hover { filter: brightness(1.1); transform: scale(1.08); }
    .wg-bubble[hidden] { display: none; }

    .wg-toast {
      position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%);
      background: var(--text); color: var(--card);
      padding: 7px 14px; border-radius: 999px; font-size: 12.5px;
      box-shadow: 0 4px 14px rgba(0,0,0,.25); pointer-events: none;
      opacity: 0; transition: opacity .15s ease-out;
    }
    .wg-toast.wg-show { opacity: 1; }

    :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

    @media (prefers-reduced-motion: reduce) {
      .wg-note { transition: none; }
      .wg-skel { animation: none; }
      .wg-bubble:hover { transform: none; }
      .wg-toast { transition: none; }
    }
  `;

  const GEAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg>';

  // ------------------------------------------------------------------ helpers

  function loadCore() {
    if (!corePromise) corePromise = import(getURL('core/modes.js'));
    return corePromise;
  }

  function isSingleWord(text) {
    const t = (text || '').trim();
    return t.length > 0 && t.length <= 24 && !/\s/.test(t);
  }

  function sendToBackground(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message || 'WordGen is unavailable — try reloading the page.' });
          } else {
            resolve(res || { ok: false, error: 'No response from WordGen.' });
          }
        });
      } catch (err) {
        resolve({ ok: false, error: (err && err.message) || String(err) });
      }
    });
  }

  const sendRun = (payload) => sendToBackground({ type: 'wordgen:run', payload });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const tmp = document.createElement('textarea');
        tmp.value = text;
        tmp.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
        document.body.appendChild(tmp);
        tmp.select();
        const ok = document.execCommand('copy');
        tmp.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function relativeTime(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function engineLabelFromSettings() {
    const p = settings.provider || 'local';
    if (p === 'local') return 'Local engine';
    if (p === 'custom') return 'Custom endpoint';
    return settings.model || p;
  }

  // ------------------------------------------------------------------ settings

  async function loadSettings() {
    try {
      const obj = await chrome.storage.sync.get(SETTINGS_KEY);
      settings = Object.assign({ provider: 'local', theme: 'paper', bubbleEnabled: true }, obj[SETTINGS_KEY] || {});
    } catch {
      /* extension context gone — keep defaults */
    }
    applyTheme();
  }

  function applyTheme() {
    if (wg) wg.setAttribute('data-theme', settings.theme || 'paper');
    if (refs) refs.engine.textContent = engineLabelFromSettings();
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      try {
        if (area !== 'sync' || !changes[SETTINGS_KEY]) return;
        settings = Object.assign({ provider: 'local', theme: 'paper', bubbleEnabled: true }, changes[SETTINGS_KEY].newValue || {});
        applyTheme();
        if (settings.bubbleEnabled === false) hideBubble();
      } catch { /* never break the page */ }
    });
  } catch { /* chrome.storage unavailable in exotic contexts */ }

  // ------------------------------------------------------------------ shadow host

  function ensureHost() {
    if (wg && host && host.isConnected) return;
    if (host && !host.isConnected) {
      // The page replaced <html>/<body> content; re-attach our host.
      (document.body || document.documentElement).appendChild(host);
      return;
    }
    host = document.createElement('div');
    host.className = 'wordgen-root-host';
    // Belt and braces in case note.css was not injected alongside us.
    host.style.setProperty('position', 'fixed', 'important');
    host.style.setProperty('inset', '0', 'important');
    host.style.setProperty('z-index', '2147483646', 'important');
    host.style.setProperty('pointer-events', 'none', 'important');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    wg = document.createElement('div');
    wg.className = 'wg';
    shadow.append(style, wg);
    applyTheme();
    (document.body || document.documentElement).appendChild(host);
  }

  // ------------------------------------------------------------------ note UI

  const NOTE_HTML = `
    <div class="wg-tape"></div>
    <header class="wg-head" part="head">
      <span class="wg-dot"></span>
      <span class="wg-title">WordGen</span>
      <button class="wg-ibtn" data-act="history" title="History">&#128220;</button>
      <button class="wg-ibtn" data-act="options" title="Settings">${GEAR_SVG}</button>
      <button class="wg-ibtn" data-act="close" title="Close">&#10005;</button>
    </header>
    <div class="wg-body">
      <div class="wg-view wg-view-main">
        <textarea class="wg-text" rows="3" placeholder="Type here, or select text on the page first&#8230;"></textarea>
        <div class="wg-chips" role="listbox" aria-label="Modes"></div>
        <div class="wg-runrow">
          <input class="wg-instr" type="text" placeholder="Optional instruction&#8230;">
          <button class="wg-run" disabled>Transform &#10022;</button>
        </div>
        <div class="wg-results"></div>
      </div>
      <div class="wg-view wg-view-syn" hidden>
        <div class="wg-syn-head">
          <button class="wg-abtn" data-act="syn-back">&#8592; Back</button>
          <span class="wg-syn-title"></span>
        </div>
        <div class="wg-syn-list"></div>
        <div class="wg-syn-hint"></div>
      </div>
      <div class="wg-view wg-view-hist" hidden>
        <div class="wg-hist"></div>
      </div>
    </div>
    <footer class="wg-foot">
      <span class="wg-engine"></span>
      <span class="wg-ms"></span>
    </footer>
  `;

  async function buildNote() {
    if (noteBuilt) return;
    ensureHost();
    noteEl = document.createElement('section');
    noteEl.className = 'wg-note';
    noteEl.setAttribute('role', 'dialog');
    noteEl.setAttribute('aria-label', 'WordGen note');
    noteEl.innerHTML = NOTE_HTML;
    wg.appendChild(noteEl);

    const $ = (sel) => noteEl.querySelector(sel);
    refs = {
      head: $('.wg-head'),
      text: $('.wg-text'),
      chips: $('.wg-chips'),
      instr: $('.wg-instr'),
      run: $('.wg-run'),
      results: $('.wg-results'),
      viewMain: $('.wg-view-main'),
      viewSyn: $('.wg-view-syn'),
      viewHist: $('.wg-view-hist'),
      synTitle: $('.wg-syn-title'),
      synList: $('.wg-syn-list'),
      synHint: $('.wg-syn-hint'),
      hist: $('.wg-hist'),
      histBtn: $('[data-act="history"]'),
      engine: $('.wg-engine'),
      ms: $('.wg-ms'),
    };

    refs.engine.textContent = engineLabelFromSettings();

    // header actions
    $('[data-act="close"]').addEventListener('click', () => closeNote());
    $('[data-act="options"]').addEventListener('click', () => sendToBackground({ type: 'wordgen:open-options' }));
    refs.histBtn.addEventListener('click', () => {
      if (refs.viewHist.hidden) openHistory();
      else showView('main');
    });
    $('[data-act="syn-back"]').addEventListener('click', () => showView('main'));

    // editor behavior
    refs.text.addEventListener('input', () => { autogrow(); updateRunState(); });
    refs.instr.addEventListener('input', updateRunState);
    refs.instr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !refs.run.disabled) runSelected();
    });
    refs.text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !refs.run.disabled) runSelected();
    });
    refs.run.addEventListener('click', runSelected);

    noteEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (!refs.viewSyn.hidden || !refs.viewHist.hidden) showView('main');
      else closeNote();
    });

    setupDrag();
    await buildChips();
    noteBuilt = true;
  }

  async function buildChips() {
    let core;
    try {
      core = await loadCore();
    } catch (err) {
      console.error('WordGen: failed to load core modules', err);
      refs.chips.textContent = 'WordGen core failed to load — try reloading the page.';
      return;
    }
    const { MODES, MODE_CATEGORIES } = core;
    refs.chips.textContent = '';
    let firstGroup = true;
    for (const cat of MODE_CATEGORIES) {
      const modes = MODES.filter((m) => m.category === cat.id && m.id !== 'custom');
      if (!modes.length) continue;
      if (!firstGroup) {
        const sep = document.createElement('span');
        sep.className = 'wg-sep';
        refs.chips.appendChild(sep);
      }
      firstGroup = false;
      const label = document.createElement('span');
      label.className = 'wg-group';
      label.textContent = cat.label;
      refs.chips.appendChild(label);
      for (const mode of modes) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'wg-chip';
        chip.dataset.mode = mode.id;
        chip.title = mode.hint || mode.label;
        chip.setAttribute('aria-pressed', 'false');
        const em = document.createElement('span');
        em.textContent = mode.emoji || '';
        const lb = document.createElement('span');
        lb.textContent = mode.label;
        chip.append(em, lb);
        chip.addEventListener('click', () => selectMode(mode.id));
        refs.chips.appendChild(chip);
      }
    }
  }

  function selectMode(id) {
    selectedModeId = selectedModeId === id ? null : id;
    refs.chips.querySelectorAll('.wg-chip').forEach((c) => {
      c.setAttribute('aria-pressed', c.dataset.mode === selectedModeId ? 'true' : 'false');
    });
    updateRunState();
  }

  function updateRunState() {
    const hasText = refs.text.value.trim().length > 0;
    const hasWay = !!selectedModeId || refs.instr.value.trim().length > 0;
    refs.run.disabled = !(hasText && hasWay);
  }

  function autogrow() {
    const ta = refs.text;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, Math.round(window.innerHeight * 0.28)) + 'px';
  }

  function showView(name) {
    refs.viewMain.hidden = name !== 'main';
    refs.viewSyn.hidden = name !== 'syn';
    refs.viewHist.hidden = name !== 'hist';
    refs.histBtn.setAttribute('aria-pressed', name === 'hist' ? 'true' : 'false');
  }

  // ------------------------------------------------------------------ open/close

  async function openNote(opts = {}) {
    if (!opts.skipCapture) captureInsertTarget();
    await buildNote();
    if (typeof opts.text === 'string' && opts.text) {
      refs.text.value = opts.text;
    } else if (!refs.text.value) {
      const sel = getPageSelectionText();
      if (sel) refs.text.value = sel;
    }
    noteEl.style.display = 'flex';
    restorePosition();
    autogrow();
    updateRunState();
    requestAnimationFrame(() => noteEl.classList.add('wg-in'));
    if (opts.view !== 'syn') {
      showView('main');
      refs.text.focus({ preventScroll: true });
      refs.text.setSelectionRange(refs.text.value.length, refs.text.value.length);
    }
  }

  function closeNote() {
    if (!noteEl) return;
    noteEl.classList.remove('wg-in');
    noteEl.style.display = 'none';
  }

  function isNoteOpen() {
    return !!(noteEl && noteEl.style.display !== 'none' && noteEl.isConnected);
  }

  async function toggleNote() {
    if (isNoteOpen()) closeNote();
    else await openNote();
  }

  // ------------------------------------------------------------------ drag + position

  function clampPos(left, top) {
    const w = noteEl.offsetWidth || 380;
    return {
      left: Math.min(Math.max(8, left), Math.max(8, window.innerWidth - w - 8)),
      top: Math.min(Math.max(8, top), Math.max(8, window.innerHeight - 48)),
    };
  }

  function positionNote(left, top) {
    const p = clampPos(left, top);
    noteEl.style.left = p.left + 'px';
    noteEl.style.top = p.top + 'px';
  }

  function restorePosition() {
    let pos = null;
    try {
      pos = JSON.parse(sessionStorage.getItem(POS_KEY) || 'null');
    } catch { /* storage may be blocked on this page */ }
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
      positionNote(pos.left, pos.top);
    } else {
      positionNote(window.innerWidth - (noteEl.offsetWidth || 380) - 24, 24);
    }
  }

  function savePosition() {
    try {
      sessionStorage.setItem(POS_KEY, JSON.stringify({
        left: parseInt(noteEl.style.left, 10) || 0,
        top: parseInt(noteEl.style.top, 10) || 0,
      }));
    } catch { /* ignore */ }
  }

  function setupDrag() {
    refs.head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.wg-ibtn')) return;
      const rect = noteEl.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      const move = (ev) => positionNote(ev.clientX - dx, ev.clientY - dy);
      const up = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        savePosition();
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      e.preventDefault();
    });
    window.addEventListener('resize', () => {
      try {
        if (isNoteOpen()) {
          positionNote(parseInt(noteEl.style.left, 10) || 0, parseInt(noteEl.style.top, 10) || 0);
        }
      } catch { /* ignore */ }
    });
  }

  // ------------------------------------------------------------------ insert into page

  function isTextField(el) {
    if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
    if (el instanceof HTMLInputElement) {
      return !el.readOnly && !el.disabled && /^(text|search|url|tel|email)$/i.test(el.type || 'text');
    }
    return false;
  }

  function captureInsertTarget() {
    try {
      const el = document.activeElement;
      if (el && isTextField(el)) {
        insertTarget = { el, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
        return;
      }
      if (el && el.isContentEditable) {
        const sel = document.getSelection();
        insertTarget = { el, range: sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null };
        return;
      }
      const sel = document.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        const node = sel.getRangeAt(0).commonAncestorContainer;
        const container = node.nodeType === 1 ? node : node.parentElement;
        const editable = container && container.closest ? container.closest('[contenteditable=""],[contenteditable="true"]') : null;
        if (editable) {
          insertTarget = { el: editable, range: sel.getRangeAt(0).cloneRange() };
          return;
        }
      }
      insertTarget = null;
    } catch {
      insertTarget = null;
    }
  }

  function tryInsert(text) {
    try {
      const t = insertTarget;
      if (!t || !t.el || !t.el.isConnected) return false;
      const el = t.el;
      if (isTextField(el)) {
        const start = Math.min(t.start ?? 0, el.value.length);
        const end = Math.min(t.end ?? start, el.value.length);
        el.value = el.value.slice(0, start) + text + el.value.slice(end);
        const caret = start + text.length;
        el.focus({ preventScroll: true });
        try { el.setSelectionRange(caret, caret); } catch { /* number inputs etc. */ }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        insertTarget = { el, start, end: caret };
        return true;
      }
      if (el.isContentEditable) {
        el.focus({ preventScroll: true });
        const sel = document.getSelection();
        if (t.range) {
          sel.removeAllRanges();
          try { sel.addRange(t.range); } catch { /* range died with a re-render */ }
        }
        // execCommand fires proper beforeinput/input events for rich editors.
        let ok = false;
        try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
        if (!ok) {
          if (!sel.rangeCount) return false;
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
          range.collapse(false);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const sel2 = document.getSelection();
        if (sel2 && sel2.rangeCount) insertTarget = { el, range: sel2.getRangeAt(0).cloneRange() };
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async function insertOrCopy(text) {
    if (tryInsert(text)) {
      toast('Inserted');
    } else {
      const ok = await copyText(text);
      toast(ok ? 'Copied — click into a text field to insert directly' : 'Copy failed');
    }
  }

  // ------------------------------------------------------------------ transform flow

  async function runSelected() {
    const text = refs.text.value.trim();
    const instruction = refs.instr.value.trim();
    let modeId = selectedModeId;
    if (!modeId && instruction) modeId = 'custom';
    if (!text || !modeId) return;

    if (modeId === 'synonyms') {
      if (!isSingleWord(text)) {
        renderError('Synonyms works on a single word — type just one word, or select one on the page.');
        return;
      }
      openSynonyms(text, '', 'note');
      return;
    }

    const token = ++runToken;
    renderSkeleton();
    refs.run.disabled = true;
    const res = await sendRun({
      kind: 'transform',
      modeId,
      text,
      opts: instruction ? { instruction } : {},
      url: location.href,
    });
    if (token !== runToken) return; // superseded by a newer run
    updateRunState();
    if (!res.ok) {
      renderError(res.error || 'Something went wrong.');
      return;
    }
    renderResults(res.result, res.meta);
  }

  function renderSkeleton() {
    refs.results.textContent = '';
    for (let i = 0; i < 2; i++) {
      const sk = document.createElement('div');
      sk.className = 'wg-skel';
      refs.results.appendChild(sk);
    }
  }

  function renderError(message) {
    refs.results.textContent = '';
    const err = document.createElement('p');
    err.className = 'wg-error';
    err.textContent = message;
    refs.results.appendChild(err);
  }

  function renderResults(result, meta) {
    refs.results.textContent = '';
    if (result && result.limited) {
      const banner = document.createElement('div');
      banner.className = 'wg-banner';
      const span = document.createElement('span');
      span.textContent = 'This mode needs an AI provider — the free local engine did what it could.';
      const btn = document.createElement('button');
      btn.className = 'wg-abtn';
      btn.textContent = 'Open Settings';
      btn.addEventListener('click', () => sendToBackground({ type: 'wordgen:open-options' }));
      banner.append(span, btn);
      refs.results.appendChild(banner);
    }
    const options = (result && result.options) || [];
    if (!options.length) {
      renderError('No options came back — try again or tweak the instruction.');
      return;
    }
    for (const opt of options) {
      const card = document.createElement('div');
      card.className = 'wg-opt';
      const textEl = document.createElement('div');
      textEl.className = 'wg-opt-text';
      textEl.textContent = opt.text || '';
      card.appendChild(textEl);
      if (opt.note) {
        const noteRow = document.createElement('div');
        noteRow.className = 'wg-opt-note';
        noteRow.textContent = opt.note;
        card.appendChild(noteRow);
      }
      const actions = document.createElement('div');
      actions.className = 'wg-opt-actions';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'wg-abtn';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async () => toast((await copyText(opt.text || '')) ? 'Copied' : 'Copy failed'));
      const insertBtn = document.createElement('button');
      insertBtn.className = 'wg-abtn';
      insertBtn.textContent = 'Insert';
      insertBtn.addEventListener('click', () => insertOrCopy(opt.text || ''));
      actions.append(copyBtn, insertBtn);
      card.appendChild(actions);
      refs.results.appendChild(card);
    }
    if (meta) {
      refs.engine.textContent = meta.engine || engineLabelFromSettings();
      refs.ms.textContent = typeof meta.ms === 'number' ? meta.ms + ' ms' : '';
    }
  }

  // ------------------------------------------------------------------ synonyms flow

  async function openSynonyms(word, context, flow) {
    synFlow = flow;
    showView('syn');
    refs.synTitle.textContent = 'Synonyms for “' + word + '”';
    refs.synHint.textContent = flow === 'page'
      ? 'Click a word to replace it on the page.'
      : 'Click a word to use it.';
    refs.synList.textContent = '';
    for (let i = 0; i < 5; i++) {
      const sk = document.createElement('div');
      sk.className = 'wg-skel';
      sk.style.cssText = 'width:86px;height:30px;border-radius:999px;';
      refs.synList.appendChild(sk);
    }
    const token = ++runToken;
    const res = await sendRun({ kind: 'synonyms', word, context: context || '', opts: {}, url: location.href });
    if (token !== runToken || refs.viewSyn.hidden) return;
    refs.synList.textContent = '';
    if (!res.ok) {
      const err = document.createElement('p');
      err.className = 'wg-error';
      err.textContent = res.error || 'Could not fetch synonyms.';
      refs.synList.appendChild(err);
      return;
    }
    const candidates = (res.result && res.result.candidates) || [];
    if (!candidates.length) {
      const empty = document.createElement('div');
      empty.className = 'wg-empty';
      empty.textContent = 'No good synonyms found for that word.';
      refs.synList.appendChild(empty);
      return;
    }
    for (const cand of candidates) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'wg-syn-word';
      if (cand.note) chip.title = cand.note;
      const w = document.createElement('span');
      w.textContent = cand.word || '';
      chip.appendChild(w);
      if (cand.register) {
        const reg = document.createElement('span');
        reg.className = 'wg-syn-reg';
        reg.textContent = cand.register;
        chip.appendChild(reg);
      }
      chip.addEventListener('click', () => pickSynonym(word, cand.word || ''));
      refs.synList.appendChild(chip);
    }
    if (res.meta) {
      refs.engine.textContent = res.meta.engine || engineLabelFromSettings();
      refs.ms.textContent = typeof res.meta.ms === 'number' ? res.meta.ms + ' ms' : '';
    }
  }

  async function pickSynonym(original, replacement) {
    if (!replacement) return;
    if (synFlow === 'page') {
      if (tryInsert(replacement)) {
        toast('Replaced “' + original + '”');
        return;
      }
      toast((await copyText(replacement)) ? 'Copied' : 'Copy failed');
      return;
    }
    // note flow: the textarea holds the word — swap it in place
    if (refs.text.value.trim() === original) {
      refs.text.value = replacement;
      showView('main');
      updateRunState();
      toast('Replaced');
    } else {
      toast((await copyText(replacement)) ? 'Copied' : 'Copy failed');
    }
  }

  // ------------------------------------------------------------------ history view

  async function openHistory() {
    showView('hist');
    refs.hist.textContent = '';
    const loading = document.createElement('div');
    loading.className = 'wg-empty';
    loading.textContent = 'Loading…';
    refs.hist.appendChild(loading);
    let entries = [];
    let core = null;
    try {
      const [historyMod, coreMod] = await Promise.all([
        import(getURL('core/history.js')),
        loadCore(),
      ]);
      core = coreMod;
      entries = await historyMod.createHistory(chromeLocalAdapter).list(20);
    } catch (err) {
      console.error('WordGen: history load failed', err);
    }
    if (refs.viewHist.hidden) return;
    refs.hist.textContent = '';
    if (!entries || !entries.length) {
      const empty = document.createElement('div');
      empty.className = 'wg-empty';
      empty.textContent = 'Nothing here yet — transform something first.';
      refs.hist.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'wg-hist-row';
      const mode = core && core.getMode ? core.getMode(entry.mode) : null;
      const emoji = document.createElement('span');
      emoji.className = 'wg-hist-emoji';
      emoji.textContent = (mode && mode.emoji) || '✏️';
      const snippet = document.createElement('span');
      snippet.className = 'wg-hist-snippet';
      snippet.textContent = (entry.input || '').slice(0, 60);
      const time = document.createElement('span');
      time.className = 'wg-hist-time';
      time.textContent = relativeTime(entry.ts || 0);
      row.append(emoji, snippet, time);
      row.addEventListener('click', () => {
        refs.text.value = entry.input || '';
        showView('main');
        autogrow();
        updateRunState();
        renderResults({ options: entry.outputs || [] }, null);
      });
      refs.hist.appendChild(row);
    }
  }

  // ------------------------------------------------------------------ toast

  function toast(message) {
    ensureHost();
    let el = wg.querySelector('.wg-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'wg-toast';
      wg.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('wg-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('wg-show'), 1800);
  }

  // ------------------------------------------------------------------ selection bubble

  function getPageSelectionText() {
    try {
      const el = document.activeElement;
      if (el && isTextField(el) && el.selectionStart != null && el.selectionStart !== el.selectionEnd) {
        return el.value.slice(el.selectionStart, el.selectionEnd).trim();
      }
      const sel = document.getSelection();
      return sel && !sel.isCollapsed ? String(sel).trim() : '';
    } catch {
      return '';
    }
  }

  function selectionContext() {
    try {
      const el = document.activeElement;
      if (el && isTextField(el) && el.selectionStart != null) {
        const v = el.value;
        const s = el.selectionStart;
        const e = el.selectionEnd ?? s;
        return v.slice(Math.max(0, s - 120), Math.min(v.length, e + 120));
      }
      const sel = document.getSelection();
      if (sel && sel.rangeCount) {
        const node = sel.getRangeAt(0).commonAncestorContainer;
        const container = node.nodeType === 1 ? node : node.parentElement;
        return ((container && container.textContent) || '').trim().slice(0, 240);
      }
    } catch { /* ignore */ }
    return '';
  }

  function ensureBubble() {
    if (bubbleEl) return;
    ensureHost();
    bubbleEl = document.createElement('button');
    bubbleEl.type = 'button';
    bubbleEl.className = 'wg-bubble';
    bubbleEl.title = 'WordGen — rewrite this selection';
    bubbleEl.textContent = 'W';
    bubbleEl.hidden = true;
    // preventDefault keeps the page selection + focus alive through the click
    bubbleEl.addEventListener('mousedown', (e) => e.preventDefault());
    bubbleEl.addEventListener('click', onBubbleClick);
    wg.appendChild(bubbleEl);
  }

  function showBubble(x, y, text) {
    ensureBubble();
    bubbleText = text;
    const left = Math.min(Math.max(6, x + 10), window.innerWidth - 36);
    const top = Math.min(Math.max(6, y + 12), window.innerHeight - 36);
    bubbleEl.style.left = left + 'px';
    bubbleEl.style.top = top + 'px';
    bubbleEl.hidden = false;
  }

  function hideBubble() {
    if (bubbleEl) bubbleEl.hidden = true;
    bubbleText = '';
  }

  async function onBubbleClick() {
    try {
      const text = bubbleText;
      hideBubble();
      if (!text) return;
      if (isSingleWord(text)) {
        const context = selectionContext();
        captureInsertTarget();
        await openNote({ skipCapture: true, view: 'syn' });
        openSynonyms(text, context, 'page');
      } else {
        await openNote({ text });
      }
    } catch (err) {
      console.error('WordGen:', err);
    }
  }

  function eventInsideHost(e) {
    try {
      return !!(host && e.composedPath && e.composedPath().includes(host));
    } catch {
      return false;
    }
  }

  document.addEventListener('mouseup', (e) => {
    try {
      if (settings.bubbleEnabled === false) return;
      if (eventInsideHost(e)) return;
      const x = e.clientX;
      const y = e.clientY;
      // let the browser finalize the selection first
      setTimeout(() => {
        try {
          const text = getPageSelectionText();
          if (text) showBubble(x, y, text);
          else hideBubble();
        } catch { /* ignore */ }
      }, 0);
    } catch { /* never break the page */ }
  }, true);

  document.addEventListener('mousedown', (e) => {
    try {
      if (!eventInsideHost(e)) hideBubble();
    } catch { /* ignore */ }
  }, true);

  document.addEventListener('scroll', () => hideBubble(), { capture: true, passive: true });

  document.addEventListener('keydown', (e) => {
    try {
      if (e.key === 'Escape') hideBubble();
    } catch { /* ignore */ }
  }, true);

  // ------------------------------------------------------------------ messages

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      try {
        if (msg && msg.type === 'wordgen:toggle') {
          toggleNote();
          sendResponse({ ok: true });
        } else if (msg && msg.type === 'wordgen:open') {
          const p = msg.payload || {};
          const text = (p.text || '').trim();
          if (p.view === 'synonyms' && isSingleWord(text)) {
            captureInsertTarget();
            openNote({ skipCapture: true, view: 'syn' }).then(() => openSynonyms(text, selectionContext(), 'page'));
          } else {
            openNote(text ? { text } : {});
          }
          sendResponse({ ok: true });
        }
      } catch (err) {
        try { sendResponse({ ok: false, error: String(err && err.message || err) }); } catch { /* ignore */ }
      }
      return false;
    });
  } catch { /* extension context unavailable */ }

  loadSettings();
})();
