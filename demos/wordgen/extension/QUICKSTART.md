# WordGen Chrome Extension - Quick Start Guide

## 🚀 Installation (5 minutes)

### Step 1: Generate Icons

1. Open `icons/generate-icons.html` in your web browser
2. Click the **"Download All Icons"** button
3. Save the three files that download:
   - `icon16.png`
   - `icon48.png`
   - `icon128.png`
4. Move these files into the `extension/icons/` folder (replace if asked)

### Step 2: Load Extension in Chrome

1. Open Google Chrome
2. Go to `chrome://extensions/` (paste this in address bar)
3. Enable **"Developer mode"** (toggle switch in top-right corner)
4. Click **"Load unpacked"** button
5. Navigate to and select the `extension` folder from this repository
6. The WordGen extension icon should appear in your toolbar!

### Step 3: Test It Out

1. Go to any website (try [Wikipedia](https://en.wikipedia.org))
2. **Double-click any word** on the page
3. A floating widget should appear with synonym suggestions
4. **Click any suggestion** to replace the word

That's it! You're ready to use WordGen.

## 🎯 Quick Tips

### Basic Usage
- **Double-click** any word → instant synonyms
- **Right-click** selected text → "Find Synonyms with WordGen"
- **Click extension icon** → view stats and quick settings
- **Ctrl+Shift+W** (or Cmd+Shift+W on Mac) → open popup

### Customization
- **Click extension icon** → adjust number of suggestions (3, 5, 7, or 10)
- **Right-click icon** → "Options" → full settings page
- **Settings page** → customize trigger method, theme, site control, and more

### Site Control
1. Click extension icon
2. Toggle the switch to enable/disable for current site
3. Or go to Settings → Site Control for whitelist/blacklist management

## 📝 Common Use Cases

### 1. Writing Emails (Gmail)
1. Compose a new email
2. Double-click any word you want to improve
3. Pick a better synonym from the suggestions
4. One-click replacement

### 2. Writing Articles (Medium, WordPress)
1. Draft your article
2. Double-click words that feel repetitive
3. Choose more varied synonyms
4. Improve your writing quality

### 3. Social Media Posts (Twitter, LinkedIn)
1. Start composing a post
2. Double-click to find punchier alternatives
3. Make your posts more engaging

### 4. Reading & Learning (Any website)
1. Double-click unfamiliar words
2. See synonyms to understand meaning
3. Learn vocabulary variations

## ⚙️ Settings Overview

### General Settings
- **Number of Suggestions**: How many synonyms to show (default: 5)
- **Trigger Method**: Double-click, Ctrl+Click, or Context Menu Only
- **Theme**: Auto, Light, or Dark mode
- **Show POS Tags**: Display grammar labels like "noun", "verb", etc.

### Site Control
- **All websites**: Extension works everywhere
- **Whitelist mode**: Only works on approved sites
- **Blacklist mode**: Works everywhere except blocked sites

### Optional Features
- **LLM Integration**: Connect OpenAI, Hugging Face, or custom API for AI-powered suggestions
  - Not required! Extension works great offline without this
  - Only use if you want even better context-aware suggestions

## 🐛 Troubleshooting

### Extension not loading?
- Make sure you have the PNG icons in the `icons/` folder
- Use the icon generator HTML file to create them

### Widget not appearing?
- Check if extension is enabled (toolbar icon should be colored, not gray)
- Verify the site isn't blacklisted
- Try refreshing the page

### Wrong suggestions?
- The extension works offline with a basic lexicon
- For better results, enable LLM integration in Settings
- Or customize the lexicon in `assets/lexicon.json`

## 📚 Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Explore the Settings page (right-click icon → Options)
- Customize the lexicon to add your own synonyms
- Check out the [WordGen Web App](https://viper-vm.github.io/demos/wordgen/) for more features

## 💡 Pro Tips

1. **Keyboard Navigation**: Use Tab/Arrow keys to navigate suggestions (coming soon)
2. **Quick Toggle**: Click the extension icon to quickly disable for current site
3. **Custom Hotkey**: Ctrl+Shift+W to open popup (configurable in chrome://extensions/shortcuts)
4. **Batch Editing**: Use the web app for longer documents with more features

---

**Need help?** Check the [full README](README.md) or visit the [WordGen web app](https://viper-vm.github.io/demos/wordgen/) for documentation.
