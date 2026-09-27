// Groundtruth · main controller.
// Data flow: projects.json + captures.json (baked) → frames → MapPair + Timeline.
// Explore mode builds the same frames live from the Wayback archive.

import {
  $, $$, h, esc, fmtDate, fmtMonth, decYear, clamp, haversineKm, polygonAreaM2,
  fmtDist, fmtArea, fmtCoord, store, debounce, sleep, download, slug,
} from "./util.js";
import { loadReleases, scanTile, scanTileFast, describeVersions, toFrames, tileTemplate, sensorName, pool, lngLatToTile } from "./wayback.js";
import { MapPair } from "./maps.js";
import { Timeline } from "./timeline.js";
import { renderToCanvas, prefetch } from "./compositor.js";
import * as EX from "./exporter.js";

const HIRES_ATTR = "Imagery © Esri World Imagery Wayback — Maxar/Vantor, Earthstar Geographics";
const LIVE = { src: "live", key: "live", tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", maxzoom: 18, attribution: "Imagery © Esri, Maxar, Earthstar Geographics", date: "2026-01-01", sub: "" };
const S2_YEARS = [2016, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const s2Tiles = (yr) => `https://tiles.maps.eox.at/wmts/1.0.0/${yr === 2016 ? "s2cloudless_3857" : `s2cloudless-${yr}_3857`}/default/g/{z}/{y}/{x}.jpg`;
const OVERVIEW = { c: [79.4, 22.8], z: 3.85 };
const PHOTON = "https://photon.komoot.io";

const S = {
  cats: {}, projects: [], byId: new Map(), captures: {}, bakedLatest: null,
  releases: null,
  ctx: { kind: "overview" },
  src: "hires",
  frames: [], cur: 0, a: 0, b: 0,
  mode: "single",
  playing: false,
  tab: "projects", view: "library", catFilter: null, query: "",
  watch: store.get("gt.watch", []),
  fresh: store.get("gt.fresh", {}),
  measure: null,
  news: null,
  scan: null,
};
let pair, tl, releasesP, newsP;

// ------------------------------------------------------------------ frames
function hiresFrames(list) {
  return list.map((f) => ({
    src: "hires", key: String(f.r), r: f.r,
    date: f.cd || f.rd, approx: !f.cd, rd: f.rd,
    label: f.cd ? fmtDate(f.cd) : `Published ${fmtMonth(f.rd)}`,
    sub: [sensorName(f.s), f.m ? `${Math.round(f.m * 100)} cm` : "", f.p].filter(Boolean).join(" · ") || `Esri archive release ${fmtMonth(f.rd)} · capture date unknown`,
    tiles: tileTemplate(f.r), mapTiles: `wbk://${f.r}/{z}/{x}/{y}`, maxzoom: 18, attribution: HIRES_ATTR,
  }));
}
function s2Frames() {
  return S2_YEARS.map((y) => ({
    src: "s2", key: String(y), date: `${y}-07-01`, approx: false, year: y,
    label: String(y), sub: `Sentinel-2 cloudless · ${y} annual mosaic · 10 m · EOX`,
    tiles: s2Tiles(y), maxzoom: 15,
    attribution: `Sentinel-2 cloudless ${y} by EOX IT Services — contains modified Copernicus Sentinel data ${y}`,
  }));
}
const frameTitle = (f) => (f.src === "s2" ? String(f.year) : f.approx ? fmtMonth(f.date) : fmtDate(f.date));
const frameShort = (f) => (f.src === "s2" ? String(f.year) : fmtMonth(f.date));

// A sensible "before": skip panchromatic WorldView-1 and approximate frames when we can.
function defaultA(frames) {
  const i = frames.findIndex((f) => f.src === "s2" || (!f.approx && !/WorldView-1\b/.test(f.sub)));
  return i >= 0 && i < frames.length - 1 ? i : 0;
}

function projectRecord(id) {
  const base = S.captures[id];
  const extra = S.fresh[id];
  if (!base) return null;
  if (!extra?.frames?.length) return base;
  const seen = new Set(base.frames.map((f) => f.r));
  return { ...base, frames: [...base.frames, ...extra.frames.filter((f) => !seen.has(f.r))].sort((x, y) => (x.cd || x.rd).localeCompare(y.cd || y.rd)) };
}

function ctxFrames(src = S.src) {
  const c = S.ctx;
  if (src === "s2") return s2Frames();
  if (c.kind === "project") return hiresFrames(projectRecord(c.p.id)?.frames || []);
  if (c.kind === "spot") return hiresFrames(c.spot.frames || []);
  return [];
}

// ------------------------------------------------------------------ boot
async function boot() {
  const [pj, cj] = await Promise.all([
    fetch("data/projects.json").then((r) => r.json()),
    fetch("data/captures.json").then((r) => r.json()).catch(() => ({ projects: {} })),
  ]);
  S.cats = pj.categories;
  S.projects = pj.projects;
  S.byId = new Map(pj.projects.map((p) => [p.id, p]));
  S.captures = cj.projects || {};
  S.bakedLatest = cj.latest;
  startReleases();

  pair = new MapPair({ stage: $("#stage"), view: OVERVIEW });
  tl = new Timeline($("#tl"), {
    select: (i) => { stopPlay(); S.cur = i; syncView(); },
    setA: (i) => { S.a = i; syncView(); },
    setB: (i) => { S.b = i; syncView(); },
    milestone: jumpToMilestone,
    thumb: (f) => thumbFor(f, 212, 132),
  });

  bindUI();
  renderRail();
  renderQuickStart();
  await pair.ready;
  const m = pair.main;
  m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  m.once("idle", () => $(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
  const dock = $("#dock");
  new ResizeObserver(() => document.documentElement.style.setProperty("--dock-h", `${dock.offsetHeight}px`)).observe(dock);
  m.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: false }), "top-right");
  m.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "top-left");
  addProjectMarkers();
  bindMapEvents();
  if (!route()) goOverview(false);
}

function startReleases() {
  releasesP ||= loadReleases()
    .then((r) => { S.releases = r; onReleases(); return r; })
    .catch((e) => { console.warn("archive index unavailable", e); releasesP = null; return null; });
  return releasesP;
}

const QUICK = ["navi-mumbai-airport", "atal-setu", "chenab-bridge", "khavda-re-park", "central-vista"];

function renderQuickStart() {
  const box = $("#dockEmpty");
  box.replaceChildren(
    h("span", {}, h("b", {}, "Start here"), " — or pan anywhere and ", h("button", { class: "linkish", onclick: () => { S.tab = "explore"; renderRail(); applyCtx(); if (isPhone()) setRail(true); } }, "scan any spot"), "."),
    h("div", { class: "quick" }, ...QUICK.map((id) => {
      const p = S.byId.get(id);
      return p && h("button", { class: "quick-chip", onclick: () => openProject(id) }, h("span", { class: "dot", style: `--c:${S.cats[p.cat].color}` }), p.short);
    })));
}

function goOverview(fly = true) {
  stopPlay();
  S.ctx = { kind: "overview" };
  S.frames = [];
  setMode("single", { silent: true });
  pair.setFrame("A", LIVE, { fade: 0 });
  if (fly) pair.flyTo(OVERVIEW);
  else pair.jumpTo(OVERVIEW);
  applyCtx();
}

function applyCtx() {
  const st = $("#stage");
  st.dataset.ctx = S.ctx.kind;
  st.classList.toggle("exploring", S.tab === "explore");
  $("#srcToggle").hidden = S.ctx.kind === "spot";
  $$("#srcToggle button").forEach((b) => b.setAttribute("aria-checked", b.dataset.src === S.src));
  $$("#modes button").forEach((b) => (b.disabled = S.ctx.kind === "overview" && b.dataset.mode !== "single"));
  updateScanFab();
  renderReadout();
  renderChips();
  writeHash();
}

// ------------------------------------------------------------------ project & spot
function openProject(id, opts = {}) {
  const p = S.byId.get(id);
  if (!p) return;
  stopPlay();
  closeMeasure();
  S.scan?.ac.abort();
  S.ctx = { kind: "project", p };
  S.src = opts.src || p.src || "hires";
  S.tab = "projects";
  S.view = "dossier";
  const frames = ctxFrames();
  setFrames(frames, pickIdx(frames, { a: S.src === "hires" ? p.a : undefined, ...stripNil(opts) }));
  const target = opts.v || { c: p.view.c, z: fitZoom(p.view.z) };
  if (opts.jump) pair.jumpTo(target); else pair.flyTo(target);
  setMode(opts.mode || "swipe", { silent: true });
  applyCtx();
  renderRail();
  if (S.mode === "swipe" && !opts.mode) setTimeout(() => pair.sweep(1500), opts.jump ? 300 : 1400);
  if (isPhone()) setRail(false);
  markSeen(`p:${id}`);
  refreshProject(p);
}

const stripNil = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

function pickIdx(frames, opts) {
  const find = (k) => (k == null ? -1 : frames.findIndex((f) => f.key === String(k)));
  const n = frames.length;
  const b = find(opts.b) >= 0 ? find(opts.b) : n - 1;
  let a = find(opts.a) >= 0 ? find(opts.a) : defaultA(frames);
  if (a >= b && n > 1) a = Math.max(0, b - 1);
  const cur = find(opts.f) >= 0 ? find(opts.f) : b;
  return { a, b, cur };
}

/** Project views were framed for a ~1150 px wide map; adapt to this screen. */
function fitZoom(z) {
  const w = $("#stage").clientWidth || 1150;
  return z + clamp(Math.log2(w / 1150), -1.6, 0.6);
}

function setFrames(frames, { a, b, cur } = {}) {
  S.frames = frames;
  const n = frames.length;
  S.b = clamp(b ?? n - 1, 0, Math.max(0, n - 1));
  S.a = clamp(a ?? defaultA(frames), 0, Math.max(0, n - 1));
  S.cur = clamp(cur ?? n - 1, 0, Math.max(0, n - 1));
  tl.setData(frames, ctxMilestones());
  syncView(0);
}

function ctxMilestones() {
  return S.ctx.kind === "project" ? S.ctx.p.milestones || [] : [];
}

function setSource(src) {
  if (src === S.src || S.ctx.kind !== "project") return;
  stopPlay();
  S.src = src;
  const frames = ctxFrames();
  setFrames(frames, { a: defaultA(frames), b: frames.length - 1, cur: frames.length - 1 });
  applyCtx();
  if (src === "s2" && pair.view().z > 15.5) pair.flyTo({ c: pair.view().c, z: 14.5 });
  toast(src === "s2" ? "Sentinel-2: one cloud-free mosaic per year at 10 m — best for huge sites" : "Hi-res: every sub-metre capture in Esri's archive");
}

async function getReleases() {
  if (S.releases) return S.releases;
  const r = await startReleases();
  if (!r) throw new Error("Couldn't reach the imagery archive index");
  return r;
}

async function scanHere(lng, lat, zoom, opts = {}) {
  stopPlay();
  closeMeasure();
  S.scan?.ac.abort();
  const ac = new AbortController();
  const z = clamp(Math.round((zoom ?? pair.view().z) + 1), 12, 17);
  const spot = { lng, lat, z, name: opts.name || null, frames: [], status: "scanning", found: 0, progress: 0 };
  S.scan = { ac, spot };
  S.ctx = { kind: "spot", spot };
  S.src = "hires";
  S.tab = "explore";
  syncTabs();
  S.frames = [];
  tl.setData([], []);
  setMode("single", { silent: true });
  applyCtx();
  renderRail();
  $("#stage").classList.add("scanning");
  if (isPhone()) setRail(false);
  if (opts.fly) pair.flyTo({ c: [lng, lat], z: Math.max(zoom ?? 15, 14.5) });
  if (!spot.name) reverseGeocode(lng, lat).then((n) => { if (n && !spot.name) { spot.name = n; renderRail(); } });

  try {
    const releases = await getReleases();
    const { x, y } = lngLatToTile(lng, lat, z);
    const versions = await scanTileFast({
      releases, z, x, y, signal: ac.signal,
      onStep: (v, frac) => { spot.found++; spot.progress = Math.max(spot.progress, frac); if (!spot.reached || v.date < spot.reached) spot.reached = v.date; renderScanStatus(); },
    });
    if (ac.signal.aborted) return;
    // show provisional frames (release dates) immediately…
    const provisional = toFrames(versions.map((v) => ({ ...v, info: null })), releases);
    spot.frames = provisional;
    spot.status = "dating";
    let frames = hiresFrames(provisional);
    setFrames(frames, { a: 0, b: frames.length - 1, cur: frames.length - 1 });
    renderScanStatus();
    // …then fetch real acquisition dates and sensors
    const described = await describeVersions({ releases, versions, lng, lat, z: Math.max(z, 16), signal: ac.signal, concurrency: 8 });
    if (ac.signal.aborted) return;
    spot.frames = toFrames(described, releases);
    spot.latest = releases[releases.length - 1].date;
    spot.status = "done";
    frames = hiresFrames(spot.frames);
    setFrames(frames, pickIdx(frames, opts.a || opts.b ? opts : { a: defaultA(frames) }));
    if (frames.length > 1) {
      setMode(opts.mode || "swipe", { silent: true });
      if (!opts.mode) pair.sweep(1400);
    }
    toast(frames.length ? `${frames.length} distinct captures found — ${frameShort(frames[0])} to ${frameShort(frames[frames.length - 1])}` : "No imagery found here");
  } catch (e) {
    if (ac.signal.aborted) return;
    spot.status = "error";
    spot.error = e.message;
    toast("Scan failed — the archive didn't answer. Try again in a moment.");
  } finally {
    if (S.scan?.ac === ac) $("#stage").classList.remove("scanning");
    applyCtx();
    renderRail();
  }
}

async function reverseGeocode(lng, lat) {
  const near = nearestProject([lng, lat], 2.5);
  if (near) return `Near ${near.short}`;
  try {
    const j = await fetch(`${PHOTON}/reverse?lon=${lng}&lat=${lat}&lang=en&limit=1`).then((r) => r.json());
    const p = j.features?.[0]?.properties;
    if (!p) return null;
    // a point usually lands on some shop or office; the neighbourhood is a better name
    const place = ["house", "street"].includes(p.type) || p.osm_key !== "place" ? p.district || p.locality || p.street || p.name : p.name;
    return [place, p.city || p.county, p.state].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(", ");
  } catch { return null; }
}

function nearestProject(pt, maxKm) {
  let best = null, bd = maxKm;
  for (const p of S.projects) {
    const d = haversineKm(pt, p.focus || p.view.c);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// Newer archive releases than our baked file? Check the open project quietly.
async function refreshProject(p) {
  const releases = S.releases;
  if (!releases) return;
  const newest = releases[releases.length - 1].date;
  const known = S.fresh[p.id]?.latest || S.bakedLatest;
  if (!known || newest <= known) return;
  const rec = S.captures[p.id];
  if (!rec) return;
  try {
    const versions = await scanTile({ releases, z: rec.z, x: rec.x, y: rec.y, stopBefore: known });
    const have = new Set(projectRecord(p.id).frames.map((f) => f.r));
    const fresh = versions.filter((v) => !have.has(v.r));
    let frames = [];
    if (fresh.length) {
      const [lng, lat] = p.focus || p.view.c;
      frames = toFrames(await describeVersions({ releases, versions: fresh, lng, lat, z: Math.max(rec.z, 16) }), releases);
    }
    S.fresh[p.id] = { latest: newest, frames: [...(S.fresh[p.id]?.frames || []), ...frames] };
    store.set("gt.fresh", S.fresh);
    if (frames.length && S.ctx.kind === "project" && S.ctx.p.id === p.id && S.src === "hires") {
      const all = ctxFrames();
      setFrames(all, { a: S.a, b: all.length - 1, cur: all.length - 1 });
      toast(`New satellite capture: ${frameTitle(all[all.length - 1])}`);
      renderRail();
    }
  } catch {}
}

function onReleases() {
  const r = S.releases;
  $("#brandSpan").textContent = `${r.length} archive releases, ${r[0].date.slice(0, 4)}–${r[r.length - 1].date.slice(0, 4)}`;
  if (S.ctx.kind === "project") refreshProject(S.ctx.p);
  checkWatchlist();
}

// ------------------------------------------------------------------ view sync
function syncView(fade = 350) {
  const n = S.frames.length;
  if (!n) { renderReadout(); renderChips(); return; }
  S.cur = clamp(S.cur, 0, n - 1);
  S.a = clamp(S.a, 0, n - 1);
  S.b = clamp(S.b, 0, n - 1);
  if (S.mode === "single" || S.mode === "grid") pair.setFrame("A", S.frames[S.cur], { fade });
  else {
    pair.setFrame("A", S.frames[S.a], { fade });
    pair.setFrame("B", S.frames[S.b], { fade });
  }
  tl.setState({ mode: S.mode, cur: S.cur, a: S.a, b: S.b });
  renderReadout();
  renderChips();
  if (S.mode === "grid") markGridCurrent();
  writeHash();
  prefetchNeighbors();
}

function currentPrefetchView() {
  const v = pair.view(), st = $("#stage");
  return { lng: v.c[0], lat: v.c[1], zoom: v.z, width: st.clientWidth, height: st.clientHeight };
}

const prefetchNeighbors = debounce(() => {
  if (S.mode !== "single" || !S.frames.length) return;
  const v = currentPrefetchView();
  for (const d of [1, -1]) {
    const f = S.frames[S.cur + d];
    if (f) prefetch(f, v);
  }
}, 400);

function setMode(m, { silent = false } = {}) {
  const prev = S.mode;
  if (S.ctx.kind === "overview" && m !== "single") { toast("Open a project or scan a spot first"); return; }
  if (m !== "single" && S.frames.length < 2 && !silent) { toast("Need at least two captures to compare"); return; }
  if (m === prev && !silent) return;
  stopPlay();
  const cmp = (x) => x !== "single" && x !== "grid";
  if (!cmp(prev) && cmp(m)) {
    S.b = S.cur;
    if (S.a >= S.b) S.a = S.b > 0 ? Math.min(defaultA(S.frames), S.b - 1) : 0;
    if (S.a === S.b && S.frames.length > 1) S.b = S.frames.length - 1;
  }
  if (cmp(prev) && !cmp(m)) S.cur = S.b;
  S.mode = m;
  pair.setMode(m);
  $$("#modes button").forEach((b) => b.setAttribute("aria-checked", b.dataset.mode === m));
  $("#gridView").hidden = m !== "grid";
  if (m === "grid") renderGrid();
  syncView(0);
  if (m === "swipe" && prev !== "swipe" && !silent) pair.sweep(1100);
}

function step(d, which) {
  const n = S.frames.length;
  if (!n) return;
  stopPlay();
  if (S.mode === "single" || S.mode === "grid") S.cur = clamp(S.cur + d, 0, n - 1);
  else if (which === "A") S.a = clamp(S.a + d, 0, n - 1);
  else S.b = clamp(S.b + d, 0, n - 1);
  syncView();
}

async function togglePlay() {
  if (S.playing) return stopPlay();
  if (S.frames.length < 2) return;
  if (S.mode !== "single") setMode("single");
  S.playing = true;
  playBtn();
  const token = (S.playToken = (S.playToken || 0) + 1);
  if (S.cur >= S.frames.length - 1) {
    S.cur = 0;
    syncView(250);
    await sleep(900);
  }
  while (S.playing && token === S.playToken && S.cur < S.frames.length - 1) {
    await Promise.race([prefetch(S.frames[S.cur + 1], currentPrefetchView()), sleep(2500)]);
    if (!S.playing || token !== S.playToken) break;
    S.cur++;
    syncView(450);
    await sleep(S.cur === S.frames.length - 1 ? 200 : 1250);
  }
  if (token === S.playToken) { S.playing = false; playBtn(); }
}
function stopPlay() {
  if (!S.playing) return;
  S.playing = false;
  S.playToken = (S.playToken || 0) + 1;
  playBtn();
}
function playBtn() {
  const b = $("#btnPlay");
  b.innerHTML = `<svg><use href="#i-${S.playing ? "pause" : "play"}"/></svg>`;
  b.setAttribute("aria-label", S.playing ? "Pause" : "Play");
}

function jumpToMilestone(m) {
  const i = S.frames.findIndex((f) => f.date >= m.d);
  const idx = i < 0 ? S.frames.length - 1 : i;
  if (S.mode === "single" || S.mode === "grid") S.cur = idx;
  else { S.b = idx; if (S.a >= S.b) S.a = Math.max(0, S.b - 1); }
  syncView();
  toast(`${fmtDate(m.d)} — ${m.t}. Showing the first capture after it.`);
}

// ------------------------------------------------------------------ readout & chips
function renderReadout() {
  const el = $("#readout");
  const n = S.frames.length;
  if (!n) {
    const st = S.ctx.kind === "spot" ? S.ctx.spot.status : null;
    if (st === "scanning" || st === "dating") el.innerHTML = `<span class="ro-date">Scanning…</span><span class="ro-sub">walking the archive for this spot</span>`;
    else if (st) el.innerHTML = `<span class="ro-date">No captures</span><span class="ro-sub">the archive has no imagery for this spot at this zoom — try zooming out</span>`;
    else el.innerHTML = "";
    return;
  }
  if (S.mode === "single" || S.mode === "grid") {
    const f = S.frames[S.cur];
    el.innerHTML = `<span class="ro-date">${esc(frameTitle(f))}</span><span class="ro-sub">${esc(f.sub)}</span><span class="ro-count">${S.cur + 1} / ${n}</span>`;
  } else {
    const fa = S.frames[S.a], fb = S.frames[S.b];
    const yrs = Math.abs(decYear(fb.date) - decYear(fa.date));
    const gap = yrs >= 1 ? `${yrs.toFixed(1)} years apart` : `${Math.round(yrs * 12)} months apart`;
    el.innerHTML = `<span class="ro-date"><span class="ca">${esc(frameShort(fa))}</span><span class="to">→</span><span class="cb">${esc(frameShort(fb))}</span></span><span class="ro-sub">${gap} · <b>Shift+←/→</b> moves A, <b>←/→</b> moves B</span>`;
  }
}

function renderChips() {
  const fa = S.frames[S.a], fb = S.frames[S.b];
  $("#chipA").innerHTML = fa ? `<i>A</i><b>${esc(frameTitle(fa))}</b>` : "";
  $("#chipB").innerHTML = fb ? `<i>B</i><b>${esc(frameTitle(fb))}</b>` : "";
}

// ------------------------------------------------------------------ thumbnails
const thumbCache = new Map();
function thumbFor(f, w, hgt, view) {
  let v = view;
  if (!v) {
    const pv = pair.view(), st = $("#stage");
    v = { lng: pv.c[0], lat: pv.c[1], zoom: pv.z + Math.log2(w / Math.max(320, st.clientWidth)) + 1.2 };
  }
  const key = `${f.src}${f.key}|${v.lng.toFixed(4)},${v.lat.toFixed(4)},${v.zoom.toFixed(2)}|${w}x${hgt}`;
  if (!thumbCache.has(key)) {
    thumbCache.set(key, renderToCanvas(f, { ...v, width: w, height: hgt }));
    if (thumbCache.size > 160) thumbCache.delete(thumbCache.keys().next().value);
  }
  return thumbCache.get(key).then((c) => {
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    copy.getContext("2d").drawImage(c, 0, 0);
    return copy;
  });
}

// ------------------------------------------------------------------ grid (contact sheet)
let gridObserver;
function renderGrid() {
  const g = $("#gridView");
  gridObserver?.disconnect();
  if (!S.frames.length) { g.innerHTML = `<div class="empty">No captures to show.</div>`; return; }
  const st = $("#stage");
  const pv = pair.view();
  const inner = h("div", { class: "grid-inner" });
  g.replaceChildren(inner);
  gridObserver = new IntersectionObserver((ents) => {
    for (const e of ents) {
      if (!e.isIntersecting) continue;
      gridObserver.unobserve(e.target);
      const i = +e.target.dataset.i;
      const box = e.target.querySelector(".cell-img");
      const w = box.clientWidth || 260, hh = box.clientHeight || 195;
      const zoom = pv.z + Math.log2(w / Math.max(320, st.clientWidth)) + 0.8;
      renderToCanvas(S.frames[i], { lng: pv.c[0], lat: pv.c[1], zoom, width: w, height: hh }).then((c) => box.append(c));
    }
  }, { root: g, rootMargin: "200px" });
  S.frames.forEach((f, i) => {
    const cell = h("button", { class: `cell${i === S.cur ? " is-cur" : ""}`, "data-i": i, title: "Open this capture" },
      h("div", { class: "cell-img" }),
      h("div", { class: "cell-cap" }, h("b", {}, frameTitle(f)), h("span", {}, f.src === "s2" ? "Sentinel-2 · 10 m" : f.sub.split(" · ").slice(0, 2).join(" · "))));
    cell.addEventListener("click", () => { S.cur = i; setMode("single"); });
    inner.append(cell);
    gridObserver.observe(cell);
  });
}
function markGridCurrent() {
  $$("#gridView .cell").forEach((c) => c.classList.toggle("is-cur", +c.dataset.i === S.cur));
}

// ------------------------------------------------------------------ map extras
function addProjectMarkers() {
  const m = pair.main;
  const fc = {
    type: "FeatureCollection",
    features: S.projects.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: p.focus || p.view.c },
      properties: { id: p.id, name: p.short, color: S.cats[p.cat]?.color || "#fff" },
    })),
  };
  m.addSource("projects", { type: "geojson", data: fc });
  m.addLayer({ id: "proj-halo", type: "circle", source: "projects", maxzoom: 9.5, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 9, 9, 16], "circle-color": ["get", "color"], "circle-opacity": 0.2 } });
  m.addLayer({ id: "proj-dot", type: "circle", source: "projects", maxzoom: 9.5, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4, 9, 7], "circle-color": ["get", "color"], "circle-stroke-color": "#07090c", "circle-stroke-width": 1.5 } });
  m.addLayer({ id: "proj-label", type: "symbol", source: "projects", minzoom: 4.6, maxzoom: 9.5,
    layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 11.5, "text-offset": [0, 1.1], "text-anchor": "top", "text-optional": true },
    paint: { "text-color": "#fff", "text-halo-color": "rgba(5,7,10,0.9)", "text-halo-width": 1.4 } });
  const pop = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: "240px" });
  for (const id of ["proj-halo", "proj-dot"]) {
    m.on("mouseenter", id, (e) => {
      if (S.measure) return;
      m.getCanvas().style.cursor = "pointer";
      const p = S.byId.get(e.features[0].properties.id);
      const rec = S.captures[p.id];
      pop.setLngLat(p.focus || p.view.c).setHTML(`<div class="pop-t">${esc(p.short)}</div><div class="pop-m">${esc(p.state)} · ${rec ? rec.frames.length + " captures" : ""}</div>`).addTo(m);
    });
    m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; pop.remove(); });
    m.on("click", id, (e) => { if (!S.measure) { pop.remove(); openProject(e.features[0].properties.id); } });
  }
}

function bindMapEvents() {
  for (const m of [pair.mapA, pair.mapB]) {
    m.on("click", (e) => { if (S.measure) addMeasurePoint([e.lngLat.lng, e.lngLat.lat]); });
    m.on("contextmenu", (e) => {
      if (S.measure) return;
      const ll = e.lngLat;
      const box = h("div", {},
        h("div", { class: "pop-t" }, fmtCoord([ll.lng, ll.lat])),
        h("div", { style: "display:flex;gap:6px;margin-top:8px" },
          h("button", { class: "btn btn-cyan", style: "height:32px;font-size:12.5px", onclick: () => { popup.remove(); scanHere(ll.lng, ll.lat, pair.view().z, { fly: true }); } }, "Scan history here"),
          h("button", { class: "btn", style: "height:32px;font-size:12.5px", onclick: () => { copy(`${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`); popup.remove(); } }, "Copy")));
      const popup = new maplibregl.Popup({ offset: 8, maxWidth: "280px" }).setLngLat(ll).setDOMContent(box).addTo(pair.main);
    });
  }
  pair.mapA.on("moveend", () => { updateLeavePill(); updateScanFab(); writeHash(); });
}

function updateLeavePill() {
  const pill = $("#leavePill");
  const v = pair.view();
  let show = false, label = "";
  if (S.ctx.kind === "project") {
    const d = haversineKm(v.c, S.ctx.p.focus || S.ctx.p.view.c);
    const kmPerPx = (40075 * Math.cos((v.c[1] * Math.PI) / 180)) / (512 * 2 ** v.z);
    show = d > kmPerPx * ($("#stage").clientWidth * 0.6) && v.z > 11;
    label = `You've left ${S.ctx.p.short} — scan this spot instead`;
  } else if (S.ctx.kind === "spot" && S.ctx.spot.status !== "scanning") {
    const d = haversineKm(v.c, [S.ctx.spot.lng, S.ctx.spot.lat]);
    const tileKm = (40075 * Math.cos((v.c[1] * Math.PI) / 180)) / 2 ** S.ctx.spot.z;
    show = d > tileKm * 1.2 && v.z > 11;
    label = "Scan the new spot under the crosshair";
  }
  pill.hidden = !show;
  pill.querySelector("span").textContent = label;
}

function updateScanFab() {
  $("#scanFab").hidden = !(S.tab === "explore" && S.ctx.kind !== "spot" && pair && pair.view().z >= 10);
}

// ------------------------------------------------------------------ measure
function toggleMeasure() {
  if (S.measure) return closeMeasure();
  S.measure = { pts: [] };
  $("#measureCard").hidden = false;
  $("#stage").classList.add("measuring");
  $("#btnMeasure").setAttribute("aria-pressed", "true");
  updateMeasure();
  toast("Measuring — click points on the map");
}
function closeMeasure(keep = false) {
  if (!S.measure) return;
  if (!keep) pair.setMeasure({ type: "FeatureCollection", features: [] });
  S.measure = null;
  $("#measureCard").hidden = true;
  $("#stage").classList.remove("measuring");
  $("#btnMeasure").setAttribute("aria-pressed", "false");
}
function addMeasurePoint(pt) { S.measure.pts.push(pt); updateMeasure(); }
function updateMeasure() {
  const pts = S.measure?.pts || [];
  const feats = pts.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: {} }));
  if (pts.length >= 2) feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: pts }, properties: {} });
  if (pts.length >= 3) feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] }, properties: {} });
  pair.setMeasure({ type: "FeatureCollection", features: feats });
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1], pts[i]);
  $("#mcDist").textContent = pts.length >= 2 ? fmtDist(km) : "—";
  $("#mcArea").textContent = pts.length >= 3 ? fmtArea(polygonAreaM2(pts)) : "—";
}

// ------------------------------------------------------------------ rail
function syncTabs() {
  $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
}

function renderRail() {
  syncTabs();
  const body = $("#railBody");
  let view;
  if (S.tab === "projects") view = S.view === "dossier" && S.ctx.kind === "project" ? dossier(S.ctx.p) : library();
  else if (S.tab === "explore") view = explorePanel();
  else view = watchPanel();
  body.replaceChildren(view);
  body.scrollTop = 0;
  $("#stage").classList.toggle("exploring", S.tab === "explore");
  updateScanFab();
}

let thumbObserver;
function library() {
  const wrap = h("div", {});
  const q = S.query.trim().toLowerCase();
  const list = S.projects.filter((p) => (!S.catFilter || p.cat === S.catFilter) &&
    (!q || `${p.name} ${p.short} ${p.state} ${S.cats[p.cat].label} ${p.stat}`.toLowerCase().includes(q)));

  if (!q) {
    const total = S.projects.reduce((s, p) => s + (S.captures[p.id]?.frames.length || 0), 0);
    wrap.append(h("div", { class: "sec-h" }, h("h3", {}, "Megaprojects"), h("span", {}, `${S.projects.length} sites · ${total} captures`)));
    const cats = h("div", { class: "cats" },
      h("button", { class: "cat-chip", "aria-pressed": !S.catFilter, onclick: () => { S.catFilter = null; renderRail(); } }, "All"),
      ...Object.entries(S.cats).map(([k, c]) =>
        h("button", { class: "cat-chip", "aria-pressed": S.catFilter === k, onclick: () => { S.catFilter = S.catFilter === k ? null : k; renderRail(); } },
          h("span", { class: "dot", style: `--c:${c.color}` }), c.label)));
    wrap.append(cats);
  } else {
    wrap.append(h("div", { class: "sec-h" }, h("h3", {}, "Projects"), h("span", {}, `${list.length} match${list.length === 1 ? "" : "es"}`)));
  }

  thumbObserver?.disconnect();
  thumbObserver = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) { thumbObserver.unobserve(e.target); drawCardThumb(e.target); }
  }, { root: $("#railBody"), rootMargin: "120px" });

  const cards = h("div", { class: "cards" });
  for (const p of list) {
    const rec = projectRecord(p.id);
    const fr = p.src === "s2" ? s2Frames() : hiresFrames(rec?.frames || []);
    const y0 = fr[0] ? String(fr[0].date).slice(0, 4) : "", y1 = fr.length ? String(fr[fr.length - 1].date).slice(0, 4) : "";
    const isNew = (S.fresh[p.id]?.frames?.length || 0) > 0;
    const card = h("button", { class: `card${S.ctx.kind === "project" && S.ctx.p.id === p.id ? " is-on" : ""}`, "data-id": p.id, onclick: () => openProject(p.id) },
      h("div", { class: "thumb" }, h("div", { class: "thumb-yrs" }, h("span", {}, y0), h("span", {}, y1))),
      h("div", {},
        h("div", { class: "card-t" }, p.short, " ", isNew ? h("span", { class: "new-flag" }, "NEW") : null),
        h("div", { class: "card-m" }, h("span", { class: "dot", style: `--c:${S.cats[p.cat].color}` }), p.state, h("span", { class: "n" }, p.src === "s2" ? "· Sentinel-2" : `· ${fr.length} captures`))));
    cards.append(card);
    thumbObserver.observe(card);
  }
  wrap.append(cards);

  if (q) {
    const places = h("div", { class: "results-places" }, h("div", { class: "scan-status" }, "Searching places…"));
    wrap.append(h("div", { class: "sec-h" }, h("h3", {}, "Places"), h("span", {}, "scan any of these")), places);
    searchPlaces(S.query, places);
  } else {
    wrap.append(h("p", { class: "note" }, "Pick a project to swipe between its oldest and newest satellite captures, or open ", h("b", {}, "Explore"), " to scan any spot on Earth."));
  }
  return wrap;
}

function drawCardThumb(card) {
  const p = S.byId.get(card.dataset.id);
  const box = card.querySelector(".thumb");
  const fr = p.src === "s2" ? s2Frames() : hiresFrames(projectRecord(p.id)?.frames || []);
  if (fr.length < 1) return;
  const v = { lng: (p.focus || p.view.c)[0], lat: (p.focus || p.view.c)[1], zoom: p.view.z - 1.6, width: 96, height: 70 };
  const fa = fr[defaultA(fr)], fb = fr[fr.length - 1];
  Promise.all([renderToCanvas(fb, v), renderToCanvas(fa, v)]).then(([cb, ca]) => {
    cb.className = "t-b";
    ca.className = "t-a";
    box.prepend(cb, ca);
  });
}

const searchPlaces = debounce(async (q, box) => {
  const coord = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  const rows = [];
  if (coord) {
    let [lat, lng] = [+coord[1], +coord[2]];
    if (Math.abs(lat) > 90) [lat, lng] = [lng, lat];
    rows.push({ name: fmtCoord([lng, lat]), sub: "Coordinates", lng, lat, z: 16 });
  } else {
    try {
      const j = await fetch(`${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&lat=22.5&lon=79`).then((r) => r.json());
      for (const f of j.features || []) {
        const p = f.properties, [lng, lat] = f.geometry.coordinates;
        const ext = p.extent;
        let z = 15;
        if (ext) z = clamp(Math.log2(360 / Math.max(0.0005, Math.abs(ext[2] - ext[0]))) - 0.2, 8, 16.5);
        else if (["city", "state", "country", "county", "district"].includes(p.type)) z = p.type === "city" ? 11.5 : 8;
        rows.push({ name: p.name || q, sub: [p.city, p.state, p.country].filter(Boolean).filter((v) => v !== p.name).join(", "), lng, lat, z });
      }
    } catch {
      box.replaceChildren(h("div", { class: "scan-status" }, "Place search is unavailable right now."));
      return;
    }
  }
  if (!rows.length) { box.replaceChildren(h("div", { class: "scan-status" }, "No places found.")); return; }
  box.replaceChildren(...rows.map((r) =>
    h("button", { class: "place-row", onclick: () => { pair.flyTo({ c: [r.lng, r.lat], z: r.z }); S.tab = "explore"; renderRail(); setTimeout(() => scanHere(r.lng, r.lat, r.z, { name: r.name }), 900); } },
      h("span", { html: `<svg><use href="#i-scan"/></svg>` }), h("div", {}, h("b", {}, r.name), h("span", {}, r.sub)))));
}, 320);

function dossier(p) {
  const rec = projectRecord(p.id);
  const hf = hiresFrames(rec?.frames || []);
  const cat = S.cats[p.cat];
  const wrap = h("div", {});
  wrap.append(h("button", { class: "d-back", onclick: () => { S.view = "library"; renderRail(); } }, h("span", { html: `<svg><use href="#i-back"/></svg>` }), "All projects"));
  wrap.append(h("div", { class: "d-cat" }, h("span", { class: "dot", style: `--c:${cat.color}` }), `${cat.label} · ${p.state}`));
  wrap.append(h("h2", { class: "d-title" }, p.name));
  wrap.append(h("p", { class: "d-stat" }, p.stat));
  const bestRes = hf.map((f) => (f.sub.match(/(\d+) cm/) || [])[1]).filter(Boolean).map(Number);
  wrap.append(h("div", { class: "facts" },
    fact("Status", p.status), fact("Cost", p.cost || "—"),
    fact(p.src === "s2" ? "Hi-res captures" : "Captures", hf.length ? `${hf.length} · ${frameShort(hf[0])} → ${frameShort(hf[hf.length - 1])}` : "—"),
    fact("Sharpest", bestRes.length ? `${Math.min(...bestRes)} cm per pixel` : "—")));
  const watching = isWatched(`p:${p.id}`);
  wrap.append(h("div", { class: "actions" },
    h("button", { class: "btn", "aria-pressed": watching, onclick: (e) => { toggleWatch({ kind: "project", id: p.id }); e.currentTarget.setAttribute("aria-pressed", isWatched(`p:${p.id}`)); } }, h("span", { html: `<svg><use href="#i-star"/></svg>` }), watching ? "Watching" : "Watch"),
    h("button", { class: "btn", onclick: openExport }, h("span", { html: `<svg><use href="#i-export"/></svg>` }), "Export"),
    h("button", { class: "btn", onclick: shareLink }, h("span", { html: `<svg><use href="#i-link"/></svg>` }), "Share")));
  wrap.append(h("p", { class: "d-summary" }, p.summary));
  if (p.watch) wrap.append(h("div", { class: "callout" }, h("b", {}, "What to look for"), p.watch));
  if (p.milestones?.length) {
    wrap.append(h("div", { class: "sec-h" }, h("h3", {}, "Milestones"), h("span", {}, "click to jump")));
    const today = new Date().toISOString().slice(0, 10);
    wrap.append(h("ul", { class: "ms-list" }, ...p.milestones.map((m) =>
      h("li", { class: m.d > today ? "future" : "" }, h("button", { onclick: () => jumpToMilestone(m) }, h("span", { class: "ms-dot" }), h("span", {}, h("span", { class: "ms-d" }, fmtDate(m.d)), h("span", { class: "ms-t" }, m.t)))))));
  }
  const newsBox = h("div", { class: "news" }, h("div", { class: "scan-status" }, "Loading headlines…"));
  wrap.append(h("div", { class: "sec-h" }, h("h3", {}, "In the news"), h("span", {}, "via Infra Atlas")), newsBox);
  fillNews(newsBox, { kw: p.kw });
  wrap.append(h("p", { class: "note" }, "Facts are compiled from public reporting and may lag events. Imagery dates are the satellite acquisition dates reported by Esri for this spot."));
  return wrap;
}

const fact = (k, v) => h("div", { class: "fact" }, h("div", { class: "fact-k" }, k), h("div", { class: "fact-v" }, v));

function explorePanel() {
  const wrap = h("div", {});
  if (S.ctx.kind === "spot") {
    const s = S.ctx.spot;
    wrap.append(h("div", { class: "d-cat" }, h("span", { class: "dot", style: "--c:var(--b)" }), "Explore · any spot"));
    wrap.append(h("h2", { class: "d-title" }, s.name || "This spot"));
    wrap.append(h("p", { class: "coords" }, fmtCoord([s.lng, s.lat]), ` · tile z${s.z}`));
    const statusBox = h("div", { id: "scanBox" });
    wrap.append(statusBox);
    const watching = isWatched(spotKey(s));
    wrap.append(h("div", { class: "actions", style: "margin-top:14px" },
      h("button", { class: "btn", "aria-pressed": watching, disabled: s.status !== "done", onclick: (e) => { toggleWatch({ kind: "spot", spot: s }); e.currentTarget.setAttribute("aria-pressed", isWatched(spotKey(s))); } }, h("span", { html: `<svg><use href="#i-star"/></svg>` }), watching ? "Watching" : "Watch spot"),
      h("button", { class: "btn", disabled: s.status !== "done" || S.frames.length < 1, onclick: openExport }, h("span", { html: `<svg><use href="#i-export"/></svg>` }), "Export"),
      h("button", { class: "btn", onclick: shareLink }, h("span", { html: `<svg><use href="#i-link"/></svg>` }), "Share")));
    wrap.append(h("button", { class: "btn btn-block", style: "margin-top:8px", onclick: () => { const v = pair.view(); scanHere(v.c[0], v.c[1], v.z); } }, h("span", { html: `<svg><use href="#i-scan"/></svg>` }), "Rescan at the crosshair"));
    const near = S.projects.map((p) => [p, haversineKm([s.lng, s.lat], p.focus || p.view.c)]).filter(([, d]) => d < 60).sort((x, y) => x[1] - y[1]).slice(0, 3);
    if (near.length) {
      wrap.append(h("div", { class: "sec-h" }, h("h3", {}, "Curated projects nearby")));
      wrap.append(h("div", { class: "news" }, ...near.map(([p, d]) => h("a", { href: "#", onclick: (e) => { e.preventDefault(); openProject(p.id); } }, h("div", { class: "n-t" }, p.short), h("div", { class: "n-m" }, `${fmtDist(d)} away · ${S.cats[p.cat].label}`)))));
    }
    const newsBox = h("div", { class: "news" });
    wrap.append(h("div", { class: "sec-h" }, h("h3", {}, "Stories pinned near here"), h("span", {}, "via Infra Atlas")), newsBox);
    fillNews(newsBox, { near: [s.lng, s.lat], km: 12 });
    queueMicrotask(renderScanStatus);
    return wrap;
  }
  wrap.append(h("div", { class: "explore-hero" },
    h("h4", {}, "Scan any spot on Earth"),
    h("p", {}, "Pan the map so the crosshair sits on the place you care about — a metro depot, your hometown's new bypass, a plot you're buying — then scan. Groundtruth walks all of Esri's archive releases and lists every distinct satellite capture of that exact spot, dated to the day."),
    h("button", { class: "btn btn-cyan btn-block", onclick: () => { const v = pair.view(); if (v.z < 10) { toast("Zoom in closer first (city level or nearer)"); return; } scanHere(v.c[0], v.c[1], v.z); } }, h("span", { html: `<svg><use href="#i-scan"/></svg>` }), "Scan the spot under the crosshair")));
  wrap.append(h("div", { class: "sec-h" }, h("h3", {}, "Tips")));
  wrap.append(h("ul", { class: "small muted", style: "margin:0;padding-left:18px;line-height:1.7" },
    h("li", {}, "Zoom in further to scan a small plot; zoom out to catch changes across a whole neighbourhood."),
    h("li", {}, "Search a place above, or right-click anywhere on the map → ", h("b", {}, "Scan history here"), "."),
    h("li", {}, "Star a spot to ", h("b", {}, "watch"), " it: Groundtruth flags new captures each time Esri publishes a release.")));
  return wrap;
}

function renderScanStatus() {
  const box = $("#scanBox");
  const s = S.ctx.kind === "spot" ? S.ctx.spot : null;
  if (!box || !s) return;
  let msg = "";
  if (s.status === "scanning") msg = `Walking the archive… ${s.found} version${s.found === 1 ? "" : "s"} found${s.reached ? `, back to ${s.reached.slice(0, 4)}` : ""}`;
  else if (s.status === "dating") msg = `Found ${s.frames.length} captures — fetching acquisition dates and sensors…`;
  else if (s.status === "done") msg = `${s.frames.length} distinct captures · ${s.frames.length ? `${fmtMonth(s.frames[0].cd || s.frames[0].rd)} → ${fmtMonth(s.frames[s.frames.length - 1].cd || s.frames[s.frames.length - 1].rd)}` : ""}`;
  else if (s.status === "error") msg = `Scan failed: ${s.error || "archive unavailable"}`;
  const pct = s.status === "done" ? 100 : s.status === "dating" ? 92 : Math.round((s.progress || 0) * 88);
  box.replaceChildren(h("div", { class: "scan-status" }, msg), h("div", { class: "scan-bar" }, h("i", { style: `width:${pct}%` })));
}

// ------------------------------------------------------------------ watchlist
const spotKey = (s) => `s:${s.lat.toFixed(5)},${s.lng.toFixed(5)},${s.z}`;
const isWatched = (key) => S.watch.some((w) => w.key === key);

function toggleWatch(what) {
  const key = what.kind === "project" ? `p:${what.id}` : spotKey(what.spot);
  if (isWatched(key)) {
    S.watch = S.watch.filter((w) => w.key !== key);
    toast("Removed from your watchlist");
  } else {
    const newest = S.releases?.[S.releases.length - 1]?.date || S.bakedLatest;
    if (what.kind === "project") {
      const p = S.byId.get(what.id);
      S.watch.push({ key, kind: "project", id: p.id, name: p.short, latest: newest, unseen: 0, added: new Date().toISOString().slice(0, 10) });
    } else {
      const s = what.spot;
      S.watch.push({ key, kind: "spot", name: s.name || fmtCoord([s.lng, s.lat]), lng: s.lng, lat: s.lat, z: s.z, frames: s.frames, latest: s.latest || newest, unseen: 0, added: new Date().toISOString().slice(0, 10) });
    }
    toast("Watching — new satellite captures will be flagged here");
  }
  store.set("gt.watch", S.watch);
  renderWatchBadge();
}

function markSeen(key) {
  const w = S.watch.find((x) => x.key === key);
  if (w && w.unseen) { w.unseen = 0; store.set("gt.watch", S.watch); renderWatchBadge(); }
}

function renderWatchBadge() {
  const n = S.watch.reduce((s, w) => s + (w.unseen || 0), 0);
  const b = $("#watchBadge");
  b.hidden = !n;
  b.textContent = n;
}

async function checkWatchlist() {
  const releases = S.releases;
  if (!releases || !S.watch.length) return renderWatchBadge();
  const newest = releases[releases.length - 1].date;
  await pool(S.watch.map((w) => async () => {
    if (!w.latest || newest <= w.latest) return;
    try {
      let lng, lat, z, known;
      if (w.kind === "project") {
        const p = S.byId.get(w.id), rec = S.captures[w.id];
        if (!p || !rec) return;
        [lng, lat] = p.focus || p.view.c;
        z = rec.z;
        known = new Set(projectRecord(w.id).frames.map((f) => f.r));
      } else {
        ({ lng, lat, z } = w);
        known = new Set((w.frames || []).map((f) => f.r));
      }
      const { x, y } = lngLatToTile(lng, lat, z);
      const vs = (await scanTile({ releases, z, x, y, stopBefore: w.latest })).filter((v) => !known.has(v.r));
      if (vs.length) {
        const fr = toFrames(await describeVersions({ releases, versions: vs, lng, lat, z: Math.max(z, 16) }), releases);
        if (w.kind === "spot") w.frames = [...(w.frames || []), ...fr];
        else S.fresh[w.id] = { latest: newest, frames: [...(S.fresh[w.id]?.frames || []), ...fr] };
        w.unseen = (w.unseen || 0) + fr.length;
      }
      w.latest = newest;
    } catch {}
  }), 3);
  store.set("gt.watch", S.watch);
  store.set("gt.fresh", S.fresh);
  renderWatchBadge();
  if (S.tab === "watch") renderRail();
}

function watchPanel() {
  const wrap = h("div", {});
  wrap.append(h("div", { class: "sec-h" }, h("h3", {}, "Your watchlist"), h("span", {}, `${S.watch.length} saved`)));
  if (!S.watch.length) {
    wrap.append(h("div", { class: "empty" }, h("div", { html: `<svg><use href="#i-star"/></svg>` }),
      h("div", {}, "Star a project or any scanned spot. Each time Esri publishes a new archive release, Groundtruth checks your spots and flags fresh satellite captures here.")));
    return wrap;
  }
  for (const w of S.watch) {
    const open = () => {
      w.unseen = 0;
      store.set("gt.watch", S.watch);
      renderWatchBadge();
      if (w.kind === "project") openProject(w.id);
      else openSavedSpot(w);
    };
    const count = w.kind === "project" ? projectRecord(w.id)?.frames.length || 0 : (w.frames || []).length;
    wrap.append(h("div", { class: "watch-item" },
      h("button", { class: "wi-open", onclick: open },
        h("div", { class: "wi-t" }, w.name, " ", w.unseen ? h("span", { class: "new-flag" }, `${w.unseen} NEW`) : null),
        h("div", { class: "wi-m" }, `${w.kind === "project" ? "Project" : "Spot"} · ${count} captures · checked through ${fmtMonth(w.latest)}`)),
      h("button", { class: "icon-btn", title: "Remove", "aria-label": `Remove ${w.name}`, onclick: () => { S.watch = S.watch.filter((x) => x !== w); store.set("gt.watch", S.watch); renderWatchBadge(); renderRail(); } }, h("span", { html: `<svg><use href="#i-close"/></svg>` }))));
  }
  wrap.append(h("p", { class: "note" }, "Your watchlist lives only in this browser. Esri publishes a new archive release roughly once a month."));
  return wrap;
}

function openSavedSpot(w) {
  stopPlay();
  const spot = { lng: w.lng, lat: w.lat, z: w.z, name: w.name, frames: w.frames || [], status: "done", latest: w.latest };
  S.scan?.ac.abort();
  S.ctx = { kind: "spot", spot };
  S.src = "hires";
  S.tab = "explore";
  const frames = hiresFrames(spot.frames);
  setFrames(frames, { a: defaultA(frames), b: frames.length - 1 });
  pair.flyTo({ c: [w.lng, w.lat], z: w.z - 1 });
  setMode(frames.length > 1 ? "swipe" : "single", { silent: true });
  applyCtx();
  renderRail();
}

// ------------------------------------------------------------------ news (from India Infra Atlas)
async function loadNews() {
  if (S.news) return S.news;
  newsP ||= fetch("../infra-atlas/data/news.json").then((r) => r.json()).catch(() => []);
  S.news = await newsP;
  return S.news;
}

async function fillNews(box, { kw, near, km = 10 }) {
  const items = await loadNews();
  let hits = [];
  if (kw) {
    const re = new RegExp(kw, "i");
    hits = items.filter((it) => re.test(it.title));
  } else if (near) {
    hits = items.filter((it) => it.location?.lat != null && haversineKm(near, [it.location.lng, it.location.lat]) <= km);
  }
  hits.sort((x, y) => y.date.localeCompare(x.date));
  if (!hits.length) {
    box.replaceChildren(h("div", { class: "scan-status" }, kw ? "No recent headlines in the Atlas feed." : "No Atlas stories pinned within a few km."));
    return;
  }
  box.replaceChildren(...hits.slice(0, 5).map((it) => {
    const src = it.sources?.[0];
    return h("a", { href: src?.url || "../infra-atlas/", target: "_blank", rel: "noopener" },
      h("div", { class: "n-t" }, it.title), h("div", { class: "n-m" }, `${fmtDate(it.date)}${src?.name ? " · " + src.name : ""}`));
  }));
}

// ------------------------------------------------------------------ export
const EXPORT = { tab: "video", aspect: "16:9", size: 1080, hold: 1.1, fade: 0.5, captions: true, range: "all" };

function exportMeta() {
  if (S.ctx.kind === "project") {
    const p = S.ctx.p;
    return { title: p.name, place: `${p.state} · ${S.cats[p.cat].label}`, milestones: p.milestones, id: p.id };
  }
  const s = S.ctx.spot || {};
  return { title: s.name || "Groundtruth", place: s.lat != null ? fmtCoord([s.lng, s.lat]) : "", milestones: [], id: slug(s.name || "spot") };
}

function outSize() {
  const long = EXPORT.size === 1080 ? 1920 : 1280, short = EXPORT.size;
  if (EXPORT.aspect === "16:9") return [long, short];
  if (EXPORT.aspect === "9:16") return [short, long];
  return [short, short];
}

function openExport() {
  if (S.frames.length < 1) { toast("Open a project or scan a spot first"); return; }
  stopPlay();
  closeMeasure(true);
  const body = h("div", {});
  const render = () => {
    body.replaceChildren(
      h("h2", { id: "modalTitle" }, "Export"),
      h("p", { class: "lede" }, "Rendered straight from the imagery archive, framed on your current view (centre crop). Nothing is uploaded anywhere."),
      h("div", { class: "seg ex-tabs", role: "radiogroup" }, ...[["video", "Timelapse video"], ["still", "Image"], ["pair", "Before / after"], ["sheet", "Contact sheet"]].map(([k, l]) =>
        h("button", { role: "radio", "aria-checked": EXPORT.tab === k, onclick: () => { EXPORT.tab = k; render(); } }, l))),
      ...exportOptions(render),
      h("div", { class: "progress", hidden: true }, h("i")),
      h("div", { class: "ex-status" }),
      h("div", { class: "ex-preview", hidden: true }),
      h("div", { class: "ex-actions" },
        h("button", { class: "btn", "data-close": "" }, "Close"),
        h("button", { class: "btn btn-accent", id: "exGo", onclick: () => runExport(body) }, h("span", { html: `<svg><use href="#i-export"/></svg>` }), EXPORT.tab === "video" ? "Render video" : "Render image")));
  };
  render();
  openModal(body, () => S.exportAbort?.abort());
}

function exportOptions(rerender) {
  const seg = (key, opts) => h("div", { class: "seg", role: "radiogroup" }, ...opts.map(([v, l]) =>
    h("button", { role: "radio", "aria-checked": String(EXPORT[key]) === String(v), onclick: () => { EXPORT[key] = v; rerender(); } }, l)));
  const rows = [];
  if (EXPORT.tab !== "sheet") {
    rows.push(h("div", { class: "opt-row" }, h("label", {}, "Shape"), seg("aspect", [["16:9", "16:9 · YouTube"], ["9:16", "9:16 · Shorts / Reels"], ["1:1", "1:1 · Square"]])));
    rows.push(h("div", { class: "opt-row" }, h("label", {}, "Resolution"), seg("size", [[720, "720p"], [1080, "1080p"]])));
  }
  if (EXPORT.tab === "video") {
    const cmp = S.mode !== "single" && S.mode !== "grid";
    rows.push(h("div", { class: "opt-row" }, h("label", {}, "Captures"), seg("range", [["all", `All ${S.frames.length}`], ["ab", cmp ? `A → B (${Math.abs(S.b - S.a) + 1})` : "A → B (compare modes)"]])));
    const slider = (key, min, max, stepv, unit) => {
      const out = h("output", {}, `${EXPORT[key]}${unit}`);
      return h("div", { class: "opt-inline" }, h("input", { type: "range", min, max, step: stepv, value: EXPORT[key], oninput: (e) => { EXPORT[key] = +e.target.value; out.textContent = `${EXPORT[key]}${unit}`; } }), out);
    };
    rows.push(h("div", { class: "opt-row" }, h("label", {}, "Hold each"), slider("hold", 0.4, 3, 0.1, " s")));
    rows.push(h("div", { class: "opt-row" }, h("label", {}, "Crossfade"), slider("fade", 0, 1.2, 0.1, " s")));
  }
  if (EXPORT.tab === "video" || EXPORT.tab === "still") {
    rows.push(h("div", { class: "opt-row" }, h("label", {}, "Overlay"), h("div", {},
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: EXPORT.captions, onchange: (e) => (EXPORT.captions = e.target.checked) }), "Milestone captions"))));
  }
  return rows;
}

async function runExport(body) {
  const go = $("#exGo", body), bar = $(".progress", body), status = $(".ex-status", body), prev = $(".ex-preview", body);
  go.disabled = true;
  bar.hidden = false;
  prev.hidden = true;
  const setP = (p, msg) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; if (msg) status.textContent = msg; };
  const ac = (S.exportAbort = new AbortController());
  const st = $("#stage");
  const mv = pair.view();
  const vp = { w: st.clientWidth, h: st.clientHeight };
  const meta = exportMeta();
  const [W, H] = outSize();
  const view = EX.exportView(mv, vp, W, H);
  const cmp = S.mode !== "single" && S.mode !== "grid";
  const base = `groundtruth-${meta.id}`;
  try {
    let blob, name, isVideo = false;
    if (EXPORT.tab === "video") {
      let frames = S.frames;
      if (EXPORT.range === "ab" && cmp) frames = S.frames.slice(Math.min(S.a, S.b), Math.max(S.a, S.b) + 1);
      if (frames.length < 2) throw new Error("Need at least two captures for a timelapse");
      const r = await EX.exportTimelapse({ frames, view, meta, hold: EXPORT.hold, fade: EXPORT.fade, captions: EXPORT.captions, onProgress: setP, signal: ac.signal });
      blob = r.blob;
      name = `${base}-${frameShort(frames[0]).replace(" ", "")}-${frameShort(frames[frames.length - 1]).replace(" ", "")}-${EXPORT.aspect.replace(":", "x")}.${r.ext}`;
      isVideo = true;
    } else if (EXPORT.tab === "still") {
      setP(0.3, "Rendering…");
      const f = cmp ? S.frames[S.b] : S.frames[S.cur];
      blob = await EX.exportStill({ frame: f, frames: S.frames, view, meta, captions: EXPORT.captions });
      name = `${base}-${slug(frameTitle(f))}.png`;
    } else if (EXPORT.tab === "pair") {
      setP(0.3, "Rendering before & after…");
      const a = cmp ? S.frames[S.a] : S.frames[defaultA(S.frames)], b = cmp ? S.frames[S.b] : S.frames[S.frames.length - 1];
      blob = await EX.exportBeforeAfter({ a, b, view, meta });
      name = `${base}-before-after.png`;
    } else {
      setP(0.05, "Rendering contact sheet…");
      blob = await EX.exportContactSheet({ frames: S.frames, mapView: mv, viewport: vp, meta, onProgress: (p) => setP(p, "Rendering contact sheet…") });
      name = `${base}-contact-sheet.png`;
    }
    setP(1, `Ready · ${(blob.size / 1e6).toFixed(1)} MB`);
    const url = URL.createObjectURL(blob);
    prev.replaceChildren(isVideo ? h("video", { src: url, controls: true, autoplay: true, loop: true, muted: true, playsinline: true }) : h("img", { src: url, alt: "Export preview" }));
    prev.hidden = false;
    go.disabled = false;
    go.replaceChildren(h("span", { html: `<svg><use href="#i-export"/></svg>` }), `Download ${isVideo ? name.split(".").pop().toUpperCase() : "PNG"}`);
    go.onclick = () => download(blob, name);
    window.__gtLastExport = { blob, name };
  } catch (e) {
    if (e.name === "AbortError") return;
    status.textContent = e.message || "Export failed";
    go.disabled = false;
  }
}

// ------------------------------------------------------------------ modal, toast, share
function openModal(content, onClose) {
  const m = $("#modal");
  $("#modalBody").replaceChildren(content);
  m.hidden = false;
  m._onClose = onClose;
  setTimeout(() => m.querySelector("button")?.focus(), 30);
}
function closeModal() {
  const m = $("#modal");
  if (m.hidden) return;
  m.hidden = true;
  m._onClose?.();
}

let toastT;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("is-on");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("is-on"), 3200);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); }
  catch { window.prompt("Copy this:", text); }
}

function shareLink() {
  writeHashNow();
  copy(location.href);
}

function openHelp() {
  const keys = [["← / →", "Previous / next capture (moves B in compare)"], ["Shift + ← / →", "Move A in compare modes"], ["Space", "Play timelapse"], ["1 – 6", "Single · Swipe · Lens · Split · Blink · Sheet"], ["T", "3D terrain"], ["L", "Labels"], ["M", "Measure"], ["E", "Export"], ["/", "Search"], ["Shift + scroll", "Resize the lens"]];
  openModal(h("div", { class: "help" },
    h("h2", { id: "modalTitle" }, "How Groundtruth works"),
    h("p", { class: "lede" }, "A time machine for places that are being built."),
    h("p", {}, "Esri republishes its World Imagery basemap about once a month and keeps every release since February 2014. For any spot, Groundtruth walks that chain of releases backwards and keeps only the ones where the pixels actually changed — each one is a new satellite pass. It then asks Esri's metadata service for the real acquisition date, satellite and resolution, which is why some captures predate 2014."),
    h("p", {}, "For huge sites (solar parks, new cities) switch to ", h("b", {}, "Sentinel-2"), ": one cloud-free mosaic per year at 10 m, 2016 onward."),
    h("h3", {}, "Keyboard"),
    h("div", { class: "help-grid" }, ...keys.map(([k, v]) => h("div", {}, h("span", {}, v), h("kbd", {}, k)))),
    h("h3", {}, "Sources & credits"),
    h("p", { class: "small" }, "High-resolution imagery: Esri World Imagery Wayback (Maxar/Vantor, Earthstar Geographics and others). Annual mosaics: Sentinel-2 cloudless by EOX IT Services, containing modified Copernicus Sentinel data (CC BY-NC-SA 4.0; 2016 CC BY 4.0). Labels: © OpenStreetMap contributors via OpenFreeMap. Elevation: AWS Terrain Tiles. Place search: Photon by Komoot. Headlines: India Infra Atlas feed. Project facts are compiled from public reporting and may contain errors — check official sources before relying on them."),
    h("p", { class: "small muted" }, "Built by Vivek Modi as part of ", h("a", { href: "/demos/" }, "viper-vm.github.io/demos"), ".")));
}

// ------------------------------------------------------------------ URL state
function writeHashNow() {
  const p = new URLSearchParams();
  const v = pair?.view();
  if (S.ctx.kind === "project") {
    p.set("p", S.ctx.p.id);
    if (S.src !== (S.ctx.p.src || "hires")) p.set("src", S.src);
  } else if (S.ctx.kind === "spot") {
    const s = S.ctx.spot;
    p.set("spot", `${s.lat.toFixed(5)},${s.lng.toFixed(5)},${s.z}`);
  }
  if (S.ctx.kind !== "overview" && S.frames.length) {
    p.set("m", S.mode);
    if (S.mode === "single" || S.mode === "grid") p.set("f", S.frames[S.cur]?.key);
    else { p.set("a", S.frames[S.a]?.key); p.set("b", S.frames[S.b]?.key); }
  }
  if (v && S.ctx.kind !== "overview") p.set("v", `${v.c[1].toFixed(5)},${v.c[0].toFixed(5)},${v.z.toFixed(2)}`);
  const str = p.toString();
  history.replaceState(null, "", str ? `#${str}` : location.pathname + location.search);
}
const writeHash = debounce(writeHashNow, 250);

function route() {
  const p = new URLSearchParams(location.hash.slice(1));
  const v = p.get("v")?.split(",").map(Number);
  const view = v?.length === 3 && v.every(Number.isFinite) ? { c: [v[1], v[0]], z: v[2] } : null;
  const opts = { mode: p.get("m") || undefined, a: p.get("a"), b: p.get("b"), f: p.get("f"), src: p.get("src") || undefined, v: view, jump: true };
  if (p.get("p") && S.byId.has(p.get("p"))) { openProject(p.get("p"), opts); return true; }
  const sp = p.get("spot")?.split(",").map(Number);
  if (sp?.length === 3 && sp.every(Number.isFinite)) {
    pair.jumpTo(view || { c: [sp[1], sp[0]], z: sp[2] - 1 });
    scanHere(sp[1], sp[0], sp[2] - 1, opts);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ UI wiring
function bindUI() {
  $$("#modes button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $$("#srcToggle button").forEach((b) => b.addEventListener("click", () => setSource(b.dataset.src)));
  $("#btnPrev").addEventListener("click", () => step(-1));
  $("#btnNext").addEventListener("click", () => step(1));
  $("#btnPlay").addEventListener("click", togglePlay);
  $("#btn3d").addEventListener("click", (e) => { const on = !pair.terrain; pair.setTerrain(on); e.currentTarget.setAttribute("aria-pressed", on); if (on) toast("3D terrain — right-drag or Ctrl+drag to tilt and rotate"); });
  $("#btnLabels").addEventListener("click", (e) => { const on = !pair.labels; pair.setLabels(on); e.currentTarget.setAttribute("aria-pressed", on); });
  $("#btnMeasure").addEventListener("click", toggleMeasure);
  $("#btnExport").addEventListener("click", openExport);
  $("#btnShare").addEventListener("click", shareLink);
  $("#btnHelp").addEventListener("click", openHelp);
  $("#mcUndo").addEventListener("click", () => { S.measure?.pts.pop(); updateMeasure(); });
  $("#mcClear").addEventListener("click", () => { if (S.measure) { S.measure.pts = []; updateMeasure(); } });
  $("#mcDone").addEventListener("click", () => closeMeasure(true));
  $("#leavePill").addEventListener("click", () => { const v = pair.view(); scanHere(v.c[0], v.c[1], v.z); });
  $("#scanFab").addEventListener("click", () => { const v = pair.view(); scanHere(v.c[0], v.c[1], v.z); });
  $("#railToggle").addEventListener("click", () => setRail(false));
  $("#showRail").addEventListener("click", () => setRail($("#app").classList.contains("rail-collapsed")));
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => {
    S.tab = b.dataset.tab;
    if (S.tab === "projects" && S.ctx.kind === "project") S.view = "dossier";
    renderRail();
    applyCtx();
  }));
  const q = $("#q");
  q.addEventListener("input", debounce(() => { S.query = q.value; S.tab = "projects"; S.view = "library"; renderRail(); }, 120));
  q.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const first = $("#railBody .card, #railBody .place-row"); first?.click(); }
    if (e.key === "Escape") { q.value = ""; S.query = ""; renderRail(); q.blur(); }
  });
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal(); });

  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (e.key === "Escape") { if (!$("#modal").hidden) closeModal(); else if (S.measure) closeMeasure(true); return; }
    if (typing || e.metaKey || e.ctrlKey) return;
    if (!$("#modal").hidden) return;
    const k = e.key.toLowerCase();
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (document.activeElement?.classList.contains("swipe")) return;
      e.preventDefault();
      step(e.key === "ArrowLeft" ? -1 : 1, e.shiftKey ? "A" : "B");
    } else if (e.key === " ") { e.preventDefault(); togglePlay(); }
    else if (/^[1-6]$/.test(e.key)) setMode(["single", "swipe", "lens", "split", "blink", "grid"][+e.key - 1]);
    else if (k === "t") $("#btn3d").click();
    else if (k === "l") $("#btnLabels").click();
    else if (k === "m") toggleMeasure();
    else if (k === "e") openExport();
    else if (e.key === "/") { e.preventDefault(); setRail(true); q.focus(); }
    else if (e.key === "?") openHelp();
    else if (e.key === "Backspace" && S.measure) { S.measure.pts.pop(); updateMeasure(); }
  });
  window.addEventListener("resize", debounce(() => { pair?.resize(); }, 150));
  if (isPhone()) $("#app").classList.add("rail-collapsed");
}

const isPhone = () => matchMedia("(max-width: 820px)").matches;

function setRail(open) {
  $("#app").classList.toggle("rail-collapsed", !open);
  setTimeout(() => pair?.resize(), 380);
}

// debug hooks for headless verification
window.__gt = { S, get pair() { return pair; }, get tl() { return tl; }, openProject, scanHere, setMode, setSource, step, togglePlay, openExport, goOverview, EX, thumbFor };

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML("beforeend", `<div class="toast is-on">Groundtruth failed to start: ${esc(e.message)}</div>`);
});
