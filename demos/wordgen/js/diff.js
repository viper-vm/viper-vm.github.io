/**
 * diff.js
 * Text diff algorithm and visualization for comparing original vs. modified text
 */

/**
 * Simple word-level diff using Myers algorithm (simplified)
 * @param {string} original - Original text
 * @param {string} modified - Modified text
 * @returns {Array} Array of diff operations
 */
function computeWordDiff(original, modified) {
  const originalWords = original.split(/(\s+)/);  // Keep whitespace
  const modifiedWords = modified.split(/(\s+)/);

  const n = originalWords.length;
  const m = modifiedWords.length;
  const max = n + m;
  const v = {};
  const trace = [];

  v[1] = 0;

  for (let d = 0; d <= max; d++) {
    trace.push({ ...v });

    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[k - 1] < v[k + 1])) {
        x = v[k + 1];
      } else {
        x = v[k - 1] + 1;
      }

      let y = x - k;

      while (x < n && y < m && originalWords[x] === modifiedWords[y]) {
        x++;
        y++;
      }

      v[k] = x;

      if (x >= n && y >= m) {
        return backtrack(trace, originalWords, modifiedWords, x, y);
      }
    }
  }

  return backtrack(trace, originalWords, modifiedWords, n, m);
}

/**
 * Backtrack through the trace to build the diff
 */
function backtrack(trace, originalWords, modifiedWords, x, y) {
  const diff = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;

    let prevK;
    if (k === -d || (k !== d && v[k - 1] < v[k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = v[prevK];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      diff.unshift({ type: 'equal', value: originalWords[x - 1] });
      x--;
      y--;
    }

    if (d > 0) {
      if (x > prevX) {
        diff.unshift({ type: 'delete', value: originalWords[x - 1] });
        x--;
      } else if (y > prevY) {
        diff.unshift({ type: 'insert', value: modifiedWords[y - 1] });
        y--;
      }
    }
  }

  return diff;
}

/**
 * Generate diff with statistics
 * @param {string} original - Original text
 * @param {string} modified - Modified text
 * @returns {Object} Diff object with changes and stats
 */
export function generateDiff(original, modified) {
  if (original === modified) {
    return {
      changes: [{ type: 'equal', text: original }],
      stats: { added: 0, removed: 0, unchanged: original.split(/\s+/).length }
    };
  }

  const wordDiff = computeWordDiff(original, modified);

  // Merge adjacent operations of the same type
  const merged = [];
  let current = null;

  for (const op of wordDiff) {
    if (current && current.type === op.type) {
      current.text += op.value;
    } else {
      if (current) merged.push(current);
      current = { type: op.type, text: op.value };
    }
  }
  if (current) merged.push(current);

  // Calculate statistics
  const stats = {
    added: 0,
    removed: 0,
    unchanged: 0
  };

  for (const change of merged) {
    const words = change.text.trim().split(/\s+/).filter(w => w.length > 0);
    if (change.type === 'insert') {
      stats.added += words.length;
    } else if (change.type === 'delete') {
      stats.removed += words.length;
    } else {
      stats.unchanged += words.length;
    }
  }

  return { changes: merged, stats };
}

/**
 * Render diff as inline HTML with del/ins tags
 * @param {Object} diff - Diff object from generateDiff
 * @returns {string} HTML string
 */
export function renderInlineDiff(diff) {
  let html = '';

  for (const change of diff.changes) {
    const text = escapeHtml(change.text);

    if (change.type === 'delete') {
      html += `<del class="diff-deleted">${text}</del>`;
    } else if (change.type === 'insert') {
      html += `<ins class="diff-inserted">${text}</ins>`;
    } else {
      html += `<span class="diff-equal">${text}</span>`;
    }
  }

  return html;
}

/**
 * Render diff as side-by-side comparison
 * @param {Object} diff - Diff object from generateDiff
 * @param {string} original - Original text
 * @param {string} modified - Modified text
 * @returns {Object} { original: htmlString, modified: htmlString }
 */
export function renderSideBySideDiff(diff, original, modified) {
  let originalHtml = '';
  let modifiedHtml = '';

  for (const change of diff.changes) {
    const text = escapeHtml(change.text);

    if (change.type === 'delete') {
      originalHtml += `<del class="diff-deleted">${text}</del>`;
      // Empty space in modified column
    } else if (change.type === 'insert') {
      // Empty space in original column
      modifiedHtml += `<ins class="diff-inserted">${text}</ins>`;
    } else {
      originalHtml += `<span class="diff-equal">${text}</span>`;
      modifiedHtml += `<span class="diff-equal">${text}</span>`;
    }
  }

  return {
    original: originalHtml || escapeHtml(original),
    modified: modifiedHtml || escapeHtml(modified)
  };
}

/**
 * Generate color-coded diff highlighting specific word changes
 * @param {Object} diff - Diff object
 * @returns {string} HTML with highlighted changes
 */
export function renderHighlightedDiff(diff) {
  let html = '<div class="diff-highlighted">';

  for (const change of diff.changes) {
    const text = escapeHtml(change.text);

    if (change.type === 'delete') {
      html += `<span class="diff-highlight-removed">${text}</span>`;
    } else if (change.type === 'insert') {
      html += `<span class="diff-highlight-added">${text}</span>`;
    } else {
      html += text;
    }
  }

  html += '</div>';
  return html;
}

/**
 * Render diff stats as HTML
 * @param {Object} stats - Stats object from diff
 * @returns {string} HTML string
 */
export function renderDiffStats(stats) {
  return `
    <div class="diff-stats">
      <span class="diff-stat diff-stat-added" title="Words added">
        <i data-lucide="plus-circle"></i>
        <strong>${stats.added}</strong> added
      </span>
      <span class="diff-stat diff-stat-removed" title="Words removed">
        <i data-lucide="minus-circle"></i>
        <strong>${stats.removed}</strong> removed
      </span>
      <span class="diff-stat diff-stat-unchanged" title="Words unchanged">
        <i data-lucide="equal"></i>
        <strong>${stats.unchanged}</strong> unchanged
      </span>
    </div>
  `;
}

/**
 * Calculate similarity percentage between two texts
 * @param {Object} diff - Diff object
 * @returns {number} Similarity percentage (0-100)
 */
export function calculateSimilarity(diff) {
  const total = diff.stats.added + diff.stats.removed + diff.stats.unchanged;
  if (total === 0) return 100;

  const similarity = (diff.stats.unchanged / total) * 100;
  return Math.round(similarity);
}

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Create a complete diff comparison component
 * @param {string} original - Original text
 * @param {string} modified - Modified text
 * @param {Object} options - Options { mode: 'inline'|'sidebyside', showStats: boolean }
 * @returns {string} HTML string for complete comparison
 */
export function createDiffComparison(original, modified, options = {}) {
  const mode = options.mode || 'inline';
  const showStats = options.showStats !== false;

  const diff = generateDiff(original, modified);
  const similarity = calculateSimilarity(diff);

  let html = '<div class="diff-comparison">';

  // Similarity indicator
  html += `
    <div class="diff-similarity">
      <div class="similarity-bar">
        <div class="similarity-fill" style="width: ${similarity}%"></div>
      </div>
      <span class="similarity-text">${similarity}% similar</span>
    </div>
  `;

  // Diff content
  if (mode === 'inline') {
    html += `<div class="diff-content diff-inline">${renderInlineDiff(diff)}</div>`;
  } else if (mode === 'sidebyside') {
    const sideBySide = renderSideBySideDiff(diff, original, modified);
    html += `
      <div class="diff-content diff-sidebyside">
        <div class="diff-column diff-column-original">
          <div class="diff-column-header">Original</div>
          <div class="diff-column-content">${sideBySide.original}</div>
        </div>
        <div class="diff-column diff-column-modified">
          <div class="diff-column-header">Modified</div>
          <div class="diff-column-content">${sideBySide.modified}</div>
        </div>
      </div>
    `;
  }

  // Statistics
  if (showStats) {
    html += renderDiffStats(diff.stats);
  }

  html += '</div>';

  return html;
}

/**
 * Generate sentence-level diff for paragraph comparison
 * @param {string} originalPara - Original paragraph
 * @param {string} modifiedPara - Modified paragraph
 * @returns {Array} Array of sentence diffs
 */
export function generateParagraphDiff(originalPara, modifiedPara) {
  // Split into sentences
  const originalSentences = originalPara.match(/[^.!?]+[.!?]+/g) || [originalPara];
  const modifiedSentences = modifiedPara.match(/[^.!?]+[.!?]+/g) || [modifiedPara];

  const sentenceDiffs = [];

  const maxLength = Math.max(originalSentences.length, modifiedSentences.length);

  for (let i = 0; i < maxLength; i++) {
    const original = (originalSentences[i] || '').trim();
    const modified = (modifiedSentences[i] || '').trim();

    if (original || modified) {
      const diff = generateDiff(original, modified);
      sentenceDiffs.push({
        index: i,
        original,
        modified,
        diff,
        similarity: calculateSimilarity(diff)
      });
    }
  }

  return sentenceDiffs;
}
