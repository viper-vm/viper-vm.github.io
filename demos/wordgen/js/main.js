/**
 * main.js
 * Main application entry point for WordGen
 */

import { getSettings, saveSettings, getProviderConfig } from './storage.js';
import { analyzeWord } from './nlp.js';
import { generateCandidates, rankCandidates, inflectCandidate, generateRephrases, filterCandidates } from './pipeline.js';
import { createProvider, testProvider } from './providers.js';
import { ToastManager, Modal, EditorManager, SuggestionsPanel, ThemeManager, initIcons } from './ui.js';

// Global instances
let toast;
let settingsModal;
let aboutModal;
let editor;
let suggestionsPanel;
let themeManager;
let currentProvider;
let currentWordInfo = null;
let currentSettings = {};

/**
 * Initialize the application
 */
async function init() {
  // Initialize UI components
  toast = new ToastManager();
  settingsModal = new Modal('settingsModal');
  aboutModal = new Modal('aboutModal');
  themeManager = new ThemeManager('themeToggle');
  suggestionsPanel = new SuggestionsPanel();

  // Initialize editor
  editor = new EditorManager('editor', handleWordSelection);

  // Load settings and provider
  currentSettings = getSettings();
  currentProvider = createProvider(getProviderConfig());

  // Setup event listeners
  setupEventListeners();

  // Load settings into UI
  loadSettingsIntoUI();

  // Initialize icons
  initIcons();

  // Show welcome message
  toast.info('WordGen loaded! Double-click any word to begin.', 5000);
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
  // Header buttons
  document.getElementById('settingsBtn').addEventListener('click', () => settingsModal.open());
  document.getElementById('aboutBtn').addEventListener('click', () => aboutModal.open());

  // Editor controls
  document.getElementById('loadDemoBtn').addEventListener('click', loadDemoText);
  document.getElementById('clearBtn').addEventListener('click', () => {
    if (confirm('Clear all text?')) {
      editor.clear();
      suggestionsPanel.showEmpty();
      toast.info('Editor cleared');
    }
  });

  // Settings modal
  document.getElementById('saveSettings').addEventListener('click', saveSettingsFromUI);
  document.getElementById('providerSelect').addEventListener('change', handleProviderChange);

  // Settings sliders
  document.getElementById('contextWindow').addEventListener('input', (e) => {
    document.getElementById('contextValue').textContent = e.target.value;
  });

  document.getElementById('maxChars').addEventListener('input', (e) => {
    document.getElementById('maxCharsValue').textContent = e.target.value;
  });

  // Rephrase presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => handleRephrasePreset(btn.dataset.preset));
  });

  // Filters in More tab
  document.getElementById('filterCommon').addEventListener('change', applyFilters);
  document.getElementById('filterFormal').addEventListener('change', applyFilters);
  document.getElementById('filterCasual').addEventListener('change', applyFilters);
}

/**
 * Handle word selection from editor
 */
async function handleWordSelection(word, start, end) {
  try {
    // Show loading state
    suggestionsPanel.showLoading();

    // Analyze the word
    const text = editor.getText();
    const wordInfo = analyzeWord(text, start, end);
    currentWordInfo = wordInfo;

    // Update target info in panel
    suggestionsPanel.setTargetInfo(
      wordInfo.word,
      wordInfo.pos,
      wordInfo.context.sentence.slice(0, 100)
    );

    // Generate candidates
    const candidates = await generateCandidates(wordInfo, currentProvider, currentSettings);

    if (candidates.length === 0) {
      suggestionsPanel.showContent();
      suggestionsPanel.renderSynonyms([], null);
      toast.warning('No synonyms found. Try a different word or configure an LLM provider.');
      return;
    }

    // Rank candidates
    const rankedCandidates = await rankCandidates(candidates, wordInfo, currentSettings);

    // Store for filtering
    currentWordInfo.allCandidates = rankedCandidates;

    // Show content
    suggestionsPanel.showContent();

    // Render top 5 in synonyms tab
    suggestionsPanel.renderSynonyms(rankedCandidates.slice(0, 5), handleApplySynonym);

    // Render extended list in More tab
    suggestionsPanel.renderMore(rankedCandidates.slice(5, 20), handleApplySynonym);

    // Switch to synonyms tab
    suggestionsPanel.switchTab('synonyms');

  } catch (error) {
    console.error('Error handling word selection:', error);
    toast.error('An error occurred while analyzing the word.');
    suggestionsPanel.showEmpty();
  }
}

/**
 * Handle applying a synonym
 */
function handleApplySynonym(candidate) {
  if (!currentWordInfo) return;

  try {
    // Inflect and capitalize the candidate to match original
    const inflected = inflectCandidate(candidate.word, currentWordInfo);

    // Replace in editor
    editor.replaceText(currentWordInfo.start, currentWordInfo.end, inflected);

    // Show success message
    toast.success(`Replaced "${currentWordInfo.word}" with "${inflected}"`);

    // Clear suggestions
    suggestionsPanel.showEmpty();
    currentWordInfo = null;
  } catch (error) {
    console.error('Error applying synonym:', error);
    toast.error('Failed to apply synonym');
  }
}

/**
 * Handle rephrase preset button click
 */
async function handleRephrasePreset(preset) {
  if (!currentWordInfo) {
    toast.warning('Select a word first');
    return;
  }

  try {
    // Show loading in rephrase list
    const rephraseList = document.getElementById('rephraseList');
    rephraseList.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Generating rephrases...</p></div>';

    // Switch to rephrase tab
    suggestionsPanel.switchTab('rephrase');

    // Generate rephrases
    const sentence = currentWordInfo.context.sentence;
    const rephrases = await generateRephrases(sentence, preset, currentProvider, currentSettings);

    // Render rephrases
    rephraseList.innerHTML = '';

    if (rephrases.length === 0) {
      rephraseList.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">No rephrases available. Configure an LLM provider for better results.</p>';
      return;
    }

    rephrases.forEach((rephrase, index) => {
      const card = document.createElement('div');
      card.className = 'suggestion-card';

      card.innerHTML = `
        <div class="suggestion-header">
          <div class="suggestion-word">${rephrase.text}</div>
        </div>
        <div class="suggestion-note">${rephrase.note || ''}</div>
        <div class="suggestion-footer">
          <div class="suggestion-score">
            ${rephrase.confidence ? `Confidence: ${Math.round(rephrase.confidence * 100)}%` : ''}
          </div>
          <button class="apply-btn">Apply</button>
        </div>
      `;

      const applyBtn = card.querySelector('.apply-btn');
      applyBtn.addEventListener('click', () => {
        // Find and replace the sentence in editor
        const text = editor.getText();
        const newText = text.replace(sentence, rephrase.text);
        editor.setText(newText);
        toast.success('Sentence rephrased');
        suggestionsPanel.showEmpty();
      });

      rephraseList.appendChild(card);
    });

    // Initialize icons
    initIcons();

  } catch (error) {
    console.error('Error generating rephrases:', error);
    toast.error('Failed to generate rephrases');
  }
}

/**
 * Apply filters in More tab
 */
function applyFilters() {
  if (!currentWordInfo || !currentWordInfo.allCandidates) return;

  const filters = {
    commonOnly: document.getElementById('filterCommon').checked,
    formal: document.getElementById('filterFormal').checked,
    casual: document.getElementById('filterCasual').checked
  };

  const filtered = filterCandidates(currentWordInfo.allCandidates, currentWordInfo, filters);
  suggestionsPanel.renderMore(filtered, handleApplySynonym);
}

/**
 * Load demo text
 */
async function loadDemoText() {
  try {
    const response = await fetch('assets/demo-texts.json');
    const data = await response.json();

    if (data.texts && data.texts.length > 0) {
      const randomText = data.texts[Math.floor(Math.random() * data.texts.length)];
      editor.setText(randomText.text);
      toast.success(`Loaded: ${randomText.title}`);
    }
  } catch (error) {
    console.error('Error loading demo text:', error);
    // Fallback demo text
    const fallbackText = `Machine learning has revolutionized how we approach complex problems in computer science. Modern neural networks can analyze vast amounts of data and identify patterns that would be impossible for humans to detect manually. This technology has applications in everything from medical diagnosis to autonomous vehicles.`;
    editor.setText(fallbackText);
    toast.info('Loaded demo text');
  }
}

/**
 * Load settings into UI elements
 */
function loadSettingsIntoUI() {
  const settings = getSettings();

  // Provider
  document.getElementById('providerSelect').value = settings.provider || 'none';

  // OpenAI
  document.getElementById('openaiEndpoint').value = settings.openai.endpoint || '';
  document.getElementById('openaiKey').value = settings.openai.apiKey || '';
  document.getElementById('openaiModel').value = settings.openai.model || '';

  // Hugging Face
  document.getElementById('hfKey').value = settings.huggingface.apiKey || '';
  document.getElementById('hfModel').value = settings.huggingface.model || '';

  // Custom
  document.getElementById('customUrl').value = settings.custom.url || '';
  document.getElementById('customHeaders').value = settings.custom.headers || '{}';

  // Context and style
  document.getElementById('contextWindow').value = settings.contextWindow || 300;
  document.getElementById('contextValue').textContent = settings.contextWindow || 300;

  document.getElementById('defaultFormality').value = settings.defaultFormality || 'neutral';
  document.getElementById('defaultBrevity').value = settings.defaultBrevity || 'keep';
  document.getElementById('domain').value = settings.domain || 'general';
  document.getElementById('avoidJargon').checked = settings.avoidJargon || false;

  document.getElementById('maxChars').value = settings.maxChars || 500;
  document.getElementById('maxCharsValue').textContent = settings.maxChars || 500;

  // Show/hide provider settings
  handleProviderChange();
}

/**
 * Handle provider dropdown change
 */
function handleProviderChange() {
  const provider = document.getElementById('providerSelect').value;

  // Hide all provider settings
  document.querySelectorAll('.provider-settings').forEach(el => {
    el.classList.add('hidden');
  });

  // Show selected provider settings
  if (provider === 'openai') {
    document.getElementById('openaiSettings').classList.remove('hidden');
  } else if (provider === 'huggingface') {
    document.getElementById('hfSettings').classList.remove('hidden');
  } else if (provider === 'custom') {
    document.getElementById('customSettings').classList.remove('hidden');
  }
}

/**
 * Save settings from UI
 */
async function saveSettingsFromUI() {
  const settings = {
    provider: document.getElementById('providerSelect').value,
    openai: {
      endpoint: document.getElementById('openaiEndpoint').value,
      apiKey: document.getElementById('openaiKey').value,
      model: document.getElementById('openaiModel').value
    },
    huggingface: {
      apiKey: document.getElementById('hfKey').value,
      model: document.getElementById('hfModel').value
    },
    custom: {
      url: document.getElementById('customUrl').value,
      headers: document.getElementById('customHeaders').value
    },
    contextWindow: parseInt(document.getElementById('contextWindow').value),
    defaultFormality: document.getElementById('defaultFormality').value,
    defaultBrevity: document.getElementById('defaultBrevity').value,
    domain: document.getElementById('domain').value,
    avoidJargon: document.getElementById('avoidJargon').checked,
    maxChars: parseInt(document.getElementById('maxChars').value)
  };

  // Save to storage
  saveSettings(settings);
  currentSettings = settings;

  // Update provider
  currentProvider = createProvider(getProviderConfig());

  // Test provider if not 'none'
  if (settings.provider !== 'none') {
    toast.info('Testing provider connection...');

    try {
      const isWorking = await testProvider(currentProvider);

      if (isWorking) {
        toast.success('Settings saved! Provider is working.');
      } else {
        toast.warning('Settings saved, but provider test failed. Check your credentials.');
      }
    } catch (error) {
      toast.warning('Settings saved, but could not test provider.');
    }
  } else {
    toast.success('Settings saved!');
  }

  settingsModal.close();
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
