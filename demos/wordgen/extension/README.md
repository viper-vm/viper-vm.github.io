# WordGen Chrome Extension

> 🚀 Smart synonym finder that works everywhere on the web. Double-click any word to get instant, context-aware synonym suggestions.

## Features

- **Double-Click Activation**: Simply double-click any word on any webpage to get synonym suggestions
- **Context-Aware Suggestions**: Get 5 (customizable) intelligent synonym options ranked by relevance
- **One-Click Replacement**: Click any suggestion to instantly replace the word
- **Offline-First**: Works completely offline with built-in lexicon and word embeddings
- **Smart Capitalization**: Preserves capitalization when replacing words
- **Beautiful UI**: Clean, modern floating widget that doesn't interfere with page content
- **Site Control**: Whitelist/blacklist specific websites
- **Editable Fields**: Works in input fields, textareas, and contenteditable areas
- **Context Menu**: Right-click any selected text → "Find Synonyms with WordGen"
- **Optional LLM Enhancement**: Integrate OpenAI, Hugging Face, or custom APIs for even better suggestions
- **Dark Mode Support**: Automatically adapts to system theme preferences
- **Keyboard Shortcut**: `Ctrl+Shift+W` (or `Cmd+Shift+W` on Mac) to open extension popup

## Installation

### From Source (Development)

1. **Clone or download** the repository to your local machine

2. **Generate icon files**:
   - Open `extension/icons/generate-icons.html` in your browser
   - Click "Download All Icons"
   - Save the three PNG files (icon16.png, icon48.png, icon128.png) in the `extension/icons/` folder

3. **Load the extension in Chrome**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)
   - Click "Load unpacked"
   - Select the `extension` folder from this repository

4. **You're ready!** The extension is now installed and active.

### Testing the Extension

1. Navigate to any webpage (e.g., Wikipedia, Medium, Gmail)
2. Double-click any word
3. A floating widget will appear with synonym suggestions
4. Click any suggestion to replace the word

## Usage

### Basic Usage

1. **Double-click a word** on any webpage
2. Browse the **top 5 synonym suggestions** (or your custom number)
3. **Click a suggestion** to replace the word instantly
4. The widget **auto-dismisses** when you scroll or click elsewhere

### Context Menu

1. **Select any text** on a webpage
2. **Right-click** → **"Find Synonyms with WordGen"**
3. View suggestions in the floating widget

### Extension Popup

Click the WordGen icon in your browser toolbar to:
- View **usage statistics** (words replaced today/total)
- **Enable/disable** the extension for the current site
- Adjust **quick settings** (number of suggestions, trigger method)
- **Open settings** page for advanced configuration

### Settings Page

Right-click the extension icon → **Options** (or click "Settings" in popup) to access:

#### General Settings
- **Number of Suggestions**: 3, 5, 7, or 10 synonyms
- **Trigger Method**: Double-click, Ctrl+Click, or Context Menu Only
- **Popup Position**: Near word or fixed bottom-right
- **Theme**: Auto, Light, or Dark
- **Show POS Tags**: Display part-of-speech labels (noun, verb, etc.)
- **Auto-dismiss on Scroll**: Hide widget when scrolling

#### Site Control
- **Enable Extension On**: All websites, only whitelisted, or all except blacklisted
- **Whitelist/Blacklist Management**: Add or remove specific domains

#### LLM Provider (Optional)
Enhance suggestions with AI (not required for basic functionality):
- **OpenAI**: Use GPT models for context-aware suggestions
- **Hugging Face**: Use open-source models
- **Custom API**: Integrate your own API endpoint

#### Statistics
- View words replaced today and total
- Reset statistics

#### Data Management
- Export settings to JSON file
- Import settings from JSON file
- Reset all settings to defaults

## Architecture

### File Structure

```
extension/
├── manifest.json           # Extension configuration (Manifest V3)
├── README.md              # This file
│
├── background/
│   └── service-worker.js  # Background script (synonym generation, API calls)
│
├── content/
│   ├── content.js         # Content script (double-click detection, widget)
│   └── content.css        # Widget styling
│
├── popup/
│   ├── popup.html         # Extension popup UI
│   ├── popup.js           # Popup logic
│   └── popup.css          # Popup styling
│
├── options/
│   ├── options.html       # Settings page UI
│   ├── options.js         # Settings logic
│   └── options.css        # Settings styling
│
├── shared/
│   ├── nlp.js            # NLP utilities (tokenization, POS tagging, lemmatization)
│   ├── pipeline.js       # Synonym generation pipeline
│   └── storage-adapter.js # Chrome storage wrapper
│
├── assets/
│   ├── lexicon.json      # Synonym mappings (WordNet-style)
│   ├── mini-embeddings.json # Word vectors for semantic similarity
│   └── ngram-freq.json   # N-gram frequency data
│
└── icons/
    ├── generate-icons.html # Icon generator tool
    ├── wordgen-icon.svg   # Source SVG icon
    ├── icon16.png         # 16x16 icon
    ├── icon48.png         # 48x48 icon
    └── icon128.png        # 128x128 icon
```

### How It Works

1. **Content Script** (`content.js`) runs on every webpage and listens for double-clicks
2. When a word is double-clicked:
   - Content script extracts the word and surrounding context
   - Sends a message to the **background service worker**
3. **Service Worker** (`service-worker.js`):
   - Analyzes the word (tokenization, POS tagging, lemmatization)
   - Generates synonym candidates from lexicon and embeddings
   - Ranks candidates by relevance and similarity
   - Returns top N suggestions
4. **Content Script** displays the **floating widget** with suggestions
5. User clicks a suggestion → Content script replaces the word
6. Service worker **increments statistics** counter

### NLP Pipeline

The extension uses a multi-source synonym generation pipeline:

1. **Lexical Synonyms**: From built-in WordNet-style lexicon
2. **Embedding-based Synonyms**: Cosine similarity using word vectors
3. **Ranking Algorithm**: Combines scores from multiple sources
4. **Context Filtering**: (Future) Filter by sentence context
5. **LLM Enhancement**: (Optional) Use GPT/Llama for context-aware suggestions

## Customization

### Adding Your Own Synonyms

Edit `assets/lexicon.json`:

```json
{
  "happy_adjective": {
    "synonyms": ["joyful", "cheerful", "content", "pleased", "delighted"]
  },
  "run_verb": {
    "synonyms": ["sprint", "jog", "dash", "race", "hurry"]
  }
}
```

### Integrating Custom LLM API

1. Go to **Settings** → **LLM Provider** → **Custom API**
2. Enter your API URL and headers:

```json
{
  "Authorization": "Bearer YOUR_API_KEY",
  "Content-Type": "application/json"
}
```

3. The extension will send POST requests with:

```json
{
  "word": "happy",
  "context": "I am very happy today.",
  "num_suggestions": 5
}
```

Expected response format:

```json
{
  "synonyms": [
    {
      "word": "joyful",
      "similarity": 0.95,
      "register": "neutral",
      "commonness": "common"
    }
  ]
}
```

## Privacy & Security

- **100% Local Processing**: All synonym generation happens locally by default
- **No Data Collection**: We don't collect, store, or transmit any user data
- **No Tracking**: No analytics, no telemetry, no third-party services
- **Optional API Calls**: LLM integration is opt-in and requires user-provided API keys
- **Open Source**: Full source code available for audit

## Performance

- **Instant Suggestions**: < 100ms response time for most words
- **Lightweight**: < 5MB total extension size (including assets)
- **Memory Efficient**: Caches assets on installation, minimal runtime memory
- **No Network Calls**: Works completely offline (unless LLM integration enabled)

## Browser Compatibility

- ✅ **Google Chrome** 88+ (Manifest V3 support)
- ✅ **Microsoft Edge** 88+
- ✅ **Brave Browser** 1.20+
- ✅ **Opera** 74+
- ❌ Firefox (requires Manifest V2 port)
- ❌ Safari (requires different extension format)

## Known Limitations

1. **Limited POS Tagging**: Simple heuristic-based POS tagging (not ML-based)
2. **Static Text Replacement**: Limited support for replacing text in non-editable areas (depends on website structure)
3. **Context Understanding**: Basic context analysis (improved with LLM integration)
4. **Offline Lexicon Size**: ~10,000 common words (expandable by user)

## Troubleshooting

### Extension not working on certain sites

- Check if the site is blacklisted in Settings → Site Control
- Some sites (chrome://, chrome-extension://) are protected and don't allow extensions
- Try reloading the page after installing the extension

### Widget not appearing

- Ensure the extension is enabled (check toolbar icon)
- Try double-clicking more slowly (two distinct clicks)
- Check browser console for errors (F12 → Console)

### Icons not showing

- Generate PNG icons using `extension/icons/generate-icons.html`
- Ensure icon16.png, icon48.png, icon128.png exist in `icons/` folder
- Reload the extension in `chrome://extensions/`

### Synonyms not relevant

- Enable LLM integration for better context-aware suggestions
- Customize the lexicon in `assets/lexicon.json`
- Adjust ranking algorithm in `background/service-worker.js`

## Development

### Building from Source

```bash
# Navigate to extension directory
cd extension/

# Generate icons (open in browser)
open icons/generate-icons.html

# Load in Chrome
# 1. Go to chrome://extensions/
# 2. Enable Developer mode
# 3. Click "Load unpacked"
# 4. Select extension/ folder
```

### Debugging

1. **Background Script**: Right-click extension icon → "Inspect service worker"
2. **Content Script**: Open page → F12 → Console (filter by extension)
3. **Popup**: Right-click popup → "Inspect"

### Testing

Test on various websites:
- **Gmail**: Composing emails
- **Google Docs**: (limited support, use native suggestion)
- **Medium**: Writing articles
- **Twitter**: Composing tweets
- **Wikipedia**: Reading and editing
- **GitHub**: Writing issues and PRs

## Roadmap

- [ ] Firefox support (Manifest V2 port)
- [ ] Safari support
- [ ] Advanced context analysis (sentence embeddings)
- [ ] Thesaurus mode (show definitions, antonyms, examples)
- [ ] Multi-word phrase suggestions
- [ ] Custom hotkey configuration
- [ ] Synonym history and favorites
- [ ] Integration with writing tools (Grammarly, etc.)
- [ ] Offline LLM support (local Llama/GPT models)

## Contributing

Contributions welcome! This is part of the WordGen project.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - See main repository for full license text.

## Credits

- **Built by**: Vivek Modi
- **Portfolio**: [https://viper-vm.github.io/](https://viper-vm.github.io/)
- **WordGen Web App**: [https://viper-vm.github.io/demos/wordgen/](https://viper-vm.github.io/demos/wordgen/)
- **Lexicon Data**: Derived from WordNet and custom curated lists
- **Word Embeddings**: Mini embeddings trained on Common Crawl corpus

## Support

- **Web App**: [https://viper-vm.github.io/demos/wordgen/](https://viper-vm.github.io/demos/wordgen/)
- **GitHub**: [https://github.com/viper-vm](https://github.com/viper-vm)
- **Issues**: Report bugs via GitHub Issues

---

**Made with ❤️ for better writing**
