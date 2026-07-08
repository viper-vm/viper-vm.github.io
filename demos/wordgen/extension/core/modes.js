// core/modes.js — the mode registry shared by the web app and the extension.
// A "mode" is one way of transforming text (paraphrase, email, better prompt…).
// Prompt templates all demand strict JSON so providers.js can parse reliably.

export const MODE_CATEGORIES = [
  { id: 'rewrite', label: 'Rewrite' },
  { id: 'prompt', label: 'Prompt' },
  { id: 'message', label: 'Message' },
  { id: 'words', label: 'Words' },
];

export const SYSTEM_PROMPT =
  'You are WordGen, a precise writing assistant. Always respond with a single valid JSON ' +
  'object and nothing else — no markdown fences, no commentary outside the JSON. Preserve ' +
  "the author's language: reply in the same language as the input text.";

function optionsContract(n) {
  return (
    `Return exactly this JSON shape with ${n} option${n > 1 ? 's' : ''}: ` +
    '{"options": [{"text": "the rewritten text", "note": "one short line on the angle this option takes"}]}'
  );
}

const SYNONYM_CONTRACT =
  'Return exactly this JSON shape with up to 8 candidates, best first: ' +
  '{"candidates": [{"word": "replacement", "register": "formal|neutral|casual", "note": "short nuance note"}]}';

function withInstruction(prompt, opts) {
  if (opts && opts.instruction && String(opts.instruction).trim()) {
    return `${prompt}\n\nAdditional instruction from the user (follow it): "${String(opts.instruction).trim()}"`;
  }
  return prompt;
}

export const MODES = [
  // ------------------------------------------------------------- rewrite
  {
    id: 'paraphrase',
    category: 'rewrite',
    label: 'Paraphrase',
    emoji: '🔁',
    hint: 'Say it differently, same meaning',
    optionCount: 3,
    promptTemplate: (text, opts) => withInstruction(
      `Paraphrase the text below. Preserve the meaning, register, and roughly the same length; change the wording and sentence structure enough that it reads freshly. Give 3 genuinely different phrasings.\n\nText:\n"""${text}"""\n\n${optionsContract(3)}`,
      opts,
    ),
  },
  {
    id: 'grammar',
    category: 'rewrite',
    label: 'Fix grammar',
    emoji: '🧹',
    hint: 'Correct grammar, spelling and punctuation only',
    optionCount: 1,
    promptTemplate: (text, opts) => withInstruction(
      `Correct only the grammar, spelling, and punctuation of the text below. Make the minimal edits needed — do not rephrase, do not change tone or word choice unless a word is misused. In the "note" field, list briefly what you changed (or say "No errors found").\n\nText:\n"""${text}"""\n\n${optionsContract(1)}`,
      opts,
    ),
  },
  {
    id: 'shorter',
    category: 'rewrite',
    label: 'Make shorter',
    emoji: '✂️',
    hint: 'Compress while keeping the key points',
    optionCount: 3,
    promptTemplate: (text, opts) => withInstruction(
      `Compress the text below to roughly 60% of its length. Keep every essential fact and the original tone; cut filler, redundancy, and throat-clearing. Give 3 options that cut in different ways.\n\nText:\n"""${text}"""\n\n${optionsContract(3)}`,
      opts,
    ),
  },
  {
    id: 'expand',
    category: 'rewrite',
    label: 'Expand',
    emoji: '🪴',
    hint: 'Elaborate with relevant detail',
    optionCount: 3,
    promptTemplate: (text, opts) => withInstruction(
      `Expand the text below to roughly 1.5–2x its length by adding relevant, concrete detail, connective reasoning, or an example — never padding or fluff. Keep the author's voice. Give 3 options that expand in different directions.\n\nText:\n"""${text}"""\n\n${optionsContract(3)}`,
      opts,
    ),
  },
  {
    id: 'simplify',
    category: 'rewrite',
    label: 'Simplify',
    emoji: '🍃',
    hint: 'Plain language anyone can follow',
    optionCount: 3,
    promptTemplate: (text, opts) => withInstruction(
      `Rewrite the text below in plain language a 12-year-old could follow: short sentences, everyday words, one idea per sentence. Keep all the substance. Give 3 options at slightly different levels of simplicity.\n\nText:\n"""${text}"""\n\n${optionsContract(3)}`,
      opts,
    ),
  },
  {
    id: 'formal',
    category: 'rewrite',
    label: 'More formal',
    emoji: '🎩',
    hint: 'Professional, polished register',
    optionCount: 3,
    promptTemplate: (text, opts) => withInstruction(
      `Rewrite the text below in a more formal, professional register: no contractions, no slang, measured tone, precise vocabulary — but keep it natural, not stiff or bureaucratic. Give 3 options.\n\nText:\n"""${text}"""\n\n${optionsContract(3)}`,
      opts,
    ),
  },
  {
    id: 'casual',
    category: 'rewrite',
    label: 'More casual',
    emoji: '🧢',
    hint: 'Relaxed, conversational register',
    optionCount: 3,
    promptTemplate: (text, opts) => withInstruction(
      `Rewrite the text below in a relaxed, conversational register: contractions, everyday phrasing, the way you'd say it out loud to a colleague you like. Keep the meaning intact. Give 3 options.\n\nText:\n"""${text}"""\n\n${optionsContract(3)}`,
      opts,
    ),
  },
  {
    id: 'custom',
    category: 'rewrite',
    label: 'Custom',
    emoji: '🎨',
    hint: 'Follow your instruction only',
    optionCount: 2,
    promptTemplate: (text, opts) => {
      const instruction = (opts && opts.instruction ? String(opts.instruction) : '').trim() || 'Improve the text.';
      return `Rewrite the text below following this instruction from the user: "${instruction}". Keep everything about the text that the instruction does not ask to change. Give 2 options.\n\nText:\n"""${text}"""\n\n${optionsContract(2)}`;
    },
  },

  // ------------------------------------------------------------- prompt
  {
    id: 'prompt-better',
    category: 'prompt',
    label: 'Better prompt',
    emoji: '✨',
    hint: 'Turn this into a clear, specific LLM prompt',
    optionCount: 2,
    promptTemplate: (text, opts) => withInstruction(
      `The text below is something a user wants to ask an AI assistant. Restructure it into a clear, specific, self-contained prompt: state the goal, supply the necessary context, add sensible constraints, and specify the desired output format. Do not invent facts the user didn't give — where a detail is genuinely needed, include a [PLACEHOLDER] the user can fill in. Give 2 options.\n\nUser's rough prompt:\n"""${text}"""\n\n${optionsContract(2)}`,
      opts,
    ),
  },
  {
    id: 'prompt-tech',
    category: 'prompt',
    label: 'Tech-savvy prompt',
    emoji: '🛠️',
    hint: 'Expert-grade prompt with role, constraints, edge cases',
    optionCount: 2,
    promptTemplate: (text, opts) => withInstruction(
      `The text below is something a user wants to ask an AI assistant. Rewrite it as an expert-grade prompt: assign the assistant a fitting role, spell out explicit requirements step by step, call out edge cases to handle, name the constraints, and define a precise output schema or format. Structure it with short labelled sections. Do not invent facts — use [PLACEHOLDER]s for details the user must supply. Give 2 options with different structures.\n\nUser's rough prompt:\n"""${text}"""\n\n${optionsContract(2)}`,
      opts,
    ),
  },
  {
    id: 'prompt-simple',
    category: 'prompt',
    label: 'Simple prompt',
    emoji: '🌱',
    hint: 'One short, plain prompt sentence',
    optionCount: 2,
    promptTemplate: (text, opts) => withInstruction(
      `The text below is something a user wants to ask an AI assistant. Boil it down to one or two short, plain-language sentences anyone could have written — no jargon, no formatting, just the ask stated clearly. Give 2 options.\n\nUser's rough prompt:\n"""${text}"""\n\n${optionsContract(2)}`,
      opts,
    ),
  },

  // ------------------------------------------------------------- message
  {
    id: 'email',
    category: 'message',
    label: 'Polished email',
    emoji: '✉️',
    hint: 'Subject, greeting, body, sign-off',
    optionCount: 2,
    promptTemplate: (text, opts) => withInstruction(
      `Turn the text below into a polished email: a concise subject line ("Subject: …" on the first line), a greeting, a well-organized body, and a sign-off. Professional but warm; no corporate filler. Use [NAME]-style placeholders where the text doesn't say who is being addressed. Give 2 options with different levels of formality.\n\nText:\n"""${text}"""\n\n${optionsContract(2)}`,
      opts,
    ),
  },
  {
    id: 'linkedin',
    category: 'message',
    label: 'LinkedIn message',
    emoji: '💼',
    hint: 'Concise professional-networking tone',
    optionCount: 2,
    promptTemplate: (text, opts) => withInstruction(
      `Turn the text below into a LinkedIn direct message: professional-networking tone, confident but not salesy, no fluff or buzzwords, at most 120 words, ends with a clear low-pressure ask or next step. Give 2 options.\n\nText:\n"""${text}"""\n\n${optionsContract(2)}`,
      opts,
    ),
  },
  {
    id: 'whatsapp',
    category: 'message',
    label: 'WhatsApp message',
    emoji: '💬',
    hint: 'Short, natural texting voice',
    optionCount: 3,
    promptTemplate: (text, opts) => withInstruction(
      `Turn the text below into a WhatsApp message: short, informal, natural texting voice, contractions welcome, at most one or two light emoji if they fit. Split into two short messages only if it truly reads better that way (separate with a blank line). Give 3 options.\n\nText:\n"""${text}"""\n\n${optionsContract(3)}`,
      opts,
    ),
  },
  {
    id: 'instagram',
    category: 'message',
    label: 'Instagram caption',
    emoji: '📸',
    hint: 'Catchy caption + a few hashtags',
    optionCount: 3,
    promptTemplate: (text, opts) => withInstruction(
      `Turn the text below into an Instagram caption: a catchy first line that stops the scroll, a short body with personality, and 3–5 genuinely relevant hashtags on the final line. Give 3 options with different vibes (e.g. witty, heartfelt, minimal).\n\nText:\n"""${text}"""\n\n${optionsContract(3)}`,
      opts,
    ),
  },
  {
    id: 'friend',
    category: 'message',
    label: 'To a friend',
    emoji: '🫶',
    hint: 'Warm and casual, like a close friend',
    optionCount: 3,
    promptTemplate: (text, opts) => withInstruction(
      `Rewrite the text below as a message to a close friend: warm, casual, real — the way people actually talk to friends they trust. Keep all the substance. Give 3 options.\n\nText:\n"""${text}"""\n\n${optionsContract(3)}`,
      opts,
    ),
  },
  {
    id: 'boss',
    category: 'message',
    label: 'To a superior',
    emoji: '🧭',
    hint: 'Respectful, concise, impact-first',
    optionCount: 2,
    promptTemplate: (text, opts) => withInstruction(
      `Rewrite the text below as a message to a manager or senior stakeholder: respectful and concise, leads with the outcome or impact, states any ask plainly, zero groveling or hedging. Give 2 options.\n\nText:\n"""${text}"""\n\n${optionsContract(2)}`,
      opts,
    ),
  },
  {
    id: 'tweet',
    category: 'message',
    label: 'X / Tweet',
    emoji: '🐦',
    hint: 'Punchy, under 280 characters',
    optionCount: 3,
    promptTemplate: (text, opts) => withInstruction(
      `Turn the text below into a post for X (Twitter): punchy, self-contained, strictly under 280 characters, no hashtag spam (at most one hashtag, only if it earns its place). Give 3 options with different hooks.\n\nText:\n"""${text}"""\n\n${optionsContract(3)}`,
      opts,
    ),
  },

  // ------------------------------------------------------------- words
  {
    id: 'synonyms',
    category: 'words',
    label: 'Synonyms',
    emoji: '📖',
    hint: 'Context-aware replacements for one word',
    optionCount: 8,
    promptTemplate: (text, opts) => buildSynonymPrompt(text, (opts && opts.context) || '', opts).user,
  },
];

const byId = new Map(MODES.map((m) => [m.id, m]));

export function getMode(id) {
  return byId.get(id) || null;
}

/**
 * Build the full prompt for a transform.
 * Returns { system, user, expect } where expect names the JSON contract.
 */
export function buildTransformPrompt(mode, text, opts = {}) {
  if (!mode || typeof mode.promptTemplate !== 'function') {
    throw new Error('buildTransformPrompt needs a mode from the registry.');
  }
  if (mode.id === 'synonyms') {
    return buildSynonymPrompt(text, opts.context || '', opts);
  }
  return { system: SYSTEM_PROMPT, user: mode.promptTemplate(String(text), opts), expect: 'options' };
}

/** Build the prompt for context-aware synonyms of a single word. */
export function buildSynonymPrompt(word, context = '', opts = {}) {
  const ctx = String(context || '').trim();
  const user = withInstruction(
    `Suggest single-word substitutes for the word "${String(word).trim()}"${ctx ? ` as used in this sentence: "${ctx}"` : ''}. Each candidate must be one word, the same part of speech, and must fit the sentence naturally with the same meaning. No hyphenations or phrases.\n\n${SYNONYM_CONTRACT}`,
    opts,
  );
  return { system: SYSTEM_PROMPT, user, expect: 'candidates' };
}
