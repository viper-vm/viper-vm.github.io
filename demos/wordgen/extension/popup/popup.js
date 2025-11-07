/**
 * popup.js
 * Popup UI logic for extension
 */

import { getSettings, updateSetting, isEnabledForSite } from '../shared/storage-adapter.js';

// DOM elements
let wordsTodayEl, wordsTotalEl, currentSiteEl, siteEnabledEl;
let numSuggestionsEl, triggerMethodEl;
let openWebappBtn, openSettingsBtn;

// Current hostname
let currentHostname = '';

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  // Get DOM elements
  wordsTodayEl = document.getElementById('words-today');
  wordsTotalEl = document.getElementById('words-total');
  currentSiteEl = document.getElementById('current-site');
  siteEnabledEl = document.getElementById('site-enabled');
  numSuggestionsEl = document.getElementById('num-suggestions');
  triggerMethodEl = document.getElementById('trigger-method');
  openWebappBtn = document.getElementById('open-webapp');
  openSettingsBtn = document.getElementById('open-settings');

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    const url = new URL(tab.url);
    currentHostname = url.hostname;
    currentSiteEl.textContent = currentHostname || 'Unknown';
  }

  // Load settings and stats
  await loadData();

  // Setup event listeners
  setupEventListeners();
});

/**
 * Load settings and stats
 */
async function loadData() {
  try {
    const settings = await getSettings();

    // Update stats
    wordsTodayEl.textContent = settings.stats?.wordsReplacedToday || 0;
    wordsTotalEl.textContent = settings.stats?.wordsReplacedTotal || 0;

    // Update quick settings
    numSuggestionsEl.value = settings.numSuggestions || 5;
    triggerMethodEl.value = settings.triggerMethod || 'dblclick';

    // Check if enabled for current site
    if (currentHostname) {
      const enabled = await isEnabledForSite(currentHostname);
      siteEnabledEl.checked = enabled;
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Open web app
  openWebappBtn.addEventListener('click', () => {
    chrome.tabs.create({
      url: 'https://viper-vm.github.io/demos/wordgen/'
    });
    window.close();
  });

  // Open settings
  openSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // Site enable/disable toggle
  siteEnabledEl.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await toggleSiteEnabled(enabled);
  });

  // Number of suggestions
  numSuggestionsEl.addEventListener('change', async (e) => {
    const value = parseInt(e.target.value, 10);
    await updateSetting('numSuggestions', value);
  });

  // Trigger method
  triggerMethodEl.addEventListener('change', async (e) => {
    const value = e.target.value;
    await updateSetting('triggerMethod', value);
  });
}

/**
 * Toggle site enabled/disabled
 */
async function toggleSiteEnabled(enabled) {
  try {
    const settings = await getSettings();

    if (settings.enabledSites === 'all') {
      // Switch to blacklist mode
      if (!enabled) {
        await updateSetting('enabledSites', 'blacklist');
        await updateSetting('blacklist', [currentHostname]);
      }
    } else if (settings.enabledSites === 'whitelist') {
      // Add or remove from whitelist
      const whitelist = settings.whitelist || [];
      if (enabled && !whitelist.includes(currentHostname)) {
        whitelist.push(currentHostname);
        await updateSetting('whitelist', whitelist);
      } else if (!enabled && whitelist.includes(currentHostname)) {
        const newWhitelist = whitelist.filter(h => h !== currentHostname);
        await updateSetting('whitelist', newWhitelist);
      }
    } else if (settings.enabledSites === 'blacklist') {
      // Add or remove from blacklist
      const blacklist = settings.blacklist || [];
      if (!enabled && !blacklist.includes(currentHostname)) {
        blacklist.push(currentHostname);
        await updateSetting('blacklist', blacklist);
      } else if (enabled && blacklist.includes(currentHostname)) {
        const newBlacklist = blacklist.filter(h => h !== currentHostname);
        await updateSetting('blacklist', newBlacklist);
      }
    }

    // Reload the current tab to apply changes
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.reload(tab.id);
    }
  } catch (error) {
    console.error('Error toggling site:', error);
  }
}
