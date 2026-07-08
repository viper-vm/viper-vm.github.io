// core/providers.js — provider adapters shared by the web app and the extension.
// Local (offline) engine, Claude (Anthropic), any OpenAI-compatible endpoint,
// and a custom JSON endpoint. All remote calls return the same shapes:
//   transforms -> { options: [{text, note}], limited? }
//   synonyms   -> { candidates: [{word, register, note}], limited? }

import { buildTransformPrompt, buildSynonymPrompt } from './modes.js';
import { localTransform, localSynonyms } from './local-engine.js';

export const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

export const PROVIDERS = {
  local: { id: 'local', label: 'Local engine (free)' },
  anthropic: { id: 'anthropic', label: 'Claude (Anthropic)', models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'] },
  openai: { id: 'openai', label: 'OpenAI-compatible' },
  custom: { id: 'custom', label: 'Custom endpoint' },
};

export async function runTransform({ providerConfig, mode, text, opts = {} }) {
  const cfg = normalizeConfig(providerConfig);
  const input = String(text || '').trim();
  if (!input) throw new Error('Nothing to transform — the text is empty.');
  if (!mode) throw new Error('No mode selected.');

  if (cfg.provider === 'local') return localTransform(mode, input, opts);
  if (cfg.provider === 'custom') {
    const data = await callCustom(cfg, { action: 'transform', mode: mode.id, text: input, opts });
    return validateOptions(data);
  }

  const prompt = buildTransformPrompt(mode, input, opts);
  const raw = await callChat(cfg, prompt);
  if (prompt.expect === 'candidates') return validateCandidates(extractJson(raw));
  return validateOptions(extractJson(raw));
}

export async function runSynonyms({ providerConfig, word, context = '', opts = {} }) {
  const cfg = normalizeConfig(providerConfig);
  const target = String(word || '').trim();
  if (!target) throw new Error('No word selected.');

  if (cfg.provider === 'local') return localSynonyms(target, context, opts);
  if (cfg.provider === 'custom') {
    const data = await callCustom(cfg, { action: 'synonyms', word: target, context, opts });
    return validateCandidates(data);
  }

  const prompt = buildSynonymPrompt(target, context, opts);
  const raw = await callChat(cfg, prompt);
  return validateCandidates(extractJson(raw));
}

export async function testProvider(providerConfig) {
  const cfg = normalizeConfig(providerConfig);
  try {
    if (cfg.provider === 'local') return { ok: true };
    const res = await runSynonyms({
      providerConfig: cfg,
      word: 'good',
      context: 'This is a good example.',
    });
    if (res && Array.isArray(res.candidates) && res.candidates.length) return { ok: true };
    return { ok: false, error: 'The provider answered but returned no usable candidates.' };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

// ------------------------------------------------------------------ chat calls

async function callChat(cfg, prompt) {
  if (cfg.provider === 'anthropic') return callAnthropic(cfg, prompt);
  if (cfg.provider === 'openai') return callOpenAI(cfg, prompt);
  throw new Error(`Unknown provider: ${cfg.provider}`);
}

async function callAnthropic(cfg, prompt) {
  if (!cfg.apiKey) throw new Error('Add your Anthropic API key in Settings first.');
  const body = {
    model: cfg.model || 'claude-opus-4-8',
    max_tokens: 1024,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    // No temperature/top_p: current Claude models reject sampling params.
  };
  const res = await fetchJson(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      // Required opt-in for direct browser (CORS) calls with a user-supplied key.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  }, 'Anthropic');

  if (res.stop_reason === 'refusal') {
    throw new Error('Claude declined this request. Try rephrasing the text.');
  }
  const text = (res.content || [])
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text) throw new Error('Claude returned an empty response.');
  return text;
}

async function callOpenAI(cfg, prompt, allowRetry = true) {
  if (!cfg.apiKey) throw new Error('Add your API key in Settings first.');
  const endpoint = cfg.endpoint || DEFAULT_OPENAI_ENDPOINT;
  const body = {
    model: cfg.model || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
    max_tokens: 1024,
  };
  if (allowRetry) body.response_format = { type: 'json_object' };

  let res;
  try {
    res = await fetchJson(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    }, 'Provider');
  } catch (err) {
    // Some OpenAI-compatible servers (older Ollama, some proxies) reject
    // response_format — retry once without it before giving up.
    if (allowRetry && err && err.status === 400) {
      return callOpenAI(cfg, prompt, false);
    }
    throw err;
  }

  const text = res.choices && res.choices[0] && res.choices[0].message
    ? res.choices[0].message.content
    : '';
  if (!text) throw new Error('The provider returned an empty response.');
  return text;
}

async function callCustom(cfg, payload) {
  if (!cfg.endpoint) throw new Error('Set your custom endpoint URL in Settings first.');
  return fetchJson(cfg.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cfg.headers || {}) },
    body: JSON.stringify(payload),
  }, 'Custom endpoint');
}

async function fetchJson(url, init, who) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`${who} request failed — check your network${who === 'Custom endpoint' ? ' and CORS on the endpoint' : ''}. (${err && err.message ? err.message : err})`);
  }
  if (!res.ok) {
    let detail = '';
    try {
      const text = await res.text();
      const parsed = JSON.parse(text);
      detail = (parsed.error && (parsed.error.message || parsed.error.type)) || text.slice(0, 200);
    } catch {
      /* keep detail empty */
    }
    const hint = res.status === 401 || res.status === 403
      ? ' — check your API key'
      : res.status === 429
        ? ' — rate limited, try again in a moment'
        : res.status === 404
          ? ' — check the model name and endpoint URL'
          : '';
    const err = new Error(`${who} error ${res.status}${hint}${detail ? `: ${detail}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ------------------------------------------------------------------ parsing

/** Pull a JSON object out of a model reply that may include fences or prose. */
export function extractJson(text) {
  const raw = String(text || '').trim();
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unfenced.indexOf('{');
  if (start === -1) throw new Error('The provider did not return JSON. Try again.');
  // Walk to the matching closing brace, string-aware.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < unfenced.length; i++) {
    const ch = unfenced[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(unfenced.slice(start, i + 1));
        } catch (err) {
          throw new Error(`The provider returned malformed JSON: ${err.message}`);
        }
      }
    }
  }
  throw new Error('The provider returned incomplete JSON (response may have been cut off).');
}

function validateOptions(data) {
  const options = data && Array.isArray(data.options)
    ? data.options
        .filter((o) => o && typeof o.text === 'string' && o.text.trim())
        .map((o) => ({ text: o.text.trim(), note: typeof o.note === 'string' ? o.note.trim() : '' }))
    : [];
  if (!options.length) throw new Error('The provider returned no usable options. Try again.');
  const out = { options };
  if (data.limited) out.limited = true;
  return out;
}

function validateCandidates(data) {
  const candidates = data && Array.isArray(data.candidates)
    ? data.candidates
        .filter((c) => c && typeof c.word === 'string' && c.word.trim())
        .slice(0, 8)
        .map((c) => ({
          word: c.word.trim(),
          register: ['formal', 'neutral', 'casual'].includes(c.register) ? c.register : 'neutral',
          note: typeof c.note === 'string' ? c.note.trim() : '',
        }))
    : [];
  if (!candidates.length) throw new Error('No synonym candidates came back for that word.');
  const out = { candidates };
  if (data.limited) out.limited = true;
  return out;
}

function normalizeConfig(providerConfig) {
  const cfg = providerConfig || {};
  const provider = ['local', 'anthropic', 'openai', 'custom'].includes(cfg.provider)
    ? cfg.provider
    : 'local';
  let headers = cfg.headers || {};
  if (typeof headers === 'string') {
    try {
      headers = JSON.parse(headers);
    } catch {
      headers = {};
    }
  }
  return {
    provider,
    apiKey: (cfg.apiKey || '').trim(),
    model: (cfg.model || '').trim(),
    endpoint: (cfg.endpoint || '').trim(),
    headers,
  };
}
