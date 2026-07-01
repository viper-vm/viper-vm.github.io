// ============================================================
//  Modal — shared overlay used by the cashier and fairness views.
// ============================================================

import { h, icon, refreshIcons } from './components.js';

export function openModal({ title, icon: iconName, body, width }) {
  const content = h('div.sk-modal', { style: width ? { maxWidth: width } : {} }, [
    h('div.sk-modal-head', {}, [
      h('h2', {}, [iconName ? icon(iconName) : null, title]),
      h('button.sk-icon-btn', { type: 'button', onclick: close }, [icon('x')]),
    ]),
    h('div.sk-modal-body', {}, [body]),
  ]);
  const overlay = h('div.sk-overlay', { onclick: (e) => { if (e.target === overlay) close(); } }, [content]);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('in'));
  refreshIcons();
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('in');
    setTimeout(() => overlay.remove(), 200);
  }
  return { overlay, content, close };
}
