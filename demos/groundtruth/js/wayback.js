// Groundtruth · archive client for Esri World Imagery Wayback.
// Runs unchanged in the browser and in Node 18+ (used by scripts/groundtruth/bake.mjs).
//
// How it works: Esri republishes its World Imagery basemap roughly monthly and keeps
// every release (2014 →). A "tilemap" endpoint tells us, for any tile and release,
// which *older* release that tile's pixels actually come from. Walking that chain
// from the newest release backwards yields every distinct version of the tile —
// i.e. every time new satellite imagery landed on that spot.

const CONFIG_URL = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";
const BASE = "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery";

export const tileTemplate = (r) =>
  `${BASE}/WMTS/1.0.0/default028mm/MapServer/tile/${r}/{z}/{y}/{x}`;

export const tileUrl = (r, z, x, y) =>
  `${BASE}/WMTS/1.0.0/default028mm/MapServer/tile/${r}/${z}/${y}/${x}`;

const tilemapUrl = (r, z, x, y, n = 1) =>
  `${BASE}/MapServer/tilemap/${r}/${z}/${y}/${x}/${n}/${n}`;

const SENSORS = {
  WV01: "WorldView-1", WV02: "WorldView-2", WV03: "WorldView-3", WV04: "WorldView-4",
  GE01: "GeoEye-1", QB02: "QuickBird", IK02: "IKONOS", PHR: "Pléiades", PL: "Pléiades",
  LG01: "WorldView Legion", LG02: "WorldView Legion", LG03: "WorldView Legion",
  LG04: "WorldView Legion", LG05: "WorldView Legion", LG06: "WorldView Legion",
  SPOT: "SPOT", SP06: "SPOT-6", SP07: "SPOT-7", AE: "Aerial", KOMP: "KOMPSAT",
};
export const sensorName = (code) => (code ? SENSORS[code] || SENSORS[code.slice(0, 4)] || code : "");

async function getJSON(url, signal, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (signal?.aborted) throw e;
      err = e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw err;
}

/** All releases, oldest → newest: [{ r, date: 'YYYY-MM-DD', meta }] */
export async function loadReleases(signal) {
  const cfg = await getJSON(CONFIG_URL, signal);
  return Object.entries(cfg)
    .map(([r, v]) => ({
      r: +r,
      date: (v.itemTitle.match(/\d{4}-\d{2}-\d{2}/) || ["0000-00-00"])[0],
      meta: v.metadataLayerUrl,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const la = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/**
 * Every distinct version of one tile, newest first: [{ r, date, size }].
 * `stopBefore` (a release date) makes it incremental: stop once we reach releases
 * we already know about. `onStep(found, fractionDone)` streams progress.
 */
export async function scanTile({ releases, z, x, y, stopBefore = null, onStep, signal }) {
  const idx = new Map(releases.map((rel, i) => [rel.r, i]));
  const out = [];
  let i = releases.length - 1;
  while (i >= 0) {
    const rel = releases[i];
    if (stopBefore && rel.date <= stopBefore) break;
    const j = await getJSON(tilemapUrl(rel.r, z, x, y), signal);
    if (!j.data || !j.data[0]) break; // no imagery at this tile before here
    const sel = (j.select && j.select[0]) || rel.r;
    const at = idx.get(sel);
    if (at === undefined) break;
    const v = { r: sel, date: releases[at].date, size: (j.size && j.size[0]) || 0 };
    out.push(v);
    onStep?.(v, 1 - at / releases.length);
    i = at - 1;
  }
  return dedupe(out);
}

/**
 * Same result as scanTile, but probes many releases in parallel instead of walking
 * the chain one hop at a time: sample every `stride`-th release, then keep probing
 * just before each newly found version until every gap between samples is closed.
 * ~3 network round-trips instead of ~20 — this is what makes Explore feel instant.
 */
export async function scanTileFast({ releases, z, x, y, onStep, signal, stride = 12, concurrency = 10 }) {
  const n = releases.length;
  const idx = new Map(releases.map((rel, i) => [rel.r, i]));
  const got = new Map(); // release index -> { at: index of version shown there (-1 = no imagery), size }
  const probe = async (i) => {
    const j = await getJSON(tilemapUrl(releases[i].r, z, x, y), signal);
    if (!j.data || !j.data[0]) return got.set(i, { at: -1, size: 0 });
    const at = idx.get((j.select && j.select[0]) || releases[i].r) ?? i;
    const fresh = ![...got.values()].some((v) => v.at === at);
    got.set(i, { at, size: (j.size && j.size[0]) || 0 });
    if (fresh) onStep?.({ r: releases[at].r, date: releases[at].date }, got.size / (got.size + 6));
  };
  let batch = [];
  for (let i = n - 1; i >= 0; i -= stride) batch.push(i);
  if (batch[batch.length - 1] !== 0) batch.push(0);
  while (batch.length) {
    await pool(batch.map((i) => () => probe(i)), concurrency);
    const probed = [...got.entries()].sort((a, b) => a[0] - b[0]);
    const next = new Set();
    for (let k = 1; k < probed.length; k++) {
      const [iPrev] = probed[k - 1], [, vNext] = probed[k];
      // the version seen at the newer probe began after the older probe → something may hide in between
      if (vNext.at > iPrev + 1 && !got.has(vNext.at - 1)) next.add(vNext.at - 1);
    }
    batch = [...next];
  }
  const seen = new Map();
  for (const v of got.values()) if (v.at >= 0 && !seen.has(v.at)) seen.set(v.at, v.size);
  const out = [...seen.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([at, size]) => ({ r: releases[at].r, date: releases[at].date, size }));
  return dedupe(out);
}

// Esri sometimes republishes a tile byte-for-byte; identical sizes ⇒ same pixels.
function dedupe(versions) {
  const out = [];
  for (const v of versions) {
    const prev = out[out.length - 1];
    if (prev && v.size && prev.size === v.size) continue; // keep the newer copy
    out.push(v);
  }
  return out;
}

const metaCache = new Map();

/**
 * Acquisition details for the imagery shown at a point in a release:
 * { date: 'YYYY-MM-DD', sensor, res (m), acc (m), provider } or null.
 */
export async function captureInfo(rel, lng, lat, z, signal) {
  if (!rel?.meta) return null;
  const key = `${rel.r}|${lng.toFixed(5)}|${lat.toFixed(5)}|${z}`;
  if (metaCache.has(key)) return metaCache.get(key);
  const base = Math.max(0, Math.min(13, 23 - Math.round(z)));
  const tryLayers = [base, base + 1, base - 1, base + 2, base + 3].filter((l) => l >= 0 && l <= 13);
  let info = null;
  for (const layer of tryLayers) {
    const url =
      `${rel.meta}/${layer}/query?f=json&where=1%3D1` +
      `&outFields=SRC_DATE,SRC_RES,SRC_ACC,SRC_DESC,NICE_DESC` +
      `&geometry=${lng.toFixed(6)},${lat.toFixed(6)}&geometryType=esriGeometryPoint&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects&returnGeometry=false`;
    let j;
    try { j = await getJSON(url, signal, 2); } catch (e) { if (signal?.aborted) throw e; continue; }
    if (j.error) break; // service has no such layers (some 2015 releases)
    const a = j.features && j.features[0] && j.features[0].attributes;
    if (a && a.SRC_DATE) {
      const s = String(a.SRC_DATE);
      info = {
        date: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`,
        sensor: a.SRC_DESC || "",
        res: a.SRC_RES || null,
        acc: a.SRC_ACC || null,
        provider: a.NICE_DESC || "",
      };
      break;
    }
  }
  metaCache.set(key, info);
  return info;
}

/**
 * Attach capture metadata to versions (newest-first list from scanTile).
 * If a release's own metadata service is missing, borrow the metadata of the
 * newest release that still shows the same pixels (just before the next version).
 */
export async function describeVersions({ releases, versions, lng, lat, z, signal, concurrency = 6 }) {
  const idx = new Map(releases.map((rel, i) => [rel.r, i]));
  const jobs = versions.map((v, k) => async () => {
    const own = releases[idx.get(v.r)];
    let info = await captureInfo(own, lng, lat, z, signal);
    if (!info) {
      const newer = versions[k - 1];
      const lastSame = newer ? releases[idx.get(newer.r) - 1] : releases[releases.length - 1];
      if (lastSame && lastSame.r !== v.r) info = await captureInfo(lastSame, lng, lat, z, signal);
    }
    return { ...v, info };
  });
  return pool(jobs, concurrency);
}

export async function pool(jobs, n) {
  const out = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const k = next++;
      out[k] = await jobs[k]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
  return out;
}

/**
 * Compact record used by the app and the baked data file. Oldest → newest.
 * Two releases can show the same capture at the focus point (the tile changed
 * elsewhere); keep only the later one so every frame is a distinct acquisition.
 */
export function toFrames(described, releases) {
  const idx = new Map(releases.map((rel, i) => [rel.r, i]));
  const frames = described
    .map((v) => ({
      r: v.r,
      rd: releases[idx.get(v.r)].date,
      cd: v.info?.date || null,
      s: v.info?.sensor || "",
      m: v.info?.res ? Math.round(v.info.res * 100) / 100 : null,
      p: v.info?.provider || "",
    }))
    .sort((a, b) => (a.cd || a.rd).localeCompare(b.cd || b.rd) || a.rd.localeCompare(b.rd));
  return frames.filter((f, k) => !(f.cd && frames[k + 1] && frames[k + 1].cd === f.cd));
}

/** Full pipeline for one spot: scan + describe → frames (oldest → newest). */
export async function historyAt({ releases, lng, lat, z, onStep, signal, stopBefore = null }) {
  const { x, y } = lngLatToTile(lng, lat, z);
  const versions = await scanTile({ releases, z, x, y, onStep, signal, stopBefore });
  const described = await describeVersions({ releases, versions, lng, lat, z: Math.max(z, 16), signal });
  return { z, x, y, frames: toFrames(described, releases), latest: releases[releases.length - 1].date };
}
