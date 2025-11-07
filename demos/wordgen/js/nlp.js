/**
 * nlp.js
 * Lightweight NLP utilities for tokenization, POS tagging, and sentence splitting
 * No external dependencies - optimized for browser use
 */

/**
 * Simple sentence splitter using common sentence boundaries
 * @param {string} text - Input text
 * @returns {Array<Object>} Array of sentence objects with {text, start, end}
 */
export function splitSentences(text) {
  if (!text || !text.trim()) return [];

  const sentences = [];
  // Enhanced regex for sentence boundaries
  const sentenceEndings = /([.!?][\s\n]+|[.!?]$)/g;
  let lastIndex = 0;
  let match;

  const matches = [];
  while ((match = sentenceEndings.exec(text)) !== null) {
    matches.push({ index: match.index, length: match[0].length });
  }

  if (matches.length === 0) {
    // No sentence endings found, treat whole text as one sentence
    return [{ text: text.trim(), start: 0, end: text.length }];
  }

  matches.forEach((match, i) => {
    const end = match.index + match.length;
    const sentenceText = text.substring(lastIndex, end).trim();

    if (sentenceText.length > 0) {
      sentences.push({
        text: sentenceText,
        start: lastIndex,
        end: end
      });
    }

    lastIndex = end;
  });

  // Add remaining text if any
  if (lastIndex < text.length) {
    const remaining = text.substring(lastIndex).trim();
    if (remaining.length > 0) {
      sentences.push({
        text: remaining,
        start: lastIndex,
        end: text.length
      });
    }
  }

  return sentences;
}

/**
 * Tokenize text into words
 * @param {string} text - Input text
 * @returns {Array<Object>} Array of token objects with {word, start, end}
 */
export function tokenize(text) {
  if (!text) return [];

  const tokens = [];
  // Match word characters including hyphens and apostrophes
  const wordRegex = /\b[\w'-]+\b/g;
  let match;

  while ((match = wordRegex.exec(text)) !== null) {
    tokens.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }

  return tokens;
}

/**
 * Simple POS tagging using heuristics and common patterns
 * @param {string} word - Word to tag
 * @param {string} context - Surrounding context (optional)
 * @returns {string} POS tag (noun, verb, adj, adv, etc.)
 */
export function getPOS(word, context = '') {
  if (!word) return 'unknown';

  const lowerWord = word.toLowerCase();

  // Common determiners, pronouns, conjunctions, prepositions
  const determiners = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their']);
  const pronouns = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'who', 'what', 'which']);
  const conjunctions = new Set(['and', 'but', 'or', 'nor', 'for', 'yet', 'so', 'because', 'although', 'if', 'when', 'while']);
  const prepositions = new Set(['in', 'on', 'at', 'to', 'from', 'by', 'with', 'about', 'under', 'over', 'between', 'through', 'during', 'before', 'after']);
  const modals = new Set(['can', 'could', 'may', 'might', 'will', 'would', 'shall', 'should', 'must']);

  if (determiners.has(lowerWord)) return 'det';
  if (pronouns.has(lowerWord)) return 'pron';
  if (conjunctions.has(lowerWord)) return 'conj';
  if (prepositions.has(lowerWord)) return 'prep';
  if (modals.has(lowerWord)) return 'modal';

  // Common verb endings
  if (/ing$/.test(lowerWord)) return 'verb'; // gerund/present participle
  if (/ed$/.test(lowerWord)) return 'verb'; // past tense
  if (/s$/.test(lowerWord) && lowerWord.length > 2) {
    // Could be plural noun or verb
    // Simple heuristic: if preceded by a determiner, likely noun
    if (context.match(/\b(the|a|an|these|those)\s+\w+$/i)) {
      return 'noun';
    }
    return 'verb'; // third person singular
  }

  // Common adjective endings
  if (/able$|ible$|al$|ful$|ic$|ive$|less$|ous$/.test(lowerWord)) return 'adj';
  if (/er$|est$/.test(lowerWord) && lowerWord.length > 3) return 'adj'; // comparative/superlative

  // Common adverb endings
  if (/ly$/.test(lowerWord) && lowerWord.length > 3) return 'adv';

  // Common noun endings
  if (/tion$|sion$|ness$|ment$|ance$|ence$|ship$|hood$|dom$|ism$/.test(lowerWord)) return 'noun';

  // Capitalized words (not at sentence start) are likely proper nouns
  if (word[0] === word[0].toUpperCase() && word !== word.toUpperCase()) {
    return 'propn';
  }

  // Default to noun (most common POS)
  return 'noun';
}

/**
 * Get lemma (base form) of a word
 * @param {string} word - Word to lemmatize
 * @param {string} pos - Part of speech tag
 * @returns {string} Lemma
 */
export function getLemma(word, pos = 'noun') {
  if (!word) return '';

  const lowerWord = word.toLowerCase();

  // Common irregular verbs
  const irregularVerbs = {
    'was': 'be', 'were': 'be', 'been': 'be', 'am': 'be', 'is': 'be', 'are': 'be',
    'had': 'have', 'has': 'have', 'having': 'have',
    'did': 'do', 'does': 'do', 'doing': 'do', 'done': 'do',
    'went': 'go', 'gone': 'go', 'going': 'go', 'goes': 'go',
    'got': 'get', 'gotten': 'get', 'getting': 'get', 'gets': 'get',
    'made': 'make', 'making': 'make', 'makes': 'make',
    'took': 'take', 'taken': 'take', 'taking': 'take', 'takes': 'take',
    'came': 'come', 'coming': 'come', 'comes': 'come',
    'said': 'say', 'saying': 'say', 'says': 'say',
    'saw': 'see', 'seen': 'see', 'seeing': 'see', 'sees': 'see',
    'knew': 'know', 'known': 'know', 'knowing': 'know', 'knows': 'know',
    'thought': 'think', 'thinking': 'think', 'thinks': 'think',
    'felt': 'feel', 'feeling': 'feel', 'feels': 'feel',
    'found': 'find', 'finding': 'find', 'finds': 'find',
    'gave': 'give', 'given': 'give', 'giving': 'give', 'gives': 'give',
    'told': 'tell', 'telling': 'tell', 'tells': 'tell',
    'ran': 'run', 'running': 'run', 'runs': 'run'
  };

  if (irregularVerbs[lowerWord]) {
    return irregularVerbs[lowerWord];
  }

  // Common noun plurals
  if (pos === 'noun') {
    if (lowerWord.endsWith('ies') && lowerWord.length > 4) {
      return lowerWord.slice(0, -3) + 'y'; // cities -> city
    }
    if (lowerWord.endsWith('ves') && lowerWord.length > 4) {
      return lowerWord.slice(0, -3) + 'f'; // lives -> life
    }
    if (lowerWord.endsWith('ses') && lowerWord.length > 4) {
      return lowerWord.slice(0, -2); // processes -> process
    }
    if (lowerWord.endsWith('s') && lowerWord.length > 2) {
      return lowerWord.slice(0, -1); // cats -> cat
    }
  }

  // Verb forms
  if (pos === 'verb') {
    if (lowerWord.endsWith('ying')) {
      return lowerWord.slice(0, -4) + 'y'; // studying -> study
    }
    if (lowerWord.endsWith('ing') && lowerWord.length > 4) {
      // running -> run, making -> make
      const base = lowerWord.slice(0, -3);
      if (base.length >= 2 && base[base.length - 1] === base[base.length - 2]) {
        return base.slice(0, -1); // running -> run
      }
      return base + 'e'; // making -> make
    }
    if (lowerWord.endsWith('ed') && lowerWord.length > 3) {
      const base = lowerWord.slice(0, -2);
      return base.endsWith('e') ? base : base + 'e';
    }
    if (lowerWord.endsWith('s') && lowerWord.length > 2) {
      return lowerWord.slice(0, -1); // runs -> run
    }
  }

  // Adjectives
  if (pos === 'adj') {
    if (lowerWord.endsWith('er') && lowerWord.length > 3) {
      return lowerWord.slice(0, -2); // bigger -> big
    }
    if (lowerWord.endsWith('est') && lowerWord.length > 4) {
      return lowerWord.slice(0, -3); // biggest -> big
    }
  }

  return lowerWord;
}

/**
 * Extract context around a word position
 * @param {string} text - Full text
 * @param {number} wordStart - Start position of target word
 * @param {number} wordEnd - End position of target word
 * @param {number} contextChars - Number of characters to include before/after
 * @returns {Object} Context object with {before, target, after, sentence, sentences}
 */
export function extractContext(text, wordStart, wordEnd, contextChars = 300) {
  const targetWord = text.substring(wordStart, wordEnd);

  // Find the sentence containing the word
  const sentences = splitSentences(text);
  let targetSentenceIndex = -1;
  let targetSentence = null;

  for (let i = 0; i < sentences.length; i++) {
    if (sentences[i].start <= wordStart && sentences[i].end >= wordEnd) {
      targetSentenceIndex = i;
      targetSentence = sentences[i];
      break;
    }
  }

  if (!targetSentence) {
    // Fallback: create context from character positions
    const start = Math.max(0, wordStart - contextChars);
    const end = Math.min(text.length, wordEnd + contextChars);
    return {
      before: text.substring(start, wordStart),
      target: targetWord,
      after: text.substring(wordEnd, end),
      sentence: text.substring(start, end),
      sentences: [text.substring(start, end)]
    };
  }

  // Include ±1 sentence for broader context
  const contextSentences = [];
  const startIdx = Math.max(0, targetSentenceIndex - 1);
  const endIdx = Math.min(sentences.length - 1, targetSentenceIndex + 1);

  for (let i = startIdx; i <= endIdx; i++) {
    contextSentences.push(sentences[i].text);
  }

  // Calculate position within sentence
  const sentenceStart = targetSentence.start;
  const relativeStart = wordStart - sentenceStart;
  const relativeEnd = wordEnd - sentenceStart;

  return {
    before: targetSentence.text.substring(0, relativeStart),
    target: targetWord,
    after: targetSentence.text.substring(relativeEnd),
    sentence: targetSentence.text,
    sentences: contextSentences,
    fullContext: contextSentences.join(' ')
  };
}

/**
 * Find word boundaries at a given position
 * @param {string} text - Input text
 * @param {number} position - Cursor position
 * @returns {Object|null} {word, start, end} or null if no word found
 */
export function getWordAtPosition(text, position) {
  if (!text || position < 0 || position > text.length) return null;

  // Find word boundaries
  let start = position;
  let end = position;

  const wordChars = /[\w'-]/;

  // Expand backwards
  while (start > 0 && wordChars.test(text[start - 1])) {
    start--;
  }

  // Expand forwards
  while (end < text.length && wordChars.test(text[end])) {
    end++;
  }

  if (start === end) return null;

  return {
    word: text.substring(start, end),
    start,
    end
  };
}

/**
 * Check if a word is a named entity (simple heuristic)
 * @param {string} word - Word to check
 * @param {string} context - Surrounding context
 * @returns {boolean} True if likely a named entity
 */
export function isNamedEntity(word, context = '') {
  if (!word || word.length < 2) return false;

  // Capitalized and not at sentence start
  if (word[0] === word[0].toUpperCase()) {
    // Check if preceded by sentence ending
    const beforeWord = context.slice(-50);
    if (!beforeWord.match(/[.!?]\s*$/)) {
      return true; // Capitalized mid-sentence
    }
  }

  // All caps (acronym)
  if (word === word.toUpperCase() && word.length >= 2) {
    return true;
  }

  return false;
}

/**
 * Get detailed word info including POS, lemma, and context
 * @param {string} text - Full text
 * @param {number} start - Word start position
 * @param {number} end - Word end position
 * @returns {Object} Detailed word information
 */
export function analyzeWord(text, start, end) {
  const word = text.substring(start, end);
  const context = extractContext(text, start, end);

  // Get POS based on word and surrounding context
  const beforeContext = context.before.slice(-100);
  const pos = getPOS(word, beforeContext);

  const lemma = getLemma(word, pos);
  const isNE = isNamedEntity(word, beforeContext);

  return {
    word,
    lemma,
    pos,
    isNamedEntity: isNE,
    context,
    start,
    end,
    // Additional metadata
    isCapitalized: word[0] === word[0].toUpperCase(),
    isAllCaps: word === word.toUpperCase(),
    length: word.length
  };
}

/**
 * Preserve capitalization pattern when replacing a word
 * @param {string} original - Original word
 * @param {string} replacement - Replacement word
 * @returns {string} Replacement with same capitalization pattern
 */
export function preserveCapitalization(original, replacement) {
  if (!original || !replacement) return replacement;

  // All caps
  if (original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }

  // Title case (first letter capitalized)
  if (original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
  }

  // Lowercase
  return replacement.toLowerCase();
}

/**
 * Apply inflection to match original word form
 * @param {string} base - Base form of word
 * @param {string} originalWord - Original word with inflection
 * @param {string} pos - Part of speech
 * @returns {string} Inflected word
 */
export function applyInflection(base, originalWord, pos = 'noun') {
  const lowerOriginal = originalWord.toLowerCase();
  const lowerBase = base.toLowerCase();

  if (pos === 'noun') {
    // Check if original was plural
    if (lowerOriginal.endsWith('s') && !lowerBase.endsWith('s')) {
      if (lowerBase.endsWith('y')) {
        return lowerBase.slice(0, -1) + 'ies'; // study -> studies
      }
      if (lowerBase.match(/[sxz]$|[cs]h$/)) {
        return lowerBase + 'es'; // box -> boxes
      }
      return lowerBase + 's';
    }
  }

  if (pos === 'verb') {
    // Check for -ing
    if (lowerOriginal.endsWith('ing')) {
      if (lowerBase.endsWith('e')) {
        return lowerBase.slice(0, -1) + 'ing'; // make -> making
      }
      return lowerBase + 'ing';
    }

    // Check for -ed
    if (lowerOriginal.endsWith('ed')) {
      if (lowerBase.endsWith('e')) {
        return lowerBase + 'd'; // make -> made (simplified)
      }
      return lowerBase + 'ed';
    }

    // Check for third person -s
    if (lowerOriginal.endsWith('s') && !lowerBase.endsWith('s')) {
      return lowerBase + 's';
    }
  }

  return lowerBase;
}
