# Diff Checker

An advanced text comparison tool with comprehensive analytics, history management, and file upload support.

## Features

### 🔍 **Core Diff Functionality**
- **Word-level diff** ⭐ - Only highlights the exact words/phrases that changed, not entire lines
- **Character-precise highlighting** - Pinpoint accuracy showing only what changed
- **Smart line management** - Handles omitted/inserted lines intelligently
- **Side-by-side comparison** - Split view showing original and modified text
- **Unified diff view** - Traditional unified diff output with inline changes
- **Inline change markers** - Changed words highlighted within their context
- **Line numbers** - Optional line number display
- **Ignore options** - Ignore whitespace and case sensitivity

### 📊 **Advanced Analytics**
- **Character count** (with and without spaces)
- **Word count**
- **Line count**
- **Paragraph count**
- **Reading time estimate** (200 words/min)
- **Similarity percentage** using Levenshtein distance
- **Character distribution** showing top 20 most used characters
- **Visual progress bars** for metrics

### 📁 **File Upload Support**
Supports a wide range of file formats:

**Text Files:**
- `.txt`, `.md`, `.csv`

**Documents:**
- `.pdf` (with full text extraction)
- `.docx`, `.doc` (Microsoft Word)

**Code Files:**
- `.py` (Python)
- `.js`, `.jsx`, `.ts`, `.tsx` (JavaScript/TypeScript)
- `.java` (Java)
- `.html`, `.css` (Web)
- `.json`, `.xml`, `.yaml`, `.yml` (Data)
- `.go` (Go)
- `.rs` (Rust)
- `.cpp`, `.c`, `.h` (C/C++)
- `.php` (PHP)
- `.rb` (Ruby)
- `.swift` (Swift)
- `.kt` (Kotlin)
- `.sh`, `.bash` (Shell scripts)

### ✨ **Format Document**
Auto-format your code in various languages:
- **JSON** - Pretty print with 2-space indentation
- **XML/HTML** - Proper tag indentation
- **CSS** - Rule formatting and organization
- **JavaScript** - Block formatting and indentation
- **Python** - PEP 8-style formatting
- **SQL** - Keyword capitalization and structure
- **Markdown** - Consistent spacing and formatting

### 🕒 **History Management**
- **Save comparisons** with custom names
- **localStorage persistence** - History saved locally
- **Quick restore** - Load previous comparisons instantly
- **Metadata tracking** - Timestamps, stats, and names
- **Configurable limit** - Set max history items (10-100)
- **Bulk operations** - Clear all history at once

### ⚙️ **Settings**
- **Theme** - Auto (system), Light, or Dark mode
- **Font size** - Adjustable editor font (12-18px)
- **Default options** - Set default diff preferences
- **Auto-save** - Automatically save comparisons
- **Storage management** - View and clear storage usage

### 🎨 **UI/UX Features**
- **Responsive design** - Works on desktop, tablet, and mobile
- **Smooth animations** - Polished transitions and effects
- **Toast notifications** - Non-intrusive feedback
- **Keyboard shortcuts** ready
- **Copy diff** - Copy comparison results to clipboard
- **Export diff** - Save as HTML file
- **Print support** - Clean print layout

## Usage

### Basic Comparison
1. Paste or type text in the **Original Text** editor
2. Paste or type text in the **Modified Text** editor
3. View the **Comparison Result** automatically

**How Word-Level Diff Works:**
- Unlike traditional diff tools that highlight entire lines, this tool shows **exactly** what changed
- Example: If you change "The quick brown fox" to "The fast brown fox", only "quick" → "fast" is highlighted
- Omitted lines are shown with appropriate spacing, not as entire block deletions
- Context is preserved - unchanged text remains visible and unhighlighted

### Upload Files
1. Click **Upload Left** or **Upload Right**
2. Select a supported file format
3. File content will be loaded into the editor

### Format Document
1. Enter text in either editor
2. Click the **Format** button on the editor header
3. Select the format type (JSON, Python, JavaScript, etc.)
4. Text will be automatically formatted

### Save Comparison
1. Click **Save** in the sidebar
2. Enter a name for the comparison
3. Access it later from the **History** view

### View Analytics
1. Switch to **Analytics** view from sidebar
2. View detailed statistics for both texts
3. See comparison metrics and character distribution

## Technical Details

### Libraries Used
- **jsdiff** (v5.1.0) - Diff algorithm
- **PDF.js** (v3.11.174) - PDF text extraction
- **Mammoth.js** (v1.6.0) - DOCX parsing
- **Lucide Icons** - Icon system

### Storage
- Uses `localStorage` for:
  - Comparison history
  - User settings
  - Theme preference

### Browser Support
- Modern browsers with ES6+ support
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Keyboard Shortcuts (Coming Soon)
- `Ctrl/Cmd + S` - Save comparison
- `Ctrl/Cmd + D` - Toggle diff view
- `Ctrl/Cmd + K` - Clear all text
- `Ctrl/Cmd + ,` - Open settings

## Development

### File Structure
```
/demos/diff/
├── index.html      # Main HTML structure
├── styles.css      # Complete styling and themes
├── app.js          # Application logic
└── README.md       # This file
```

### Key Classes
- `DiffChecker` - Main application class
- Format functions for each language
- File readers for PDF/DOCX
- Levenshtein distance algorithm

## Performance

- **Fast diff computation** - Handles large texts (>100K characters)
- **Efficient rendering** - Virtual scrolling for large diffs
- **Optimized storage** - Compression for history
- **Lazy loading** - Icons and heavy libraries loaded on demand

## Privacy

- **100% client-side** - All processing happens in your browser
- **No server uploads** - Files never leave your device
- **No tracking** - No analytics or external calls
- **Local storage only** - Data saved locally on your machine

## Future Enhancements

- [ ] Word-level diff highlighting
- [ ] Multiple file comparison
- [ ] Syntax highlighting for code
- [ ] Diff statistics export (CSV/JSON)
- [ ] Shareable comparison links
- [ ] Dark mode improvements
- [ ] Accessibility improvements (ARIA labels)
- [ ] More format types (Ruby, PHP, etc.)

## Credits

Built by **Vivek Modi** as part of the live demos portfolio.

## License

Part of viper-vm.github.io portfolio. See main repository for license details.
