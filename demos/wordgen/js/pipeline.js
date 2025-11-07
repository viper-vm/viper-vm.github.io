/**
 * pipeline.js
 * Core NLP pipeline for candidate generation, ranking, and rephrasing
 */

import { getLemma, applyInflection, preserveCapitalization } from './nlp.js';

// Lazy-loaded assets
let lexiconData = null;
let embeddingsData = null;
let ngramData = null;

/**
 * Load lexicon data
 * @returns {Promise<Object>} Lexicon object
 */
async function loadLexicon() {
  if (lexiconData) return lexiconData;

  try {
    const response = await fetch('assets/lexicon.json');
    lexiconData = await response.json();
    return lexiconData;
  } catch (error) {
    console.error('Error loading lexicon:', error);
    return {};
  }
}

/**
 * Load embeddings data
 * @returns {Promise<Object>} Embeddings object
 */
async function loadEmbeddings() {
  if (embeddingsData) return embeddingsData;

  try {
    const response = await fetch('assets/mini-embeddings.json');
    embeddingsData = await response.json();
    return embeddingsData;
  } catch (error) {
    console.error('Error loading embeddings:', error);
    return {};
  }
}

/**
 * Load n-gram frequency data
 * @returns {Promise<Object>} N-gram frequency object
 */
async function loadNgramData() {
  if (ngramData) return ngramData;

  try {
    const response = await fetch('assets/ngram-freq.json');
    ngramData = await response.json();
    return ngramData;
  } catch (error) {
    console.error('Error loading n-gram data:', error);
    return {};
  }
}

/**
 * Get lexical synonyms from built-in lexicon
 * @param {string} lemma - Lemma of the word
 * @param {string} pos - Part of speech
 * @returns {Promise<Array<string>>} Array of synonyms
 */
async function getLexicalSynonyms(lemma, pos) {
  const lexicon = await loadLexicon();

  const key = `${lemma}_${pos}`;
  if (lexicon[key]) {
    return lexicon[key].synonyms || [];
  }

  // Try with just lemma if POS-specific key not found
  if (lexicon[lemma]) {
    return lexicon[lemma].synonyms || [];
  }

  return [];
}

/**
 * Calculate cosine similarity between two vectors
 * @param {Array<number>} vec1 - First vector
 * @param {Array<number>} vec2 - Second vector
 * @returns {number} Cosine similarity
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
 * Get embedding-based synonyms using vector similarity
 * @param {string} lemma - Lemma of the word
 * @param {number} topK - Number of similar words to return
 * @returns {Promise<Array<Object>>} Array of {word, similarity}
 */
async function getEmbeddingSynonyms(lemma, topK = 10) {
  const embeddings = await loadEmbeddings();

  if (!embeddings[lemma]) {
    return [];
  }

  const targetVec = embeddings[lemma];
  const similarities = [];

  for (const [word, vec] of Object.entries(embeddings)) {
    if (word === lemma) continue;

    const sim = cosineSimilarity(targetVec, vec);
    if (sim > 0.5) { // Threshold for relevance
      similarities.push({ word, similarity: sim });
    }
  }

  // Sort by similarity and take top K
  similarities.sort((a, b) => b.similarity - a.similarity);
  return similarities.slice(0, topK);
}

/**
 * Calculate sentence embedding (average of word vectors)
 * @param {string} sentence - Input sentence
 * @returns {Promise<Array<number>|null>} Sentence vector
 */
async function getSentenceEmbedding(sentence) {
  const embeddings = await loadEmbeddings();
  const words = sentence.toLowerCase().match(/\b[\w'-]+\b/g) || [];

  if (words.length === 0) return null;

  const vectors = [];
  for (const word of words) {
    if (embeddings[word]) {
      vectors.push(embeddings[word]);
    }
  }

  if (vectors.length === 0) return null;

  // Average all vectors
  const dim = vectors[0].length;
  const avgVec = new Array(dim).fill(0);

  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      avgVec[i] += vec[i];
    }
  }

  for (let i = 0; i < dim; i++) {
    avgVec[i] /= vectors.length;
  }

  return avgVec;
}

/**
 * Calculate semantic preservation score
 * @param {string} originalSentence - Original sentence
 * @param {string} modifiedSentence - Sentence with replacement
 * @returns {Promise<number>} Similarity score (0-1)
 */
async function calculateSemanticScore(originalSentence, modifiedSentence) {
  const origVec = await getSentenceEmbedding(originalSentence);
  const modVec = await getSentenceEmbedding(modifiedSentence);

  if (!origVec || !modVec) return 0.5; // Neutral score if vectors unavailable

  return cosineSimilarity(origVec, modVec);
}

/**
 * Calculate fluency score based on n-gram frequencies
 * @param {string} sentence - Input sentence
 * @returns {Promise<number>} Fluency score (0-1)
 */
async function calculateFluencyScore(sentence) {
  const ngrams = await loadNgramData();
  const words = sentence.toLowerCase().match(/\b[\w'-]+\b/g) || [];

  if (words.length < 3) return 0.5;

  let totalScore = 0;
  let count = 0;

  // Calculate trigram scores
  for (let i = 0; i < words.length - 2; i++) {
    const trigram = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    const freq = ngrams[trigram] || 0;
    totalScore += Math.log(freq + 1); // Log frequency for normalization
    count++;
  }

  if (count === 0) return 0.5;

  // Normalize to 0-1 range (assuming max log freq is ~10)
  return Math.min(1, totalScore / (count * 10));
}

/**
 * Calculate style match score
 * @param {string} word - Candidate word
 * @param {Object} settings - User settings
 * @returns {number} Style score (0-1)
 */
function calculateStyleScore(word, settings) {
  let score = 0.5; // Base score

  // Length preference
  if (settings.defaultBrevity === 'shorter' && word.length <= 6) {
    score += 0.2;
  } else if (settings.defaultBrevity === 'longer' && word.length >= 8) {
    score += 0.2;
  }

  // Formality (simple heuristic based on word length and Latinate roots)
  const isFormal = word.length > 8 || /tion$|sion$|ance$|ence$/.test(word);
  if (settings.defaultFormality === 'formal' && isFormal) {
    score += 0.2;
  } else if (settings.defaultFormality === 'casual' && !isFormal) {
    score += 0.2;
  }

  return Math.min(1, score);
}

/**
 * Get register/formality label for a word
 * @param {string} word - Input word
 * @returns {string} 'formal', 'neutral', or 'casual'
 */
function getRegister(word) {
  const lowerWord = word.toLowerCase();

  // Formal indicators
  if (lowerWord.length > 10 || /tion$|sion$|ment$|ance$|ence$|ology$/.test(lowerWord)) {
    return 'formal';
  }

  // Casual indicators
  if (lowerWord.length <= 4 || /^(get|got|do|make|take|give)/.test(lowerWord)) {
    return 'casual';
  }

  return 'neutral';
}

/**
 * Get commonness label based on word frequency heuristics
 * @param {string} word - Input word
 * @returns {string} 'common' or 'uncommon'
 */
function getCommonness(word) {
  // Simple heuristics: shorter words and common patterns are more common
  if (word.length <= 6) return 'common';
  if (word.length > 10) return 'uncommon';
  return 'common';
}

/**
 * Generate synonym candidates for a word
 * @param {Object} wordInfo - Word analysis from nlp.js
 * @param {Object} provider - Optional LLM provider
 * @param {Object} settings - User settings
 * @returns {Promise<Array<Object>>} Array of candidate objects
 */
export async function generateCandidates(wordInfo, provider = null, settings = {}) {
  const { lemma, pos, word, context } = wordInfo;
  const candidates = new Map(); // Use Map to deduplicate

  // 1. Lexical synonyms
  try {
    const lexicalSyns = await getLexicalSynonyms(lemma, pos);
    for (const syn of lexicalSyns) {
      if (!candidates.has(syn) && syn.toLowerCase() !== word.toLowerCase()) {
        candidates.set(syn, {
          word: syn,
          source: 'lexical',
          register: getRegister(syn),
          commonness: getCommonness(syn),
          note: 'From built-in lexicon'
        });
      }
    }
  } catch (error) {
    console.error('Error getting lexical synonyms:', error);
  }

  // 2. Embedding-based synonyms
  try {
    const embeddingSyns = await getEmbeddingSynonyms(lemma, 10);
    for (const { word: syn, similarity } of embeddingSyns) {
      if (!candidates.has(syn) && syn.toLowerCase() !== word.toLowerCase()) {
        candidates.set(syn, {
          word: syn,
          source: 'embedding',
          similarity,
          register: getRegister(syn),
          commonness: getCommonness(syn),
          note: `Semantically similar (${(similarity * 100).toFixed(0)}%)`
        });
      }
    }
  } catch (error) {
    console.error('Error getting embedding synonyms:', error);
  }

  // 3. LLM-based candidates (if provider configured)
  if (provider && provider.type !== 'none') {
    try {
      const llmCandidates = await provider.getSynonyms(wordInfo, settings);
      for (const candidate of llmCandidates) {
        if (!candidates.has(candidate.word) && candidate.word.toLowerCase() !== word.toLowerCase()) {
          candidates.set(candidate.word, {
            ...candidate,
            source: 'llm'
          });
        }
      }
    } catch (error) {
      console.error('Error getting LLM synonyms:', error);
    }
  }

  return Array.from(candidates.values());
}

/**
 * Rank candidates based on context and style
 * @param {Array<Object>} candidates - Candidate objects
 * @param {Object} wordInfo - Original word info
 * @param {Object} settings - User settings
 * @returns {Promise<Array<Object>>} Ranked candidates with scores
 */
export async function rankCandidates(candidates, wordInfo, settings = {}) {
  const { context, word, pos } = wordInfo;
  const scoredCandidates = [];

  for (const candidate of candidates) {
    // Create modified sentence
    const modifiedSentence = context.before + candidate.word + context.after;

    // Calculate scores
    const semanticScore = await calculateSemanticScore(context.sentence, modifiedSentence);
    const fluencyScore = await calculateFluencyScore(modifiedSentence);
    const styleScore = calculateStyleScore(candidate.word, settings);

    // Weighted combination (55% semantic, 30% fluency, 15% style)
    const totalScore = (semanticScore * 0.55) + (fluencyScore * 0.30) + (styleScore * 0.15);

    scoredCandidates.push({
      ...candidate,
      scores: {
        semantic: semanticScore,
        fluency: fluencyScore,
        style: styleScore,
        total: totalScore
      }
    });
  }

  // Sort by total score (descending)
  scoredCandidates.sort((a, b) => b.scores.total - a.scores.total);

  return scoredCandidates;
}

/**
 * Apply inflection and capitalization to a candidate
 * @param {string} candidate - Base candidate word
 * @param {Object} wordInfo - Original word info
 * @returns {string} Inflected and capitalized candidate
 */
export function inflectCandidate(candidate, wordInfo) {
  const { word, pos } = wordInfo;

  // Apply inflection
  let inflected = applyInflection(candidate, word, pos);

  // Preserve capitalization
  inflected = preserveCapitalization(word, inflected);

  return inflected;
}

/**
 * Generate rephrase options for a sentence
 * @param {string} sentence - Input sentence
 * @param {string} preset - Rephrase preset ('shorter', 'clearer', 'formal', 'casual')
 * @param {Object} provider - Optional LLM provider
 * @param {Object} settings - User settings
 * @returns {Promise<Array<Object>>} Array of rephrase options
 */
export async function generateRephrases(sentence, preset, provider = null, settings = {}) {
  const rephrases = [];

  // If provider available, use LLM
  if (provider && provider.type !== 'none') {
    try {
      const llmRephrases = await provider.rephrase(sentence, preset, settings);
      return llmRephrases;
    } catch (error) {
      console.error('Error getting LLM rephrases:', error);
    }
  }

  // Fallback: rule-based rephrasing (basic)
  rephrases.push(...generateRuleBasedRephrases(sentence, preset));

  return rephrases;
}

/**
 * Rule-based rephrase generation (fallback)
 * @param {string} sentence - Input sentence
 * @param {string} preset - Rephrase preset
 * @returns {Array<Object>} Rephrase options
 */
function generateRuleBasedRephrases(sentence, preset) {
  const options = [];

  switch (preset) {
    case 'shorter':
      // Remove filler words
      let shorter = sentence
        .replace(/\b(very|really|quite|just|actually|basically|literally)\s+/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      options.push({
        text: shorter,
        note: 'Removed filler words',
        confidence: 0.7
      });

      // Use contractions
      shorter = sentence
        .replace(/\bdo not\b/gi, "don't")
        .replace(/\bcannot\b/gi, "can't")
        .replace(/\bwill not\b/gi, "won't")
        .replace(/\bis not\b/gi, "isn't")
        .replace(/\bare not\b/gi, "aren't");
      if (shorter !== sentence) {
        options.push({
          text: shorter,
          note: 'Used contractions',
          confidence: 0.8
        });
      }
      break;

    case 'clearer':
      // Split long sentences
      if (sentence.length > 80) {
        const words = sentence.split(/\s+/);
        const mid = Math.floor(words.length / 2);
        const part1 = words.slice(0, mid).join(' ') + '.';
        const part2 = words.slice(mid).join(' ');
        options.push({
          text: part1 + ' ' + part2,
          note: 'Split into shorter sentences',
          confidence: 0.6
        });
      }
      options.push({
        text: sentence,
        note: 'Consider breaking complex clauses',
        confidence: 0.5
      });
      break;

    case 'formal':
      // Expand contractions
      let formal = sentence
        .replace(/don't/gi, 'do not')
        .replace(/can't/gi, 'cannot')
        .replace(/won't/gi, 'will not')
        .replace(/isn't/gi, 'is not')
        .replace(/aren't/gi, 'are not');
      options.push({
        text: formal,
        note: 'Expanded contractions',
        confidence: 0.8
      });
      break;

    case 'casual':
      // Use contractions (same as shorter)
      let casual = sentence
        .replace(/\bdo not\b/gi, "don't")
        .replace(/\bcannot\b/gi, "can't")
        .replace(/\bwill not\b/gi, "won't");
      options.push({
        text: casual,
        note: 'Used contractions for casual tone',
        confidence: 0.7
      });
      break;

    default:
      options.push({
        text: sentence,
        note: 'No local rephrase available',
        confidence: 0.3
      });
  }

  // Remove duplicates and the original
  const unique = options.filter((opt, idx, arr) =>
    opt.text !== sentence &&
    arr.findIndex(o => o.text === opt.text) === idx
  );

  return unique.length > 0 ? unique : [{
    text: sentence,
    note: 'Configure an LLM provider for better rephrasing',
    confidence: 0.3
  }];
}

/**
 * Filter candidates based on constraints
 * @param {Array<Object>} candidates - Candidate objects
 * @param {Object} wordInfo - Original word info
 * @param {Object} filters - Filter criteria
 * @returns {Array<Object>} Filtered candidates
 */
export function filterCandidates(candidates, wordInfo, filters = {}) {
  let filtered = [...candidates];

  // Filter by register
  if (filters.formal) {
    filtered = filtered.filter(c => c.register === 'formal');
  }
  if (filters.casual) {
    filtered = filtered.filter(c => c.register === 'casual');
  }

  // Filter by commonness
  if (filters.commonOnly) {
    filtered = filtered.filter(c => c.commonness === 'common');
  }

  // Exclude named entities if original is not a named entity
  if (!wordInfo.isNamedEntity) {
    filtered = filtered.filter(c => {
      const firstChar = c.word[0];
      return firstChar === firstChar.toLowerCase() || c.word === c.word.toUpperCase();
    });
  }

  // Exclude words that are too similar to original
  const originalLower = wordInfo.word.toLowerCase();
  filtered = filtered.filter(c =>
    c.word.toLowerCase() !== originalLower &&
    !c.word.toLowerCase().includes(originalLower) &&
    !originalLower.includes(c.word.toLowerCase())
  );

  return filtered;
}
