# WordGen — Context-Aware Synonyms & Smart Rewrites

A LanguageTool-style, context-aware synonym finder and sentence rephrasing tool built entirely for the browser. WordGen helps you find the perfect word replacement while preserving meaning and context.

## Features

✨ **Context-Aware Synonyms**: Get ranked synonym suggestions that fit your sentence context
🔄 **Smart Rephrasing**: Rewrite sentences to be shorter, clearer, more formal, or more casual
💻 **Offline First**: Works entirely in your browser using built-in lexicon and embeddings
🤖 **Optional LLM Integration**: Enhance results with your own API key (OpenAI, Hugging Face, or custom)
🔒 **Privacy Focused**: No data sent to servers unless you configure an API
⌨️ **Keyboard Navigation**: Full keyboard support for power users
🎨 **Dark Mode**: Easy on the eyes with automatic theme switching
📱 **Responsive**: Works seamlessly on desktop and mobile

## Quick Start

1. **Open WordGen**: Navigate to `https://viper-vm.github.io/demos/wordgen/`
2. **Paste or type** text in the editor (or click "Load Sample" for demo text)
3. **Double-click or select** any word to see synonym suggestions
4. **Click "Apply"** to replace the word
5. **Switch to "Rephrase" tab** to rewrite entire sentences

## How It Works

### Local Mode (No API Required)

WordGen works out of the box using:
- **Built-in Lexicon**: 60+ common words with curated synonyms from WordNet
- **Word Embeddings**: Semantic similarity using compact word vectors
- **N-gram Frequency Data**: Fluency scoring based on common English patterns
- **Rule-based Rephrasing**: Basic sentence transformations (contractions, filler removal, etc.)

### Enhanced Mode (With LLM API)

For better results, configure an LLM provider in Settings:

1. Click **Settings** in the header
2. Choose a provider:
   - **OpenAI-Compatible** (OpenAI, Azure OpenAI, etc.)
   - **Hugging Face Inference**
   - **Custom HTTP** endpoint
3. Enter your API credentials (stored locally in browser only)
4. Click **Save Settings**

## Supported LLM Providers

### OpenAI-Compatible

```
Endpoint: https://api.openai.com/v1/chat/completions
API Key: sk-...
Model: gpt-3.5-turbo (or gpt-4, etc.)
```

Works with:
- OpenAI API
- Azure OpenAI
- LocalAI
- Ollama (with OpenAI compatibility layer)
- Any OpenAI-compatible endpoint

### Hugging Face Inference

```
API Key: hf_...
Model: mistralai/Mistral-7B-Instruct-v0.2
```

Recommended models:
- `mistralai/Mistral-7B-Instruct-v0.2`
- `meta-llama/Llama-2-7b-chat-hf`
- `tiiuae/falcon-7b-instruct`

### Custom HTTP

Specify your own endpoint with custom headers. Expected request/response format:

**Request:**
```json
{
  "action": "synonyms|rephrase",
  "word": "example",
  "pos": "noun",
  "context": "This is an example sentence.",
  "settings": {...}
}
```

**Response for Synonyms:**
```json
{
  "candidates": [
    {
      "word": "sample",
      "register": "neutral",
      "commonness": "common",
      "note": "General instance"
    }
  ]
}
```

**Response for Rephrase:**
```json
{
  "rewrites": [
    {
      "text": "This is a sample sentence.",
      "note": "Shorter version"
    }
  ]
}
```

## Settings

### Context Window
- **Default**: 300 characters
- Controls how much surrounding text is analyzed for context
- Larger values provide better context but may hit API limits

### Style Defaults

- **Formality**: Casual / Neutral / Formal
- **Brevity**: Prefer Shorter / Keep Length / Allow Longer
- **Domain**: General / Tech / Legal / Medical
- **Avoid Jargon**: Boolean toggle

### Privacy

- **Max Characters to Send**: Limits data sent to external APIs (default: 500)
- API keys are stored only in your browser's `localStorage`
- No data is sent to any server unless you configure a provider

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate suggestions |
| `Enter` | Apply selected suggestion |
| `Esc` | Close suggestions panel |
| `Ctrl+Z` | Undo replacement |

## Architecture

### File Structure

```
wordgen/
├── index.html              # Main app page
├── README.md              # This file
├── css/
│   └── styles.css         # Precompiled styles with dark mode
├── js/
│   ├── main.js           # App initialization & orchestration
│   ├── nlp.js            # Tokenization, POS tagging, sentence split
│   ├── pipeline.js       # Candidate generation, ranking, rephrasing
│   ├── providers.js      # LLM API adapters
│   ├── ui.js             # UI components (editor, suggestions, modals)
│   └── storage.js        # localStorage helpers
├── assets/
│   ├── lexicon.json      # WordNet-style synonym mappings
│   ├── mini-embeddings.json  # Compact word vectors (8-dim)
│   ├── ngram-freq.json   # Trigram frequency data
│   └── demo-texts.json   # Sample paragraphs
└── server/               # Optional Python backend (not used by Pages)
    ├── main.py
    ├── requirements.txt
    └── README.md
```

### NLP Pipeline

1. **Word Selection**: User double-clicks or highlights a word
2. **Context Extraction**: Capture ±1 sentence for context
3. **POS Tagging**: Identify part of speech using rule-based heuristics
4. **Lemmatization**: Convert to base form
5. **Candidate Generation**:
   - Lexical synonyms from `lexicon.json`
   - Embedding neighbors from `mini-embeddings.json`
   - LLM suggestions (if provider configured)
6. **Ranking**:
   - **Semantic Score** (55%): Sentence embedding similarity
   - **Fluency Score** (30%): N-gram probability
   - **Style Score** (15%): Formality/brevity preferences
7. **Inflection**: Match original word's form (plural, tense, capitalization)
8. **Display**: Show top 5 in "Synonyms", extended list in "More"

### Rephrase Presets

- **Shorter**: Remove fillers, use contractions
- **Clearer**: Split complex sentences, simplify structure
- **More Formal**: Expand contractions, use formal vocabulary
- **More Casual**: Use contractions, simpler words

## Extending WordGen

### Adding More Synonyms

Edit `assets/lexicon.json`:

```json
{
  "example_noun": {
    "synonyms": ["sample", "instance", "illustration", "case"]
  }
}
```

### Using Larger Embeddings

Replace `assets/mini-embeddings.json` with larger word vectors. Format:

```json
{
  "word": [0.1, 0.2, ..., 0.8],  // 8-dimensional vector
  "another": [0.3, 0.4, ..., 0.6]
}
```

Recommended sources:
- GloVe (dimensionality-reduced to 8D)
- word2vec (compressed)
- FastText

### Tuning Ranking Weights

In `js/pipeline.js`, adjust the scoring formula:

```javascript
const totalScore = (semanticScore * 0.55) + (fluencyScore * 0.30) + (styleScore * 0.15);
```

## Deployment to GitHub Pages

1. **Copy the `wordgen/` folder** to your repo under `/demos/`
2. **Ensure paths are relative** (already configured)
3. **Update `/assets/data/demos.json`** with WordGen entry:

```json
{
  "id": "wordgen",
  "title": "WordGen",
  "summary": "Context-aware synonyms & smart rewrites",
  "category": "Writing",
  "demo_url": "/demos/wordgen/"
}
```

4. **Commit and push** to GitHub
5. **Enable GitHub Pages** in repo settings (if not already enabled)
6. **Access at**: `https://yourusername.github.io/demos/wordgen/`

## Python Backend (Optional)

A FastAPI backend stub is provided in `server/` for future deployment to a separate server. This is **not required** for the GitHub Pages deployment.

To run locally:

```bash
cd server
pip install -r requirements.txt
uvicorn main:app --reload
```

Then configure WordGen to use `http://localhost:8000` as a Custom HTTP provider.

## Browser Compatibility

- ✅ Chrome/Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## Performance

- **Initial Load**: < 2s (including all assets)
- **Synonym Generation** (local): < 250ms
- **Synonym Generation** (with LLM): 1-3s (network dependent)
- **Total Bundle Size**: ~200 KB (gzipped)

## Privacy & Security

- **No Analytics**: WordGen does not track usage
- **No External Requests** (local mode): Everything runs in your browser
- **API Keys**: Stored only in `localStorage`, never transmitted except to your configured provider
- **Open Source**: Inspect all code in this repo

## Troubleshooting

### Synonyms Not Loading

- Check browser console for errors
- Ensure `assets/*.json` files are accessible
- Try refreshing the page

### LLM Provider Not Working

- Verify API credentials in Settings
- Check API endpoint URL (must include full path)
- Review browser network tab for failed requests
- Ensure API key has sufficient credits/quota

### Suggestions Not Relevant

- Local mode has limited vocabulary (~100 words)
- Configure an LLM provider for better results
- Try selecting a more common word

## Future Enhancements

- 🔌 Chrome Extension (inject WordGen into any text field)
- 📦 Larger built-in lexicon (1000+ words)
- 🌐 Multilingual support
- 📊 User preference learning
- 🔊 Text-to-speech for suggestions
- 📝 Grammar checking integration

## Credits

Built by **Vivek Modi** ([viper-vm](https://github.com/viper-vm))

- NLP algorithms inspired by WordNet and spaCy
- UI design influenced by Grammarly and LanguageTool
- Embeddings concept from word2vec/GloVe research

## License

This project is part of Vivek Modi's personal portfolio and is available for educational purposes.

## Feedback

Found a bug or have a suggestion? [Open an issue](https://github.com/viper-vm/viper-vm.github.io/issues) or contact me at vivekvm8400@gmail.com.

---

**WordGen** — Smarter writing, one word at a time. ✨
