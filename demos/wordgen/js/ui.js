/**
 * ui.js
 * UI components and interactions for WordGen
 */

import { getTheme, saveTheme } from './storage.js';

/**
 * Toast notification system
 */
export class ToastManager {
  constructor() {
    this.container = document.getElementById('toastContainer');
  }

  show(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const iconMap = {
      success: 'check-circle',
      error: 'alert-circle',
      warning: 'alert-triangle',
      info: 'info'
    };

    toast.innerHTML = `
      <i data-lucide="${iconMap[type]}"></i>
      <div class="toast-message">${message}</div>
    `;

    this.container.appendChild(toast);

    // Initialize Lucide icons
    if (window.lucide) {
      window.lucide.createIcons();
    }

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }

    return toast;
  }

  success(message, duration) {
    return this.show(message, 'success', duration);
  }

  error(message, duration) {
    return this.show(message, 'error', duration);
  }

  warning(message, duration) {
    return this.show(message, 'warning', duration);
  }

  info(message, duration) {
    return this.show(message, 'info', duration);
  }

  clear() {
    this.container.innerHTML = '';
  }
}

/**
 * Modal manager
 */
export class Modal {
  constructor(modalId) {
    this.modal = document.getElementById(modalId);
    this.overlay = this.modal.querySelector('.modal-overlay');
    this.closeBtn = this.modal.querySelector('.modal-close');

    // Event listeners
    this.closeBtn.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', () => this.close());

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });
  }

  open() {
    this.modal.classList.add('active');
    this.modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.modal.classList.remove('active');
    this.modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  isOpen() {
    return this.modal.classList.contains('active');
  }
}

/**
 * Editor manager
 */
export class EditorManager {
  constructor(editorId, onSelectionChange) {
    this.editor = document.getElementById(editorId);
    this.onSelectionChange = onSelectionChange;
    this.history = [];
    this.historyIndex = -1;

    // Event listeners
    this.editor.addEventListener('input', () => this.handleInput());
    this.editor.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
    this.editor.addEventListener('mouseup', () => this.handleMouseUp());
    this.editor.addEventListener('keydown', (e) => this.handleKeydown(e));
  }

  handleInput() {
    this.updateStats();
    this.saveToHistory();
  }

  handleDoubleClick(e) {
    const selection = window.getSelection();
    const word = selection.toString().trim();

    if (word && word.length > 0) {
      const range = selection.getRangeAt(0);
      const start = this.getAbsoluteOffset(range.startContainer, range.startOffset);
      const end = this.getAbsoluteOffset(range.endContainer, range.endOffset);

      if (this.onSelectionChange) {
        this.onSelectionChange(word, start, end);
      }
    }
  }

  handleMouseUp() {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (text && text.length > 0 && !text.includes(' ')) {
      // Single word selected
      const range = selection.getRangeAt(0);
      const start = this.getAbsoluteOffset(range.startContainer, range.startOffset);
      const end = this.getAbsoluteOffset(range.endContainer, range.endOffset);

      if (this.onSelectionChange) {
        this.onSelectionChange(text, start, end);
      }
    }
  }

  handleKeydown(e) {
    // Ctrl+Z for undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    }

    // Ctrl+Shift+Z or Ctrl+Y for redo
    if (((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) ||
        ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
      e.preventDefault();
      this.redo();
    }
  }

  getAbsoluteOffset(node, offset) {
    let absoluteOffset = offset;
    let currentNode = node;

    // Walk up to the editor
    while (currentNode && currentNode !== this.editor) {
      if (currentNode.previousSibling) {
        currentNode = currentNode.previousSibling;
        absoluteOffset += currentNode.textContent.length;
      } else {
        currentNode = currentNode.parentNode;
      }
    }

    return absoluteOffset;
  }

  getText() {
    return this.editor.textContent || '';
  }

  setText(text) {
    this.editor.textContent = text;
    this.updateStats();
    this.saveToHistory();
  }

  replaceText(start, end, replacement) {
    const text = this.getText();
    const newText = text.slice(0, start) + replacement + text.slice(end);
    this.setText(newText);

    // Re-select the replaced word
    this.selectRange(start, start + replacement.length);
  }

  selectRange(start, end) {
    const range = document.createRange();
    const selection = window.getSelection();

    // Find the text node and offset
    let currentOffset = 0;
    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;

    const walker = document.createTreeWalker(
      this.editor,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while ((node = walker.nextNode())) {
      const length = node.textContent.length;

      if (!startNode && currentOffset + length >= start) {
        startNode = node;
        startOffset = start - currentOffset;
      }

      if (!endNode && currentOffset + length >= end) {
        endNode = node;
        endOffset = end - currentOffset;
        break;
      }

      currentOffset += length;
    }

    if (startNode && endNode) {
      try {
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch (error) {
        console.error('Error selecting range:', error);
      }
    }
  }

  updateStats() {
    const text = this.getText();
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    const chars = text.length;

    document.getElementById('wordCount').textContent = `${words.length} ${words.length === 1 ? 'word' : 'words'}`;
    document.getElementById('charCount').textContent = `${chars} ${chars === 1 ? 'character' : 'characters'}`;
  }

  saveToHistory() {
    const text = this.getText();

    // Don't save if identical to current history state
    if (this.history[this.historyIndex] === text) {
      return;
    }

    // Remove any future history if we're not at the end
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    this.history.push(text);
    this.historyIndex++;

    // Limit history size
    if (this.history.length > 50) {
      this.history.shift();
      this.historyIndex--;
    }
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.editor.textContent = this.history[this.historyIndex];
      this.updateStats();
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.editor.textContent = this.history[this.historyIndex];
      this.updateStats();
    }
  }

  clear() {
    this.setText('');
  }

  focus() {
    this.editor.focus();
  }
}

/**
 * Suggestions panel manager
 */
export class SuggestionsPanel {
  constructor() {
    this.emptyState = document.getElementById('emptyState');
    this.loadingState = document.getElementById('loadingState');
    this.content = document.getElementById('suggestionsContent');

    this.targetWord = document.getElementById('targetWord');
    this.targetPos = document.getElementById('targetPos');
    this.targetContext = document.getElementById('targetContext');

    this.tabs = document.querySelectorAll('.tab');
    this.tabPanels = document.querySelectorAll('.tab-panel');

    this.synonymsList = document.getElementById('synonymsList');
    this.rephraseList = document.getElementById('rephraseList');
    this.moreList = document.getElementById('moreList');

    this.selectedIndex = -1;
    this.currentCandidates = [];

    // Setup tabs
    this.tabs.forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    // Setup keyboard navigation
    document.addEventListener('keydown', (e) => this.handleKeydown(e));
  }

  showEmpty() {
    this.emptyState.classList.remove('hidden');
    this.loadingState.classList.add('hidden');
    this.content.classList.add('hidden');
  }

  showLoading() {
    this.emptyState.classList.add('hidden');
    this.loadingState.classList.remove('hidden');
    this.content.classList.add('hidden');
  }

  showContent() {
    this.emptyState.classList.add('hidden');
    this.loadingState.classList.add('hidden');
    this.content.classList.remove('hidden');
  }

  setTargetInfo(word, pos, context) {
    this.targetWord.textContent = word;
    this.targetPos.textContent = pos.toUpperCase();
    this.targetContext.textContent = `"${context}"`;
  }

  switchTab(tabName) {
    // Update tab buttons
    this.tabs.forEach(tab => {
      if (tab.dataset.tab === tabName) {
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
      } else {
        tab.classList.remove('active');
        tab.setAttribute('aria-selected', 'false');
      }
    });

    // Update tab panels
    this.tabPanels.forEach(panel => {
      if (panel.id === `${tabName}Panel`) {
        panel.classList.add('active');
        panel.classList.remove('hidden');
      } else {
        panel.classList.remove('active');
        panel.classList.add('hidden');
      }
    });

    this.selectedIndex = -1;
  }

  renderSynonyms(candidates, onApply) {
    this.currentCandidates = candidates;
    this.synonymsList.innerHTML = '';

    if (candidates.length === 0) {
      this.synonymsList.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">No synonyms found. Try configuring an LLM provider in Settings.</p>';
      document.getElementById('synonymsCount').textContent = '0';
      return;
    }

    // Show top 5 in synonyms tab
    const topCandidates = candidates.slice(0, 5);
    document.getElementById('synonymsCount').textContent = topCandidates.length.toString();

    topCandidates.forEach((candidate, index) => {
      const card = this.createSuggestionCard(candidate, index, onApply);
      this.synonymsList.appendChild(card);
    });

    // Initialize icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  renderMore(candidates, onApply) {
    this.moreList.innerHTML = '';
    document.getElementById('moreCount').textContent = candidates.length.toString();

    if (candidates.length === 0) {
      this.moreList.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">No additional suggestions.</p>';
      return;
    }

    candidates.forEach((candidate, index) => {
      const card = this.createSuggestionCard(candidate, index, onApply);
      this.moreList.appendChild(card);
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  createSuggestionCard(candidate, index, onApply) {
    const card = document.createElement('div');
    card.className = 'suggestion-card';
    card.dataset.index = index;

    const registerClass = `label-${candidate.register || 'neutral'}`;
    const commonnessClass = `label-${candidate.commonness || 'common'}`;

    const scorePercent = candidate.scores
      ? Math.round(candidate.scores.total * 100)
      : 0;

    card.innerHTML = `
      <div class="suggestion-header">
        <div class="suggestion-word">${candidate.word}</div>
        <div class="suggestion-labels">
          <span class="label ${registerClass}">${candidate.register || 'neutral'}</span>
          <span class="label ${commonnessClass}">${candidate.commonness || 'common'}</span>
        </div>
      </div>
      <div class="suggestion-note">${candidate.note || ''}</div>
      <div class="suggestion-footer">
        <div class="suggestion-score">
          ${scorePercent > 0 ? `Match: ${scorePercent}%` : ''}
        </div>
        <button class="apply-btn">Apply</button>
      </div>
    `;

    // Apply button handler
    const applyBtn = card.querySelector('.apply-btn');
    applyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onApply) {
        onApply(candidate);
      }
    });

    // Card click handler (also applies)
    card.addEventListener('click', () => {
      if (onApply) {
        onApply(candidate);
      }
    });

    // Hover effect for selection
    card.addEventListener('mouseenter', () => {
      this.selectCard(index);
    });

    return card;
  }

  selectCard(index) {
    // Remove previous selection
    document.querySelectorAll('.suggestion-card.selected').forEach(card => {
      card.classList.remove('selected');
    });

    // Add selection to new card
    const cards = document.querySelectorAll('.suggestion-card');
    if (cards[index]) {
      cards[index].classList.add('selected');
      cards[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      this.selectedIndex = index;
    }
  }

  handleKeydown(e) {
    if (this.content.classList.contains('hidden')) return;

    const cards = document.querySelectorAll('.tab-panel.active .suggestion-card');
    if (cards.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, cards.length - 1);
      this.selectCard(this.selectedIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.selectCard(this.selectedIndex);
    } else if (e.key === 'Enter' && this.selectedIndex >= 0) {
      e.preventDefault();
      cards[this.selectedIndex].click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.showEmpty();
    }
  }
}

/**
 * Theme manager
 */
export class ThemeManager {
  constructor(toggleButtonId) {
    this.toggleBtn = document.getElementById(toggleButtonId);
    this.currentTheme = getTheme();

    // Apply initial theme
    this.applyTheme(this.currentTheme);

    // Setup toggle
    this.toggleBtn.addEventListener('click', () => this.toggle());
  }

  applyTheme(theme) {
    const root = document.documentElement;
    const icon = this.toggleBtn.querySelector('i');

    // Clear both possible states first
    root.classList.remove('light');

    if (theme === 'light') {
      root.classList.add('light');
      icon.setAttribute('data-lucide', 'sun');
    } else {
      // Dark mode - no class needed, it's the default
      icon.setAttribute('data-lucide', 'moon');
    }

    // Update internal state
    this.currentTheme = theme;

    // Reinitialize icons
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  toggle() {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    saveTheme(newTheme); // Save first
    this.applyTheme(newTheme); // Then apply
  }

  getTheme() {
    return this.currentTheme;
  }
}

/**
 * Initialize Lucide icons
 */
export function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}
