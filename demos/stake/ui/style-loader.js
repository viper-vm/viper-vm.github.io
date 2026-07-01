// ============================================================
//  Style loader — lets each game ship its own style.css and load
//  it once on demand. Paths are resolved relative to the calling
//  module via import.meta.url, so it works under any base path.
// ============================================================

const loaded = new Set();

export function ensureStyle(url) {
  const href = String(url);
  if (loaded.has(href)) return;
  loaded.add(href);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}
