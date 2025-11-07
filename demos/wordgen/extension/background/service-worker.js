/**
 * service-worker.js
 * Background service worker for WordGen Chrome Extension
 */

import { getSettings, incrementWordCount } from '../shared/storage-adapter.js';
import { analyzeWord } from '../shared/nlp.js';

// Cached assets for performance
let lexiconData = null;
let embeddingsData = null;
let ngramData = null;

/**
 * Load and cache extension assets on installation
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('WordGen extension installed/updated');

  // Load assets into memory
  try {
    lexiconData = await fetchAsset('assets/lexicon.json');
    embeddingsData = await fetchAsset('assets/mini-embeddings.json');
    ngramData = await fetchAsset('assets/ngram-freq.json');
    console.log('WordGen assets loaded successfully');
  } catch (error) {
    console.error('Error loading WordGen assets:', error);
  }

  // Create context menu
  chrome.contextMenus.create({
    id: 'wordgen-find-synonyms',
    title: 'Find Synonyms with WordGen',
    contexts: ['selection']
  });

  // Set default settings if first install
  if (details.reason === 'install') {
    const { DEFAULT_SETTINGS } = await import('../shared/storage-adapter.js');
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
});

/**
 * Fetch and parse JSON asset
 */
async function fetchAsset(path) {
  const url = chrome.runtime.getURL(path);
  const response = await fetch(url);
  return await response.json();
}

/**
 * Handle context menu clicks
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'wordgen-find-synonyms' && info.selectionText) {
    // Send message to content script to show synonyms
    chrome.tabs.sendMessage(tab.id, {
      action: 'showSynonymsFromContext',
      word: info.selectionText.trim()
    });
  }
});

/**
 * Handle messages from content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSynonyms') {
    handleGetSynonyms(request, sender).then(sendResponse);
    return true; // Async response
  }

  if (request.action === 'wordReplaced') {
    incrementWordCount().then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === 'openWebApp') {
    chrome.tabs.create({
      url: 'https://viper-vm.github.io/demos/wordgen/'
    });
    sendResponse({ success: true });
  }

  if (request.action === 'checkEnabled') {
    checkIfEnabled(request.hostname).then(sendResponse);
    return true;
  }
});

/**
 * Process synonym request
 */
async function handleGetSynonyms(request, sender) {
  try {
    const { word, context } = request;

    // Get settings
    const settings = await getSettings();
    const limit = settings.numSuggestions || 5;

    // Analyze word
    const text = context || word;
    const wordInfo = analyzeWord(text, 0, word.length);

    // Generate candidates
    const candidates = await generateCandidates(wordInfo, settings);

    // Rank candidates
    const ranked = await rankCandidates(candidates, wordInfo, settings);

    // Return top N
    return {
      success: true,
      synonyms: ranked.slice(0, limit),
      wordInfo: {
        word: wordInfo.word,
        lemma: wordInfo.lemma,
        pos: wordInfo.pos
      }
    };
  } catch (error) {
    console.error('Error generating synonyms:', error);
    return {
      success: false,
      error: error.message,
      synonyms: []
    };
  }
}

/**
 * Generate synonym candidates
 */
async function generateCandidates(wordInfo, settings) {
  const candidates = new Map();
  const { lemma, pos } = wordInfo;

  // 1. Lexical synonyms from built-in lexicon
  if (lexiconData) {
    const key = `${lemma}_${pos}`;
    const syns = lexiconData[key]?.synonyms || lexiconData[lemma]?.synonyms || [];

    for (const syn of syns) {
      if (!candidates.has(syn) && syn.toLowerCase() !== wordInfo.word.toLowerCase()) {
        candidates.set(syn, {
          word: syn,
          source: 'lexical',
          register: getRegister(syn),
          commonness: getCommonness(syn),
          note: 'From built-in lexicon',
          score: 0.7
        });
      }
    }
  }

  // 2. Embedding-based synonyms
  if (embeddingsData && embeddingsData[lemma]) {
    const targetVec = embeddingsData[lemma];
    const similarities = [];

    for (const [word, vec] of Object.entries(embeddingsData)) {
      if (word === lemma) continue;

      const sim = cosineSimilarity(targetVec, vec);
      if (sim > 0.5) {
        similarities.push({ word, similarity: sim });
      }
    }

    similarities.sort((a, b) => b.similarity - a.similarity);

    for (const { word: syn, similarity } of similarities.slice(0, 10)) {
      if (!candidates.has(syn) && syn.toLowerCase() !== wordInfo.word.toLowerCase()) {
        candidates.set(syn, {
          word: syn,
          source: 'embedding',
          similarity,
          register: getRegister(syn),
          commonness: getCommonness(syn),
          note: `Semantically similar (${Math.round(similarity * 100)}%)`,
          score: similarity
        });
      }
    }
  }

  return Array.from(candidates.values());
}

/**
 * Rank candidates by score
 */
async function rankCandidates(candidates, wordInfo, settings) {
  // Simple ranking by score for now
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Calculate cosine similarity
 */
function cosineSimilarity(vec1, vec2) {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Get register/formality label
 */
function getRegister(word) {
  const lowerWord = word.toLowerCase();
  if (lowerWord.length > 10 || /tion$|sion$|ment$|ance$|ence$/.test(lowerWord)) {
    return 'formal';
  }
  if (lowerWord.length <= 4) {
    return 'casual';
  }
  return 'neutral';
}

/**
 * Get commonness label
 */
function getCommonness(word) {
  return word.length <= 6 ? 'common' : 'uncommon';
}

/**
 * Check if extension is enabled for hostname
 */
async function checkIfEnabled(hostname) {
  const settings = await getSettings();

  if (settings.enabledSites === 'all') {
    return { enabled: true };
  }

  if (settings.enabledSites === 'whitelist') {
    return { enabled: settings.whitelist.includes(hostname) };
  }

  if (settings.enabledSites === 'blacklist') {
    return { enabled: !settings.blacklist.includes(hostname) };
  }

  return { enabled: true };
}

// Keep service worker alive
chrome.runtime.onStartup.addListener(() => {
  console.log('WordGen service worker started');
});
