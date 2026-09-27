// Plumb — pictures of a drawing for cards and lists, drawn by the same renderer as the workspace.

import { Plan2D } from '../view2d.js';
import { PALETTES } from '../style.js';

let painter = null;
function get(result) {
  if (!painter) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    painter = new Plan2D(cv);
  }
  if (painter.data !== result) { painter.data = result; painter.paths.clear(); }
  return painter;
}

/**
 * A still of one floor (only) or of a floor over the one below (k), fitted to w×h CSS pixels.
 * Returns a data: URL.
 */
export function thumb(result, { only = null, k = null, w = 320, h = 200, theme = 'dark', labels = false, dpr = 2, type = 'image/webp' } = {}) {
  const p = get(result);
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const pair = k != null ? k : Math.min(1, result.floors.length - 1);
  const floors = only != null ? [only] : pair > 0 ? [pair - 1, pair] : [0];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const fi of floors) {
    const b = result.an[fi].box, T = result.transforms[fi];
    x0 = Math.min(x0, b[0] + T.tx); y0 = Math.min(y0, b[1] + T.ty); x1 = Math.max(x1, b[2] + T.tx); y1 = Math.max(y1, b[3] + T.ty);
  }
  const keep = { W: p.W, H: p.H, labels: p.show.labels, sel: p.selected, k: p.k };
  p.W = w; p.H = h; p.show.labels = labels; p.selected = null; p.k = pair;
  const view = p.fitView([x0, y0, x1, y1], w, h, { t: 10, b: 10, l: 10, r: 10 });
  p.draw(c.getContext('2d'), c.width, c.height, dpr, view, { k: pair, only, pal: PALETTES[theme], pulse: 0, noScale: true, noGrid: true });
  Object.assign(p, { W: keep.W, H: keep.H, selected: keep.sel, k: keep.k });
  p.show.labels = keep.labels;
  return c.toDataURL(type, 0.85);
}

/** A still around one issue, for the issues page and reports. */
export function issueShot(result, iss, { w = 520, h = 340, theme = 'dark' } = {}) {
  const p = get(result);
  return p.snapshot(iss, w, h, theme);
}
