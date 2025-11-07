/**
 * content.js
 * Content script that runs on all web pages
 * Handles double-click detection and synonym widget display
 * Note: nlp.js is loaded before this script via manifest.json
 */

// State management
let widget = null;
let currentWord = null;
let currentElement = null;
let isEnabled = true;

// Initialize on page load
(async function init() {
  // Check if extension is enabled for this site
  const hostname = window.location.hostname;
  const response = await chrome.runtime.sendMessage({
    action: 'checkEnabled',
    hostname
  });

  isEnabled = response.enabled;

  if (!isEnabled) {
    console.log('WordGen disabled for', hostname);
    return;
  }

  // Listen for double-clicks on the page
  document.addEventListener('dblclick', handleDoubleClick);

  // Dismiss widget on scroll or outside click
  document.addEventListener('scroll', handleScroll, true);
  document.addEventListener('click', handleOutsideClick);

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener(handleMessage);

  console.log('WordGen extension initialized');
})();

/**
 * Handle double-click events
 */
async function handleDoubleClick(event) {
  if (!isEnabled) return;

  // Don't interfere with input fields, textareas, or contenteditable
  const target = event.target;
  if (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable) {
    return handleEditableDoubleClick(event);
  }

  // Get selected text or word at cursor
  const selection = window.getSelection();
  let word = selection.toString().trim();

  if (!word) {
    // Try to get word at click position
    const range = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (range) {
      const textNode = range.startContainer;
      if (textNode.nodeType === Node.TEXT_NODE) {
        const text = textNode.textContent;
        const offset = range.startOffset;
        const wordInfo = getWordAtPosition(text, offset);

        if (wordInfo) {
          word = wordInfo.word;
          // Create a range for the word
          const wordRange = document.createRange();
          wordRange.setStart(textNode, wordInfo.start);
          wordRange.setEnd(textNode, wordInfo.end);
          selection.removeAllRanges();
          selection.addRange(wordRange);
        }
      }
    }
  }

  if (!word || word.length < 2) return;

  // Get surrounding context
  const context = getContext(event.target, 300);

  // Store current selection info
  currentWord = {
    text: word,
    element: target,
    x: event.clientX,
    y: event.clientY,
    context
  };

  // Show loading widget
  showWidget(event.clientX, event.clientY, 'Loading...');

  // Request synonyms from background script
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getSynonyms',
      word: word,
      context: context
    });

    if (response.success && response.synonyms.length > 0) {
      showWidget(event.clientX, event.clientY, response.synonyms, response.wordInfo);
    } else {
      showWidget(event.clientX, event.clientY, 'No synonyms found');
    }
  } catch (error) {
    console.error('Error getting synonyms:', error);
    showWidget(event.clientX, event.clientY, 'Error loading synonyms');
  }
}

/**
 * Handle double-clicks in editable fields
 */
async function handleEditableDoubleClick(event) {
  const target = event.target;
  const selection = window.getSelection();
  const word = selection.toString().trim();

  if (!word || word.length < 2) return;

  // Store element reference for replacement
  currentElement = target;

  // Get context
  const context = target.value || target.textContent || '';

  currentWord = {
    text: word,
    element: target,
    x: event.clientX,
    y: event.clientY,
    context,
    editable: true
  };

  // Show loading
  showWidget(event.clientX, event.clientY, 'Loading...');

  // Request synonyms
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getSynonyms',
      word: word,
      context: context
    });

    if (response.success && response.synonyms.length > 0) {
      showWidget(event.clientX, event.clientY, response.synonyms, response.wordInfo);
    } else {
      showWidget(event.clientX, event.clientY, 'No synonyms found');
    }
  } catch (error) {
    console.error('Error getting synonyms:', error);
    showWidget(event.clientX, event.clientY, 'Error loading synonyms');
  }
}

/**
 * Get surrounding context text
 */
function getContext(element, maxChars = 300) {
  let context = '';

  // Try to get paragraph or container text
  let container = element;
  while (container && container !== document.body) {
    if (container.tagName === 'P' ||
        container.tagName === 'DIV' ||
        container.tagName === 'ARTICLE' ||
        container.tagName === 'SECTION') {
      context = container.textContent || '';
      break;
    }
    container = container.parentElement;
  }

  if (!context) {
    context = element.textContent || '';
  }

  // Limit context length
  if (context.length > maxChars) {
    context = context.substring(0, maxChars);
  }

  return context;
}

/**
 * Show synonym widget at position
 */
function showWidget(x, y, content, wordInfo = null) {
  // Remove existing widget
  if (widget) {
    widget.remove();
  }

  // Create widget element
  widget = document.createElement('div');
  widget.id = 'wordgen-widget';
  widget.className = 'wordgen-widget';

  // Handle loading state
  if (typeof content === 'string') {
    widget.innerHTML = `<div class="wordgen-message">${content}</div>`;
  } else if (Array.isArray(content)) {
    // Render synonym list
    widget.innerHTML = renderSynonyms(content, wordInfo);
  }

  // Position widget near cursor
  document.body.appendChild(widget);

  // Calculate position (avoid going off-screen)
  const rect = widget.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = x + 10;
  let top = y + 10;

  // Adjust if off-screen
  if (left + rect.width > viewportWidth) {
    left = x - rect.width - 10;
  }
  if (top + rect.height > viewportHeight) {
    top = y - rect.height - 10;
  }

  // Ensure minimum position
  left = Math.max(10, left);
  top = Math.max(10, top);

  widget.style.left = left + 'px';
  widget.style.top = top + 'px';

  // Add click handlers for synonyms
  if (Array.isArray(content)) {
    widget.querySelectorAll('.wordgen-synonym').forEach((item, index) => {
      item.addEventListener('click', () => handleSynonymClick(content[index]));
    });
  }
}

/**
 * Render synonym list HTML
 */
function renderSynonyms(synonyms, wordInfo) {
  const header = wordInfo ?
    `<div class="wordgen-header">
      <strong>${wordInfo.word}</strong>
      <span class="wordgen-pos">${wordInfo.pos}</span>
    </div>` : '';

  const items = synonyms.map((syn, index) => {
    const registerClass = syn.register ? `wordgen-register-${syn.register}` : '';
    const commonnessClass = syn.commonness ? `wordgen-commonness-${syn.commonness}` : '';

    return `
      <div class="wordgen-synonym ${registerClass} ${commonnessClass}" data-index="${index}">
        <div class="wordgen-synonym-word">${syn.word}</div>
        <div class="wordgen-synonym-meta">
          ${syn.register ? `<span class="wordgen-badge">${syn.register}</span>` : ''}
          ${syn.commonness ? `<span class="wordgen-badge">${syn.commonness}</span>` : ''}
          ${syn.similarity ? `<span class="wordgen-score">${Math.round(syn.similarity * 100)}%</span>` : ''}
        </div>
        ${syn.note ? `<div class="wordgen-synonym-note">${syn.note}</div>` : ''}
      </div>
    `;
  }).join('');

  const footer = `
    <div class="wordgen-footer">
      <a href="#" class="wordgen-link" id="wordgen-open-webapp">Open WordGen App</a>
    </div>
  `;

  const html = header + `<div class="wordgen-list">${items}</div>` + footer;

  // Add click handler for footer link
  setTimeout(() => {
    const link = widget.querySelector('#wordgen-open-webapp');
    if (link) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.sendMessage({ action: 'openWebApp' });
      });
    }
  }, 0);

  return html;
}

/**
 * Handle synonym selection
 */
async function handleSynonymClick(synonym) {
  if (!currentWord) return;

  const originalWord = currentWord.text;
  const replacement = synonym.word;

  // Preserve capitalization
  const finalReplacement = preserveCapitalization(originalWord, replacement);

  // Replace in editable fields
  if (currentWord.editable && currentElement) {
    replaceInEditableField(originalWord, finalReplacement);
  } else {
    // Replace in static text (limited support)
    replaceInStaticText(originalWord, finalReplacement);
  }

  // Hide widget
  hideWidget();

  // Notify background script
  await chrome.runtime.sendMessage({
    action: 'wordReplaced'
  });
}

/**
 * Replace word in editable field (input, textarea, contenteditable)
 */
function replaceInEditableField(oldWord, newWord) {
  if (!currentElement) return;

  if (currentElement.tagName === 'INPUT' || currentElement.tagName === 'TEXTAREA') {
    // Handle input/textarea
    const start = currentElement.selectionStart;
    const end = currentElement.selectionEnd;
    const value = currentElement.value;

    const before = value.substring(0, start);
    const after = value.substring(end);

    currentElement.value = before + newWord + after;

    // Set cursor after replacement
    const newPos = start + newWord.length;
    currentElement.selectionStart = newPos;
    currentElement.selectionEnd = newPos;

    // Trigger input event
    currentElement.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (currentElement.isContentEditable) {
    // Handle contenteditable
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(newWord));

      // Move cursor after replacement
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      // Trigger input event
      currentElement.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

/**
 * Replace word in static text (best effort)
 */
function replaceInStaticText(oldWord, newWord) {
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);

    try {
      range.deleteContents();
      range.insertNode(document.createTextNode(newWord));

      // Clear selection
      selection.removeAllRanges();
    } catch (error) {
      console.error('Could not replace text:', error);
      alert('Cannot replace text in this element. Try selecting the text manually and using the context menu.');
    }
  }
}

/**
 * Hide widget
 */
function hideWidget() {
  if (widget) {
    widget.remove();
    widget = null;
  }
  currentWord = null;
  currentElement = null;
}

/**
 * Handle scroll events (auto-dismiss)
 */
function handleScroll(event) {
  if (widget) {
    // Check setting for auto-dismiss
    chrome.storage.sync.get(['autoDismissOnScroll'], (result) => {
      if (result.autoDismissOnScroll !== false) {
        hideWidget();
      }
    });
  }
}

/**
 * Handle clicks outside widget
 */
function handleOutsideClick(event) {
  if (widget && !widget.contains(event.target)) {
    hideWidget();
  }
}

/**
 * Handle messages from background script or popup
 */
function handleMessage(request, sender, sendResponse) {
  if (request.action === 'showSynonymsFromContext') {
    // Called from context menu
    const word = request.word;

    // Show widget at center of viewport
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 2;

    showWidget(x, y, 'Loading...');

    // Request synonyms
    chrome.runtime.sendMessage({
      action: 'getSynonyms',
      word: word,
      context: ''
    }).then(response => {
      if (response.success && response.synonyms.length > 0) {
        showWidget(x, y, response.synonyms, response.wordInfo);
      } else {
        showWidget(x, y, 'No synonyms found');
      }
    });
  }

  sendResponse({ success: true });
}
