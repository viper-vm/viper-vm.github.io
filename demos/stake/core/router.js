// ============================================================
//  Hash router — one static deploy, deep-linkable views.
//  #/                 lobby
//  #/play/:gameId     game
//  #/analytics        cross-game dashboard
//  #/analytics/:id    per-game dashboard
//  #/strategies       strategy lab
//  #/settings         settings
// ============================================================

export function currentRoute() {
  const raw = (location.hash || '#/').replace(/^#/, '') || '/';
  const segs = raw.split('/').filter(Boolean);
  return { raw, segs };
}

export class Router {
  constructor(onChange) {
    this.onChange = onChange;
    this._handler = () => this.onChange(currentRoute());
    window.addEventListener('hashchange', this._handler);
  }
  start() { this.onChange(currentRoute()); }
  go(path) {
    const target = path.startsWith('#') ? path.slice(1) : path;
    if (currentRoute().raw === target) this.onChange(currentRoute());
    else location.hash = target;
  }
}
