/**
 * storage-adapter.js
 * Chrome storage API wrapper for extension settings
 */

// Default settings for the extension
export const DEFAULT_SETTINGS = {
  // Core settings
  numSuggestions: 5,
  autoDismissOnScroll: true,
  showPOSTags: true,
  popupPosition: 'near-word', // 'near-word' | 'fixed-bottom-right'
  theme: 'auto', // 'auto' | 'light' | 'dark'

  // Site control
  enabledSites: 'all', // 'all' | 'whitelist' | 'blacklist'
  whitelist: [],
  blacklist: [],

  // Trigger method
  triggerMethod: 'dblclick', // 'dblclick' | 'ctrl-click' | 'context-menu-only'

  // LLM Provider
  provider: 'none',
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    model: 'gpt-3.5-turbo'
  },
  huggingface: {
    apiKey: '',
    model: 'mistralai/Mistral-7B-Instruct-v0.2'
  },
  custom: {
    url: '',
    headers: '{}'
  },

  // Context and style
  contextWindow: 300,
  defaultFormality: 'neutral',
  defaultBrevity: 'keep',
  domain: 'general',
  avoidJargon: false,
  maxChars: 500,

  // Stats
  stats: {
    wordsReplacedToday: 0,
    wordsReplacedTotal: 0,
    lastReset: Date.now()
  }
};

/**
 * Get all settings from Chrome storage
 * @returns {Promise<Object>} Settings object
 */
export async function getSettings() {
  try {
    const result = await chrome.storage.sync.get(null);
    return { ...DEFAULT_SETTINGS, ...result };
  } catch (error) {
    console.error('Error loading settings from Chrome storage:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings to Chrome storage
 * @param {Object} settings - Settings object
 * @returns {Promise<boolean>} Success status
 */
export async function saveSettings(settings) {
  try {
    const toSave = { ...DEFAULT_SETTINGS, ...settings };
    await chrome.storage.sync.set(toSave);
    return true;
  } catch (error) {
    console.error('Error saving settings to Chrome storage:', error);
    return false;
  }
}

/**
 * Get a single setting
 * @param {string} key - Setting key
 * @param {*} defaultValue - Default value if not found
 * @returns {Promise<*>} Setting value
 */
export async function getSetting(key, defaultValue = null) {
  try {
    const result = await chrome.storage.sync.get(key);
    return result[key] !== undefined ? result[key] : (DEFAULT_SETTINGS[key] || defaultValue);
  } catch (error) {
    console.error(`Error getting setting ${key}:`, error);
    return defaultValue;
  }
}

/**
 * Update a single setting
 * @param {string} key - Setting key
 * @param {*} value - New value
 * @returns {Promise<boolean>} Success status
 */
export async function updateSetting(key, value) {
  try {
    await chrome.storage.sync.set({ [key]: value });
    return true;
  } catch (error) {
    console.error(`Error updating setting ${key}:`, error);
    return false;
  }
}

/**
 * Reset all settings to defaults
 * @returns {Promise<boolean>} Success status
 */
export async function resetSettings() {
  try {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    return true;
  } catch (error) {
    console.error('Error resetting settings:', error);
    return false;
  }
}

/**
 * Increment word replaced counter
 * @returns {Promise<void>}
 */
export async function incrementWordCount() {
  try {
    const settings = await getSettings();
    const now = Date.now();
    const lastReset = settings.stats.lastReset;

    // Reset daily counter if it's a new day
    const oneDayMs = 24 * 60 * 60 * 1000;
    const shouldReset = (now - lastReset) > oneDayMs;

    if (shouldReset) {
      settings.stats.wordsReplacedToday = 1;
      settings.stats.lastReset = now;
    } else {
      settings.stats.wordsReplacedToday++;
    }

    settings.stats.wordsReplacedTotal++;

    await chrome.storage.sync.set({ stats: settings.stats });
  } catch (error) {
    console.error('Error incrementing word count:', error);
  }
}

/**
 * Check if extension is enabled for current site
 * @param {string} hostname - Current site hostname
 * @returns {Promise<boolean>} True if enabled
 */
export async function isEnabledForSite(hostname) {
  try {
    const settings = await getSettings();

    if (settings.enabledSites === 'all') {
      return true;
    }

    if (settings.enabledSites === 'whitelist') {
      return settings.whitelist.includes(hostname);
    }

    if (settings.enabledSites === 'blacklist') {
      return !settings.blacklist.includes(hostname);
    }

    return true;
  } catch (error) {
    console.error('Error checking site enablement:', error);
    return true; // Default to enabled on error
  }
}

/**
 * Export settings as JSON string
 * @returns {Promise<string>} JSON string
 */
export async function exportSettings() {
  const settings = await getSettings();
  return JSON.stringify(settings, null, 2);
}

/**
 * Import settings from JSON string
 * @param {string} jsonString - JSON string
 * @returns {Promise<boolean>} Success status
 */
export async function importSettings(jsonString) {
  try {
    const settings = JSON.parse(jsonString);
    return await saveSettings(settings);
  } catch (error) {
    console.error('Error importing settings:', error);
    return false;
  }
}

/**
 * Listen for storage changes
 * @param {Function} callback - Callback function(changes, areaName)
 */
export function onSettingsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      callback(changes, areaName);
    }
  });
}
