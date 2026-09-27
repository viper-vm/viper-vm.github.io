// Groundtruth · draws any frame of any place straight from map tiles onto a canvas.
// Powers thumbnails, hover previews, the contact sheet and every export, so exports
// never depend on what the interactive map happens to have loaded.
// Zoom uses MapLibre's convention (512-px world at z0); tiles are 256 px.

const cache = new Map(); // url -> Promise<HTMLImageElement|null>
const MAX_CACHE = 900;

export function loadTile(url) {
  if (cache.has(url)) {
    const p = cache.get(url);
    cache.delete(url);
    cache.set(url, p); // LRU bump
    return p;
  }
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  cache.set(url, p);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return p;
}

const fill = (tpl, z, x, y) => tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y);

function worldPx(lng, lat, z) {
  const size = 256 * 2 ** z;
  const la = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return [((lng + 180) / 360) * size, ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * size];
}

/** Tiles (and placement) needed to cover a w×h view centred on lng/lat at map zoom. */
export function tilePlan({ lng, lat, zoom, width, height, maxzoom = 18 }) {
  const zt = Math.max(0, Math.min(maxzoom, Math.round(zoom + 1)));
  const scale = 2 ** (zoom + 1 - zt); // screen px per tile px
  const [cx, cy] = worldPx(lng, lat, zt);
  const halfW = width / 2 / scale, halfH = height / 2 / scale;
  const n = 2 ** zt;
  const tiles = [];
  for (let tx = Math.floor((cx - halfW) / 256); tx <= Math.floor((cx + halfW) / 256); tx++) {
    for (let ty = Math.floor((cy - halfH) / 256); ty <= Math.floor((cy + halfH) / 256); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      tiles.push({ z: zt, x: wx, y: ty, dx: (tx * 256 - cx) * scale + width / 2, dy: (ty * 256 - cy) * scale + height / 2, size: 256 * scale });
    }
  }
  return tiles;
}

/**
 * Older archive releases often stop a zoom level or two early (the server answers
 * 404). Fall back to the matching quarter of the parent tile, like the map does.
 */
async function tileOrParent(tpl, t) {
  for (let dz = 0; dz <= 3 && t.z - dz >= 0; dz++) {
    const n = 1 << dz, px = t.x >> dz, py = t.y >> dz;
    const img = await loadTile(fill(tpl, t.z - dz, px, py));
    if (img) {
      const sw = 256 / n;
      return { img, sx: (t.x - px * n) * sw, sy: (t.y - py * n) * sw, sw };
    }
  }
  return null;
}

/**
 * Render a frame into ctx (already sized). Resolves once every tile has loaded.
 * Leaves the canvas untainted: both imagery hosts send CORS headers.
 */
export async function drawFrame(ctx, frame, view, { signal } = {}) {
  const { width, height } = view;
  const plan = tilePlan({ ...view, maxzoom: frame.maxzoom ?? 18 });
  const imgs = await Promise.all(plan.map((t) => tileOrParent(frame.tiles, t)));
  if (signal?.aborted) return false;
  ctx.save();
  ctx.fillStyle = "#0b0e12";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  plan.forEach((t, i) => {
    const s = imgs[i];
    // +0.5 px overlap hides hairline seams between scaled tiles
    if (s) ctx.drawImage(s.img, s.sx, s.sy, s.sw, s.sw, Math.floor(t.dx), Math.floor(t.dy), Math.ceil(t.size + 0.5), Math.ceil(t.size + 0.5));
  });
  ctx.restore();
  return imgs.some(Boolean);
}

/** Convenience: new canvas with the frame drawn at devicePixelRatio. */
export async function renderToCanvas(frame, { lng, lat, zoom, width, height, dpr = Math.min(2, globalThis.devicePixelRatio || 1) }, opts) {
  const c = document.createElement("canvas");
  c.width = Math.round(width * dpr);
  c.height = Math.round(height * dpr);
  const ctx = c.getContext("2d");
  await drawFrame(ctx, frame, { lng, lat, zoom: zoom + Math.log2(dpr), width: c.width, height: c.height }, opts);
  return c;
}

/** Warm the HTTP cache for a frame over a view (used before crossfades and playback). */
export function prefetch(frame, view) {
  return Promise.all(tilePlan({ ...view, maxzoom: frame.maxzoom ?? 18 }).map((t) => tileOrParent(frame.tiles, t)));
}
