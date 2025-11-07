/**
 * providers.js
 * LLM provider adapters for OpenAI-compatible, Hugging Face, and custom endpoints
 */

/**
 * Base provider class
 */
class Provider {
  constructor(config) {
    this.config = config;
    this.type = config.type || 'none';
  }

  async getSynonyms(wordInfo, settings) {
    throw new Error('getSynonyms not implemented');
  }

  async rankCandidates(candidates, wordInfo, settings) {
    throw new Error('rankCandidates not implemented');
  }

  async rephrase(sentence, preset, settings) {
    throw new Error('rephrase not implemented');
  }
}

/**
 * None provider (local only)
 */
class NoneProvider extends Provider {
  constructor() {
    super({ type: 'none' });
  }

  async getSynonyms() {
    return [];
  }

  async rankCandidates(candidates) {
    return candidates;
  }

  async rephrase() {
    return [];
  }
}

/**
 * OpenAI-compatible provider
 */
class OpenAIProvider extends Provider {
  constructor(config) {
    super(config);
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-3.5-turbo';
  }

  async callAPI(messages, temperature = 0.7, maxTokens = 500) {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error: ${response.status} - ${error}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('Empty response from API');
      }

      return JSON.parse(content);
    } catch (error) {
      console.error('OpenAI API call failed:', error);
      throw error;
    }
  }

  async getSynonyms(wordInfo, settings) {
    const { word, pos, context } = wordInfo;
    const maxChars = settings.maxChars || 500;

    // Truncate context if needed
    const truncatedContext = context.sentence.slice(0, maxChars);

    const prompt = `You are a precise writing assistant. Given a target word, its part of speech, and the sentence context, return up to 8 SINGLE-WORD substitutes that preserve meaning in this sentence.

Requirements:
- Same POS as the target
- No idioms, hyphenations, or multi-word phrases
- General English unless domain hints are provided
- Return JSON only

Context: "${truncatedContext}"
Target: "${word}"
POS: "${pos}"
Domain: "${settings.domain || 'general'}"
Constraints: "avoid jargon: ${settings.avoidJargon || false}; prefer brevity: ${settings.defaultBrevity || 'keep'}"

Return JSON in this format:
{
  "candidates": [
    {"word": "example", "register": "formal|neutral|casual", "commonness": "common|uncommon", "note": "short reason"}
  ]
}`;

    try {
      const result = await this.callAPI([
        { role: 'system', content: 'You are a helpful writing assistant that returns only valid JSON.' },
        { role: 'user', content: prompt }
      ], 0.7, 300);

      if (!result.candidates || !Array.isArray(result.candidates)) {
        return [];
      }

      return result.candidates.map(c => ({
        word: c.word,
        register: c.register || 'neutral',
        commonness: c.commonness || 'common',
        note: c.note || 'AI-generated suggestion',
        source: 'llm'
      }));
    } catch (error) {
      console.error('Error getting synonyms from OpenAI:', error);
      return [];
    }
  }

  async rephrase(sentence, preset, settings) {
    const presetMap = {
      shorter: 'Shorter',
      clearer: 'Clearer',
      formal: 'More Formal',
      casual: 'More Casual'
    };

    const presetName = presetMap[preset] || 'Clearer';
    const maxChars = settings.maxChars || 500;
    const truncatedSentence = sentence.slice(0, maxChars);

    const prompt = `Rewrite the following sentence to be ${presetName} without changing its core meaning.

Sentence: "${truncatedSentence}"
Domain/style: "${settings.domain || 'general'}"

Provide 3 different rephrase options. Return JSON only in this format:
{
  "rewrites": [
    {"text": "rewritten sentence 1", "note": "brief explanation"},
    {"text": "rewritten sentence 2", "note": "brief explanation"},
    {"text": "rewritten sentence 3", "note": "brief explanation"}
  ]
}`;

    try {
      const result = await this.callAPI([
        { role: 'system', content: 'You are a helpful writing assistant that returns only valid JSON.' },
        { role: 'user', content: prompt }
      ], 0.8, 400);

      if (!result.rewrites || !Array.isArray(result.rewrites)) {
        return [];
      }

      return result.rewrites.map(r => ({
        text: r.text,
        note: r.note || `${presetName} version`,
        confidence: 0.9
      }));
    } catch (error) {
      console.error('Error getting rephrases from OpenAI:', error);
      return [];
    }
  }
}

/**
 * Hugging Face Inference API provider
 */
class HuggingFaceProvider extends Provider {
  constructor(config) {
    super(config);
    this.apiKey = config.apiKey;
    this.model = config.model || 'mistralai/Mistral-7B-Instruct-v0.2';
    this.endpoint = `https://api-inference.huggingface.co/models/${this.model}`;
  }

  async callAPI(prompt, maxTokens = 500) {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: maxTokens,
            temperature: 0.7,
            return_full_text: false
          }
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`HF API Error: ${response.status} - ${error}`);
      }

      const data = await response.json();

      // HF returns array of results
      if (Array.isArray(data) && data[0]?.generated_text) {
        const text = data[0].generated_text;

        // Try to extract JSON from the response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }

        return { text };
      }

      throw new Error('Unexpected response format from Hugging Face');
    } catch (error) {
      console.error('Hugging Face API call failed:', error);
      throw error;
    }
  }

  async getSynonyms(wordInfo, settings) {
    const { word, pos, context } = wordInfo;
    const maxChars = settings.maxChars || 500;
    const truncatedContext = context.sentence.slice(0, maxChars);

    const prompt = `<s>[INST] You are a precise writing assistant. Given a target word, return up to 8 single-word synonyms that fit the context.

Context: "${truncatedContext}"
Target: "${word}"
POS: "${pos}"

Return only valid JSON:
{"candidates": [{"word": "synonym1", "register": "neutral", "commonness": "common", "note": "reason"}, ...]}
[/INST]`;

    try {
      const result = await this.callAPI(prompt, 300);

      if (result.candidates && Array.isArray(result.candidates)) {
        return result.candidates.map(c => ({
          word: c.word,
          register: c.register || 'neutral',
          commonness: c.commonness || 'common',
          note: c.note || 'AI-generated',
          source: 'llm'
        }));
      }

      return [];
    } catch (error) {
      console.error('Error getting synonyms from HF:', error);
      return [];
    }
  }

  async rephrase(sentence, preset, settings) {
    const presetMap = {
      shorter: 'shorter',
      clearer: 'clearer',
      formal: 'more formal',
      casual: 'more casual'
    };

    const presetName = presetMap[preset] || 'clearer';
    const maxChars = settings.maxChars || 500;
    const truncatedSentence = sentence.slice(0, maxChars);

    const prompt = `<s>[INST] Rewrite this sentence to be ${presetName}:

"${truncatedSentence}"

Return 3 options as valid JSON:
{"rewrites": [{"text": "option1", "note": "explanation"}, {"text": "option2", "note": "explanation"}, {"text": "option3", "note": "explanation"}]}
[/INST]`;

    try {
      const result = await this.callAPI(prompt, 400);

      if (result.rewrites && Array.isArray(result.rewrites)) {
        return result.rewrites.map(r => ({
          text: r.text,
          note: r.note || presetName,
          confidence: 0.85
        }));
      }

      return [];
    } catch (error) {
      console.error('Error getting rephrases from HF:', error);
      return [];
    }
  }
}

/**
 * Custom HTTP endpoint provider
 */
class CustomProvider extends Provider {
  constructor(config) {
    super(config);
    this.url = config.url;
    this.headers = config.headers || {};
  }

  async callAPI(payload) {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Custom API Error: ${response.status} - ${error}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Custom API call failed:', error);
      throw error;
    }
  }

  async getSynonyms(wordInfo, settings) {
    try {
      const result = await this.callAPI({
        action: 'synonyms',
        word: wordInfo.word,
        pos: wordInfo.pos,
        context: wordInfo.context.sentence.slice(0, settings.maxChars || 500),
        settings
      });

      if (result.candidates && Array.isArray(result.candidates)) {
        return result.candidates.map(c => ({
          ...c,
          source: 'llm'
        }));
      }

      return [];
    } catch (error) {
      console.error('Error getting synonyms from custom API:', error);
      return [];
    }
  }

  async rephrase(sentence, preset, settings) {
    try {
      const result = await this.callAPI({
        action: 'rephrase',
        sentence: sentence.slice(0, settings.maxChars || 500),
        preset,
        settings
      });

      if (result.rewrites && Array.isArray(result.rewrites)) {
        return result.rewrites;
      }

      return [];
    } catch (error) {
      console.error('Error getting rephrases from custom API:', error);
      return [];
    }
  }
}

/**
 * Factory function to create provider instance
 * @param {Object} config - Provider configuration
 * @returns {Provider} Provider instance
 */
export function createProvider(config) {
  if (!config || !config.type) {
    return new NoneProvider();
  }

  switch (config.type) {
    case 'openai':
      if (!config.apiKey || !config.endpoint) {
        console.warn('OpenAI provider missing credentials, using None provider');
        return new NoneProvider();
      }
      return new OpenAIProvider(config);

    case 'huggingface':
      if (!config.apiKey) {
        console.warn('Hugging Face provider missing API key, using None provider');
        return new NoneProvider();
      }
      return new HuggingFaceProvider(config);

    case 'custom':
      if (!config.url) {
        console.warn('Custom provider missing URL, using None provider');
        return new NoneProvider();
      }
      return new CustomProvider(config);

    case 'none':
    default:
      return new NoneProvider();
  }
}

/**
 * Test provider connection
 * @param {Provider} provider - Provider instance
 * @returns {Promise<boolean>} True if connection successful
 */
export async function testProvider(provider) {
  if (provider.type === 'none') {
    return true; // Always works
  }

  try {
    // Try a simple synonym request
    const testWordInfo = {
      word: 'good',
      lemma: 'good',
      pos: 'adj',
      context: {
        sentence: 'This is a good example.',
        before: 'This is a ',
        target: 'good',
        after: ' example.'
      }
    };

    const settings = {
      domain: 'general',
      maxChars: 200,
      avoidJargon: false
    };

    const results = await provider.getSynonyms(testWordInfo, settings);

    // If we get at least one result, consider it working
    return Array.isArray(results) && results.length > 0;
  } catch (error) {
    console.error('Provider test failed:', error);
    return false;
  }
}
