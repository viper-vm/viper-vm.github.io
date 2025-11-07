/**
 * storage.js
 * LocalStorage helpers for WordGen settings persistence
 */

const STORAGE_KEY = 'wordgen_settings';
const THEME_KEY = 'wordgen_theme';

/**
 * Default settings structure
 */
const DEFAULT_SETTINGS = {
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
  contextWindow: 300,
  defaultFormality: 'neutral',
  defaultBrevity: 'keep',
  domain: 'general',
  avoidJargon: false,
  maxChars: 500
};

/**
 * Get all settings from localStorage
 * @returns {Object} Settings object
 */
export function getSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to ensure all fields exist
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Save settings to localStorage
 * @param {Object} settings - Settings object to save
 * @returns {boolean} Success status
 */
export function saveSettings(settings) {
  try {
    const toSave = { ...DEFAULT_SETTINGS, ...settings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}

/**
 * Update a single setting field
 * @param {string} key - Setting key (supports dot notation for nested)
 * @param {*} value - New value
 * @returns {boolean} Success status
 */
export function updateSetting(key, value) {
  const settings = getSettings();

  // Handle nested keys (e.g., 'openai.apiKey')
  const keys = key.split('.');
  let current = settings;

  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }

  current[keys[keys.length - 1]] = value;

  return saveSettings(settings);
}

/**
 * Get a single setting value
 * @param {string} key - Setting key (supports dot notation)
 * @param {*} defaultValue - Default value if not found
 * @returns {*} Setting value
 */
export function getSetting(key, defaultValue = null) {
  const settings = getSettings();
  const keys = key.split('.');
  let current = settings;

  for (const k of keys) {
    if (current[k] === undefined) {
      return defaultValue;
    }
    current = current[k];
  }

  return current;
}

/**
 * Reset settings to defaults
 * @returns {boolean} Success status
 */
export function resetSettings() {
  return saveSettings(DEFAULT_SETTINGS);
}

/**
 * Get current theme
 * @returns {string} 'light' or 'dark'
 */
export function getTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch (error) {
    console.error('Error loading theme:', error);
  }

  // Default to light theme
  return 'light';
}

/**
 * Save theme preference
 * @param {string} theme - 'light' or 'dark'
 * @returns {boolean} Success status
 */
export function saveTheme(theme) {
  try {
    if (theme !== 'light' && theme !== 'dark') {
      console.error('Invalid theme:', theme);
      return false;
    }
    localStorage.setItem(THEME_KEY, theme);
    return true;
  } catch (error) {
    console.error('Error saving theme:', error);
    return false;
  }
}

/**
 * Toggle theme between light and dark
 * @returns {string} New theme
 */
export function toggleTheme() {
  const current = getTheme();
  const newTheme = current === 'light' ? 'dark' : 'light';
  saveTheme(newTheme);
  return newTheme;
}

/**
 * Export settings as JSON string (for backup)
 * @returns {string} JSON string
 */
export function exportSettings() {
  const settings = getSettings();
  return JSON.stringify(settings, null, 2);
}

/**
 * Import settings from JSON string
 * @param {string} jsonString - JSON string to import
 * @returns {boolean} Success status
 */
export function importSettings(jsonString) {
  try {
    const settings = JSON.parse(jsonString);
    return saveSettings(settings);
  } catch (error) {
    console.error('Error importing settings:', error);
    return false;
  }
}

/**
 * Clear all WordGen data from localStorage
 */
export function clearAll() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(THEME_KEY);
    return true;
  } catch (error) {
    console.error('Error clearing storage:', error);
    return false;
  }
}

/**
 * Check if API provider is configured
 * @returns {boolean} True if provider has necessary credentials
 */
export function isProviderConfigured() {
  const settings = getSettings();

  switch (settings.provider) {
    case 'none':
      return true; // Local mode always works

    case 'openai':
      return Boolean(settings.openai.apiKey && settings.openai.endpoint);

    case 'huggingface':
      return Boolean(settings.huggingface.apiKey);

    case 'custom':
      return Boolean(settings.custom.url);

    default:
      return false;
  }
}

/**
 * Get active provider configuration
 * @returns {Object} Provider config
 */
export function getProviderConfig() {
  const settings = getSettings();

  switch (settings.provider) {
    case 'openai':
      return {
        type: 'openai',
        endpoint: settings.openai.endpoint,
        apiKey: settings.openai.apiKey,
        model: settings.openai.model
      };

    case 'huggingface':
      return {
        type: 'huggingface',
        apiKey: settings.huggingface.apiKey,
        model: settings.huggingface.model
      };

    case 'custom':
      let headers = {};
      try {
        headers = JSON.parse(settings.custom.headers || '{}');
      } catch (e) {
        console.error('Invalid custom headers JSON:', e);
      }
      return {
        type: 'custom',
        url: settings.custom.url,
        headers
      };

    case 'none':
    default:
      return {
        type: 'none'
      };
  }
}
