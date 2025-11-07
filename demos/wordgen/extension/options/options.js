/**
 * options.js
 * Settings page logic
 */

import { getSettings, updateSetting, DEFAULT_SETTINGS } from '../shared/storage-adapter.js';

// DOM elements
let numSuggestionsEl, triggerMethodEl, popupPositionEl, themeEl;
let showPOSTagsEl, autoDismissEl;
let enabledSitesEl, whitelistSection, blacklistSection;
let whitelistInput, whitelistList, addWhitelistBtn;
let blacklistInput, blacklistList, addBlacklistBtn;
let providerEl, openaiSettings, huggingfaceSettings, customSettings;
let openaiKeyEl, openaiModelEl;
let huggingfaceKeyEl, huggingfaceModelEl;
let customUrlEl, customHeadersEl;
let wordsTodayEl, wordsTotalEl;
let resetStatsBtn, exportSettingsBtn, importSettingsBtn, resetSettingsBtn;
let importFileEl, toastEl;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Get DOM elements
  initializeElements();

  // Load current settings
  await loadSettings();

  // Setup event listeners
  setupEventListeners();
});

/**
 * Initialize DOM element references
 */
function initializeElements() {
  // General settings
  numSuggestionsEl = document.getElementById('num-suggestions');
  triggerMethodEl = document.getElementById('trigger-method');
  popupPositionEl = document.getElementById('popup-position');
  themeEl = document.getElementById('theme');
  showPOSTagsEl = document.getElementById('show-pos-tags');
  autoDismissEl = document.getElementById('auto-dismiss');

  // Site control
  enabledSitesEl = document.getElementById('enabled-sites');
  whitelistSection = document.getElementById('whitelist-section');
  blacklistSection = document.getElementById('blacklist-section');
  whitelistInput = document.getElementById('whitelist-input');
  whitelistList = document.getElementById('whitelist-list');
  addWhitelistBtn = document.getElementById('add-whitelist');
  blacklistInput = document.getElementById('blacklist-input');
  blacklistList = document.getElementById('blacklist-list');
  addBlacklistBtn = document.getElementById('add-blacklist');

  // LLM provider
  providerEl = document.getElementById('provider');
  openaiSettings = document.getElementById('openai-settings');
  huggingfaceSettings = document.getElementById('huggingface-settings');
  customSettings = document.getElementById('custom-settings');
  openaiKeyEl = document.getElementById('openai-key');
  openaiModelEl = document.getElementById('openai-model');
  huggingfaceKeyEl = document.getElementById('huggingface-key');
  huggingfaceModelEl = document.getElementById('huggingface-model');
  customUrlEl = document.getElementById('custom-url');
  customHeadersEl = document.getElementById('custom-headers');

  // Statistics
  wordsTodayEl = document.getElementById('words-today');
  wordsTotalEl = document.getElementById('words-total');

  // Data management
  resetStatsBtn = document.getElementById('reset-stats');
  exportSettingsBtn = document.getElementById('export-settings');
  importSettingsBtn = document.getElementById('import-settings');
  resetSettingsBtn = document.getElementById('reset-settings');
  importFileEl = document.getElementById('import-file');

  // Toast
  toastEl = document.getElementById('toast');
}

/**
 * Load settings from storage
 */
async function loadSettings() {
  try {
    const settings = await getSettings();

    // General settings
    numSuggestionsEl.value = settings.numSuggestions || 5;
    triggerMethodEl.value = settings.triggerMethod || 'dblclick';
    popupPositionEl.value = settings.popupPosition || 'near-word';
    themeEl.value = settings.theme || 'auto';
    showPOSTagsEl.checked = settings.showPOSTags !== false;
    autoDismissEl.checked = settings.autoDismissOnScroll !== false;

    // Site control
    enabledSitesEl.value = settings.enabledSites || 'all';
    updateSiteControlVisibility(settings.enabledSites);
    renderWhitelist(settings.whitelist || []);
    renderBlacklist(settings.blacklist || []);

    // LLM provider
    providerEl.value = settings.provider || 'none';
    updateProviderVisibility(settings.provider);

    if (settings.apiKeys) {
      openaiKeyEl.value = settings.apiKeys.openai || '';
      huggingfaceKeyEl.value = settings.apiKeys.huggingface || '';
    }

    if (settings.models) {
      openaiModelEl.value = settings.models.openai || 'gpt-3.5-turbo';
      huggingfaceModelEl.value = settings.models.huggingface || 'mistralai/Mistral-7B-Instruct-v0.2';
    }

    if (settings.customAPI) {
      customUrlEl.value = settings.customAPI.url || '';
      customHeadersEl.value = JSON.stringify(settings.customAPI.headers || {}, null, 2);
    }

    // Statistics
    wordsTodayEl.textContent = settings.stats?.wordsReplacedToday || 0;
    wordsTotalEl.textContent = settings.stats?.wordsReplacedTotal || 0;
  } catch (error) {
    console.error('Error loading settings:', error);
    showToast('Error loading settings', 'error');
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // General settings - auto-save on change
  numSuggestionsEl.addEventListener('change', () => {
    updateSetting('numSuggestions', parseInt(numSuggestionsEl.value, 10));
    showToast('Settings saved');
  });

  triggerMethodEl.addEventListener('change', () => {
    updateSetting('triggerMethod', triggerMethodEl.value);
    showToast('Settings saved');
  });

  popupPositionEl.addEventListener('change', () => {
    updateSetting('popupPosition', popupPositionEl.value);
    showToast('Settings saved');
  });

  themeEl.addEventListener('change', () => {
    updateSetting('theme', themeEl.value);
    showToast('Settings saved');
  });

  showPOSTagsEl.addEventListener('change', () => {
    updateSetting('showPOSTags', showPOSTagsEl.checked);
    showToast('Settings saved');
  });

  autoDismissEl.addEventListener('change', () => {
    updateSetting('autoDismissOnScroll', autoDismissEl.checked);
    showToast('Settings saved');
  });

  // Site control
  enabledSitesEl.addEventListener('change', async () => {
    await updateSetting('enabledSites', enabledSitesEl.value);
    updateSiteControlVisibility(enabledSitesEl.value);
    showToast('Settings saved');
  });

  addWhitelistBtn.addEventListener('click', () => addToWhitelist());
  whitelistInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addToWhitelist();
  });

  addBlacklistBtn.addEventListener('click', () => addToBlacklist());
  blacklistInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addToBlacklist();
  });

  // LLM Provider
  providerEl.addEventListener('change', async () => {
    await updateSetting('provider', providerEl.value);
    updateProviderVisibility(providerEl.value);
    showToast('Settings saved');
  });

  // API Keys and models - save on blur
  openaiKeyEl.addEventListener('blur', async () => {
    const settings = await getSettings();
    const apiKeys = settings.apiKeys || {};
    apiKeys.openai = openaiKeyEl.value;
    await updateSetting('apiKeys', apiKeys);
    showToast('API key saved');
  });

  openaiModelEl.addEventListener('blur', async () => {
    const settings = await getSettings();
    const models = settings.models || {};
    models.openai = openaiModelEl.value;
    await updateSetting('models', models);
    showToast('Model saved');
  });

  huggingfaceKeyEl.addEventListener('blur', async () => {
    const settings = await getSettings();
    const apiKeys = settings.apiKeys || {};
    apiKeys.huggingface = huggingfaceKeyEl.value;
    await updateSetting('apiKeys', apiKeys);
    showToast('API key saved');
  });

  huggingfaceModelEl.addEventListener('blur', async () => {
    const settings = await getSettings();
    const models = settings.models || {};
    models.huggingface = huggingfaceModelEl.value;
    await updateSetting('models', models);
    showToast('Model saved');
  });

  customUrlEl.addEventListener('blur', async () => {
    const settings = await getSettings();
    const customAPI = settings.customAPI || {};
    customAPI.url = customUrlEl.value;
    await updateSetting('customAPI', customAPI);
    showToast('API URL saved');
  });

  customHeadersEl.addEventListener('blur', async () => {
    try {
      const headers = JSON.parse(customHeadersEl.value);
      const settings = await getSettings();
      const customAPI = settings.customAPI || {};
      customAPI.headers = headers;
      await updateSetting('customAPI', customAPI);
      showToast('Headers saved');
    } catch (error) {
      showToast('Invalid JSON in headers', 'error');
    }
  });

  // Data management
  resetStatsBtn.addEventListener('click', resetStatistics);
  exportSettingsBtn.addEventListener('click', exportSettings);
  importSettingsBtn.addEventListener('click', () => importFileEl.click());
  importFileEl.addEventListener('change', importSettings);
  resetSettingsBtn.addEventListener('click', resetToDefaults);
}

/**
 * Update site control visibility based on mode
 */
function updateSiteControlVisibility(mode) {
  whitelistSection.style.display = mode === 'whitelist' ? 'block' : 'none';
  blacklistSection.style.display = mode === 'blacklist' ? 'block' : 'none';
}

/**
 * Update provider settings visibility
 */
function updateProviderVisibility(provider) {
  openaiSettings.style.display = provider === 'openai' ? 'block' : 'none';
  huggingfaceSettings.style.display = provider === 'huggingface' ? 'block' : 'none';
  customSettings.style.display = provider === 'custom' ? 'block' : 'none';
}

/**
 * Add site to whitelist
 */
async function addToWhitelist() {
  const hostname = whitelistInput.value.trim();
  if (!hostname) return;

  const settings = await getSettings();
  const whitelist = settings.whitelist || [];

  if (!whitelist.includes(hostname)) {
    whitelist.push(hostname);
    await updateSetting('whitelist', whitelist);
    renderWhitelist(whitelist);
    whitelistInput.value = '';
    showToast('Site added to whitelist');
  } else {
    showToast('Site already in whitelist', 'error');
  }
}

/**
 * Remove site from whitelist
 */
async function removeFromWhitelist(hostname) {
  const settings = await getSettings();
  const whitelist = settings.whitelist || [];
  const newWhitelist = whitelist.filter(h => h !== hostname);
  await updateSetting('whitelist', newWhitelist);
  renderWhitelist(newWhitelist);
  showToast('Site removed from whitelist');
}

/**
 * Render whitelist
 */
function renderWhitelist(whitelist) {
  whitelistList.innerHTML = '';

  if (whitelist.length === 0) {
    whitelistList.innerHTML = '<li style="color: var(--text-secondary); padding: 12px; text-align: center; border: none;">No whitelisted sites</li>';
    return;
  }

  whitelist.forEach(hostname => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="site-name">${hostname}</span>
      <button class="remove-btn" data-hostname="${hostname}">Remove</button>
    `;

    li.querySelector('.remove-btn').addEventListener('click', (e) => {
      removeFromWhitelist(e.target.dataset.hostname);
    });

    whitelistList.appendChild(li);
  });
}

/**
 * Add site to blacklist
 */
async function addToBlacklist() {
  const hostname = blacklistInput.value.trim();
  if (!hostname) return;

  const settings = await getSettings();
  const blacklist = settings.blacklist || [];

  if (!blacklist.includes(hostname)) {
    blacklist.push(hostname);
    await updateSetting('blacklist', blacklist);
    renderBlacklist(blacklist);
    blacklistInput.value = '';
    showToast('Site added to blacklist');
  } else {
    showToast('Site already in blacklist', 'error');
  }
}

/**
 * Remove site from blacklist
 */
async function removeFromBlacklist(hostname) {
  const settings = await getSettings();
  const blacklist = settings.blacklist || [];
  const newBlacklist = blacklist.filter(h => h !== hostname);
  await updateSetting('blacklist', newBlacklist);
  renderBlacklist(newBlacklist);
  showToast('Site removed from blacklist');
}

/**
 * Render blacklist
 */
function renderBlacklist(blacklist) {
  blacklistList.innerHTML = '';

  if (blacklist.length === 0) {
    blacklistList.innerHTML = '<li style="color: var(--text-secondary); padding: 12px; text-align: center; border: none;">No blacklisted sites</li>';
    return;
  }

  blacklist.forEach(hostname => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="site-name">${hostname}</span>
      <button class="remove-btn" data-hostname="${hostname}">Remove</button>
    `;

    li.querySelector('.remove-btn').addEventListener('click', (e) => {
      removeFromBlacklist(e.target.dataset.hostname);
    });

    blacklistList.appendChild(li);
  });
}

/**
 * Reset statistics
 */
async function resetStatistics() {
  if (!confirm('Reset all statistics? This cannot be undone.')) return;

  await updateSetting('stats', {
    wordsReplacedToday: 0,
    wordsReplacedTotal: 0,
    lastResetDate: new Date().toISOString()
  });

  wordsTodayEl.textContent = '0';
  wordsTotalEl.textContent = '0';
  showToast('Statistics reset');
}

/**
 * Export settings to JSON file
 */
async function exportSettings() {
  try {
    const settings = await getSettings();
    const json = JSON.stringify(settings, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `wordgen-settings-${new Date().toISOString().split('T')[0]}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showToast('Settings exported');
  } catch (error) {
    console.error('Export error:', error);
    showToast('Export failed', 'error');
  }
}

/**
 * Import settings from JSON file
 */
async function importSettings(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const settings = JSON.parse(text);

    // Save all settings
    await chrome.storage.sync.set(settings);

    // Reload the page to reflect new settings
    await loadSettings();
    showToast('Settings imported successfully');
  } catch (error) {
    console.error('Import error:', error);
    showToast('Import failed - invalid file', 'error');
  }

  // Reset file input
  importFileEl.value = '';
}

/**
 * Reset all settings to defaults
 */
async function resetToDefaults() {
  if (!confirm('Reset all settings to defaults? This cannot be undone.')) return;

  try {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    await loadSettings();
    showToast('Settings reset to defaults');
  } catch (error) {
    console.error('Reset error:', error);
    showToast('Reset failed', 'error');
  }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'success') {
  toastEl.textContent = message;
  toastEl.className = `toast ${type} show`;

  setTimeout(() => {
    toastEl.classList.remove('show');
  }, 3000);
}
