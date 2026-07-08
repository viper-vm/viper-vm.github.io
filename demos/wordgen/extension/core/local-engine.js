// core/local-engine.js — the free, offline fallback engine.
// Ports the useful parts of the old js/nlp.js + js/pipeline.js: lexicon +
// embedding synonym lookup with inflection matching, and rule-based rewrites.
// Modes it can't do credibly return the original text with limited:true so the
// UI can point the user at Settings.

let assetBase = './assets/';
let dataPromise = null;

/** Each surface tells the engine where the JSON assets live. */
export function initLocalEngine(baseUrl) {
  if (baseUrl) {
    assetBase = String(baseUrl).endsWith('/') ? String(baseUrl) : `${baseUrl}/`;
    dataPromise = null;
  }
}

async function loadData() {
  if (!dataPromise) {
    dataPromise = (async () => {
      const [lexicon, embeddings] = await Promise.all([
        fetchJsonAsset('lexicon.json'),
        fetchJsonAsset('mini-embeddings.json'),
      ]);
      return { lexicon: lexicon || {}, embeddings: embeddings || {} };
    })().catch((err) => {
      dataPromise = null;
      throw new Error(`Local engine data failed to load: ${err.message}`);
    });
  }
  return dataPromise;
}

async function fetchJsonAsset(name) {
  const res = await fetch(assetBase + name);
  if (!res.ok) throw new Error(`${name} → HTTP ${res.status}`);
  return res.json();
}

// ------------------------------------------------------------------ synonyms

export async function localSynonyms(word, context = '') {
  const target = String(word || '').trim();
  if (!target || /\s/.test(target)) throw new Error('Select a single word for synonyms.');
  const { lexicon, embeddings } = await loadData();

  const lower = target.toLowerCase();
  const { lemma, pos, inflect } = analyze(lower, context);

  const seen = new Set([lower, lemma]);
  const pool = [];
  for (const key of [`${lemma}_${pos}`, `${lemma}_adj`, `${lemma}_noun`, `${lemma}_verb`, `${lemma}_adv`]) {
    const entry = lexicon[key];
    if (entry && Array.isArray(entry.synonyms)) {
      for (const syn of entry.synonyms) {
        const s = String(syn).toLowerCase();
        if (!seen.has(s)) {
          seen.add(s);
          pool.push(s);
        }
      }
      break; // first matching POS entry wins, same as the old pipeline
    }
  }

  if (!pool.length) {
    throw new Error(
      `The local engine's small dictionary doesn't cover “${target}”. Add an API key in Settings for full-vocabulary synonyms.`,
    );
  }

  const base = embeddings[lemma];
  const scored = pool
    .map((w) => ({ word: w, score: base && embeddings[w] ? cosine(base, embeddings[w]) : 0.5 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  return {
    candidates: scored.map((s) => ({
      word: matchShape(inflect(s.word), target),
      register: 'neutral',
      note: '',
    })),
  };
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// Lightweight lemma + POS guess with an inflector to restore the original form.
function analyze(lower, context) {
  let lemma = lower;
  let inflect = (w) => w;
  let pos = 'adj';

  if (/ies$/.test(lower) && lower.length > 4) {
    lemma = `${lower.slice(0, -3)}y`;
    inflect = (w) => (w.endsWith('y') ? `${w.slice(0, -1)}ies` : `${w}s`);
    pos = 'noun';
  } else if (/(sh|ch|x|s|z)es$/.test(lower)) {
    lemma = lower.slice(0, -2);
    inflect = (w) => (/(sh|ch|x|s|z)$/.test(w) ? `${w}es` : `${w}s`);
    pos = 'noun';
  } else if (/s$/.test(lower) && lower.length > 3 && !/ss$/.test(lower)) {
    lemma = lower.slice(0, -1);
    inflect = (w) => `${w}s`;
    pos = 'noun';
  } else if (/ing$/.test(lower) && lower.length > 5) {
    lemma = lower.slice(0, -3);
    inflect = (w) => (w.endsWith('e') ? `${w.slice(0, -1)}ing` : `${w}ing`);
    pos = 'verb';
  } else if (/ed$/.test(lower) && lower.length > 4) {
    lemma = lower.slice(0, -2);
    inflect = (w) => (w.endsWith('e') ? `${w}d` : `${w}ed`);
    pos = 'verb';
  } else if (/ly$/.test(lower) && lower.length > 4) {
    pos = 'adv';
  }

  // Cheap context hint: "a/an/the X" or "very X" reads adjectival/nominal.
  const ctx = String(context || '').toLowerCase();
  if (new RegExp(`(?:to|will|can|should|must)\\s+${escapeRe(lower)}`).test(ctx)) pos = 'verb';

  return { lemma, pos, inflect };
}

function matchShape(replacement, original) {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ------------------------------------------------------------------ transforms

const FILLERS = /\b(?:basically|actually|literally|really|very|quite|just|simply|in order) /gi;
const CONTRACTIONS = [
  [/\bdo not\b/gi, "don't"], [/\bdoes not\b/gi, "doesn't"], [/\bdid not\b/gi, "didn't"],
  [/\bcannot\b/gi, "can't"], [/\bcan not\b/gi, "can't"], [/\bwill not\b/gi, "won't"],
  [/\bit is\b/gi, "it's"], [/\bthat is\b/gi, "that's"], [/\bI am\b/g, "I'm"],
  [/\byou are\b/gi, "you're"], [/\bwe are\b/gi, "we're"], [/\bthey are\b/gi, "they're"],
  [/\bis not\b/gi, "isn't"], [/\bare not\b/gi, "aren't"], [/\bwould not\b/gi, "wouldn't"],
  [/\bshould not\b/gi, "shouldn't"], [/\bcould not\b/gi, "couldn't"], [/\bI will\b/g, "I'll"],
  [/\bwe will\b/gi, "we'll"], [/\byou will\b/gi, "you'll"], [/\bI have\b/g, "I've"],
  [/\bwe have\b/gi, "we've"], [/\byou have\b/gi, "you've"],
];
const EXPANSIONS = [
  [/\bdon't\b/gi, 'do not'], [/\bdoesn't\b/gi, 'does not'], [/\bdidn't\b/gi, 'did not'],
  [/\bcan't\b/gi, 'cannot'], [/\bwon't\b/gi, 'will not'], [/\bit's\b/gi, 'it is'],
  [/\bthat's\b/gi, 'that is'], [/\bI'm\b/g, 'I am'], [/\byou're\b/gi, 'you are'],
  [/\bwe're\b/gi, 'we are'], [/\bthey're\b/gi, 'they are'], [/\bisn't\b/gi, 'is not'],
  [/\baren't\b/gi, 'are not'], [/\bwouldn't\b/gi, 'would not'], [/\bshouldn't\b/gi, 'should not'],
  [/\bcouldn't\b/gi, 'could not'], [/\bI'll\b/g, 'I will'], [/\bwe'll\b/gi, 'we will'],
  [/\byou'll\b/gi, 'you will'], [/\bI've\b/g, 'I have'], [/\bwe've\b/gi, 'we have'],
  [/\bgonna\b/gi, 'going to'], [/\bwanna\b/gi, 'want to'], [/\bkinda\b/gi, 'somewhat'],
];
const FORMAL_SWAPS = [
  [/\bget\b/gi, 'obtain'], [/\bgot\b/gi, 'received'], [/\bbuy\b/gi, 'purchase'],
  [/\bneed\b/gi, 'require'], [/\bhelp\b/gi, 'assist'], [/\bshow\b/gi, 'demonstrate'],
  [/\bstart\b/gi, 'commence'], [/\bend\b/gi, 'conclude'], [/\bask\b/gi, 'request'],
  [/\btell\b/gi, 'inform'], [/\bthink\b/gi, 'believe'], [/\balso\b/gi, 'additionally'],
  [/\bso\b/gi, 'therefore'], [/\bbut\b/gi, 'however'],
];
const CASUAL_SWAPS = [
  [/\bobtain\b/gi, 'get'], [/\bpurchase\b/gi, 'buy'], [/\brequire\b/gi, 'need'],
  [/\bassist\b/gi, 'help'], [/\bdemonstrate\b/gi, 'show'], [/\bcommence\b/gi, 'start'],
  [/\bconclude\b/gi, 'wrap up'], [/\binform\b/gi, 'tell'], [/\badditionally\b/gi, 'also'],
  [/\btherefore\b/gi, 'so'], [/\bhowever\b/gi, 'but'], [/\butilize\b/gi, 'use'],
];
const SIMPLE_SWAPS = [
  [/\butilize\b/gi, 'use'], [/\bfacilitate\b/gi, 'help'], [/\bapproximately\b/gi, 'about'],
  [/\bsubsequently\b/gi, 'then'], [/\bcommence\b/gi, 'start'], [/\bterminate\b/gi, 'end'],
  [/\bdemonstrate\b/gi, 'show'], [/\bnumerous\b/gi, 'many'], [/\bsufficient\b/gi, 'enough'],
  [/\bendeavor\b/gi, 'try'], [/\bascertain\b/gi, 'find out'], [/\bregarding\b/gi, 'about'],
  [/\badditionally\b/gi, 'also'], [/\bconsequently\b/gi, 'so'],
];

function applySwaps(text, swaps) {
  let out = text;
  for (const [re, to] of swaps) {
    out = out.replace(re, (match) => matchShape(to, match));
  }
  return out;
}

export async function localTransform(mode, text, opts = {}) {
  const id = mode && mode.id;

  if (id === 'synonyms') {
    const res = await localSynonyms(text, opts.context || '');
    return res;
  }

  if (id === 'grammar') {
    let fixed = text
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/\bi\b/g, 'I')
      .replace(/\ba ([aeiou])/gi, (m, v) => `${m[0] === 'A' ? 'An' : 'an'} ${v}`)
      .replace(/\ban ([^aeiou\s])/gi, (m, c) => `${m[0] === 'A' ? 'A' : 'a'} ${c}`);
    fixed = fixed.replace(/(^|[.!?]\s+)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
    const changed = fixed !== text;
    return {
      options: [{ text: fixed, note: changed ? 'Basic fixes: spacing, capitalization, a/an. An AI provider catches much more.' : 'No basic errors found (local check only).' }],
    };
  }

  if (id === 'shorter') {
    const out = text.replace(FILLERS, '');
    return { options: [{ text: applySwaps(out, CONTRACTIONS), note: 'Removed filler words and contracted phrases.' }] };
  }

  if (id === 'formal') {
    return { options: [{ text: applySwaps(applySwaps(text, EXPANSIONS), FORMAL_SWAPS), note: 'Expanded contractions and swapped in formal vocabulary.' }] };
  }

  if (id === 'casual') {
    return { options: [{ text: applySwaps(applySwaps(text, CONTRACTIONS), CASUAL_SWAPS), note: 'Added contractions and everyday wording.' }] };
  }

  if (id === 'simplify') {
    return { options: [{ text: applySwaps(text, SIMPLE_SWAPS), note: 'Swapped complex words for plain ones.' }] };
  }

  if (id === 'paraphrase') {
    const rotated = await lightParaphrase(text);
    return { options: [{ text: rotated, note: 'Light synonym rotation — an AI provider paraphrases far more deeply.' }] };
  }

  // Modes that genuinely need a language model.
  return {
    limited: true,
    options: [{
      text,
      note: 'This mode needs an AI provider — add a free or paid API key in Settings.',
    }],
  };
}

async function lightParaphrase(text) {
  let data;
  try {
    data = await loadData();
  } catch {
    return text;
  }
  const { lexicon } = data;
  let swapped = 0;
  return text.replace(/[A-Za-z]{4,}/g, (word) => {
    if (swapped >= 4) return word;
    const lower = word.toLowerCase();
    for (const pos of ['adj', 'verb', 'noun', 'adv']) {
      const entry = lexicon[`${lower}_${pos}`];
      if (entry && entry.synonyms && entry.synonyms.length) {
        swapped++;
        return matchShape(entry.synonyms[0], word);
      }
    }
    return word;
  });
}
