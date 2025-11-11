// ============================================
// Diff Checker Application
// ============================================

class DiffChecker {
  constructor() {
    this.leftText = '';
    this.rightText = '';
    this.diffResult = null;
    this.settings = this.loadSettings();
    this.history = this.loadHistory();

    this.init();
  }

  // ============================================
  // Initialization
  // ============================================
  init() {
    this.initElements();
    this.initEventListeners();
    this.applySettings();
    this.initLucideIcons();
    this.updateAnalytics();
    this.renderHistory();
  }

  initElements() {
    // Views
    this.views = {
      diff: document.getElementById('view-diff'),
      analytics: document.getElementById('view-analytics'),
      history: document.getElementById('view-history'),
      settings: document.getElementById('view-settings')
    };

    // Editors
    this.leftEditor = document.getElementById('leftEditor');
    this.rightEditor = document.getElementById('rightEditor');

    // Outputs
    this.diffOutput = document.getElementById('diffOutput');

    // Stats
    this.stats = {
      added: document.getElementById('statAdded'),
      removed: document.getElementById('statRemoved'),
      modified: document.getElementById('statModified'),
      similarity: document.getElementById('statSimilarity')
    };

    // File inputs
    this.fileInputLeft = document.getElementById('fileInputLeft');
    this.fileInputRight = document.getElementById('fileInputRight');

    // Toast
    this.toast = document.getElementById('toast');
    this.toastMessage = document.getElementById('toastMessage');

    // Modal
    this.formatModal = document.getElementById('formatModal');
    this.currentFormatSide = null;
  }

  initEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => this.switchView(e.currentTarget.dataset.view));
    });

    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => this.toggleTheme());

    // Editors
    this.leftEditor.addEventListener('input', () => this.handleTextChange('left'));
    this.rightEditor.addEventListener('input', () => this.handleTextChange('right'));

    // Toolbar buttons
    document.getElementById('uploadLeft').addEventListener('click', () => this.fileInputLeft.click());
    document.getElementById('uploadRight').addEventListener('click', () => this.fileInputRight.click());
    document.getElementById('copyDiff').addEventListener('click', () => this.copyDiff());
    document.getElementById('exportDiff').addEventListener('click', () => this.exportDiff());

    // File inputs
    this.fileInputLeft.addEventListener('change', (e) => this.handleFileUpload(e, 'left'));
    this.fileInputRight.addEventListener('change', (e) => this.handleFileUpload(e, 'right'));

    // Diff options
    document.getElementById('ignoreWhitespace').addEventListener('change', () => this.computeDiff());
    document.getElementById('ignoreCase').addEventListener('change', () => this.computeDiff());
    document.getElementById('showLineNumbers').addEventListener('change', () => this.computeDiff());

    // Recheck diff button
    document.getElementById('recheckDiff').addEventListener('click', () => {
      this.computeDiff();
      this.showToast('Diff rechecked successfully');
    });

    // View mode
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchDiffMode(e.currentTarget.dataset.mode));
    });

    // Sidebar actions
    document.getElementById('saveComparison').addEventListener('click', () => this.saveComparison());
    document.getElementById('clearAll').addEventListener('click', () => this.clearAll());

    // History
    document.getElementById('clearHistory').addEventListener('click', () => this.clearHistory());

    // Settings
    document.getElementById('settingTheme').addEventListener('change', (e) => this.changeTheme(e.target.value));
    document.getElementById('settingFontSize').addEventListener('change', (e) => this.changeFontSize(e.target.value));
    document.getElementById('clearStorage').addEventListener('click', () => this.clearStorage());

    // Settings checkboxes
    ['settingIgnoreWhitespace', 'settingIgnoreCase', 'settingLineNumbers', 'settingAutoSave', 'settingHistoryLimit'].forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('change', () => this.saveSettings());
      }
    });

    // Format buttons
    document.getElementById('formatLeft').addEventListener('click', () => this.openFormatModal('left'));
    document.getElementById('formatRight').addEventListener('click', () => this.openFormatModal('right'));

    // Modal controls
    document.getElementById('closeModal').addEventListener('click', () => this.closeFormatModal());
    this.formatModal.addEventListener('click', (e) => {
      if (e.target === this.formatModal) this.closeFormatModal();
    });

    // Format options
    document.querySelectorAll('.format-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const format = e.currentTarget.dataset.format;
        this.formatDocument(format);
      });
    });

    // Initialize PDF.js worker
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }

  initLucideIcons() {
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  // ============================================
  // View Management
  // ============================================
  switchView(viewName) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update views
    Object.keys(this.views).forEach(key => {
      this.views[key].classList.toggle('active', key === viewName);
    });

    // Update analytics when switching to analytics view
    if (viewName === 'analytics') {
      this.updateAnalytics();
    }

    // Update history when switching to history view
    if (viewName === 'history') {
      this.renderHistory();
    }

    // Update storage info when switching to settings
    if (viewName === 'settings') {
      this.updateStorageInfo();
    }
  }

  switchDiffMode(mode) {
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    this.computeDiff();
  }

  // ============================================
  // Text Handling
  // ============================================
  handleTextChange(side) {
    if (side === 'left') {
      this.leftText = this.leftEditor.value;
      document.getElementById('leftInfo').textContent = `${this.leftText.split('\n').length} lines`;
    } else {
      this.rightText = this.rightEditor.value;
      document.getElementById('rightInfo').textContent = `${this.rightText.split('\n').length} lines`;
    }

    this.computeDiff();
    this.updateAnalytics();
  }

  // ============================================
  // File Upload
  // ============================================
  async handleFileUpload(event, side) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await this.readFile(file);
      const editor = side === 'left' ? this.leftEditor : this.rightEditor;
      editor.value = text;
      this.handleTextChange(side);
      this.showToast(`File "${file.name}" loaded successfully`);
    } catch (error) {
      this.showToast(`Error loading file: ${error.message}`, 'error');
    }

    // Reset file input
    event.target.value = '';
  }

  async readFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();

    // Text files
    if (['txt', 'md', 'csv', 'py', 'js', 'ts', 'java', 'html', 'css', 'json', 'xml', 'yaml', 'yml', 'go', 'rs', 'cpp', 'c', 'h', 'jsx', 'tsx', 'php', 'rb', 'swift', 'kt', 'sh', 'bash'].includes(extension)) {
      return await this.readTextFile(file);
    }

    // PDF files
    if (extension === 'pdf') {
      return await this.readPDFFile(file);
    }

    // DOCX files
    if (extension === 'docx') {
      return await this.readDOCXFile(file);
    }

    // DOC files (basic support)
    if (extension === 'doc') {
      return await this.readTextFile(file);
    }

    throw new Error('Unsupported file format');
  }

  readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  async readPDFFile(file) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library not loaded');
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n\n';
    }

    return fullText.trim();
  }

  async readDOCXFile(file) {
    if (typeof mammoth === 'undefined') {
      throw new Error('Mammoth library not loaded');
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  // ============================================
  // Diff Computation
  // ============================================
  computeDiff() {
    if (!this.leftText && !this.rightText) {
      this.diffOutput.innerHTML = `
        <div class="empty-state">
          <i data-lucide="file-search"></i>
          <p>Enter text in both editors to see the comparison</p>
        </div>
      `;
      this.initLucideIcons();
      this.resetStats();
      return;
    }

    const ignoreWhitespace = document.getElementById('ignoreWhitespace').checked;
    const ignoreCase = document.getElementById('ignoreCase').checked;
    const showLineNumbers = document.getElementById('showLineNumbers').checked;
    const mode = document.querySelector('.view-mode-btn.active').dataset.mode;

    let leftText = this.leftText;
    let rightText = this.rightText;

    // Store original texts for display
    const originalLeft = this.leftText;
    const originalRight = this.rightText;

    // Apply preprocessing for comparison only
    if (ignoreCase) {
      leftText = leftText.toLowerCase();
      rightText = rightText.toLowerCase();
    }

    // Compute word-level diff with character precision
    const diff = this.computeWordLevelDiff(leftText, rightText, ignoreWhitespace);
    this.diffResult = diff;

    // Render diff with original text (preserve case)
    if (mode === 'split') {
      this.renderSplitDiffWordLevel(diff, showLineNumbers, originalLeft, originalRight);
    } else {
      this.renderUnifiedDiffWordLevel(diff, showLineNumbers, originalLeft, originalRight);
    }

    // Update stats
    this.updateDiffStats(diff);
  }

  computeWordLevelDiff(leftText, rightText, ignoreWhitespace) {
    // Split into lines first
    const leftLines = leftText.split('\n');
    const rightLines = rightText.split('\n');

    // Get line-level diff first to identify which lines changed
    const lineDiff = Diff.diffLines(leftText, rightText);

    // Build detailed word/char level diff
    const result = [];
    let leftLineIndex = 0;
    let rightLineIndex = 0;

    lineDiff.forEach(part => {
      const lines = part.value.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();

      if (!part.added && !part.removed) {
        // Unchanged lines
        lines.forEach(line => {
          result.push({
            type: 'equal',
            leftLine: line,
            rightLine: line,
            leftLineNum: ++leftLineIndex,
            rightLineNum: ++rightLineIndex
          });
        });
      } else if (part.removed) {
        // Store removed lines for pairing with added lines
        const removedLines = lines.map(line => ({
          line,
          lineNum: ++leftLineIndex
        }));

        // Look ahead to see if there are corresponding added lines
        result.push({
          type: 'removed',
          lines: removedLines,
          leftLineNum: removedLines[0].lineNum,
          rightLineNum: rightLineIndex
        });
      } else if (part.added) {
        // Store added lines
        const addedLines = lines.map(line => ({
          line,
          lineNum: ++rightLineIndex
        }));

        // Check if previous entry was removed (potential modification)
        const prevEntry = result[result.length - 1];
        if (prevEntry && prevEntry.type === 'removed') {
          // Merge as modification - compute word-level diff
          result[result.length - 1] = {
            type: 'modified',
            leftLines: prevEntry.lines,
            rightLines: addedLines,
            leftLineNum: prevEntry.leftLineNum,
            rightLineNum: addedLines[0].lineNum,
            wordDiff: this.computeWordDiff(
              prevEntry.lines.map(l => l.line).join('\n'),
              addedLines.map(l => l.line).join('\n'),
              ignoreWhitespace
            )
          };
        } else {
          result.push({
            type: 'added',
            lines: addedLines,
            leftLineNum: leftLineIndex,
            rightLineNum: addedLines[0].lineNum
          });
        }
      }
    });

    return result;
  }

  computeWordDiff(leftText, rightText, ignoreWhitespace) {
    // Compute word-level differences
    const wordDiff = Diff.diffWords(leftText, rightText);

    // Further refine to character level for modified words
    return wordDiff.map(part => {
      if (!part.added && !part.removed) {
        return { type: 'equal', value: part.value };
      } else if (part.added) {
        return { type: 'added', value: part.value };
      } else if (part.removed) {
        return { type: 'removed', value: part.value };
      }
    });
  }

  renderSplitDiffWordLevel(diff, showLineNumbers, originalLeft, originalRight) {
    let leftHTML = '';
    let rightHTML = '';

    diff.forEach(entry => {
      if (entry.type === 'equal') {
        // Unchanged line - show on both sides
        const leftLineNum = showLineNumbers ? `<span class="line-number">${entry.leftLineNum}</span>` : '';
        const rightLineNum = showLineNumbers ? `<span class="line-number">${entry.rightLineNum}</span>` : '';
        const content = this.escapeHtml(entry.leftLine);

        leftHTML += `<div class="diff-line">${leftLineNum}<span class="line-content">${content}</span></div>`;
        rightHTML += `<div class="diff-line">${rightLineNum}<span class="line-content">${content}</span></div>`;
      } else if (entry.type === 'removed') {
        // Pure deletion - show only on left
        entry.lines.forEach(lineObj => {
          const lineNum = showLineNumbers ? `<span class="line-number">${lineObj.lineNum}</span>` : '';
          leftHTML += `<div class="diff-line removed">${lineNum}<span class="line-content">${this.escapeHtml(lineObj.line)}</span></div>`;
        });
        // Add placeholder on right
        rightHTML += `<div class="diff-line diff-placeholder"></div>`.repeat(entry.lines.length);
      } else if (entry.type === 'added') {
        // Pure addition - show only on right
        entry.lines.forEach(lineObj => {
          const lineNum = showLineNumbers ? `<span class="line-number">${lineObj.lineNum}</span>` : '';
          rightHTML += `<div class="diff-line added">${lineNum}<span class="line-content">${this.escapeHtml(lineObj.line)}</span></div>`;
        });
        // Add placeholder on left
        leftHTML += `<div class="diff-line diff-placeholder"></div>`.repeat(entry.lines.length);
      } else if (entry.type === 'modified') {
        // Modified lines - show word-level diff
        const leftContent = this.renderWordDiff(entry.wordDiff, 'removed');
        const rightContent = this.renderWordDiff(entry.wordDiff, 'added');

        const leftLineNum = showLineNumbers ? `<span class="line-number">${entry.leftLineNum}</span>` : '';
        const rightLineNum = showLineNumbers ? `<span class="line-number">${entry.rightLineNum}</span>` : '';

        leftHTML += `<div class="diff-line modified">${leftLineNum}<span class="line-content">${leftContent}</span></div>`;
        rightHTML += `<div class="diff-line modified">${rightLineNum}<span class="line-content">${rightContent}</span></div>`;
      }
    });

    this.diffOutput.innerHTML = `
      <div class="diff-split">
        <div class="diff-pane">${leftHTML || '<div class="diff-line"><span class="line-content">(empty)</span></div>'}</div>
        <div class="diff-pane">${rightHTML || '<div class="diff-line"><span class="line-content">(empty)</span></div>'}</div>
      </div>
    `;
  }

  renderUnifiedDiffWordLevel(diff, showLineNumbers, originalLeft, originalRight) {
    let html = '';

    diff.forEach(entry => {
      if (entry.type === 'equal') {
        const lineNum = showLineNumbers ? `<span class="line-number">${entry.leftLineNum}</span>` : '';
        const content = this.escapeHtml(entry.leftLine);
        html += `<div class="diff-line">${lineNum}<span class="line-content">${content}</span></div>`;
      } else if (entry.type === 'removed') {
        entry.lines.forEach(lineObj => {
          const lineNum = showLineNumbers ? `<span class="line-number">${lineObj.lineNum}</span>` : '';
          html += `<div class="diff-line removed">${lineNum}<span class="line-content">- ${this.escapeHtml(lineObj.line)}</span></div>`;
        });
      } else if (entry.type === 'added') {
        entry.lines.forEach(lineObj => {
          const lineNum = showLineNumbers ? `<span class="line-number">${lineObj.lineNum}</span>` : '';
          html += `<div class="diff-line added">${lineNum}<span class="line-content">+ ${this.escapeHtml(lineObj.line)}</span></div>`;
        });
      } else if (entry.type === 'modified') {
        const leftLineNum = showLineNumbers ? `<span class="line-number">${entry.leftLineNum}</span>` : '';
        const rightLineNum = showLineNumbers ? `<span class="line-number">${entry.rightLineNum}</span>` : '';

        const leftContent = this.renderWordDiff(entry.wordDiff, 'removed');
        const rightContent = this.renderWordDiff(entry.wordDiff, 'added');

        html += `<div class="diff-line removed">${leftLineNum}<span class="line-content">- ${leftContent}</span></div>`;
        html += `<div class="diff-line added">${rightLineNum}<span class="line-content">+ ${rightContent}</span></div>`;
      }
    });

    this.diffOutput.innerHTML = html || '<div class="diff-line"><span class="line-content">(empty)</span></div>';
  }

  renderWordDiff(wordDiff, changeType) {
    // Render word-level diff with inline highlighting
    return wordDiff.map(part => {
      const escaped = this.escapeHtml(part.value);

      if (part.type === 'equal') {
        // No change
        return escaped;
      } else if (part.type === 'removed' && changeType === 'removed') {
        // Show removed words with strong highlight
        return `<mark class="diff-word-removed">${escaped}</mark>`;
      } else if (part.type === 'added' && changeType === 'added') {
        // Show added words with strong highlight
        return `<mark class="diff-word-added">${escaped}</mark>`;
      } else {
        // Don't show opposite changes
        return '';
      }
    }).join('');
  }

  updateDiffStats(diff) {
    let added = 0;
    let removed = 0;
    let modified = 0;
    let unchanged = 0;

    diff.forEach(entry => {
      if (entry.type === 'equal') {
        unchanged++;
      } else if (entry.type === 'removed') {
        removed += entry.lines.length;
      } else if (entry.type === 'added') {
        added += entry.lines.length;
      } else if (entry.type === 'modified') {
        modified++;
        // Count word-level changes
        if (entry.wordDiff) {
          entry.wordDiff.forEach(part => {
            if (part.type === 'added') added += 0.5;
            else if (part.type === 'removed') removed += 0.5;
          });
        }
      }
    });

    // Calculate character-based similarity using Levenshtein distance
    const similarity = this.calculateSimilarity(this.leftText, this.rightText);

    this.stats.added.textContent = Math.round(added);
    this.stats.removed.textContent = Math.round(removed);
    this.stats.modified.textContent = modified;
    this.stats.similarity.textContent = similarity;
  }

  resetStats() {
    this.stats.added.textContent = '0';
    this.stats.removed.textContent = '0';
    this.stats.modified.textContent = '0';
    this.stats.similarity.textContent = '100';
  }

  // ============================================
  // Analytics
  // ============================================
  updateAnalytics() {
    this.updateTextStats('left', this.leftText);
    this.updateTextStats('right', this.rightText);
    this.updateComparisonMetrics();
    this.updateCharDistribution();
  }

  updateTextStats(side, text) {
    const chars = text.length;
    const charsNoSpace = text.replace(/\s/g, '').length;
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const lines = text.split('\n').length;
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
    const readTime = Math.ceil(words / 200); // 200 words per minute

    document.getElementById(`${side}Chars`).textContent = chars;
    document.getElementById(`${side}CharsNoSpace`).textContent = charsNoSpace;
    document.getElementById(`${side}Words`).textContent = words;
    document.getElementById(`${side}Lines`).textContent = lines;
    document.getElementById(`${side}Paragraphs`).textContent = paragraphs;
    document.getElementById(`${side}ReadTime`).textContent = readTime;
  }

  updateComparisonMetrics() {
    const leftLines = this.leftText.split('\n').length;
    const rightLines = this.rightText.split('\n').length;
    const leftWords = this.leftText.trim().split(/\s+/).filter(w => w.length > 0).length;
    const rightWords = this.rightText.trim().split(/\s+/).filter(w => w.length > 0).length;

    // Calculate similarity
    const similarity = this.calculateSimilarity(this.leftText, this.rightText);
    document.getElementById('similarityBar').style.width = `${similarity}%`;
    document.getElementById('similarityPercent').textContent = `${similarity}%`;

    // Calculate lines changed
    const totalLines = Math.max(leftLines, rightLines);
    const linesChanged = totalLines > 0 ? Math.round((Math.abs(leftLines - rightLines) / totalLines) * 100) : 0;
    document.getElementById('changedBar').style.width = `${linesChanged}%`;
    document.getElementById('changedPercent').textContent = `${linesChanged}%`;

    // Calculate words changed
    const totalWords = Math.max(leftWords, rightWords);
    const wordsChanged = totalWords > 0 ? Math.round((Math.abs(leftWords - rightWords) / totalWords) * 100) : 0;
    document.getElementById('wordsChangedBar').style.width = `${wordsChanged}%`;
    document.getElementById('wordsChangedPercent').textContent = `${wordsChanged}%`;
  }

  calculateSimilarity(str1, str2) {
    if (!str1 && !str2) return 100;
    if (!str1 || !str2) return 0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 100;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return Math.round(((longer.length - editDistance) / longer.length) * 100);
  }

  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  updateCharDistribution() {
    const combined = (this.leftText + this.rightText).toLowerCase();
    const charCount = {};

    for (const char of combined) {
      if (/[a-z]/.test(char)) {
        charCount[char] = (charCount[char] || 0) + 1;
      }
    }

    const sortedChars = Object.entries(charCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    const html = sortedChars.map(([char, count]) => `
      <div class="char-item">
        <div class="char-letter">${char}</div>
        <div class="char-count">${count}</div>
      </div>
    `).join('');

    document.getElementById('charDistribution').innerHTML = html || '<p style="color: var(--text-muted);">No character data available</p>';
  }

  // ============================================
  // History Management
  // ============================================
  saveComparison() {
    const name = prompt('Enter a name for this comparison:', `Comparison ${this.history.length + 1}`);
    if (!name) return;

    const comparison = {
      id: Date.now(),
      name,
      timestamp: new Date().toISOString(),
      leftText: this.leftText,
      rightText: this.rightText,
      stats: {
        added: this.stats.added.textContent,
        removed: this.stats.removed.textContent,
        similarity: this.stats.similarity.textContent
      }
    };

    this.history.unshift(comparison);

    // Limit history based on settings
    const limit = parseInt(document.getElementById('settingHistoryLimit')?.value || 25);
    if (this.history.length > limit) {
      this.history = this.history.slice(0, limit);
    }

    this.saveHistory();
    this.renderHistory();
    this.showToast('Comparison saved successfully');
  }

  loadComparison(id) {
    const comparison = this.history.find(c => c.id === id);
    if (!comparison) return;

    this.leftEditor.value = comparison.leftText;
    this.rightEditor.value = comparison.rightText;
    this.handleTextChange('left');
    this.handleTextChange('right');
    this.switchView('diff');
    this.showToast(`Loaded: ${comparison.name}`);
  }

  deleteComparison(id) {
    if (!confirm('Are you sure you want to delete this comparison?')) return;

    this.history = this.history.filter(c => c.id !== id);
    this.saveHistory();
    this.renderHistory();
    this.showToast('Comparison deleted');
  }

  renderHistory() {
    const historyList = document.getElementById('historyList');

    if (this.history.length === 0) {
      historyList.innerHTML = `
        <div class="empty-state">
          <i data-lucide="inbox"></i>
          <p>No saved comparisons yet</p>
          <small>Save a comparison to see it here</small>
        </div>
      `;
      this.initLucideIcons();
      return;
    }

    const html = this.history.map(item => `
      <div class="history-item">
        <div class="history-icon">
          <i data-lucide="file-diff"></i>
        </div>
        <div class="history-info">
          <div class="history-title">${this.escapeHtml(item.name)}</div>
          <div class="history-meta">
            <span><i data-lucide="clock" style="width:14px;height:14px;vertical-align:-2px"></i> ${this.formatDate(item.timestamp)}</span>
            <span><i data-lucide="plus-circle" style="width:14px;height:14px;vertical-align:-2px"></i> ${item.stats.added} added</span>
            <span><i data-lucide="minus-circle" style="width:14px;height:14px;vertical-align:-2px"></i> ${item.stats.removed} removed</span>
            <span><i data-lucide="percent" style="width:14px;height:14px;vertical-align:-2px"></i> ${item.stats.similarity}% similar</span>
          </div>
        </div>
        <div class="history-actions">
          <button class="btn btn-sm" onclick="diffChecker.loadComparison(${item.id})">
            <i data-lucide="eye"></i>
            <span>Load</span>
          </button>
          <button class="btn btn-sm btn-danger" onclick="diffChecker.deleteComparison(${item.id})">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `).join('');

    historyList.innerHTML = html;
    this.initLucideIcons();
  }

  clearHistory() {
    if (!confirm('Are you sure you want to clear all history? This cannot be undone.')) return;

    this.history = [];
    this.saveHistory();
    this.renderHistory();
    this.showToast('History cleared');
  }

  loadHistory() {
    try {
      const saved = localStorage.getItem('diffchecker_history');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error('Failed to load history:', e);
      return [];
    }
  }

  saveHistory() {
    try {
      localStorage.setItem('diffchecker_history', JSON.stringify(this.history));
    } catch (e) {
      console.error('Failed to save history:', e);
      this.showToast('Failed to save history', 'error');
    }
  }

  // ============================================
  // Settings Management
  // ============================================
  loadSettings() {
    try {
      const saved = localStorage.getItem('diffchecker_settings');
      return saved ? JSON.parse(saved) : {
        theme: 'auto',
        fontSize: 14,
        ignoreWhitespace: false,
        ignoreCase: false,
        lineNumbers: true,
        autoSave: false,
        historyLimit: 25
      };
    } catch (e) {
      console.error('Failed to load settings:', e);
      return {};
    }
  }

  saveSettings() {
    const settings = {
      theme: document.getElementById('settingTheme').value,
      fontSize: document.getElementById('settingFontSize').value,
      ignoreWhitespace: document.getElementById('settingIgnoreWhitespace').checked,
      ignoreCase: document.getElementById('settingIgnoreCase').checked,
      lineNumbers: document.getElementById('settingLineNumbers').checked,
      autoSave: document.getElementById('settingAutoSave').checked,
      historyLimit: document.getElementById('settingHistoryLimit').value
    };

    try {
      localStorage.setItem('diffchecker_settings', JSON.stringify(settings));
      this.settings = settings;
      this.applySettings();
      this.showToast('Settings saved');
    } catch (e) {
      console.error('Failed to save settings:', e);
      this.showToast('Failed to save settings', 'error');
    }
  }

  applySettings() {
    // Apply theme
    const theme = this.settings.theme || 'auto';
    if (theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }

    // Set theme toggle icon
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const themeIcon = document.querySelector('#themeToggle i');
    if (themeIcon) {
      themeIcon.setAttribute('data-lucide', currentTheme === 'light' ? 'sun' : 'moon');
      this.initLucideIcons();
    }

    // Apply font size
    const fontSize = this.settings.fontSize || 14;
    document.querySelectorAll('.editor').forEach(editor => {
      editor.style.fontSize = `${fontSize}px`;
    });

    // Apply settings to UI
    if (document.getElementById('settingTheme')) {
      document.getElementById('settingTheme').value = this.settings.theme || 'auto';
      document.getElementById('settingFontSize').value = this.settings.fontSize || 14;
      document.getElementById('settingIgnoreWhitespace').checked = this.settings.ignoreWhitespace || false;
      document.getElementById('settingIgnoreCase').checked = this.settings.ignoreCase || false;
      document.getElementById('settingLineNumbers').checked = this.settings.lineNumbers !== false;
      document.getElementById('settingAutoSave').checked = this.settings.autoSave || false;
      document.getElementById('settingHistoryLimit').value = this.settings.historyLimit || 25;
    }

    // Apply default options
    if (document.getElementById('ignoreWhitespace')) {
      document.getElementById('ignoreWhitespace').checked = this.settings.ignoreWhitespace || false;
      document.getElementById('ignoreCase').checked = this.settings.ignoreCase || false;
      document.getElementById('showLineNumbers').checked = this.settings.lineNumbers !== false;
    }
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const newTheme = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);

    const themeIcon = document.querySelector('#themeToggle i');
    if (themeIcon) {
      themeIcon.setAttribute('data-lucide', newTheme === 'light' ? 'sun' : 'moon');
      this.initLucideIcons();
    }

    // Save to settings
    if (document.getElementById('settingTheme')) {
      document.getElementById('settingTheme').value = newTheme;
      this.saveSettings();
    }
  }

  changeTheme(theme) {
    this.applySettings();
  }

  changeFontSize(size) {
    document.querySelectorAll('.editor').forEach(editor => {
      editor.style.fontSize = `${size}px`;
    });
  }

  updateStorageInfo() {
    try {
      const historySize = new Blob([localStorage.getItem('diffchecker_history') || '']).size;
      const settingsSize = new Blob([localStorage.getItem('diffchecker_settings') || '']).size;
      const totalSize = historySize + settingsSize;
      const sizeKB = (totalSize / 1024).toFixed(2);
      document.getElementById('storageUsed').textContent = `${sizeKB} KB`;
    } catch (e) {
      document.getElementById('storageUsed').textContent = 'Unknown';
    }
  }

  clearStorage() {
    if (!confirm('Are you sure you want to clear all data including history and settings? This cannot be undone.')) return;

    localStorage.removeItem('diffchecker_history');
    localStorage.removeItem('diffchecker_settings');
    this.history = [];
    this.settings = this.loadSettings();
    this.renderHistory();
    this.applySettings();
    this.updateStorageInfo();
    this.showToast('All data cleared');
  }

  // ============================================
  // Actions
  // ============================================
  copyDiff() {
    const text = this.diffOutput.innerText;
    navigator.clipboard.writeText(text).then(() => {
      this.showToast('Diff copied to clipboard');
    }).catch(() => {
      this.showToast('Failed to copy diff', 'error');
    });
  }

  exportDiff() {
    const content = this.diffOutput.innerHTML;
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Diff Export</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #0d1117; color: #e6edf3; }
    .diff-line { padding: 2px 8px; white-space: pre-wrap; }
    .diff-line.added { background: #2ea04326; color: #3fb950; }
    .diff-line.removed { background: #f8514926; color: #f85149; }
    .line-number { color: #6e7681; padding-right: 16px; }
  </style>
</head>
<body>
  ${content}
</body>
</html>
    `;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diff-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);

    this.showToast('Diff exported successfully');
  }

  clearAll() {
    if (!confirm('Are you sure you want to clear all text?')) return;

    this.leftEditor.value = '';
    this.rightEditor.value = '';
    this.leftText = '';
    this.rightText = '';
    this.computeDiff();
    this.updateAnalytics();
    this.showToast('All text cleared');
  }

  // ============================================
  // Utilities
  // ============================================
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatDate(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  }

  showToast(message, type = 'success') {
    this.toastMessage.textContent = message;
    this.toast.classList.add('show');

    setTimeout(() => {
      this.toast.classList.remove('show');
    }, 3000);
  }

  // ============================================
  // Format Document
  // ============================================
  openFormatModal(side) {
    this.currentFormatSide = side;
    this.formatModal.classList.add('show');
    this.initLucideIcons();
  }

  closeFormatModal() {
    this.formatModal.classList.remove('show');
    this.currentFormatSide = null;
  }

  formatDocument(format) {
    if (!this.currentFormatSide) return;

    const editor = this.currentFormatSide === 'left' ? this.leftEditor : this.rightEditor;
    const text = editor.value;

    if (!text.trim()) {
      this.showToast('No text to format', 'error');
      this.closeFormatModal();
      return;
    }

    try {
      let formatted;

      switch (format) {
        case 'json':
          formatted = this.formatJSON(text);
          break;
        case 'xml':
        case 'html':
          formatted = this.formatXML(text);
          break;
        case 'css':
          formatted = this.formatCSS(text);
          break;
        case 'javascript':
          formatted = this.formatJavaScript(text);
          break;
        case 'python':
          formatted = this.formatPython(text);
          break;
        case 'sql':
          formatted = this.formatSQL(text);
          break;
        case 'markdown':
          formatted = this.formatMarkdown(text);
          break;
        default:
          formatted = text;
      }

      editor.value = formatted;
      this.handleTextChange(this.currentFormatSide);
      this.closeFormatModal();
      this.showToast(`Formatted as ${format.toUpperCase()}`);
    } catch (error) {
      this.showToast(`Failed to format: ${error.message}`, 'error');
      this.closeFormatModal();
    }
  }

  formatJSON(text) {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  }

  formatXML(text) {
    // Simple XML/HTML formatter
    let formatted = '';
    let indent = 0;
    const tab = '  ';

    text.split(/>\s*</).forEach((node) => {
      if (node.match(/^\/\w/)) indent--; // Closing tag
      formatted += tab.repeat(indent) + '<' + node + '>\n';
      if (node.match(/^<?\w[^>]*[^\/]$/) && !node.startsWith('?')) indent++; // Opening tag
    });

    return formatted.substring(1, formatted.length - 2);
  }

  formatCSS(text) {
    // Simple CSS formatter
    let formatted = text
      .replace(/\s*{\s*/g, ' {\n  ')
      .replace(/;\s*/g, ';\n  ')
      .replace(/\s*}\s*/g, '\n}\n\n')
      .replace(/,\s*/g, ',\n')
      .trim();

    return formatted;
  }

  formatJavaScript(text) {
    // Basic JavaScript formatter
    let formatted = text
      .replace(/{\s*/g, ' {\n  ')
      .replace(/}\s*/g, '\n}\n')
      .replace(/;\s*/g, ';\n')
      .trim();

    // Fix indentation
    let indent = 0;
    const lines = formatted.split('\n');
    formatted = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.endsWith('}')) indent = Math.max(0, indent - 1);
      const indented = '  '.repeat(indent) + trimmed;
      if (trimmed.endsWith('{')) indent++;
      return indented;
    }).join('\n');

    return formatted;
  }

  formatPython(text) {
    // Basic Python formatter
    let formatted = text
      .replace(/;\s*/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();

    // Fix indentation for blocks
    let indent = 0;
    const lines = formatted.split('\n');
    formatted = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.match(/^(elif|else|except|finally):/)) {
        indent = Math.max(0, indent - 1);
      }
      const indented = '    '.repeat(indent) + trimmed;
      if (trimmed.endsWith(':')) indent++;
      if (trimmed.match(/^(return|break|continue|pass)/) && indent > 0) {
        // Don't change indent
      }
      return indented;
    }).join('\n');

    return formatted;
  }

  formatSQL(text) {
    // Basic SQL formatter
    const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN',
                      'ON', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'INSERT INTO',
                      'VALUES', 'UPDATE', 'SET', 'DELETE FROM'];

    let formatted = text.toUpperCase();

    keywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      formatted = formatted.replace(regex, `\n${keyword}`);
    });

    formatted = formatted
      .replace(/,/g, ',\n  ')
      .replace(/\(/g, '(\n  ')
      .replace(/\)/g, '\n)')
      .trim();

    return formatted;
  }

  formatMarkdown(text) {
    // Basic Markdown formatter
    let formatted = text
      .replace(/^(#{1,6})\s*/gm, '$1 ')
      .replace(/\*\*([^*]+)\*\*/g, '**$1**')
      .replace(/\*([^*]+)\*/g, '*$1*')
      .replace(/`([^`]+)`/g, '`$1`')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return formatted;
  }
}

// ============================================
// Initialize Application
// ============================================
let diffChecker;

document.addEventListener('DOMContentLoaded', () => {
  diffChecker = new DiffChecker();
});
